import { spawn } from 'node:child_process';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { chmod, copyFile, lstat, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { constants } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { parse, stringify, type TomlTable } from 'smol-toml';
import { findExecutable } from './adapters.ts';
import type { Backend } from '../shared/types.ts';
import type { AgentConfigInput, AgentSetupInfo, SetupAction } from '../shared/setup.ts';

const guides = {
  claude: { installCommand: 'npm install -g @anthropic-ai/claude-code', loginCommand: 'claude auth login', nativeCommand: 'claude', docsUrl: 'https://code.claude.com/docs/en/setup', note: '使用原生账号登录，或保存 API 配置到 Claude 用户设置。其他终端运行 claude 也会读取。' },
  codex: { installCommand: 'npm install -g @openai/codex', loginCommand: 'codex login --device-auth', nativeCommand: 'codex', docsUrl: 'https://developers.openai.com/codex/cli/', note: '使用原生账号登录，或通过 codex login --with-api-key 保存 API Key。自定义服务需兼容 Responses API。' },
  dsh: { installCommand: 'npm install -g @deepseek-ai/dsh @deepseek-harness-tui/dsh-tui', loginCommand: 'dsh web', nativeCommand: 'dsh web', docsUrl: 'https://github.com/deepseek-ai/deepseek-harness', note: '在原生 Web 设置中配置提供商、API Key 和模型。Harness 的配置随版本变化，由原生界面维护；可在其他终端运行 dsh web。' },
} as const;

function invalid(message: string): never { throw Object.assign(new Error(message), { status: 400 }); }
function validate(input: AgentConfigInput): AgentConfigInput {
  if (!input || typeof input !== 'object' || Array.isArray(input)) invalid('无效的配置');
  if (Object.keys(input).some(key => !['apiKey', 'baseUrl', 'model'].includes(key))) invalid('未知的配置项');
  const result: AgentConfigInput = {};
  for (const key of ['apiKey', 'baseUrl', 'model'] as const) {
    const value = input[key];
    if (value === undefined) continue;
    if (typeof value !== 'string' || value.length > (key === 'apiKey' ? 4096 : 500) || /[\x00-\x1f\x7f]/.test(value)) invalid('配置值格式无效');
    result[key] = value.trim();
  }
  if (result.baseUrl) {
    let url: URL;
    try { url = new URL(result.baseUrl); } catch { invalid('API 地址格式无效'); }
    if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) invalid('API 地址仅支持 HTTP(S)，不能包含账号、查询参数或片段');
    if (url.protocol === 'http:' && !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)) invalid('远程 API 地址必须使用 HTTPS');
  }
  return result;
}

async function readNative(path: string): Promise<string | null> {
  try {
    // Avoid overwriting files redirected outside the native config directory.
    const info = await lstat(path);
    if (!info.isFile() || info.isSymbolicLink() || info.size > 2_000_000) throw new Error('原生配置必须是普通文件且不超过 2 MB');
    return await readFile(path, 'utf8');
  } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null; throw error; }
}
function jsonObject(raw: string | null): Record<string, unknown> {
  const value: unknown = raw === null ? {} : JSON.parse(raw);
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('原生 JSON 配置格式无效');
  return value as Record<string, unknown>;
}
async function writeNative(path: string, contents: string, original: string | null) {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const lock = `${path}.dili-lock`, tmp = `${path}.dili-${randomUUID()}.tmp`;
  try { await writeFile(lock, '', { flag: 'wx', mode: 0o600 }); }
  catch { throw Object.assign(new Error('原生配置正在修改，请稍后重试'), { status: 409 }); }
  try {
    if (await readNative(path) !== original) throw Object.assign(new Error('原生配置已被其他程序更新，请刷新后重试'), { status: 409 });
    if (original !== null) {
      const backup = `${path}.dili-backup-${Date.now()}-${randomUUID()}`;
      await copyFile(path, backup, constants.COPYFILE_EXCL);
      await chmod(backup, 0o600);
    }
    await writeFile(tmp, contents, { mode: 0o600, flag: 'wx' });
    await rename(tmp, path);
  } finally { await rm(tmp, { force: true }); await rm(lock, { force: true }); }
}

/** The API key travels on stdin, never shell command text, argv or returned output. */
export async function codexApiLogin(file: string, key: string): Promise<void> {
  await new Promise<void>((resolveLogin, reject) => {
    const child = spawn(file, ['login', '--with-api-key'], { stdio: ['pipe', 'ignore', 'ignore'] });
    const timer = setTimeout(() => { child.kill('SIGTERM'); reject(new Error('Codex 原生登录超时，请检查本机版本和配置')); }, 15_000);
    child.once('error', () => { clearTimeout(timer); reject(new Error('无法启动 Codex 原生登录')); });
    child.once('exit', code => { clearTimeout(timer); if (code === 0) resolveLogin(); else reject(new Error('Codex 未能保存 API Key，请在原生终端检查登录状态')); });
    child.stdin.on('error', () => {});
    child.stdin.end(key + '\n');
  });
}

