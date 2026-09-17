import React, { useMemo, useState } from 'react';
import { Check, Pencil, Sparkles, X } from 'lucide-react';
import { applyProposals, compileMarkdownResume, type JobAnalysis, type Proposal, type ResumeSpec } from '@featherduster/core';
import { apiClient } from '../../../api/client';
import { wordDiff } from '../wordDiff';
import { CitationChip, IssueList, inputClass, secondaryButton } from '../ui';

interface ProposalsStepProps {
  proposals: Proposal[];
  baseResume: ResumeSpec | null;
  analysis: JobAnalysis | null;
  pageBudget: { overBy: number; proposalIds: string[] } | null;
  readOnly: boolean;
  saving: boolean;
  onSave: (proposals: Proposal[]) => void;
  onOpenEvidence: (id: string) => void;
}

const TYPE_LABELS: Record<Proposal['type'], string> = {
  'summary.rewrite': 'Summary rewrite',
  'bullet.rewrite': 'Bullet rewrite',
  'bullet.add': 'New bullet',
  'bullet.drop': 'Drop bullet',
  'bullet.reorder': 'Reorder bullets',
  'skills.reorder': 'Reorder skills',
  'skills.prune': 'Prune skills',
};

const Diff: React.FC<{ before: string; after: string }> = ({ before, after }) => (
  <p className="text-sm leading-relaxed text-slate-800 dark:text-slate-200">
    {wordDiff(before, after).map((part, i) =>
      part.type === 'same' ? (
        <span key={i}>{part.text}</span>
      ) : part.type === 'added' ? (
        <ins key={i} className="rounded-sm bg-emerald-100 text-emerald-900 no-underline dark:bg-emerald-950/50 dark:text-emerald-200">
          {part.text}
        </ins>
      ) : (
        <del key={i} className="rounded-sm bg-rose-100 text-rose-900 dark:bg-rose-950/50 dark:text-rose-300">
          {part.text}
        </del>
      )
    )}
  </p>
);

function ProposalBody({ proposal, baseResume }: { proposal: Proposal; baseResume: ResumeSpec | null }) {
  const after = proposal.edited_after ?? proposal.after;
  const exp = baseResume?.experiences[proposal.target.experience_index];
  switch (proposal.type) {
    case 'summary.rewrite':
    case 'bullet.rewrite':
      return <Diff before={proposal.before} after={after} />;
    case 'bullet.add':
      return (
        <p className="text-sm text-emerald-900 dark:text-emerald-200">
          <span className="mr-1 font-semibold">+</span>
          {after}
          {exp && <span className="ml-2 text-xs text-slate-500">in {exp.role} @ {exp.company}</span>}
        </p>
      );
    case 'bullet.drop':
      return <p className="text-sm text-rose-800 line-through dark:text-rose-300">{proposal.before}</p>;
    case 'bullet.reorder':
      return (
        <ol className="list-decimal space-y-0.5 pl-5 text-sm text-slate-700 dark:text-slate-300">
          {proposal.order.map((idx) => (
            <li key={idx}>{exp?.bullets[idx]?.text ?? `Bullet ${idx}`}</li>
          ))}
        </ol>
      );
    case 'skills.reorder':
    case 'skills.prune': {
      const group = baseResume?.skills[proposal.target.skill_group_index];
      return (
        <p className="text-sm text-slate-700 dark:text-slate-300">
          <span className="font-medium">{group?.category ?? 'Skills'}:</span>{' '}
          {proposal.type === 'skills.prune' ? (
            <span>
              remove <span className="line-through">{proposal.skills.join(', ')}</span>
            </span>
          ) : (
            proposal.skills.join(', ')
          )}
        </p>
      );
    }
  }
}

