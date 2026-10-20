import { useEffect, useRef, useState } from 'react';
import Vditor from 'vditor';
import luteUrl from 'vditor/dist/js/lute/lute.min.js?url';
import localeUrl from 'vditor/dist/js/i18n/zh_CN.js?url';
import iconsUrl from 'vditor/dist/js/icons/ant.js?url';
import 'vditor/dist/index.css';
import './live-markdown.css';
import { MAX_SCRATCHPAD_LENGTH } from '../shared/scratchpad';

const scripts = new Map<string, Promise<void>>();

/** Keep source markers intact, but never insert executable HTML or fetch media.
 * A template is inert, unlike a detached div which can start image requests. */
function localPreview(html: string): string {
  const template = document.createElement('template');
  template.innerHTML = html;
  template.content.querySelectorAll<HTMLElement>('[data-type="html-block"], [data-type="html-inline"]').forEach(node => {
    const source = node.querySelector('code')?.textContent ?? '';
    node.querySelectorAll('.vditor-ir__preview').forEach(preview => { preview.textContent = source; });
  });
  template.content.querySelectorAll('.vditor-ir__preview').forEach(node => node.setAttribute('data-render', '1'));
  template.content.querySelectorAll('img,iframe,script,style,link,object,embed,video,audio,source').forEach(node => node.remove());
  template.content.querySelectorAll('*').forEach(node => {
    for (const attribute of [...node.attributes]) {
      if (/^on/i.test(attribute.name) || ['src', 'srcset', 'style', 'formaction'].includes(attribute.name)) node.removeAttribute(attribute.name);
    }
  });
  return template.innerHTML;
}

function restrictPreview(editor: Vditor) {
  const lute = editor.vditor.lute;
  for (const method of ['Md2VditorIRDOM', 'SpinVditorIRDOM', 'HTML2VditorIRDOM'] as const) {
    const render = lute[method].bind(lute);
    lute[method] = (source: string) => localPreview(render(source));
  }
}
function loadScript(id: string, src: string): Promise<void> {
  if (scripts.has(id) && document.getElementById(id)) return scripts.get(id)!;
  const promise = new Promise<void>((resolve, reject) => {
    const element = document.createElement('script'); element.id = id; element.src = src;
    const timer = setTimeout(() => failed(), 15_000);
    const failed = () => { clearTimeout(timer); element.remove(); scripts.delete(id); reject(new Error('编辑器资源加载失败，请重试或使用源码模式')); };
    element.onload = () => { clearTimeout(timer); resolve(); };
    element.onerror = failed; document.head.appendChild(element);
  });
  scripts.set(id, promise); return promise;
}

