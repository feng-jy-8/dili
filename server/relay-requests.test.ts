import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { createServer } from 'node:http';
import { resolve } from 'node:path';
import { RelayStore } from './relay-store.ts';
import { createRelayApp } from './relay-service.ts';
import { decodeInvite, newSecret } from './invite.ts';

test('email requests require a private receipt, approval is atomic, codes remain encrypted and legacy routing survives', async t => {
  const db = new DatabaseSync(':memory:'), store = new RelayStore(db);
  const server = createServer().listen(0, '127.0.0.1');
  await new Promise<void>(resolve => server.once('listening', resolve));
  t.after(async () => { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); db.close(); });
  const address = server.address(); assert.ok(address && typeof address !== 'string');
  const base = `http://127.0.0.1:${address.port}/connect`;
  server.on('request', createRelayApp(store, { serverUrl: base, adminToken: 'admin-fixture', pluginToken: 'plugin-fixture', adminHtml: resolve('relay/index.html') }));
  const call = (path: string, body?: object, admin = false) => fetch(base + path, { method: body ? 'POST' : 'GET', headers: { 'content-type': 'application/json', ...(admin ? { authorization: 'Bearer admin-fixture' } : {}) }, body: body ? JSON.stringify(body) : undefined });
  assert.equal((await call('/api/requests', { email: 'broken', name: 'A', claim: newSecret() })).status, 400);
  const claim = newSecret();
  const response = await call('/api/requests', { email: 'user@example.com', name: '<script>user</script>', claim });
  assert.equal(response.status, 201); const created = await response.json() as { id: string };
  assert.equal((await call(`/api/requests/${created.id}/status`, { claim: newSecret() })).status, 404);
  assert.equal((await call(`/api/admin/requests/${created.id}/review`, { approve: true })).status, 401);
  assert.equal((await call(`/api/admin/requests/${created.id}/review`, { approve: true }, true)).status, 200);
  assert.equal((await call(`/api/admin/requests/${created.id}/review`, { approve: true }, true)).status, 409);
  const status = await (await call(`/api/requests/${created.id}/status`, { claim })).json() as { invite: string; inviteStatus: string };
  assert.equal(status.inviteStatus, 'ready'); assert.equal(decodeInvite(status.invite).serverUrl, base);
  assert.equal(JSON.stringify(store.requests()).includes(claim), false);
  const stored = String(db.prepare('SELECT data FROM relay_requests').get()!.data);
  assert.equal(stored.includes(status.invite), false); assert.equal(stored.includes(decodeInvite(status.invite).secret), false);
  assert.equal((await (await call(`/api/requests/${created.id}/status`, { claim })).json() as { invite: string }).invite, status.invite);
  const device = store.redeem(decodeInvite(status.invite).secret, newSecret(), newSecret(), 'existing client');
  const route = await fetch(base.replace('/connect', '') + '/internal/route', { headers: { 'x-forwarded-uri': `/connect/d/${device.id}/api/state` } });
  assert.equal(route.status, 200); assert.equal(route.headers.get('x-dili-device-host'), new URL(base).host);
  assert.equal(route.headers.get('x-sessiondeck-upstream'), `127.0.0.1:${device.port}`);
  const used = await (await call(`/api/requests/${created.id}/status`, { claim })).json() as { invite?: string; inviteStatus: string };
  assert.equal(used.inviteStatus, 'used'); assert.equal(used.invite, undefined);
});


test('approval expiry supports one hour, one day, seven days and permanent, rejecting invalid durations atomically', () => {
  const db = new DatabaseSync(':memory:'), store = new RelayStore(db);
  try {
    for (const hours of [1, 24, 168, null]) {
      const receipt = store.requestInvite('duration@example.com', 'Duration', newSecret());
      const start = Date.now();
      store.reviewRequest(receipt.id, true, 'https://relay.example/connect', value => value, hours);
      const request = store.requests().find(row => row.id === receipt.id)!;
      const invite = store.invites().find(row => row.id === request.inviteId)!;
      if (hours === null) assert.equal(invite.expiresAt, null);
      else assert.ok(Math.abs(Date.parse(invite.expiresAt!) - start - hours * 3600_000) < 1000);
    }
    const receipt = store.requestInvite('invalid@example.com', 'Invalid', newSecret());
    const count = store.invites().length;
    assert.throws(() => store.reviewRequest(receipt.id, true, 'https://relay.example/connect', value => value, 0));
    assert.equal(store.invites().length, count);
    assert.equal(store.requests().find(row => row.id === receipt.id)!.status, 'pending');
  } finally { db.close(); }
});
