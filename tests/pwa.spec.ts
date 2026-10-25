import { expect } from '@playwright/test';
import { test } from './fixtures';
import { createServer, request as httpRequest } from 'node:http';
import type { AddressInfo } from 'node:net';

// PWA assertions require actual workers even in the standard UI regression run.
test.use({ serviceWorkers: 'allow' });

for (const width of [1440, 412, 390]) test(`machine launcher pairs, persists and opens contacts at ${width}px`, async ({ page, baseURL }) => {
  await page.setViewportSize({ width, height: 844 });
  await page.goto('/#/machines');
  await expect(page.getByRole('heading', { name: '我的机器' })).toBeVisible();
  await expect(page.locator('.machine-card')).toHaveCount(0);
  await page.getByRole('button', { name: '添加机器', exact: true }).click();
  await page.getByLabel('机器链接').fill(baseURL!);
  await page.getByLabel('名称（可选）').fill('工作电脑');
  await page.getByRole('button', { name: '下一步：验证机器' }).click();
  await expect(page.getByRole('heading', { name: '机器已验证' })).toBeVisible();
  await page.getByRole('link', { name: '完成连接，返回机器列表' }).click();
  await expect(page.locator('.machine-card')).toContainText('工作电脑');
  await page.reload();
  await expect(page.locator('.machine-card')).toHaveCount(1);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.getByRole('link', { name: /工作电脑/ }).click();
  await expect(page.getByRole('main', { name: '联系人列表' })).toBeVisible();
  await page.getByRole('link', { name: '机器', exact: true }).click();
  await expect(page.locator('.machine-card')).toHaveCount(1);
  page.once('dialog', dialog => dialog.accept());
  await page.getByRole('button', { name: '移除 工作电脑' }).click();
  await expect(page.locator('.machine-card')).toHaveCount(0);
});

test('launcher rejects credential URLs and unsolicited pairing callbacks', async ({ page }) => {
  await page.goto('/#/machines?paired=https%3A%2F%2Fevil.example%2F');
  await expect(page.locator('.machine-card')).toHaveCount(0);
  await page.getByRole('button', { name: '添加机器' }).click();
  await page.getByLabel('机器链接').fill('https://user:password@example.com/');
  await page.getByRole('button', { name: '下一步：验证机器' }).click();
  await expect(page.getByRole('alert')).toContainText('不含密码');
  expect(await page.evaluate(() => localStorage.getItem('dili.machines.v1'))).toBeNull();
});

test('installed shell opens offline and never caches APIs', async ({ page, baseURL }) => {
  // Cut a real network connection: WebKit's emulated offline mode can fail
  // navigation before dispatching the Service Worker fetch event.
  const proxy = createServer((incoming, outgoing) => {
    const upstream = httpRequest(new URL(incoming.url!, baseURL), response => {
      outgoing.writeHead(response.statusCode!, response.headers); response.pipe(outgoing);
    });
    upstream.on('error', () => { outgoing.writeHead(502); outgoing.end(); });
    incoming.pipe(upstream);
  });
  await new Promise<void>(resolve => proxy.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${(proxy.address() as AddressInfo).port}`;
  try {
  await page.goto(`${origin}/#/machines`);
  const manifest = await (await page.request.get('/manifest.webmanifest')).json();
  expect(manifest.start_url).toContain('#/machines');
  expect(manifest.icons.some((icon: { sizes: string }) => icon.sizes === '512x512')).toBe(true);
  await page.evaluate(async () => { await navigator.serviceWorker.ready; });
  await page.reload();
  await expect.poll(() => page.evaluate(() => !!navigator.serviceWorker.controller)).toBe(true);
  await page.evaluate(async () => { await fetch('/api/state'); });
  const cached = await page.evaluate(async () => (await Promise.all((await caches.keys()).map(async key => (await (await caches.open(key)).keys()).map(request => request.url)))).flat());
  expect(cached.some(url => url.includes('/api/'))).toBe(false);
  proxy.closeAllConnections();
  await new Promise<void>((resolve, reject) => proxy.close(error => error ? reject(error) : resolve()));
  await page.reload();
  await expect(page.getByRole('heading', { name: '我的机器' })).toBeVisible();
  } finally { if (proxy.listening) { proxy.closeAllConnections(); await new Promise<void>(resolve => proxy.close(() => resolve())); } }
});

test.describe('password flow with deterministic authentication responses', () => {
  test.use({ serviceWorkers: 'block' });
test('pairing prompts for the target password without persisting it and supports multiple machines', async ({ page, baseURL }) => {
  const owner = await (await page.request.get('/api/auth/status')).json();
  await page.addInitScript(() => localStorage.setItem('dili.machines.v1', JSON.stringify([{ name: '另一台机器', url: 'https://second.example/' }])));
  let password = '';
  await page.route('**/api/auth/status', route => route.fulfill({ json: { kind: 'anonymous', passwordSet: true } }));
  await page.route('**/api/auth/login', route => {
    password = route.request().postDataJSON().password;
    return route.fulfill({ json: owner });
  });
  await page.goto('/#/machines');
  await page.getByRole('button', { name: '添加机器' }).click();
  await page.getByLabel('机器链接').fill(baseURL!);
  await page.getByRole('button', { name: '下一步：验证机器' }).click();
  await page.getByLabel('所有者密码').fill('test-only-machine-secret');
  await page.getByRole('button', { name: '登录', exact: true }).click();
  expect(password).toBe('test-only-machine-secret');
  await page.getByRole('link', { name: '完成连接，返回机器列表' }).click();
  await expect(page.locator('.machine-card')).toHaveCount(2);
  expect(await page.evaluate(() => JSON.stringify({ ...localStorage, ...sessionStorage }))).not.toContain(password);
});

});

test('a machine on another origin returns to the launcher and opens its own contacts', async ({ page, baseURL }) => {
  const proxy = createServer((incoming, outgoing) => {
    const upstream = httpRequest(new URL(incoming.url!, baseURL), response => {
      outgoing.writeHead(response.statusCode!, response.headers); response.pipe(outgoing);
    });
    upstream.on('error', () => { outgoing.writeHead(502); outgoing.end(); });
    incoming.pipe(upstream);
  });
  await new Promise<void>(resolve => proxy.listen(0, '127.0.0.1', resolve));
  const target = `http://127.0.0.1:${(proxy.address() as AddressInfo).port}/`;
  try {
    await page.goto('/#/machines');
    await page.getByRole('button', { name: '添加机器' }).click();
    await page.getByLabel('机器链接').fill(target);
    await page.getByLabel('名称（可选）').fill('远程机器');
    await page.getByRole('button', { name: '下一步：验证机器' }).click();
    await expect(page.getByRole('heading', { name: '机器已验证' })).toBeVisible();
    expect(new URL(page.url()).origin).toBe(new URL(target).origin);
    await page.getByRole('link', { name: '完成连接，返回机器列表' }).click();
    await expect(page.locator('.machine-card')).toContainText('远程机器');
    expect(new URL(page.url()).origin).toBe(new URL(baseURL!).origin);
    await page.getByRole('link', { name: /远程机器/ }).click();
    await expect(page.getByRole('main', { name: '联系人列表' })).toBeVisible();
    expect(new URL(page.url()).origin).toBe(new URL(target).origin);
  } finally { proxy.closeAllConnections(); await new Promise<void>(resolve => proxy.close(() => resolve())); }
});
