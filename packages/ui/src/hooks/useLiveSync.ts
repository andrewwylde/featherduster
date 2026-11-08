import { useEffect, useState, useRef } from 'react';
import { sseClient } from '../api/events.js';

export interface LiveSyncState {
  isConnected: boolean;
  lastEvent: any | null;
  lastSyncTime: Date | null;
  syncCount: number;
}

export interface LiveSyncOptions {
  topic?: string;
}

export type LiveSyncCallback = (event?: any, options?: { signal?: AbortSignal }) => void | Promise<void>;

/**
 * Connects to the local SSE event stream at /api/events via the shared sseClient singleton.
 * Fires the onSync callback whenever a scoped event is received.
 * Coalesces incoming refresh requests with a leading edge fetch and at most one trailing fetch.
 * Discards redundant in-flight fetches using AbortController.
 */
export function useLiveSync(
  onSync?: LiveSyncCallback,
  topicOrOptions?: string | LiveSyncOptions
): LiveSyncState {
  const topic = typeof topicOrOptions === 'string' ? topicOrOptions : topicOrOptions?.topic;
  const [isConnected, setIsConnected] = useState(() => sseClient.isConnected());
  const [lastEvent, setLastEvent] = useState<any | null>(null);
  const [lastSyncTime, setLastSyncTime] = useState<Date | null>(null);
  const [syncCount, setSyncCount] = useState(0);

  const onSyncRef = useRef(onSync);
  useEffect(() => {
    onSyncRef.current = onSync;
  }, [onSync]);

  useEffect(() => {
    let alive = true;
    let isRunning = false;
    let trailingPending = false;
    let trailingEvent: any = null;
    let currentController: AbortController | null = null;

    const runSync = async (event: any) => {
      if (!alive) return;
      if (isRunning) {
        trailingPending = true;
        trailingEvent = event;
        return;
      }

      isRunning = true;
      trailingPending = false;

      if (currentController) {
        currentController.abort();
      }
      currentController = new AbortController();
      const controller = currentController;

      setLastEvent(event);
      setLastSyncTime(new Date());
      setSyncCount((prev) => prev + 1);

      try {
        if (onSyncRef.current) {
          const result = onSyncRef.current(event, { signal: controller.signal });
          if (result && typeof result.then === 'function') {
            await result;
          }
        }
      } catch (err: any) {
        if (err?.name !== 'AbortError' && !controller.signal.aborted) {
          // Ignore unhandled error
        }
      } finally {
        if (currentController === controller) {
          currentController = null;
        }
        isRunning = false;

        if (alive && trailingPending && !controller.signal.aborted) {
          const nextEvt = trailingEvent;
          trailingPending = false;
          trailingEvent = null;
          void runSync(nextEvt);
        }
      }
    };

    const unsubStatus = sseClient.onStatus((status) => {
      if (alive) setIsConnected(status);
    });

    let unsubTopic: () => void;
    if (topic) {
      unsubTopic = sseClient.onTopic(topic, (data) => {
        void runSync(data);
      });
    } else {
      const unsubChange = sseClient.onChange((data) => {
        void runSync(data);
      });
      const unsubCorpus = sseClient.onCorpus((data) => {
        void runSync(data);
      });
      unsubTopic = () => {
        unsubChange();
        unsubCorpus();
      };
    }

    return () => {
      alive = false;
      if (currentController) {
        currentController.abort();
        currentController = null;
      }
      unsubStatus();
      unsubTopic();
    };
  }, [topic]);

  return { isConnected, lastEvent, lastSyncTime, syncCount };
}
