import { useCallback, useEffect, useState } from 'react';
import type { ClientCorpusChange, CorpusPreviewResponse, CorpusUpdate, CorpusView, CorpusWriteRequest } from '@featherduster/core';
import { apiClient } from '../api/client.js';
import { useLiveSync } from '../hooks/useLiveSync.js';
import { useIntentKey } from '../hooks/useJobsData.js';
import { cardClass, inputClass, secondaryButton } from '../views/tailoring/ui.js';
import { formatDateTime } from '../views/jobs/job-utils.js';
import { appliesTo, sourceTitles, supportDescription, uniqueLabels, withdrawEffect, withdrawLabel } from './corpus-labels.js';
import { ConfirmWithdraw } from './ConfirmWithdraw.js';

function Reconcile({ view, update, onSaved }: { view: CorpusView; update: CorpusUpdate; onSaved: () => void }) {
  const [change, setChange] = useState<ClientCorpusChange>(() => {
    const c = structuredClone(update.change);
    if (c.kind === 'skill_support') return { ...c, value: { ...c.value, sources: c.value.sources.map(({ source_status: _, ...s }) => ({ ...s, evidence_fingerprint: view.records.find(r => r.source.id === s.evidence_id)?.fingerprint ?? s.evidence_fingerprint })) } };
    if (c.kind === 'evidence_amendment') c.value.base_fingerprint = view.records.find(r => r.source.id === c.value.evidence_id)?.fingerprint ?? c.value.base_fingerprint;
    return c;
  });
  const [explanation, setExplanation] = useState('');
  const [preview, setPreview] = useState<{ request: CorpusWriteRequest; result: CorpusPreviewResponse } | null>(null);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const key = useIntentKey();
  return <div className="space-y-2">
    <p>Reconcile explicitly against the current source. Saving supersedes this update; history is retained.</p>
    {change.kind === 'skill_support' && change.value.sources.map((s, index) => <div key={s.evidence_id}>
      <p>Current source {view.records.find(r => r.source.id === s.evidence_id)?.source.title || s.evidence_id}: {view.records.find(r => r.source.id === s.evidence_id)?.source.narrative ?? 'Missing source — cannot reconcile'}</p>
      <label>Reviewed passage from {view.records.find(r => r.source.id === s.evidence_id)?.source.title || s.evidence_id}<textarea className={inputClass} value={s.quote} onChange={e => { const quote = e.target.value; setChange({ ...change, value: { ...change.value, sources: change.value.sources.map((v, i) => i === index ? { ...v, quote } : v) } }); setPreview(null); }} /></label>
    </div>)}
    {change.kind === 'evidence_amendment' && <><p>Current source: {view.records.find(r => r.source.id === change.value.evidence_id)?.source.narrative}</p><label>Reconciled narrative<textarea className={inputClass} value={change.value.narrative} onChange={e => { setChange({ ...change, value: { ...change.value, narrative: e.target.value } }); setPreview(null); }} /></label></>}
    <label>Reconciliation explanation<input className={inputClass} value={explanation} onChange={e => { setExplanation(e.target.value); setPreview(null); }} /></label>
    <button className={secondaryButton} disabled={busy || !explanation.trim()} onClick={async () => { setBusy(true); try { const body = { workspace_id: view.workspace_id, expected_revision: view.snapshot.revision, change, explanation, supersedes: update.id }; const request = { ...body, idempotency_key: key(body) }; const result = await apiClient.previewCorpusChange(request); setPreview({ request, result }); setMessage('Preview only; nothing saved.'); } catch (e) { setMessage(String(e)); } finally { setBusy(false); } }}>Preview reconciliation</button>
    {preview && <><pre className="whitespace-pre-wrap break-words text-xs">{JSON.stringify({ change: preview.request.change, conflicts: preview.result.conflicts, confidence: preview.result.confidence_changes }, null, 2)}</pre><button className={secondaryButton} disabled={busy} onClick={async () => { setBusy(true); try { await apiClient.rememberCorpusChange(preview.request); setPreview(null); setMessage('Reconciliation saved.'); onSaved(); } catch (e) { setMessage(String(e)); } finally { setBusy(false); } }}>Save reconciled update</button></>}
    <p role="status">{message}</p>
  </div>;
}
export function CorpusKnowledgePanel({ evidenceId, skill, onChanged }: { evidenceId?: string; skill?: string; onChanged?: () => void }) {
  const [view, setView] = useState<CorpusView | null>(null);
  const [error, setError] = useState('');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const key = useIntentKey();
  const load = useCallback(async () => { try { setView(await apiClient.getCorpus()); } catch (e) { setError(e instanceof Error ? e.message : 'Corpus unavailable'); } }, []);
  useEffect(() => { void load(); }, [load]);
  useLiveSync(() => void load());
  const changed = () => { void load(); onChanged?.(); };
  const rows = view?.history.filter(({ update: { change } }) => {
    if (change.kind === 'withdrawal') return false;
    return (!evidenceId || (change.kind === 'skill_support' ? change.value.sources.some(s => s.evidence_id === evidenceId) : change.value.evidence_id === evidenceId)) && (!skill || change.kind === 'skill_support' && change.value.skill.toLowerCase().includes(skill.toLowerCase()));
  }) ?? [];
  const titleOf = (id: string) => view?.records.find(r => r.source.id === id)?.source.title || view?.evidence?.find(r => r.id === id)?.title || 'Missing source';
  const labels = uniqueLabels(rows.map(({ update: { change: c } }) => c.kind === 'skill_support' ? { label: withdrawLabel(c.value), detail: sourceTitles(c.value, titleOf) } : { label: c.kind === 'evidence_amendment' ? `Withdraw amendment to ${titleOf(c.value.evidence_id)}` : 'Withdraw' }));
  return <section aria-label="Remembered corpus knowledge" className={`${cardClass} p-4 space-y-3 min-w-0 break-words`}>
    <h3 className="font-semibold">Remembered corpus knowledge</h3><p className="text-xs">Explicit local corrections, not additional accomplishments. Withdrawal affects future captures, never historical jobs.</p>
    {error && <p role="alert">{error}</p>}
    {!view && !error && <p>Loading knowledge…</p>}
    {view && !rows.length && <p>No remembered relationships or amendments.</p>}
    {view?.records.filter(r => evidenceId === r.source.id).map(r => <details key={r.source.id}><summary>Original / effective evidence ({r.storage_kind})</summary><p>Original confidence: {r.source.confidence}. {r.source.summary}</p><p className="whitespace-pre-wrap">{r.source.narrative}</p><p>Effective confidence: {r.effective?.confidence ?? 'unavailable'}. {r.effective?.summary}</p><p className="whitespace-pre-wrap">{r.effective?.narrative}</p>{r.effective?.metrics.map((m, i) => <p key={i}>{m.name}: {m.value} — {m.status}</p>)}</details>)}
    {view && rows.map(({ update, state }, index) => {
      const c = update.change;
      const feedback = view.feedback.find(f => f.feedback.id === update.feedback_id)?.feedback;
      const withdrawable = !['withdrawn', 'superseded'].includes(state);
      return <article className="border border-slate-200 dark:border-slate-800 rounded p-3 space-y-2" key={update.id}>
        <p className="font-medium"><span>{c.kind === 'skill_support' ? supportDescription(c.value, titleOf) : c.kind === 'evidence_amendment' ? `Amendment to ${titleOf(c.value.evidence_id)} — user-confirmed provisional evidence` : 'Withdrawal'}</span> · <span>{state}</span></p>
        {c.kind === 'skill_support' && <><p>{appliesTo(c.value.scope)}. Skill: {c.value.skill} ({c.value.facet}).</p>{c.value.sources.map(s => <blockquote key={s.evidence_id}>{titleOf(s.evidence_id)}: {s.quote}</blockquote>)}</>}
        {c.kind !== 'withdrawal' && <p>{c.value.explanation}</p>}
        <p className="text-xs">Remembered by {feedback?.recorded_by ?? 'local human'} on <time dateTime={update.recorded_at}>{formatDateTime(update.recorded_at)}</time> {feedback?.job_id ? 'from a saved job' : 'in the corpus editor'}. {feedback?.explanation}</p>
        <details className="text-xs"><summary className="cursor-pointer">Details</summary><dl className="break-all">
          <div>Update: {update.id}</div>
          {feedback?.job_id && <div>Originating job: {feedback.job_id}</div>}
          {c.kind === 'skill_support' && c.value.sources.map(s => <div key={s.evidence_id}>Source {s.evidence_id} version: {s.evidence_fingerprint}</div>)}
          {c.kind === 'evidence_amendment' && <div>Source {c.value.evidence_id} version: {c.value.base_fingerprint}</div>}
        </dl></details>
        {view.issues.filter(i => i.update_id === update.id).map((i, n) => <p role="alert" key={n}>{i.code}: {i.message}</p>)}
        {withdrawable && <><label>Withdrawal reason<input className={inputClass} value={reason} onChange={e => setReason(e.target.value)} /></label><ConfirmWithdraw label={labels[index]} effect={c.kind === 'skill_support' ? withdrawEffect(c.value.scope) : 'Withdrawing stops this amendment being used for every job.'} disabled={busy} onConfirm={async () => { setBusy(true); setError(''); try { const body = { workspace_id: view.workspace_id, expected_revision: view.snapshot.revision, explanation: reason.trim() || 'Withdrawn by user', change: { kind: 'withdrawal' as const, update_id: update.id, reason: reason.trim() || 'Withdrawn by user' } }; await apiClient.withdrawCorpusChange(update.id, { ...body, idempotency_key: key(body) }); changed(); } catch (e) { setError(e instanceof Error ? e.message : 'Withdrawal failed'); } finally { setBusy(false); } }} />
          <details><summary>Reconcile / supersede</summary><Reconcile view={view} update={update} onSaved={changed} /></details></>}
      </article>;
    })}
  </section>;
}
