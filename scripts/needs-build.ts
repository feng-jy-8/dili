import { readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { BUILD_MARKER, currentCommit } from './build-client.ts';

const exec = promisify(execFile);

// Paths that affect the published client bundle. Anything else (server/,
// docs, scripts) never requires a rebuild to take effect.
const CLIENT_INPUTS = ['client', 'shared', 'public', 'index.html', 'vite.config.ts', 'package.json', 'package-lock.json'];

/**
 * True when the published client bundle at `destination` does not reflect
 * the current checkout: no bundle yet, no git history to compare against
 * (packaged installs keep their own marker), or a commit touching a client
 * input landed after the bundle's recorded commit. A dirty working tree
 * touching a client input also counts, so uncommitted edits are rebuilt.
 */
export async function needsBuild(root: string, destination: string): Promise<boolean> {
  const built = await readFile(join(destination, BUILD_MARKER), 'utf8').then(text => text.trim(), () => null);
  if (!built) return true;
  const head = await currentCommit(root);
  if (!head) return false; // Not a git checkout (e.g. a packaged install); trust the existing bundle.
  if (head === built) {
    const status = await exec('git', ['-C', root, 'status', '--porcelain', '--', ...CLIENT_INPUTS]).then(r => r.stdout, () => '');
    return status.trim().length > 0;
  }
  const changed = await exec('git', ['-C', root, 'diff', '--name-only', `${built}..${head}`, '--', ...CLIENT_INPUTS])
    .then(r => r.stdout, () => null);
  if (changed === null) return true; // `built` commit no longer reachable (rebase/force-push): rebuild to be safe.
  return changed.trim().length > 0;
}

async function main() {
  const root = fileURLToPath(new URL('..', import.meta.url));
  const destination = resolve(process.env.SESSIONDECK_CLIENT_DIR || join(root, 'dist/client'));
  process.stdout.write((await needsBuild(root, destination)) ? 'yes\n' : 'no\n');
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
