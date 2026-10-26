import { useEffect, useState } from 'react';

type InstallPrompt = Event & { prompt(): Promise<void>; userChoice: Promise<{ outcome: string }> };
export default function InstallApp() {
  const [prompt, setPrompt] = useState<InstallPrompt | null>(null);
  const [installed, setInstalled] = useState(() => matchMedia('(display-mode: standalone), (display-mode: fullscreen)').matches || !!(navigator as Navigator & { standalone?: boolean }).standalone);
  const [help, setHelp] = useState(false);
  useEffect(() => {
    const ready = (event: Event) => { event.preventDefault(); setPrompt(event as InstallPrompt); };
    const done = () => { setInstalled(true); setPrompt(null); };
    window.addEventListener('beforeinstallprompt', ready); window.addEventListener('appinstalled', done);
    return () => { window.removeEventListener('beforeinstallprompt', ready); window.removeEventListener('appinstalled', done); };
  }, []);
  if (installed) return null;
  const ios = /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  return <section className="machine-install"><button className="button primary" onClick={async () => {
    if (!prompt) { setHelp(value => !value); return; }
    try { await prompt.prompt(); await prompt.userChoice; setPrompt(null); } catch { setHelp(true); }
  }}>安装到桌面</button>{help && <p role="status">{ios ? '请用 Safari 打开本站，点击分享按钮，再选“添加到主屏幕”，然后从桌面图标打开。' : '在 Chrome / Edge 菜单中选择“安装应用”或“添加到主屏幕”，然后从应用图标打开。若未出现安装选项，请稍后刷新重试。'}</p>}</section>;
}
