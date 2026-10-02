import React, { useEffect, useMemo, useRef, useState } from 'react';
import { AlignLeft, Check, Columns2, Pencil, Sparkles, X } from 'lucide-react';
import { applyProposals, compileMarkdownResume, isBlocked, type DraftContext, type JobAnalysis, type Proposal, type ResumeSpec } from '@featherduster/core';
import { apiClient } from '../../../api/client';
import { wordDiff, sideBySideWordDiff } from '../wordDiff';
import { CitationChip, IssueList, inputClass, secondaryButton } from '../ui';

interface ProposalsStepProps {
  value: Proposal[];
  baseResume: ResumeSpec | null;
  analysis: JobAnalysis | null;
  pageBudget: { overBy: number; proposalIds: string[] } | null;
  evidenceOptions?: Array<{ id: string; title: string }>;
  readOnly: boolean;
  applying: boolean;
  applyDisabled?: boolean;
  unapplied: boolean;
  /** A cleanup result changes proposal text and its recovery buffer together. */
  onChange: (proposals: Proposal[], textById?: Record<string, string>) => void;
  onApply: () => Promise<void>;
  textById: Record<string, string>;
  onTextChange: (id: string, text: string) => void;
  context: DraftContext;
  onContextChange: (context: Partial<DraftContext>) => void;
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
  <p className="text-sm leading-relaxed text-slate-800 dark:text-slate-200 break-words [overflow-wrap:anywhere]">
    {wordDiff(before, after).map((part, i) =>
      part.type === 'same' ? (
        <span key={i}>{part.text}</span>
      ) : part.type === 'added' ? (
        <ins key={i} className="rounded-sm bg-emerald-100 px-0.5 text-emerald-900 no-underline dark:bg-emerald-950/50 dark:text-emerald-200">
          {part.text}
        </ins>
      ) : (
        <del key={i} className="rounded-sm bg-rose-100 px-0.5 text-rose-900 dark:bg-rose-950/50 dark:text-rose-300">
          {part.text}
        </del>
      )
    )}
  </p>
);

const SideBySideDiff: React.FC<{ before: string; after: string; expInfo?: string; proposalId: string }> = ({
  before,
  after,
  expInfo,
  proposalId,
}) => {
  const { beforeParts, afterParts } = sideBySideWordDiff(before, after);
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-3" data-testid={`side-by-side-diff-${proposalId}`}>
      {/* Left Pane: Original / Before */}
      <div className="rounded-md border border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-900/50 p-3 space-y-1.5">
        <div className="flex items-center justify-between text-[11px] font-mono uppercase tracking-wider text-slate-500 border-b border-slate-200/60 dark:border-slate-800/60 pb-1.5">
          <span className="font-semibold text-rose-600 dark:text-rose-400">Original (Before)</span>
          {expInfo && <span className="text-[10px] normal-case text-slate-400 truncate max-w-[160px]">{expInfo}</span>}
        </div>
        <p className="text-sm leading-relaxed text-slate-800 dark:text-slate-200 break-words [overflow-wrap:anywhere]">
          {beforeParts.map((part, i) =>
            part.type === 'removed' ? (
              <del key={i} className="rounded-sm bg-rose-100 px-0.5 text-rose-900 dark:bg-rose-950/60 dark:text-rose-300 font-medium">
                {part.text}
              </del>
            ) : (
              <span key={i}>{part.text}</span>
            )
          )}
        </p>
      </div>

      {/* Right Pane: Tailored Proposal / After */}
      <div className="rounded-md border border-slate-200 dark:border-slate-800 bg-emerald-50/20 dark:bg-emerald-950/10 p-3 space-y-1.5">
        <div className="flex items-center justify-between text-[11px] font-mono uppercase tracking-wider text-slate-500 border-b border-slate-200/60 dark:border-slate-800/60 pb-1.5">
          <span className="font-semibold text-emerald-600 dark:text-emerald-400">Tailored Proposal (After)</span>
          <span className="text-[10px] normal-case text-emerald-700 dark:text-emerald-300 font-mono">Ready to apply</span>
        </div>
        <p className="text-sm leading-relaxed text-slate-800 dark:text-slate-200 break-words [overflow-wrap:anywhere]">
          {afterParts.map((part, i) =>
            part.type === 'added' ? (
              <ins key={i} className="rounded-sm bg-emerald-100 px-0.5 text-emerald-900 no-underline font-medium dark:bg-emerald-950/60 dark:text-emerald-200">
                {part.text}
              </ins>
            ) : (
              <span key={i}>{part.text}</span>
            )
          )}
        </p>
      </div>
    </div>
  );
};

