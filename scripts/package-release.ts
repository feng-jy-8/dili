import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { dirname, join, resolve } from 'node:path';

const exec = promisify(execFile);
const root = resolve(new URL('..', import.meta.url).pathname);
const packageJson = JSON.parse(await readFile(join(root, 'package.json'), 'utf8')) as { name: string; version: string };
const version = packageJson.version;
const releaseDir = resolve(process.env.RELEASE_DIR || join(root, 'dist/releases'));
const staging = await mkdtemp(join(dirname(releaseDir), '.release-'));
const appName = `dili-${version}-linux-x86_64`;
const relayName = `dili-relay-${version}-linux-x86_64`;

async function copy(source: string, target: string) {
  await cp(join(root, source), join(staging, target), { recursive: true });
}
async function archive(name: string, source: string) {
  await mkdir(releaseDir, { recursive: true });
  await exec('tar', ['-czf', join(releaseDir, `${name}.tar.gz`), '-C', staging, source]);
}

try {
  await mkdir(join(staging, appName), { recursive: true });
  for (const path of ['dist/client', 'public', 'server', 'shared', 'scripts', 'start.sh', 'package.json', 'package-lock.json', 'README.MD', 'AGENTS.md']) await copy(path, join(appName, path));
  await writeFile(join(staging, appName, 'INSTALL.md'), '# Dili ' + version + ' for Linux x86_64\n\n需要 Node.js 24+。解压后执行 npm ci 安装运行依赖，再执行 ./start.sh。默认监听 4317；生产服务可用 scripts/install-service.sh 安装为 systemd --user 单元。\n\n产品名：Dili（嘀哩工作台）\n');
  await archive(appName, appName);

  await mkdir(join(staging, relayName, 'relay', 'clients'), { recursive: true });
  await copy('dist/relay/relay.mjs', join(relayName, 'relay/relay.mjs'));
  await copy('dist/relay/index.html', join(relayName, 'relay/index.html'));
  await copy('dist/relay/public.caddy', join(relayName, 'relay/public.caddy'));
  const clientArchive = `frp_${(await import('../shared/frp.ts')).FRP_VERSION}_linux_amd64.tar.gz`;
  await copy(`dist/relay/clients/${clientArchive}`, join(relayName, 'relay/clients', clientArchive));
  const launcher = ['#!/usr/bin/env bash', 'set -euo pipefail', 'root="$(CDPATH=\'\' cd -- \"$(dirname -- \"${BASH_SOURCE[0]}\")\" && pwd)"', 'export SESSIONDECK_RELAY_HTML="$root/relay/index.html"', 'export SESSIONDECK_RELAY_CLIENTS_DIR="$root/relay/clients"', 'exec node "$root/relay/relay.mjs"', ''].join('\n');
  await writeFile(join(staging, relayName, 'start-relay.sh'), launcher);
  await writeFile(join(staging, relayName, 'README.md'), '# Dili Relay ' + version + ' for Linux x86_64\n\n配置 SESSIONDECK_RELAY_URL（默认 https://discoverpaw.com/connect）和可选的 SESSIONDECK_RELAY_DOMAINS 后执行 ./start-relay.sh。域名必须解析到同一台 Caddy／中继服务。\n');
  await archive(relayName, relayName);
  console.log(`发布包已生成：${releaseDir}`);
} finally {
  await rm(staging, { recursive: true, force: true });
}
