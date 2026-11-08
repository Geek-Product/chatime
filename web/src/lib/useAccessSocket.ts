import { useEffect, useRef } from 'react';
import { ensureFreshAccessToken, getAccessToken } from './api';
import { socket } from './socket';

/**
 * Keeps a realtime connection open while an account waits for approval, so `access.changed` arrives.
 * The handler is held in a ref: a changing callback must not tear down and restart the socket.
 */
export function useAccessSocket(onAccessChanged: (status: 'approved' | 'declined') => void) {
  const handler = useRef(onAccessChanged);
  handler.current = onAccessChanged;

  useEffect(() => {
    const unsubscribe = socket.subscribe((event) => {
      if (event.type === 'access.changed') handler.current(event.status);
    });
    socket.start(getAccessToken, ensureFreshAccessToken);
    return () => {
      unsubscribe();
    };
  }, []);
}
