import { useEffect, useState } from 'react';
import { io } from 'socket.io-client';
import { createVirtualMobileSocket } from '../mobileStandaloneEngine.js';

function getSavedServerUrl() {
  if (typeof window === 'undefined') return '';
  try {
    const saved = String(window.localStorage?.getItem('easychat_server_url') || '').trim().replace(/\/+$/, '');
    if (saved && /^https?:\/\//i.test(saved)) return saved;
  } catch (_) {}
  return '';
}

function shouldUseVirtualMobileSocket() {
  if (typeof window === 'undefined') return false;
  if (getSavedServerUrl()) return false;
  const proto = String(window.location.protocol || '');
  const host = String(window.location.hostname || '');
  const port = String(window.location.port || '');
  if (proto === 'capacitor:' || proto === 'file:') return true;
  if ((host === 'localhost' || host === '127.0.0.1') && !port) return true;
  return false;
}

export function useSocket(enabled = true) {
  const [socket, setSocket] = useState(null);
  const [isConnected, setIsConnected] = useState(false);

  useEffect(() => {
    if (!enabled) {
      setSocket(null);
      setIsConnected(false);
      return undefined;
    }

    if (shouldUseVirtualMobileSocket()) {
      const vSocket = createVirtualMobileSocket();
      setSocket(vSocket);
      setIsConnected(true);
      return () => {
        vSocket.close();
      };
    }

    const targetUrl = getSavedServerUrl() || window.location.origin;
    const newSocket = io(targetUrl, {
      transports: ['websocket', 'polling'],
      withCredentials: true,
      reconnectionAttempts: 3,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 5000
    });

    newSocket.on('connect', () => {
      setIsConnected(true);
    });

    newSocket.on('disconnect', () => {
      setIsConnected(false);
    });

    newSocket.on('connect_error', () => {
      // Fallback to virtual mobile socket if no PC backend is reachable
      if (!getSavedServerUrl()) {
        newSocket.close();
        const vSocket = createVirtualMobileSocket();
        setSocket(vSocket);
        setIsConnected(true);
      }
    });

    setSocket(newSocket);

    return () => {
      newSocket.close();
    };
  }, [enabled]);

  return { socket, isConnected };
}
