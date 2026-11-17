import { useEffect, useState } from 'react';
import { io } from 'socket.io-client';

function resolveSocketUrl() {
  if (typeof window === 'undefined') return 'http://localhost:5050';
  try {
    const saved = String(window.localStorage?.getItem('easychat_server_url') || '').trim().replace(/\/+$/, '');
    if (saved && /^https?:\/\//i.test(saved)) return saved;
  } catch (_) {}
  return window.location.origin;
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
    const targetUrl = resolveSocketUrl();
    const newSocket = io(targetUrl, {
      transports: ['websocket', 'polling'],
      withCredentials: true,
      reconnectionAttempts: Infinity,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 10000,
      randomizationFactor: 0.25
    });

    newSocket.on('connect', () => {
      console.log('[Socket.io Client] Đã kết nối thành công:', newSocket.id);
      setIsConnected(true);
    });

    newSocket.on('disconnect', () => {
      console.warn('[Socket.io Client] Ngắt kết nối socket');
      setIsConnected(false);
    });

    setSocket(newSocket);

    return () => {
      newSocket.close();
    };
  }, [enabled]);

  return { socket, isConnected };
}
