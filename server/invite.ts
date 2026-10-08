import { randomBytes, createHash } from 'node:crypto';

export const secretHash = (value: string) => createHash('sha256').update(value).digest('hex');
export const newSecret = () => randomBytes(32).toString('base64url');
export function relayUrl(value: unknown): string {
  if (typeof value !== 'string' || value.length > 500) throw new Error('邀请码中的服务器地址无效');
  const url = new URL(value);
  if (url.username || url.password || url.search || url.hash || !['https:', 'http:'].includes(url.protocol)) throw new Error('邀请码中的服务器地址无效');
  if (url.protocol !== 'https:' && !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)) throw new Error('中继服务器必须使用 HTTPS');
  if (url.pathname !== '/connect' && url.pathname !== '/connect/') throw new Error('邀请码中的服务路径无效');
  return `${url.origin}/connect`;
}
export function encodeInvite(serverUrl: string, secret: string) {
  return `SD1.${Buffer.from(relayUrl(serverUrl)).toString('base64url')}.${secret}`;
}
export function decodeInvite(value: unknown): { serverUrl: string; secret: string } {
  if (typeof value !== 'string' || value.length > 1600) throw new Error('请粘贴服务器生成的完整邀请码');
  const match = value.trim().match(/^SD1\.([A-Za-z0-9_-]+)\.([A-Za-z0-9_-]{43})$/);
  if (!match) throw new Error('邀请码格式无效，请粘贴以 SD1. 开头的完整邀请码');
  return { serverUrl: relayUrl(Buffer.from(match[1]!, 'base64url').toString('utf8')), secret: match[2]! };
}
