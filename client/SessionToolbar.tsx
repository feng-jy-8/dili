import { createContext, useContext, useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { SlidersHorizontal } from 'lucide-react';
import './session-toolbar.css';

type Chrome = { host: HTMLDivElement | null; setHost: (host: HTMLDivElement | null) => void; fullscreen: boolean; toggleFullscreen: () => void };
const SessionChromeContext = createContext<Chrome | null>(null);

/** Child panes keep ownership of their actions; only their DOM moves into the title row. */
export function SessionChrome({ children, fullscreen, toggleFullscreen }: { children: ReactNode; fullscreen: boolean; toggleFullscreen: () => void }) {
  const [host, setHost] = useState<HTMLDivElement | null>(null);
  return <SessionChromeContext value={{ host, setHost, fullscreen, toggleFullscreen }}>{children}</SessionChromeContext>;
}
export const useSessionChrome = () => useContext(SessionChromeContext);
export function SessionToolbarHost() {
  const chrome = useSessionChrome();
  return <div className="session-toolbar-host" ref={chrome?.setHost} />;
}
export function SessionToolbar({ children, className }: { children: ReactNode; className: string }) {
  const chrome = useSessionChrome();
  const toolbar = <div className={`${className}${chrome ? ' session-pane-toolbar' : ''}`}>{children}</div>;
  return chrome ? chrome.host && createPortal(toolbar, chrome.host) : toolbar;
}

/** Inline on wide panes; an accessible popover on narrow panes, without duplicating controls. */
export function PaneToolOverflow({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const id = useId();
  const root = useRef<HTMLDivElement>(null), trigger = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => { if (!root.current?.contains(event.target as Node)) setOpen(false); };
    document.addEventListener('pointerdown', outside);
    return () => document.removeEventListener('pointerdown', outside);
  }, [open]);
  return <div className="pane-tool-overflow" ref={root} onKeyDown={event => {
    if (event.key === 'Escape' && open) { event.preventDefault(); event.stopPropagation(); setOpen(false); trigger.current?.focus(); }
  }}>
    <button ref={trigger} className="icon-button pane-tools-trigger" type="button" aria-label="会话工具" title="会话工具" aria-expanded={open} aria-controls={id} onClick={() => setOpen(value => !value)}><SlidersHorizontal size={15} /></button>
    <div id={id} className="pane-tools-panel" data-open={open} onClick={event => {
      if (trigger.current?.offsetParent && (event.target as Element).closest('button:not(:disabled)')) {
        setOpen(false);
        if (event.currentTarget.contains(document.activeElement)) trigger.current?.focus({ preventScroll: true });
      }
    }}>{children}</div>
  </div>;
}
