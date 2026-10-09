import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, rm } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { FRP_VERSION, FRP_ARCHIVE_HASHES, frpArchive } from '../shared/frp.ts';
import { downloadFrpArchive } from '../server/frp-install.ts';

// Run before deploying dist/relay/clients. Never publish an unverified archive.
const directory = resolve('dist/relay/clients');
await mkdir(directory, { recursive: true });
for (const [platform, hash] of Object.entries(FRP_ARCHIVE_HASHES)) {
  const archive = frpArchive(platform), path = join(directory, archive);
  try { if (createHash('sha256').update(await readFile(path)).digest('hex') === hash) continue; } catch { /* download */ }
  const staged = `${path}.${randomUUID()}.tmp`;
  try {
    const official = `https://github.com/fatedier/frp/releases/download/v${FRP_VERSION}/${archive}`;
    const urls = [process.env.SESSIONDECK_FRP_MIRROR?.replace('{name}', archive.replace(/\.tar\.gz$/, '')), official, `https://ghfast.top/${official}`].filter(Boolean) as string[];
    await downloadFrpArchive(staged, urls, hash);
    await rename(staged, path);
    console.log(`已准备并校验 ${archive}`);
  } finally { await rm(staged, { force: true }); }
}