export class AgentSetup {
  private busy = new Set<Backend>();
  private readonly homes: Record<Backend, string>;
  constructor(options: { home?: string; homes?: Partial<Record<Backend, string>>; find?: typeof findExecutable; login?: typeof codexApiLogin } = {}) {
    const home = options.home ?? homedir();
    this.homes = {
      claude: resolve(options.homes?.claude ?? (options.home ? join(home, '.claude') : process.env.CLAUDE_CONFIG_DIR ?? join(home, '.claude'))),
      codex: resolve(options.homes?.codex ?? (options.home ? join(home, '.codex') : process.env.CODEX_HOME ?? join(home, '.codex'))),
      dsh: resolve(options.homes?.dsh ?? (options.home ? join(home, '.dsh') : process.env.DSH_HOME ?? join(home, '.dsh'))),
    };
    this.find = options.find ?? findExecutable;
    this.login = options.login ?? codexApiLogin;
  }
  private readonly find: typeof findExecutable;
  private readonly login: typeof codexApiLogin;
  private configPath(id: Backend) { return join(this.homes[id], id === 'claude' ? 'settings.json' : id === 'codex' ? 'config.toml' : 'cordis.patch.yml'); }
  async info(id: Backend): Promise<AgentSetupInfo> {
    const info: AgentSetupInfo = { id, executable: await this.find(id), configPath: this.configPath(id), credentialPresent: false, baseUrl: '', model: '', ...guides[id] };
    try {
      if (id === 'claude') {
        const config = jsonObject(await readNative(info.configPath));
        const env = jsonObject(config.env === undefined ? null : JSON.stringify(config.env));
        info.credentialPresent = Boolean(env.ANTHROPIC_API_KEY || env.ANTHROPIC_AUTH_TOKEN || process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN);
        info.baseUrl = typeof env.ANTHROPIC_BASE_URL === 'string' ? env.ANTHROPIC_BASE_URL : '';
        info.model = typeof config.model === 'string' ? config.model : '';
      } else if (id === 'codex') {
        const config = parse(await readNative(info.configPath) ?? '');
        info.model = typeof config.model === 'string' ? config.model : '';
        const provider = (config.model_providers as TomlTable | undefined)?.[String(config.model_provider)] as TomlTable | undefined;
        info.baseUrl = typeof provider?.base_url === 'string' ? provider.base_url : '';
        // Only report existence, never return native OAuth tokens or keys.
        info.credentialPresent = await lstat(join(this.homes.codex, 'auth.json')).then(() => true, () => false) || Boolean(process.env.OPENAI_API_KEY);
      }
    } catch { info.error = '原生配置无法读取或格式不正确，请在本机检查后再保存。'; }
    // Even a configured URL can contain a token in older configs; do not expose it.
    try { const url = new URL(info.baseUrl); if (url.username || url.password || url.search || url.hash) info.baseUrl = ''; } catch { info.baseUrl = ''; }
    return info;
  }
  async list() { return Promise.all((['claude', 'codex', 'dsh'] as const).map(id => this.info(id))); }
  async command(id: Backend, action: SetupAction): Promise<string> {
    if (!['install', 'login', 'native'].includes(action)) invalid('未知的安装引导操作');
    if (action === 'install') return guides[id].installCommand;
    const file = await this.find(id);
    if (!file) invalid('请先安装后端，再刷新检测');
    // Use the detected binary, including explicit per-backend overrides.
    const quote = `'${file.replace(/'/g, `'"'"'`)}'`;
    if (id === 'codex' && action === 'login') return `${quote} login --device-auth`;
    if (id === 'claude' && action === 'login') return `${quote} auth login`;
    return quote + (id === 'dsh' ? ' web' : '');
  }
  async save(id: Backend, body: AgentConfigInput) {
    const input = validate(body);
    if (id === 'dsh') invalid('请在 DeepSeek Harness 原生 Web 设置中保存 API 配置');
    if (this.busy.has(id)) throw Object.assign(new Error('此后端的配置正在保存，请稍候'), { status: 409 });
    this.busy.add(id);
    try {
      const path = this.configPath(id), original = await readNative(path);
      let contents: string;
      if (id === 'claude') {
        const config = jsonObject(original);
        const env = jsonObject(config.env === undefined ? null : JSON.stringify(config.env));
        if (input.apiKey) env.ANTHROPIC_API_KEY = input.apiKey;
        if (input.baseUrl !== undefined) { if (input.baseUrl) env.ANTHROPIC_BASE_URL = input.baseUrl; else delete env.ANTHROPIC_BASE_URL; }
        if (input.model !== undefined) { if (input.model) config.model = input.model; else delete config.model; }
        config.env = env;
        contents = JSON.stringify(config, null, 2) + '\n';
      } else {
        const config = parse(original ?? '');
        if (input.model !== undefined) { if (input.model) config.model = input.model; else delete config.model; }
        if (input.baseUrl) {
          const providers = config.model_providers ?? {};
          if (typeof providers !== 'object' || Array.isArray(providers) || providers instanceof Date) invalid('Codex model_providers 配置格式无效');
          // Keep all original provider definitions; select an explicit Dili-managed one.
          (providers as TomlTable).dili = { name: 'Dili custom API', base_url: input.baseUrl, wire_api: 'responses', requires_openai_auth: true };
          config.model_providers = providers;
          config.model_provider = 'dili';
        } else if (input.baseUrl === '') delete config.model_provider;
        contents = stringify(config);
        if (input.apiKey) {
          const file = await this.find(id);
          if (!file) invalid('请先安装 Codex，再保存 API Key');
          // Validate config before the native authentication action.
          await this.login(file, input.apiKey);
        }
      }
      try { await writeNative(path, contents, original); }
      catch (error) { if (id === 'codex' && input.apiKey) throw new Error('API Key 已交给 Codex，但配置文件保存失败。请刷新后检查原生设置，再重试配置。'); throw error; }
      return { agent: await this.info(id), note: '已保存原生配置并备份原文件；新启动的会话会读取。未调用模型验证凭据。' };
    } catch (error) {
      // Parser errors may embed a source line containing credentials.
      if (error instanceof SyntaxError || error?.constructor?.name === 'TomlError') throw Object.assign(new Error('原生配置格式不正确，未覆盖，请修复后重试'), { status: 400 });
      throw error;
    } finally { this.busy.delete(id); }
  }
}
