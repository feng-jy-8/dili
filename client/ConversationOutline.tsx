import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { List, Search, X } from 'lucide-react';
import './conversation-outline.css';

export interface OutlineEntry { id: string; text: string }

/** Native dialog supplies focus trapping and Escape on narrow workspaces. */
export default function ConversationOutline({ id, open, compact, entries, selectedId, truncated, close, select, loadOlder, loadingOlder = false }: {
  id: string; open: boolean; compact: boolean; entries: OutlineEntry[]; selectedId: string | null;
  truncated: boolean; close: () => void; select: (id: string) => void;
  loadOlder?: () => void; loadingOlder?: boolean;
}) {
  const [query, setQuery] = useState('');
  const dialog = useRef<HTMLDialogElement>(null);
  const panel = useRef<HTMLElement>(null);
  const normalize = (text: string) => text.replace(/\s+/g, ' ').trim().toLocaleLowerCase();
  const search = normalize(query);
  const matches = entries.map((entry, index) => ({ ...entry, number: index + 1 }))
    .filter(entry => !search || normalize(entry.text).includes(search));

  useEffect(() => {
    if (!open) return;
    if (compact) {
      const element = dialog.current;
      element?.showModal();
      element?.querySelector<HTMLInputElement>('input')?.focus({ preventScroll: true });
      return () => { element?.close(); };
    }
    panel.current?.querySelector<HTMLInputElement>('input')?.focus({ preventScroll: true });
  }, [compact, open]);

  if (!open) return null;
  function dismiss() { dialog.current?.close(); close(); }
  const contents = <>
    <header className="conversation-outline-heading"><h3><List size={15} />对话目录</h3><button type="button" className="icon-button" aria-label="关闭对话目录" title="关闭对话目录" onClick={dismiss}><X size={16} /></button></header>
    <label className="conversation-outline-search"><Search size={14} /><input type="search" aria-label="筛选用户输入" placeholder="搜索你说过的话…" value={query} onChange={event => setQuery(event.target.value)} /></label>
    <p className="conversation-outline-count">{search ? `${matches.length} / ${entries.length} 条输入` : `已加载 · ${entries.length} 条输入`}</p>
    {truncated && <p className="conversation-outline-notice">仅列出当前已加载的输入；可在对话中加载更早消息，记录过长时可能有所省略。</p>}
    {loadOlder && <button type="button" className="conversation-outline-more" disabled={loadingOlder} onClick={loadOlder}>{loadingOlder ? '正在加载目录…' : '加载更早输入'}</button>}
    <nav className="conversation-outline-list" aria-label="用户输入目录">
      {matches.length ? <ol>{matches.map(entry => <li key={entry.id}><button type="button" aria-current={entry.id === selectedId ? 'location' : undefined} title={entry.text || '附件或空白输入'} onClick={() => {
        // close() restores the invoker before select() focuses the message.
        if (compact) dismiss();
        select(entry.id);
      }}><span className="conversation-outline-number">{entry.number}</span><span className="conversation-outline-text">{entry.text.replace(/\s+/g, ' ').trim() || '附件或空白输入'}</span></button></li>)}</ol>
        : <p className="conversation-outline-empty" role="status">{search ? '没有匹配的输入' : '还没有用户输入'}</p>}
    </nav>
  </>;
  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key !== 'Escape' || event.nativeEvent.isComposing) return;
    event.preventDefault(); event.stopPropagation(); dismiss();
  };
  return compact ? <dialog ref={dialog} id={id} className="conversation-outline conversation-outline-dialog" aria-label="对话目录" onKeyDown={onKeyDown} onCancel={event => { event.preventDefault(); dismiss(); }} onClick={event => {
    if (event.target !== event.currentTarget) return;
    const bounds = event.currentTarget.getBoundingClientRect();
    if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) dismiss();
  }}>{contents}</dialog> : <aside ref={panel} id={id} className="conversation-outline" aria-label="对话目录" onKeyDown={onKeyDown}>{contents}</aside>;
}
