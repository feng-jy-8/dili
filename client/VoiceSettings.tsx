import { useEffect, useState } from 'react';
import { Download, LoaderCircle, Mic, RefreshCw } from 'lucide-react';
import type { VoiceStatus } from '../shared/voice';
import { api } from './api';
import './voice.css';

const labels = { not_installed: '未安装', idle: '按需加载', installing: '安装中', loading: '加载模型中', ready: '已就绪', error: '需要检查' };
export default function VoiceSettings({ local, demo }: { local: boolean; demo: boolean }) {
  const [status, setStatus] = useState<VoiceStatus>();
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  useEffect(() => {
    let disposed = false;
    const load = async () => { try { const value = await api<VoiceStatus>('/voice'); if (!disposed) setStatus(value); } catch (cause) { if (!disposed) setError(cause instanceof Error ? cause.message : '无法读取语音设置'); } };
    void load(); const interval = setInterval(() => { if (document.visibilityState !== 'hidden') void load(); }, 3000);
    return () => { disposed = true; clearInterval(interval); };
  }, []);
  async function action(path: string, body: unknown) {
    setBusy(true); setError('');
    try { setStatus(await api<VoiceStatus>(path, body)); }
    catch (cause) { setError(cause instanceof Error ? cause.message : '操作失败'); }
    finally { setBusy(false); }
  }
  const working = busy || status?.phase === 'installing' || status?.phase === 'loading';
  return <section className="backend-setting-card voice-settings" aria-label="语音输入设置">
    <div className="backend-setting-title"><Mic size={20} /><div><h2>语音输入</h2><p>流式转文字，结束录音后写入当前会话草稿。</p></div></div>
    <p className="backend-note">FunASR 是可选本地插件，默认不安装。安装到独立 Python 环境，使用 CPU 识别；首次安装会下载依赖与模型，需要数 GB 磁盘空间和 Python 3.10+ / venv。</p>
    <p className="backend-note">远程手机通过现有中继传输压缩录音，由运行 Dili 的主机识别。中继是可信节点；录音不写入 Dili 文件或日志。每次最长两分钟，结束后由你确认发送。</p>
    <p className="setup-message" role="status">{status ? `FunASR · ${labels[status.phase]}${status.message ? ' · ' + status.message : ''}` : '正在检查语音插件…'}</p>
    <div className="setup-actions">
      <button type="button" className="button secondary small-button" disabled={working || !local || demo || !status} onClick={() => void action('/voice/install', {})}>{working ? <LoaderCircle size={14} className="spin" /> : <Download size={14} />}{status?.installed ? '修复 / 更新插件' : '安装并启用 FunASR'}</button>
      {status?.installed && <><button type="button" className="button secondary small-button" role="switch" aria-label="启用本地语音识别" aria-checked={status.enabled} disabled={working || !local || demo} onClick={() => void action('/voice', { enabled: !status.enabled })}>{status.enabled ? '语音识别已开启' : '开启语音识别'}</button><button type="button" className="text-button" disabled={working || !local || demo || !status.enabled} onClick={() => void action('/voice/warmup', {})}><RefreshCw size={13} />加载 / 检查模型</button></>}
    </div>
    {!local && <p className="backend-note">请在运行 Dili 的电脑上安装、启用或修复插件；手机可直接使用已启用的语音输入。</p>}
    {demo && <p className="backend-note">演示模式不会安装依赖或下载模型。</p>}
    {error && <p className="setup-message" role="alert">{error}</p>}
  </section>;
}
