import { useEffect, useRef, useState } from 'react';
import { Info, X } from 'lucide-react';
import './notice-toasts.css';

export type Notice = { id: string; text: string };
const storageKey = (scope: string) => 'dili.dismissed-notices.' + scope;

/** Informational notices never take space from the conversation. Remember
 * dismissal for this browser tab, including stream refreshes and reopened views. */
export default function NoticeToasts({ scope, notices }: { scope: string; notices: Notice[] }) {
  return <ScopedNotices key={scope} scope={scope} notices={notices} />;
}

function ScopedNotices({ scope, notices }: { scope: string; notices: Notice[] }) {
  const [dismissed, setDismissed] = useState<Set<string>>(() => {
    try { const saved: unknown = JSON.parse(sessionStorage.getItem(storageKey(scope)) || '[]'); return new Set(Array.isArray(saved) ? saved.filter((id): id is string => typeof id === 'string').slice(-100) : []); } catch { return new Set(); }
  });
  function dismiss(id: string) {
    setDismissed(previous => {
      const next = new Set([...previous, id].slice(-100));
      try { sessionStorage.setItem(storageKey(scope), JSON.stringify([...next])); } catch { /* In-memory dismissal still works. */ }
      return next;
    });
  }
  return <div className="conversation-notices" aria-label="会话提示">{notices.filter(item => item.text && !dismissed.has(item.id)).map(item => <NoticeToast key={item.id} notice={item} dismiss={() => dismiss(item.id)} />)}</div>;
}

function NoticeToast({ notice, dismiss }: { notice: Notice; dismiss(): void }) {
  const [hovered, setHovered] = useState(false), [focused, setFocused] = useState(false);
  const dismissRef = useRef(dismiss); dismissRef.current = dismiss;
  useEffect(() => {
    if (hovered || focused) return;
    const timer = setTimeout(() => dismissRef.current(), 6000);
    return () => clearTimeout(timer);
  }, [hovered, focused]);
  return <div className="conversation-notice-toast" role="status" onMouseEnter={() => setHovered(true)} onMouseLeave={() => setHovered(false)} onFocus={() => setFocused(true)} onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget)) setFocused(false); }}>
    <Info size={16} aria-hidden="true" /><p>{notice.text}</p><button type="button" className="icon-button" aria-label="关闭此提示" title="关闭提示" onClick={dismiss}><X size={15} /></button>
  </div>;
}
