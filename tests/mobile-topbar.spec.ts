import { test } from './fixtures';
import { expect } from '@playwright/test';

test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

test('phone top bar is two IM rows and panel tools move to the bottom menu', async ({ page }) => {
  await page.goto('/#/contacts');
  const title = page.locator('.topbar-title');
  const add = page.getByRole('button', { name: '新建', exact: true });
  const search = page.getByLabel('搜索联系人');
  await expect(add).toBeVisible();
  const [titleBox, addBox, searchBox] = await Promise.all([title.boundingBox(), add.boundingBox(), search.boundingBox()]);
  expect(Math.abs(titleBox!.y + titleBox!.height / 2 - (addBox!.y + addBox!.height / 2))).toBeLessThan(6);
  expect(searchBox!.y).toBeGreaterThan(addBox!.y + addBox!.height - 1);
  expect(searchBox!.width).toBeGreaterThan(250);
  for (const name of ['打开预览面板', '打开资源管理器', '打开网页服务', '打开终端', '打开随手记', '切换主题', '导入会话']) await expect(page.getByRole('button', { name, exact: true })).toBeHidden();
  await page.locator('.rail').getByRole('button', { name: '更多', exact: true }).click();
  for (const name of ['底部终端', '网页服务', '随手记', '外观主题']) await expect(page.getByRole('menuitem', { name, exact: true })).toBeVisible();
  await page.keyboard.press('Escape');
  await add.click();
  await expect(page.getByRole('menuitem', { name: '导入会话', exact: true })).toBeVisible();
  await page.screenshot({ path: 'artifacts/phone-topbar.png' });
});

test('iPhone standalone uses one status-bar inset and keeps the home inset unscaled at 150 percent', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'standalone', { value: true });
    localStorage.setItem('dili.interface-zoom', '150');
  });
  await page.goto('/#/contacts');
  await expect(page.locator('html')).toHaveAttribute('data-ios-standalone', '');
  expect(await page.locator('.topbar-row').evaluate(node => parseFloat(getComputedStyle(node).paddingTop))).toBe(4);
  // Browser emulation has no hardware insets: simulate the iPhone's 34px home area.
  await page.addStyleTag({ content: ':root { --safe-bottom: calc(34px / var(--ui-scale, 1)); }' });
  const bottom = await page.locator('.rail').evaluate(node => parseFloat(getComputedStyle(node).paddingBottom));
  expect(bottom * 1.5).toBeCloseTo(34, 1);
  const bounds = await page.locator('.rail').boundingBox();
  expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(845);
  await page.screenshot({ path: 'artifacts/iphone-compact-safe-area.png' });
});
