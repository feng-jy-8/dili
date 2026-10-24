import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_GROUP_PROMPT, buildGroupTask, extractConclusion, taskTagLine } from '../shared/group-prompt.ts';
import { replyFor } from './group-replies.ts';

test('group task carries the prompt, only the quoted conclusions and the task', () => {
  const text = buildGroupTask({ group: { title: '登录协作', goal: '' }, member: '审查员', task: '  审查接口  ', tag: 'T-abc123', references: [{ senderName: '实现者', conclusion: '接口已完成', text: '很长的完整回复' }] });
  assert.match(text, /^【群聊任务】任务编号：T-abc123/);
  assert.match(text, /群聊「登录协作」中的成员「审查员」/);
  assert.match(text, /群目标：见群聊讨论/);
  assert.match(text, /## 引用的结论\n\n### 实现者 的结论\n接口已完成/);
  assert.doesNotMatch(text, /很长的完整回复/);
  assert.ok(text.endsWith('## 你的任务\n\n审查接口'));
  assert.ok(DEFAULT_GROUP_PROMPT.includes('## 结论'));
  const custom = buildGroupTask({ group: { title: 'G', goal: 'X', prompt: '自定义：{{member}} @ {{group}} / {{goal}}' }, member: 'M', task: 't', tag: 'T-000001' });
  assert.match(custom, /自定义：M @ G \/ X/);
  assert.doesNotMatch(custom, /## 引用的结论/);
});

test('conclusion is the last conclusion section, otherwise a bounded head of the reply', () => {
  assert.equal(extractConclusion('过程\n\n## 结论\n通过。\n遗留：无\n\n## 附录\n日志'), '通过。\n遗留：无');
  assert.equal(extractConclusion('## 结论\n旧\n\n## Conclusion:\n新'), '新');
  assert.equal(extractConclusion('### 结论：\n- 完成\n#### 细节\n仍属于结论'), '- 完成\n#### 细节\n仍属于结论');
  assert.equal(extractConclusion('没有结论小节的回复'), '没有结论小节的回复');
  assert.equal(extractConclusion('x'.repeat(3000)).length, 2000);
});

test('reply is matched by task number and stops at the next user turn', () => {
  const messages = [
    { id: 'u0', role: 'user' as const, text: '私聊' }, { id: 'a0', role: 'assistant' as const, text: '私聊回复' },
    { id: 'u1', role: 'user' as const, text: `【群聊任务】${taskTagLine('T-aaaaaa')}\n任务` },
    { id: 'a1', role: 'assistant' as const, text: '第一段' }, { id: 'a2', role: 'assistant' as const, text: '## 结论\n好' },
    { id: 'u2', role: 'user' as const, text: '之后的私聊' }, { id: 'a3', role: 'assistant' as const, text: '不属于任务' },
  ];
  assert.deepEqual(replyFor({ messages, truncated: false }, 'T-aaaaaa'), { text: '第一段\n\n## 结论\n好', nativeMessageId: 'u1', closed: true });
  assert.equal(replyFor({ messages, truncated: false }, 'T-bbbbbb'), null);
  assert.equal(replyFor({ messages: messages.slice(0, 3), truncated: false }, 'T-aaaaaa'), null, 'No reply yet means retry later');
});

test('members are told whether they share the group workspace or work in their own worktree', () => {
  const group = { title: 'G', goal: 'x' };
  const shared = buildGroupTask({ group, member: 'A', task: 't', tag: 'T-000001', workspace: { shared: '/repo', cwd: '/repo' } });
  assert.match(shared, /所有成员共用工作目录 \/repo。.*不要覆盖或回退他人未提交的改动/);
  const own = buildGroupTask({ group, member: 'B', task: 't', tag: 'T-000002', workspace: { shared: '/repo', cwd: '/wt/b', branch: 'dili/G/B-abc123' } });
  assert.match(own, /独立的 Git 工作树中工作（目录 \/wt\/b，分支 dili\/G\/B-abc123），从群工作区 \/repo 分出/);
  const elsewhere = buildGroupTask({ group, member: 'C', task: 't', tag: 'T-000003', workspace: { shared: '/repo', cwd: '/other' } });
  assert.match(elsewhere, /与群工作区 \/repo 不同/);
  const custom = buildGroupTask({ group: { ...group, prompt: '只有自定义说明' }, member: 'A', task: 't', tag: 'T-000004', workspace: { shared: '/repo', cwd: '/repo' } });
  assert.match(custom, /只有自定义说明\n\n工作区：所有成员共用/, 'A custom prompt without the placeholder still gets the workspace rule');
  assert.doesNotMatch(buildGroupTask({ group, member: 'A', task: 't', tag: 'T-000005' }), /\{\{workspace\}\}|\n\n\n/);
});

test('failure notes carry the native reason, bounded and never empty', async () => {
  const { failureReply } = await import('./group-replies.ts');
  const { nativeErrorText } = await import('./codex.ts');
  assert.deepEqual(failureReply('Codex 执行错误：unexpected status 526').conclusion, '回复失败：Codex 执行错误：unexpected status 526');
  assert.equal(failureReply('  ').conclusion, '回复失败：原生会话报告错误');
  assert.equal(nativeErrorText({ message: 'unexpected status 526\n  error code: 526' }), 'unexpected status 526 error code: 526');
  assert.equal(nativeErrorText('x'.repeat(400)).length, 300);
  assert.equal(nativeErrorText(undefined), '');
});

test('background continuation turns stay in the same task; only a human turn or the conclusion closes it', async () => {
  const { hasConclusion } = await import('../shared/group-prompt.ts');
  const messages = [
    { id: 'u1', role: 'user' as const, text: `【群聊任务】${taskTagLine('T-cccccc')}\n任务` },
    { id: 'a1', role: 'assistant' as const, text: '先跑测试，等待结果。' },
    { id: 'n1', role: 'user' as const, text: '<task-notification>\n<task-id>x</task-id>' },
    { id: 'a2', role: 'assistant' as const, text: '测试通过。\n\n## 结论\n全部完成' },
  ];
  const open = replyFor({ messages: messages.slice(0, 2), truncated: false }, 'T-cccccc')!;
  assert.equal(open.closed, false);
  assert.equal(hasConclusion(open.text), false);
  const done = replyFor({ messages, truncated: false }, 'T-cccccc')!;
  assert.equal(done.text, '先跑测试，等待结果。\n\n测试通过。\n\n## 结论\n全部完成');
  assert.equal(hasConclusion(done.text), true);
  assert.equal(done.closed, false);
  assert.equal(replyFor({ messages: [...messages.slice(0, 2), { id: 'u2', role: 'user' as const, text: '你停一下' }], truncated: false }, 'T-cccccc')!.closed, true);
});
