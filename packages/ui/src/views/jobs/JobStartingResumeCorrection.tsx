import { useEffect, useRef, useState } from 'react';
import type { Job, ResumeSpec } from '@featherduster/core';
import { apiClient } from '../../api/client.js';
import { useIntentKey } from '../../hooks/useJobsData.js';
import { inputClass, primaryButton } from '../tailoring/ui.js';

/** This draft edits only the captured job input, never the shared career file. */
export function JobStartingResumeCorrection({ job, inputId, resume, path, disabled, onSaved }: {
  job: Job; inputId: string; resume: ResumeSpec; path: string; disabled: boolean; onSaved: () => void;
}) {
  const match = /^experiences\.(\d+)\.bullets\.(\d+)\.text$/.exec(path);
  const original = path === 'summary' ? resume.summary ?? '' : match ? resume.experiences[Number(match[1])]?.bullets[Number(match[2])]?.text : undefined;
  const storageKey = `starting-resume:${job.workspace_id}:${job.id}:${inputId}:${path}`;
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
  useEffect(() => { if (!dirty) setRevision(job.revision); }, [dirty, job.revision]);
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
    <button className={primaryButton} disabled={busy || disabled || !dirty || job.revision !== revision} onClick={async () => {
      if (pending.current) return;
      pending.current = true;
      setBusy(true); setMessage('');
      const candidate = structuredClone(resume);
      if (path === 'summary') candidate.summary = text;
      else if (match) candidate.experiences[Number(match[1])].bullets[Number(match[2])].text = text;
      const body = { expected_job_revision: revision, input_snapshot_id: inputId, base_resume: candidate };
      try {
        await apiClient.correctJobStartingResume(job.id, { ...body, idempotency_key: key(body) });
        localStorage.removeItem(storageKey);
        setMessage('Job-local starting resume saved. Previous checks are stale. Choose Prepare refreshed inputs explicitly to use this correction; no generation has started.');
        onSaved();
      } catch (error) { setMessage(error instanceof Error ? error.message : 'Save failed. Your draft is retained.'); }
      finally { pending.current = false; setBusy(false); }
    }}>Save starting resume for this job</button>
    {job.revision !== revision && <p role="alert">The job changed while this correction was open. Your text is retained. Inspect the current inputs before saving; this draft cannot overwrite a newer version.</p>}
    <p role="status">{message}</p>
  </div>;
}
