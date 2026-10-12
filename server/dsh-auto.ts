import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

/** Select the native preset on the main agent before queued work is released. */
export function dshAutoPlugin(nativeId?: string): string {
  return `export default function diliAuto(ctx) {
  let selected = false;
  ctx.on('agent/created', function({agent}) {
      if (selected || agent.options?.parentAgent || agent.session.meta?.origin === 'subagent' || (${JSON.stringify(nativeId ?? null)} !== null && agent.id !== ${JSON.stringify(nativeId ?? null)})) return;
      const presets = agent.ctx?.get('permissionPresets') ?? ctx.get('permissionPresets');
      if (!presets) throw new Error('Dili: Harness 原生 Auto 权限服务未安装，请在原生设置中配置');
      presets.set(agent.session, 'auto');
      selected = true;
  });
}\n`;
}

/** Invocation-only overlay; never writes the user's Harness profile. */
export async function prepareDshAuto(directory: string, nativeId?: string) {
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const plugin = join(directory, 'plugin.mjs'), loader = join(directory, 'loader.mjs'), patch = join(directory, 'patch.yml');
  await writeFile(plugin, dshAutoPlugin(nativeId), { mode: 0o600 });
  await writeFile(loader, `import { registerHooks } from 'node:module';\nregisterHooks({resolve(s,c,next){return s==='dili-auto-mode'?{url:${JSON.stringify(pathToFileURL(plugin).href)},shortCircuit:true}:next(s,c);}});\n`, { mode: 0o600 });
  await writeFile(patch, JSON.stringify([{ insert: [{ id: 'dili-auto-mode', name: 'dili-auto-mode' }] }]), { mode: 0o600 });
  return { patch, loader };
}
