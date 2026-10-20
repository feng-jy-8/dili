import { useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { Splitter } from './WorkspaceExplorer';
import { readLocalPreference, writeLocalPreference } from './ui';
import './resizable-composer.css';

const HEIGHT = 'dili.composer.height', WIDTH = 'dili.composer.width-ratio';
function saved(key: string, fallback: number) {
  const raw = readLocalPreference(key), value = raw === null ? NaN : Number(raw);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}
/** Reuses workspace splitters; native forms, drafts and connections stay mounted. */
export default function ResizableComposer({ children }: { children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const [bounds, setBounds] = useState({ width: 600, height: 600 });
  const [height, setHeight] = useState(() => saved(HEIGHT, 190));
  const [ratio, setRatio] = useState(() => Math.min(1, saved(WIDTH, 1)));
  useLayoutEffect(() => {
    const parent = ref.current?.parentElement;
    if (!parent) return;
    const measure = () => setBounds({ width: parent.clientWidth, height: parent.clientHeight });
    measure(); const observer = new ResizeObserver(measure); observer.observe(parent);
    return () => observer.disconnect();
  }, []);
  const maxWidth = Math.max(0, bounds.width - 16), minWidth = Math.min(260, maxWidth);
  const width = Math.max(minWidth, Math.min(maxWidth, maxWidth * ratio));
  const minHeight = Math.min(160, Math.max(100, Math.floor(bounds.height * .4)));
  const maxHeight = Math.max(minHeight, Math.floor(bounds.height * .6));
  const actualHeight = Math.max(minHeight, Math.min(maxHeight, height));
  const changeWidth = (value: number) => setRatio(maxWidth ? value / maxWidth : 1);
  return <div ref={ref} className="resizable-composer" style={{ height: actualHeight }}>
    <Splitter label="调整输入区高度" orientation="horizontal" direction={-1} value={actualHeight} min={minHeight} max={maxHeight} onChange={setHeight} onCommit={value => writeLocalPreference(HEIGHT, String(value))} />
    <div className="resizable-composer-row" style={{ width }}>
      <Splitter label="调整输入区左侧宽度" direction={-1} value={width} min={minWidth} max={maxWidth} onChange={changeWidth} onCommit={value => writeLocalPreference(WIDTH, String(maxWidth ? value / maxWidth : 1))} />
      <div className="resizable-composer-content">{children}</div>
      <Splitter label="调整输入区右侧宽度" value={width} min={minWidth} max={maxWidth} onChange={changeWidth} onCommit={value => writeLocalPreference(WIDTH, String(maxWidth ? value / maxWidth : 1))} />
    </div>
  </div>;
}
