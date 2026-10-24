import type { Group, GroupMessage } from './types.ts';

/** Placeholders: {{group}} {{goal}} {{member}} {{workspace}}. Each group may override it. */
export const DEFAULT_GROUP_PROMPT = `你是群聊「{{group}}」中的成员「{{member}}」。群目标：{{goal}}

{{workspace}}

协作规则：
- 只处理下面指派给你的任务；你在本会话中的其他上下文仍然有效。
- 群内只共享任务和结论。不要假设其他成员已经完成任务里没有写明的工作；需要依据时，以下方引用的结论为准，并先核对当前文件状态。
- 不要尝试联系其他成员；需要协作时，在结论中写明需要谁做什么。
- 完成后，在回复最后用「## 结论」小节总结：做了什么、结果如何、遗留问题。这一节会自动分享到群里。`;

const TAG = /^T-[0-9a-f]{4,8}$/;
export const isTaskTag = (value: string) => TAG.test(value);
export const taskTagLine = (tag: string) => `任务编号：${tag}`;

/** Where this member works relative to the group workspace. */
export interface MemberWorkspace { shared?: string; cwd: string; branch?: string }

export function workspaceRule(workspace?: MemberWorkspace): string {
  if (!workspace) return '';
  if (workspace.branch) return `工作区：你在独立的 Git 工作树中工作（目录 ${workspace.cwd}，分支 ${workspace.branch}），从群工作区 ${workspace.shared ?? '当前仓库'} 分出。只修改这个工作树；完成后提交你的改动（git commit），由用户决定是否合并回群工作区。`;
  if (workspace.shared && workspace.shared !== workspace.cwd) return `工作区：你的工作目录 ${workspace.cwd} 与群工作区 ${workspace.shared} 不同，其他成员的改动不会出现在你的目录里。`;
  return `工作区：所有成员共用工作目录 ${workspace.cwd}。开始前先查看当前文件和 git 状态，其他成员可能已经修改了文件；不要覆盖或回退他人未提交的改动。`;
}

export interface GroupTaskInput {
  group: Pick<Group, 'title' | 'goal' | 'prompt'>;
  member: string;
  workspace?: MemberWorkspace;
  task: string;
  tag: string;
  /** Referenced member conclusions, oldest first. */
  references?: Pick<GroupMessage, 'senderName' | 'conclusion' | 'text'>[];
}

const MAX_REFERENCE = 4000;

/** The exact text a member receives when @-assigned: group prompt, the
 * referenced conclusions only, then the task. Nothing else from the group. */
export function buildGroupTask({ group, member, task, tag, references = [], workspace }: GroupTaskInput): string {
  const template = group.prompt?.trim() || DEFAULT_GROUP_PROMPT;
  const rule = workspaceRule(workspace);
  // A custom prompt without the placeholder still tells the member where it works.
  const prompt = (template.includes('{{workspace}}') ? template : rule ? `${template}\n\n{{workspace}}` : template)
    .replaceAll('{{group}}', group.title).replaceAll('{{goal}}', group.goal.trim() || '见群聊讨论').replaceAll('{{member}}', member)
    .replaceAll('{{workspace}}', rule).replace(/\n{3,}/g, '\n\n');
  const quoted = references.map(reference => {
    const body = (reference.conclusion || reference.text).trim();
    return `### ${reference.senderName} 的结论\n${body.length > MAX_REFERENCE ? body.slice(0, MAX_REFERENCE - 1) + '…' : body}`;
  });
  return [`【群聊任务】${taskTagLine(tag)}`, prompt, ...(quoted.length ? ['## 引用的结论', ...quoted] : []), '## 你的任务', task.trim()].join('\n\n');
}

const CONCLUSION_HEADING = /^#{1,6}\s*(?:结论|conclusion)\s*[:：]?\s*$/im;
const MAX_CONCLUSION = 2000;

/** The member's own "## 结论" section; otherwise a bounded head of the reply. */
export function extractConclusion(reply: string): string {
  const text = reply.trim();
  const lines = text.split('\n');
  let start = -1;
  lines.forEach((line, index) => { if (CONCLUSION_HEADING.test(line.trim())) start = index; });
  let body = start >= 0 ? lines.slice(start + 1) : lines;
  if (start >= 0) {
    // Stop at the next heading of the same or higher level.
    const level = lines[start].match(/^#+/)![0].length;
    const end = body.findIndex(line => { const match = line.match(/^(#{1,6})\s/); return !!match && match[1].length <= level; });
    if (end >= 0) body = body.slice(0, end);
  }
  const result = body.join('\n').trim() || text;
  return result.length > MAX_CONCLUSION ? result.slice(0, MAX_CONCLUSION - 1) + '…' : result;
}
