import type { ChatAttachment } from '../shared/attachments';
import './message-queue.css';

export type QueuedMessage = { id: string; text: string; attachments: ChatAttachment[]; identity: string; paused?: boolean };
export function readQueue(value: unknown): QueuedMessage[] {
  if (!Array.isArray(value)) return [];
  return value.filter(item => item && typeof item.id === 'string' && typeof item.text === 'string' && typeof item.identity === 'string' && Array.isArray(item.attachments) && item.attachments.every((file: ChatAttachment) => typeof file?.id === 'string' && typeof file.name === 'string')).slice(0,10);
}
export default function MessageQueue({ items, disabled, locked = false, sendingId, send, edit, remove }: {
  items: QueuedMessage[]; disabled: boolean; locked?: boolean; sendingId?: string; send(item: QueuedMessage): void; edit(item: QueuedMessage): void; remove(id: string): void;
}) {
  if (!items.length) return null;
  return <section className="message-queue" aria-label="待发送消息">
    <div className="message-queue-heading"><strong>待发送 · {items.length}</strong><span>本轮结束后依次发送 · 离开会话时暂停</span></div>
    <ol>{items.map(item => <li key={item.id}>
      <div className="message-queue-text"><p>{item.text || '图片消息'}</p>{!!item.attachments.length && <small>{item.attachments.map(file => file.name).join('、')}</small>}{item.paused && <small>已暂停，请核对后手动发送</small>}</div>
      <div className="message-queue-actions"><button type="button" className="text-button" disabled={disabled} onClick={() => send(item)}>{sendingId === item.id ? '正在发送…' : '立即发送'}</button><button type="button" className="text-button" disabled={locked} onClick={() => edit(item)}>编辑</button><button type="button" className="text-button" disabled={locked} aria-label={'取消排队：' + (item.text || '图片消息')} onClick={() => remove(item.id)}>取消</button></div>
    </li>)}</ol>
  </section>;
}
