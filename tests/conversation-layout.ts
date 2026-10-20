import { expect, type Page } from '@playwright/test';

/** The visual contract shared by live Codex chat and each backend's saved history. */
export async function expectUnifiedConversation(page: Page) {
  const drawer = page.locator('.session-drawer'), header = drawer.locator('.drawer-header');
  await expect(header.getByRole('button', { name: '对话目录', exact: true })).toBeVisible();
  await expect(drawer.locator('.session-conversation .codex-chat-toolbar,.session-conversation .conversation-toolbar')).toHaveCount(0);
  const headerBox = (await header.boundingBox())!;
  expect(headerBox.height).toBeLessThanOrEqual(49);
  const bodyBox = (await drawer.locator('.codex-chat-body,.conversation-body').boundingBox())!;
  expect(bodyBox.y).toBeCloseTo(headerBox.y + headerBox.height, 0);
  const user = drawer.locator('.chat-user .chat-message-body').first();
  const assistant = drawer.locator('.chat-assistant .chat-message-body').first();
  await expect(user).toHaveCSS('border-radius', '14px 3px 14px 14px');
  await expect(user).toHaveCSS('font-size', '13.5px');
  await expect(assistant).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
  await expect(assistant).toHaveCSS('padding', '0px');
  await expect(drawer.locator('.chat-messages')).toHaveCSS('gap', '20px');
  await expect(drawer.locator('.chat-messages')).toHaveCSS('max-width', '960px');
  await expect(assistant.locator('.chat-markdown')).toBeVisible();
}
