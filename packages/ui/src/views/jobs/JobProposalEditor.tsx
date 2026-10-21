import { SourcePicker } from '../../components/SourcePicker.js';
import { useCallback, useState } from 'react';
import type { EvidenceRecord, JobFact, Proposal, ProposalIssue, ProposalPatch, SkillSupport } from '@featherduster/core';
import { cardClass, CitationChip, inputClass, IssueList, primaryButton, secondaryButton } from '../tailoring/ui.js';
import { wordDiff } from '../tailoring/wordDiff.js';
import { JobEvidenceChooser } from './JobEvidenceChooser.js';
import { Sparkles, CheckCircle2, ShieldCheck, ArrowRight } from 'lucide-react';

export interface GroundingDraft { proposal_id: string; term: string; evidence_id: string; quote: string; explanation: string }
const issueGroupNames: Record<string, string> = { grounding: 'Evidence grounding', wording: 'Wording', citation: 'Citations', fact: 'Facts', unsupported: 'Unsupported claims', relevance: 'Relevance', conflict: 'Conflicting edits' };

/** Validation groups are internal identifiers; show a readable, capitalised name. */
export function issueGroupLabel(group: string) {
  if (issueGroupNames[group]) return issueGroupNames[group];
  const words = group.replace(/[_-]+/g, ' ').trim();
  return words ? words.charAt(0).toUpperCase() + words.slice(1) : 'Review findings';
}

/** Source IDs are internal; show the captured source's title. */
export function evidenceTitle(evidence: EvidenceRecord[], id: string) {
  return evidence.find(r => r.id === id)?.title || 'Missing captured source';
}

