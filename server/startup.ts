import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { homedir, release } from 'node:os';
import { join, resolve } from 'node:path';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import type { StartupStatus } from '../shared/setup.ts';

const exec = promisify(execFile);
type Result = { stdout: string; code: number };
type Runner = (file: string, args: string[]) => Promise<Result>;
const run: Runner = async (file, args) => {
  try { return { stdout: (await exec(file, args, { timeout: 3000, maxBuffer: 8192 })).stdout, code: 0 }; }
  catch (error) { return { stdout: '', code: Number((error as { code?: number }).code) || 1 }; }
};

// systemd uses its own quoting, percent specifiers and dollar expansion.
export function unitQuote(value: string, expandDollars = false): string {
  if (/[\x00-\x1f\x7f]/.test(value)) throw new Error('启动设置包含无效控制字符');
  return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/%/g, '%%').replace(/\$/g, expandDollars ? '$$$$' : '$$')}"`;
}

/** Toggles future startup only. No stop, restart, start, --now or privileged commands. */
export class StartupService {
  private readonly unitPath: string;
  private readonly runner: Runner;
  private readonly platform: string;
  private readonly wsl: boolean;
  private readonly dataDir: string;
  private busy = false;
  constructor(private readonly options: {
    root: string; configDir?: string; dataDir?: string; cwd?: string; port?: number; host?: string;
    runner?: Runner; platform?: string; wsl?: boolean;
  }) {
    this.unitPath = join(options.configDir ?? process.env.XDG_CONFIG_HOME ?? join(homedir(), '.config'), 'systemd/user/sessiondeck.service');
    this.runner = options.runner ?? run;
    this.platform = options.platform ?? process.platform;
    this.wsl = options.wsl ?? /microsoft/i.test(release());
    this.dataDir = resolve(options.dataDir ?? process.env.SESSIONDECK_DATA_DIR ?? join(homedir(), '.local/share/sessiondeck'));
  }
  private async unit(): Promise<string | null> {
    try { return await readFile(this.unitPath, 'utf8'); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null; throw error; }
  }
  private matches(unit: string): boolean {
    // Existing source-install units are retained, including all custom settings.
    const cli = unitQuote(join(this.options.root, 'bin/dili.mjs'), true);
    const source = join(this.options.root, 'start.sh');
    if (!unit.includes(cli) && !unit.split('\n').some(line => line === `ExecStart=${source}` || line === `ExecStart="${source}"`)) return false;
    const environment = unit.split('\n').filter(line => line.startsWith('Environment='));
    const wanted: Record<string, string> = {
      SESSIONDECK_DATA_DIR: this.dataDir,
      SESSIONDECK_PORT: String(this.options.port ?? Number(process.env.PORT || process.env.SESSIONDECK_PORT || 4317)),
      SESSIONDECK_HOST: this.options.host ?? process.env.HOST ?? process.env.SESSIONDECK_HOST ?? '127.0.0.1',
    };
    for (const [key, value] of Object.entries(wanted)) {
      const lines = environment.filter(line => line.includes(`${key}=`));
      if (lines.length && (lines.length !== 1 || ![`Environment=${unitQuote(`${key}=${value}`)}`, `Environment=${key}=${value}`].includes(lines[0]))) return false;
      if (!lines.length && value !== (key === 'SESSIONDECK_DATA_DIR' ? resolve(join(homedir(), '.local/share/sessiondeck')) : key === 'SESSIONDECK_PORT' ? '4317' : '127.0.0.1')) return false;
    }
    return true;
  }
  async status(): Promise<StartupStatus> {
    const unit = await this.unit();
    const conflict = unit !== null && !this.matches(unit);
    const status: StartupStatus = { supported: false, enabled: false, active: false, wsl: this.wsl, linger: false, unitPath: this.unitPath, conflict, note: '' };
    if (this.platform !== 'linux') return { ...status, note: '目前支持 Linux / WSL2 的 systemd 用户服务；其他平台请手动运行 dili。' };
    const available = await this.runner('systemctl', ['--user', 'show-environment']);
    if (available.code !== 0) return { ...status, note: this.wsl ? '请在 WSL 启用 systemd 并重新启动发行版，再设置自动启动。' : '当前无法连接 systemd 用户服务，请在本机登录后的终端设置。' };
    const [enabled, active, linger] = await Promise.all([
      this.runner('systemctl', ['--user', 'is-enabled', 'sessiondeck.service']),
      this.runner('systemctl', ['--user', 'is-active', 'sessiondeck.service']),
      this.runner('loginctl', ['show-user', String(process.getuid?.() ?? ''), '-p', 'Linger', '--value']),
    ]);
    return { ...status, supported: true, enabled: enabled.stdout.trim() === 'enabled', active: active.stdout.trim() === 'active', linger: linger.stdout.trim() === 'yes',
      note: conflict ? '已有用户服务属于其他安装或数据目录，不能从此实例覆盖。请在原安装中设置。' : this.wsl ? '在 WSL 发行版启动后自动运行；这不会让 Windows 自动启动 WSL。' : '启用后在用户登录时自动运行。关闭自动启动不会停止当前会话。' };
  }
  async change(enabled: boolean): Promise<StartupStatus> {
    if (this.busy) throw Object.assign(new Error('启动设置正在处理中'), { status: 409 });
    this.busy = true;
    try {
      const current = await this.status();
      if (!current.supported || current.conflict) throw Object.assign(new Error(current.note), { status: 409 });
      if (current.enabled === enabled) return current;
      if (enabled && !(await this.unit())) {
        const cwd = resolve(this.options.cwd ?? process.cwd());
        const port = this.options.port ?? Number(process.env.PORT || process.env.SESSIONDECK_PORT || 4317);
        const host = this.options.host ?? process.env.HOST ?? process.env.SESSIONDECK_HOST ?? '127.0.0.1';
        const env: Record<string, string> = { PATH: process.env.PATH ?? '/usr/local/bin:/usr/bin:/bin', SESSIONDECK_DATA_DIR: this.dataDir, SESSIONDECK_PORT: String(port), SESSIONDECK_HOST: host };
        // Native credentials stay in native files. Never copy arbitrary environment secrets.
        for (const key of ['CODEX_HOME', 'CLAUDE_CONFIG_DIR', 'DSH_HOME', 'SESSIONDECK_CLAUDE_BIN', 'SESSIONDECK_CODEX_BIN', 'SESSIONDECK_DSH_BIN', 'SESSIONDECK_DSH_TUI_BIN', 'SESSIONDECK_REMOTE_PORT']) if (process.env[key]) env[key] = process.env[key]!;
        const contents = ['# Managed by Dili. Compatible unit name retained for existing installations.', '[Unit]', 'Description=Dili personal agent workbench', 'After=network.target', '', '[Service]', 'Type=simple', `WorkingDirectory=${unitQuote(cwd)}`, ...Object.entries(env).map(([key, value]) => `Environment=${unitQuote(`${key}=${value}`)}`), `ExecStart=${unitQuote(process.execPath, true)} ${unitQuote(join(this.options.root, 'bin/dili.mjs'), true)}`, 'Restart=on-failure', 'RestartSec=5', 'TimeoutStopSec=30', 'KillMode=mixed', '', '[Install]', 'WantedBy=default.target', ''].join('\n');
        const dir = join(this.unitPath, '..');
        await mkdir(dir, { recursive: true });
        // Exclusive creation prevents two instances from replacing each other's unit.
        await writeFile(this.unitPath, contents, { mode: 0o600, flag: 'wx' });
      }
      if (enabled && (await this.runner('systemctl', ['--user', 'daemon-reload'])).code !== 0) throw new Error('用户服务刷新失败，请检查 systemd 后重试');
      if ((await this.runner('systemctl', ['--user', enabled ? 'enable' : 'disable', 'sessiondeck.service'])).code !== 0) throw new Error('无法更新自动启动，请在本机终端检查 systemctl --user status sessiondeck');
      return await this.status();
    } finally { this.busy = false; }
  }
}
