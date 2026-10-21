import { useEffect, useId, useMemo, useRef, useState } from 'react';
import mermaidUrl from 'vditor/dist/js/mermaid/mermaid.min.js?url';
import { useTheme } from './theme';
import { Maximize2 } from 'lucide-react';
import ImageViewer from './ImageViewer';

let renderer: Promise<string> | undefined;
function loadRenderer() {
  return renderer ??= fetch(mermaidUrl).then(response => { if (!response.ok) throw new Error('图表组件加载失败'); return response.text(); }).catch(error => { renderer = undefined; throw error; });
}
const scriptValue = (value: unknown) => JSON.stringify(value).replace(/</g, '\\u003c');

/** Run the existing bundled renderer in an opaque-origin sandbox. Diagrams
 * cannot execute in the workbench, access credentials or fetch remote media. */
export default function MermaidDiagram({ source }: { source: string }) {
  const id = useId();
  const [settledSource, setSettledSource] = useState(source);
  useEffect(() => { const timer = setTimeout(() => setSettledSource(source), 300); return () => clearTimeout(timer); }, [source]);
  const frame = useRef<HTMLIFrameElement>(null);
  const [theme] = useTheme();
  const [scheme, setScheme] = useState(document.documentElement.dataset.colorScheme);
  const [library, setLibrary] = useState('');
  const [height, setHeight] = useState(180);
  const [image, setImage] = useState<{ svg: string; width: number; height: number } | null>(null);
  const [imageUrl, setImageUrl] = useState('');
  const [expanded, setExpanded] = useState(false);
  useEffect(() => {
    if (!image) { setImageUrl(''); return; }
    const url = URL.createObjectURL(new Blob([image.svg], { type: 'image/svg+xml' }));
    setImageUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [image]);
  useEffect(() => { let active = true; void loadRenderer().then(value => { if(active) setLibrary(value); }).catch(() => { if(active) setStatus('图表组件加载失败，可展开源码查看'); }); return () => {active = false;}; }, []);
  const [status, setStatus] = useState('正在绘制图表…');
  useEffect(() => {
    const observer = new MutationObserver(() => setScheme(document.documentElement.dataset.colorScheme));
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-color-scheme'] });
    return () => observer.disconnect();
  }, []);
  const documentSource = useMemo(() => {
    const nonce = crypto.randomUUID?.() ?? Math.random().toString(36).slice(2);
    const style = getComputedStyle(document.documentElement);
    const bg = style.getPropertyValue('--bg').trim() || '#fff';
    const color = style.getPropertyValue('--text').trim() || '#222';
    const script = `
      const engine = document.createElement('script'); engine.nonce=${scriptValue(nonce)}; engine.textContent=${scriptValue(library)}; document.head.append(engine);
      const report = (status, height) => parent.postMessage({type:'dili-diagram',id:${scriptValue(id)},status,height},'*');
      try {
        mermaid.initialize({startOnLoad:false,securityLevel:'strict',suppressErrorRendering:true,maxTextSize:24000,maxEdges:300,theme:${scriptValue(scheme === 'dark' ? 'dark' : 'default')},flowchart:{htmlLabels:false},fontFamily:'system-ui, sans-serif'});
        mermaid.render('diagram', ${scriptValue(settledSource)}).then(result => {
          document.getElementById('chart').innerHTML=result.svg;
          const svg=document.querySelector('svg'); if(svg){svg.style.maxWidth='100%';svg.style.height='auto';}
          if(svg){const box=svg.viewBox.baseVal;parent.postMessage({type:'dili-diagram',id:${scriptValue(id)},status:'image',svg:new XMLSerializer().serializeToString(svg),width:box.width,height:box.height},'*');}
          const size=()=>report('ready',Math.ceil(document.body.getBoundingClientRect().height)+4);
          new ResizeObserver(size).observe(document.body); size();
        }).catch(()=>{document.body.textContent='图表暂时无法解析，请查看源码';report('error',64);});
      } catch { report('error',64); }
    `;
    return `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'nonce-${nonce}'; style-src 'unsafe-inline'; img-src data:; base-uri 'none'; form-action 'none'"><style>html,body{margin:0;background:${bg};color:${color};font:13px system-ui}body{padding:8px;box-sizing:border-box}svg{display:block;margin:auto}#chart{overflow:auto}</style></head><body><div id="chart"></div><script nonce="${nonce}">${script}</script></body></html>`;
  }, [settledSource, library, id, theme, scheme]);
  useEffect(() => {
    if (!library) return;
    setStatus('正在绘制图表…');
    setImage(null); setExpanded(false);
    const timeout = setTimeout(() => setStatus('图表加载较慢，可展开源码查看'), 15000);
    const receive = (event: MessageEvent) => {
      if (event.source !== frame.current?.contentWindow || event.data?.type !== 'dili-diagram' || event.data.id !== id) return;
      if (typeof event.data.height === 'number' && Number.isFinite(event.data.height)) setHeight(Math.max(64, Math.min(1400, event.data.height)));
      if (event.data.status === 'ready') { setStatus(''); clearTimeout(timeout); }
      if (event.data.status === 'error') { setStatus('图表尚未完整或语法有误，可展开源码查看'); clearTimeout(timeout); }
      if (event.data.status === 'image' && typeof event.data.svg === 'string' && event.data.svg.length <= 2_000_000 && Number.isFinite(event.data.width) && event.data.width > 0 && Number.isFinite(event.data.height) && event.data.height > 0) {
        setImage({ svg: event.data.svg, width: event.data.width, height: event.data.height });
      }
    };
    window.addEventListener('message', receive);
    return () => { clearTimeout(timeout); window.removeEventListener('message', receive); };
  }, [documentSource, id]);
  // Streaming diagrams often have incomplete syntax. Keep a stable source
  // fallback, and let each completed version replace its own sandbox.
  if (source.length > 24000) return <div className="mermaid-diagram"><p>图表超过显示上限，请查看源码</p><pre>{source}</pre></div>;
  return <div className="mermaid-diagram">
    {status && <p role="status">{status}</p>}
    <div className="mermaid-preview">
      <iframe ref={frame} title="Mermaid 图表" sandbox="allow-scripts" referrerPolicy="no-referrer" srcDoc={library ? documentSource : undefined} style={{ height }} tabIndex={-1} />
      {imageUrl && <button type="button" className="mermaid-expand" aria-label="放大 Mermaid 图表" title="点击放大图表" onClick={() => setExpanded(true)}><span><Maximize2 size={14} />点击放大</span></button>}
    </div>
    <details><summary>图表源码</summary><pre>{source}</pre></details>
    {expanded && imageUrl && image && <ImageViewer src={imageUrl} width={image.width} height={image.height} title="Mermaid 图表预览" close={() => setExpanded(false)} />}
  </div>;
}
