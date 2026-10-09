import { expect } from '@playwright/test';
import { test, mutationHeaders } from './fixtures';
import type { Scratchpad } from '../shared/scratchpad';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Session } from '../shared/types';

test('theme picker colors the entire workbench and native terminal live, with persistence', async ({ page, request }) => {
  await page.emulateMedia({ colorScheme: 'light' });
  const initial = await (await request.get('/api/scratchpad')).json() as Scratchpad;
  expect((await request.patch('/api/scratchpad', { headers: await mutationHeaders(request), data: { ...initial, content: '# 工作清单\n\n- [ ] 验证新主题\n- [x] 随手记录想法\n\n```ts\nconst theme = "dark";\n```' } })).ok()).toBe(true);
  let connections = 0;
  page.on('websocket', socket => { if (socket.url().includes('/api/terminal/')) connections++; });
  await page.goto('/');
  await page.getByRole('button', { name: '进入 SessionDeck · 开发笔记 的会话', exact: true }).click();
  await expect(page.locator('.terminal-connection.connected')).toHaveCount(1);
  const terminal = page.locator('.xterm');
  const handle = await terminal.elementHandle();
  const count = connections;
  await page.getByRole('button', { name: '打开随手记', exact: true }).click();
  const note = page.getByRole('complementary', { name: '随手记', exact: true });
  await expect(note.getByRole('textbox')).toBeEnabled();
  await note.getByRole('button', { name: '预览', exact: true }).click();
  for (const [name, theme, color] of [
    ['沉静深色', 'dark', 'rgb(25, 29, 36)'],
    ['柔和暖色', 'warm', 'rgb(255, 253, 248)'],
    ['简洁浅色', 'light', 'rgb(255, 255, 255)'],
  ]) {
    await page.getByRole('button', { name: '切换主题', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: '外观主题', exact: true });
    const option = dialog.getByRole('radio', { name: new RegExp(name) });
    await option.click();
    await expect(option).toHaveAttribute('aria-checked', 'true');
    await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
    await expect(note).toHaveCSS('background-color', color);
    await expect(terminal.locator('.xterm-scrollable-element')).toHaveCSS('background-color', color);
    await dialog.getByRole('button', { name: '完成', exact: true }).click();
    await page.screenshot({ path: `artifacts/workbench-theme-${theme}.png` });
  }
  expect(connections).toBe(count);
  expect(await handle!.evaluate(element => element.isConnected)).toBe(true);
  await page.getByRole('button', { name: '切换主题', exact: true }).click();
  await page.getByRole('radio', { name: /沉静深色/ }).click();
  await page.getByRole('button', { name: '完成', exact: true }).click();
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await expect(note).toHaveCSS('background-color', 'rgb(25, 29, 36)');
  await expect(note.getByRole('textbox')).toHaveValue(/工作清单/);
});

test('system preference follows OS changes; a manual choice stays fixed and synchronizes across tabs', async ({ page, context }) => {
  await page.emulateMedia({ colorScheme: 'light' });
  await page.goto('/');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await page.emulateMedia({ colorScheme: 'dark' });
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await page.getByRole('button', { name: '切换主题', exact: true }).click();
  await page.getByRole('radio', { name: /柔和暖色/ }).click();
  await page.emulateMedia({ colorScheme: 'light' });
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'warm');
  const second = await context.newPage();
  await second.goto('/');
  await expect(second.locator('html')).toHaveAttribute('data-theme', 'warm');
  await page.getByRole('radio', { name: /简洁浅色/ }).click();
  await expect(second.locator('html')).toHaveAttribute('data-theme', 'light');
  // Keyboard navigation selects the next radio and applies it immediately.
  await page.getByRole('radio', { name: /简洁浅色/ }).focus();
  await page.keyboard.press('ArrowRight');
  await expect(page.getByRole('radio', { name: /柔和暖色/ })).toHaveAttribute('aria-checked', 'true');
  await second.close();
});

