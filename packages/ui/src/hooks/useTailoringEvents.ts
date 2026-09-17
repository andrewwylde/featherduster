import { useEffect, useRef } from 'react';
import type { TailoringEvent } from '../api/client';

export interface TailoringEventHandlers {
  /** Progress/state events emitted by the orchestrator. */
  onEvent?: (event: TailoringEvent) => void;
  /** Filesystem changes under tailoring/ (e.g. an external agent edited a run file). */
  onFileChange?: (relativePath: string) => void;
}

/**
 * Subscribes to tailoring events on the shared /api/events SSE stream.
 * No-ops where EventSource is unavailable (tests, old browsers).
 */
export function useTailoringEvents(handlers: TailoringEventHandlers): void {
  const ref = useRef(handlers);
  useEffect(() => {
    ref.current = handlers;
  }, [handlers]);

  useEffect(() => {
    if (typeof EventSource === 'undefined') return;
    let source: EventSource | null = null;
    let closed = false;
    let retry: ReturnType<typeof setTimeout> | null = null;
    let attempts = 0;

    const connect = () => {
      if (closed) return;
      try {
        source = new EventSource('/api/events');
      } catch {
        return;
      }
      source.addEventListener('tailoring', (e: MessageEvent) => {
        try {
          ref.current.onEvent?.(JSON.parse(e.data));
        } catch {
          // ignore malformed event
        }
      });
      source.addEventListener('change', (e: MessageEvent) => {
        try {
          const data = JSON.parse(e.data);
          if (typeof data.relativePath === 'string' && data.relativePath.replace(/\\/g, '/').startsWith('tailoring/')) {
            ref.current.onFileChange?.(data.relativePath);
          }
        } catch {
          // ignore
        }
      });
      source.onopen = () => {
        attempts = 0;
      };
      source.onerror = () => {
        source?.close();
        source = null;
        if (closed) return;
        retry = setTimeout(connect, Math.min(1000 * 2 ** attempts++, 30000));
      };
    };

    connect();
    return () => {
      closed = true;
      if (retry) clearTimeout(retry);
      source?.close();
    };
  }, []);
}
