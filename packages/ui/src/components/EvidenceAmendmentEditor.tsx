import { useEffect, useState } from 'react';
import type { CorpusPreviewResponse, CorpusWriteRequest, EvidenceEntry } from '@featherduster/core';
import { apiClient } from '../api/client.js';
import { useIntentKey } from '../hooks/useJobsData.js';
import { inputClass, secondaryButton } from '../views/tailoring/ui.js';

/** Companion amendments never rewrite the source file, including consolidated ledgers. */
export function EvidenceAmendmentEditor({ entry, narrative, onSaved }: { entry: EvidenceEntry; narrative: string; onSaved: () => void }) {
  const [explanation, setExplanation] = useState('');
  const [preview, setPreview] = useState<{ request: CorpusWriteRequest; result: CorpusPreviewResponse; storage: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const key = useIntentKey();
  useEffect(() => { setPreview(null); }, [entry, narrative, explanation]);
  return <section className="space-y-2 border-t pt-3">
    <h3>Companion amendment</h3><p className="text-xs">Use for consolidated ledgers or an auditable correction. Source bytes stay unchanged. Factual additions are user-confirmed provisional; new or changed metrics are unverified. Current jobs require explicit input refresh.</p>
    <label>Amendment explanation<input aria-label="Amendment explanation" className={inputClass} value={explanation} onChange={e => setExplanation(e.target.value)} /></label>
    <button type="button" className={secondaryButton} disabled={busy || !explanation.trim()} onClick={async () => {
      setBusy(true); setMessage('');
      try {
        const view = await apiClient.getCorpus();
        const record = view.records.find(r => r.source.id === entry.id);
        if (!record) throw new Error('Source is missing; reload evidence before reconciling.');
        const amended = { ...entry, confidence: 'provisional' as const, metrics: entry.metrics.map(m => record.source.metrics.some(old => JSON.stringify(old) === JSON.stringify(m)) ? m : { ...m, status: 'provisional' }) };
        const body = { workspace_id: view.workspace_id, expected_revision: view.snapshot.revision, explanation, change: { kind: 'evidence_amendment' as const, value: { evidence_id: entry.id, base_fingerprint: record.fingerprint, entry: amended, narrative, confirmation_basis: 'user_confirmed' as const, explanation } } };
        const request = { ...body, idempotency_key: key(body) };
        setPreview({ request, result: await apiClient.previewCorpusChange(request), storage: record.storage_kind });
      } catch (e) { setMessage(e instanceof Error ? e.message : 'Preview failed'); } finally { setBusy(false); }
    }}>Preview companion amendment</button>
    {preview && <div><p>Storage: {preview.storage}. Review the exact amendment before saving.</p><pre className="whitespace-pre-wrap break-words text-xs">{JSON.stringify({ change: preview.request.change, conflicts: preview.result.conflicts, confidence_changes: preview.result.confidence_changes }, null, 2)}</pre>
      <button type="button" className={secondaryButton} disabled={busy} onClick={async () => { setBusy(true); try { await apiClient.rememberCorpusChange(preview.request); setMessage('Companion amendment saved. Source file unchanged.'); setPreview(null); onSaved(); } catch (e) { setMessage(e instanceof Error ? e.message : 'Save failed; edits retained.'); } finally { setBusy(false); } }}>Save companion amendment</button>
    </div>}
    <p role="status">{message}</p>
  </section>;
}

/** Also reachable from evidence details for verified entries outside the proof queue. */
export function EvidenceCorrection({ entry, narrative, onSaved }: { entry: EvidenceEntry; narrative: string; onSaved: () => void }) {
  const [draft, setDraft] = useState(entry);
  const [open, setOpen] = useState(false);
  const [text, setText] = useState(narrative);
  return <details><summary onClick={() => setOpen(value => !value)}>Correct evidence with a companion amendment</summary>{open && <>
    <label>Corrected summary<textarea aria-label="Corrected summary" className={inputClass} value={draft.summary} onChange={e => setDraft({ ...draft, summary: e.target.value })} /></label>
    <label>Corrected narrative<textarea aria-label="Corrected narrative" className={inputClass} value={text} onChange={e => setText(e.target.value)} /></label>
    <EvidenceAmendmentEditor entry={draft} narrative={text} onSaved={onSaved} /></> }
  </details>;
}
