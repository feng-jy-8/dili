import { spawn, type ChildProcess } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { writeFile, mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { rootCertificates } from 'node:tls';
import type { RemoteStatus, TunnelState } from '../shared/auth.ts';
import type { RelayPairing } from '../shared/pairing.ts';
import { ensureFrp } from './frp-install.ts';

export function frpcConfig(pair: RelayPairing, localPort: number, caFile: string) {
  const url = new URL(pair.serverUrl), secure = url.protocol === 'https:';
  return {
    serverAddr: url.hostname, serverPort: Number(url.port || (secure ? 443 : 80)), user: pair.deviceId,
    loginFailExit: false, metadatas: { credential: pair.credential },
    transport: { protocol: secure ? 'wss' : 'websocket', heartbeatInterval: 5, heartbeatTimeout: 15, dialServerTimeout: 10, tls: { enable: secure, ...(secure ? { trustedCaFile: caFile, serverName: url.hostname } : {}) } },
    log: { level: 'info', disablePrintColor: true },
    proxies: [{ name: 'web', type: 'tcp', localIP: '127.0.0.1', localPort, remotePort: pair.serverPort, transport: { bandwidthLimit: '20MB', bandwidthLimitMode: 'server' } }],
  };
}
export class FrpTunnel extends EventEmitter {
  private child: ChildProcess | null = null;
  private timer: NodeJS.Timeout | null = null;
  private state: TunnelState = 'off';
  private since: string | null = null;
  private error = '';
  private attempts = 0;
  private closed = false;
  private generation = 0;
  constructor(private readonly directory: string) { super(); }
  status(): RemoteStatus['tunnel'] { return { state: this.state, since: this.since, error: this.error, attempts: this.attempts }; }
  private set(state: TunnelState, error = '') { if (this.state !== state) this.since = new Date().toISOString(); this.state = state; this.error = error; this.emit('change'); }
  async configure(pair: RelayPairing | null, localPort: number) {
    const generation = ++this.generation;
    await this.kill();
    this.attempts = 0;
    if (!pair || this.closed) { this.set('off'); return; }
    this.set('connecting');
    await mkdir(this.directory, { recursive: true, mode: 0o700 });
    const ca = join(this.directory, 'trusted-ca.pem'), config = join(this.directory, 'frpc.json');
    await writeFile(ca, rootCertificates.join('\n'), { mode: 0o600 });
    await writeFile(config, JSON.stringify(frpcConfig(pair, localPort, ca)), { mode: 0o600 });
    let executable: string;
    try { executable = await ensureFrp(this.directory, 'frpc', pair.serverUrl); }
    catch (cause) { const error = cause instanceof Error ? cause.message : '中继客户端安装失败，请检查网络后重试'; this.set('error', error); throw new Error(error); }
    if (generation !== this.generation || this.closed) return;
    const connect = () => {
      if (generation !== this.generation || this.closed) return;
      this.set('connecting');
      const child = spawn(executable, ['-c', config], { stdio: ['ignore', 'pipe', 'pipe'] });
      this.child = child;
      let pending = '';
      const output = (chunk: Buffer) => {
        if (this.child !== child) return;
        pending = (pending + chunk.toString()).slice(-8000);
        const lines = pending.split('\n'); pending = lines.pop() ?? '';
        for (const line of lines) {
          if (/start proxy success/.test(line)) { this.attempts = 0; this.set('connected'); }
          else if (/login to server failed|start error|connection closed|reconnect to server|connect to server error/.test(line)) {
            this.attempts++; this.set('error', /revoked|credential|invalid device/.test(line) ? '设备凭证已失效或被撤销，请重新配对' : '中继连接中断，正在自动重连');
          }
        }
      };
      child.stdout?.on('data', output); child.stderr?.on('data', output);
      child.on('error', () => { if (this.child === child) this.set('error', '无法启动中继客户端'); });
      child.once('exit', () => {
        if (this.child !== child || generation !== this.generation || this.closed) return;
        this.child = null; this.attempts++;
        this.set('error', '中继客户端退出，正在自动重连');
        this.timer = setTimeout(connect, Math.min(2000 * 2 ** Math.min(this.attempts - 1, 4), 30_000));
      });
    };
    connect();
  }
  private async kill() {
    if (this.timer) clearTimeout(this.timer); this.timer = null;
    const child = this.child; this.child = null;
    if (child && child.exitCode === null && child.signalCode === null) {
      const ended = new Promise<void>(resolve => child.once('exit', () => resolve()));
      child.kill('SIGTERM'); const hard = setTimeout(() => child.kill('SIGKILL'), 2000);
      await ended.finally(() => clearTimeout(hard));
    }
    await rm(join(this.directory, 'frpc.json'), { force: true });
  }
  async close() { this.closed = true; this.generation++; await this.kill(); }
}
