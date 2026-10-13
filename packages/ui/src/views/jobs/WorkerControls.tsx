import { useCallback, useRef, useState } from 'react';
import { apiClient } from '../../api/client.js';
import { useIntentKey, useJobsData } from '../../hooks/useJobsData.js';

export function WorkerControls() {
  const load = useCallback(() => apiClient.getJobsControl(), []);
  const { data, error, refresh } = useJobsData(load);
  const [failure, setFailure] = useState<string | null>(null);
  const [pending, setPending] = useState<string[]>([]);
  const inflight = useRef(new Set<string>());
  const key = useIntentKey();
  const act = async (action: 'start' | 'pause' | 'stop') => {
    if (inflight.current.has(action)) return;
    inflight.current.add(action); setPending([...inflight.current]); setFailure(null);
    try { await apiClient.controlJobs(action, key({ action, revision: data?.control.revision })); await refresh(); }
    catch (e) { setFailure(e instanceof Error ? e.message : 'Control request failed'); }
    finally { inflight.current.delete(action); setPending([...inflight.current]); }
  };
  const status = error ? 'Host unavailable' : !data ? 'Loading worker…' : data.active.length ? 'Processing' : data.control.stopped_at || !data.control.automatic_preparation_enabled ? 'Stopped' : 'Idle';
  return <section aria-label="Worker controls" className="sticky top-0 z-10 flex flex-wrap items-center gap-3 rounded-lg border border-slate-300 bg-white p-3 dark:bg-slate-900 dark:border-slate-700">
    <span role="status">{status}{data?.control.pause_after_current ? ' — Pause after current requested' : ''}</span>
    {(['start', 'pause', 'stop'] as const).map((action, i) => <button key={action} className="min-h-[44px] rounded border px-3 disabled:opacity-50" disabled={!data || (action === 'stop' ? pending.includes('stop') : pending.length > 0)} onClick={() => void act(action)}>{['Start automatic preparation', 'Pause after current', 'Stop processing'][i]}</button>)}
    {failure && <p role="alert">{failure}</p>}
  </section>;
}
