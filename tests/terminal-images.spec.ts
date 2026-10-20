import { test as demoTest } from './fixtures';
import { expect, test as baseTest } from '@playwright/test';
import type { AppState, Session } from '../shared/types';
import { Buffer } from 'node:buffer';

async function openDemoCodex(page: import('@playwright/test').Page, title = 'Dili · 开发笔记') {
  await page.goto('/');
  await page.getByRole('button', { name: `进入 ${title} 的会话`, exact: true }).click();
  await expect(page.getByRole('dialog', { name: `${title} 的私聊` })).toBeVisible();
  await expect(page.getByRole('button', { name: '原生终端', exact: true })).toHaveAttribute('aria-pressed', 'true');
}

demoTest('demo terminal keeps ordinary text paste available to the native terminal', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await openDemoCodex(page);
  await expect(page.locator('.terminal-connection')).toHaveText('已连接');
  const pasteWasNotCancelled = await page.locator('.terminal-pane').evaluate((element) => {
    const transfer = new DataTransfer();
    transfer.setData('text/plain', 'ordinary paste survives image handling');
    let reachedBubble = false;
    element.addEventListener('paste', event => { reachedBubble = !event.defaultPrevented; }, { once: true });
    const dispatched = element.dispatchEvent(new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData: transfer }));
    return dispatched && reachedBubble;
  });
  expect(pasteWasNotCancelled).toBe(true);
  await expect(page.getByRole('button', { name: '选择图片并填入原生输入' })).toHaveCount(0);
  await expect(page.locator('.terminal-image-input')).toHaveCount(0);
});

demoTest('demo Codex contacts never expose the native image bridge', async ({ page }) => {
  await openDemoCodex(page);
  await expect(page.getByRole('button', { name: '选择图片并填入原生输入' })).toHaveCount(0);
  await expect(page.locator('.terminal-image-input')).toHaveCount(0);
});

