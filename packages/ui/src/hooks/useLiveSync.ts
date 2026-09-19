import { useEffect, useState, useRef } from 'react';
import { sseClient } from '../api/events';

export interface LiveSyncState {
  isConnected: boolean;
  lastEvent: any | null;
  lastSyncTime: Date | null;
  syncCount: number;
}

/**
 * Connects to the local SSE event stream at /api/events via the shared sseClient singleton.
 * Fires the onSync callback whenever a filesystem change event is received from the watcher.
 */
export function useLiveSync(onSync?: (event?: any) => void): LiveSyncState {
  const [isConnected, setIsConnected] = useState(() => sseClient.isConnected());
  const [lastEvent, setLastEvent] = useState<any | null>(null);
  const [lastSyncTime, setLastSyncTime] = useState<Date | null>(null);
  const [syncCount, setSyncCount] = useState(0);

  const onSyncRef = useRef(onSync);
  useEffect(() => {
    onSyncRef.current = onSync;
  }, [onSync]);

  useEffect(() => {
    const unsubStatus = sseClient.onStatus((status) => {
      setIsConnected(status);
    });

    const unsubChange = sseClient.onChange((data) => {
      setLastEvent(data);
      setLastSyncTime(new Date());
      setSyncCount((prev) => prev + 1);
      if (onSyncRef.current) {
        onSyncRef.current(data);
      }
    });

    return () => {
      unsubStatus();
      unsubChange();
    };
  }, []);

  return { isConnected, lastEvent, lastSyncTime, syncCount };
}
