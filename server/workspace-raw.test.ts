import assert from 'node:assert/strict';
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { test } from 'node:test';
import type { Session } from '../shared/types.ts';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));

async function freePort() {
  const probe = createServer();
  await new Promise<void>((accept, reject) => { probe.once('error', reject); probe.listen(0, '127.0.0.1', accept); });
  const address = probe.address();
  assert.ok(address && typeof address !== 'string');
  const port = address.port;
  await new Promise<void>((accept, reject) => probe.close(error => error ? reject(error) : accept()));
  return port;
}

async function until(check: () => Promise<boolean>, message: string, timeout = 15_000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (await check()) return;
    await delay(25);
  }
  throw new Error(message);
}

async function stopProcess(child: ChildProcess) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  const exited = new Promise<void>(accept => child.once('exit', () => accept()));
  child.kill('SIGTERM');
  const hardStop = setTimeout(() => child.kill('SIGKILL'), 5000);
  try { await exited; } finally { clearTimeout(hardStop); }
}

test('workspace raw serves nested HTML assets and ranged video bytes', { timeout: 30_000 }, async t => {
  const directory = mkdtempSync(join(tmpdir(), 'sessiondeck-raw-'));
  const workspace = join(directory, 'project');
  mkdirSync(join(workspace, 'site'), { recursive: true });
  writeFileSync(join(workspace, 'site', 'index.html'), '<link rel="stylesheet" href="app.css"><h1>raw-ok</h1>');
  writeFileSync(join(workspace, 'site', 'app.css'), 'h1{color:navy}');
  writeFileSync(join(workspace, 'clip.mp4'), Buffer.from('ABCDEFGHIJKLMNOPQRSTUVWXYZ'));
  const port = await freePort();
  const base = `http://127.0.0.1:${port}`;
  const child = spawn(process.execPath, ['--import', 'tsx', 'server/index.ts'], {
    cwd: root,
    env: { ...process.env, PORT: String(port), SESSIONDECK_PORT: String(port), SESSIONDECK_DEMO: '1', SESSIONDECK_DATA_DIR: join(directory, 'data') },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let logs = '';
  child.stdout?.on('data', chunk => { logs = (logs + chunk).slice(-12_000); });
  child.stderr?.on('data', chunk => { logs = (logs + chunk).slice(-12_000); });
  t.after(async () => { await stopProcess(child); rmSync(directory, { recursive: true, force: true }); });
  await until(async () => {
    if (child.exitCode !== null) throw new Error(`server exited\n${logs}`);
    try { return (await fetch(`${base}/api/config`)).ok; } catch { return false; }
  }, `server start\n${logs}`);
  const { csrfToken } = await (await fetch(`${base}/api/config`)).json() as { csrfToken: string };
  const created = await fetch(`${base}/api/sessions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-sessiondeck-token': csrfToken },
    body: JSON.stringify({ backend: 'codex', title: 'raw preview', cwd: workspace }),
  });
  assert.equal(created.status, 201, `create session failed: ${created.status}`);
  const session = await created.json() as Session;

  const standalone = `${base}/api/workspaces/${encodeURIComponent(workspace)}/workspace`;
  assert.equal((await fetch(`${standalone}/tree`)).status, 200);
  const standaloneFile = await fetch(`${standalone}/file?path=site/app.css`);
  assert.equal(standaloneFile.status, 200);
  assert.match(await standaloneFile.text(), /navy/);
  assert.match(await (await fetch(`${standalone}/raw/site/app.css`)).text(), /navy/);
  assert.equal((await fetch(`${standalone}/git/status`)).status, 200);
  assert.ok([400, 403, 404].includes((await fetch(`${standalone}/file?path=../../package.json`)).status));

  const html = await fetch(`${base}/api/sessions/${session.id}/workspace/raw/site/index.html`);
  assert.equal(html.status, 200);
  assert.match(html.headers.get('content-type') || '', /text\/html/);
  assert.match(html.headers.get('content-security-policy') || '', /frame-ancestors 'self'/);
  assert.match(await html.text(), /raw-ok/);

  const css = await fetch(`${base}/api/sessions/${session.id}/workspace/raw/site/app.css`);
  assert.equal(css.status, 200);
  assert.match(css.headers.get('content-type') || '', /text\/css/);
  assert.match(await css.text(), /navy/);

  const ranged = await fetch(`${base}/api/sessions/${session.id}/workspace/raw/clip.mp4`, { headers: { Range: 'bytes=0-4' } });
  assert.equal(ranged.status, 206);
  assert.equal(ranged.headers.get('content-range'), 'bytes 0-4/26');
  assert.equal(ranged.headers.get('accept-ranges'), 'bytes');
  assert.equal(Buffer.from(await ranged.arrayBuffer()).toString(), 'ABCDE');

  const missing = await fetch(`${base}/api/sessions/${session.id}/workspace/raw/missing.html`);
  assert.equal(missing.status, 404);
  const escaped = await fetch(`${base}/api/sessions/${session.id}/workspace/raw/site/%2e%2e/%2e%2e/package.json`);
  assert.ok([400, 403, 404].includes(escaped.status), `path escape should not read outside the workspace (${escaped.status})`);
});
