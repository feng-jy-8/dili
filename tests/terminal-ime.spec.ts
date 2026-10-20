import type { AppState, Session } from '../shared/types';
import { mutationHeaders } from './fixtures';
import { test } from './fixtures';
import { expect, type Page } from '@playwright/test';

test('native tools share the title row, fullscreen keeps the terminal and mobile tools remain reachable', async ({ page }) => {
  let connections = 0;
  page.on('websocket', socket => { if (socket.url().includes('/api/terminal/')) connections++; });
  await page.goto('/');
  await page.getByRole('button', { name: '进入 Dili · 开发笔记 的会话', exact: true }).click();
  await expect(page.locator('.drawer-header .terminal-connection.connected')).toHaveCount(1);
  await expect(page.locator('.session-conversation .terminal-toolbar')).toHaveCount(0);
  const terminal = await page.locator('.xterm').elementHandle();
  const before = connections;
  const header = (await page.locator('.drawer-header').boundingBox())!;
  const pane = (await page.locator('.terminal-pane').boundingBox())!;
  expect(pane.y).toBeCloseTo(header.y + header.height, 0);
  await page.getByRole('button', { name: '全屏会话', exact: true }).click();
  await expect(page.locator('.session-drawer')).toHaveClass(/session-fullscreen/);
  const input = page.locator('.xterm-helper-textarea');
  await input.focus(); await input.press('Control+Shift+Enter');
  await expect(page.locator('.session-drawer')).not.toHaveClass(/session-fullscreen/);
  expect(await terminal!.evaluate(element => element.isConnected)).toBe(true);
  expect(connections).toBe(before);
  await page.setViewportSize({ width: 390, height: 844 });
  const tools = page.getByRole('button', { name: '会话工具', exact: true });
  await tools.click();
  await expect(page.getByRole('button', { name: '粘贴到终端', exact: true })).toBeInViewport();
  await page.getByRole('button', { name: '显示输入栏', exact: true }).click();
  await expect(tools).toHaveAttribute('aria-expanded', 'false');
  await page.getByLabel('终端输入栏').fill('保留草稿');
  await tools.click(); await page.keyboard.press('Escape');
  await expect(tools).toBeFocused();
  await expect(page.locator('.session-drawer')).toBeVisible();
  await page.getByRole('button', { name: '全屏会话', exact: true }).click();
  await expect(page.getByLabel('终端输入栏')).toHaveValue('保留草稿');
  await expect(page.locator('.session-conversation .terminal-toolbar')).toHaveCount(0);
  expect(connections).toBe(before);
  await tools.click();
  await page.screenshot({ path: 'artifacts/unified-native-mobile-tools.png' });
});

/**
 * Drives xterm's hidden textarea the way Linux IMEs (fcitx/ibus in Chromium)
 * do. Playwright cannot run a real IME, so its delivery paths are replayed
 * as browser text insertion / DOM events and outgoing input frames are observed.
 */
function observeInput(page: Page) {
  const sent: string[] = [];
  page.on('websocket', socket => {
    if (!socket.url().includes('/api/terminal/')) return;
    socket.on('framesent', ({ payload }) => {
      try { const message = JSON.parse(String(payload)); if (message.type === 'input') sent.push(message.data); } catch { /* non-JSON frame */ }
    });
  });
  return sent;
}

for (const backend of ['codex', 'claude', 'dsh'] as const) test(`${backend}: IME commits send whole phrases and emoji once, with ordinary keys still working`, async ({ page }) => {
  const sent = observeInput(page);
  const seed = await (await page.request.get('/api/state')).json() as AppState;
  const response = await page.request.post('/api/sessions', {headers:await mutationHeaders(page.request),data:{backend,title:'输入回归 ' + backend,cwd:seed.defaultCwd}});
  expect(response.ok()).toBe(true);
  const contact = await response.json() as Session;
  await page.request.post(`/api/sessions/${contact.id}/start`,{headers:await mutationHeaders(page.request),data:{}});
  await page.goto(`/#/contacts?session=${contact.id}`);
  await expect(page.locator('.terminal-connection')).toHaveText('已连接');
  const textarea = page.locator('.xterm-helper-textarea');
  await textarea.focus();
  // Some IMEs deliver a finished phrase with insertText and no keydown or
  // composition lifecycle. Use Chromium's real text insertion path.
  await page.keyboard.insertText('中文多字输入🙂');
  await expect.poll(() => sent.join('')).toBe('中文多字输入🙂');
  await page.keyboard.insertText('继续输入第二句');
  await expect.poll(() => sent.join('')).toBe('中文多字输入🙂继续输入第二句');
  await textarea.press('a');
  await textarea.press('2');
  await expect.poll(() => sent.join('')).toBe('中文多字输入🙂继续输入第二句a2');
  await page.keyboard.insertText('普通按键后的中文');
  await expect.poll(() => sent.join('')).toBe('中文多字输入🙂继续输入第二句a2普通按键后的中文');
});

