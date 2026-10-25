import type { ChatAttachment } from '../shared/attachments';
import { appUrl } from './urls';

export default function GroupImages({ groupId, items }: { groupId: string; items?: ChatAttachment[] }) {
  if (!items?.length) return null;
  return <div className="chat-attachments" aria-label="消息图片">{items.map(item => {
    const url = appUrl(`/api/groups/${encodeURIComponent(groupId)}/attachments/${encodeURIComponent(item.id)}`);
    return <a key={item.id} href={url} target="_blank" rel="noreferrer"><img src={url} alt={item.name} /></a>;
  })}</div>;
}
