import { Check, Contrast, Monitor, Moon, Sparkles, Sun, Sunrise, TerminalSquare } from 'lucide-react';
import ModalShell from './Modal';
import { useTheme, type ThemePreference } from './theme';

const themes = [
  { id: 'light', label: '简洁浅色', detail: '清晰、轻盈，熟悉的工作台', icon: Sun },
  { id: 'warm', label: '柔和暖色', detail: '纸张与木色，适合长时间阅读', icon: Sunrise },
  { id: 'dark', label: '沉静深色', detail: '石墨背景，柔和蓝色点缀', icon: Moon },
  { id: 'midnight', label: '午夜靛蓝', detail: '深海蓝底，青蓝与紫色点缀', icon: Sparkles },
  { id: 'terminal', label: '终端黑绿', detail: '经典黑底绿字，专注命令与代码', icon: TerminalSquare },
  { id: 'contrast', label: '高对比度', detail: '纯黑背景、鲜明边界与清晰文字', icon: Contrast },
] as const;

export default function AppearanceDialog({ close }: { close: () => void }) {
  const [theme, setTheme] = useTheme();
  return <ModalShell title="外观主题" subtitle="为你的工作台挑选配色。选择后立即生效，并在此浏览器中记住。" close={close}>
    <div className="appearance-options" role="radiogroup" aria-label="工作台主题" onKeyDown={event => {
      if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) return;
      event.preventDefault();
      const buttons = [...event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="radio"]')];
      const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
      const next = event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1 : (index + (event.key === 'ArrowLeft' || event.key === 'ArrowUp' ? -1 : 1) + buttons.length) % buttons.length;
      buttons[next]?.focus(); buttons[next]?.click();
    }}>{themes.map(({ id, label, detail, icon: Icon }) => <button key={id} type="button" role="radio" aria-checked={theme === id} tabIndex={theme === id ? 0 : -1} className={`appearance-option ${theme === id ? 'selected' : ''}`} onClick={() => setTheme(id)}>
      <span className={`theme-sample sample-${id}`} aria-hidden="true"><i className="sample-rail" /><i className="sample-list"><b /><b /><b /></i><i className="sample-page"><b /><b /><em /></i></span>
      <span className="appearance-label"><Icon size={15} /><strong>{label}</strong>{theme === id && <Check size={15} />}</span><small>{detail}</small>
    </button>)}<button type="button" role="radio" aria-checked={theme === 'system'} tabIndex={theme === 'system' ? 0 : -1} className={`appearance-system ${theme === 'system' ? 'selected' : ''}`} onClick={() => setTheme('system' as ThemePreference)}><Monitor size={19} /><span><strong>跟随系统</strong><small>随设备的浅色／深色设置自动切换</small></span>{theme === 'system' && <Check size={16} />}</button></div>
    <div className="modal-footer"><span className="appearance-note">会话、随手记、预览和终端同步配色</span><button className="button primary" onClick={close}>完成</button></div>
  </ModalShell>;
}