test('IME text committed straight into the textarea and candidates picked with a digit both reach the terminal', async ({ page }) => {
  const sent = observeInput(page);
  await page.goto('/');
  await page.getByRole('button', { name: '进入 Dili · 开发笔记 的会话', exact: true }).click();
  await expect(page.locator('.terminal-connection')).toHaveText('已连接');
  const textarea = page.locator('.xterm-helper-textarea');
  await textarea.focus();

  // Path 1: no composition events; the IME commits text and Chromium reports
  // keyCode 229. xterm diffs the textarea on the next tick.
  await textarea.evaluate((element: HTMLTextAreaElement) => {
    const event = new KeyboardEvent('keydown', { key: 'Process', bubbles: true, cancelable: true });
    Object.defineProperty(event, 'keyCode', { get: () => 229 });
    element.dispatchEvent(event);
    element.value += '中文';
  });
  await expect.poll(() => sent.join('')).toContain('中文');

  // Path 2: a real composition where "1" picks the first candidate. The digit
  // must not be typed; the chosen phrase arrives at compositionend.
  const before = sent.length;
  await textarea.evaluate((element: HTMLTextAreaElement) => {
    element.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true, data: '' }));
    element.value += 'nihaoshijie';
    element.dispatchEvent(new CompositionEvent('compositionupdate', { bubbles: true, data: 'nihaoshijie' }));
  });
  await page.waitForTimeout(30);
  await textarea.evaluate((element: HTMLTextAreaElement) => {
    const digit = new KeyboardEvent('keydown', { key: '1', code: 'Digit1', isComposing: true, bubbles: true, cancelable: true });
    Object.defineProperty(digit, 'keyCode', { get: () => 49 });
    element.dispatchEvent(digit);
    element.value = element.value.replace(/nihaoshijie$/, '你好世界');
    element.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true, data: '你好世界' }));
  });
  await expect.poll(() => sent.slice(before).join('')).toBe('你好世界');

  // Plain keys outside a composition are unaffected.
  await textarea.press('2');
  await expect.poll(() => sent.slice(before).join('')).toBe('你好世界2');
});

test('on touch devices Chinese goes through the composer and reaches the terminal exactly once', async ({ browser }) => {
  const context = await browser.newContext({ hasTouch: true, isMobile: true, viewport: { width: 390, height: 844 } });
  const page = await context.newPage();
  try {
    const sent = observeInput(page);
    await page.goto('/');
    await page.getByRole('button', { name: '进入 Dili · 开发笔记 的会话', exact: true }).click();
    await expect(page.locator('.terminal-connection')).toHaveText('已连接');
    // The hidden xterm textarea never raises the on-screen keyboard here.
    await expect(page.locator('.xterm-helper-textarea')).toHaveAttribute('inputmode', 'none');
    const composer = page.getByLabel('终端输入栏');
    await expect(composer).toBeVisible();
    await composer.fill('你好 世界');
    await composer.press('Enter');
    await expect.poll(() => sent.join('')).toContain('你好 世界');
    await expect.poll(() => sent.join('')).toMatch(/你好 世界[^]*\r/);
    expect(sent.join('').split('你好 世界').length).toBe(2);
    await expect(composer).toHaveValue('');
    // Multi-line text is one bracketed paste, then a single Enter.
    await composer.fill('第一行\n第二行');
    await composer.press('Enter');
    await expect.poll(() => sent.join('')).toContain('第一行');
    expect(sent.join('').split('第一行').length).toBe(2);
    await page.getByRole('button', { name: '发送 Esc', exact: true }).click();
    await expect.poll(() => sent.at(-1)).toBe('\x1b');
  } finally { await context.close(); }
});


test('native clipboard paste preserves multiline Unicode once and copy gives feedback', async ({page,context}) => {
  await context.grantPermissions(['clipboard-read','clipboard-write']);
  const sent = observeInput(page);
  await page.goto('/');
  await page.getByRole('button',{name:'进入 Dili · 开发笔记 的会话',exact:true}).click();
  await expect(page.locator('.terminal-connection')).toHaveText('已连接');
  const value = '复制粘贴🙂\n第二行';
  await page.evaluate(text=>navigator.clipboard.writeText(text),value);
  await page.getByRole('button',{name:'粘贴到终端',exact:true}).click();
  await expect.poll(()=>sent.join('')).toContain(value.replace(/\n/g,'\r'));
  expect(sent.join('').split('复制粘贴🙂').length).toBe(2);
  await page.getByRole('button',{name:'复制选中的终端内容',exact:true}).click();
  await expect(page.locator('.terminal-error')).toContainText('先在终端中选中');
});
