import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';

test('relay bandwidth dashboard requires login, renders rates and pressure, and fits mobile', async ({ page }) => {
  await page.route('**/connect/', route => route.fulfill({ contentType: 'text/html', body: readFileSync('relay/index.html', 'utf8') }));
  await page.route('**/connect/api/admin/**', route => {
    if (route.request().headers().authorization !== 'Bearer dashboard-fixture') return route.fulfill({ status: 401, json: { error: '管理密钥不正确' } });
    if (route.request().url().endsWith('/state')) return route.fulfill({ json: { devices: [], invites: [], requests: [], domains: ['example.com'] } });
    const at = Date.now();
    return route.fulfill({ json: { available: true, sampledAt: at, interfaces: ['eth0'], capacityMbps: 10, current: { at, inbound: 125000, outbound: 1125000 }, history: [{ at: at - 5000, inbound: 100000, outbound: 100000 }, { at, inbound: 125000, outbound: 1125000 }] } });
  });
  await page.goto('/connect/');
  await expect(page.getByRole('region', { name: '服务器带宽仪表盘' })).toBeHidden();
  await page.getByLabel('管理密钥', { exact: true }).fill('dashboard-fixture');
  await page.getByRole('button', { name: '进入管理', exact: true }).click();
  await expect(page.locator('#bandwidthIn')).toHaveText('1.00 Mbps');
  await expect(page.locator('#bandwidthOut')).toHaveText('9.00 Mbps');
  await expect(page.locator('#bandwidthPressure')).toHaveText('90.0%');
  await expect(page.locator('#bandwidthPressure')).toHaveAttribute('data-high', 'true');
  await expect(page.locator('#bandwidthOutLine')).not.toHaveAttribute('points', '');
  await expect(page.getByLabel('纵轴单位 MB/s')).toContainText('MB/s');
  await expect(page.locator('#bandwidthReferenceLabel')).toHaveText('1 MB/s · 8 Mbps');
  expect(Number(await page.locator('#bandwidthReference').getAttribute('y1'))).toBeGreaterThan(0);
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.route('**/connect/api/admin/bandwidth', route => route.fulfill({ json: { available: false, error: '无法读取服务器网卡指标', history: [], current: null } }));
  await page.getByRole('button', { name: '刷新', exact: true }).click();
  await expect(page.locator('#bandwidthStatus')).toContainText('无法读取');
  await expect(page.locator('#bandwidthIn')).toHaveText('—');
  await page.getByRole('button', { name: '退出', exact: true }).click();
  await expect(page.getByRole('region', { name: '服务器带宽仪表盘' })).toBeHidden();
});