const InlineLinter: React.FC<{
  proposal: Proposal;
  onCleanSlop?: () => void;
  isCleaning?: boolean;
}> = ({ proposal, onCleanSlop, isCleaning }) => {
  const afterText = proposal.edited_after ?? proposal.after;
  const hasDeslopIssue = proposal.checks.some((c) => c.kind.startsWith('deslop'));
  const deslopCheck = proposal.checks.find((c) => c.kind.startsWith('deslop'));
  const hasMetricIssue = proposal.checks.some((c) => c.kind === 'metric_needed' || c.kind === 'metric_unverified');
  const metricCheck = proposal.checks.find((c) => c.kind === 'metric_needed' || c.kind === 'metric_unverified');
  const hasLedgerCeiling = proposal.checks.some((c) => c.kind === 'ledger_ceiling' || c.kind === 'unresolved_citation');
  const hasNumberOrPercent = /\d+%?|\$\d+|\b\d+x\b/i.test(afterText);
  const isMetricGrounded = !hasMetricIssue && !hasLedgerCeiling && (hasNumberOrPercent || proposal.citations.length > 0);

  return (
    <div
      data-testid={`inline-linter-${proposal.id}`}
      className="mt-2.5 flex flex-wrap items-center justify-between gap-2 rounded-md bg-slate-50 dark:bg-slate-900/60 border border-slate-200/80 dark:border-slate-800/80 px-2.5 py-1.5 text-xs"
    >
      <div className="flex flex-wrap items-center gap-2">
        {/* De-Slop Compliance Linter */}
        {hasDeslopIssue ? (
          <div className="flex items-center gap-1.5 text-amber-700 dark:text-amber-300 font-medium">
            <span className="inline-block w-1.5 h-1.5 rounded-full bg-amber-500" />
            <span title={deslopCheck?.message}>Slop Flagged</span>
            {onCleanSlop && (
              <button
                type="button"
                disabled={isCleaning}
                onClick={onCleanSlop}
                className="ml-1 inline-flex items-center gap-1 text-[11px] font-semibold text-vermilion-600 dark:text-vermilion-400 hover:underline cursor-pointer"
              >
                <Sparkles className="h-3 w-3" aria-hidden="true" />
                {isCleaning ? 'Cleaning…' : 'Clean filler'}
              </button>
            )}
          </div>
        ) : (
          <div className="flex items-center gap-1 text-emerald-700 dark:text-emerald-300">
            <span className="inline-block w-1.5 h-1.5 rounded-full bg-emerald-500" />
            <span>De-Slop Clean</span>
          </div>
        )}

        <span className="text-slate-300 dark:text-slate-700">|</span>

        {/* Metric Grounding Linter */}
        {hasMetricIssue ? (
          <div className="flex items-center gap-1 text-amber-700 dark:text-amber-300">
            <span className="inline-block w-1.5 h-1.5 rounded-full bg-amber-500" />
            <span title={metricCheck?.message}>Metric Needed</span>
          </div>
        ) : hasLedgerCeiling ? (
          <div className="flex items-center gap-1 text-rose-700 dark:text-rose-300">
            <span className="inline-block w-1.5 h-1.5 rounded-full bg-rose-500" />
            <span>Unverified Evidence</span>
          </div>
        ) : isMetricGrounded ? (
          <div className="flex items-center gap-1 text-emerald-700 dark:text-emerald-300">
            <span className="inline-block w-1.5 h-1.5 rounded-full bg-emerald-500" />
            <span>Metric Grounded</span>
          </div>
        ) : (
          <div className="flex items-center gap-1 text-slate-500">
            <span className="inline-block w-1.5 h-1.5 rounded-full bg-slate-400" />
            <span>Qualitative Edit</span>
          </div>
        )}
      </div>

      <div className="text-[11px] text-slate-500 font-mono">
        {proposal.citations.length} citation(s) · {proposal.requirement_ids.length} req(s)
      </div>
    </div>
  );
};

