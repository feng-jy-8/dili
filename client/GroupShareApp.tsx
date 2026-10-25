import type { ChatAttachment } from '../shared/attachments';
import ImageAttachments from './ImageAttachments';
import VoiceInput, { appendVoiceText } from './VoiceInput';
import GroupImages from './GroupImages';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import type { AuthStatus } from '../shared/auth';
import type { AppState, GroupDetail, GroupMessage } from '../shared/types';
import { api } from './api';
import { appUrl } from './urls';
import Markdown from './Markdown';
import './group-chat.css';

type ShareStatus = Extract<AuthStatus, { kind: 'share' }>;
/** Group guests see public group discussion only, never a member's private session. */
export default function GroupShareApp({ status }: { status: ShareStatus }) {
  const [state, setState] = useState<AppState | null>(null);
  const [detail, setDetail] = useState<GroupDetail | null>(null);
  const [text, setText] = useState('');
  const [images, setImages] = useState<ChatAttachment[]>([]);
  const [uploading, setUploading] = useState(false), [voiceActive, setVoiceActive] = useState(false);
  const [recipients, setRecipients] = useState<string[]>([]);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [connected, setConnected] = useState(false);
  const [older, setOlder] = useState(false);
  const generation = useRef(0);
  const feed = useRef<HTMLElement>(null);
  const follow = useRef(true);
  useEffect(() => { if (follow.current && feed.current) feed.current.scrollTop = feed.current.scrollHeight; }, [detail?.messages]);
  const writable = status.mode === 'write';
  const endpoint = `/groups/${status.groupId}`;
  useEffect(() => {
    let active = true;
    let loading = false;
    let dirty = false;
    const refresh = async () => {
      if (loading) { dirty = true; return; }
      loading = true;
      do {
        dirty = false;
        const version = ++generation.current;
        try {
          const [next, group] = await Promise.all([api<AppState>('/state'), api<GroupDetail>(endpoint)]);
          if (active && version === generation.current) {
            setState(next);
            setDetail(current => ({ ...group, page: current?.messages.length && current.messages.length > group.messages.length ? current.page : group.page, messages: merge(current?.messages ?? [], group.messages) }));
            setError('');
          }
        } catch (cause) { if (active) setError(cause instanceof Error ? cause.message : '无法读取群聊'); }
      } while (dirty && active);
      loading = false;
    };
    void refresh();
    const events = new EventSource(appUrl('/api/events'));
    events.onopen = () => { setConnected(true); void refresh(); };
    events.onerror = () => { setConnected(false); void refresh(); };
    events.addEventListener('state', () => void refresh());
    return () => { active = false; events.close(); };
  }, [endpoint]);
  const members = state?.sessions ?? [];
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if ((!text.trim() && !images.length) || busy || uploading || voiceActive || !writable) return;
    setBusy(true); setError(''); setNotice('');
    try {
      const message = await api<GroupMessage & { deliveryErrors?: { error: string }[] }>(`${endpoint}/messages`, {
        attachments: images.map(item => item.id), text: text.trim(), kind: recipients.length ? 'task' : 'note', recipientIds: recipients, deliverNow: true,
      });
      setDetail(current => current && ({ ...current, messages: merge(current.messages, [message]) }));
      setText(''); setImages([]); setRecipients([]);
      if (message.deliveryErrors?.length) setNotice(`消息已保存，部分任务未送达：${message.deliveryErrors.map(item => item.error).join('；')}`);
    } catch (cause) { setError(cause instanceof Error ? cause.message : '发送失败'); }
    finally { setBusy(false); }
  };
  const loadOlder = async () => {
    if (older || detail?.page?.before == null) return;
    setOlder(true);
    try {
      const page = await api<GroupDetail>(`${endpoint}?before=${detail.page.before}`);
      setDetail(current => current && ({ ...current, page: page.page, messages: merge(page.messages, current.messages) }));
    } catch (cause) { setError(cause instanceof Error ? cause.message : '加载失败'); }
    finally { setOlder(false); }
  };
  return <main className="app-shell share-shell group-share-shell">
    <header className="share-topbar"><div className="share-heading"><h1>{detail?.group.title ?? '共享群聊'}</h1><p>{detail?.group.goal}</p></div>
      <span className="share-role">{writable ? '可协作' : '只读'} · {status.name} · {connected ? '已连接' : '重连中'}</span>
      <button className="button secondary small-button" onClick={() => void api('/auth/logout', {}).finally(() => location.reload())}>退出共享</button>
    </header>
    {error && <p role="alert" className="form-error">{error}</p>}
    {notice && <p role="status">{notice}</p>}
    <div className="group-member-strip" aria-label="群成员">{members.map(member => <span className="group-member-chip" key={member.id}>{member.title} · {member.running ? '运行中' : '未运行'}</span>)}</div>
    <section ref={feed} onScroll={() => { const node = feed.current; if (node) follow.current = node.scrollHeight - node.scrollTop - node.clientHeight < 100; }} aria-label="群消息" style={{ flex: 1, overflow: 'auto', padding: '16px' }}>
      {detail?.page?.before != null && <button className="button secondary" disabled={older} onClick={() => void loadOlder()}>加载更早消息</button>}
      {!detail && <p>正在加载群聊…</p>}
      {detail?.messages.map(message => <article key={message.id} className="group-share-message">
        <strong>{message.senderName}</strong> <time>{new Date(message.createdAt).toLocaleString()}</time>
        {!!message.recipientIds.length && <p>{message.recipientIds.map(id => `@${members.find(member => member.id === id)?.title ?? '群成员'}`).join(' ')}</p>}
        <GroupImages groupId={status.groupId!} items={message.attachments} /><Markdown text={message.text} />
      </article>)}
    </section>
    {writable ? <form onSubmit={submit} style={{ padding: '16px' }}>
      <fieldset disabled={busy}><legend>分派给成员（不选则发送群消息）</legend>{members.map(member => <label key={member.id} style={{ marginRight: 12 }}><input type="checkbox" checked={recipients.includes(member.id)} onChange={event => setRecipients(current => event.target.checked ? [...current, member.id] : current.filter(id => id !== member.id))} />@{member.title}</label>)}</fieldset>
      <ImageAttachments sessionId={status.groupId!} scope="groups" actions={<><VoiceInput sessionId={status.groupId!} scope="groups" disabled={busy || uploading} onActive={setVoiceActive} insert={speech => setText(current => appendVoiceText(current, speech))} />
      <button className="button primary" disabled={busy || uploading || voiceActive || (!text.trim() && !images.length)}>{busy ? '发送中…' : recipients.length ? '发送并分派' : '发送'}</button></>} items={images} onChange={setImages} onBusy={setUploading} disabled={busy}>
      <textarea disabled={busy} aria-label="群消息内容" placeholder="输入群消息或任务…" value={text} maxLength={30000} rows={3} onChange={event => setText(event.target.value)} style={{ width: '100%' }} />
      </ImageAttachments>

    </form> : <p className="form-note" style={{ padding: 16 }}>这是只读分享，可以查看群聊进展。</p>}
  </main>;
}
function merge(previous: GroupMessage[], incoming: GroupMessage[]) {
  const byId = new Map(previous.map(message => [message.id, message]));
  incoming.forEach(message => byId.set(message.id, message));
  return [...byId.values()].sort((a, b) => a.sequence !== undefined && b.sequence !== undefined ? a.sequence - b.sequence : a.createdAt.localeCompare(b.createdAt));
}
