import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createServer } from 'node:net';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const temp = await mkdtemp(join(tmpdir(), 'dili-package-smoke-'));
const prefix = join(temp, 'global');
const metadata = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
let service;
let logs = '';
async function command(file, args, options = {}) {
  const child = spawn(file, args, { cwd: root, ...options, stdio: ['ignore', 'pipe', 'pipe'] });
  let output = '';
  child.stdout.on('data', part => { output += part; }); child.stderr.on('data', part => { output += part; });
  const timer = setTimeout(() => child.kill('SIGTERM'), 120_000);
  try {
    const [code] = await once(child, 'exit');
    assert.equal(code, 0, `${file} ${args.join(' ')} failed:\n${output.slice(-4000)}`);
    return output;
  } finally { clearTimeout(timer); }
}
async function freePort() {
  const server = createServer(); server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const port = server.address().port; await new Promise(resolve => server.close(resolve)); return port;
}
try {
  // prepack has already built the immutable assets via test:package.
  const packed = JSON.parse(await command('npm', ['pack', '--ignore-scripts', '--json', '--pack-destination', temp]))[0];
  const paths = packed.files.map(file => file.path);
  assert.ok(paths.includes('bin/dili.mjs')); assert.ok(paths.includes('server/native-hook.cjs')); assert.ok(paths.includes('dist/client/index.html'));
  assert.ok(!paths.some(path => /\.test\.|\.env|^memory\//.test(path)));
  await command('npm', ['install', '--global', '--prefix', prefix, '--omit=dev', '--no-audit', '--no-fund', join(temp, packed.filename)]);
  const cli = join(prefix, 'bin/dili');
  assert.match(await command(cli, ['--help'], { cwd: temp }), /dili service/);
  assert.equal((await command(cli, ['--version'], { cwd: temp })).trim(), metadata.version);
  const installed = join(prefix, 'lib/node_modules', metadata.name);
  const runtime = JSON.parse(await readFile(join(installed, 'package.json'), 'utf8'));
  assert.ok(runtime.dependencies.tsx);
  await assert.rejects(readFile(join(installed, 'node_modules/vite/package.json')));
  const port = await freePort(); const remotePort = await freePort();
  assert.notEqual(port, remotePort);
  const env = { ...process.env, SESSIONDECK_DEMO: '1', SESSIONDECK_REMOTE_PORT: String(remotePort), SESSIONDECK_CLIENT_DIR: join(installed, 'dist/client'), SESSIONDECK_DATA_DIR: join(temp, 'data'), SESSIONDECK_CODEX_BIN: join(temp, 'missing-codex'), SESSIONDECK_CLAUDE_BIN: join(temp, 'missing-claude'), SESSIONDECK_DSH_BIN: join(temp, 'missing-dsh'), PORT: String(port), HOST: '127.0.0.1', SESSIONDECK_HOST: '127.0.0.1' };
  service = spawn(cli, ['start', '--port', String(port), '--data-dir', join(temp, 'data')], { cwd: temp, env, stdio: ['ignore', 'pipe', 'pipe'] });
  service.stdout.on('data', part => { logs += part; }); service.stderr.on('data', part => { logs += part; });
  let state;
  for (let attempt = 0; attempt < 100; attempt++) {
    assert.equal(service.exitCode, null, `installed service exited:\n${logs}`);
    try { const response = await fetch(`http://127.0.0.1:${port}/api/state`); if (response.ok) { state = await response.json(); break; } } catch { /* startup readiness */ }
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  assert.ok(state, `service failed to become ready:\n${logs}`);
  assert.equal(state.defaultCwd, temp); assert.equal(state.demo, true);
  const html = await (await fetch(`http://127.0.0.1:${port}/`)).text();
  assert.match(html, /Dili/);
  const assets = [...html.matchAll(/(?:src|href)="(\/assets\/[^\"]+)"/g)].map(match => match[1]);
  assert.ok(assets.length >= 2);
  for (const path of assets) assert.equal((await fetch(`http://127.0.0.1:${port}${path}`)).status, 200);
  const config = await (await fetch(`http://127.0.0.1:${port}/api/config`)).json();
  const denied = await fetch(`http://127.0.0.1:${port}/api/setup/agents/codex/config`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-SessionDeck-Token': config.csrfToken }, body: JSON.stringify({ apiKey: 'fake' }) });
  assert.equal(denied.status, 409); // Demo never writes real account credentials.
  await command(cli, ['doctor', '--port', String(port), '--data-dir', join(temp, 'data')], { cwd: temp, env });
  console.log(`Installed npm package ${metadata.name}@${metadata.version}: CLI, PTY, independent cwd, data, assets and demo guards passed.`);
} finally {
  if (service && service.exitCode === null) {
    const exited = once(service, 'exit'); service.kill('SIGTERM');
    const timer = setTimeout(() => service.kill('SIGKILL'), 10_000);
    await exited; clearTimeout(timer);
  }
  await rm(temp, { recursive: true, force: true });
}
