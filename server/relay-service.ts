import express from 'express';
import { readFileSync } from 'node:fs';
import { RelayStore } from './relay-store.ts';
import { validToken } from './security.ts';
import { relayUrl } from './invite.ts';

export interface RelayOptions { serverUrl: string; adminToken: string; pluginToken: string; adminHtml: string }
export function createRelayApp(store: RelayStore, options: RelayOptions) {
  const app = express(), serverUrl = relayUrl(options.serverUrl);
  app.disable('x-powered-by');
  app.use((_req, res, next) => { res.setHeader('Cache-Control', 'no-store'); res.setHeader('X-Content-Type-Options', 'nosniff'); res.setHeader('Referrer-Policy', 'no-referrer'); res.setHeader('X-Frame-Options', 'DENY'); next(); });
  app.use(express.json({ limit: '16kb' }));
  const failures = new Map<string, { count: number; until: number }>();
  const limit: express.RequestHandler = (req, res, next) => {
    const now = Date.now(), key = String(req.headers['x-forwarded-for'] || req.socket.remoteAddress).slice(0, 100);
    for (const [key, row] of failures) if (row.until <= now) failures.delete(key);
    const row = failures.get(key) ?? { count: 0, until: now + 60_000 };
    if (row.count >= 20 || [...failures.values()].reduce((sum, item) => sum + item.count, 0) >= 200) return res.status(429).json({ error: '尝试次数过多，请稍后重试' });
    row.count++; failures.set(key, row); next();
  };
  app.get('/connect/', (_req, res) => res.type('html').send(readFileSync(options.adminHtml, 'utf8')));
  app.get('/connect/health', (_req, res) => res.json({ ok: true }));
  app.post('/connect/api/redeem', limit, (req, res) => {
    const device = store.redeem(req.body.secret, req.body.claim, req.body.credential, req.body.name);
    res.json({ deviceId: device.id, name: device.name, serverUrl, publicUrl: `${serverUrl}/d/${device.id}`, serverPort: device.port, pairedAt: device.createdAt });
  });
  app.post('/connect/api/devices/:id/revoke', limit, (req, res) => {
    const device = store.authenticate(String(req.params.id), req.headers.authorization?.replace(/^Bearer /, ''));
    if (!device) return res.status(401).json({ error: '设备凭证已失效' });
    store.revokeDevice(device.id); res.json({ ok: true });
  });
  app.use('/connect/api/admin', limit, (req, res, next) => {
    if (!validToken(req.headers.authorization?.replace(/^Bearer /, ''), options.adminToken)) return res.status(401).json({ error: '管理密钥不正确' });
    next();
  });
  app.get('/connect/api/admin/state', (_req, res) => res.json({ devices: store.devices(), invites: store.invites() }));
  app.post('/connect/api/admin/invites', (req, res) => res.status(201).json(store.createInvite(serverUrl, req.body.label ?? '', req.body.hours ?? 24)));
  app.delete('/connect/api/admin/invites/:id', (req, res) => { store.revokeInvite(String(req.params.id)); res.json({ ok: true }); });
  app.delete('/connect/api/admin/devices/:id', (req, res) => { store.revokeDevice(String(req.params.id)); res.json({ ok: true }); });

  // Only Caddy and frps on this machine reach these paths; neither is publicly routed.
  app.get('/internal/route', (req, res) => {
    const path = String(req.headers['x-forwarded-uri'] ?? '');
    const match = /^\/connect\/d\/([a-z0-9]{16})(?:\/|\?|$)/.exec(path);
    const device = match && store.device(match[1]!);
    if (!device || device.revokedAt) return res.status(410).send('远程设备不存在或已撤销');
    res.setHeader('X-SessionDeck-Upstream', `127.0.0.1:${device.port}`);
    res.setHeader('X-SessionDeck-Prefix', `/connect/d/${device.id}`);
    res.sendStatus(200);
  });
  app.post('/internal/frp/:token', (req, res) => {
    if (!validToken(String(req.params.token), options.pluginToken)) return res.sendStatus(403);
    const content = req.body?.content;
    if (!content || typeof content !== 'object') return res.status(400).json({ reject: true });
    const op = req.query.op;
    const user = op === 'Login' ? content : content.user;
    const device = store.authenticate(user?.user, user?.metas?.credential);
    let allowed = !!device;
    if (op === 'NewProxy') allowed &&= content.proxy_type === 'tcp' && content.proxy_name === `${device!.id}.web` && content.remote_port === device!.port && !content.group;
    if (!['Login', 'NewProxy', 'Ping', 'NewWorkConn'].includes(String(op))) allowed = false;
    if (allowed && (op === 'Login' || op === 'Ping')) store.seen(device!.id);
    res.json(allowed ? { reject: false, unchange: true } : { reject: true, reject_reason: 'invalid device credential or revoked device' });
  });
  app.use((_req, res) => res.status(404).json({ error: '接口不存在' }));
  app.use((error: Error & { status?: number }, _req: express.Request, res: express.Response, _next: express.NextFunction) => res.status(error.status || 400).json({ error: error.message || '请求失败' }));
  return app;
}
