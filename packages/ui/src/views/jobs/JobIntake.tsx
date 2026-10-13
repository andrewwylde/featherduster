import { useRef, useState } from 'react';
import { apiClient, type IntakePreview, type IntakeResult } from '../../api/client.js';
import { useIntentKey } from '../../hooks/useJobsData.js';

export function JobIntake({ onSaved, fallback }: { onSaved: () => void; fallback?: { id: string; revision: number } }) {
  const [mode, setMode] = useState<'urls' | 'text'>(fallback ? 'text' : 'urls');
  const [input, setInput] = useState('');
  const [preview, setPreview] = useState<IntakePreview | null>(null);
  const [result, setResult] = useState<IntakeResult | null>(null);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const inFlight = useRef(false);
  const key = useIntentKey();
  const run = async (commit: boolean) => {
    if (inFlight.current) return;
    inFlight.current = true; setBusy(true); setMessage('');
    try {
      if (commit && preview) {
        setResult(await apiClient.addJobs(preview.preview_id, key(preview.preview_id)));
        setPreview(null); onSaved();
        const status = await apiClient.getJobsControl();
        setMessage(status.control.stopped_at || !status.control.automatic_preparation_enabled ? 'Saved; automatic preparation is stopped.' : 'Saved.');
      } else {
        setResult(null);
        setPreview(await apiClient.previewJobs({ mode, input, ...(fallback ? { fallback_job_id: fallback.id, expected_revision: fallback.revision } : {}) }));
      }
    } catch (e) { setMessage(`${e instanceof Error ? e.message : 'Intake failed'}. Preview again if expired; your text is retained.`); }
    finally { setBusy(false); inFlight.current = false; }
  };
  return <section className="space-y-3 rounded-lg border p-4" aria-label="Job intake">
    <h2 className="font-semibold">{fallback ? 'Paste posting text' : 'Add jobs'}</h2>
    {!fallback && <label>Intake mode <select value={mode} disabled={busy} onChange={e => { setMode(e.target.value as 'urls' | 'text'); setPreview(null); setResult(null); }}><option value="urls">URLs (one per line)</option><option value="text">Posting text</option></select></label>}
    <label className="block">{mode === 'text' ? 'Posting text' : 'Job URLs'}<textarea className="block w-full min-h-32 rounded border bg-transparent p-2" disabled={busy} value={input} onChange={e => { setInput(e.target.value); setPreview(null); setResult(null); }} /></label>
    <button className="min-h-[44px] border rounded px-4" disabled={busy || !input.trim()} onClick={() => void run(false)}>Preview</button>
    {preview && <button className="min-h-[44px] border rounded px-4" disabled={busy} onClick={() => void run(true)}>Add jobs</button>}
    <ul className="space-y-2 break-words">{(result?.items ?? preview?.preview.items ?? []).map(row => <li key={row.index}>
      {row.job?.company ?? row.original} — {'disposition' in row ? String(row.disposition) : row.valid ? 'Ready to add' : 'Invalid'}
      {row.error && <p>{row.error.message}</p>}{row.fallback_available && <p>Paste posting text after saving.</p>}
      {!!(row.duplicate_id || ('job_id' in row && row.job_id)) && <a className="underline" href={`/jobs/${row.duplicate_id || ('job_id' in row && row.job_id)}`}>Open job</a>}
      {row.candidates.map((c, i) => <p key={i}>{c.company} — {c.role} (discovered; not queued)</p>)}
    </li>)}</ul>
    {message && <p role="status">{message}</p>}
  </section>;
}
