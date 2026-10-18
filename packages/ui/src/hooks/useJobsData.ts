import { useCallback, useEffect, useRef, useState } from 'react';
import { sseClient } from '../api/events.js';
import { requestErrorMessage } from '../views/jobs/job-utils.js';

/** Reconciliation only reads; a reconnect can never enable preparation. */
export function useJobsData<T>(load: () => Promise<T>) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const refreshRef = useRef<() => Promise<void>>(async () => {});
  useEffect(() => {
    let alive = true;
    let hasConnected = false;
    let pending: Promise<void> | null = null;
    const refresh = () => {
      if (pending) return pending;
      pending = load().then(value => { if (alive) { setData(value); setError(null); } }, e => { if (alive) setError(requestErrorMessage(e, { timeout: 'The jobs host is taking longer than expected to respond.', fallback: 'Jobs host unavailable.' })); }).finally(() => { pending = null; });
      return pending;
    };
    setData(null); setError(null);
    refreshRef.current = async () => { if (pending) await pending; if (alive) await refresh(); };
    void refresh();
    const offJobs = sseClient.onJobs(() => void refresh());
    const offStatus = sseClient.onStatus(connected => { if (connected) { hasConnected = true; void refresh(); } else if (hasConnected && alive) setError('Jobs host disconnected.'); });
    const timer = setInterval(() => { if (document.visibilityState !== 'hidden') void refresh(); }, 5000);
    return () => { alive = false; clearInterval(timer); offJobs(); offStatus(); };
  }, [load]);
  const refresh = useCallback(() => refreshRef.current(), []);
  return { data, error, refresh };
}

/** Reuse a key after an ambiguous failure, but never for a different payload. */
export function useIntentKey() {
  const keys = useRef(new Map<string, string>());
  return (payload: unknown) => {
    const identity = JSON.stringify(payload);
    if (!keys.current.has(identity)) keys.current.set(identity, crypto.randomUUID());
    return keys.current.get(identity)!;
  };
}
