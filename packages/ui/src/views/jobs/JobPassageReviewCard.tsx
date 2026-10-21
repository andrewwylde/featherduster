import { useState } from 'react';
import {
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  RotateCcw,
  Sparkles,
  ShieldCheck,
  Plus,
} from 'lucide-react';
import type { EvidenceRecord, JobFact, Proposal, ProposalIssue, ProposalPatch, SkillSupport } from '@featherduster/core';
import { cardClass, CitationChip, inputClass, IssueList, secondaryButton } from '../tailoring/ui.js';
import { JobEvidenceChooser } from './JobEvidenceChooser.js';
import { evidenceTitle, type GroundingDraft } from './JobProposalEditor.js';

export function JobPassageReviewCard({
  proposal,
  passageLabel,
  requirements,
  issues,
  evidence,
  support,
  fact,
  factConfirmed,
  onConfirmFact,
  onPatch,
  grounding,
  onGrounding,
  disabled,
  onAcceptAndNext,
  onDiscardChange,
  onSkip,
  saveStatusMessage,
}: {
  proposal: Proposal;
  passageLabel: string;
  requirements: string[];
  issues: ProposalIssue[];
  evidence: EvidenceRecord[];
  support: SkillSupport[];
  fact?: JobFact;
  factConfirmed?: boolean;
  onConfirmFact?: () => void;
  onPatch: (patch: ProposalPatch) => void;
  grounding?: GroundingDraft;
  onGrounding: (value?: GroundingDraft) => void;
  disabled: boolean;
  onAcceptAndNext: () => void;
  onDiscardChange: () => void;
  onSkip: () => void;
  saveStatusMessage?: string;
}) {
  const [choosingEvidence, setChoosingEvidence] = useState(false);
  const p = proposal;
  const isRejected = p.decision === 'rejected';
  const blockingIssues = issues.filter(i => i.details.some(d => d.severity === 'block'));
  const hasFactIssue = !!fact && fact.state !== 'supported';
  const title = (id: string) => evidenceTitle(evidence, id);
  const updateGrounding = (val: Partial<GroundingDraft>) =>
    onGrounding({ proposal_id: p.id, term: '', evidence_id: '', quote: '', explanation: '', ...grounding, ...val });

  return (
    <div className={`${cardClass} p-5 space-y-5 min-w-0 break-words shadow-sm border border-slate-200 dark:border-slate-800`}>
      {/* 1. Header Zone: Passage & Target Requirement */}
      <div className="space-y-2 border-b border-slate-100 dark:border-slate-800/80 pb-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <span className="text-xs font-mono uppercase tracking-wider text-slate-500 dark:text-slate-400">
              Passage
            </span>
            <span className="text-xs text-slate-400 dark:text-slate-600">/</span>
            <h2 className="text-base font-bold text-slate-900 dark:text-white">
              {passageLabel}
            </h2>
          </div>

          <div className="flex items-center gap-2">
            {isRejected ? (
              <span className="inline-flex items-center gap-1 rounded-full bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300 px-2.5 py-0.5 text-xs font-medium">
                <RotateCcw className="h-3 w-3" />
                Original Kept
              </span>
            ) : blockingIssues.length > 0 || (hasFactIssue && !factConfirmed) ? (
              <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 text-amber-900 dark:bg-amber-950/60 dark:text-amber-200 px-2.5 py-0.5 text-xs font-semibold">
                <AlertTriangle className="h-3 w-3 text-amber-600 dark:text-amber-400" />
                Review Required
              </span>
            ) : (
              <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 text-emerald-900 dark:bg-emerald-950/60 dark:text-emerald-200 px-2.5 py-0.5 text-xs font-semibold">
                <CheckCircle2 className="h-3 w-3 text-emerald-600 dark:text-emerald-400" />
                Ready to Accept
              </span>
            )}
          </div>
        </div>

        {/* Requirements & Rationale badges */}
        {requirements.length > 0 && (
          <div className="flex flex-wrap gap-1.5 pt-1">
            {requirements.map((req, i) => (
              <div
                key={i}
                className="inline-flex items-center gap-1 text-xs px-2.5 py-1 rounded-md bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300"
              >
                <Sparkles className="h-3 w-3 text-vermilion-500 shrink-0" />
                <span>Requirement: {req}</span>
              </div>
            ))}
          </div>
        )}

        {p.rationale && (
          <p className="text-xs text-slate-600 dark:text-slate-400 italic">
            Rationale: {p.rationale}
          </p>
        )}
      </div>

      {/* 2. Side-by-Side Comparison Zone */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Left: Original resume bullet */}
        <div className="rounded-lg border border-slate-200 dark:border-slate-800/80 bg-slate-50/70 dark:bg-slate-900/40 p-4 space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
              Original from your resume
            </span>
          </div>
          <p className="text-xs sm:text-sm text-slate-700 dark:text-slate-300 leading-relaxed font-sans">
            {p.before || <span className="italic text-slate-400">(New section/content)</span>}
          </p>
        </div>

        {/* Right: Proposed bullet for this job */}
        <div className={`rounded-lg border p-4 space-y-2 transition-all ${
          isRejected
            ? 'border-slate-300 dark:border-slate-800 bg-slate-100/50 dark:bg-slate-950/30 opacity-70'
            : 'border-vermilion-200 dark:border-vermilion-900/50 bg-vermilion-50/20 dark:bg-vermilion-950/10'
        }`}>
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold uppercase tracking-wider text-vermilion-600 dark:text-vermilion-400 flex items-center gap-1.5">
              <Sparkles className="h-3.5 w-3.5" />
              Proposed for this job
            </span>
            <label className="inline-flex items-center gap-1.5 text-xs text-slate-600 dark:text-slate-400 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={!isRejected}
                disabled={disabled}
                onChange={e => onPatch({ proposal_id: p.id, decision: e.target.checked ? 'pending' : 'rejected' })}
                className="rounded border-slate-300 text-vermilion-600 focus:ring-vermilion-500"
              />
              Include change
            </label>
          </div>

          <label className="block">
            <span className="sr-only">Proposed wording</span>
            <textarea
              aria-label="Proposed wording"
              rows={3}
              data-proposal-field={p.id}
              disabled={disabled || isRejected}
              className={`${inputClass} text-xs sm:text-sm leading-relaxed`}
              value={p.edited_after ?? p.after}
              onChange={e => onPatch({ proposal_id: p.id, edited_after: e.target.value })}
            />
          </label>
        </div>
      </div>

      {/* 3. Verification & Privacy Fact Notice Zone */}
      {(hasFactIssue || blockingIssues.length > 0) && (
        <div className="rounded-xl border border-amber-200 dark:border-amber-900/60 bg-amber-50/50 dark:bg-amber-950/30 p-4 space-y-3">
          <div className="flex items-start gap-3">
            <ShieldCheck className="h-5 w-5 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
            <div className="space-y-1 text-xs">
              <h4 className="font-semibold text-slate-900 dark:text-white">
                Factual Evidence & Privacy Check
              </h4>
              <p className="text-slate-600 dark:text-slate-300 leading-relaxed">
                {fact?.question ?? 'Does this claim accurately describe your work? This claim contains wording that cannot be sent under privacy rules without human confirmation.'}
              </p>
              {blockingIssues.map(issue => (
                <div key={issue.id} className="pt-1">
                  <IssueList issues={issue.details} />
                </div>
              ))}
            </div>
          </div>

          {/* 1-Click Attestation Button */}
          {hasFactIssue && (
            <div className="flex flex-wrap items-center gap-3 pt-1 border-t border-amber-200/60 dark:border-amber-900/40">
              {factConfirmed ? (
                <div className="flex items-center gap-2 text-xs font-semibold text-emerald-700 dark:text-emerald-400">
                  <CheckCircle2 className="h-4 w-4" />
                  <span>Confirmed: Claim verified for this job</span>
                </div>
              ) : (
                <button
                  type="button"
                  disabled={disabled}
                  onClick={onConfirmFact}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-amber-600 hover:bg-amber-500 text-white px-3.5 py-1.5 text-xs font-semibold shadow-sm transition-all"
                >
                  <CheckCircle2 className="h-4 w-4" />
                  <span>Confirm accuracy as written (I did this work)</span>
                </button>
              )}
            </div>
          )}
        </div>
      )}

      {/* 4. Evidence Citations Attached to this bullet */}
      <div className="space-y-2 pt-1 border-t border-slate-100 dark:border-slate-800/80">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <span className="text-xs font-medium text-slate-700 dark:text-slate-300">
              Attached Evidence Sources ({p.citations.length})
            </span>
          </div>

          <button
            type="button"
            disabled={disabled || isRejected}
            className={`${secondaryButton} text-xs py-1 px-2.5 inline-flex items-center gap-1`}
            onClick={() => setChoosingEvidence(true)}
          >
            <Plus className="h-3.5 w-3.5" />
            <span>Attach Evidence</span>
          </button>
        </div>

        {p.citations.length > 0 ? (
          <div className="flex flex-wrap gap-2">
            {p.citations.map(id => (
              <CitationChip
                key={id}
                id={id}
                label={title(id)}
                onRemove={isRejected ? undefined : () => onPatch({ proposal_id: p.id, citations: p.citations.filter(v => v !== id) })}
              />
            ))}
          </div>
        ) : (
          <p className="text-xs text-slate-400 italic">No evidence sources attached to this proposed edit.</p>
        )}
      </div>

      {/* Advanced: Term Grounding Disclosure */}
      <details className="text-xs text-slate-500 dark:text-slate-400">
        <summary className="cursor-pointer font-medium hover:text-slate-700 dark:hover:text-slate-200">
          Advanced: Ground a specific term in this passage
        </summary>
        <div className="mt-2 space-y-2.5 p-3 rounded-lg bg-slate-50 dark:bg-slate-900/60 border border-slate-200 dark:border-slate-800">
          <label className="block">
            Term to ground
            <input
              className={inputClass}
              value={grounding?.term ?? ''}
              disabled={disabled}
              onChange={e => updateGrounding({ term: e.target.value })}
            />
          </label>
          <label className="block">
            Supporting source
            <select
              aria-label="Supporting source"
              className={inputClass}
              value={grounding?.evidence_id ?? ''}
              disabled={disabled}
              onChange={e => updateGrounding({ evidence_id: e.target.value, quote: '' })}
            >
              <option value="">Select cited source</option>
              {p.citations.map(id => (
                <option key={id} value={id}>
                  {title(id)}
                </option>
              ))}
            </select>
          </label>
          <label className="block">
            Exact passage
            <textarea
              className={inputClass}
              rows={2}
              value={grounding?.quote ?? ''}
              disabled={disabled}
              onChange={e => updateGrounding({ quote: e.target.value })}
            />
          </label>
          <label className="block">
            Why this passage supports the term
            <textarea
              className={inputClass}
              rows={2}
              value={grounding?.explanation ?? ''}
              disabled={disabled}
              onChange={e => updateGrounding({ explanation: e.target.value })}
            />
          </label>
        </div>
      </details>

      {/* Save Status / Feedback */}
      {saveStatusMessage && (
        <div role="status" aria-label="Passage save status" className="text-xs font-medium text-emerald-700 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-950/40 p-2.5 rounded-lg border border-emerald-200 dark:border-emerald-800/60">
          {saveStatusMessage}
        </div>
      )}

      {/* 5. Sticky Action Bar */}
      <div className="sticky bottom-0 bg-white/95 dark:bg-slate-900/95 backdrop-blur border-t border-slate-200 dark:border-slate-800 pt-3 -mx-5 px-5 -mb-5 pb-5 flex flex-wrap items-center justify-between gap-3">
        <button
          type="button"
          disabled={disabled}
          onClick={onDiscardChange}
          className="text-xs font-medium text-slate-500 hover:text-rose-600 dark:text-slate-400 dark:hover:text-rose-400 underline transition-colors"
        >
          {isRejected ? 'Restore proposed wording' : 'Discard change (keep original bullet)'}
        </button>

        <div className="flex items-center gap-2.5">
          <button
            type="button"
            disabled={disabled}
            onClick={onSkip}
            className={`${secondaryButton} text-xs py-2 px-3`}
          >
            Skip for now
          </button>

          <button
            type="button"
            disabled={disabled}
            onClick={onAcceptAndNext}
            className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white px-4 py-2 text-xs font-semibold shadow-sm transition-all"
          >
            <span>Accept & Next Passage</span>
            <ArrowRight className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      {/* Modal: Evidence Chooser */}
      {choosingEvidence && (
        <JobEvidenceChooser
          evidence={evidence}
          support={support}
          selected={p.citations}
          onChange={citations => onPatch({ proposal_id: p.id, citations })}
          onClose={() => setChoosingEvidence(false)}
        />
      )}
    </div>
  );
}