test('mobile theme controls stay reachable from contacts and from a session', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await page.getByRole('button', { name: '更多', exact: true }).click();
  await page.getByRole('menuitem', { name: '外观主题' }).click();
  const dialog = page.getByRole('dialog', { name: '外观主题', exact: true });
  await dialog.getByRole('radio', { name: /沉静深色/ }).click();
  await page.screenshot({ path: 'artifacts/theme-picker-mobile.png' });
  await dialog.getByRole('button', { name: '完成', exact: true }).click();
  await page.getByRole('button', { name: '进入 SessionDeck · 开发笔记 的会话', exact: true }).click();
  await page.locator('summary').filter({ hasText: '会话信息' }).click();
  await page.getByRole('button', { name: '随手记', exact: true }).click();
  const note = page.getByRole('complementary', { name: '随手记', exact: true });
  await expect(note).toBeVisible();
  await expect(note).toHaveCSS('background-color', 'rgb(25, 29, 36)');
  await note.getByRole('button', { name: '预览', exact: true }).click();
  await page.screenshot({ path: 'artifacts/scratchpad-mobile-dark.png' });
  await note.getByRole('button', { name: '关闭随手记' }).click();
  await page.getByRole('button', { name: '外观主题', exact: true }).click();
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('radio', { name: /沉静深色/ })).toHaveAttribute('aria-checked', 'true');
});

test('dark theme keeps file previews and Git changes readable beside a note', async ({ page, request }) => {
  const directory = await mkdtemp(join(tmpdir(), 'sessiondeck-theme-preview-'));
  const git = (args: string[]) => promisify(execFile)('git', args, { cwd: directory });
  try {
    await writeFile(join(directory, 'README.md'), '# Theme preview\n\n```ts\nconst theme = "light";\n```\n');
    await git(['init', '-q']); await git(['add', '.']);
    await git(['-c', 'user.name=Theme test', '-c', 'user.email=theme@example.invalid', '-c', 'commit.gpgSign=false', 'commit', '-qm', 'initial']);
    await writeFile(join(directory, 'README.md'), '# Theme preview\n\n```ts\nconst theme = "dark";\n```\n');
    const response = await request.post('/api/sessions', { headers: await mutationHeaders(request), data: { title: '主题预览验收', backend: 'codex', cwd: directory } });
    expect(response.ok()).toBe(true); const session = await response.json() as Session;
    await page.setViewportSize({ width: 1900, height: 1000 });
    await page.goto('/');
    await page.getByRole('button', { name: '切换主题', exact: true }).click();
    await page.getByRole('radio', { name: /沉静深色/ }).click();
    await page.getByRole('button', { name: '完成', exact: true }).click();
    await page.getByRole('button', { name: `进入 ${session.title} 的会话`, exact: true }).click();
    await page.getByRole('button', { name: '打开资源管理器', exact: true }).click();
    const explorer = page.getByRole('complementary', { name: '资源管理器', exact: true });
    await explorer.getByRole('button', { name: /README\.md/ }).click();
    await expect(explorer.getByRole('heading', { name: 'Theme preview' })).toBeVisible();
    await expect(explorer.locator('.markdown-code')).toHaveCSS('background-color', 'rgb(32, 37, 46)');
    await expect(explorer.locator('.hljs-keyword')).toHaveCSS('color', 'rgb(255, 172, 181)');
    await explorer.getByRole('button', { name: /^Git diff/ }).click();
    await explorer.getByRole('button', { name: /README\.md/ }).click();
    await expect(explorer.locator('td.diff-code.diff-added')).toHaveCSS('background-color', 'rgb(30, 53, 40)');
    await expect(explorer.locator('td.diff-code.diff-removed')).toHaveCSS('background-color', 'rgb(58, 37, 41)');
    await expect(explorer.locator('td.diff-code.diff-added')).toHaveCSS('color', 'rgb(225, 231, 239)');
    await page.getByRole('button', { name: '打开随手记', exact: true }).click();
    await page.screenshot({ path: 'artifacts/workbench-dark-explorer.png' });
    const note = page.getByRole('complementary', { name: '随手记', exact: true });
    const explorerBounds = (await explorer.boundingBox())!;
    const noteBounds = (await note.boundingBox())!;
    expect(explorerBounds.x + explorerBounds.width).toBeLessThan(noteBounds.x);
    // With all panels open on a laptop, the note floats rather than consuming
    // the last pixels available to the conversation and contact list.
    await page.setViewportSize({ width: 1440, height: 1000 });
    await expect(note).toHaveCSS('position', 'absolute');
    const main = page.locator('.app-main');
    const widthWithNote = (await main.boundingBox())!.width;
    await note.getByRole('button', { name: '关闭随手记' }).click();
    expect(Math.abs((await main.boundingBox())!.width - widthWithNote)).toBeLessThan(1);
  } finally { await rm(directory, { recursive: true, force: true }); }
});
