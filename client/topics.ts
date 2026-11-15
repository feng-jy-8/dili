import { t } from '../shared/i18n';
import type { BackendInfo, Group, Session } from '../shared/types';

/** Pinned first, then the topic with the latest activity. */
export function sortTopics(topics: Group[]): Group[] {
  const at = (topic: Group) => Date.parse(topic.lastMessage?.at ?? topic.createdAt) || 0;
  return [...topics].sort((a, b) => Number(!!b.pinned) - Number(!!a.pinned) || at(b) - at(a));
}

/** The card's second line: the latest message, else the opening post. */
export function topicPreview(topic: Group): string {
  if (topic.lastMessage) return `${topic.lastMessage.senderName}：${topic.lastMessage.text}`;
  return topic.goal.replace(/\s+/g, ' ').trim().slice(0, 160) || t('topic.noReplies');
}

/** An existing contact joins a topic as a native fork of its session. */
export function canJoinTopic(session: Session, backends: BackendInfo[]): { ok: true } | { ok: false; reason: string } {
  const backend = backends.find(item => item.id === session.backend);
  if (!backend?.capabilities.fork) return { ok: false, reason: t('topic.noFork', { backend: backend?.label ?? session.backend }) };
  if (!session.nativeSessionId || session.forkPending) return { ok: false, reason: t('topic.notStarted') };
  return { ok: true };
}

/** "<contact> · <topic>", within the 120-character contact name limit. */
export function forkTitle(source: string, topic: string): string {
  const title = `${source} · ${topic}`;
  return title.length > 120 ? `${title.slice(0, 119)}…` : title;
}
