import { useCallback, useRef, useState } from 'react';
import type { Job } from '@featherduster/core';
import { apiClient } from '../../api/client.js';
import { useIntentKey, useJobsData } from '../../hooks/useJobsData.js';
import { cardClass, primaryButton, secondaryButton } from '../tailoring/ui.js';

export function JobFitReview({ job, onSaved, navigate }: { job: Job; onSaved(): void; navigate(path: string): void }) {
  const load = useCallback(() => apiClient.getJobFit(job.id), [job.id]);
  const { data, error, refresh } = useJobsData(load);
  const sources = useJobsData(useCallback(() => apiClient.getEvidence(), []));
  const [selected, setSelected] = useState<string[] | null>(null);
  const [failure, setFailure] = useState('');
  const [busy, setBusy] = useState(false);
  const pending = useRef(false);
  const intent = useIntentKey();
  const ids = selected ?? sources.data?.map(e => e.id) ?? [];
  const active = job.preparation_state === 'preparing' || job.preparation_state === 'queued';
  const assess = async () => {
    if (pending.current) return;
    pending.current = true; setBusy(true); setFailure('');
    try {
      const body = { expected_revision: job.revision, evidence_ids: ids };
      await apiClient.assessJobFit(job.id, { ...body, idempotency_key: intent(body) });
      await refresh(); onSaved();
    } catch (e) { setFailure(e instanceof Error ? e.message : 'Assessment could not start'); }
    finally { pending.current = false; setBusy(false); }
  };
  const cancel = async () => {
    if (pending.current) return;
    pending.current = true; setBusy(true); setFailure('');
    try {
      await apiClient.cancelJob(job.id, { expected_revision: job.revision, idempotency_key: intent({ cancel: job.id, revision: job.revision }), reason: 'Cancelled fit assessment' });
      await refresh(); onSaved();
    } catch (e) { setFailure(e instanceof Error ? e.message : 'Cancellation failed'); }
    finally { pending.current = false; setBusy(false); }
  };
  const current = data?.current;
  return <section className={`${cardClass} p-6 space-y-5`} aria-label="Fit assessment">
    <header className="space-y-2">
      <h2 className="text-lg font-semibold">How does your experience fit?</h2>
      <p className="text-sm text-slate-600 dark:text-slate-300">Compare the posting with selected evidence and saved scoped skill support. This assessment does not create a resume or other materials.</p>
    </header>
    {(error || sources.error || failure) && <div role="alert" className="space-y-2 text-sm">
      <p>{failure || error || sources.error}</p>
      {/stopped|paused/i.test(failure) ? <p>Open Automatic work controls below, then choose Start automatic preparation. This also enables other queued work; inspect the queue first. Return here and choose Assess fit.</p>
        : /runner|model|consent/i.test(failure) ? <button className="underline" onClick={() => navigate('/settings')}>Runner and consent settings</button>
        : <button className="underline" onClick={() => { void refresh(); void sources.refresh(); }}>Reload assessment and sources</button>}
    </div>}
    {['needs_input', 'failed', 'interrupted', 'cancelled'].includes(job.preparation_state) && job.state_reason && <p role="status" className="text-sm">Last work stopped: {job.state_reason}. Inspect the cause before reassessing. <button className="underline" onClick={() => navigate('/settings')}>Runner and consent settings</button></p>}
    <details>
      <summary className="cursor-pointer text-sm font-medium">Selected sources ({ids.length})</summary>
      <p className="text-sm my-2">The working skillset mapping uses your evidence and explicitly saved support, not resume skills or the job rubric.</p>
      {!sources.data?.length && <p className="text-sm">No evidence sources selected or available. Results will be unknown, not proof that you lack a skill. <a className="underline" href="/evidence">Add evidence</a></p>}
      <div className="space-y-2">{sources.data?.map(e => <label key={e.id} className="flex gap-2 items-start text-sm"><input type="checkbox" checked={ids.includes(e.id)} disabled={busy || active} onChange={event => setSelected(event.target.checked ? [...ids, e.id] : ids.filter(id => id !== e.id))} />{e.title}{e.confidence === 'retracted' ? ' (withdrawn; not proof)' : e.confidence === 'provisional' || e.in_flight ? ' (provisional or in progress)' : ''}</label>)}</div>
    </details>
    <div className="flex flex-wrap gap-3">
      <button className={primaryButton} disabled={busy || active || !sources.data || !!sources.error} onClick={() => void assess()}>{busy || active ? 'Assessment in progress' : current ? 'Reassess fit' : 'Assess fit'}</button>
      {active && <button className={secondaryButton} disabled={busy} onClick={() => void cancel()}>Cancel assessment</button>}
      <button className={secondaryButton} onClick={() => navigate(`/jobs/${job.id}/resume`)}>Tailor resume</button>
    </div>
    {active && <p role="status" className="text-sm">Work is running. Cancel this assessment here, or use Stop processing below for all work. The last saved assessment stays available.</p>}
    <p className="text-sm text-slate-600 dark:text-slate-300">Fit is advice, not a gate. You can tailor a resume regardless of this assessment. Salary and other personal preferences are not assessed here.</p>
    {current ? <div className="space-y-5">
      <p role="status" className="text-sm font-medium">{current.stale ? 'Inputs changed — this is the last checked assessment. Reassess when ready.' : 'Checked against captured posting and selected sources.'} <time>{new Date(current.assessment.assessed_at).toLocaleString()}</time></p>
      {(['backed', 'transferable', 'gap'] as const).map(kind => <section key={kind} className="space-y-3">
        <h3 className="font-semibold">{kind === 'backed' ? 'Supported matches' : kind === 'transferable' ? 'Transferable experience' : 'Unknown or missing proof'}</h3>
        {current.assessment.rows.filter(row => row.classification === kind).map(row => {
          const requirement = current.analysis.requirements.find(r => r.id === row.requirement_id);
          return <article key={row.requirement_id} className="border-t border-slate-200 dark:border-slate-700 pt-3 space-y-2 text-sm">
            <h4 className="font-medium">{requirement?.text ?? row.requirement_id}</h4>
            <blockquote className="text-slate-600 dark:text-slate-300">{requirement?.quote}</blockquote>
            {kind === 'gap' && <p>No supporting evidence found in the selected sources, or the available proof needs checking.</p>}
            <p>{row.rationale}</p>
            <details><summary className="cursor-pointer underline">Inspect evidence and checks ({row.citations.length})</summary>
              {row.citations.map(id => { const e = current.evidence.find(e => e.id === id); return <div key={id} className="mt-3"><strong>{e?.title ?? id}</strong><p className="whitespace-pre-wrap break-words">{e?.summary ?? 'Source unavailable'}</p><p className="whitespace-pre-wrap break-words">{e?.narrative}</p></div>; })}
              {row.issues?.map((issue, index) => <p key={index}>{issue.message}</p>)}
            </details>
          </article>;
        })}
        {!current.assessment.rows.some(row => row.classification === kind) && <p className="text-sm text-slate-500">None identified.</p>}
      </section>)}
      <details><summary className="cursor-pointer text-sm underline">Assessment history ({data.history.length})</summary>{data.history.map(item => <details key={item.input_snapshot_id} className="mt-3 text-sm"><summary>{new Date(item.assessment.assessed_at).toLocaleString()} — {item.stale ? 'Previous inputs' : 'Matching inputs'}</summary>{item.assessment.rows.map(row => <p key={row.requirement_id}>{item.analysis.requirements.find(r => r.id === row.requirement_id)?.text}: {row.classification === 'gap' ? 'Unknown support' : row.classification} — {row.rationale}</p>)}</details>)}</details>
    </div> : <p className="text-sm">Not assessed yet. Choose sources, then Assess fit. No resume, template or PDF tools are needed.</p>}
  </section>;
}
