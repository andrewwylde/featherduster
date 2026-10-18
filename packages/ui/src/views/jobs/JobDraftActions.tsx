import { primaryButton, secondaryButton } from '../tailoring/ui.js';
import { useEffect, useRef, useState } from 'react';
import { FinalizeJobDraftRequestSchema } from '@featherduster/core';
import type { DraftIssue, FinalizeJobDraftRequest, JobDraft, ResumeSpec } from '@featherduster/core';
import { apiClient, ApiError } from '../../api/client.js';
import type { JobDraftChecks } from './useJobDraftChecks.js';
export type JobLeaveGuard = (proceed: () => void) => void;
export function JobDraftActions({ draft, candidate, checks, onSaved, onBack, onBusy, onFocusIssue, onLeaveGuard, onDiscard }: {
  draft: JobDraft; candidate: ResumeSpec; onSaved(draft: JobDraft): void; onBack(): void;
  onBusy(busy: boolean): void; onFocusIssue(issue: DraftIssue): void;
  checks: JobDraftChecks; onLeaveGuard?(guard: JobLeaveGuard | null): void; onDiscard?(candidate: ResumeSpec): void;
}) {
  const saved = useRef(draft), lock = useRef(false), current = useRef(candidate);
  current.current = candidate;
  const [busy, setBusy] = useState<'save' | 'finalize' | null>(null);
  const [message, setMessage] = useState(''), [conflict, setConflict] = useState(false), [leaving, setLeaving] = useState(false);
  const [savedKey, setSavedKey] = useState(JSON.stringify(draft.candidate));
  const [reviewedCandidate, setReviewedCandidate] = useState<ResumeSpec | null>(null);
  const retryRequest = useRef<{ key: string; candidateKey: string; request: FinalizeJobDraftRequest }>();
const intentStorageKey = `job-finalize:${draft.job_id}:${draft.id}`;
const [hasPendingIntent, setHasPendingIntent] = useState(false);
useEffect(() => {
  try {
    const raw = sessionStorage.getItem(intentStorageKey);
    if (!raw) return;
    const value = JSON.parse(raw);
    if (typeof value.key !== 'string' || typeof value.candidateKey !== 'string') return;
    retryRequest.current = { key: value.key, candidateKey: value.candidateKey,
      request: FinalizeJobDraftRequestSchema.parse(value.request) };
    setHasPendingIntent(true);
  } catch { /* Invalid recovery data is never sent to the server. */ }
}, [intentStorageKey]);
const rememberIntent = (intent: { key: string; candidateKey: string; request: FinalizeJobDraftRequest }) => {
  retryRequest.current = intent;
  setHasPendingIntent(true);
  try { sessionStorage.setItem(intentStorageKey, JSON.stringify(intent)); } catch { /* in-memory retry still works */ }
};
const forgetIntent = () => {
  retryRequest.current = undefined; setHasPendingIntent(false);
  try { sessionStorage.removeItem(intentStorageKey); } catch {}
};
const recoverFinalization = async () => {
  const intent = retryRequest.current;
  if (!intent || lock.current) return;
  lock.current = true; setBusy('finalize'); onBusy(true); setMessage('');
  try {
    await apiClient.finalizeJobDraft(draft.job_id, draft.id, intent.request);
    forgetIntent();
    if (JSON.stringify(current.current) === intent.candidateKey) onBack();
    else setMessage('The previous finalization completed. Your newer local edits are still here; review the current resume before continuing.');
  } catch (e) {
    setMessage(e instanceof Error ? e.message : 'Could not retrieve the finalization result.');
    if (e instanceof ApiError && e.status === 409) setConflict(true);
  } finally { lock.current = false; setBusy(null); onBusy(false); checks.retry(); }
};


  const saveAndReturnRef = useRef<HTMLButtonElement>(null);
  const backRef = useRef<HTMLButtonElement>(null);
  useEffect(() => { if (leaving) saveAndReturnRef.current?.focus(); }, [leaving]);
  const pendingDestination = useRef<(() => void) | null>(null);
  const leave = () => { const next = pendingDestination.current; pendingDestination.current = null; if (next) next(); else onBack(); };
  useEffect(() => {
    onLeaveGuard?.(proceed => {
      if (lock.current) { setMessage('Wait for the current save or finalization.'); return; }
      if (JSON.stringify(current.current) === JSON.stringify(saved.current.candidate)) { proceed(); return; }
      pendingDestination.current = proceed; setLeaving(true);
    });
    return () => onLeaveGuard?.(null);
  }, [onLeaveGuard]);
  const dirty = JSON.stringify(candidate) !== savedKey;
  useEffect(() => {
    if (draft.revision > saved.current.revision) { saved.current = draft; setSavedKey(JSON.stringify(draft.candidate)); }
  }, [draft]);
  useEffect(() => {
    if (!dirty) return;
    const unload = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ''; };
    window.addEventListener('beforeunload', unload); return () => window.removeEventListener('beforeunload', unload);
  }, [dirty]);
  const persist = async (snapshot: ResumeSpec) => {
    if (JSON.stringify(snapshot) === JSON.stringify(saved.current.candidate)) return saved.current;
    const result = await apiClient.saveJobDraft(draft.job_id, draft.id, saved.current.revision, snapshot);
    saved.current = result.draft; setSavedKey(JSON.stringify(snapshot)); onSaved(result.draft); return result.draft;
  };
  const act = async (kind: 'save' | 'finalize', leave = false) => {
    if (lock.current || conflict || (kind === 'finalize' && !checks.ready)) return;
    const check = checks.check, snapshot = structuredClone(current.current);
    lock.current = true; setBusy(kind); setMessage(''); if (kind === 'finalize') onBusy(true);
    try {
      const next = await persist(snapshot);
      if (kind === 'save') {
        setMessage('Draft saved.');
        if (leave && JSON.stringify(current.current) === JSON.stringify(snapshot)) {
          const nextDestination = pendingDestination.current; pendingDestination.current = null;
          if (nextDestination) nextDestination(); else onBack();
        }
        else if (leave) setMessage('New edits arrived while saving. Save again before leaving.');
      } else if (check) {
        const key = JSON.stringify([next.id, next.revision, check.job_revision, check.binding]);
        const request = retryRequest.current?.key === key ? retryRequest.current.request : {
          expected_job_revision: check.job_revision, expected_draft_revision: next.revision,
          binding: check.binding, idempotency_key: crypto.randomUUID(),
        };
        rememberIntent({ key, request, candidateKey: JSON.stringify(snapshot) });
        await apiClient.finalizeJobDraft(draft.job_id, draft.id, request);
        forgetIntent(); onBack();
      }
    } catch (error) {
      const text = error instanceof Error ? error.message : 'Request failed. Your edits are retained.';
      setMessage(text);
      if (error instanceof ApiError && error.status === 409) setConflict(true);
    } finally {
      lock.current = false; setBusy(null); onBusy(false);
      if (kind === 'finalize') checks.retry();
    }
  };
  const reloadRevision = async () => {
    try {
      const result = await apiClient.getJobDraft(draft.job_id, draft.id);
      saved.current = result.draft; setSavedKey(JSON.stringify(result.draft.candidate));
      setReviewedCandidate(result.draft.candidate);
      onSaved(result.draft); forgetIntent(); setConflict(false); checks.retry();
      setMessage('Latest saved revision loaded. Your local edits are retained; review before saving over it.');
    } catch (e) { setMessage(e instanceof Error ? e.message : 'Reload failed.'); }
  };
  return <section className="space-y-3 rounded-xl border border-slate-700 p-4" aria-label="Job resume actions">
    <div className="flex flex-wrap gap-2">
      <button className={secondaryButton} type="button" disabled={!!busy || conflict} onClick={() => void act('save')}>Save draft</button>
      <button className={primaryButton} type="button" disabled={!!busy || conflict || !checks.ready} onClick={() => void act('finalize')}>Finalize resume</button>
      <button className={secondaryButton} ref={backRef} type="button" disabled={!!busy} onClick={() => dirty ? setLeaving(true) : onBack()}>Back to resume</button>
    </div>
    <p role="status" aria-live="polite">{busy === 'finalize' ? 'Finalizing resume…' : busy === 'save' ? 'Saving…' : dirty ? 'Unsaved changes' : 'Draft saved'}</p>
    <p role="status" aria-live="polite">{checks.status === 'checking' ? 'Checking current edits…' : checks.ready ? 'Ready to finalize' : checks.status === 'blocked' ? 'Resolve the issues below to finalize. Saving is available.' : 'Checks unavailable — Retry'}</p>
    {hasPendingIntent && <button disabled={!!busy} onClick={() => void recoverFinalization()}>Check finalization result</button>}
    {checks.error && <p>{checks.error}</p>}
    {checks.status === 'unavailable' && <button disabled={!!busy} onClick={checks.retry}>Retry checks</button>}
    {checks.issues.length > 0 && <ul aria-label="Resume issues">{checks.issues.map((issue, i) => <li key={`${issue.path}-${issue.code}-${i}`}>
      {issue.path ? <button onClick={() => onFocusIssue(issue)}>{issue.message}</button> : issue.message}
    </li>)}</ul>}
    {message && <p role="status">{message}</p>}
    {conflict && <button disabled={!!busy} onClick={() => void reloadRevision()}>Review latest saved revision</button>}
    {reviewedCandidate && <details><summary>Latest saved content</summary><pre className="whitespace-pre-wrap break-words">{JSON.stringify(reviewedCandidate, null, 2)}</pre></details>}
    {leaving && <section role="region" aria-label="Unsaved changes" className="rounded border p-3">
      <p>Save your changes before returning to the resume?</p>
      <button ref={saveAndReturnRef} disabled={!!busy || conflict} onClick={() => void act('save', true)}>Save and return</button>
      <button disabled={!!busy} onClick={() => { pendingDestination.current = null; setLeaving(false); backRef.current?.focus(); }}>Keep editing</button>
      <button disabled={!!busy} onClick={() => { onDiscard?.(saved.current.candidate); current.current = saved.current.candidate; leave(); }}>Discard unsaved changes and return</button>
    </section>}
  </section>;
}