function ProposalBody({
  proposal,
  baseResume,
  diffMode = 'side-by-side',
}: {
  proposal: Proposal;
  baseResume: ResumeSpec | null;
  diffMode?: 'side-by-side' | 'unified';
}) {
  const after = proposal.edited_after ?? proposal.after;
  const exp = baseResume?.experiences[proposal.target.experience_index];
  const expInfo = exp ? `${exp.role} @ ${exp.company}` : undefined;

  switch (proposal.type) {
    case 'summary.rewrite':
    case 'bullet.rewrite':
      return diffMode === 'side-by-side' ? (
        <SideBySideDiff before={proposal.before} after={after} expInfo={expInfo} proposalId={proposal.id} />
      ) : (
        <Diff before={proposal.before} after={after} />
      );
    case 'bullet.add':
      return diffMode === 'side-by-side' ? (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3" data-testid={`side-by-side-diff-${proposal.id}`}>
          <div className="rounded-md border border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-900/50 p-3 text-xs italic text-slate-500">
            (No prior bullet - new addition)
          </div>
          <div className="rounded-md border border-slate-200 dark:border-slate-800 bg-emerald-50/20 dark:bg-emerald-950/10 p-3">
            <p className="text-sm font-medium text-emerald-900 dark:text-emerald-200">
              <span className="mr-1 font-semibold">+</span>
              {after}
              {exp && <span className="ml-2 text-xs text-slate-500 font-normal">in {exp.role} @ {exp.company}</span>}
            </p>
          </div>
        </div>
      ) : (
        <p className="text-sm text-emerald-900 dark:text-emerald-200">
          <span className="mr-1 font-semibold">+</span>
          {after}
          {exp && <span className="ml-2 text-xs text-slate-500">in {exp.role} @ {exp.company}</span>}
        </p>
      );
    case 'bullet.drop':
      return diffMode === 'side-by-side' ? (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3" data-testid={`side-by-side-diff-${proposal.id}`}>
          <div className="rounded-md border border-slate-200 dark:border-slate-800 bg-rose-50/20 dark:bg-rose-950/10 p-3">
            <p className="text-sm text-rose-800 line-through dark:text-rose-300">{proposal.before}</p>
          </div>
          <div className="rounded-md border border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-900/50 p-3 text-xs italic text-slate-500">
            (Bullet dropped from resume)
          </div>
        </div>
      ) : (
        <p className="text-sm text-rose-800 line-through dark:text-rose-300">{proposal.before}</p>
      );
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
  value: proposals, baseResume, analysis, pageBudget, evidenceOptions, readOnly,
  applying: saving, applyDisabled, unapplied, onChange, onApply, textById, onTextChange, context, onContextChange, onOpenEvidence,
}) => {
  const editingId = context.editingProposalId;
  const editText = editingId ? textById[editingId] ?? proposals.find(p => p.id === editingId)?.edited_after ?? proposals.find(p => p.id === editingId)?.after ?? '' : '';
  const setEditingId = (id: string | null) => onContextChange({ editingProposalId: id ?? undefined, ...(id ? { selectedProposalId: id } : {}) });
  const setEditText = (text: string) => { if (editingId) onTextChange(editingId, text); };
  const [cleaningId, setCleaningId] = useState<string | null>(null);
  const [cleanError, setCleanError] = useState<string>();
  const [bulkActionMessage, setBulkActionMessage] = useState<string>();
  const mounted = useRef(false);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const latest = useRef({ proposals, onChange, readOnly, textById });
  latest.current = { proposals, onChange, readOnly, textById };
  const diffMode = context.diffMode ?? 'side-by-side';
  const setDiffMode = (diffMode: 'side-by-side' | 'unified') => onContextChange({ diffMode });

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

  const replace = (id: string, patch: Partial<Proposal>) => {
    setBulkActionMessage(undefined);
    onChange(proposals.map((p) => (p.id === id ? { ...p, ...patch } : p)));
  };
  const setAll = (decision: Proposal['decision']) => {
    const eligible = proposals.filter((p) => decision !== 'accepted' || !isBlocked(p));
    const changed = eligible.filter((p) => p.decision !== decision).length;
    const blocked = proposals.length - eligible.length;
    if (decision === 'accepted' && changed === 0) {
      setBulkActionMessage(
        blocked > 0
          ? `${blocked} proposal${blocked === 1 ? '' : 's'} still blocked. Confirm the blocking checks on each proposal before accepting it.`
          : 'All unblocked proposals are already accepted.',
      );
      return;
    }
    setBulkActionMessage(
      decision === 'accepted'
        ? `Accepted ${changed} unblocked proposal${changed === 1 ? '' : 's'}${blocked > 0 ? `; ${blocked} remain blocked.` : '.'}`
        : `Rejected ${changed} proposal${changed === 1 ? '' : 's'}.`,
    );
    onChange(proposals.map((p) => (decision === 'accepted' && isBlocked(p) ? p : { ...p, decision })));
  };

  const cleanSlop = async (p: Proposal) => {
    setCleaningId(p.id); setCleanError(undefined);
    const originalBuffer = textById[p.id];
    try {
      const res = await apiClient.deslopText(p.edited_after ?? p.after);
      const current = latest.current;
      if (!mounted.current || current.readOnly || current.proposals.find(candidate => candidate.id === p.id) !== p || current.textById[p.id] !== originalBuffer) return;
      const nextTextById = { ...current.textById };
      if (nextTextById[p.id] === (p.edited_after ?? p.after)) delete nextTextById[p.id];
      current.onChange(
        current.proposals.map(candidate => candidate.id === p.id ? { ...candidate, edited_after: res.cleanedText } : candidate),
        nextTextById,
      );
    } catch (error) {
      if (mounted.current) setCleanError((error as Error).message || 'Could not clean filler');
    } finally {
      if (mounted.current) setCleaningId(null);
    }
  };

  const textual = (p: Proposal) => p.type === 'summary.rewrite' || p.type === 'bullet.rewrite' || p.type === 'bullet.add';

  return (
    <div className="space-y-4">
      {cleanError && <p role="alert">{cleanError}</p>}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-slate-700 dark:text-slate-300" aria-live="polite">
          {counts.accepted} accepted · {counts.rejected} rejected · {counts.pending} pending
          {pageBudget && pageBudget.overBy > 0 && (
            <span className="ml-2 text-amber-800 dark:text-amber-300">Over page budget by ~{pageBudget.overBy} line(s)</span>
          )}
        </p>
        <div className="flex flex-wrap items-center gap-2">
          {/* Diff Mode Switcher */}
          <div
            role="tablist"
            aria-label="Diff Mode"
            className="flex items-center gap-1 p-0.5 bg-slate-100 dark:bg-slate-900 rounded-desk border border-slate-200 dark:border-slate-800 text-xs"
          >
            <button
              role="tab"
              type="button"
              aria-selected={diffMode === 'side-by-side'}
              disabled={saving}
              onClick={() => setDiffMode('side-by-side')}
              className={`px-2.5 py-1 rounded text-[11px] font-medium transition-colors flex items-center gap-1 min-h-[36px] sm:min-h-0 ${
                diffMode === 'side-by-side'
                  ? 'bg-white dark:bg-slate-800 text-slate-900 dark:text-white shadow-xs font-semibold'
                  : 'text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white'
              }`}
            >
              <Columns2 className="w-3.5 h-3.5 text-vermilion-500" aria-hidden="true" />
              <span>Side-by-Side Diff</span>
            </button>
            <button
              role="tab"
              type="button"
              aria-selected={diffMode === 'unified'}
              disabled={saving}
              onClick={() => setDiffMode('unified')}
              className={`px-2.5 py-1 rounded text-[11px] font-medium transition-colors flex items-center gap-1 min-h-[36px] sm:min-h-0 ${
                diffMode === 'unified'
                  ? 'bg-white dark:bg-slate-800 text-slate-900 dark:text-white shadow-xs font-semibold'
                  : 'text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white'
              }`}
            >
              <AlignLeft className="w-3.5 h-3.5 text-slate-500" aria-hidden="true" />
              <span>Unified Diff</span>
            </button>
          </div>

          {!readOnly && proposals.length > 0 && (
            <div className="flex flex-wrap gap-2">
              <button type="button" className={`${secondaryButton} min-h-[44px] sm:min-h-0`} disabled={saving} onClick={() => setAll('accepted')}>
                Accept all unblocked
              </button>
              <button type="button" className={`${secondaryButton} min-h-[44px] sm:min-h-0`} disabled={saving} onClick={() => setAll('rejected')}>
                Reject all
              </button>
            </div>
          )}
        </div>
      </div>
      {bulkActionMessage && (
        <p role="status" aria-live="polite" className="rounded-md border border-amber-200 bg-amber-50 px-2.5 py-2 text-xs text-amber-900 dark:border-amber-900/50 dark:bg-amber-950/20 dark:text-amber-200">
          {bulkActionMessage}
        </p>
      )}

      {proposals.length === 0 && <p className="text-sm text-slate-500">The model proposed no edits.</p>}

      <ul className="space-y-3">
        {proposals.map((p) => {
          const hasBlockingChecks = p.checks.some((c) => c.severity === 'block');
          const blocked = isBlocked(p);
          const border =
            p.decision === 'accepted'
              ? p.override
                ? 'border-amber-400 dark:border-amber-700'
                : 'border-emerald-300 dark:border-emerald-800'
              : p.decision === 'rejected'
              ? 'border-slate-200 opacity-60 dark:border-slate-800'
              : 'border-slate-200 dark:border-slate-800';
          return (
            <li key={p.id} onFocus={() => onContextChange({ selectedProposalId: p.id })} data-selected={context.selectedProposalId === p.id} className={`rounded-desk border p-3.5 ${border}`} aria-label={`Proposal ${p.id}: ${TYPE_LABELS[p.type]}`}>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                  <span className="mr-1.5 font-mono normal-case text-slate-400">{p.id}</span>
                  {TYPE_LABELS[p.type]}
                  {p.edited_after !== undefined && <span className="ml-2 normal-case text-vermilion-600">edited</span>}
                  {p.override && (
                    <span className="ml-2 rounded bg-amber-100 dark:bg-amber-950/60 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-amber-800 dark:text-amber-300">
                      override
                    </span>
                  )}
                </p>
                {!readOnly && (
                  <div className="flex flex-wrap items-center gap-1.5">
                    {textual(p) && (
                      <button
                        type="button"
                        onClick={() => {
                          setEditingId(p.id);
                        }}
                        className="inline-flex items-center gap-1 rounded px-2.5 py-1.5 min-h-[36px] sm:min-h-0 text-xs text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800"
                      >
                        <Pencil className="h-3.5 w-3.5" aria-hidden="true" /> Edit
                      </button>
                    )}
                    <button
                      type="button"
                      aria-pressed={p.decision === 'rejected'}
                      disabled={saving}
                      onClick={() => replace(p.id, { decision: p.decision === 'rejected' ? 'pending' : 'rejected' })}
                      className="inline-flex items-center gap-1 rounded border border-slate-300 px-2.5 py-1.5 min-h-[36px] sm:min-h-0 text-xs font-medium text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
                    >
                      <X className="h-3.5 w-3.5" aria-hidden="true" /> Reject
                    </button>
                    <button
                      type="button"
                      aria-pressed={p.decision === 'accepted'}
                      disabled={saving || blocked}
                      title={blocked ? 'Confirm by checking "Confirmed by me" below or edit the text before accepting' : undefined}
                      onClick={() =>
                        replace(p.id, {
                          decision: p.decision === 'accepted' ? 'pending' : 'accepted',
                          ...(p.decision === 'accepted' && p.override ? { override: false } : {}),
                        })
                      }
                      className={`inline-flex items-center gap-1 rounded ${
                        p.override ? 'bg-amber-600 hover:bg-amber-700' : 'bg-emerald-600 hover:bg-emerald-700'
                      } px-2.5 py-1.5 min-h-[36px] sm:min-h-0 text-xs font-semibold text-white disabled:cursor-not-allowed disabled:opacity-40`}
                    >
                      <Check className="h-3.5 w-3.5" aria-hidden="true" /> {p.decision === 'accepted' && p.override ? 'Accepted (override)' : 'Accept'}
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
                      readOnly={readOnly}
                      onChange={(e) => setEditText(e.target.value)}
                      className={`${inputClass} text-base sm:text-xs`}
                    />
                    <div className="flex justify-end gap-2">
                      <button type="button" className={secondaryButton} disabled={saving} onClick={() => setEditingId(null)}>
                        Close editor
                      </button>
                      <button
                        type="button"
                        className={secondaryButton}
                        disabled={!editText.trim() || saving || applyDisabled}
                        onClick={async () => {
                          try { await onApply(); setEditingId(null); } catch { /* Keep recovery text open for correction. */ }
                        }}
                      >
                        Apply edit
                      </button>
                    </div>
                  </div>
                ) : (
                  <ProposalBody proposal={p} baseResume={baseResume} diffMode={diffMode} />
                )}
              </div>

              {/* Direct Inline Linter (De-Slop Compliance & Metric Groundings) */}
              <InlineLinter
                proposal={p}
                onCleanSlop={!readOnly && !unapplied && textual(p) ? () => cleanSlop(p) : undefined}
                isCleaning={cleaningId === p.id}
              />

              {p.rationale && <p className="mt-2 text-xs text-slate-600 dark:text-slate-400">{p.rationale}</p>}

              <div className="mt-2 flex flex-wrap items-center gap-1.5">
                {p.citations.map((c) => (
                  <CitationChip
                    key={c}
                    id={c}
                    onClick={onOpenEvidence}
                    onRemove={readOnly ? undefined : (id) => replace(p.id, { citations: p.citations.filter((x) => x !== id) })}
                  />
                ))}
                {!readOnly && evidenceOptions && evidenceOptions.filter((e) => !p.citations.includes(e.id)).length > 0 && (
                  <select
                    aria-label={`Add evidence to ${p.id}`}
                    value=""
                    onChange={(e) => e.target.value && replace(p.id, { citations: [...p.citations, e.target.value] })}
                    className="rounded border border-dashed border-slate-300 dark:border-slate-700 bg-transparent px-2 py-1 min-h-[36px] sm:min-h-0 text-xs text-slate-600 dark:text-slate-400"
                  >
                    <option value="">+ cite evidence</option>
                    {evidenceOptions
                      .filter((e) => !p.citations.includes(e.id))
                      .map((e) => (
                        <option key={e.id} value={e.id}>
                          {e.id} — {e.title}
                        </option>
                      ))}
                  </select>
                )}
                {p.requirement_ids.map((r) => (
                  <span key={r} title={reqText.get(r)} className="rounded-md bg-slate-100 px-1.5 py-0.5 text-[11px] text-slate-600 dark:bg-slate-800 dark:text-slate-400">
                    {r}: {reqText.get(r) ?? 'requirement'}
                  </span>
                ))}
              </div>

              <IssueList issues={p.checks} />

              {hasBlockingChecks && (
                <div className="mt-2.5 flex items-center justify-between rounded-md bg-amber-50/80 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-900/50 p-2.5">
                  <label htmlFor={`override-${p.id}`} className="flex items-center gap-2 text-xs font-medium text-amber-900 dark:text-amber-200 cursor-pointer">
                    <input
                      type="checkbox"
                      id={`override-${p.id}`}
                      checked={!!p.override}
                      disabled={readOnly || saving}
                      onChange={(e) => {
                        const override = e.target.checked;
                        replace(p.id, {
                          override,
                          decision: override ? 'accepted' : (p.decision === 'accepted' ? 'pending' : p.decision),
                        });
                      }}
                      className="h-4 w-4 accent-amber-600 rounded"
                    />
                    <span>Confirmed by me (override blocking checks)</span>
                  </label>
                  {p.override && (
                    <span className="text-[11px] font-mono text-amber-700 dark:text-amber-400">Waived</span>
                  )}
                </div>
              )}
            </li>
          );
        })}
      </ul>

      {!readOnly && unapplied && <button type="button" className={secondaryButton} disabled={saving || applyDisabled} onClick={() => void onApply().catch(() => undefined)}>{saving ? 'Applying…' : 'Apply proposal edits'}</button>}
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
