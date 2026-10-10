import React from 'react';
import ReactDOM from 'react-dom/client';
import AuthGate from './AuthGate';
import ErrorBoundary from './ErrorBoundary';
import './styles.css';
import './themes.css';
import { initializeTheme } from './theme';

initializeTheme();

ReactDOM.createRoot(document.getElementById('root')!).render(<React.StrictMode><ErrorBoundary><AuthGate /></ErrorBoundary></React.StrictMode>);
