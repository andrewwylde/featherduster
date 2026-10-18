import { useEffect, useRef, useState } from 'react';
import { baseText, type Job, type ProposalBaseCorrectionResponse, type ProposalReviewRevision, type ResumeSpec } from '@featherduster/core';
import { apiClient } from '../../api/client.js';
import { useIntentKey } from '../../hooks/useJobsData.js';
import { inputClass, primaryButton } from '../tailoring/ui.js';
import { requestErrorMessage } from './job-utils.js';

/** This draft saves a job-local overlay on the active review, never the shared career file. */
export function JobStartingResumeCorrection({ job, review, resume, path, disabled, onSaved }: {
  job: Job; review: Pick<ProposalReviewRevision, 'id' | 'revision' | 'input_snapshot_id' | 'input_fingerprint'>; resume: ResumeSpec; path: string; disabled: boolean; onSaved: (result: ProposalBaseCorrectionResponse['result']) => void;
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
  const [revision, setRevision] = useState(restored.revision);
  const pending = useRef(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const key = useIntentKey();
  const dirty = text !== original;
  useEffect(() => { if (!dirty && job.revision > revision) setRevision(job.revision); }, [dirty, job.revision, revision]);
  useEffect(() => {
    try { if (dirty) localStorage.setItem(storageKey, JSON.stringify({ text, revision })); else localStorage.removeItem(storageKey); }
    catch { setMessage('Browser draft storage is unavailable. Keep this tab open until saved.'); }
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ''; };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty, text, storageKey, revision]);
  if (original === undefined) return <p>This location cannot be edited as text. Inspect the captured resume before preparing again.</p>;
  return <div className="space-y-3">
    <p>This is starting-resume wording, not a generated proposal. Save a job-local copy; your shared resume and previous materials stay unchanged.</p>
    <label className="block">Starting wording<textarea aria-label="Starting wording" className={inputClass} value={text} disabled={busy || disabled} onChange={e => setText(e.target.value)} /></label>
    <button className={primaryButton} disabled={busy || disabled || !dirty || job.revision > revision} onClick={async () => {
      if (pending.current) return;
      pending.current = true;
      setBusy(true); setMessage('');
      const body = { expected_job_revision: revision, review_id: review.id, expected_review_revision: review.revision, input_fingerprint: review.input_fingerprint, path, text };
      try {
        const response = await apiClient.correctJobStartingResume(job.id, { ...body, idempotency_key: key(body) });
        try { localStorage.removeItem(storageKey); } catch { /* storage failure is already displayed */ }
        setSaved(text); setRevision(response.result.job.revision);
        setMessage('Job-local starting resume saved and rechecked. Your shared resume is unchanged; no generation has started.');
        onSaved(response.result);
      } catch (error) { setMessage(requestErrorMessage(error, { timeout: 'The save is taking longer than expected. Your edits are kept in this browser; try again.', fallback: 'Save failed. Your draft is retained.' })); }
      finally { pending.current = false; setBusy(false); }
    }}>Save starting resume for this job</button>
    {job.revision > revision && <p role="alert">The job changed while this correction was open. Your text is retained. Inspect the current inputs before saving; this draft cannot overwrite a newer version.</p>}
    <p role="status">{message}</p>
  </div>;
}
