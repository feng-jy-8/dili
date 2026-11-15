import test from 'node:test';
import assert from 'node:assert/strict';
import type { BackendInfo, Group, Session } from '../shared/types.ts';
import { canJoinTopic, forkTitle, sortTopics, topicPreview } from './topics.ts';
import { readWorkspaceRoute, workspaceHash } from './navigation.ts';

const topic = (id: string, overrides: Partial<Group> = {}): Group => ({ id, kind: 'topic', title: id, goal: '', createdAt: '2026-11-01T00:00:00Z', updatedAt: '2026-11-01T00:00:00Z', ...overrides });

test('topics sort pinned first, then by latest activity, and preview the newest message', () => {
  const sorted = sortTopics([topic('old'), topic('busy', { lastMessage: { text: 'x', senderName: 'A', at: '2026-11-03T00:00:00Z' } }), topic('pinned', { pinned: true })]);
  assert.deepEqual(sorted.map(item => item.id), ['pinned', 'busy', 'old']);
  assert.equal(topicPreview(sorted[1]!), 'A：x');
  assert.equal(topicPreview(topic('t', { goal: '  原帖\n正文 ' })), '原帖 正文');
  assert.equal(topicPreview(topic('t')), '还没有回复');
});

test('only contacts with a settled native session and fork support can join', () => {
  const backends = [{ id: 'codex', label: 'Codex', capabilities: { fork: true } }, { id: 'dsh', label: 'DeepSeek Harness', capabilities: { fork: false } }] as unknown as BackendInfo[];
  const contact = { backend: 'codex', nativeSessionId: 'n', forkPending: false } as Session;
  assert.deepEqual(canJoinTopic(contact, backends), { ok: true });
  assert.equal(canJoinTopic({ ...contact, nativeSessionId: null }, backends).ok, false);
  assert.equal(canJoinTopic({ ...contact, forkPending: true }, backends).ok, false);
  assert.equal(canJoinTopic({ ...contact, backend: 'dsh' }, backends).ok, false);
  assert.equal(forkTitle('A', 'B'), 'A · B');
  assert.equal(forkTitle('A'.repeat(100), 'B'.repeat(100)).length, 120);
});

test('topic routes round-trip through the hash', () => {
  assert.equal(readWorkspaceRoute('#/topics').view, 'topics');
  assert.equal(readWorkspaceRoute('#/topics/abc-1').view, 'topic:abc-1');
  assert.equal(workspaceHash({ view: 'topic:abc-1', selectedId: 's1' }), '#/topics/abc-1?session=s1');
  assert.equal(readWorkspaceRoute('#/topics/bad id').view, 'contacts');
});
