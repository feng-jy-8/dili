import { useId } from 'react';
import { useInterfaceZoom } from './zoom';

export default function InterfaceZoom() {
  const [zoom, setZoom] = useInterfaceZoom();
  const id = useId();
  return <section className="interface-zoom" aria-label="界面缩放设置">
    <div className="interface-zoom-heading"><label htmlFor={id}>界面缩放</label><output htmlFor={id}>{zoom}%</output><button type="button" className="text-button" disabled={zoom === 100} onClick={() => setZoom(100)}>恢复 100%</button></div>
    <input id={id} type="range" min={100} max={200} step={1} value={zoom} aria-valuetext={`${zoom}%`} onChange={event => { setZoom(Number(event.target.value)); const field = event.currentTarget; requestAnimationFrame(() => field.scrollIntoView({ block: 'nearest', inline: 'nearest' })); }} />
    <div className="interface-zoom-range"><span>100%</span><span>200%</span></div>
    <p>拖动滑块调整整个工作台大小，立即生效并在此浏览器中保存。</p>
  </section>;
}
