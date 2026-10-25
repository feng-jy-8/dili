import { useEffect, useState, type FormEvent } from 'react';
import { Plus, Monitor, Trash2, ArrowLeft } from 'lucide-react';
import AuthGate from './AuthGate';
import { appUrl } from './urls';
import './machines.css';

const KEY = 'dili.machines.v1';
type Machine = { url: string; name: string };
export function machineUrl(value: string) {
  const url = new URL(value.trim());
  if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) throw new Error('请输入完整的 http(s) 机器地址，不含密码、查询参数或分享链接。');
  url.pathname = url.pathname.replace(/\/*$/, '/');
  return url.href;
}
function readMachines(): Machine[] {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(KEY) || '[]');
    return Array.isArray(value) ? value.slice(0, 100).flatMap(item => {
      try { return typeof item.name === 'string' ? [{ url: machineUrl(item.url), name: item.name.slice(0, 80) }] : []; } catch { return []; }
    }) : [];
  } catch { return []; }
}
export default function MachineRoot() {
  const [hash, setHash] = useState(() => {
    if (!location.hash && document.querySelector('meta[name="dili-launcher"]')) location.hash = '/machines';
    return location.hash;
  });
  useEffect(() => { const change = () => setHash(location.hash); window.addEventListener('hashchange', change); return () => window.removeEventListener('hashchange', change); }, []);
  if (hash.startsWith('#/machines')) return <MachineHome />;
  const home = new URLSearchParams(location.search).get('machineHome');
  let returnTo = '';
  try { const target = new URL(home || ''); if (['https:', 'http:'].includes(target.protocol) && !target.username && !target.password && target.hash === '#/machines') returnTo = target.href; } catch { /* Normal workbench visit. */ }
  return <><AuthGate />{returnTo && <a className="machine-return" href={returnTo} title="返回机器列表"><Monitor size={16} /><span>机器</span></a>}</>;
}
function MachineHome() {
  const [machines, setMachines] = useState(readMachines);
  const [adding, setAdding] = useState(false);
  const [url, setUrl] = useState('');
  const [name, setName] = useState('');
  const [error, setError] = useState('');
  const persist = (next: Machine[]) => {
    try { localStorage.setItem(KEY, JSON.stringify(next)); setMachines(next); return true; }
    catch { setError('浏览器无法保存机器列表，请允许网站存储后重试。'); return false; }
  };
  useEffect(() => {
    const sync = () => setMachines(readMachines()); window.addEventListener('storage', sync);
    const params = new URLSearchParams(location.hash.split('?')[1]);
    const paired = params.get('paired');
    if (paired) {
      try {
        const target = machineUrl(paired);
        const pending = JSON.parse(sessionStorage.getItem('dili.machine.pending') || 'null') as (Machine & { nonce: string }) | null;
        // Only accept the machine this tab explicitly started pairing with.
        if (pending?.url === target && pending.nonce === params.get('nonce') && persist([...readMachines().filter(item => item.url !== target), { url: pending.url, name: pending.name }])) sessionStorage.removeItem('dili.machine.pending');
      } catch { setError('连接记录无法恢复，请重新添加机器。'); }
      history.replaceState(null, '', appUrl('/#/machines'));
    }
    return () => window.removeEventListener('storage', sync);
  }, []);
  function add(event: FormEvent) {
    event.preventDefault(); setError('');
    try {
      const target = machineUrl(url);
      const machine = { url: target, name: name.trim() || new URL(target).host, nonce: crypto.randomUUID() };
      sessionStorage.setItem('dili.machine.pending', JSON.stringify(machine));
      const returnUrl = new URL(appUrl('/#/machines'), location.origin).href;
      location.assign(`${target}#/pair?return=${encodeURIComponent(returnUrl)}&nonce=${encodeURIComponent(machine.nonce)}`);
    } catch (cause) { setError(cause instanceof Error ? cause.message : '无法连接机器'); }
  }
  return <main className="machines-page"><header><div><h1>我的机器</h1><p>连接你的 Dili，继续与 Agent 一起工作。</p></div>{!document.querySelector('meta[name="dili-launcher"]') && <a href={appUrl('/#/contacts')}>当前机器</a>}</header>
    {error && <p role="alert" className="form-error">{error}</p>}
    <section className="machine-grid" aria-label="机器列表">{machines.map(machine => <article className="machine-card" key={machine.url}><a href={`${machine.url}?machineHome=${encodeURIComponent(new URL(appUrl('/#/machines'), location.origin).href)}#/contacts`}><Monitor size={30} /><strong>{machine.name}</strong><small>{machine.url}</small><span>打开联系人 →</span></a><button aria-label={`移除 ${machine.name}`} onClick={() => { if (confirm(`从列表移除「${machine.name}」？机器上的会话不会删除。`)) persist(machines.filter(item => item.url !== machine.url)); }}><Trash2 size={16} /></button></article>)}
      <button className="machine-add" aria-label="添加机器" onClick={() => { setAdding(true); setError(''); }}><Plus size={38} /><span>发现你的机器</span></button></section>
    {adding && <section className="machine-form" aria-label="添加机器"><button className="text-button" onClick={() => setAdding(false)}><ArrowLeft size={16} />取消</button><h2>连接机器</h2><form onSubmit={add}><label>机器链接<input autoFocus type="url" required placeholder="https://你的机器地址/" value={url} onChange={event => setUrl(event.target.value)} /></label><label>名称（可选）<input maxLength={80} value={name} onChange={event => setName(event.target.value)} placeholder="例如：工作电脑" /></label><p>下一步会打开该机器验证密码。验证后返回，机器卡片会保存在此设备；密码不会存入列表。</p><button className="button primary">下一步：验证机器</button></form></section>}
    <footer>电脑与 Android：在浏览器菜单中安装应用。iPhone：Safari → 分享 → 添加到主屏幕。远程安装和麦克风需要 HTTPS。</footer>
  </main>;
}

