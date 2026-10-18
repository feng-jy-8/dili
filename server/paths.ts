import { realpath, stat } from 'node:fs/promises';
import { resolve } from 'node:path';

/**
 * Native tools canonicalize cwd, including macOS /var and /tmp aliases.
 * Case-insensitive mounts (WSL drvfs /mnt/<drive>, macOS APFS) keep the
 * spelling given to realpath, and Codex may report a differently cased path,
 * so the same device and inode also identify the same directory.
 */
export async function sameDirectory(first: string, second: string): Promise<boolean> {
  try {
    const paths = await Promise.all([realpath(resolve(first)), realpath(resolve(second))]);
    if (paths[0] === paths[1]) return true;
    const [a, b] = await Promise.all(paths.map(path => stat(path)));
    return a.isDirectory() && a.dev === b.dev && a.ino === b.ino;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
    throw error;
  }
}
