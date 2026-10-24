import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_GROUP_PROMPT, briefingVersion, buildGroupTask, buildJoinBriefing, taskTagLine } from '../shared/group-prompt.ts';
import { failureReply, replyFor } from './group-replies.ts';
import { nativeErrorText } from './codex.ts';

test('a task carries a short header, the quoted answers and the task; the full rules only when they changed', () => {
  const group = { title: '登录协作', goal: '' };
  const short = buildGroupTask({ group, member: '审查员', task: '  审查接口  ', tag: 'T-abc123', references: [{ senderName: '实现者', text: '接口已完成' }] });
  assert.equal(short, '【群聊任务】任务编号：T-abc123 · 群「登录协作」\n\n## 引用的回答\n\n### 实现者 的回答\n接口已完成\n\n## 你的任务\n\n审查接口');
  const full = buildGroupTask({ group, member: '审查员', task: 't', tag: 'T-000001', includeRules: true });
  assert.match(full, /## 群说明（已更新）\n\n你是群聊「登录协作」中的成员「审查员」。群目标：见群聊讨论/);
  assert.doesNotMatch(DEFAULT_GROUP_PROMPT, /## 结论/, 'Members are not forced into a reply format');
  const custom = buildGroupTask({ group: { title: 'G', goal: 'X', prompt: '自定义：{{member}} @ {{group}} / {{goal}}' }, member: 'M', task: 't', tag: 'T-000002', includeRules: true });
  assert.match(custom, /自定义：M @ G \/ X/);
  const long = buildGroupTask({ group, member: 'A', task: 't', tag: 'T-000003', references: [{ senderName: 'B', text: 'x'.repeat(9000) }] });
  assert.match(long, /内容过长已截断，完整回答见群聊/);
});

test('the join briefing has the full rules, the roster, and recent answers marked as other members\' work', () => {
  const text = buildJoinBriefing({ group: { title: 'G', goal: '目标' }, member: '新人', workspace: { shared: '/repo', cwd: '/repo' }, tag: 'T-00000a', greet: true,
    roster: [{ name: '老人', backend: 'codex', status: 'idle' }], recent: [{ senderName: '老人', task: '做接口', text: '接口完成' }] });
  assert.match(text, /^【群聊入群说明】任务编号：T-00000a/);
  assert.match(text, /所有成员共用工作目录 \/repo/);
  assert.match(text, /## 当前成员\n\n- 老人（codex，idle）/);
  assert.match(text, /\*\*不是给你的任务，不需要你执行\*\*/);
  assert.match(text, /### 老人 回答了任务「做接口」\n接口完成/);
  assert.match(text, /不要开始任何开发工作。用两三句话在群里打个招呼/);
  assert.doesNotMatch(buildJoinBriefing({ group: { title: 'G', goal: '' }, member: 'A', roster: [], recent: [], tag: 'T-00000b', greet: false }), /最近的回答|打个招呼/);
  assert.notEqual(briefingVersion({ title: 'G', goal: 'a' }), briefingVersion({ title: 'G', goal: 'b' }));
  assert.equal(briefingVersion({ title: 'G', goal: 'a' }), briefingVersion({ title: 'G', goal: 'a' }));
});

test('reply is the task\'s final answer, matched by task number, stopping at the next user turn', () => {
  const messages = [
    { id: 'u0', role: 'user' as const, text: '私聊' }, { id: 'a0', role: 'assistant' as const, text: '私聊回复' },
    { id: 'u1', role: 'user' as const, text: `【群聊任务】${taskTagLine('T-aaaaaa')}\n任务` },
    { id: 'a1', role: 'assistant' as const, text: '第一段' }, { id: 'a2', role: 'assistant' as const, text: '最终回答' },
    { id: 'u2', role: 'user' as const, text: '之后的私聊' }, { id: 'a3', role: 'assistant' as const, text: '不属于任务' },
  ];
  assert.deepEqual(replyFor({ messages, truncated: false }, 'T-aaaaaa'), { text: '最终回答', nativeMessageId: 'u1', closed: true }, 'Only the final answer, not interim progress');
  assert.equal(replyFor({ messages, truncated: false }, 'T-bbbbbb'), null);
  assert.equal(replyFor({ messages: messages.slice(0, 3), truncated: false }, 'T-aaaaaa'), null, 'No reply yet means retry later');
});

test('background continuation turns stay in the same task and the latest answer wins; only a human turn closes it', () => {
  const messages = [
    { id: 'u1', role: 'user' as const, text: `【群聊任务】${taskTagLine('T-cccccc')}\n任务` },
    { id: 'a1', role: 'assistant' as const, text: '先跑测试，等待结果。' },
    { id: 'n1', role: 'user' as const, text: '<task-notification>\n<task-id>x</task-id>' },
    { id: 'a2', role: 'assistant' as const, text: '测试通过，全部完成' },
  ];
  assert.deepEqual(replyFor({ messages: messages.slice(0, 2), truncated: false }, 'T-cccccc'), { text: '先跑测试，等待结果。', nativeMessageId: 'u1', closed: false });
  assert.deepEqual(replyFor({ messages, truncated: false }, 'T-cccccc'), { text: '测试通过，全部完成', nativeMessageId: 'u1', closed: false });
  assert.equal(replyFor({ messages: [...messages.slice(0, 2), { id: 'u2', role: 'user' as const, text: '你停一下' }], truncated: false }, 'T-cccccc')!.closed, true);
});

test('members are told whether they share the group workspace or work in their own worktree', () => {
  const group = { title: 'G', goal: 'x' };
  const shared = buildGroupTask({ group, member: 'A', task: 't', tag: 'T-000001', workspace: { shared: '/repo', cwd: '/repo' }, includeRules: true });
  assert.match(shared, /所有成员共用工作目录 \/repo。.*不要覆盖或回退他人未提交的改动/);
  assert.doesNotMatch(buildGroupTask({ group, member: 'A', task: 't', tag: 'T-000001', workspace: { shared: '/repo', cwd: '/repo' } }), /工作区/, 'Shared members need no reminder per task');
  const own = buildGroupTask({ group, member: 'B', task: 't', tag: 'T-000002', workspace: { shared: '/repo', cwd: '/wt/b', branch: 'dili/G/B-abc123' } });
  assert.match(own, /独立的 Git 工作树中工作（目录 \/wt\/b，分支 dili\/G\/B-abc123），从群工作区 \/repo 分出/, 'Worktree members are reminded every task');
  const elsewhere = buildGroupTask({ group, member: 'C', task: 't', tag: 'T-000003', workspace: { shared: '/repo', cwd: '/other' } });
  assert.match(elsewhere, /与群工作区 \/repo 不同/);
  const custom = buildGroupTask({ group: { ...group, prompt: '只有自定义说明' }, member: 'A', task: 't', tag: 'T-000004', workspace: { shared: '/repo', cwd: '/repo' }, includeRules: true });
  assert.match(custom, /只有自定义说明\n\n工作区：所有成员共用/, 'A custom prompt without the placeholder still gets the workspace rule');
  assert.doesNotMatch(buildGroupTask({ group, member: 'A', task: 't', tag: 'T-000005', includeRules: true }), /\{\{workspace\}\}|\n\n\n/);
});

test('failure notes carry the native reason, bounded and never empty', () => {
  assert.match(failureReply('Codex 执行错误：unexpected status 526').text, /^回复失败：Codex 执行错误：unexpected status 526\n/);
  assert.match(failureReply('  ').text, /^回复失败：原生会话报告错误/);
  assert.equal(nativeErrorText({ message: 'unexpected status 526\n  error code: 526' }), 'unexpected status 526 error code: 526');
  assert.equal(nativeErrorText('x'.repeat(400)).length, 300);
  assert.equal(nativeErrorText(undefined), '');
});
