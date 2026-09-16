import { useEffect, useState, useRef, useCallback } from 'react';

export interface LiveSyncState {
  isConnected: boolean;
  lastEvent: any | null;
  lastSyncTime: Date | null;
  syncCount: number;
}

/**
 * Connects to the local SSE event stream at /api/events.
 * Fires the onSync callback whenever a filesystem change event is received from the watcher.
 */
export function useLiveSync(onSync?: (event?: any) => void): LiveSyncState {
  const [isConnected, setIsConnected] = useState(false);
  const [lastEvent, setLastEvent] = useState<any | null>(null);
  const [lastSyncTime, setLastSyncTime] = useState<Date | null>(null);
  const [syncCount, setSyncCount] = useState(0);

  const onSyncRef = useRef(onSync);
  useEffect(() => {
    onSyncRef.current = onSync;
  }, [onSync]);

  const triggerSync = useCallback((data?: any) => {
    setLastEvent(data);
    setLastSyncTime(new Date());
    setSyncCount((prev) => prev + 1);
    if (onSyncRef.current) {
      onSyncRef.current(data);
    }
  }, []);

  useEffect(() => {
    let eventSource: EventSource | null = null;
    let isUnmounted = false;
    let reconnectTimeout: ReturnType<typeof setTimeout> | null = null;

    let retryAttempts = 0;

    function connect() {
      if (isUnmounted) return;

      try {
        eventSource = new EventSource('/api/events');

        eventSource.addEventListener('connected', () => {
          if (!isUnmounted) {
            setIsConnected(true);
            retryAttempts = 0;
          }
        });

        eventSource.addEventListener('change', (e: MessageEvent) => {
          try {
            const data = JSON.parse(e.data);
            triggerSync(data);
          } catch {
            triggerSync();
          }
        });

        eventSource.addEventListener('ping', () => {
          // Keepalive ping received
          if (!isUnmounted) {
            setIsConnected(true);
            retryAttempts = 0;
          }
        });

        eventSource.onopen = () => {
          if (!isUnmounted) {
            setIsConnected(true);
            retryAttempts = 0;
          }
        };

        eventSource.onerror = () => {
          if (!isUnmounted) {
            setIsConnected(false);
            if (eventSource) {
              eventSource.close();
              eventSource = null;
            }
            // Schedule reconnect with exponential backoff (1s to 30s max) + jitter
            const delay = Math.min(1000 * Math.pow(2, retryAttempts), 30000) + Math.random() * 500;
            retryAttempts++;
            reconnectTimeout = setTimeout(connect, delay);
          }
        };
      } catch {
        if (!isUnmounted) {
          setIsConnected(false);
          const delay = Math.min(1000 * Math.pow(2, retryAttempts), 30000) + Math.random() * 500;
          retryAttempts++;
          reconnectTimeout = setTimeout(connect, delay);
        }
      }
    }

    connect();

    return () => {
      isUnmounted = true;
      if (reconnectTimeout) clearTimeout(reconnectTimeout);
      if (eventSource) {
        eventSource.close();
      }
    };
  }, [triggerSync]);

  return { isConnected, lastEvent, lastSyncTime, syncCount };
}
