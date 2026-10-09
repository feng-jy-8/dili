import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { RelayStore } from './relay-store.ts';
import type { RemoteStatus } from '../shared/auth.ts';

test('local pairing releases failure state and retries a lost relay reply without creating another device', { timeout: 25_000 }, async t => {
  const directory = await mkdtemp(join(tmpdir(), 'sessiondeck-remote-pair-'));
  const db = new DatabaseSync(':memory:'), store = new RelayStore(db);
  let loseReply = true;
  const relay = createServer(async (req, res) => {
    let body = ''; for await (const chunk of req) body += chunk;
    const input = JSON.parse(body);
    const device = store.redeem(input.secret, input.claim, input.credential, input.name);
    if (loseReply) { loseReply = false; res.destroy(); return; }
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({ deviceId: device.id, publicUrl: `${relayUrl}/d/${device.id}`, serverPort: device.port, pairedAt: device.createdAt }));
  }).listen(0, '127.0.0.1');
  await new Promise<void>(resolve => relay.once('listening', resolve));
  const relayAddress = relay.address(); assert.ok(relayAddress && typeof relayAddress !== 'string');
  const relayUrl = `http://127.0.0.1:${relayAddress.port}/connect`;
  const invite = store.createInvite(relayUrl, 'seven day test', 168).invite;
  const probe = createServer().listen(0, '127.0.0.1');
  await new Promise<void>(resolve => probe.once('listening', resolve));
  const address = probe.address(); assert.ok(address && typeof address !== 'string');
  const port = address.port;
  await new Promise<void>(resolve => probe.close(() => resolve()));
  const remoteProbe = createServer().listen(0, '127.0.0.1');
  await new Promise<void>(resolve => remoteProbe.once('listening', resolve));
  const remoteAddress = remoteProbe.address(); assert.ok(remoteAddress && typeof remoteAddress !== 'string');
  const remotePort = remoteAddress.port;
  await new Promise<void>(resolve => remoteProbe.close(() => resolve()));
  // A missing client fails before redeem. Making the fixture available permits retry.
  const executable = join(directory, 'frpc-fixture');
  const child = spawn(process.execPath, ['--import', 'tsx', 'server/index.ts'], {
    env: { ...process.env, PORT: String(port), SESSIONDECK_PORT: String(port), SESSIONDECK_HOST: '127.0.0.1', HOST: '127.0.0.1', SESSIONDECK_DEMO: '1', SESSIONDECK_DATA_DIR: directory, SESSIONDECK_CLIENT_DIR: join(directory, 'client'), SESSIONDECK_REMOTE_PORT: String(remotePort), SESSIONDECK_FRPC_PATH: executable },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let logs = ''; child.stdout?.on('data', chunk => { logs += chunk; }); child.stderr?.on('data', chunk => { logs += chunk; });
  t.after(async () => {
    if (child.exitCode === null && child.signalCode === null) {
      const ended = new Promise<void>(resolve => child.once('exit', () => resolve()));
      child.kill('SIGTERM'); const hard = setTimeout(() => child.kill('SIGKILL'), 3000);
      await ended.finally(() => clearTimeout(hard));
    }
    relay.closeAllConnections(); await new Promise<void>(resolve => relay.close(() => resolve()));
    db.close(); await rm(directory, { recursive: true, force: true });
  });
  const base = `http://127.0.0.1:${port}`;
  let token = '';
  for (let attempt = 0; attempt < 150; attempt++) {
    if (child.exitCode !== null) assert.fail(`fixture exited: ${logs}`);
    try { const response = await fetch(`${base}/api/config`); if (response.ok) { token = (await response.json()).csrfToken; break; } } catch { /* not ready */ }
    await delay(50);
  }
  assert.ok(token, `fixture did not start: ${logs}`);
  const post = (path: string, body: unknown) => fetch(`${base}/api${path}`, { method: 'POST', headers: { 'content-type': 'application/json', 'X-SessionDeck-Token': token }, body: JSON.stringify(body) });
  const status = async () => await (await fetch(`${base}/api/remote`)).json() as RemoteStatus;
  assert.equal((await post('/auth/password', { password: 'pair fixture password' })).status, 200);
  const input = { invite, name: 'pair fixture' };
  assert.equal((await post('/remote/pair', input)).status, 400);
  assert.equal(store.devices().length, 0, 'an installation failure must not consume an invite');
  assert.equal((await status()).pairingStage, null);
  await writeFile(executable, '#!/bin/sh\necho "start proxy success"\nexec sleep 60\n', { mode: 0o700 });
  const lost = await post('/remote/pair', input);
  assert.equal(lost.status, 400);
  assert.match((await lost.json()).error, /重试/);
  assert.equal(store.devices().length, 1);
  assert.equal((await status()).pairingStage, null);
  const retried = await post('/remote/pair', input);
  assert.equal(retried.status, 200);
  const pair = await retried.json() as RemoteStatus;
  assert.equal(pair.pairing?.deviceId, store.devices()[0]?.id);
  assert.equal(store.devices().length, 1);
  assert.equal(pair.pairingStage, null);
  assert.equal((await post('/remote/pair', input)).status, 409);
});
