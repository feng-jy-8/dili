import type { AgentChatChoice } from './chat.ts';

/** Display text for Claude Code's native permission modes. The offered set
 * always comes from the installed CLI; unknown future modes keep their id. */
const CLAUDE_PERMISSIONS: Record<string, { label: string; description: string }> = {
  default: { label: '默认审批', description: '沿用原生允许规则，其他操作请求审批。' },
  acceptEdits: { label: '自动接受编辑', description: '允许文件编辑，其他操作仍按原生规则审批。' },
  plan: { label: '计划模式', description: '先分析和规划，限制执行修改。' },
  auto: { label: 'Auto · 自动审核', description: 'Claude 原生审核器自动批准低风险操作；部分操作仍会请求确认，并受模型支持限制。' },
  dontAsk: { label: '不询问 · 自动拒绝', description: '不弹出审批：未被原生规则预先允许的操作直接拒绝。' },
  bypassPermissions: { label: '跳过全部审批（危险）', description: '不再请求任何确认，Agent 可直接在这台电脑上执行命令和修改文件。只在可信项目中使用；可写分享的访客同样获得这项能力。' },
};

/** `manual` is the CLI's alias of `default`; the native process reports `default`. */
export function normalizeClaudePermission(mode: string): string {
  return mode === 'manual' ? 'default' : mode;
}

/** Parses `--permission-mode` choices from `claude --help`, wrapped lines included. */
export function parseClaudePermissionModes(help: string): string[] {
  const start = help.indexOf('--permission-mode');
  if (start < 0) return [];
  const rest = help.slice(start + '--permission-mode'.length);
  const next = rest.search(/\n\s*-{1,2}[a-z]/i);
  const block = next < 0 ? rest : rest.slice(0, next);
  const choices = block.match(/choices:([^)]*)\)/s)?.[1] ?? '';
  const modes = [...choices.matchAll(/["']([A-Za-z]+)["']/g)].map(match => normalizeClaudePermission(match[1]));
  return [...new Set(modes)].sort((a, b) => Number(b === 'default') - Number(a === 'default'));
}

export function claudePermissionChoices(modes: readonly string[]): AgentChatChoice[] {
  return modes.map(id => ({ id, label: CLAUDE_PERMISSIONS[id]?.label ?? id, ...(CLAUDE_PERMISSIONS[id] ? { description: CLAUDE_PERMISSIONS[id].description } : {}) }));
}

export function claudePermissionLabel(mode: string | null | undefined): string {
  return mode ? CLAUDE_PERMISSIONS[mode]?.label ?? mode : '原生默认';
}