for (const backend of ['codex','claude','dsh'] as const) baseTest(`${backend} preserves concurrent typing while staging an image into the active PTY`, async ({ page }) => {
  const seed = await (await page.request.get('/api/state')).json() as AppState;
  const source = seed.sessions.find(session => session.backend === backend);
  expect(source).toBeTruthy();
  const contact: Session = {
    ...(source as Session), backend, id: 'codex-image-browser-test', title: 'Codex 图片桥接回归',
    running: true, status: 'idle', statusSource: 'process', statusDetail: '可继续',
    interactionMode: 'terminal', nativeSessionId: 'native-image-test', forkPending: false,
  };
  const state: AppState = {
    ...seed, demo: false, sessions: [contact], groups: [], activities: [],
    backends: seed.backends.map(backend => backend.id === contact.backend
      ? { ...backend, installed: true, capabilities: { ...backend.capabilities, terminal: true, nativeControl: true, graphicalChat: false } }
      : backend),
  };
  let release!: () => void;
  const pending = new Promise<void>(resolve => {release = resolve;});
  const upload: { headers: Record<string, string>; body: Buffer | null } = { headers: {}, body: null };
  await page.addInitScript(() => {
    const target = window as unknown as { terminalSockets: unknown[] };
    target.terminalSockets = [];
    class FakeSocket extends EventTarget {
      static readonly CONNECTING = 0;
      static readonly OPEN = 1;
      static readonly CLOSING = 2;
      static readonly CLOSED = 3;
      readonly url: string;
      readyState = FakeSocket.OPEN;
      onopen: ((event: Event) => void) | null = null;
      onmessage: ((event: MessageEvent) => void) | null = null;
      onerror: ((event: Event) => void) | null = null;
      onclose: ((event: CloseEvent) => void) | null = null;
      constructor(url: string | URL) {
        super(); this.url = String(url); target.terminalSockets.push(this);
        queueMicrotask(() => {
          this.onopen?.(new Event('open'));
          this.onmessage?.(new MessageEvent('message', { data: JSON.stringify({ type: 'ready', terminalId: 'test-generation' }) }));
        });
      }
      send(data: string) { const message = JSON.parse(data); if (message.type === 'input') ((window as unknown as {testInput:string[]}).testInput ??= []).push(message.data); }
      close() { this.readyState = FakeSocket.CLOSED; this.onclose?.(new CloseEvent('close')); }
    }
    Object.defineProperty(window, 'WebSocket', { configurable: true, value: FakeSocket });
    class FakeSource extends EventTarget {
      onopen: ((event: Event) => void) | null = null;
      onerror: ((event: Event) => void) | null = null;
      constructor() { super(); queueMicrotask(() => this.onopen?.(new Event('open'))); }
      close() {}
    }
    Object.defineProperty(window, 'EventSource', { configurable: true, value: FakeSource });
  });
  await page.route('**/api/state', route => route.fulfill({ json: state }));
  await page.route('**/api/config', route => route.fulfill({ json: { csrfToken: 'browser-image-token' } }));
  await page.route('**/api/sessions/'+contact.id+'/conversation',route=>route.fulfill({json:{messages:[],truncated:false}}));
  await page.route(`**/api/sessions/${contact.id}/read`, route => route.fulfill({ json: contact }));
  await page.route(`**/api/sessions/${contact.id}/terminal/image`, async route => {
    upload.headers = route.request().headers();
    upload.body = route.request().postDataBuffer();
    await pending;
    await route.fulfill({ json: { staged: true } });
  });
  await page.goto(`/#/contacts?session=${contact.id}`);
  await expect(page.getByRole('dialog', { name: `${contact.title} 的私聊` })).toBeVisible();
  await expect(page.locator('.terminal-connection')).toHaveText('已连接');
  const image = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64');
  await page.locator('.terminal-image-input').setInputFiles({ name: 'pixel.png', mimeType: 'image/png', buffer: image });
  await expect(page.locator('.terminal-image-status')).toContainText('正在把图片填入');
  await page.locator('.xterm-helper-textarea').focus();
  await page.keyboard.insertText('上传期间中文🙂');
  expect(await page.evaluate(() => (window as unknown as {testInput?:string[]}).testInput ?? [])).toEqual([]);
  release();
  await expect(page.locator('.terminal-image-status')).toContainText('图片已填入原生输入');
  await expect.poll(() => page.evaluate(() => (window as unknown as {testInput:string[]}).testInput.join(''))).toBe('上传期间中文🙂');
  expect(upload.headers['content-type']).toBe('image/png');
  expect(upload.headers['x-sessiondeck-terminal']).toBe('test-generation');
  expect(upload.headers['x-sessiondeck-token']).toBe('browser-image-token');
  expect(upload.body).toEqual(image);
  if(backend !== 'codex') {
    let staged: Record<string,unknown> | undefined;
    await page.route('**/api/sessions/'+contact.id+'/input',route=> {
      if(route.request().method() === 'GET') return route.fulfill({json:{generation:'test-generation'}});
      staged=route.request().postDataJSON(); return route.fulfill({json:{status:'accepted',staged:true}});
    });
    await page.getByRole('button',{name:'对话记录',exact:true}).click();
    await page.getByLabel('原生会话消息草稿').fill('中文任务 **解释**');
    const composerHeight = page.getByRole('separator', { name: '调整输入区高度', exact: true });
    const originalHeight = Number(await composerHeight.getAttribute('aria-valuenow'));
    await composerHeight.focus(); await composerHeight.press('ArrowUp');
    expect(Number(await composerHeight.getAttribute('aria-valuenow'))).toBe(originalHeight + 24);
    const composerWidth = page.getByRole('separator', { name: '调整输入区右侧宽度', exact: true });
    await composerWidth.focus(); await composerWidth.press('ArrowLeft');
    await expect(page.getByLabel('原生会话消息草稿')).toHaveValue('中文任务 **解释**');
    await page.getByRole('button',{name:'Markdown 预览',exact:true}).click();
    await expect(page.getByLabel('消息 Markdown 预览').locator('strong')).toHaveText('解释');
    await page.getByRole('button',{name:'填入原生终端',exact:true}).click();
    await expect(page.getByRole('button',{name:'原生终端',exact:true})).toHaveAttribute('aria-pressed','true');
    expect(staged?.text).toBe('中文任务 **解释**'); expect(staged?.generation).toBe('test-generation');
    expect(staged?.requestId).toBeTruthy();
    await page.getByRole('button',{name:'对话记录',exact:true}).click();
    await expect(page.getByLabel('原生会话消息草稿')).toHaveValue('');
  }
});
