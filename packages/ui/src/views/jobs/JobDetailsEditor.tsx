import { useEffect, useRef, useState } from 'react';
import type { Job, PostingSnapshot } from '@featherduster/core';
import { apiClient } from '../../api/client.js';
import { useIntentKey } from '../../hooks/useJobsData.js';
import { inputClass, primaryButton, secondaryButton } from '../tailoring/ui.js';

type Draft = { revision: number; company: string; role: string; context_url: string; notes: string; posting: string };
const fromSaved = (job: Job, posting: PostingSnapshot | null): Draft => ({ revision: job.revision, company: job.company ?? '', role: job.role ?? '', context_url: job.context_url ?? job.canonical_url ?? '', notes: job.notes ?? '', posting: posting?.text ?? '' });

export function JobDetailsEditor({ job, posting, onSaved }: { job: Job; posting: PostingSnapshot | null; onSaved: () => void }) {
  const storageKey = `job-details:${job.workspace_id}:${job.id}`;
  const [draft, setDraft] = useState<Draft>(() => {
    try {
      const stored = JSON.parse(localStorage.getItem(storageKey) ?? 'null');
      if (stored && Number.isInteger(stored.revision) && ['company', 'role', 'context_url', 'notes', 'posting'].every(k => typeof stored[k] === 'string')) return stored;
    } catch { /* Keep server content when browser storage is unavailable. */ }
    return fromSaved(job, posting);
  });
  const [dirty, setDirty] = useState(() => { try { return localStorage.getItem(storageKey) !== null; } catch { return false; } });
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const pending = useRef(false);
  const intent = useIntentKey();
  useEffect(() => { if (!dirty) setDraft(fromSaved(job, posting)); }, [job, posting, dirty]);
  const change = (field: keyof Omit<Draft, 'revision'>, value: string) => {
    const next = { ...draft, [field]: value }; setDraft(next); setDirty(true);
    try { localStorage.setItem(storageKey, JSON.stringify(next)); } catch { setMessage('Browser draft storage is unavailable. Keep this page open until saved.'); }
  };
  const save = async () => {
    if (pending.current) return;
    pending.current = true; setBusy(true); setMessage('');
    const body = { expected_revision: draft.revision, changes: { company: draft.company.trim() || null, role: draft.role.trim() || null, context_url: draft.context_url.trim() || null, notes: draft.notes }, ...(draft.posting.trim() ? { posting_text: draft.posting.trim() } : {}) };
    try {
      const response = await apiClient.saveJobDetails(job.id, { ...body, idempotency_key: intent(body) });
      setDraft({ ...draft, revision: response.result.job.revision });
      try { localStorage.removeItem(storageKey); } catch { /* Server save succeeded. */ }
      setDirty(false); setMessage('Saved. Preparation has not started.'); onSaved();
    } catch (error) { setMessage(`${error instanceof Error ? error.message : 'Save failed'}. Your draft is retained.`); }
    finally { pending.current = false; setBusy(false); }
  };
  const conflict = dirty && draft.revision !== job.revision;
  return <div className="space-y-3" aria-label="Saved job details">
    <h3 className="font-semibold">Job details and context</h3>
    <p className="text-xs text-slate-500">Save details without generating anything. Changing the posting retains previous materials but requires new checks.</p>
    {([['company', 'Company'], ['role', 'Position'], ['context_url', 'Optional posting link'], ['notes', 'Notes'], ['posting', 'Posting and context']] as const).map(([field, label]) => <label key={field} className="block text-xs font-medium">
      {label}{field === 'notes' || field === 'posting' ? <textarea aria-label={label} className={`${inputClass} min-h-28`} value={draft[field]} disabled={busy} onChange={e => change(field, e.target.value)} /> : <input className={inputClass} value={draft[field]} disabled={busy} onChange={e => change(field, e.target.value)} />}
    </label>)}
    {conflict && <div role="alert" className="space-y-2">
      <p>The saved job changed. Your draft has not been overwritten. Compare before using the current revision.</p>
      <details><summary>Compare current saved details</summary><pre className="whitespace-pre-wrap">{JSON.stringify(fromSaved(job, posting), null, 2)}</pre></details>
      <button className={secondaryButton} disabled={busy} onClick={() => { const next = { ...draft, revision: job.revision }; setDraft(next); try { localStorage.setItem(storageKey, JSON.stringify(next)); } catch { /* Draft remains mounted. */ } }}>Keep my draft against current revision</button>
    </div>}
    <button className={primaryButton} disabled={busy || !dirty || conflict} onClick={() => void save()}>Save job details</button>
    {dirty && <p className="text-xs">Unsaved details</p>}
    {message && <p role="status">{message}</p>}
  </div>;
}
