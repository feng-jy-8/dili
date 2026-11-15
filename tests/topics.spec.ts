import { mutationHeaders, test } from './fixtures';
import { expect, type APIRequestContext } from '@playwright/test';
import type { AppState, Group, Session } from '../shared/types';

async function seedTopic(request: APIRequestContext, title: string) {
  const headers = await mutationHeaders(request);
  const topic = await (await request.post('/api/groups', { data: { kind: 'topic', title, goal: '原帖：要讨论的事' }, headers })).json() as Group;
  const state = await (await request.get('/api/state')).json() as AppState;
  const source = state.sessions.find(session => session.nativeSessionId && !session.groupId && !session.archived)!;
  const response = await request.post(`/api/sessions/${source.id}/fork`, { data: { title: `${title} 参与者`, groupId: topic.id, placement: 'directory', briefing: 'none' }, headers });
  expect(response.ok(), 'fork a demo contact into the topic').toBeTruthy();
  const member = await response.json() as Session;
  await request.post(`/api/groups/${topic.id}/messages`, { data: { text: '原帖：要讨论的事', kind: 'task', recipientIds: [member.id] }, headers });
  for (const text of ['第一条想法', '紧接着补充一句']) await request.post(`/api/groups/${topic.id}/messages`, { data: { text, kind: 'note', recipientIds: [] }, headers });
  return { topic, member };
}

test('topics read like channels: categories, flat merged messages, pinned post and a member column', async ({ page, request }) => {
  const { topic, member } = await seedTopic(request, `频道-${Date.now()}`);
  await page.goto('/#/topics');
  const channel = page.locator('.topic-channel', { hasText: topic.title });
  await expect(channel).toBeVisible();
  // Grouped under the participant's working directory.
  const category = page.locator('.topic-category', { has: channel });
  await expect(category.locator('.topic-category-head')).toHaveAttribute('title', member.cwd);
  await channel.locator('.topic-channel-main').click();
  await expect(page).toHaveURL(new RegExp(`#/topics/${topic.id}$`));
  const view = page.locator('.topic-channel-view');
  await expect(view.locator('.topic-opening-row')).toContainText('发布了话题');
  // One sender within five minutes: the second note continues the first.
  await expect(view.locator('.group-message.continued')).toHaveCount(1);
  // Flat flow: my messages are left aligned like everyone else's.
  const mine = view.locator('.group-message.mine').first();
  expect(await mine.evaluate(element => getComputedStyle(element).flexDirection)).toBe('row');
  await view.getByRole('button', { name: '展开原帖' }).click();
  await expect(view.locator('.topic-pinned-post')).toContainText('原帖：要讨论的事');
  await expect(view.locator('.topic-members')).toContainText(member.title);
  // The member column folds and stays folded.
  await view.getByRole('button', { name: '显示或隐藏参与者栏' }).click();
  await expect(view.locator('.topic-members')).toHaveCount(0);
  await page.reload();
  await expect(page.locator('.topic-channel-view .topic-members')).toHaveCount(0);
  await page.locator('.topic-channel-view').getByRole('button', { name: '显示或隐藏参与者栏' }).click();
  // Participants are also contacts.
  await page.goto('/#/contacts');
  await expect(page.locator('.session-card', { hasText: member.title })).toBeVisible();
});
