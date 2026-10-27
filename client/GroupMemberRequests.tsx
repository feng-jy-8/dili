import { useEffect, useState } from 'react';
import type { AgentChatSnapshot } from '../shared/chat';
import { taskTagLine } from '../shared/group-prompt';
import type { Session } from '../shared/types';
import { api } from './api';
import NativeRequest from './NativeRequest';

/** Only the native turn assigned by this group may expose its requests here. */
export default function GroupMemberRequests({ member, tag }: { member: Session; tag: string }) {
  const [snapshot, setSnapshot] = useState<AgentChatSnapshot | null>(null);
  useEffect(() => {
    let alive = true;
    let pending = false;
    async function read() {
      if (pending) return;
      pending = true;
      try {
        const next = await api<AgentChatSnapshot>(`/sessions/${member.id}/chat`);
        if (alive) setSnapshot(next);
      } catch { if (alive) setSnapshot(null); }
      finally { pending = false; }
    }
    void read();
    const timer = setInterval(() => void read(), 1200);
    return () => { alive = false; clearInterval(timer); };
  }, [member.id, tag]);
  const user = snapshot?.items.filter(item => item.type === 'user').at(-1);
  if (!snapshot?.connected || !user?.text.includes(taskTagLine(tag)) || (user.turnId && snapshot.activeTurnId && user.turnId !== snapshot.activeTurnId) || !snapshot.requests.length) return null;
  return <article className="group-message"><div className="message-body"><div className="message-heading"><strong>{member.title}</strong><span className="message-kind">需要你回复</span></div><div className="bubble">{snapshot.requests.map(request => <NativeRequest key={request.id} agentName={member.title} request={request} disabled={member.archived} answer={async (id, answer) => {
    await api(`/sessions/${member.id}/chat/requests/${encodeURIComponent(id)}`, answer);
    const next = await api<AgentChatSnapshot>(`/sessions/${member.id}/chat`);
    setSnapshot(next);
  }} />)}</div></div></article>;
}
