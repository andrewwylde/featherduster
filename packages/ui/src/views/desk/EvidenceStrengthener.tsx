import React, { useMemo, useState } from 'react';
import { ArrowLeft, Plus, Trash2 } from 'lucide-react';
import type { ConfidenceLevel, EvidenceEntry, EvidenceRecord, MetricEntry } from '@featherduster/core';
import { ApiError, apiClient } from '../../api/client';
import { EvidenceBadge } from '../../components/desk/EvidenceBadge';
import { evidenceStatus } from '../../data/deskModel';
import { strengthenPrompts } from './strengthenPrompts';

interface EvidenceStrengthenerProps {
  record: EvidenceRecord;
  onBack: () => void;
  onSaved: () => void;
}

const field =
  'mt-1 w-full rounded-desk border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-base sm:text-sm text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-vermilion-500/40';
const card = 'rounded-desk border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#121622] p-5 shadow-sm';

export const EvidenceStrengthener: React.FC<EvidenceStrengthenerProps> = ({ record, onBack, onSaved }) => {
  const [draft, setDraft] = useState<EvidenceEntry>(() => JSON.parse(JSON.stringify(record.entry)));
  const [narrative, setNarrative] = useState(record.narrative);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedPath, setSavedPath] = useState<string | null>(null);

  // Consolidated ledgers are never rewritten by the UI (the server refuses too); say so before any editing.
  const ledgerPath =
    record.filePath && /(^|[\\/])evidence-ledger[^\\/]*$/i.test(record.filePath) ? record.filePath : null;

  const prompts = useMemo(() => strengthenPrompts(draft, narrative), [draft, narrative]);
  const status = evidenceStatus({ ...record, entry: draft, narrative });
  const verifiedWithoutRefs = draft.metrics.some((m) => m.status === 'verified') && draft.internal_references.length === 0;

  const set = <K extends keyof EvidenceEntry>(key: K, value: EvidenceEntry[K]) => setDraft((d) => ({ ...d, [key]: value }));
  const setMetric = (i: number, patch: Partial<MetricEntry>) =>
    set('metrics', draft.metrics.map((m, idx) => (idx === i ? { ...m, ...patch } : m)));

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      const res = await apiClient.updateEvidence(record.id, draft, narrative);
      setSavedPath(res.filePath);
      onSaved();
    } catch (err) {
      setError(err instanceof ApiError || err instanceof Error ? err.message : 'Failed to save');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6">
      <button type="button" onClick={onBack} className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-100">
        <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" /> Back to briefing
      </button>

      <header>
        <span className="text-xs font-mono uppercase tracking-widest text-vermilion-600 dark:text-vermilion-400 font-semibold">{record.id}</span>
        <h1 className="mt-1 text-2xl font-bold tracking-tight text-slate-900 dark:text-white">Strengthen evidence: {record.entry.title}</h1>
        <div className="mt-2 flex items-center gap-2 text-xs text-slate-600 dark:text-slate-400">
          <EvidenceBadge status={status} />
          <span>{record.entry.company} · {record.entry.date}</span>
        </div>
      </header>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
        <section aria-labelledby="gaps-heading" className={`${card} lg:col-span-4`}>
          <h2 id="gaps-heading" className="text-sm font-bold text-slate-900 dark:text-white">Open gaps</h2>
          <p className="mt-0.5 text-xs text-slate-500">Computed from this entry. Answer what you can prove; leave the rest.</p>
          {prompts.length === 0 ? (
            <p className="mt-4 text-sm text-emerald-700 dark:text-emerald-300">No open gaps in this entry.</p>
          ) : (
            <ul className="mt-4 space-y-3">
              {prompts.map((p) => (
                <li key={p.id} className="border-l-2 border-vermilion-500 pl-3">
                  <p className="text-sm font-semibold text-slate-900 dark:text-white">{p.question}</p>
                  <p className="mt-0.5 text-xs text-slate-600 dark:text-slate-400">{p.hint}</p>
                </li>
              ))}
            </ul>
          )}
        </section>

        <form
          className={`${card} lg:col-span-8 space-y-4`}
          onSubmit={(e) => {
            e.preventDefault();
            save();
          }}
        >
          {ledgerPath && (
            <p role="note" className="rounded-desk bg-sky-50 px-3 py-2 text-sm text-sky-900 dark:bg-sky-950/30 dark:text-sky-200">
              This entry lives in a consolidated ledger ({ledgerPath}). Use the gaps on the left as a checklist and edit it in
              that file; Featherduster does not rewrite ledgers.
            </p>
          )}
          <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300">
            Summary
            <textarea rows={2} value={draft.summary} onChange={(e) => set('summary', e.target.value)} className={field} />
          </label>
          <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300">
            Impact
            <textarea rows={2} value={draft.impact} onChange={(e) => set('impact', e.target.value)} className={field} />
          </label>
          <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300">
            Narrative
            <textarea rows={5} value={narrative} onChange={(e) => setNarrative(e.target.value)} className={field} />
          </label>
          <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300">
            Confidence
            <select value={draft.confidence} onChange={(e) => set('confidence', e.target.value as ConfidenceLevel)} className={field}>
              <option value="provisional">Provisional</option>
              <option value="verified">Verified</option>
              <option value="retracted">Retracted</option>
            </select>
          </label>

          <fieldset>
            <legend className="text-xs font-semibold text-slate-700 dark:text-slate-300">Metrics</legend>
            {draft.metrics.map((m, i) => (
              <div key={i} className="mt-2 grid grid-cols-12 gap-2">
                <input aria-label={`Metric ${i + 1} name`} value={m.name} onChange={(e) => setMetric(i, { name: e.target.value })} className={`${field} col-span-5 mt-0`} />
                <input aria-label={`Metric ${i + 1} value`} value={m.value} onChange={(e) => setMetric(i, { value: e.target.value })} className={`${field} col-span-3 mt-0`} />
                <select aria-label={`Metric ${i + 1} status`} value={m.status} onChange={(e) => setMetric(i, { status: e.target.value })} className={`${field} col-span-3 mt-0`}>
                  <option value="METRIC NEEDED">Metric needed</option>
                  <option value="provisional">Provisional</option>
                  <option value="verified">Verified</option>
                </select>
                <button type="button" aria-label={`Remove metric ${i + 1}`} onClick={() => set('metrics', draft.metrics.filter((_, idx) => idx !== i))} className="col-span-1 text-slate-400 hover:text-rose-600">
                  <Trash2 className="mx-auto h-4 w-4" aria-hidden="true" />
                </button>
              </div>
            ))}
            <button type="button" onClick={() => set('metrics', [...draft.metrics, { name: '', value: '[METRIC NEEDED]', status: 'METRIC NEEDED' }])} className="mt-2 inline-flex items-center gap-1 text-xs text-slate-600 hover:text-vermilion-600 dark:text-slate-400">
              <Plus className="h-3.5 w-3.5" aria-hidden="true" /> Add metric
            </button>
          </fieldset>

          <fieldset>
            <legend className="text-xs font-semibold text-slate-700 dark:text-slate-300">References (private)</legend>
            {draft.internal_references.map((r, i) => (
              <div key={i} className="mt-2 grid grid-cols-12 gap-2">
                <input aria-label={`Reference ${i + 1} type`} value={r.type} onChange={(e) => set('internal_references', draft.internal_references.map((x, idx) => (idx === i ? { ...x, type: e.target.value } : x)))} className={`${field} col-span-3 mt-0`} />
                <input aria-label={`Reference ${i + 1} ref`} value={r.ref} onChange={(e) => set('internal_references', draft.internal_references.map((x, idx) => (idx === i ? { ...x, ref: e.target.value } : x)))} className={`${field} col-span-8 mt-0`} />
                <button type="button" aria-label={`Remove reference ${i + 1}`} onClick={() => set('internal_references', draft.internal_references.filter((_, idx) => idx !== i))} className="col-span-1 text-slate-400 hover:text-rose-600">
                  <Trash2 className="mx-auto h-4 w-4" aria-hidden="true" />
                </button>
              </div>
            ))}
            <button type="button" onClick={() => set('internal_references', [...draft.internal_references, { type: 'pr', ref: '' }])} className="mt-2 inline-flex items-center gap-1 text-xs text-slate-600 hover:text-vermilion-600 dark:text-slate-400">
              <Plus className="h-3.5 w-3.5" aria-hidden="true" /> Add reference
            </button>
          </fieldset>

          {verifiedWithoutRefs && (
            <p className="text-xs text-amber-800 dark:text-amber-300">A metric is marked verified but the entry has no references. Add where it can be checked.</p>
          )}
          {error && (
            <p role="alert" className="rounded-desk bg-rose-50 px-3 py-2 text-sm text-rose-900 dark:bg-rose-950/30 dark:text-rose-200">{error}</p>
          )}
          {savedPath && !error && (
            <p role="status" className="text-sm text-emerald-700 dark:text-emerald-300">Saved to {savedPath}.</p>
          )}

          <div className="sticky bottom-0 -mx-5 -mb-5 mt-4 flex justify-end bg-white/95 p-3.5 backdrop-blur pb-safe dark:bg-[#121622]/95 border-t border-slate-100 dark:border-slate-800/80 sm:static sm:mx-0 sm:mb-0 sm:p-0 sm:bg-transparent sm:border-0 z-10">
            <button type="submit" disabled={saving || !!ledgerPath} className="rounded-desk bg-vermilion-500 px-4 py-2 text-sm font-semibold text-white hover:bg-vermilion-600 disabled:opacity-40 min-h-[44px] flex items-center justify-center">
              {saving ? 'Saving…' : 'Save to ledger file'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
