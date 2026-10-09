import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createServer } from 'node:http';
import { RelayStore } from './relay-store.ts';
import { createRelayApp } from './relay-service.ts';
import { pendingPairing, redeemPairing } from './pairing.ts';
import { FRP_ARCHIVE_HASHES, frpArchive } from '../shared/frp.ts';

test('relay HTTP supports seven-day and permanent invites, safe retries and pinned client assets', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'sessiondeck-relay-test-'));
  const archive = frpArchive(Object.keys(FRP_ARCHIVE_HASHES)[0]!);
  await writeFile(join(directory, archive), 'fixture');
  const db = new DatabaseSync(':memory:'), store = new RelayStore(db);
  const server = createServer().listen(0, '127.0.0.1');
  await new Promise<void>(resolve => server.once('listening', resolve));
  t.after(async () => { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); db.close(); await rm(directory, { recursive: true, force: true }); });
  const address = server.address(); assert.ok(address && typeof address !== 'string');
  const base = `http://127.0.0.1:${address.port}/connect`;
  server.on('request', createRelayApp(store, { serverUrl: base, adminToken: 'fixture-admin', pluginToken: 'fixture-plugin', adminHtml: resolve('relay/index.html'), clientsDir: directory }));
  const response = await fetch(`${base}/clients/${archive}`);
  assert.equal(response.status, 200); assert.equal(await response.text(), 'fixture');
  assert.equal((await fetch(`${base}/clients/admin.token`)).status, 404);
  assert.equal((await fetch(`${base}/clients/${frpArchive('unsupported')}`)).status, 404);
  assert.match(await (await fetch(`${base}/`)).text(), /永不过期/);
  for (const ttl of [168, null]) {
    const admin = await fetch(`${base}/api/admin/invites`, { method: 'POST', headers: { authorization: 'Bearer fixture-admin', 'content-type': 'application/json' }, body: JSON.stringify(ttl === null ? { permanent: true } : { hours: ttl }) });
    assert.equal(admin.status, 201);
    const created = await admin.json() as { invite: string; expiresAt: string | null };
    if (ttl === null) assert.equal(created.expiresAt, null);
    else assert.ok(Math.abs(Date.parse(created.expiresAt!) - Date.now() - 168 * 3600_000) < 5000);
    const input = pendingPairing(created.invite, 'fixture device');
    const pair = await redeemPairing(input);
    assert.equal(pair.serverUrl, base);
    assert.equal(pair.credential, input.credential);
    assert.equal((await redeemPairing(input)).deviceId, pair.deviceId);
    await assert.rejects(redeemPairing(pendingPairing(created.invite, 'another device')), /已被使用/);
  }
  assert.equal(store.devices().length, 2);
});
