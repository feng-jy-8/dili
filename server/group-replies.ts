import type { ConversationTranscript, Delivery, Session } from '../shared/types.ts';
import { extractConclusion, hasConclusion, taskTagLine } from '../shared/group-prompt.ts';
import type { Store } from './store.ts';

export interface GroupReplyOptions {
  store: Store;
  /** Fresh native history; never starts an Agent. */
  read(session: Session): Promise<ConversationTranscript>;
  /** True while a structured executor still has a turn open (e.g. a question mid-turn). */
  turnOpen(session: Session): boolean;
  onReply(): void;
  /** Retry delays while native history catches up with a finished turn. */
  delays?: number[];
}

const FINISHED = new Set(['idle', 'waiting_input', 'error', 'stopped']);

/** Turns the agent starts itself (background task results, reminders) continue
 * the same task; only a person's next message ends it. */
const automaticTurn = (text: string) => /^\s*<(?:task-notification|system-reminder)\b/.test(text);

/** The member's reply to one task: assistant text after the user turn that
 * carries the task number, up to the next human turn. `closed` means that
 * human turn exists, so nothing more belongs to this task. Null until text exists. */
export function replyFor(transcript: ConversationTranscript, tag: string): { text: string; nativeMessageId: string; closed: boolean } | null {
  const start = taskTurn(transcript, tag);
  if (start < 0) return null;
  const replies = [];
  let closed = false;
  for (const message of transcript.messages.slice(start + 1)) {
    if (message.role === 'user') { if (automaticTurn(message.text)) continue; closed = true; break; }
    replies.push(message);
  }
  const text = replies.map(message => message.text.trim()).filter(Boolean).join('\n\n');
  return text ? { text, nativeMessageId: transcript.messages[start].id, closed } : null;
}

/** Index of the user turn carrying the task number, or -1. */
export function taskTurn(transcript: ConversationTranscript, tag: string): number {
  const marker = taskTagLine(tag);
  return transcript.messages.findLastIndex(message => message.role === 'user' && message.text.includes(marker));
}

/** The member's failure note when its task turn ended in an error without an answer. */
export function failureReply(detail: string): { text: string; conclusion: string; failed: true } {
  const reason = detail.trim() || '原生会话报告错误';
  return { text: `回复失败：${reason}\n\n这一轮没有产生回复。处理原因后，可以在群里重新指派这个任务；原任务不会自动重发。`, conclusion: `回复失败：${reason}`, failed: true };
}

/** Collects replies to group tasks only. Private turns never carry a task
 * number, so they never reach the group. Each delivery is collected once. */
export class GroupReplies {
  private timers = new Map<string, NodeJS.Timeout>();
  private running = new Set<string>();
  private closed = false;
  constructor(private readonly options: GroupReplyOptions) {}

  /** Not yet answered, or answered by a reply that is still open (no conclusion yet). */
  private outstanding(sessionId: string): Delivery[] {
    return this.options.store.deliveries().filter(item => item.sessionId === sessionId && !!item.tag && (item.status === 'sent' || item.status === 'staged')
      && (!item.replyMessageId || this.options.store.message(item.replyMessageId)?.pending === true));
  }

  /** Called on every member status change; cheap when nothing is outstanding. */
  statusChanged(session: Session) {
    if (this.closed || !session.groupId || !FINISHED.has(session.status) || !this.outstanding(session.id).length) return;
    this.schedule(session.id, 0);
  }

  private schedule(sessionId: string, attempt: number) {
    const delays = this.options.delays ?? [800, 2500, 6000, 15000];
    if (attempt >= delays.length) return;
    clearTimeout(this.timers.get(sessionId));
    const timer = setTimeout(() => { this.timers.delete(sessionId); void this.collect(sessionId, attempt); }, delays[attempt]);
    timer.unref?.();
    this.timers.set(sessionId, timer);
  }

  private async collect(sessionId: string, attempt: number) {
    if (this.closed || this.running.has(sessionId)) return;
    const session = this.options.store.session(sessionId);
    const pending = session ? this.outstanding(sessionId) : [];
    if (!session?.groupId || !pending.length || !FINISHED.has(session.status) || this.options.turnOpen(session)) return;
    this.running.add(sessionId);
    let missing = false;
    try {
      const transcript = await this.options.read(session);
      const delays = this.options.delays ?? [800, 2500, 6000, 15000];
      const lastAttempt = attempt >= delays.length - 1;
      for (const delivery of pending) {
        const reply = replyFor(transcript, delivery.tag!);
        const open = delivery.replyMessageId ? this.options.store.message(delivery.replyMessageId) : undefined;
        if (reply) {
          // A turn end is not the task end: the member may continue on its own
          // (background work). The reply stays open until it writes the conclusion
          // or the user speaks next, and grows meanwhile.
          // An error after partial output also ends the task; the partial reply is final.
          const final = reply.closed || hasConclusion(reply.text) || session.status === 'error';
          const content = { text: reply.text, conclusion: extractConclusion(reply.text), pending: !final };
          const changed = open ? this.options.store.updateReply(open.id, content) : this.options.store.addReply(delivery.id, { ...content, nativeMessageId: reply.nativeMessageId });
          if (changed) this.options.onReply();
          continue;
        }
        // An error that ended the task turn (or never let it start) is reported in
        // the group once, instead of leaving the task looking merely "sent".
        const started = taskTurn(transcript, delivery.tag!) >= 0;
        if (session.status === 'error' && (started || lastAttempt)) {
          const failure = failureReply(session.statusDetail);
          if (open ? this.options.store.updateReply(open.id, { ...failure, pending: false }) : this.options.store.addReply(delivery.id, failure)) this.options.onReply();
          continue;
        }
        if (!open) missing = true;
      }
    } catch { missing = true; } finally { this.running.delete(sessionId); }
    // A staged terminal task may not be submitted yet, or history may lag.
    if (missing) this.schedule(sessionId, attempt + 1);
  }

  close() { this.closed = true; for (const timer of this.timers.values()) clearTimeout(timer); this.timers.clear(); }
}
