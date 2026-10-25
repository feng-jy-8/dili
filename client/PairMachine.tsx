import { appUrl } from './urls';

/** Runs on the target origin, so credentials never pass through the launcher. */
export default function PairMachine() {
  const params = new URLSearchParams(location.hash.split('?')[1]);
  let back: URL | null = null;
  try { const value = new URL(params.get('return') || ''); if (['https:', 'http:'].includes(value.protocol) && !value.username && !value.password && value.hash === '#/machines') back = value; } catch { /* Invalid return links never redirect. */ }
  const target = new URL(appUrl('/'), location.origin).href;
  if (back) back.hash = `/machines?paired=${encodeURIComponent(target)}&nonce=${encodeURIComponent(params.get('nonce') || '')}`;
  return <main className="machines-page"><h1>机器已验证</h1><p>当前地址：{target}</p>{back ? <><p>返回 {back.origin} 保存这台机器。</p><a className="button primary" href={back.href}>完成连接，返回机器列表</a></> : <p role="alert">返回地址无效，请从机器列表重新添加。</p>}<p><a href={appUrl('/#/contacts')}>直接打开联系人</a></p></main>;
}
