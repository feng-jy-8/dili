import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createHash, randomUUID } from 'node:crypto';
import { access, chmod, mkdir, mkdtemp, readFile, rename, rm } from 'node:fs/promises';
import { constants } from 'node:fs';
import { join } from 'node:path';

const run = promisify(execFile);
export const FRP_VERSION = '0.68.0';
const hashes: Record<string, string> = {
  linux_amd64: '3cf934477f4fb1ee9e19e49c31fb33f5ffe3283300076f59afad8b8ccf1e1621',
  linux_arm64: '8855bd3537adf6f456b4073a1fb6f119885060f3c8b714fd56a842db42b4c097',
  darwin_amd64: '0ef747a7c31ef5c8bc70494bf2a9ec5a1c69d73bff684b4e8b2947c0d1e4f887',
  darwin_arm64: '9f344774971dfb9ae90ee1f633de68d1755c98510227a67289ec78081fc5c8fa',
};
const installs = new Map<string, Promise<string>>();
/** Install a pinned, SHA-256 verified official binary without touching npm or system executables. */
export function ensureFrp(dataDir: string, binary: 'frpc' | 'frps' = 'frpc'): Promise<string> {
  const configured = process.env[`SESSIONDECK_${binary.toUpperCase()}_PATH`];
  if (configured) return access(configured, constants.X_OK).then(() => configured);
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
        const urls = [process.env.SESSIONDECK_FRP_MIRROR, `https://github.com/fatedier/frp/releases/download/v${FRP_VERSION}/${name}.tar.gz`, `https://ghfast.top/https://github.com/fatedier/frp/releases/download/v${FRP_VERSION}/${name}.tar.gz`].filter(Boolean) as string[];
        let downloaded = false;
        for (const url of urls) {
          try { await run('curl', ['--fail', '--location', '--retry', '1', '--max-time', '120', '--silent', '--show-error', '--output', archive, url!.includes('{name}') ? url!.replace('{name}', name) : url!], { timeout: 250_000 }); downloaded = true; break; } catch { /* try the next source */ }
        }
        if (!downloaded) throw new Error('frp 下载失败');
        if (createHash('sha256').update(await readFile(archive)).digest('hex') !== hashes[platform]) throw new Error('frp 下载校验失败，未安装');
        await run('tar', ['-xzf', archive, '-C', stage, `${name}/frpc`, `${name}/frps`, `${name}/LICENSE`]);
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
