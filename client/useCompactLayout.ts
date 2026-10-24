import { useLayoutEffect, useSyncExternalStore, type RefObject } from 'react';
import { viewportHeight } from './zoom';

/** Same breakpoint as the phone layout in styles.css. */
const query = typeof window !== 'undefined' ? window.matchMedia('(max-width: 720px)') : null;
function subscribe(listener: () => void) {
  query?.addEventListener('change', listener);
  return () => query?.removeEventListener('change', listener);
}
export function useCompactLayout(): boolean {
  return useSyncExternalStore(subscribe, () => !!query?.matches, () => false);
}

/** IM-style composer field: one line when empty, growing with its text up to
 * six lines or 35% of the visible height, then scrolling inside. Safari has no
 * `field-sizing: content`, so the height is measured. Inactive on wide screens,
 * where the resizable composer owns the height. */
export function useAutoGrow(field: RefObject<HTMLTextAreaElement | null>, value: string, enabled: boolean) {
  useLayoutEffect(() => {
    const element = field.current;
    if (!element) return;
    if (!enabled) { element.style.height = ''; element.style.overflowY = ''; return; }
    const fit = () => {
      const style = getComputedStyle(element);
      const line = parseFloat(style.lineHeight) || 24;
      const chrome = parseFloat(style.paddingTop) + parseFloat(style.paddingBottom) + parseFloat(style.borderTopWidth) + parseFloat(style.borderBottomWidth);
      const max = Math.max(line + chrome, Math.min(line * 6 + chrome, viewportHeight() * .35));
      element.style.height = 'auto';
      const height = Math.min(element.scrollHeight + parseFloat(style.borderTopWidth) + parseFloat(style.borderBottomWidth), max);
      element.style.height = `${height}px`;
      element.style.overflowY = element.scrollHeight > height ? 'auto' : 'hidden';
    };
    fit();
    const observer = new ResizeObserver(() => fit());
    observer.observe(element.parentElement ?? element);
    return () => observer.disconnect();
  }, [field, value, enabled]);
}

/** Like an IM list: a finger drag through the messages dismisses the keyboard.
 * Only real touch drags reach this; programmatic scrolling never blurs. */
export function dismissKeyboard() {
  const active = document.activeElement;
  if (active instanceof HTMLElement && active.matches('textarea, input')) active.blur();
}
