import { Component, type ErrorInfo, type ReactNode } from 'react';
import { CircleAlert, RefreshCw } from 'lucide-react';

/** A rendering failure must leave an explanation instead of an empty root. */
export default class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state: { error: Error | null } = { error: null };

  static getDerivedStateFromError(error: Error) { return { error }; }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('SessionDeck 页面显示失败', error, info.componentStack);
  }

  render() {
    if (!this.state.error) return this.props.children;
    return <div className="auth-page"><main className="auth-card" role="alert">
      <CircleAlert size={24} />
      <h1>工作空间显示失败</h1>
      <p className="auth-subtitle">页面遇到了错误。重新加载不会停止正在运行的会话，也不会删除笔记。</p>
      <details className="workspace-error-details"><summary>查看错误详情</summary><pre>{this.state.error.message || String(this.state.error)}</pre></details>
      <button className="button primary" onClick={() => location.reload()}><RefreshCw size={15} />重新加载</button>
    </main></div>;
  }
}
