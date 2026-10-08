import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { RelayStore } from './relay-store.ts';
import { decodeInvite, newSecret } from './invite.ts';

test('permanent relay invites never expire and can be redeemed once', () => {
  const db = new DatabaseSync(':memory:');
  const store = new RelayStore(db, 19000, 19010);
  const created = store.createInvite('https://example.test/connect', '长期设备', null);
  assert.equal(created.expiresAt, null);
  assert.equal(store.invites()[0]?.expiresAt, null);
  const { secret } = decodeInvite(created.invite);
  const device = store.redeem(secret, newSecret(), newSecret(), '开发机');
  assert.equal(device.port, 19000);
  assert.equal(store.devices()[0]?.connected, false);
  db.close();
});

test('expiring relay invites retain their existing deadline behavior', () => {
  const db = new DatabaseSync(':memory:');
  const store = new RelayStore(db);
  const created = store.createInvite('https://example.test/connect', '', 1);
  assert.ok(created.expiresAt);
  assert.ok(Date.parse(created.expiresAt!) > Date.now());
  db.close();
});
