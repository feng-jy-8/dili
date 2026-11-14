/**
 * The single message table for Dili's own UI. Only zh-CN ships today; this is
 * the foundation for new locales, not a translation framework. New strings in
 * changed areas belong here (see docs/agents/i18n.md). Placeholders are plain
 * `{name}` substitutions and never HTML.
 */
export const zh = {
  'share.groupTitle': '共享群聊',
  'share.connected': '已连接',
  'share.reconnecting': '正在重连',
  'share.members': '群成员',
  'share.member': '群成员',
  'share.running': '运行中',
  'share.stopped': '未运行',
  'share.logout': '退出共享',
  'share.pickMember': '选择要 @ 的成员',
  'share.unassign': '取消指派给 {name}',
  'share.composerHint': '输入 @ 指派成员，或直接记录想法…',
  'share.sending': '发送中…',
  'share.sendTask': '发送并分派',
  'share.send': '发送',
  'share.readOnly': '这是只读分享，可以查看群聊进展。',
  'share.read': '只读',
  'share.write': '协作',
  'share.full': '全部',
  'share.readNote': '查看消息和状态，不能操作。',
  'share.writeNote': '发送消息、指派任务、处理审批，预览当前工作区和允许的网页服务。Agent 可以执行命令，请仅分享给可信的人。',
  'share.fullNote': '包含协作全部能力，并允许使用原生终端。',
  'share.web': '网页预览',
  'share.webEmpty': '尚未配置允许预览的网页服务。',
  'share.files': '当前工作区',
  'common.copy': '复制',
  'common.copied': '已复制',
  'common.close': '关闭',
  'common.refresh': '刷新',
  'invite.ask': '还没有邀请码？向官方中继申请',
  'invite.askNote': '申请发送到 dili.discoverpaw.com，管理员通过后，邀请码会自动出现在这里，无需在设备之间复制。',
  'invite.name': '称呼',
  'invite.email': '电子邮箱',
  'invite.submit': '提交申请',
  'invite.title': '邀请码申请',
  'invite.pending': '已提交（{email}），等待管理员审核。可以关闭此页，稍后回来查看。',
  'invite.ready': '已通过，可以直接配对。',
  'invite.rejected': '申请未通过。',
  'invite.used': '邀请码已被使用。',
  'invite.expired': '邀请码已过期，请重新申请。',
  'invite.revoked': '邀请码已被撤销，请重新申请。',
  'invite.unknown': '暂时无法连接中继，稍后再查看。',
  'invite.fill': '填入邀请码',
  'invite.filled': '邀请码已填入，确认设备名称后点击“配对并生成链接”',
  'invite.check': '查看结果',
  'invite.withdraw': '撤回',
  'invite.again': '重新申请',
  'invite.checkFailed': '无法查询申请状态',
  'contacts.pullToRefresh': '下拉刷新',
  'contacts.releaseToRefresh': '松开刷新',
  'contacts.refreshing': '正在刷新…',
  'common.retry': '重试',
  'common.loading': '正在加载…',
  'usage.title': '用量',
  'usage.turns': '{n} 轮',
  'usage.input': '输入 {value}',
  'usage.output': '输出 {value}',
  'usage.cacheRead': '缓存读 {value}',
  'usage.context': '上下文约 {value}',
  'usage.partial': '最近窗口',
  'usage.unknown': '原生未提供',
  'usage.pending': '读取中…',
  'usage.remoteNotice': '用量来自本地原生历史，未上传。',
  'usage.compactions': '已压缩 {n} 次',
  'usage.tightHint': '上下文已用 {percent}%，可考虑开新分支',
  'usage.groupTitle': '群成本',
  'usage.groupUnknown': '{n} 项无原生用量',
  'usage.groupPartial': '含最近窗口',
  'usage.groupNote': '按任务列出各成员的原生用量；成员数字覆盖其整个原生会话。',
  'session.export': '导出对话 HTML',
  'session.exporting': '正在生成导出文件…',
  'session.exported': '已导出对话 HTML',
  'session.exportEmpty': '没有可导出的对话记录',
  'debug.title': '运行诊断',
  'debug.subtitle': '只读快照，不包含会话正文或凭据。',
  'debug.copy': '复制诊断信息',
  'debug.refresh': '刷新诊断信息',
  'debug.unavailable': '诊断信息暂不可用',
  'settings.effort': '推理强度',
  'settings.effortHint': '选项来自当前模型的原生推理强度，切换模型后可能变化。',
  'settings.effortUnreported': '当前 Agent 未报告推理强度',
  'settings.effortCommand': '调整当前模型的推理强度',
  'settings.idleSleep': '闲置休眠',
  'settings.idleSleepOff': '关闭（默认）',
  'settings.idleSleepNote': '超过设定时间没有活动的托管会话会自动停止，原生历史与会话身份保留，可随时恢复。',
} as const;

export type MessageKey = keyof typeof zh;
export type MessageParams = Record<string, string | number>;
export const DEFAULT_LOCALE = 'zh-CN';
export const SUPPORTED_LOCALES = ['zh-CN'] as const;
export type Locale = (typeof SUPPORTED_LOCALES)[number];

/** Unmatched placeholders remain visible so a missing parameter is obvious. */
export function formatMessage(template: string, params?: MessageParams): string {
  if (!params) return template;
  return template.replace(/\{(\w+)\}/g, (match, key: string) => {
    const value = params[key];
    return value === undefined ? match : String(value);
  });
}

export function t(key: MessageKey, params?: MessageParams): string {
  return formatMessage(zh[key], params);
}

/** Keys missing from another locale; used when a second locale is added. */
export function missingKeys(candidate: Partial<Record<MessageKey, string>>): MessageKey[] {
  return (Object.keys(zh) as MessageKey[]).filter(key => typeof candidate[key] !== 'string' || !candidate[key]!.trim());
}
