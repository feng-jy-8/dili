import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Maximize2, Minus, Plus, X } from 'lucide-react';
import { interfaceScale } from './zoom';
import './image-viewer.css';

/** Images keep rendered SVG inert; diagram markup never enters the app DOM. */
export default function ImageViewer({ src, width, height, title, close }: {
  src: string; width: number; height: number; title: string; close: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const viewport = useRef<HTMLDivElement>(null);
  const [bounds, setBounds] = useState({ width: 0, height: 0 });
  const [zoom, setZoom] = useState<number | 'fit'>('fit');
  const fit = bounds.width && bounds.height ? Math.min((bounds.width - 32) / width, (bounds.height - 32) / height, 8) : 1;
  const scale = zoom === 'fit' ? Math.max(0.01, fit) : zoom;
  const scaleRef = useRef(scale);
  scaleRef.current = scale;
  const drag = useRef<{ id: number; x: number; y: number; left: number; top: number } | null>(null);
  const [dragging, setDragging] = useState(false);
  const changeZoom = (next: number) => setZoom(Math.max(0.05, Math.min(8, next)));

  useEffect(() => {
    const node = dialog.current!;
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    node.showModal();
    return () => { node.close(); if (previous?.isConnected) previous.focus({ preventScroll: true }); };
  }, []);
  useLayoutEffect(() => {
    const node = viewport.current!;
    const observer = new ResizeObserver(() => setBounds({ width: node.clientWidth, height: node.clientHeight }));
    observer.observe(node);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    const node = viewport.current!;
    const wheel = (event: WheelEvent) => {
      event.preventDefault();
      if (event.deltaY) changeZoom(scaleRef.current * (event.deltaY < 0 ? 1.15 : 1 / 1.15));
    };
    node.addEventListener('wheel', wheel, { passive: false });
    return () => node.removeEventListener('wheel', wheel);
  }, []);
  const previousScale = useRef(scale);
  useLayoutEffect(() => {
    const node = viewport.current!;
    const ratio = scale / previousScale.current;
    node.scrollLeft = (node.scrollLeft + node.clientWidth / 2) * ratio - node.clientWidth / 2;
    node.scrollTop = (node.scrollTop + node.clientHeight / 2) * ratio - node.clientHeight / 2;
    previousScale.current = scale;
  }, [scale]);

  return createPortal(<dialog ref={dialog} className="image-viewer" aria-label={title} onCancel={event => { event.preventDefault(); close(); }} onClick={event => { if (event.target === event.currentTarget) close(); }} onKeyDown={event => {
    // Keep Escape and viewer shortcuts out of the underlying session/editor.
    event.stopPropagation();
    if (event.key === 'Escape') { event.preventDefault(); close(); }
    else if (event.key === '+' || event.key === '=') { event.preventDefault(); changeZoom(scale * 1.25); }
    else if (event.key === '-') { event.preventDefault(); changeZoom(scale / 1.25); }
    else if (event.key === '0') { event.preventDefault(); setZoom('fit'); }
  }}>
    <header className="image-viewer-toolbar">
      <strong>{title}</strong>
      <div role="group" aria-label="图表缩放">
        <button type="button" className="icon-button" aria-label="缩小图表" title="缩小 (-)" disabled={scale <= 0.05} onClick={() => changeZoom(scale / 1.25)}><Minus size={18} /></button>
        <button type="button" className="image-viewer-percent" aria-label="原始大小" title="原始大小" onClick={() => setZoom(1)}>{Math.round(scale * 100)}%</button>
        <button type="button" className="icon-button" aria-label="放大图表" title="放大 (+)" disabled={scale >= 8} onClick={() => changeZoom(scale * 1.25)}><Plus size={18} /></button>
        <button type="button" className="icon-button" aria-label="适应窗口" title="适应窗口 (0)" onClick={() => setZoom('fit')}><Maximize2 size={18} /></button>
      </div>
      <button type="button" className="icon-button" aria-label="关闭图表预览" title="关闭 (Esc)" autoFocus onClick={close}><X size={20} /></button>
    </header>
    <div ref={viewport} className={`image-viewer-viewport${dragging ? ' dragging' : ''}`} tabIndex={0} aria-label="图表画布" onDoubleClick={() => setZoom(zoom === 'fit' ? 1 : 'fit')} onPointerDown={event => {
      // Touch devices use native scrolling, including momentum and multi-touch.
      if (event.pointerType === 'touch' || event.button !== 0) return;
      const node = event.currentTarget;
      drag.current = { id: event.pointerId, x: event.clientX, y: event.clientY, left: node.scrollLeft, top: node.scrollTop };
      node.setPointerCapture(event.pointerId); setDragging(true); event.preventDefault();
    }} onPointerMove={event => {
      const start = drag.current;
      if (!start || start.id !== event.pointerId) return;
      event.currentTarget.scrollLeft = start.left - (event.clientX - start.x) / interfaceScale();
      event.currentTarget.scrollTop = start.top - (event.clientY - start.y) / interfaceScale();
    }} onPointerUp={event => { if (drag.current?.id === event.pointerId) { drag.current = null; setDragging(false); event.currentTarget.releasePointerCapture(event.pointerId); } }} onLostPointerCapture={() => { drag.current = null; setDragging(false); }}>
      <div className="image-viewer-canvas" style={{ width: width * scale + 32, height: height * scale + 32 }}>
        <img src={src} alt={title} draggable={false} style={{ width: width * scale, height: height * scale }} />
      </div>
    </div>
    <footer>滚轮缩放 · 拖动查看 · 双击切换原始大小 · Esc 关闭</footer>
  </dialog>, document.body);
}
