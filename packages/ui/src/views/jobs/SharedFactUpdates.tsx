import { useEffect, useState } from 'react';
import type { PassageEdit } from '@featherduster/core';
import { cardClass, inputClass, primaryButton, secondaryButton } from '../tailoring/ui.js';
interface Affected { job_id: string; company: string; role: string; fingerprint: string; busy: boolean; historical_artifact: string | null; edits: (PassageEdit & { corrections: { update_id: string; answer: string }[] })[] }
interface History { job_id: string; operation_key: string; edits: PassageEdit[]; undone: boolean; check: { status: string; error?: string } }
interface View { corpus_revision: number; jobs: Affected[]; history: History[]; incomplete?: boolean; next_cursor?: string }
async function request<T>(path: string, body?: unknown): Promise<T> {
  const response = await fetch(path, body ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : undefined);
  const value = await response.json(); if (!response.ok) throw Error(value.error ?? 'Could not update drafts.'); return value;
}
export function SharedFactUpdates({ onSaved }: { onSaved(): void }) {
  const [view, setView] = useState<View>(), [selected, setSelected] = useState<string[]>([]), [busy, setBusy] = useState(false), [message, setMessage] = useState('');
  const load = (cursor?: string) =>
    request<View>(`/api/jobs/clarification-updates${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ''}`)
      .then(v => {
        setView(prev => {
          if (!cursor || !prev) return v;
          const existingIds = new Set(prev.jobs.map(j => j.job_id));
          return { ...v, jobs: [...prev.jobs, ...v.jobs.filter(j => !existingIds.has(j.job_id))] };
        });
      })
      .catch(e => setMessage(e.message));
  useEffect(() => { void load(); }, []);
  if (!view && !message) return null;
  if (view && !view.jobs.length && !view.history.length && !view.incomplete) return null;
  return <section aria-label="Shared factual corrections" className={`${cardClass} p-4 space-y-3`}>
    <h2 className="font-semibold">Shared factual corrections</h2>
    <p className="text-sm">Select affected drafts to update. Unrelated wording stays unchanged. Approved PDFs remain historical versions; updated drafts need fresh checks and PDF approval.</p>
    {view?.incomplete && <div className="text-sm bg-amber-50 text-amber-900 border border-amber-200 p-2 rounded flex items-center justify-between">
      <span>Draft discovery was bounded to keep the interface responsive; additional drafts may be affected.</span>
      <button className={secondaryButton} disabled={busy} onClick={() => void load(view?.next_cursor)}>Scan remaining</button>
    </div>}
    <p role="status">{message}</p>{!view && message && <button className={secondaryButton} onClick={() => void load()}>Retry loading affected drafts</button>}
    {view?.jobs.map(job => <section key={job.job_id} className="border-t pt-3 space-y-2">
      <label><input type="checkbox" disabled={busy || job.busy} checked={selected.includes(job.job_id)} onChange={e => setSelected(ids => e.target.checked ? [...ids, job.job_id] : ids.filter(id => id !== job.job_id))} /> {job.company} — {job.role}</label>
      {job.edits.map((edit, index) => <div key={edit.path} className="space-y-1"><p className="text-sm"><strong>Before: </strong>{edit.before}</p>
        {edit.corrections.map(c => <p className="text-sm" key={c.update_id}>Corrected answer: {c.answer}</p>)}
        <label className="block text-sm">Updated wording<textarea className={inputClass} value={edit.after} disabled={busy} onChange={e => setView(v => v && ({ ...v, jobs: v.jobs.map(j => j.job_id === job.job_id ? { ...j, edits: j.edits.map((x, i) => i === index ? { ...x, after: e.target.value } : x) } : j) }))} /></label>
      </div>)}
    </section>)}
    {!!view?.jobs.length && <button className={primaryButton} disabled={busy || !selected.length} onClick={async () => {
      setBusy(true); setMessage('Saving selected changes, then checking each draft…');
      try {
        const result = await request<{ results: { job_id: string; status: string; error?: string }[] }>('/api/jobs/clarification-updates', { expected_corpus_revision: view.corpus_revision, idempotency_key: crypto.randomUUID(), jobs: view.jobs.filter(j => selected.includes(j.job_id)).map(j => ({ job_id: j.job_id, fingerprint: j.fingerprint, edits: j.edits.map(({ path, before, after }) => ({ path, before, after })) })) });
        setMessage(result.results.map(r => `${view.jobs.find(j => j.job_id === r.job_id)?.company}: ${r.error ?? r.status}`).join(' · ')); setSelected([]); await load(); onSaved();
      } catch (e) { setMessage(e instanceof Error ? e.message : 'Could not update selected drafts.'); } finally { setBusy(false); }
    }}>{busy ? 'Saving and checking…' : 'Update selected'}</button>}
    {!!view?.history.length && <details><summary>Correction changes and undo</summary>{view.history.map(h => <section key={h.operation_key} className="py-3 border-b">
      <a href={`/jobs/${h.job_id}/resume`}>Open affected resume</a>{h.edits.map(e => <p key={e.path}><del>{e.before}</del> → {e.after}</p>)}
      <p>{h.undone ? 'Undone' : h.check?.status === 'ready' ? 'Resolved — checked independently' : h.check?.status === 'blocked' ? 'Needs your answer' : 'Needs retry'} {h.check?.error}</p>
      <button className={secondaryButton} disabled={busy || h.undone} onClick={async () => { setBusy(true); try { await request('/api/jobs/clarification-updates/undo', { operation_key: h.operation_key }); setMessage('Wording update undone. The corrected fact remains recorded.'); await load(); onSaved(); } catch (e) { setMessage(e instanceof Error ? e.message : 'Undo failed.'); } finally { setBusy(false); } }}>Undo update</button>
    </section>)}</details>}
  </section>;
}
