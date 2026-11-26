import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App.jsx';
import './index.css';
import { handleMobileStandaloneApi } from './mobileStandaloneEngine.js';

// ─── Global ErrorBoundary ──────────────────────────────────────────────────
class AppErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }
  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }
  componentDidCatch(error, info) {
    console.error('[AppErrorBoundary] Caught error:', error, info);
  }
  render() {
    if (this.state.hasError) {
      return (
        <div style={{
          display: 'flex', flexDirection: 'column', alignItems: 'center',
          justifyContent: 'center', height: '100vh', padding: '24px',
          background: '#0f1117', color: '#e2e8f0', fontFamily: 'sans-serif', textAlign: 'center'
        }}>
          <div style={{ fontSize: '48px', marginBottom: '16px' }}>⚠️</div>
          <h2 style={{ fontSize: '18px', fontWeight: 700, marginBottom: '8px' }}>Đã xảy ra lỗi</h2>
          <p style={{ fontSize: '13px', color: '#94a3b8', marginBottom: '24px' }}>
            {this.state.error?.message || 'Lỗi không xác định'}
          </p>
          <button
            onClick={() => { this.setState({ hasError: false, error: null }); }}
            style={{
              padding: '10px 24px', borderRadius: '8px', border: 'none',
              background: '#2684ff', color: '#fff', fontSize: '14px',
              fontWeight: 600, cursor: 'pointer'
            }}
          >
            Thử lại
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
// ──────────────────────────────────────────────────────────────────────────

export function getConfiguredApiBaseUrl() {
  try {
    const saved = String(window.localStorage?.getItem('easychat_server_url') || '').trim().replace(/\/+$/, '');
    if (saved && /^https?:\/\//i.test(saved)) return saved;
  } catch (_) {}
  return '';
}

export function isStandaloneCapacitorApp() {
  if (typeof window === 'undefined') return false;
  if (getConfiguredApiBaseUrl()) return false;
  const proto = String(window.location.protocol || '');
  const host = String(window.location.hostname || '');
  const port = String(window.location.port || '');
  if (proto === 'capacitor:' || proto === 'file:') return true;
  // Capacitor Android serves on https://localhost or http://localhost with no port
  if ((host === 'localhost' || host === '127.0.0.1') && !port) return true;
  return false;
}

const _nativeFetch = window.fetch.bind(window);
window._easychatNativeFetch = _nativeFetch;

window.fetch = async (input, init = {}) => {
  let url = typeof input === 'string' ? input : input instanceof Request ? input.url : String(input);
  const apiBase = getConfiguredApiBaseUrl();

  const isLocalApiCall = url.startsWith('/api/') || url.startsWith(`${window.location.origin}/api/`);
  if (isLocalApiCall && isStandaloneCapacitorApp()) {
    const relPath = url.startsWith(window.location.origin) ? url.slice(window.location.origin.length) : url;
    return handleMobileStandaloneApi(_nativeFetch, relPath, input, init);
  }

  if (apiBase && url.startsWith('/api/')) {
    url = `${apiBase}${url}`;
    input = url;
  }

  const isApiOrSameOrigin = url.startsWith('/') || url.startsWith(window.location.origin) || (apiBase && url.startsWith(apiBase));
  if (isApiOrSameOrigin) {
    const nextHeaders = new Headers(init.headers || {});
    try {
      const mobileToken = window.localStorage?.getItem('easychat_session_token');
      if (mobileToken && !nextHeaders.has('X-EasyChat-Session')) {
        nextHeaders.set('X-EasyChat-Session', mobileToken);
      }
    } catch (_) {}
    init = {
      ...init,
      headers: nextHeaders,
      credentials: init.credentials || 'include'
    };
  }

  try {
    const resp = await _nativeFetch(input, init);
    if (url.includes('/api/auth/login') || url.includes('/api/auth/register') || url.includes('/api/auth/google')) {
      try {
        const cloned = resp.clone();
        const data = await cloned.json();
        if (data?.token) {
          window.localStorage?.setItem('easychat_session_token', String(data.token));
        }
      } catch (_) {}
    } else if (url.includes('/api/auth/logout')) {
      try {
        window.localStorage?.removeItem('easychat_session_token');
      } catch (_) {}
    }
    return resp;
  } catch (err) {
    if (err?.name === 'AbortError') throw err;
    // Fallback to standalone mobile engine if local/remote backend is unreachable
    if (isLocalApiCall || (apiBase && url.startsWith(`${apiBase}/api/`))) {
      const relPath = apiBase && url.startsWith(apiBase)
        ? url.slice(apiBase.length)
        : (url.startsWith(window.location.origin) ? url.slice(window.location.origin.length) : url);
      return handleMobileStandaloneApi(_nativeFetch, relPath, input, init);
    }
    throw err;
  }
};

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <AppErrorBoundary>
      <App />
    </AppErrorBoundary>
  </React.StrictMode>
);
