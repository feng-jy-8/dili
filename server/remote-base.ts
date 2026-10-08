import type { RemoteSettings } from '../shared/auth.ts';

export function remoteBase(settings: Pick<RemoteSettings, 'mode' | 'publicUrl'>) {
  if (settings.mode !== 'invite' || !settings.publicUrl) return '';
  const path = new URL(settings.publicUrl).pathname.replace(/\/$/, '');
  if (!/^\/connect\/d\/[a-z0-9]{16}$/.test(path)) throw new Error('远程设备路径无效');
  return path;
}
export function remoteHtml(html: string, base: string) {
  if (!base) return html;
  return html.replace('<head>', `<head><meta name="sessiondeck-base" content="${base}">`)
    .replace(/\b(src|href)="\/(?!\/)/g, `$1="${base}/`);
}
export function remoteManifest(source: string, base: string) {
  const manifest = JSON.parse(source);
  manifest.start_url = manifest.scope = `${base}/`;
  manifest.id = `${base}/`;
  for (const icon of manifest.icons ?? []) if (icon.src?.startsWith('/')) icon.src = base + icon.src;
  return JSON.stringify(manifest);
}
