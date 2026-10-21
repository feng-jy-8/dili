import { spawn, type ChildProcessWithoutNullStreams, type ChildProcess } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createInterface } from 'node:readline';
import { OwnedProcess } from './owned-process.ts';
import { randomUUID } from 'node:crypto';
import type { WebSocket } from 'ws';
import { VOICE_MAX_BYTES, VOICE_MAX_SECONDS, VOICE_MIME_TYPES, type VoiceServerEvent, type VoiceStatus } from '../shared/voice.ts';

type Sink = (event: VoiceServerEvent) => void;
export interface VoiceEngine {
  ready(): Promise<void>;
  begin(id: string, mime: string, sink: Sink): void;
  audio(id: string, data: Buffer): void;
  stop(id: string): void;
  cancel(id: string): void;
}
const fail = (message: string) => { throw Object.assign(new Error(message), { status: 409 }); };

/** CPU-only optional plugin, isolated from Node's event loop and npm dependencies. */
export class FunAsr implements VoiceEngine {
  private child?: ChildProcessWithoutNullStreams;
  private processes = new Map<ChildProcess, OwnedProcess>();
  private retiring: Promise<void>[] = [];
  private rejectLoading?: (message: string) => void;
  private loading?: Promise<void>;
  private sinks = new Map<string, Sink>();
  private phase: VoiceStatus['phase'] = 'idle';
  private message = '';
  private closed = false;
  private idle?: NodeJS.Timeout;
  readonly directory: string;
  readonly python: string;
  constructor(dataDir: string, private settings: { enabled(): boolean; enable(): void }) {
    this.directory = join(dataDir, 'plugins', 'funasr');
    this.python = join(this.directory, 'venv', process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python');
  }
  status(): VoiceStatus {
    const installed = existsSync(this.python) && existsSync(join(this.directory, 'installed.json'));
    return { enabled: this.settings.enabled(), installed, phase: this.phase === 'idle' && !installed ? 'not_installed' : this.phase, message: this.message, maxSeconds: VOICE_MAX_SECONDS };
  }
  private own(child: ChildProcess) {
    const exited = new Promise<void>(resolve => child.once('close', () => resolve()));
    if (child.pid) {
      const owned = new OwnedProcess(child.pid, exited, signal => { child.kill(signal); });
      this.processes.set(child, owned);
      void exited.then(() => this.processes.delete(child));
    }
  }
  private retire(child: ChildProcess) {
    const owned = this.processes.get(child);
    if (!owned) return;
    const job = owned.stop(); this.retiring.push(job);
    void job.catch(() => {});
  }
  private async run(command: string, args: string[], message: string) {
    this.message = message;
    await new Promise<void>((accept, reject) => {
      if (this.closed) return reject(new Error('语音服务已关闭'));
      const child = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, PIP_DISABLE_PIP_VERSION_CHECK: '1' } });
      this.own(child);
      let tail = '';
      const timer = setTimeout(() => { this.retire(child); }, 30 * 60_000);
      for (const stream of [child.stdout, child.stderr]) stream?.on('data', data => { tail = (tail + data.toString()).slice(-1200); });
      child.once('error', () => { clearTimeout(timer); reject(new Error('无法运行 Python，请安装 Python 3.10+ 和 venv')); });
      child.once('close', code => {
        clearTimeout(timer);
        if (code === 0) accept(); else reject(new Error(`${message}失败。${tail.replace(/https?:\/\/\S+/g, '[下载地址]').slice(-600)}`));
      });
    });
  }
  install() {
    if (this.closed || ['installing', 'loading'].includes(this.phase) || this.sinks.size) fail('语音服务正在处理中，请稍候');
    if (!['linux', 'darwin'].includes(process.platform)) fail('请在 Linux / WSL2 或 macOS 主机安装语音插件');
    this.disposeWorker(); this.phase = 'installing';
    void (async () => {
      await mkdir(this.directory, { recursive: true, mode: 0o700 });
      await this.run('python3', ['-m', 'venv', join(this.directory, 'venv')], '创建独立 Python 环境');
      await this.run(this.python, ['-m', 'pip', 'install', '--upgrade', 'pip'], '准备安装器');
      await this.run(this.python, ['-m', 'pip', 'install', 'torch==2.8.0', 'torchaudio==2.8.0', ...(process.platform === 'linux' ? ['--index-url', 'https://download.pytorch.org/whl/cpu'] : [])], '安装 CPU 推理引擎');
      await this.run(this.python, ['-m', 'pip', 'install', 'funasr==1.3.14', 'imageio-ffmpeg>=0.5,<0.7', 'numpy<3', 'transformers<5', 'torchaudio==2.8.0'], '安装 FunASR 与音频解码器');
      const { writeFile } = await import('node:fs/promises');
      await writeFile(join(this.directory, 'installed.json'), JSON.stringify({ installedAt: new Date().toISOString() }), { mode: 0o600 });
      if (this.closed) return;
      this.settings.enable(); this.phase = 'idle';
      await this.ready();
    })().catch(cause => { if (!this.closed) { this.phase = 'error'; this.message = cause instanceof Error ? cause.message : '安装失败'; } });
  }
  ready(): Promise<void> {
    if (this.closed) return Promise.reject(new Error('语音服务已关闭'));
    if (!this.settings.enabled()) return Promise.reject(new Error('请先在设置中安装并启用 FunASR 语音插件'));
    if (this.phase === 'ready' && this.child) { this.armIdle(); return Promise.resolve(); }
    if (this.loading) return this.loading;
    if (this.phase === 'installing') return Promise.reject(new Error('语音插件仍在安装中，请稍候'));
    if (!this.status().installed) return Promise.reject(new Error('FunASR 尚未安装，请先前往设置安装'));
    this.phase = 'loading'; this.message = '正在加载流式模型；首次使用会下载模型，可能需要几分钟';
    this.loading = new Promise<void>((accept, reject) => {
      const worker = spawn(this.python, ['-u', fileURLToPath(new URL('./voice-worker.py', import.meta.url))], {
        stdio: ['pipe', 'pipe', 'pipe'], env: { ...process.env, OMP_NUM_THREADS: '2', MKL_NUM_THREADS: '2', MODELSCOPE_CACHE: join(this.directory, 'models'), HF_HOME: join(this.directory, 'huggingface') },
      });
      this.child = worker; this.own(worker);
      let settled = false;
      const timer = setTimeout(() => { failed('模型加载超时，请检查主机的模型下载网络'); this.retire(worker); }, 10 * 60_000);
      const failed = (error: string) => {
        clearTimeout(timer);
        if (this.child === worker) { this.child = undefined; this.phase = 'error'; this.message = error; }
        if (!settled) { settled = true; reject(new Error(error)); }
        if (this.child && this.child !== worker) return;
        for (const sink of [...this.sinks.values()]) sink({ type: 'error', error });
        this.sinks.clear();
      };
      this.rejectLoading = failed;
      worker.stderr.on('data', () => {}); // No audio or transcripts in application logs.
      worker.stdin.on('error', () => {});
      createInterface({ input: worker.stdout }).on('line', line => {
        if (this.child !== worker) return;
        try {
          const event = JSON.parse(line);
          if (event.type === 'ready' && !settled) { settled = true; clearTimeout(timer); this.phase = 'ready'; this.message = 'FunASR 流式识别已就绪'; this.armIdle(); accept(); }
          else if (event.type === 'fatal') { failed(String(event.error)); this.retire(worker); }
          else if (typeof event.id === 'string' && this.sinks.has(event.id)) {
            if (event.type === 'transcript' && typeof event.text === 'string') this.sinks.get(event.id)!({ type: 'transcript', text: event.text.slice(0, 30000), final: event.final === true });
            else if (event.type === 'error') this.sinks.get(event.id)!({ type: 'error', error: '语音识别失败，请检查主机语音设置' });
          }
        } catch { /* Ignore non-protocol library output. */ }
      });
      worker.once('error', () => failed('无法启动 FunASR Python 环境，请重新安装插件'));
      worker.once('exit', () => { if (this.child === worker || !settled) failed('语音工作进程已退出，请重试'); });
    }).finally(() => { this.loading = undefined; this.rejectLoading = undefined; });
    return this.loading;
  }
  private write(message: unknown) {
    if (!this.child || this.child.stdin.destroyed) throw new Error('语音工作进程未就绪');
    if (this.child.stdin.writableLength > 3 * 1024 * 1024) throw new Error('识别处理过慢，请缩短录音后重试');
    this.child.stdin.write(JSON.stringify(message) + '\n');
  }
  begin(id: string, mime: string, sink: Sink) { clearTimeout(this.idle); this.sinks.set(id, sink); this.write({ type: 'start', id, mime }); }
  audio(id: string, data: Buffer) { this.write({ type: 'audio', id, audio: data.toString('base64') }); }
  stop(id: string) { this.write({ type: 'stop', id }); }
  cancel(id: string) {
    this.sinks.delete(id);
    if (this.child) { try { this.write({ type: 'cancel', id }); } catch { /* Already disconnected. */ } }
    this.armIdle();
  }
  private armIdle() { clearTimeout(this.idle); if (!this.sinks.size) this.idle = setTimeout(() => this.disposeWorker(), 5 * 60_000).unref(); }
  private disposeWorker() { clearTimeout(this.idle); const worker = this.child; if (this.phase === 'loading') this.rejectLoading?.('模型加载已取消'); this.child = undefined; if (worker) this.retire(worker); if (this.phase === 'ready' || this.phase === 'error') { this.phase = 'idle'; this.message = '模型已休眠，下次录音时自动加载'; } }
  disable() { for (const sink of [...this.sinks.values()]) sink({ type: 'error', error: '语音识别已停用' }); this.sinks.clear(); this.disposeWorker(); }
  async close() {
    this.closed = true; this.disable();
    for (const child of this.processes.keys()) this.retire(child);
    const results = await Promise.allSettled(this.retiring);
    if (results.some(result => result.status === 'rejected')) throw new Error('部分语音子进程未能正常退出');
  }
}

