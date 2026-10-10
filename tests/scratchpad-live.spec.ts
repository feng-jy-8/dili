import { expect, type Page, type APIRequestContext } from '@playwright/test';
import { test, mutationHeaders } from './fixtures';
import type { Scratchpad } from '../shared/scratchpad';

const read = async (request: APIRequestContext) => (await (await request.get('/api/scratchpad')).json()) as Scratchpad;
async function seed(request: APIRequestContext, content: string) {
  const current = await read(request);
  expect((await request.patch('/api/scratchpad', { headers: await mutationHeaders(request), data: { ...current, content } })).ok()).toBe(true);
  return read(request);
}
async function open(page: Page) {
  await page.goto('/');
  await page.getByRole('button', { name: '打开随手记', exact: true }).click();
  const panel = page.getByRole('complementary', { name: '随手记', exact: true });
  const editor = panel.getByRole('textbox', { name: '随手记实时编辑' });
  await expect(editor).toBeVisible();
  return { panel, editor };
}
async function paste(page: Page, text: string, html = '') {
  await page.getByRole('textbox', { name: '随手记实时编辑' }).evaluate((element, { text, html }) => {
    const data = new DataTransfer(); data.setData('text/plain', text);
    if (html) data.setData('text/html', html);
    element.dispatchEvent(new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData: data }));
  }, { text, html });
}

test('live Markdown renders without rewriting source; typing survives save acknowledgements and reload', async ({ page, request }) => {
  const content = '# 今天\n\n**重要**\n\n- [ ] 工作\n\n| 项目 | 状态 |\n| --- | --- |\n| 记录 | 进行中 |\n';
  const initial = await seed(request, content);
  const { panel, editor } = await open(page);
  await expect(editor.locator('h1')).toContainText('今天');
  await expect(editor.locator('strong')).toHaveText('重要');
  await expect(editor.locator('table')).toBeVisible();
  await expect(editor.getByRole('checkbox')).not.toBeChecked();
  await panel.getByRole('button', { name: '源码', exact: true }).click();
  await expect(panel.getByRole('textbox', { name: '随手记内容' })).toHaveValue(content);
  await panel.getByRole('button', { name: '实时', exact: true }).click();
  await expect(editor).toBeVisible();
  expect((await read(request)).revision).toBe(initial.revision);
  const handle = await editor.elementHandle();
  await editor.press('Control+End'); await page.keyboard.press('Enter'); await page.keyboard.insertText('继续记录');
  await expect.poll(async () => (await read(request)).content).toContain('继续记录');
  expect(await handle!.evaluate(element => element.isConnected)).toBe(true);
  await expect(editor).toBeFocused();
  await page.keyboard.insertText('，保持光标');
  await panel.getByRole('button', { name: '关闭随手记' }).click();
  await expect.poll(async () => (await read(request)).content).toContain('继续记录，保持光标');
  await page.reload();
  await page.getByRole('button', { name: '打开随手记', exact: true }).click();
  await expect(editor).toContainText('继续记录，保持光标');
  await page.screenshot({ path: 'artifacts/scratchpad-live-desktop.png' });
});

test('Markdown paste, nested tasks, clear/restore and keyboard undo preserve saved notes', async ({ page, request }) => {
  await seed(request, '');
  const { panel, editor } = await open(page);
  await editor.click();
  await paste(page, '# 计划\n\n**重点**\n\n- [ ] 第一项\n  - [ ] 子任务\n');
  await expect(editor.locator('h1')).toContainText('计划');
  await expect(editor.locator('strong')).toContainText('重点');
  await expect.poll(async () => (await read(request)).content).toContain('子任务');
  await editor.getByRole('checkbox').nth(1).check();
  await expect.poll(async () => (await read(request)).content).toMatch(/\[[xX]\]\s+子任务/);
  await panel.getByRole('button', { name: '清空随手记' }).click();
  await panel.getByRole('button', { name: '确认清空' }).click();
  await expect.poll(async () => (await read(request)).content).toBe('');
  await expect(editor).not.toContainText('计划');
  await panel.getByRole('button', { name: '撤销', exact: true }).click();
  await expect(editor.locator('h1')).toContainText('计划');
  await expect.poll(async () => (await read(request)).content).toContain('子任务');
  await editor.press('Control+End'); await page.keyboard.press('Enter');
  await page.keyboard.insertText('删除此行');
  await expect.poll(async () => (await read(request)).content).toContain('删除此行');
  await editor.press('Control+z');
  await expect.poll(async () => (await read(request)).content).not.toContain('删除此行');
});

