import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createHash, randomUUID } from 'node:crypto';
import { access, chmod, mkdir, mkdtemp, readFile, rename, rm } from 'node:fs/promises';
import { constants } from 'node:fs';
import { join } from 'node:path';
import { FRP_VERSION, FRP_ARCHIVE_HASHES as hashes, frpArchive } from '../shared/frp.ts';
import { relayUrl } from './invite.ts';

const run = promisify(execFile);
export { FRP_VERSION };
const installs = new Map<string, Promise<string>>();

/** Bound all sources together, and kill curl before releasing the pairing lock. */
export async function downloadFrpArchive(archive: string, urls: string[], hash: string, timeoutMs = 90_000) {
  const deadline = Date.now() + timeoutMs;
  let integrityFailure = false;
  for (const url of urls) {
    const remaining = deadline - Date.now();
    if (remaining <= 0) break;
    const budget = Math.min(30_000, remaining);
    try {
      await run('curl', ['--fail', '--location', '--connect-timeout', '5', '--max-time', String(budget / 1000), '--max-filesize', '67108864', '--silent', '--show-error', '--output', archive, url], { timeout: budget + 1000, killSignal: 'SIGKILL' });
      if (createHash('sha256').update(await readFile(archive)).digest('hex') === hash) return;
      integrityFailure = true;
    } catch { /* try the next source within the shared deadline */ }
  }
  throw new Error(integrityFailure ? '中继客户端下载校验失败，未安装，请重试或通过 SESSIONDECK_FRPC_PATH 指定客户端' : '中继客户端下载失败或超时，请检查网络后重试，或通过 SESSIONDECK_FRPC_PATH 指定客户端');
}

/** Install a pinned, SHA-256 verified official binary without touching npm or system executables. */
export function ensureFrp(dataDir: string, binary: 'frpc' | 'frps' = 'frpc', serverUrl?: string): Promise<string> {
  const configured = process.env[`SESSIONDECK_${binary.toUpperCase()}_PATH`];
  if (configured) return access(configured, constants.X_OK).then(() => configured).catch(() => { throw new Error(`SESSIONDECK_${binary.toUpperCase()}_PATH 指定的中继客户端不存在或不可执行`); });
  const platform = `${process.platform}_${process.arch === 'x64' ? 'amd64' : process.arch}`;
  if (!hashes[platform]) return Promise.reject(new Error('当前系统暂不支持自动安装 frp，请通过 SESSIONDECK_FRPC_PATH 指定已安装的客户端'));
  const key = `${dataDir}:${binary}`;
  let installing = installs.get(key);
  if (!installing) {
    installing = (async () => {
      const directory = join(dataDir, 'bin', `frp-${FRP_VERSION}-${platform}`), path = join(directory, binary);
      try { await access(path, constants.X_OK); return path; } catch { /* first install */ }
      await mkdir(join(dataDir, 'bin'), { recursive: true, mode: 0o700 });
      const stage = await mkdtemp(join(dataDir, 'bin', '.frp-'));
      try {
        const archive = join(stage, 'frp.tar.gz'), name = `frp_${FRP_VERSION}_${platform}`;
        const urls = [process.env.SESSIONDECK_FRP_MIRROR, serverUrl ? `${relayUrl(serverUrl)}/clients/${frpArchive(platform)}` : undefined, `https://github.com/fatedier/frp/releases/download/v${FRP_VERSION}/${name}.tar.gz`, `https://ghfast.top/https://github.com/fatedier/frp/releases/download/v${FRP_VERSION}/${name}.tar.gz`].filter(Boolean) as string[];
        await downloadFrpArchive(archive, urls.map(url => url.replace('{name}', name)), hashes[platform]!);
        await run('tar', ['-xzf', archive, '-C', stage, `${name}/frpc`, `${name}/frps`, `${name}/LICENSE`], { timeout: 10_000, killSignal: 'SIGKILL' });
        for (const file of ['frpc', 'frps']) await chmod(join(stage, name, file), 0o700);
        const target = `${directory}-${randomUUID()}`;
        await rename(join(stage, name), target);
        try { await rename(target, directory); } catch (error) { await rm(target, { recursive: true, force: true }); await access(path, constants.X_OK).catch(() => { throw error; }); }
        return path;
      } finally { await rm(stage, { recursive: true, force: true }); }
    })().finally(() => installs.delete(key));
    installs.set(key, installing);
  }
  return installing;
}
