import { LoaderCircle } from 'lucide-react';
import './chat-presentation.css';

export type ChatActivityPhase = 'sending' | 'waiting' | 'thinking' | 'replying' | 'working';

/** Stay visible above the composer, including while the user reads older messages. */
export default function ChatActivity({ phase }: { phase: ChatActivityPhase | null }) {
  if (!phase) return null;
  const label = { sending: '正在发送…', waiting: '消息已发送，正在等待后端响应…', thinking: '正在思考…', replying: '正在回复…', working: '正在处理任务…' }[phase];
  return <div className="chat-activity" role="status" aria-label="会话响应状态" aria-live="polite" aria-atomic="true"><LoaderCircle size={14} className="spin" aria-hidden="true" /><span>{label}</span></div>;
}