test('live editor preserves drafts through offline conflict resolution and theme changes', async ({ page, request }) => {
  await seed(request, '# 初始\n');
  const { panel, editor } = await open(page);
  await page.route('**/api/scratchpad', route => route.request().method() === 'PATCH' ? route.abort() : route.continue());
  await editor.press('Control+End'); await page.keyboard.insertText('我的草稿');
  await expect(panel.getByRole('status')).toHaveText('保存未完成');
  await page.reload();
  await expect(editor).toContainText('我的草稿');
  // Recovery schedules an autosave. Let that offline attempt settle before
  // restoring PATCH requests, otherwise it can discover the conflict itself
  // and remove the retry button before this test clicks it.
  await expect(panel.getByRole('status')).toHaveText('保存未完成');
  await seed(request, '# 其他设备更新\n');
  await page.unroute('**/api/scratchpad');
  await panel.getByRole('button', { name: '重试', exact: true }).click();
  await expect(panel.getByRole('status')).toHaveText('需要核对');
  await panel.getByRole('button', { name: '使用最新内容' }).click();
  await expect(editor.locator('h1')).toContainText('其他设备更新');
  const revision = (await read(request)).revision;
  const handle = await editor.elementHandle();
  await page.getByRole('button', { name: '切换主题', exact: true }).click();
  await page.getByRole('radio', { name: /沉静深色/ }).click();
  await page.getByRole('button', { name: '完成', exact: true }).click();
  await expect(editor).toHaveCSS('color', 'rgb(225, 231, 239)');
  expect(await handle!.evaluate(element => element.isConnected)).toBe(true);
  expect((await read(request)).revision).toBe(revision);
  await page.screenshot({ path: 'artifacts/scratchpad-live-dark.png' });
  await panel.getByRole('button', { name: '撤销', exact: true }).click();
  await expect(editor).toContainText('我的草稿');
  await expect(panel.getByRole('status')).toHaveText('已保存');
});

test('editor resources stay local; image and HTML source cannot load remote content or execute', async ({ page, request }) => {
  const content = '# 安全记录\n\n![示例](https://example.invalid/image.png)\n\n<img src="https://example.invalid/raw.png" onerror="window.pwned=1">\n\n<iframe src="https://example.invalid/frame"></iframe>\n\n```plantuml\nAlice -> Bob: hello\n```\n';
  const initial = await seed(request, content);
  const external: string[] = [];
  page.on('request', req => { if (/^https?:/.test(req.url()) && new URL(req.url()).hostname !== '127.0.0.1') external.push(req.url()); });
  const { panel, editor } = await open(page);
  await expect(editor.locator('img, iframe, script')).toHaveCount(0);
  expect((await read(request)).revision).toBe(initial.revision);
  await editor.press('Control+End'); await page.keyboard.press('Enter');
  await paste(page, '粘贴文本', '<img src="https://example.invalid/paste.png" onerror="window.pwned=1">');
  await expect.poll(async () => (await read(request)).content).toContain('粘贴文本');
  expect((await read(request)).content).toContain('![示例](https://example.invalid/image.png)');
  expect((await read(request)).content).toContain('<img src="https://example.invalid/raw.png" onerror="window.pwned=1">');
  expect(await page.evaluate(() => 'pwned' in window)).toBe(false);
  expect(external).toEqual([]);
  await panel.getByRole('button', { name: '源码', exact: true }).click();
  await expect(panel.getByRole('textbox')).toHaveValue(/example.invalid/);
});

test('mobile live typing defers Chinese composition saves and rejects oversized edits', async ({ page, request }) => {
  await seed(request, '');
  await page.setViewportSize({ width: 390, height: 844 });
  const { panel, editor } = await open(page);
  await expect(editor).toHaveCSS('font-size', '16px');
  await editor.click();
  const initial = await read(request);
  await editor.evaluate(element => {
    element.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }));
    element.textContent = '拼音候选';
    element.dispatchEvent(new InputEvent('input', { bubbles: true, isComposing: true, inputType: 'insertCompositionText' }));
  });
  await page.waitForTimeout(800);
  expect((await read(request)).revision).toBe(initial.revision);
  await editor.evaluate(element => {
    element.textContent = '中文输入';
    element.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true, data: '中文输入' }));
  });
  await expect.poll(async () => (await read(request)).content).toContain('中文输入');
  await editor.press('Control+End');
  await paste(page, 'a'.repeat(30_001));
  await expect(panel.getByRole('alert')).toContainText('超出限制');
  await expect(editor).toContainText('中文输入');
  await expect(panel.getByRole('status')).toHaveText('已保存');
  expect((await read(request)).content.length).toBeLessThan(30_000);
  await page.screenshot({ path: 'artifacts/scratchpad-live-mobile.png' });
});

test('parser load failure keeps source editing available', async ({ page, request }) => {
  await seed(request, '# 保留笔记\n');
  await page.route('**/lute.min-*.js', route => route.abort());
  await page.goto('/');
  await page.getByRole('button', { name: '打开随手记', exact: true }).click();
  const panel = page.getByRole('complementary', { name: '随手记', exact: true });
  await expect(panel.getByRole('alert')).toContainText('编辑器资源加载失败');
  await panel.getByRole('button', { name: '源码', exact: true }).click();
  await expect(panel.getByRole('textbox')).toHaveValue('# 保留笔记\n');
});