export const ProposalsStep: React.FC<ProposalsStepProps> = ({
  proposals,
  baseResume,
  analysis,
  pageBudget,
  readOnly,
  saving,
  onSave,
  onOpenEvidence,
}) => {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editText, setEditText] = useState('');
  const [cleaningId, setCleaningId] = useState<string | null>(null);

  const reqText = useMemo(() => new Map(analysis?.requirements.map((r) => [r.id, r.text]) ?? []), [analysis]);
  const counts = proposals.reduce(
    (acc, p) => ({ ...acc, [p.decision]: acc[p.decision] + 1 }),
    { pending: 0, accepted: 0, rejected: 0 } as Record<Proposal['decision'], number>
  );

  const preview = useMemo(() => {
    if (!baseResume) return '';
    try {
      return compileMarkdownResume(applyProposals(baseResume, proposals));
    } catch {
      return '';
    }
  }, [baseResume, proposals]);

  const replace = (id: string, patch: Partial<Proposal>) => onSave(proposals.map((p) => (p.id === id ? { ...p, ...patch } : p)));
  const setAll = (decision: Proposal['decision']) =>
    onSave(proposals.map((p) => (decision === 'accepted' && p.checks.some((c) => c.severity === 'block') ? p : { ...p, decision })));

  const cleanSlop = async (p: Proposal) => {
    setCleaningId(p.id);
    try {
      const res = await apiClient.deslopText(p.edited_after ?? p.after);
      replace(p.id, { edited_after: res.cleanedText });
    } finally {
      setCleaningId(null);
    }
  };

  const textual = (p: Proposal) => p.type === 'summary.rewrite' || p.type === 'bullet.rewrite' || p.type === 'bullet.add';

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-slate-700 dark:text-slate-300" aria-live="polite">
          {counts.accepted} accepted · {counts.rejected} rejected · {counts.pending} pending
          {pageBudget && pageBudget.overBy > 0 && (
            <span className="ml-2 text-amber-800 dark:text-amber-300">Over page budget by ~{pageBudget.overBy} line(s)</span>
          )}
        </p>
        {!readOnly && proposals.length > 0 && (
          <div className="flex gap-2">
            <button type="button" className={secondaryButton} disabled={saving} onClick={() => setAll('accepted')}>
              Accept all unblocked
            </button>
            <button type="button" className={secondaryButton} disabled={saving} onClick={() => setAll('rejected')}>
              Reject all
            </button>
          </div>
        )}
      </div>

      {proposals.length === 0 && <p className="text-sm text-slate-500">The model proposed no edits.</p>}

      <ul className="space-y-3">
        {proposals.map((p) => {
          const blocked = p.checks.some((c) => c.severity === 'block');
          const border =
            p.decision === 'accepted'
              ? 'border-emerald-300 dark:border-emerald-800'
              : p.decision === 'rejected'
              ? 'border-slate-200 opacity-60 dark:border-slate-800'
              : 'border-slate-200 dark:border-slate-800';
          return (
            <li key={p.id} className={`rounded-desk border p-3.5 ${border}`} aria-label={`Proposal ${p.id}: ${TYPE_LABELS[p.type]}`}>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                  <span className="mr-1.5 font-mono normal-case text-slate-400">{p.id}</span>
                  {TYPE_LABELS[p.type]}
                  {p.edited_after !== undefined && <span className="ml-2 normal-case text-vermilion-600">edited</span>}
                </p>
                {!readOnly && (
                  <div className="flex items-center gap-1.5">
                    {textual(p) && (
                      <button
                        type="button"
                        onClick={() => {
                          setEditingId(p.id);
                          setEditText(p.edited_after ?? p.after);
                        }}
                        className="inline-flex items-center gap-1 rounded px-2 py-1 text-xs text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800"
                      >
                        <Pencil className="h-3.5 w-3.5" aria-hidden="true" /> Edit
                      </button>
                    )}
                    <button
                      type="button"
                      aria-pressed={p.decision === 'rejected'}
                      disabled={saving}
                      onClick={() => replace(p.id, { decision: p.decision === 'rejected' ? 'pending' : 'rejected' })}
                      className="inline-flex items-center gap-1 rounded border border-slate-300 px-2 py-1 text-xs font-medium text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
                    >
                      <X className="h-3.5 w-3.5" aria-hidden="true" /> Reject
                    </button>
                    <button
                      type="button"
                      aria-pressed={p.decision === 'accepted'}
                      disabled={saving || blocked}
                      title={blocked ? 'Resolve blocking checks (edit the text) before accepting' : undefined}
                      onClick={() => replace(p.id, { decision: p.decision === 'accepted' ? 'pending' : 'accepted' })}
                      className="inline-flex items-center gap-1 rounded bg-emerald-600 px-2 py-1 text-xs font-semibold text-white hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      <Check className="h-3.5 w-3.5" aria-hidden="true" /> Accept
                    </button>
                  </div>
                )}
              </div>

              <div className="mt-2">
                {editingId === p.id ? (
                  <div className="space-y-2">
                    <textarea
                      aria-label={`Edit proposal ${p.id}`}
                      rows={3}
                      value={editText}
                      onChange={(e) => setEditText(e.target.value)}
                      className={inputClass}
                    />
                    <div className="flex justify-end gap-2">
                      <button type="button" className={secondaryButton} onClick={() => setEditingId(null)}>
                        Cancel
                      </button>
                      <button
                        type="button"
                        className={secondaryButton}
                        disabled={!editText.trim() || saving}
                        onClick={() => {
                          replace(p.id, { edited_after: editText });
                          setEditingId(null);
                        }}
                      >
                        Save edit
                      </button>
                    </div>
                  </div>
                ) : (
                  <ProposalBody proposal={p} baseResume={baseResume} />
                )}
              </div>

              {p.rationale && <p className="mt-2 text-xs text-slate-600 dark:text-slate-400">{p.rationale}</p>}

              <div className="mt-2 flex flex-wrap items-center gap-1.5">
                {p.citations.map((c) => (
                  <CitationChip key={c} id={c} onClick={onOpenEvidence} />
                ))}
                {p.requirement_ids.map((r) => (
                  <span key={r} title={reqText.get(r)} className="rounded-md bg-slate-100 px-1.5 py-0.5 text-[11px] text-slate-600 dark:bg-slate-800 dark:text-slate-400">
                    {r}: {reqText.get(r) ?? 'requirement'}
                  </span>
                ))}
              </div>

              <IssueList issues={p.checks} />
              {!readOnly && textual(p) && p.checks.some((c) => c.kind === 'deslop' || c.kind === 'deslop_minor') && (
                <button
                  type="button"
                  disabled={cleaningId === p.id}
                  onClick={() => cleanSlop(p)}
                  className="mt-1.5 inline-flex items-center gap-1 text-xs font-medium text-vermilion-600 hover:underline dark:text-vermilion-400"
                >
                  <Sparkles className="h-3.5 w-3.5" aria-hidden="true" />
                  {cleaningId === p.id ? 'Cleaning…' : 'Clean filler'}
                </button>
              )}
            </li>
          );
        })}
      </ul>

      {preview && (
        <details className="rounded-desk border border-slate-200 dark:border-slate-800">
          <summary className="cursor-pointer px-3.5 py-2.5 text-sm font-medium text-slate-800 dark:text-slate-200">
            Preview resume with accepted edits
          </summary>
          <pre className="max-h-[28rem] overflow-auto whitespace-pre-wrap border-t border-slate-200 p-3.5 font-mono text-xs leading-relaxed text-slate-700 dark:border-slate-800 dark:text-slate-300">
            {preview}
          </pre>
        </details>
      )}
    </div>
  );
};
