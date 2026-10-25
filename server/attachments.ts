import type express from 'express';
import { randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { writeFile, unlink, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import type { ChatAttachment } from '../shared/attachments.ts';
import { MAX_CHAT_ATTACHMENTS } from '../shared/attachments.ts';
import { MAX_TERMINAL_IMAGE_BYTES, TERMINAL_IMAGE_TYPES, type TerminalImageType } from '../shared/terminal-images.ts';
const fail = (message: string, status = 400): never => { throw Object.assign(new Error(message), { status }); };
const extensions: Record<TerminalImageType, string> = { 'image/png': '.png', 'image/jpeg': '.jpg', 'image/gif': '.gif', 'image/webp': '.webp' };
export function hasImageSignature(body: Buffer, type: TerminalImageType): boolean {
  if (type === 'image/png') return body.length >= 8 && body.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]));
  if (type === 'image/jpeg') return body.length >= 3 && body[0] === 255 && body[1] === 216 && body[2] === 255;
  if (type === 'image/gif') return body.length >= 6 && ['GIF87a','GIF89a'].includes(body.subarray(0,6).toString('ascii'));
  return body.length >= 12 && body.subarray(0,4).toString('ascii') === 'RIFF' && body.subarray(8,12).toString('ascii') === 'WEBP';
}
export class Attachments {
  constructor(private db: DatabaseSync, private directory: string) {
    mkdirSync(directory, { recursive: true, mode: 0o700 });
    db.exec('CREATE TABLE IF NOT EXISTS chat_attachments (id TEXT PRIMARY KEY, session_id TEXT NOT NULL, data TEXT NOT NULL)');
  }
  get(sessionId: string, id: string): ChatAttachment {
    if (!/^[a-f0-9-]{36}$/.test(id)) fail('附件标识无效');
    const row = this.db.prepare('SELECT data FROM chat_attachments WHERE id = ? AND session_id = ?').get(id, sessionId);
    return row ? JSON.parse(String(row.data)) : fail('附件不存在或不属于当前会话', 404);
  }
  path(item: ChatAttachment) { return join(this.directory, item.id + extensions[item.type as TerminalImageType]); }
  resolve(sessionId: string, value: unknown): string[] {
    if (value === undefined) return [];
    if (!Array.isArray(value) || value.length > MAX_CHAT_ATTACHMENTS || value.some(id => typeof id !== 'string') || new Set(value).size !== value.length) fail('每条消息最多 8 张图片，附件不可重复');
    return (value as string[]).map(id => this.path(this.get(sessionId, id)));
  }
  async add(sessionId: string, type: TerminalImageType, body: Buffer, name: string): Promise<ChatAttachment> {
    if (!Buffer.isBuffer(body) || !body.length || body.length > MAX_TERMINAL_IMAGE_BYTES) fail('图片为空或超过 10 MiB', 413);
    if (!hasImageSignature(body, type)) fail('图片内容与声明的格式不匹配', 415);
    const item: ChatAttachment = { id: randomUUID(), name: name.replace(/[\x00-\x1f/\\]/g, '_').slice(0,120) || '图片' + extensions[type], type, size: body.length };
    const target = this.path(item);
    await writeFile(target, body, { mode: 0o600, flag: 'wx' });
    try { this.db.prepare('INSERT INTO chat_attachments VALUES (?,?,?)').run(item.id, sessionId, JSON.stringify(item)); }
    catch (error) { await unlink(target).catch(() => {}); throw error; }
    return item;
  }
}
export function registerAttachments(app: express.Express, raw: typeof express.raw, files: Attachments, options: {
  csrf(req: express.Request, res: express.Response): boolean;
  allowed(id: string): boolean;
  allowedGroup?(id: string): boolean;
}) {

  const upload = (group: boolean): express.RequestHandler[] => [
    (req, res, next) => {
      if (!options.csrf(req,res)) { res.status(403).json({error:'操作凭证已过期，请刷新页面'}); return; }
      const allowed = group ? options.allowedGroup : options.allowed;
      if (!allowed?.(String(req.params.id))) { res.status(409).json({error:'当前会话或群聊不可用'}); return; }
      const type = req.headers['content-type']?.split(';',1)[0];
      if (!(TERMINAL_IMAGE_TYPES as readonly string[]).includes(type ?? '')) { res.status(415).json({error:'仅支持 PNG、JPEG、GIF 或 WebP 图片'}); return; }
      const length = Number(req.headers['content-length']);
      if (Number.isFinite(length) && length > MAX_TERMINAL_IMAGE_BYTES) { res.status(413).json({error:'图片不能超过 10 MiB'}); return; }
      next();
    },
    raw({type:()=>true,limit:MAX_TERMINAL_IMAGE_BYTES}),
    async (req,res) => {
      const id = String(req.params.id);
      if (!(group ? options.allowedGroup : options.allowed)?.(id)) fail('状态已变化，请重新添加图片',409);
      let name = '图片';
      try { name = decodeURIComponent(String(req.headers['x-dili-filename'] ?? name)); } catch { /* fallback name */ }
      res.status(201).json(await files.add(group ? groupAttachmentScope(id) : id, req.headers['content-type']!.split(';',1)[0] as TerminalImageType, req.body, name));
    },
  ];
  const download = (group: boolean): express.RequestHandler => async (req,res) => {
    const item = files.get(group ? groupAttachmentScope(String(req.params.id)) : String(req.params.id),String(req.params.attachmentId));
    res.setHeader('Content-Type',item.type); res.setHeader('Cache-Control','private, no-store');
    res.send(await readFile(files.path(item)));
  };
  app.post('/api/sessions/:id/attachments', ...upload(false));
  app.get('/api/sessions/:id/attachments/:attachmentId', download(false));
  app.post('/api/groups/:id/attachments', ...upload(true));
  app.get('/api/groups/:id/attachments/:attachmentId', download(true));
}
/** Separate storage namespace; a group upload never grants session attachment access. */
export const groupAttachmentScope = (id: string) => 'group:' + id;
