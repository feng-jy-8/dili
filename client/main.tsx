import React from 'react';
import ReactDOM from 'react-dom/client';
import MachineRoot from './MachineHome';
import ErrorBoundary from './ErrorBoundary';
import './styles.css';
import './themes.css';
import { initializeTheme } from './theme';
import { initializeZoom } from './zoom';

initializeTheme();
initializeZoom();

ReactDOM.createRoot(document.getElementById('root')!).render(<React.StrictMode><ErrorBoundary><MachineRoot /></ErrorBoundary></React.StrictMode>);

// Install updates on the next launch, without interrupting active agent turns.
if ('serviceWorker' in navigator && window.isSecureContext && !import.meta.env.DEV) {
  window.addEventListener('load', () => {
    const base = document.querySelector<HTMLMetaElement>('meta[name="sessiondeck-base"]')?.content ?? '';
    void navigator.serviceWorker.register(`${base}/sw.js`, { scope: `${base}/`, updateViaCache: 'none' }).catch(() => {});
  });
}
