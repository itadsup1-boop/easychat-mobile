import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App.jsx';
import './index.css';

export function getConfiguredApiBaseUrl() {
  try {
    const saved = String(window.localStorage?.getItem('easychat_server_url') || '').trim().replace(/\/+$/, '');
    if (saved && /^https?:\/\//i.test(saved)) return saved;
  } catch (_) {}
  return '';
}

// Patch global fetch to support both same-origin and configured remote server URL (for mobile APK/Capacitor)
const _nativeFetch = window.fetch.bind(window);
window.fetch = async (input, init = {}) => {
  let url = typeof input === 'string' ? input : input instanceof Request ? input.url : String(input);
  const apiBase = getConfiguredApiBaseUrl();
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
};

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
