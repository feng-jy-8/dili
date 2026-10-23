/** Only loopback and private LAN HTTP(S) URLs may open inside the workbench. */

const LOOPBACK = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);

function isPrivateIpv4(host: string): boolean {
  const match = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
  if (!match) return false;
  const parts = match.slice(1).map(Number);
  if (parts.some(part => part > 255)) return false;
  const [a, b] = parts;
  if (a === 10) return true;
  if (a === 192 && b === 168) return true;
  if (a === 172 && b !== undefined && b >= 16 && b <= 31) return true;
  if (a === 127) return true;
  return false;
}

/** Normalize typed shortcuts like `:5173` or `10.11.1.111:5173` into an absolute URL. */
export function normalizeServicePreviewInput(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return '';
  if (/^[a-z][a-z0-9+.-]*:/i.test(trimmed)) return trimmed;
  if (/^:\d{1,5}(?:\/.*)?$/i.test(trimmed)) return `http://127.0.0.1${trimmed}`;
  if (/^\d{2,5}(?:\/.*)?$/i.test(trimmed)) return `http://127.0.0.1:${trimmed}`;
  return `http://${trimmed}`;
}

export type ServicePreviewDecision =
  | { ok: true; url: string }
  | { ok: false; error: string };

/** Validate and canonicalize a local/LAN service URL for the preview panel. */
export function parseServicePreviewUrl(value: string): ServicePreviewDecision {
  const normalized = normalizeServicePreviewInput(value);
  if (!normalized) return { ok: false, error: '请输入本机或局域网服务地址' };
  let parsed: URL;
  try { parsed = new URL(normalized); }
  catch { return { ok: false, error: '地址格式无效' }; }
  if (parsed.username || parsed.password) return { ok: false, error: '服务地址不能包含账号密码' };
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return { ok: false, error: '仅支持 http 或 https 服务' };
  const host = parsed.hostname.toLowerCase();
  if (!LOOPBACK.has(host) && !isPrivateIpv4(host)) {
    return { ok: false, error: '仅允许本机或局域网地址（如 127.0.0.1、10.x、192.168.x）' };
  }
  if (parsed.port) {
    const port = Number(parsed.port);
    if (!Number.isInteger(port) || port < 1 || port > 65535) return { ok: false, error: '端口无效' };
  }
  return { ok: true, url: parsed.href };
}

export const SERVICE_PREVIEW_PRESETS = [
  { label: ':5173', url: 'http://127.0.0.1:5173/' },
  { label: ':3000', url: 'http://127.0.0.1:3000/' },
  { label: ':8080', url: 'http://127.0.0.1:8080/' },
] as const;
