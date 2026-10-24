import { test, mutationHeaders } from './fixtures';
import { expect } from '@playwright/test';
import type { AppState, Group, Session } from '../shared/types';

async function createGroup(request: import('@playwright/test').APIRequestContext, title: string) {
  const headers = await mutationHeaders(request);
  const state = await (await request.get('/api/state')).json() as AppState;
  const group = await (await request.post('/api/groups', { data: { title, goal: '验证群聊体验' }, headers })).json() as Group;
  const members: Session[] = [];
  for (const [backend, name] of [['claude', '方案成员'], ['codex', '实现成员'], ['dsh', '验证成员']] as const) {
    members.push(await (await request.post('/api/sessions', { data: { backend, title: `${title}·${name}`, cwd: state.defaultCwd, groupId: group.id }, headers })).json() as Session);
  }
  await request.post(`/api/groups/${group.id}/messages`, { data: { kind: 'result', text: '方案成员的结论', senderId: members[0].id }, headers });
  await request.post(`/api/groups/${group.id}/messages`, { data: { kind: 'note', text: '我的记录' }, headers });
  return { group, members };
}

test('groups are contact-list cards with a tiled avatar; "+" starts a group chat with its prompt', async ({ page }) => {
  const { group } = await createGroup(page.request, '列表群聊');
  await page.goto('/#/contacts');
  const card = page.locator('.group-card').filter({ hasText: '列表群聊' });
  await expect(card).toBeVisible();
  await expect(card.locator('.group-avatar-grid .backend-avatar')).toHaveCount(3);
  await expect(card.locator('.group-avatar-mark')).toHaveText('群');
  await expect(card).toContainText('你：我的记录');
  await expect(page.getByRole('navigation', { name: '协作群组' })).toHaveCount(0);

  await card.getByRole('button', { name: '进入群聊 列表群聊' }).click();
  await expect(page).toHaveURL(new RegExp(`groups/${group.id}`));
  await expect(card).toBeVisible();
  await expect(page.getByLabel('群组消息')).toBeVisible();

  await page.getByRole('button', { name: '新建', exact: true }).click();
  await page.getByRole('menuitem', { name: '发起群聊', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '创建协作群组' });
  await expect(dialog.getByLabel('群 prompt')).toHaveValue(/## 结论/);
  await dialog.getByLabel('群组名称').fill('新建群聊回归');
  await dialog.getByRole('button', { name: '创建群组', exact: true }).click();
  await expect(page.locator('.group-card').filter({ hasText: '新建群聊回归' })).toBeVisible();
  await page.getByRole('button', { name: '添加成员', exact: true }).first().click();
  const member = page.getByRole('dialog', { name: '添加群组成员' });
  // The new group took the default directory as its workspace: members share it by default.
  await expect(member.getByRole('radio', { name: /群工作区/ })).toBeChecked();
  await expect(member.getByRole('radio', { name: /独立工作树/ })).toBeVisible();
  await expect(member.getByLabel('工作目录', { exact: true })).toBeHidden();
  await member.getByRole('radio', { name: /其他目录/ }).check();
  await expect(member.getByLabel('工作目录', { exact: true })).toBeVisible();
});

test('only-one-member filter, @ mention, quote chips and split columns', async ({ page }) => {
  const { group, members } = await createGroup(page.request, '过滤群聊');
  await page.setViewportSize({ width: 1600, height: 1000 });
  await page.goto(`/#/groups/${group.id}`);
  await expect(page.getByText('方案成员的结论')).toBeVisible();
  await expect(page.getByText('我的记录')).toBeVisible();

  await page.getByRole('button', { name: `只看 ${members[0].title}` }).click();
  await expect(page.locator('.group-only-bar')).toContainText(members[0].title);
  await expect(page.getByText('方案成员的结论')).toBeVisible();
  await expect(page.getByText('我的记录')).toBeHidden();
  await page.getByRole('button', { name: '查看全部' }).click();
  await expect(page.getByText('我的记录')).toBeVisible();

  const composer = page.getByLabel('群组消息');
  await composer.fill('请 @实现');
  await page.getByRole('listbox', { name: '选择要 @ 的成员' }).getByRole('option', { name: /实现成员/ }).click();
  await expect(composer).toHaveValue('请 ');
  await expect(page.locator('.recipient-picker').getByRole('button', { name: /实现成员/ })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByRole('button', { name: '发送任务', exact: true })).toBeVisible();
  await page.locator('.group-message.kind-result').getByRole('button', { name: '引用' }).click();
  await expect(page.locator('.composer-references')).toContainText('方案成员的结论');

  await page.getByRole('button', { name: '一键分栏' }).click();
  await expect(page.locator('.group-split-pane')).toHaveCount(3);
  await page.screenshot({ path: 'artifacts/group-split.png' });
  await page.getByRole('button', { name: '退出分栏' }).click();
  await expect(page.locator('.group-timeline')).toBeVisible();
});

test.describe('phone group chat', () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
  test('opens full screen with a back button and splits into member tabs', async ({ page }) => {
    const { group } = await createGroup(page.request, '手机群聊');
    await page.goto('/#/contacts');
    await page.getByRole('button', { name: '进入群聊 手机群聊' }).click();
    await expect(page).toHaveURL(new RegExp(`groups/${group.id}`));
    await expect(page.locator('.contacts-pane')).toBeHidden();
    await expect(page.getByLabel('群组消息')).toBeInViewport();
    await page.getByRole('button', { name: '一键分栏' }).click();
    await expect(page.getByRole('tab')).toHaveCount(3);
    await expect(page.locator('.group-split-pane')).toHaveCount(1);
    await page.getByRole('button', { name: '返回联系人列表' }).click();
    await expect(page.locator('.group-card').filter({ hasText: '手机群聊' })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  });
});
