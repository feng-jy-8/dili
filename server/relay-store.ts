import { randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import { encodeInvite, newSecret, secretHash } from './invite.ts';

export interface RelayDevice { id: string; name: string; port: number; createdAt: string; revokedAt: string | null; lastSeenAt: string | null; connected: boolean }
type DeviceRow = RelayDevice & { credentialHash: string; claimHash: string; inviteHash: string };
type InviteRow = { id: string; label: string; hash: string; expiresAt: string | null; createdAt: string; usedAt: string | null; revokedAt: string | null };
function fail(message: string, status = 400): never { throw Object.assign(new Error(message), { status }); }

/** Codes and client credentials are hashed; a redemption can be retried after a lost response. */
export class RelayStore {
  constructor(private readonly db: DatabaseSync, private readonly firstPort = 18700, private readonly lastPort = 18799) {
    db.exec('PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000; CREATE TABLE IF NOT EXISTS relay_invites (id TEXT PRIMARY KEY, hash TEXT UNIQUE, data TEXT NOT NULL); CREATE TABLE IF NOT EXISTS relay_devices (id TEXT PRIMARY KEY, data TEXT NOT NULL);');
  }
  invites() { return this.db.prepare('SELECT data FROM relay_invites ORDER BY rowid DESC').all().map(row => { const { hash: _hash, ...data } = JSON.parse(String(row.data)) as InviteRow; return data; }); }
  devices(): RelayDevice[] { return this.rows().map(({ credentialHash: _credential, claimHash: _claim, inviteHash: _invite, ...row }) => ({ ...row, connected: !row.revokedAt && !!row.lastSeenAt && Date.now() - Date.parse(row.lastSeenAt) < 20_000 })); }
  private rows(): DeviceRow[] { return this.db.prepare('SELECT data FROM relay_devices').all().map(row => JSON.parse(String(row.data)) as DeviceRow); }
  private save(row: DeviceRow) { this.db.prepare('INSERT OR REPLACE INTO relay_devices VALUES (?, ?)').run(row.id, JSON.stringify(row)); }
  createInvite(serverUrl: string, label: string, hours: number | null) {
    if ((hours !== null && (!Number.isInteger(hours) || hours < 1 || hours > 168)) || typeof label !== 'string' || label.length > 80) fail('备注最多 80 字，有效期为 1–168 小时或永不过期');
    const secret = newSecret();
    const row: InviteRow = { id: randomUUID(), label: label.trim(), hash: secretHash(secret), createdAt: new Date().toISOString(), expiresAt: hours === null ? null : new Date(Date.now() + hours * 3600_000).toISOString(), usedAt: null, revokedAt: null };
    this.db.prepare('INSERT INTO relay_invites VALUES (?, ?, ?)').run(row.id, row.hash, JSON.stringify(row));
    return { invite: encodeInvite(serverUrl, secret), id: row.id, expiresAt: row.expiresAt };
  }
  revokeInvite(id: string) {
    const result = this.db.prepare('SELECT data FROM relay_invites WHERE id=?').get(id);
    if (!result) fail('邀请码不存在', 404);
    const row = JSON.parse(String(result.data)) as InviteRow;
    row.revokedAt ??= new Date().toISOString();
    this.db.prepare('UPDATE relay_invites SET data=? WHERE id=?').run(JSON.stringify(row), id);
  }
  redeem(secret: string, claim: string, credential: string, name: string): RelayDevice {
    if (![secret, claim, credential].every(value => typeof value === 'string' && /^[\w-]{43}$/.test(value)) || typeof name !== 'string' || !name.trim() || name.length > 80) fail('配对参数无效');
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const hash = secretHash(secret), result = this.db.prepare('SELECT data FROM relay_invites WHERE hash=?').get(hash);
      if (!result) fail('邀请码无效或已撤销', 401);
      const invite = JSON.parse(String(result.data)) as InviteRow;
      if (invite.revokedAt) fail('邀请码已撤销', 410);
      const existing = this.rows().find(row => row.inviteHash === hash);
      if (existing && existing.claimHash === secretHash(claim) && existing.credentialHash === secretHash(credential) && !existing.revokedAt) { this.db.exec('COMMIT'); return this.device(existing.id)!; }
      if (invite.usedAt) fail('邀请码已被使用，请生成新的邀请码', 409);
      if (invite.expiresAt && Date.parse(invite.expiresAt) <= Date.now()) fail('邀请码已过期，请生成新的邀请码', 410);
      // Never reuse a revoked port while an old client could still be draining.
      const used = new Set(this.rows().map(row => row.port));
      let port = this.firstPort;
      while (used.has(port) && port <= this.lastPort) port++;
      if (port > this.lastPort) fail('服务器设备名额已满', 409);
      const now = new Date().toISOString();
      const row: DeviceRow = { id: randomBytesId(), name: name.trim(), port, createdAt: now, revokedAt: null, lastSeenAt: null, connected: false, credentialHash: secretHash(credential), claimHash: secretHash(claim), inviteHash: hash };
      this.save(row); invite.usedAt = now;
      this.db.prepare('UPDATE relay_invites SET data=? WHERE id=?').run(JSON.stringify(invite), invite.id);
      this.db.exec('COMMIT'); return this.device(row.id)!;
    } catch (error) { this.db.exec('ROLLBACK'); throw error; }
  }
  device(id: string) { return this.devices().find(row => row.id === id) ?? null; }
  authenticate(id: unknown, credential: unknown) {
    if (typeof id !== 'string' || typeof credential !== 'string') return null;
    const row = this.rows().find(row => row.id === id && !row.revokedAt && row.credentialHash === secretHash(credential));
    return row ? this.device(row.id) : null;
  }
  seen(id: string) { const row = this.rows().find(item => item.id === id); if (row && !row.revokedAt) { row.lastSeenAt = new Date().toISOString(); this.save(row); } }
  revokeDevice(id: string) { const row = this.rows().find(item => item.id === id); if (!row) fail('设备不存在', 404); row.revokedAt ??= new Date().toISOString(); this.save(row); }
}
const randomBytesId = () => newSecret().slice(0, 16).toLowerCase().replace(/_/g, 'x').replace(/-/g, 'y');
