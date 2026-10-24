import { test, mutationHeaders } from './fixtures';
import { expect } from '@playwright/test';
import type { AppState } from '../shared/types';

test('new contacts on all platforms choose their native permission preset, persisted across page reloads', async ({ page, request }) => {
  for (const backend of ['claude', 'codex', 'dsh'] as const) {
    await page.goto('/#/contacts');
    await page.getByRole('button', { name: '新建', exact: true }).click(); await page.getByRole('menuitem', { name: '新建联系人', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: '新建会话联系人' });
    await dialog.getByRole('button', { name: backend === 'claude' ? /Claude/ : backend === 'codex' ? /Codex/ : /DeepSeek/ }).click();
    if (backend === 'claude') {
      // Claude offers every mode its CLI reports, bypass included.
      const mode = dialog.getByLabel('权限模式');
      await expect(mode).toHaveValue('');
      await expect(mode.locator('option')).toHaveText(['原生默认', '默认审批', '自动接受编辑', 'Auto · 自动审核', '跳过全部审批（危险）', '不询问 · 自动拒绝', '计划模式']);
      await mode.selectOption('bypassPermissions');
      await expect(dialog).toContainText('不再请求任何确认');
    } else {
      await expect(dialog.getByLabel('执行模式')).toHaveValue('default');
      await dialog.getByLabel('执行模式').selectOption('auto');
    }
    await dialog.getByLabel('联系人名称').fill(`Auto ${backend}`);
    await dialog.getByRole('button', { name: '创建联系人', exact: true }).click();
    await expect(page.locator('.terminal-connection.connected')).toHaveCount(1);
    const state = await (await request.get('/api/state')).json() as AppState;
    const contact = state.sessions.find(item => item.title === `Auto ${backend}`)!;
    if (backend === 'claude') expect(contact.nativeSettings).toEqual({ permission: 'bypassPermissions' });
    else expect(contact.executionMode).toBe('auto');
    await page.reload();
    await expect(page.getByRole('heading', { name: `Auto ${backend}`, exact: true }).last()).toBeVisible();
    await page.getByRole('button', { name: '关闭会话', exact: true }).click();
  }
  const state = await (await request.get('/api/state')).json() as AppState;
  const response = await request.post('/api/sessions', { headers: await mutationHeaders(request), data: { backend: 'codex', title: 'Invalid mode', cwd: state.defaultCwd, executionMode: 'unrestricted' } });
  expect(response.status()).toBe(400);
  const unknown = await request.post('/api/sessions', { headers: await mutationHeaders(request), data: { backend: 'claude', title: 'Invalid permission', cwd: state.defaultCwd, nativeSettings: { permission: 'everything' } } });
  expect(unknown.status()).toBe(400);
  expect((await (await request.get('/api/state')).json() as AppState).sessions.length).toBe(state.sessions.length);
});
