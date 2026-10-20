import { useEffect, useRef, useState } from 'react';
import type { Session } from '../shared/types';
import type { ChatAttachment } from '../shared/attachments';
import { api, ApiError } from './api';
import ImageAttachments from './ImageAttachments';
import Markdown from './Markdown';
import ResizableComposer from './ResizableComposer';
import './attachments.css';

type Draft = { text: string; attachments: ChatAttachment[]; pending?: string };
const key = (id: string) => 'dili.native-input-draft.' + id;
function read(id: string): Draft {
  try { const value = JSON.parse(sessionStorage.getItem(key(id)) || 'null'); if (value && typeof value.text === 'string') return { text:value.text.slice(0,30000), attachments:Array.isArray(value.attachments) ? value.attachments.filter((item: ChatAttachment)=>item && typeof item.id === 'string' && typeof item.name === 'string').slice(0,8) : [], ...(typeof value.pending === 'string' ? {pending:value.pending} : {}) }; } catch { /* invalid drafts are ignored */ }
  return {text:'',attachments:[]};
}
export default function NativeInputComposer({session,onTerminal}: {session:Session;onTerminal():void}) {
  const [draft,setDraft] = useState(() => read(session.id));
  const [busy,setBusy] = useState(false), [uploading,setUploading] = useState(false), [preview,setPreview] = useState(false), [error,setError] = useState('');
  const latest = useRef(draft); latest.current = draft;
  const active = useRef(true);
  useEffect(() => {
    active.current = true;
    const refresh = (event: Event) => { if ((event as CustomEvent).detail?.id === session.id) { const value = read(session.id); latest.current = value; setDraft(value); } };
    window.addEventListener('dili:native-draft', refresh);
    return () => {active.current = false; window.removeEventListener('dili:native-draft', refresh);};
  },[session.id]);
  function update(value: Draft) {
    latest.current = value;
    let saved = true;
    try { sessionStorage.setItem(key(session.id),JSON.stringify(value)); } catch { saved = false; if (active.current) setError('无法保存草稿，请检查浏览器存储权限'); }
    if (active.current) setDraft(value);
    else window.dispatchEvent(new CustomEvent('dili:native-draft', {detail: {id: session.id}}));
    return saved;
  }
  async function stage() {
    if (busy || uploading || latest.current.pending || (!latest.current.text.trim() && !latest.current.attachments.length)) return;
    setBusy(true); setError('');
    let pending: string | undefined;
    try {
      const native = await api<{generation:string|null}>('/sessions/' + session.id + '/input');
      if (!active.current) return;
      if (!native.generation) throw new Error('请先启动原生终端');
      const sent = latest.current;
      pending = typeof crypto.randomUUID === 'function' ? crypto.randomUUID() : Array.from(crypto.getRandomValues(new Uint8Array(16)), value => value.toString(16).padStart(2,'0')).join('');
      if (!update({...sent,pending})) { update({...sent,pending:undefined}); pending = undefined; throw new Error('无法保存本次填入状态，请允许浏览器存储后重试'); }
      const result = await api<{status:string}>('/sessions/' + session.id + '/input', {text:sent.text,attachments:sent.attachments.map(item=>item.id),generation:native.generation,requestId:pending});
      if (result.status !== 'accepted') throw new Error('填入结果尚未确认，请先检查原生输入');
      const current = active.current ? latest.current : read(session.id);
      if (current.pending === pending) update({text:current.text === sent.text ? '' : current.text, attachments:current.attachments.filter(item=>!sent.attachments.some(value=>value.id === item.id))});
      if (active.current) onTerminal();
    } catch (cause) {
      if (pending && cause instanceof ApiError && cause.status >= 400 && cause.status < 500) {
        const current = active.current ? latest.current : read(session.id);
        if (current.pending === pending) update({...current,pending:undefined});
      }
      if (active.current) setError(cause instanceof Error ? cause.message : '填入失败');
    } finally { if(active.current) setBusy(false); }
  }
  const field = <>{preview && <div className="composer-preview" aria-label="消息 Markdown 预览"><Markdown text={draft.text || '还没有文字内容'}/></div>}<textarea aria-label="原生会话消息草稿" value={draft.text} maxLength={30000} rows={3} placeholder="写下消息，支持 Markdown；填入原生终端后确认发送" disabled={session.archived} onChange={event=>{try {update({...latest.current,text:event.target.value});} catch {setError('无法保存草稿，请检查浏览器存储权限');}}}/></>;
  return <ResizableComposer><div className="native-input-composer">
    {['claude','dsh'].includes(session.backend) ? <ImageAttachments sessionId={session.id} items={draft.attachments} onChange={change=>{ const current = active.current ? latest.current : read(session.id); update({...current,attachments:change(current.attachments)}); }} onBusy={setUploading} disabled={!!draft.pending || busy || session.archived}>{field}</ImageAttachments> : field}
    {error && <p className="attachment-error" role="alert">{error}</p>}
    {draft.pending && !busy && <div role="status"><p>内容可能已填入原生输入，请核对后继续，避免重复填入。</p><button type="button" className="text-button" onClick={onTerminal}>查看原生输入</button><button type="button" className="text-button" onClick={()=>update({...latest.current,pending:undefined})}>已核对，恢复草稿</button></div>}
    <div className="native-input-footer"><span>填入后到终端按回车；换行会转为空格</span><div><button className="text-button" type="button" aria-pressed={preview} onClick={()=>setPreview(value=>!value)}>Markdown 预览</button><button type="button" className="button primary small-button" disabled={busy || uploading || !!draft.pending || session.archived || !session.running || (!draft.text.trim() && !draft.attachments.length)} onClick={()=>void stage()}>{busy ? '正在填入…' : '填入原生终端'}</button></div></div>
  </div></ResizableComposer>;
}