export function JobProposalEditor({
  proposal,
  issues,
  evidence,
  support,
  requirements,
  grounding,
  onGrounding,
  onPatch,
  disabled,
  onSave,
  saveDisabled,
  position,
  fact,
  factConfirmed,
  onConfirmFact,
  onAdvanceNext,
}: {
  /** Only needed when one passage shows several changes; keeps accessible names unique. */
  position?: { index: number; total: number };
  proposal: Proposal;
  issues: ProposalIssue[];
  evidence: EvidenceRecord[];
  support: SkillSupport[];
  requirements: string[];
  onSave?: () => void;
  saveDisabled?: boolean;
  grounding?: GroundingDraft;
  onGrounding: (value?: GroundingDraft) => void;
  onPatch: (patch: ProposalPatch) => void;
  disabled: boolean;
  fact?: JobFact;
  factConfirmed?: boolean;
  onConfirmFact?: () => Promise<void>;
  onAdvanceNext?: () => void;
}) {
  const [choosing, setChoosing] = useState(false);
  const close = useCallback(() => setChoosing(false), []);
  const p = proposal;
  const isRejected = p.decision === 'rejected';
  const n = position && position.total > 1 ? ` (change ${position.index} of ${position.total})` : '';
  const title = (id: string) => evidenceTitle(evidence, id);
  const update = (value: Partial<GroundingDraft>) => onGrounding({ proposal_id: p.id, term: '', evidence_id: '', quote: '', explanation: '', ...grounding, ...value });
  const hasFactIssue = !!fact && fact.state !== 'supported';

  return (
    <fieldset disabled={disabled} className={`${cardClass} p-4 space-y-4 min-w-0 break-words border border-slate-200 dark:border-slate-800 shadow-sm`}>
      <legend className="font-semibold text-sm text-slate-900 dark:text-white flex items-center gap-1.5">
        <Sparkles className="h-4 w-4 text-vermilion-500" />
        Correct this wording{n}
      </legend>

      {/* Rationale and Target Requirements */}
      <div className="flex flex-wrap gap-2 text-xs">
        {p.rationale && <span className="font-medium text-slate-700 dark:text-slate-300">{p.rationale}</span>}
        {requirements.map((r, i) => (
          <span key={i} className="inline-flex items-center gap-1 bg-slate-100 dark:bg-slate-800 px-2.5 py-1 rounded-md text-slate-700 dark:text-slate-300">
            Requirement: {r}
          </span>
        ))}
        <details className="text-slate-500 dark:text-slate-400">
          <summary className="cursor-pointer">Original wording</summary>
          <p className="mt-1 p-2 bg-slate-50 dark:bg-slate-900 rounded">{p.before || '(new content)'}</p>
        </details>
        <details className="text-slate-500 dark:text-slate-400">
          <summary className="cursor-pointer">Generated wording</summary>
          <p className="mt-1 p-2 bg-slate-50 dark:bg-slate-900 rounded">{p.after}</p>
        </details>
      </div>

      {/* Side-by-Side Comparison Layout */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-1">
        {/* Left Column: Original Text */}
        <div className="rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-900/40 p-3.5 space-y-1.5">
          <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400 block">
            Original from your resume
          </span>
          <p className="text-xs sm:text-sm text-slate-800 dark:text-slate-200 leading-relaxed font-sans">
            {p.before || <span className="italic text-slate-400">(New section/content)</span>}
          </p>
        </div>

        {/* Right Column: Proposed for this Job */}
        <div className={`rounded-lg border p-3.5 space-y-2 transition-all ${
          isRejected
            ? 'border-slate-300 dark:border-slate-800 bg-slate-100/50 dark:bg-slate-950/30 opacity-70'
            : 'border-vermilion-200 dark:border-vermilion-900/50 bg-vermilion-50/20 dark:bg-vermilion-950/10'
        }`}>
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-semibold uppercase tracking-wider text-vermilion-600 dark:text-vermilion-400 flex items-center gap-1">
              <Sparkles className="h-3 w-3" />
              Proposed wording{n}
            </span>
            <label className="inline-flex items-center gap-1 text-xs text-slate-600 dark:text-slate-400 cursor-pointer select-none">
              <input
                type="checkbox"
                aria-label={`Include this change${n}`}
                checked={!isRejected}
                onChange={e => onPatch({ proposal_id: p.id, decision: e.target.checked ? 'pending' : 'rejected' })}
                className="rounded border-slate-300 text-vermilion-600 focus:ring-vermilion-500"
              />
              Include this change{n}
            </label>
          </div>

          <label className="block text-sm">
            <span className="sr-only">Proposed wording{n}</span>
            <textarea
              aria-label={`Proposed wording${n}`}
              rows={3}
              data-proposal-field={p.id}
              aria-describedby={`issues-${p.id}`}
              disabled={isRejected}
              className={`${inputClass} text-xs sm:text-sm leading-relaxed`}
              value={p.edited_after ?? p.after}
              onChange={e => onPatch({ proposal_id: p.id, edited_after: e.target.value })}
            />
          </label>
          {isRejected && <span className="text-xs text-slate-500 italic block">Rejected — original content retained.</span>}
        </div>
      </div>

      {/* Validation Issues Block */}
      <div id={`issues-${p.id}`}>
        {issues.map(issue => (
          <details open key={issue.id} className="text-xs">
            <summary className="text-xs font-semibold text-amber-700 dark:text-amber-400 cursor-pointer">
              {issueGroupLabel(issue.group)}
            </summary>
            <div className="mt-1">
              <IssueList issues={issue.details} />
            </div>
          </details>
        ))}
      </div>

      {/* 1-Click Fact Verification Zone (if unbacked claims exist) */}
      {hasFactIssue && (
        <div className="rounded-xl border border-amber-200 dark:border-amber-900/60 bg-amber-50/50 dark:bg-amber-950/30 p-3 space-y-2 text-xs">
          <div className="flex items-center gap-2 font-semibold text-slate-900 dark:text-white">
            <ShieldCheck className="h-4 w-4 text-amber-600 dark:text-amber-400" />
            <span>Factual Evidence & Privacy Attestation</span>
          </div>
          <p className="text-slate-600 dark:text-slate-300">
            {fact?.question ?? 'Does this claim accurately describe your work? This wording requires verification before sending.'}
          </p>
          <div className="pt-1">
            {factConfirmed ? (
              <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-emerald-700 dark:text-emerald-400">
                <CheckCircle2 className="h-4 w-4" />
                <span>Confirmed: Claim verified for this job</span>
              </span>
            ) : (
              <button
                type="button"
                disabled={disabled}
                onClick={onConfirmFact}
                className="inline-flex items-center gap-1.5 rounded-lg bg-amber-600 hover:bg-amber-500 text-white px-3 py-1.5 text-xs font-semibold shadow-sm transition-all"
              >
                <CheckCircle2 className="h-4 w-4" />
                <span>Confirm accuracy as written (I did this work)</span>
              </button>
            )}
          </div>
        </div>
      )}

      {/* Primary Actions & Attached Evidence Chips */}
      <div className="flex flex-wrap items-center justify-between gap-3 pt-2 border-t border-slate-100 dark:border-slate-800">
        <div className="flex flex-wrap items-center gap-2">
          {onSave && (
            <button
              className={primaryButton}
              disabled={disabled || saveDisabled}
              onClick={onSave}
            >
              Save for this job
            </button>
          )}
          {onAdvanceNext && (
            <button
              type="button"
              className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white px-3.5 py-1.5 text-xs font-semibold shadow-sm transition-all"
              disabled={disabled || saveDisabled}
              onClick={onAdvanceNext}
            >
              <span>Accept & Next Passage</span>
              <ArrowRight className="h-3.5 w-3.5" />
            </button>
          )}
          <button
            type="button"
            className={`${secondaryButton} text-xs py-1.5 px-3`}
            disabled={disabled}
            onClick={() => onPatch({ proposal_id: p.id, decision: isRejected ? 'pending' : 'rejected' })}
          >
            {isRejected ? 'Restore proposal' : 'Discard change (keep original)'}
          </button>
        </div>

        <div className="flex flex-wrap items-center gap-2 text-xs">
          <button
            type="button"
            className={`${secondaryButton} text-xs py-1 px-2.5`}
            onClick={() => setChoosing(true)}
          >
            Choose supporting evidence{n}
          </button>
        </div>
      </div>

      {/* Evidence Chips */}
      {p.citations.length > 0 && (
        <div className="flex flex-wrap gap-2 pt-1">
          {p.citations.map(id => (
            <CitationChip
              key={id}
              id={id}
              label={title(id)}
              onRemove={isRejected ? undefined : () => onPatch({ proposal_id: p.id, citations: p.citations.filter(v => v !== id) })}
            />
          ))}
        </div>
      )}

      {/* Expandable Comparison & Grounding Details */}
      <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs pt-1">
        <details>
          <summary className="cursor-pointer text-slate-500 hover:text-slate-800 dark:hover:text-slate-200">
            Compare wording
          </summary>
          <div aria-label={`Wording comparison${n}`} className="mt-1 p-2 rounded bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800">
            {wordDiff(p.before, p.edited_after ?? p.after).map((part, i) => (
              part.type === 'added' ? <ins key={i} className="bg-emerald-100 text-emerald-900 dark:bg-emerald-950 dark:text-emerald-300 no-underline font-semibold">{part.text}</ins>
                : part.type === 'removed' ? <del key={i} className="bg-rose-100 text-rose-900 dark:bg-rose-950 dark:text-rose-300 font-semibold">{part.text}</del>
                : <span key={i}>{part.text}</span>
            ))}
          </div>
        </details>
        {p.citations.map(id => (
          <details key={id}>
            <summary className="cursor-pointer text-slate-500 hover:text-slate-800 dark:hover:text-slate-200">
              {title(id)} · captured passage
            </summary>
            <p className="whitespace-pre-wrap mt-1 p-2 rounded bg-slate-50 dark:bg-slate-900 text-slate-600 dark:text-slate-400">
              {evidence.find(r => r.id === id)?.narrative ?? 'Missing captured source'}
            </p>
          </details>
        ))}
      </div>

      {/* Ground a specific term */}
      <details className="text-xs">
        <summary className="cursor-pointer text-slate-500 hover:text-slate-800 dark:hover:text-slate-200">
          Ground a specific term
        </summary>
        <div className="mt-2 space-y-2 p-3 rounded-lg bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800">
          <p className="text-xs text-slate-500">A terminology decision is not permission to add a technology, metric or ownership claim. Select a cited passage and explain the relationship.</p>
          <label className="block">Term to ground{n}<input className={inputClass} value={grounding?.term ?? ''} onChange={e => update({ term: e.target.value })} /></label>
          <label className="block">Supporting source{n}<SourcePicker label={`Supporting source${n}`} disabled={disabled} value={grounding?.evidence_id ?? ''} onSelect={value => update({ evidence_id: value, quote: '' })} options={p.citations.map(id => ({ id, name: title(id), type: '' }))} /></label>
          <label className="block">Exact passage{n}<textarea className={inputClass} value={grounding?.quote ?? ''} onChange={e => update({ quote: e.target.value })} /></label>
          <label className="block">Why this passage supports the term{n}<textarea className={inputClass} value={grounding?.explanation ?? ''} onChange={e => update({ explanation: e.target.value })} /></label>
          <button className={secondaryButton} onClick={() => onGrounding(undefined)}>Remove term grounding{n}</button>
        </div>
      </details>

      {choosing && <JobEvidenceChooser evidence={evidence} support={support} selected={p.citations} onChange={citations => onPatch({ proposal_id: p.id, citations })} onClose={close} />}
    </fieldset>
  );
}