/** Uncontrolled editing keeps the caret and native undo stack across saves. */
export default function LiveMarkdownEditor({ value, onChange, onBlur, focusRequest = 0 }: {
  value: string; onChange: (markdown: string) => void; onBlur: () => void; focusRequest?: number;
}) {
  const host = useRef<HTMLDivElement>(null);
  const instance = useRef<Vditor | null>(null);
  const props = useRef({ value, onChange, onBlur, focusRequest });
  props.current = { value, onChange, onBlur, focusRequest };
  const externalValue = useRef(value);
  const applyValue = useRef<(value: string) => void>(() => {});
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (!host.current) return;
    let disposed = false, initialized = false, changed = false, applying = false, composing = false;
    let editor: Vditor | null = null;
    let lastMarkdown = '', lastAccepted = props.current.value;
    const surface = host.current;
    const syncTheme = () => {
      if (initialized && !disposed) editor?.setTheme(document.documentElement.dataset.colorScheme === 'dark' ? 'dark' : 'classic');
    };
    const observer = new MutationObserver(syncTheme);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    const emit = () => {
      if (!initialized || disposed || applying || composing || !changed || !editor) return;
      const markdown = editor.getValue();
      if (markdown === lastMarkdown) return;
      if (markdown.length > MAX_SCRATCHPAD_LENGTH) {
        applying = true; editor.setValue(lastAccepted); applying = false;
        lastMarkdown = editor.getValue();
        setError('笔记最多 30,000 字符，这次超出限制的输入未加入笔记。');
        return;
      }
      lastMarkdown = markdown; lastAccepted = markdown; externalValue.current = markdown;
      props.current.onChange(markdown);
    };
    const input = () => { changed = true; queueMicrotask(emit); };
    const paste = (event: ClipboardEvent) => {
      changed = true;
      // Paste Markdown/plain text. Rich HTML can otherwise initiate requests
      // inside the library's clipboard conversion before reaching the parser.
      if (event.clipboardData?.getData('text/html') || event.clipboardData?.files.length) {
        event.preventDefault(); event.stopImmediatePropagation();
        const data = new DataTransfer(); data.setData('text/plain', event.clipboardData.getData('text/plain'));
        event.target?.dispatchEvent(new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData: data }));
      }
      queueMicrotask(emit);
    };
    const drop = (event: DragEvent) => { event.preventDefault(); event.stopImmediatePropagation(); };
    const undoKey = (event: KeyboardEvent) => { if ((event.ctrlKey || event.metaKey) && /^[zy]$/i.test(event.key)) input(); };
    const compositionStart = () => { composing = true; changed = true; };
    const compositionEnd = () => { composing = false; queueMicrotask(emit); };
    const flush = () => { emit(); props.current.onBlur(); };
    // Capture actual edits so merely opening an existing document never
    // saves Vditor's normalized Markdown over the original source.
    surface.addEventListener('input', input, true);
    surface.addEventListener('change', input, true);
    surface.addEventListener('paste', paste, true);
    surface.addEventListener('drop', drop, true);
    surface.addEventListener('keydown', undoKey, true);
    surface.addEventListener('compositionstart', compositionStart, true);
    surface.addEventListener('compositionend', compositionEnd, true);
    document.addEventListener('visibilitychange', flush);
    window.addEventListener('pagehide', flush);
    setReady(false); setError('');
    void Promise.all([
      loadScript('vditorLuteScript', luteUrl), loadScript('vditorI18nScriptzh_CN', localeUrl), loadScript('vditorIconScript', iconsUrl),
    ]).then(() => {
      if (disposed) return;
      editor = new Vditor(surface, {
        mode: 'ir', value: '', lang: 'zh_CN', i18n: window.VditorI18n,
        _lutePath: luteUrl, cache: { enable: false }, height: '100%', minHeight: 0,
        toolbar: [], toolbarConfig: { hide: true }, undoDelay: 100,
        placeholder: '随手记下想法和待办…\n支持 Markdown，边写边呈现',
        theme: document.documentElement.dataset.colorScheme === 'dark' ? 'dark' : 'classic',
        preview: {
          mode: 'editor', hljs: { enable: false }, actions: [],
          theme: { current: '', path: '' }, render: { media: { enable: false } },
          markdown: { sanitize: true, codeBlockPreview: false, mathBlockPreview: false },
        },
        hint: { emoji: {} }, image: { isPreview: false }, link: { isOpen: false },
        input: emit, blur: flush,
        after: () => {
          if (!editor) return;
          initialized = true;
          if (disposed) { editor.destroy(); return; }
          instance.current = editor;
          restrictPreview(editor);
          applyValue.current = value => {
            if (!editor) return;
            applying = true; editor.setValue(value); applying = false;
            externalValue.current = value; lastAccepted = value;
            lastMarkdown = editor.getValue(); changed = false;
          };
          const editable = surface.querySelector<HTMLElement>('.vditor-ir [contenteditable]');
          editable?.setAttribute('role', 'textbox'); editable?.setAttribute('aria-label', '随手记实时编辑'); editable?.setAttribute('aria-multiline', 'true');
          // The note may have changed while the parser script was loading.
          applyValue.current(props.current.value);
          syncTheme(); setReady(true);
          if (props.current.focusRequest) editor.focus();
        },
      });
    }).catch(cause => { if (!disposed) setError(cause instanceof Error ? cause.message : '编辑器加载失败'); });
    return () => {
      emit(); disposed = true;
      surface.removeEventListener('input', input, true); surface.removeEventListener('change', input, true);
      surface.removeEventListener('paste', paste, true); surface.removeEventListener('drop', drop, true); surface.removeEventListener('keydown', undoKey, true);
      surface.removeEventListener('compositionstart', compositionStart, true); surface.removeEventListener('compositionend', compositionEnd, true);
      document.removeEventListener('visibilitychange', flush); window.removeEventListener('pagehide', flush); observer.disconnect();
      instance.current = null; applyValue.current = () => {};
      if (initialized && editor) editor.destroy();
    };
  }, [attempt]);

  useEffect(() => {
    const editor = instance.current;
    if (!editor || !ready || value === externalValue.current) return;
    // External changes are clear/undo/conflict decisions or a clean remote
    // update. Ordinary save acknowledgements never rebuild the editor DOM.
    applyValue.current(value);
  }, [value, ready]);
  useEffect(() => { if (ready && focusRequest) instance.current?.focus(); }, [focusRequest, ready]);
  return <div className="live-markdown-editor">
    {error && <div className="scratchpad-banner" role="alert"><p>{error}</p>{!ready && <button className="text-button" onClick={() => setAttempt(value => value + 1)}>重试加载</button>}</div>}
    {!ready && !error && <span className="live-markdown-loading">正在加载实时编辑器…</span>}
    <div ref={host} className="live-markdown-host" />
  </div>;
}
