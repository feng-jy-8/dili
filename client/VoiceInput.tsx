import { createPortal } from 'react-dom';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { LoaderCircle, Mic, Square, X } from 'lucide-react';
import { VOICE_MAX_BYTES, VOICE_MAX_FRAME, VOICE_MAX_SECONDS, VOICE_MIME_TYPES, type VoiceServerEvent, type VoiceStatus } from '../shared/voice';
import { api, getToken } from './api';
import { interfaceScale } from './zoom';
import { appUrl } from './urls';
import './voice.css';

type Phase = 'idle' | 'preparing' | 'loading' | 'recording' | 'finishing';
export function appendVoiceText(draft: string, speech: string) {
  const next = draft + (draft && !/\s$/.test(draft) ? '\n' : '') + speech.trim();
  if (next.length > 30000) throw new Error('输入框已满，请复制下方识别文字并分段发送');
  return next;
}

/** A recording owns its stream, socket and transcript; unmount discards late results. */
export default function VoiceInput({ sessionId, disabled, insert, onActive }: {
  sessionId: string; disabled?: boolean; insert(text: string): void; onActive(active: boolean): void;
}) {
  const root = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState({ bottom: 84, right: 24, maxHeight: 220 });
  const [phase, setPhase] = useState<Phase>('idle');
  const [transcript, setTranscript] = useState('');
  const [error, setError] = useState('');
  const [seconds, setSeconds] = useState(0);
  useLayoutEffect(() => {
    const composer = root.current?.closest('.resizable-composer');
    if (!composer) return;
    const measure = () => {
      const rect = composer.getBoundingClientRect(), scale = interfaceScale();
      setPosition({ bottom: Math.max(20, (innerHeight - rect.top) / scale + 8), right: Math.max(16, (innerWidth - rect.right) / scale), maxHeight: Math.max(40, Math.min(220, rect.top / scale - 20)) });
    };
    measure(); const observer = new ResizeObserver(measure); observer.observe(composer);
    window.addEventListener('resize', measure);
    return () => { observer.disconnect(); window.removeEventListener('resize', measure); };
  }, [phase]);
  const run = useRef(0), active = useRef(false);
  const stream = useRef<MediaStream | null>(null), recorder = useRef<MediaRecorder | null>(null), socket = useRef<WebSocket | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const ticker = useRef<ReturnType<typeof setInterval> | undefined>(undefined);
  const props = useRef({ insert, onActive }); props.current = { insert, onActive };
  const release = () => {
    if (recorder.current?.state === 'recording') { recorder.current.ondataavailable = null; recorder.current.onstop = null; recorder.current.stop(); }
    recorder.current = null; stream.current?.getTracks().forEach(track => track.stop()); stream.current = null;
    socket.current?.close(); socket.current = null;
    clearTimeout(timer.current); clearInterval(ticker.current);
  };
  const finish = () => { run.current++; active.current = false; release(); setPhase('idle'); props.current.onActive(false); };
  useEffect(() => () => { run.current++; active.current = false; release(); }, [sessionId]);
  function cancel() { finish(); setTranscript(''); setError(''); }
  function stop() {
    if (recorder.current?.state !== 'recording') return;
    clearTimeout(timer.current); clearInterval(ticker.current);
    setPhase('finishing'); recorder.current.stop();
    stream.current?.getTracks().forEach(track => track.stop());
    timer.current = setTimeout(() => { if (active.current) { finish(); setError('识别超时，已识别文字保留在下方，可手动插入草稿'); } }, 50_000);
  }
  async function start() {
    if (active.current || disabled) return;
    active.current = true; const identity = ++run.current;
    setError(''); setTranscript(''); setSeconds(0); setPhase('preparing'); props.current.onActive(true);
    const current = () => active.current && run.current === identity;
    const failed = (message: string) => { if (!current()) return; finish(); setError(message); };
    try {
      if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) throw new Error('麦克风需要 HTTPS 或本机 localhost 地址，请使用安全链接访问');
      if (typeof MediaRecorder === 'undefined') throw new Error('此浏览器不支持录音，请使用新版 Chrome、Edge、Firefox 或 Safari');
      const mime = VOICE_MIME_TYPES.find(value => MediaRecorder.isTypeSupported(value));
      if (!mime) throw new Error('此浏览器没有支持的录音格式，请更新浏览器');
      const status = await api<VoiceStatus>('/sessions/' + encodeURIComponent(sessionId) + '/voice');
      if (!current()) return;
      if (!status.enabled || !status.installed) throw new Error('请先在设置 → 语音输入中安装并启用 FunASR 插件');
      const microphone = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true }, video: false });
      if (!current()) { microphone.getTracks().forEach(track => track.stop()); return; }
      stream.current = microphone;
      const token = await getToken(); if (!current()) return;
      const ws = new WebSocket(`${location.protocol === 'https:' ? 'wss:' : 'ws:'}//${location.host}${appUrl('/api/sessions/' + encodeURIComponent(sessionId) + '/voice')}?token=${encodeURIComponent(token)}`);
      socket.current = ws; setPhase('loading');
      timer.current = setTimeout(() => failed('语音连接超时，请在设置中检查插件状态后重试'), 10 * 60_000);
      ws.onopen = () => { if (current()) ws.send(JSON.stringify({ type: 'start', mime })); else ws.close(); };
      ws.onerror = () => failed('无法连接语音服务，请检查登录状态和主机连接');
      ws.onclose = () => { if (current()) failed('语音连接已断开，草稿未改变；可插入下方已识别的文字'); };
      ws.onmessage = event => {
        if (!current()) return;
        try {
          const message = JSON.parse(String(event.data)) as VoiceServerEvent;
          if (message.type === 'error') { failed(message.error); return; }
          if (message.type === 'transcript') {
            setTranscript(message.text);
            if (message.final) {
              finish();
              if (message.text.trim()) { props.current.insert(message.text); setTranscript(''); }
              else setError('没有识别到文字，请靠近麦克风重试');
            }
          } else if (message.type === 'ready') {
            clearTimeout(timer.current);
            const recording = new MediaRecorder(microphone, { mimeType: mime, audioBitsPerSecond: 24000 });
            recorder.current = recording;
            let uploads = Promise.resolve(), bytes = 0;
            recording.ondataavailable = event => {
              if (!event.data.size || !current()) return;
              uploads = uploads.then(async () => {
                if (!current()) return;
                const data = await event.data.arrayBuffer(); bytes += data.byteLength;
                if (bytes > VOICE_MAX_BYTES || ws.bufferedAmount > VOICE_MAX_BYTES) throw new Error('录音数据过大或网络较慢，请分段录音后重试');
                for (let offset = 0; offset < data.byteLength; offset += VOICE_MAX_FRAME) { if (current() && ws.readyState === WebSocket.OPEN) ws.send(data.slice(offset, offset + VOICE_MAX_FRAME)); }
              }).catch(cause => failed(cause instanceof Error ? cause.message : '上传录音失败'));
            };
            recording.onstop = () => { void uploads.then(() => { if (current() && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'stop' })); }); };
            recording.onerror = () => failed('浏览器录音失败，请检查麦克风后重试');
            microphone.getAudioTracks().forEach(track => { track.onended = () => { if (current() && recording.state === 'recording') stop(); }; });
            recording.start(250); setPhase('recording');
            const began = Date.now();
            ticker.current = setInterval(() => setSeconds(Math.floor((Date.now() - began) / 1000)), 1000);
            timer.current = setTimeout(stop, VOICE_MAX_SECONDS * 1000);
          }
        } catch (cause) {
          // An insertion conflict leaves the recognized text available to copy.
          if (current()) failed(cause instanceof Error ? cause.message : '无法处理语音结果');
          else setError(cause instanceof Error ? cause.message : '无法插入草稿');
        }
      };
    } catch (cause) {
      const message = cause instanceof DOMException && cause.name === 'NotAllowedError' ? '麦克风权限被拒绝，请在浏览器地址栏中允许使用麦克风' : cause instanceof Error ? cause.message : '无法开始录音';
      failed(message);
    }
  }
  const working = phase !== 'idle';
  return <div ref={root} className="voice-input">
    <div className="voice-controls">
      <button type="button" className={`text-button voice-trigger${phase === 'recording' ? ' recording' : ''}`} disabled={disabled && !working} aria-label={phase === 'recording' ? '结束录音' : working ? '正在准备语音输入' : '语音输入'} title="录音转文字到草稿，不会自动发送" onClick={() => phase === 'recording' ? stop() : !working && void start()}>
        {phase === 'recording' ? <Square size={13} /> : working ? <LoaderCircle size={14} className="spin" /> : <Mic size={14} />}
        {phase === 'recording' ? `结束 ${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}` : phase === 'loading' ? '加载语音模型…' : phase === 'finishing' ? '识别中…' : phase === 'preparing' ? '准备录音…' : '语音输入'}
      </button>
      {working && <button type="button" className="icon-button" aria-label="取消录音" title="取消并丢弃本次录音" onClick={cancel}><X size={13} /></button>}
    </div>
    {(transcript || error || phase === 'recording') && createPortal(<div className="voice-result" role="status" style={position}>
      {phase === 'recording' && <small>正在聆听 · 结束后写入草稿，确认后再发送</small>}
      {transcript && <p className="voice-transcript">{transcript}</p>}
      {error && <p className="voice-error">{error}</p>}
      {!working && <div className="voice-result-actions">{transcript && <button type="button" className="text-button" onClick={() => { try { props.current.insert(transcript); setTranscript(''); setError(''); } catch (cause) { setError(cause instanceof Error ? cause.message : '插入失败'); } }}>插入已识别文字</button>}<button type="button" className="icon-button" aria-label="关闭语音提示" onClick={() => { setError(''); setTranscript(''); }}><X size={13} /></button></div>}
    </div>, document.body)}
  </div>;
}
