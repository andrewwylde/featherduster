import React, { useEffect, useState } from 'react';
import type { AlignmentClassification, AlignmentMatrix, AlignmentRow, JobAnalysis } from '@featherduster/core';
import { CitationChip, IssueList, inputClass, secondaryButton } from '../ui';

interface AlignmentStepProps {
  analysis: JobAnalysis;
  alignment: AlignmentMatrix;
  evidenceOptions: Array<{ id: string; title: string }>;
  readOnly: boolean;
  saving: boolean;
  onDirtyChange?: (dirty: boolean) => void;
  onSave: (alignment: AlignmentMatrix) => void;
  onOpenEvidence: (id: string) => void;
}

const CLASS_STYLE: Record<AlignmentClassification, string> = {
  backed: 'border-emerald-300 text-emerald-800 dark:border-emerald-800 dark:text-emerald-300',
  transferable: 'border-sky-300 text-sky-800 dark:border-sky-800 dark:text-sky-300',
  gap: 'border-slate-300 text-slate-700 dark:border-slate-700 dark:text-slate-300',
};

export const AlignmentStep: React.FC<AlignmentStepProps> = ({
  analysis,
  alignment,
  evidenceOptions,
  readOnly,
  saving,
  onDirtyChange,
  onSave,
  onOpenEvidence,
}) => {
  const [draft, setDraft] = useState<AlignmentMatrix>(alignment);
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    onDirtyChange?.(dirty);
  }, [dirty, onDirtyChange]);

  useEffect(() => {
    setDraft(alignment);
    setDirty(false);
  }, [alignment]);

  const updateRow = (requirementId: string, patch: Partial<AlignmentRow>) => {
    setDraft({ rows: draft.rows.map((r) => (r.requirement_id === requirementId ? { ...r, ...patch, issues: [] } : r)) });
    setDirty(true);
  };

  const counts = draft.rows.reduce(
    (acc, r) => ({ ...acc, [r.classification]: acc[r.classification] + 1 }),
    { backed: 0, transferable: 0, gap: 0 } as Record<AlignmentClassification, number>
  );
  const reqById = new Map(analysis.requirements.map((r) => [r.id, r]));

  return (
    <div className="space-y-4">
      <p className="text-sm text-slate-700 dark:text-slate-300" aria-live="polite">
        <strong className="text-emerald-700 dark:text-emerald-300">{counts.backed} backed</strong> ·{' '}
        <strong className="text-sky-700 dark:text-sky-300">{counts.transferable} transferable</strong> ·{' '}
        <strong>{counts.gap} gaps</strong>
        <span className="ml-2 text-xs text-slate-500">Correct anything wrong before edits are drafted.</span>
      </p>

      <ul className="space-y-2.5">
        {draft.rows.map((row) => {
          const req = reqById.get(row.requirement_id);
          const available = evidenceOptions.filter((e) => !row.citations.includes(e.id));
          return (
            <li key={row.requirement_id} className="rounded-desk border border-slate-200 dark:border-slate-800 p-3">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-slate-900 dark:text-white">
                    <span className="mr-1.5 font-mono text-[11px] text-slate-400">{row.requirement_id}</span>
                    {req?.text ?? 'Unknown requirement'}
                  </p>
                  {req && <p className="text-[11px] uppercase tracking-wide text-slate-500">{req.tier}</p>}
                </div>
                <select
                  aria-label={`Classification for ${row.requirement_id}`}
                  value={row.classification}
                  disabled={readOnly}
                  onChange={(e) => updateRow(row.requirement_id, { classification: e.target.value as AlignmentClassification })}
                  className={`rounded-desk border bg-transparent px-2.5 py-1.5 min-h-[36px] sm:min-h-0 text-xs font-semibold ${CLASS_STYLE[row.classification]}`}
                >
                  <option value="backed">Backed</option>
                  <option value="transferable">Transferable</option>
                  <option value="gap">Gap</option>
                </select>
              </div>

              {row.rationale && <p className="mt-1.5 text-xs leading-relaxed text-slate-600 dark:text-slate-400">{row.rationale}</p>}

              <div className="mt-2 flex flex-wrap items-center gap-1.5">
                {row.citations.map((c) => (
                  <CitationChip
                    key={c}
                    id={c}
                    onClick={onOpenEvidence}
                    onRemove={readOnly ? undefined : (id) => updateRow(row.requirement_id, { citations: row.citations.filter((x) => x !== id) })}
                  />
                ))}
                {!readOnly && available.length > 0 && (
                  <select
                    aria-label={`Add evidence to ${row.requirement_id}`}
                    value=""
                    onChange={(e) => e.target.value && updateRow(row.requirement_id, { citations: [...row.citations, e.target.value] })}
                    className="rounded border border-dashed border-slate-300 dark:border-slate-700 bg-transparent px-2 py-1 min-h-[36px] sm:min-h-0 text-xs text-slate-600 dark:text-slate-400"
                  >
                    <option value="">+ cite evidence</option>
                    {available.map((e) => (
                      <option key={e.id} value={e.id}>
                        {e.id} — {e.title}
                      </option>
                    ))}
                  </select>
                )}
              </div>

              <div className="mt-2 flex flex-wrap items-center gap-4">
                {row.classification === 'transferable' && (
                  <label className="flex items-center gap-2 text-xs text-slate-600 dark:text-slate-400">
                    Tool you actually used
                    <input
                      value={row.adjacent_tool}
                      readOnly={readOnly}
                      onChange={(e) => updateRow(row.requirement_id, { adjacent_tool: e.target.value })}
                      className={`${inputClass} w-full sm:w-40 py-1 min-h-[36px] sm:min-h-0 text-base sm:text-xs`}
                    />
                  </label>
                )}
                <label className="flex items-center gap-1.5 py-1 text-xs text-slate-600 dark:text-slate-400">
                  <input
                    type="checkbox"
                    checked={row.candidate_confirmed}
                    disabled={readOnly}
                    onChange={(e) => updateRow(row.requirement_id, { candidate_confirmed: e.target.checked })}
                    className="h-4 w-4 accent-vermilion-500"
                  />
                  Confirmed by me (not yet in the ledger)
                </label>
              </div>
              <IssueList issues={row.issues} />
            </li>
          );
        })}
      </ul>

      {!readOnly && dirty && (
        <div className="flex justify-end">
          <button type="button" className={`${secondaryButton} min-h-[44px] sm:min-h-0`} disabled={saving} onClick={() => onSave(draft)}>
            {saving ? 'Saving…' : 'Save alignment edits'}
          </button>
        </div>
      )}
    </div>
  );
};
