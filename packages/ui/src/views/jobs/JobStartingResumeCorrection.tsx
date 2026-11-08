import { useEffect, useRef, useState } from 'react';
import { baseText, type Job, type EvidenceRecord, type ProposalBaseCorrectionResponse, type ProposalReviewRevision, type ResumeSpec } from '@featherduster/core';
import { apiClient } from '../../api/client.js';
import { useIntentKey } from '../../hooks/useJobsData.js';
import { inputClass, primaryButton } from '../tailoring/ui.js';
import { requestErrorMessage } from './job-utils.js';

/** This draft saves a job-local overlay on the active review, never the shared career file. */
export function JobStartingResumeCorrection({ job, review, resume, path, disabled, evidence, onSaved, onDraftChange, autoSaveStatus, onSaveMixed }: {
  job: Job; review: Pick<ProposalReviewRevision, 'id' | 'revision' | 'input_snapshot_id' | 'input_fingerprint'>; resume: ResumeSpec; path: string; disabled: boolean; evidence?: EvidenceRecord[]; onSaved: (result: ProposalBaseCorrectionResponse['result']) => void;
  onDraftChange?: (draft: { path: string; text: string; citations?: string[]; before: string } | null) => void;
  autoSaveStatus?: string;
  onSaveMixed?: () => void;
}) {
  const current = baseText(resume, path);
  // Our own save is the new baseline until the reloaded review shows it.
  const [saved, setSaved] = useState<string | null>(null);
  useEffect(() => setSaved(null), [current]);
  const original = saved ?? current;
  const storageKey = `starting-resume:${job.workspace_id}:${job.id}:${review.input_snapshot_id}:${path}`;
  const [restored] = useState(() => {
    try {
      const value = localStorage.getItem(storageKey);
      if (value !== null) {
        try {
          const draft = JSON.parse(value);
          if (typeof draft.text === 'string' && Number.isInteger(draft.revision)) return draft as { text: string; revision: number };
        } catch { /* Retain older plain-text drafts without silently rebinding them. */ }
        return { text: value, revision: -1 };
      }
    } catch { /* In-memory editing remains available. */ }
    return { text: original ?? '', revision: job.revision };
  });
  const [text, setText] = useState(restored.text);
  const indices = /^experiences\.(\d+)\.bullets\.(\d+)\.text$/.exec(path);
  const originalCitations = indices ? resume.experiences[Number(indices[1])]?.bullets[Number(indices[2])]?.citations ?? [] : [];
  const [citations, setCitations] = useState<string[]>(() => { try { return JSON.parse(localStorage.getItem(`${storageKey}:sources`) ?? 'null') ?? originalCitations; } catch { return originalCitations; } });
  const [revision, setRevision] = useState(restored.revision);
  const pending = useRef(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const key = useIntentKey();
  const dirty = text !== original || JSON.stringify(citations) !== JSON.stringify(originalCitations);
  useEffect(() => { try {
    if (indices && evidence && JSON.stringify(citations) !== JSON.stringify(originalCitations)) localStorage.setItem(`${storageKey}:sources`, JSON.stringify(citations));
    else localStorage.removeItem(`${storageKey}:sources`);
  } catch {} }, [storageKey, citations, JSON.stringify(originalCitations), !!evidence]);
  useEffect(() => { if (!dirty && job.revision > revision) setRevision(job.revision); }, [dirty, job.revision, revision]);
  useEffect(() => {
    try { if (dirty) localStorage.setItem(storageKey, JSON.stringify({ text, revision })); else localStorage.removeItem(storageKey); }
    catch { setMessage('Browser draft storage is unavailable. Keep this tab open until saved.'); }
    if (dirty) {
      onDraftChange?.({ path, text, citations: indices && evidence ? citations : undefined, before: original ?? '' });
    } else {
      onDraftChange?.(null);
    }
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ''; };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty, text, storageKey, revision, citations, path, original]);
  if (original === undefined) return <p>This location cannot be edited as text. Inspect the captured resume before preparing again.</p>;
  return <div className="space-y-3">
    <p className="text-sm text-slate-500 dark:text-slate-400">Revise the passage below, then save to recheck it for this job.</p>
    <div className="grid gap-4 md:grid-cols-2">
      <div className="space-y-2"><h4 className="text-xs font-semibold">Before: current starting resume</h4><p className="rounded-desk border border-slate-200 p-3 text-sm leading-relaxed dark:border-slate-800">{original}</p></div>
      <div className="space-y-2"><h4 className="text-xs font-semibold">After: your revision</h4>
        <label className="block text-sm">Starting wording<textarea rows={6} aria-label="Starting wording" className={inputClass} value={text} disabled={busy || disabled} onChange={e => setText(e.target.value)} /></label>
      </div>
    </div>
    {indices && evidence && <details><summary>Evidence — add or remove sources</summary>{evidence.map(source => <div className="py-2" key={source.id}>
      <label><input type="checkbox" disabled={busy || disabled || source.confidence === 'retracted'} checked={citations.includes(source.id)} onChange={e => setCitations(ids => e.target.checked ? [...ids, source.id] : ids.filter(id => id !== source.id))} /> {source.title}</label><blockquote className="text-sm">{source.summary}</blockquote>
    </div>)}</details>}
    <button className={primaryButton} disabled={busy || disabled || !dirty || job.revision > revision} onClick={async () => {
      if (onSaveMixed) {
        onSaveMixed();
        return;
      }
      if (pending.current) return;
      pending.current = true;
      setBusy(true); setMessage('');
      const body = { expected_job_revision: revision, review_id: review.id, expected_review_revision: review.revision, input_fingerprint: review.input_fingerprint, path, text, ...(indices && evidence ? { citations } : {}) };
      try {
        const response = await apiClient.correctJobStartingResume(job.id, { ...body, idempotency_key: key(body) });
        try { localStorage.removeItem(storageKey); } catch { /* storage failure is already displayed */ }
        setSaved(text); setRevision(response.result.job.revision);
        setMessage('Job-local starting resume saved and rechecked. Your shared resume is unchanged; no generation has started.');
        onSaved(response.result);
      } catch (error) { setMessage(requestErrorMessage(error, { timeout: 'The save is taking longer than expected. Your edits are kept in this browser; try again.', fallback: 'Save failed. Your draft is retained.' })); }
      finally { pending.current = false; setBusy(false); }
    }}>{busy ? 'Saving and checking…' : 'Save starting resume for this job'}</button>
    {!dirty && !busy && <p className="text-xs text-slate-500 dark:text-slate-400">Edit the wording above to enable saving. To keep this wording, use the fact confirmation action.</p>}
    {job.revision > revision && <p role="alert">The job changed while this correction was open. Your text is retained. Inspect the current inputs before saving; this draft cannot overwrite a newer version.</p>}
    <p role="status">{autoSaveStatus || message}</p>
  </div>;
}
