import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { resolve, join, dirname } from 'node:path';
import { publishClientBuild } from './build-client.ts';

const destination = resolve(process.env.DILI_PWA_DIR || 'dist/pwa');
await mkdir(dirname(destination), { recursive: true });
const staging = await mkdtemp(join(dirname(destination), '.dili-pwa-'));
try {
  await cp('dist/client', staging, { recursive: true });
  const index = join(staging, 'index.html');
  await writeFile(index, (await readFile(index, 'utf8')).replace('<head>', '<head><meta name="dili-launcher" content="1">'));
  await cp('docs/pwa.md', join(staging, 'INSTALL.md'));
  await mkdir(join(staging, 'licenses'), { recursive: true });
  for (const file of ['qrcode-LICENSE', 'jsqr-LICENSE']) await cp(join('client/vendor', file), join(staging, 'licenses', file));
  await publishClientBuild(staging, destination);
  console.log(`PWA 构建就绪：${destination}`);
} finally { await rm(staging, { recursive: true, force: true }); }
