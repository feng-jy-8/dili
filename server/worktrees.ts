import { execFile } from 'node:child_process';
import { mkdir, realpath, stat } from 'node:fs/promises';
import { join, relative, sep } from 'node:path';
import { promisify } from 'node:util';
import type { MemberWorktree, WorktreeStatus } from '../shared/types.ts';

const exec = promisify(execFile);
const fail = (message: string, status = 409): never => { throw Object.assign(new Error(message), { status }); };

function environment(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env, GIT_TERMINAL_PROMPT: '0' };
  // A service launched from inside another repository must not inherit its git state.
  for (const key of Object.keys(env)) if (/^GIT_(?:DIR|WORK_TREE|COMMON_DIR|INDEX_FILE|OBJECT_DIRECTORY|NAMESPACE|CEILING_DIRECTORIES)$/u.test(key)) delete env[key];
  return env;
}
async function git(cwd: string, args: string[], timeout = 30_000): Promise<string> {
  try { return (await exec('git', ['--no-pager', ...args], { cwd, env: environment(), timeout, maxBuffer: 4 * 1024 * 1024 })).stdout.toString().trim(); }
  catch (cause) {
    const error = cause as { stderr?: Buffer | string; message?: string };
    const detail = String(error.stderr ?? error.message ?? '').trim().split('\n').slice(-3).join(' ');
    throw Object.assign(new Error(detail || 'git 命令失败'), { status: 409, git: true });
  }
}
const count = (output: string) => output ? output.split('\n').filter(Boolean).length : 0;

/** Branch-safe slug; Chinese names keep their characters, git allows them. */
export function branchSlug(value: string): string {
  return value.normalize('NFKC').replace(/[\s~^:?*\[\]\\@{}.]+/gu, '-').replace(/\/+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'member';
}

/** Repository root and the workspace's path inside it. Null outside git. */
export async function repositoryOf(workspace: string): Promise<{ root: string; prefix: string; head: string } | null> {
  try {
    const root = await realpath(await git(workspace, ['rev-parse', '--show-toplevel'], 5000));
    const head = await git(workspace, ['rev-parse', 'HEAD'], 5000);
    const prefix = relative(root, await realpath(workspace)).split(sep).join('/');
    return { root, prefix, head };
  } catch { return null; }
}

/** Adds a worktree on a new branch from the workspace's current HEAD. The
 * worktree lives under Dili's data directory, never inside the user's folders. */
export async function createWorktree(options: { dataDir: string; workspace: string; group: string; member: string; id: string }): Promise<{ worktree: MemberWorktree; cwd: string }> {
  const repo = await repositoryOf(options.workspace) ?? fail('群工作区不是 Git 仓库，无法创建独立工作树');
  const branch = `dili/${branchSlug(options.group)}/${branchSlug(options.member)}-${options.id.slice(0, 6)}`;
  const path = join(options.dataDir, 'worktrees', options.id);
  await mkdir(join(options.dataDir, 'worktrees'), { recursive: true, mode: 0o700 });
  await git(repo.root, ['worktree', 'add', '-b', branch, path, repo.head], 120_000);
  const cwd = repo.prefix ? join(path, repo.prefix) : path;
  try { if (!(await stat(cwd)).isDirectory()) fail('工作树中不存在对应的子目录'); }
  catch { await removeWorktree({ path, branch, repository: repo.root, base: repo.head }).catch(() => {}); fail('工作树中不存在群工作区对应的子目录（可能尚未提交）'); }
  return { worktree: { path, branch, repository: repo.root, base: repo.head }, cwd };
}

export async function worktreeStatus(worktree: MemberWorktree): Promise<WorktreeStatus> {
  const [counts, uncommitted, workspaceDirty, current] = await Promise.all([
    git(worktree.repository, ['rev-list', '--left-right', '--count', `HEAD...${worktree.branch}`], 10_000),
    git(worktree.path, ['status', '--porcelain'], 10_000),
    git(worktree.repository, ['status', '--porcelain', '--untracked-files=no'], 10_000),
    git(worktree.repository, ['rev-parse', 'HEAD'], 5000),
  ]);
  const [behind, ahead] = counts.split(/\s+/).map(Number);
  const merged = await git(worktree.repository, ['merge-base', '--is-ancestor', worktree.branch, current]).then(() => true, () => false);
  return { branch: worktree.branch, ahead: ahead || 0, behind: behind || 0, uncommitted: count(uncommitted), workspaceDirty: count(workspaceDirty), merged };
}

/** Merges the member branch into the group workspace's checked-out branch.
 * Refuses dirty trees; any conflict is aborted so the workspace is unchanged. */
export async function mergeWorktree(worktree: MemberWorktree, memberTitle: string): Promise<WorktreeStatus> {
  const before = await worktreeStatus(worktree);
  if (before.uncommitted) fail(`成员工作树还有 ${before.uncommitted} 处未提交改动，请让成员提交后再合并`);
  if (before.workspaceDirty) fail(`群工作区有 ${before.workspaceDirty} 处未提交改动，请先提交或暂存`);
  if (!before.ahead) fail('成员分支没有新的提交，无需合并');
  try { await git(worktree.repository, ['merge', '--no-ff', '--no-edit', '-m', `合并群聊成员 ${memberTitle} 的分支 ${worktree.branch}`, worktree.branch], 120_000); }
  catch (error) {
    const conflicts = await git(worktree.repository, ['diff', '--name-only', '--diff-filter=U']).catch(() => '');
    await git(worktree.repository, ['merge', '--abort']).catch(() => {});
    const detail = error instanceof Error ? error.message : '';
    fail(conflicts ? `合并冲突（${count(conflicts)} 个文件），已撤销本次合并，群工作区保持不变。请让成员先合并群工作区的最新改动再提交。` : `合并未完成，群工作区保持不变：${detail}`);
  }
  return worktreeStatus(worktree);
}

/** Removes the worktree directory only; the branch and its commits remain. */
export async function removeWorktree(worktree: MemberWorktree) {
  await git(worktree.repository, ['worktree', 'remove', worktree.path]);
}
