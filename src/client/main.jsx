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
window.fetch = (input, init = {}) => {
  let url = typeof input === 'string' ? input : input instanceof Request ? input.url : String(input);
  const apiBase = getConfiguredApiBaseUrl();
  if (apiBase && url.startsWith('/api/')) {
    url = `${apiBase}${url}`;
    input = url;
  }
  const isApiOrSameOrigin = url.startsWith('/') || url.startsWith(window.location.origin) || (apiBase && url.startsWith(apiBase));
  if (isApiOrSameOrigin && !init.credentials) {
    init = { ...init, credentials: 'include' };
  }
  return _nativeFetch(input, init);
};

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
