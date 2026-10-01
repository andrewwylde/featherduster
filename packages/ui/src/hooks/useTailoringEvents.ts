import { useEffect, useRef } from 'react';
import type { TailoringEvent } from '../api/client';
import { sseClient, type DraftChangeEvent } from '../api/events';

export interface TailoringEventHandlers {
  /** Progress/state events emitted by the orchestrator. */
  onEvent?: (event: TailoringEvent) => void;
  onReconnect?: () => void;
  onDraftChange?: (event: DraftChangeEvent) => void;
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
    const unsubTailoring = sseClient.onTailoring((data) => {
      ref.current.onEvent?.(data);
    });

    const unsubChange = sseClient.onChange((data) => {
      if (typeof data?.relativePath === 'string' && data.relativePath.replace(/\\/g, '/').startsWith('tailoring/')) {
        ref.current.onFileChange?.(data.relativePath);
      }
    });

    const unsubDraft = sseClient.onDraftChange(event => ref.current.onDraftChange?.(event));
    const unsubStatus = sseClient.onStatus(connected => { if (connected) ref.current.onReconnect?.(); });
    return () => {
      unsubDraft();
      unsubStatus();
      unsubTailoring();
      unsubChange();
    };
  }, []);
}
