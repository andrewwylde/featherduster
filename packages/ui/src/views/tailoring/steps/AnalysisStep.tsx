import React, { useEffect, useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import type { JobAnalysis, JobRequirement, RequirementTier } from '@featherduster/core';
import { inputClass, secondaryButton } from '../ui';

interface AnalysisStepProps {
  analysis: JobAnalysis;
  readOnly: boolean;
  saving: boolean;
  onDirtyChange?: (dirty: boolean) => void;
  onSave: (analysis: JobAnalysis) => void;
  onHighlightQuote: (quote: string | null) => void;
}

const TIERS: Array<{ id: RequirementTier; label: string; hint: string }> = [
  { id: 'must', label: 'Must-haves', hint: 'Tier 1: core competencies' },
  { id: 'nice', label: 'Nice-to-haves', hint: 'Tier 2: secondary or domain' },
  { id: 'vocabulary', label: 'Company vocabulary', hint: 'Tier 3: their terms for things' },
];

export const AnalysisStep: React.FC<AnalysisStepProps> = ({ analysis, readOnly, saving, onDirtyChange, onSave, onHighlightQuote }) => {
  const [draft, setDraft] = useState<JobAnalysis>(analysis);
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    onDirtyChange?.(dirty);
  }, [dirty, onDirtyChange]);

  useEffect(() => {
    setDraft(analysis);
    setDirty(false);
  }, [analysis]);

  const update = (next: JobAnalysis) => {
    setDraft(next);
    setDirty(true);
  };

  const updateReq = (id: string, patch: Partial<JobRequirement>) =>
    update({ ...draft, requirements: draft.requirements.map((r) => (r.id === id ? { ...r, ...patch } : r)) });

  const addReq = (tier: RequirementTier) => {
    let n = draft.requirements.length + 1;
    while (draft.requirements.some((r) => r.id === `r${n}`)) n++;
    update({ ...draft, requirements: [...draft.requirements, { id: `r${n}`, tier, text: '', quote: '', terms: [] }] });
  };

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        {(['company', 'role', 'seniority'] as const).map((field) => (
          <div key={field}>
            <label htmlFor={`analysis-${field}`} className="text-xs font-semibold capitalize text-slate-600 dark:text-slate-400">
              {field}
            </label>
            <input
              id={`analysis-${field}`}
              value={draft[field]}
              readOnly={readOnly}
              onChange={(e) => update({ ...draft, [field]: e.target.value })}
              className={`${inputClass} mt-1`}
            />
          </div>
        ))}
      </div>

      {TIERS.map((tier) => {
        const reqs = draft.requirements.filter((r) => r.tier === tier.id);
        return (
          <section key={tier.id} aria-labelledby={`tier-${tier.id}`}>
            <div className="flex items-baseline justify-between">
              <h3 id={`tier-${tier.id}`} className="text-sm font-semibold text-slate-900 dark:text-white">
                {tier.label} <span className="ml-1 text-xs font-normal text-slate-500">{tier.hint}</span>
              </h3>
              {!readOnly && (
                <button type="button" onClick={() => addReq(tier.id)} className="inline-flex items-center gap-1 text-xs text-slate-600 hover:text-vermilion-600 dark:text-slate-400">
                  <Plus className="h-3.5 w-3.5" aria-hidden="true" /> Add
                </button>
              )}
            </div>
            {reqs.length === 0 ? (
              <p className="mt-2 text-xs text-slate-500">None found.</p>
            ) : (
              <ul className="mt-2 space-y-2">
                {reqs.map((req) => (
                  <li
                    key={req.id}
                    className="rounded-desk border border-slate-200 dark:border-slate-800 p-3"
                    onMouseEnter={() => onHighlightQuote(req.quote || null)}
                    onMouseLeave={() => onHighlightQuote(null)}
                    onFocus={() => onHighlightQuote(req.quote || null)}
                  >
                    <div className="flex items-start gap-2">
                      <span className="mt-2 font-mono text-[11px] text-slate-400">{req.id}</span>
                      <div className="flex-1 space-y-1.5">
                        <input
                          aria-label={`Requirement ${req.id}`}
                          value={req.text}
                          readOnly={readOnly}
                          onChange={(e) => updateReq(req.id, { text: e.target.value })}
                          className={`${inputClass} font-medium`}
                        />
                        <div className="flex flex-wrap items-center gap-2 text-xs">
                          {!readOnly && (
                            <select
                              aria-label={`Tier for ${req.id}`}
                              value={req.tier}
                              onChange={(e) => updateReq(req.id, { tier: e.target.value as RequirementTier })}
                              className="rounded border border-slate-300 dark:border-slate-700 bg-transparent px-1.5 py-0.5 text-xs"
                            >
                              {TIERS.map((t) => (
                                <option key={t.id} value={t.id}>
                                  {t.label}
                                </option>
                              ))}
                            </select>
                          )}
                          {req.quote && <q className="italic text-slate-600 dark:text-slate-400">{req.quote}</q>}
                          {req.terms.map((t) => (
                            <span key={t} className="rounded bg-slate-100 dark:bg-slate-800 px-1.5 py-0.5 font-mono text-[11px] text-slate-700 dark:text-slate-300">
                              {t}
                            </span>
                          ))}
                          {req.ungrounded && (
                            <span className="text-amber-800 dark:text-amber-300">Quote not found in posting — check it's real.</span>
                          )}
                        </div>
                      </div>
                      {!readOnly && (
                        <button
                          type="button"
                          onClick={() => update({ ...draft, requirements: draft.requirements.filter((r) => r.id !== req.id) })}
                          aria-label={`Delete requirement ${req.id}`}
                          className="mt-1.5 text-slate-400 hover:text-rose-600"
                        >
                          <Trash2 className="h-4 w-4" aria-hidden="true" />
                        </button>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>
        );
      })}

      {draft.boilerplate.length > 0 && (
        <p className="text-xs text-slate-500">
          Ignored as boilerplate: {draft.boilerplate.map((b) => `“${b}”`).join(', ')}
        </p>
      )}

      {!readOnly && dirty && (
        <div className="flex justify-end">
          <button
            type="button"
            className={secondaryButton}
            disabled={saving || draft.requirements.some((r) => !r.text.trim())}
            onClick={() => onSave(draft)}
          >
            {saving ? 'Saving…' : 'Save requirement edits'}
          </button>
        </div>
      )}
    </div>
  );
};