/** One bounded recording per host keeps CPU use predictable. Independent of terminal payload limits. */
export class VoiceConnections {
  private reserved = false;
  private sockets = new Map<WebSocket, { device?: string; cancel(): void }>();
  constructor(private engine: VoiceEngine, private limits = { bytes: VOICE_MAX_BYTES, seconds: VOICE_MAX_SECONDS }) {}
  attach(ws: WebSocket, device?: string) {
    ws.on('error', () => {});
    if (this.reserved) { ws.send(JSON.stringify({ type: 'error', error: '主机正在识别另一段录音，请稍后再试' })); ws.close(1013); return; }
    this.reserved = true;
    const id = randomUUID();
    let state: 'waiting' | 'loading' | 'recording' | 'finishing' | 'closed' = 'waiting';
    let bytes = 0;
    let timer = setTimeout(() => error('语音连接超时，请重新开始'), 15_000);
    const send = (event: VoiceServerEvent) => { if (ws.readyState === 1 && ws.bufferedAmount < 256 * 1024) ws.send(JSON.stringify(event)); };
    const cleanup = () => {
      if (state === 'closed') return;
      state = 'closed'; clearTimeout(timer); this.engine.cancel(id); this.reserved = false; this.sockets.delete(ws);
    };
    const error = (message: string) => { if (state === 'closed') return; send({ type: 'error', error: message }); cleanup(); ws.close(1008); };
    this.sockets.set(ws, { device, cancel: () => { error('访问已撤销或会话已关闭'); } });
    ws.on('error', cleanup); ws.on('close', cleanup);
    ws.on('message', (raw, binary) => {
      try {
        if (binary) {
          if (state !== 'recording') throw new Error('录音尚未就绪或已经停止');
          const data = Buffer.isBuffer(raw) ? raw : Buffer.concat(Array.isArray(raw) ? raw : [Buffer.from(raw)]);
          bytes += data.length;
          if (bytes > this.limits.bytes) throw new Error('录音超过大小上限，请分段输入');
          this.engine.audio(id, data); return;
        }
        if (raw.toString().length > 1024) throw new Error('无效的语音控制消息');
        const message = JSON.parse(raw.toString());
        if (message.type === 'cancel') { cleanup(); ws.close(1000); return; }
        if (message.type === 'start' && state === 'waiting' && (VOICE_MIME_TYPES as readonly string[]).includes(message.mime)) {
          state = 'loading'; clearTimeout(timer);
          timer = setTimeout(() => error('模型加载超时，请在设置中检查语音插件'), 10 * 60_000);
          void this.engine.ready().then(() => {
            if (state !== 'loading') return;
            this.engine.begin(id, message.mime, event => {
              if (state === 'closed') return;
              send(event);
              if (event.type === 'error' || (event.type === 'transcript' && event.final)) { cleanup(); ws.close(1000); }
            });
            state = 'recording'; clearTimeout(timer);
            timer = setTimeout(() => error('单次录音限时两分钟，请分段输入'), this.limits.seconds * 1000 + 3000);
            send({ type: 'ready' });
          }).catch(cause => error(cause instanceof Error ? cause.message : '语音后端不可用'));
        } else if (message.type === 'stop' && state === 'recording') {
          state = 'finishing'; clearTimeout(timer);
          timer = setTimeout(() => error('识别超时，已有草稿已保留，请重试'), 45_000);
          this.engine.stop(id);
        } else throw new Error('语音请求顺序或格式无效');
      } catch (cause) { error(cause instanceof Error ? cause.message : '语音输入失败'); }
    });
  }
  revalidate(valid: (device: string) => boolean) { for (const client of this.sockets.values()) if (client.device && !valid(client.device)) client.cancel(); }
  close() { for (const client of [...this.sockets.values()]) client.cancel(); }
}
