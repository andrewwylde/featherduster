import React from 'react';
import type { RunState, StepStatus, ValidationIssue } from '@featherduster/core';
import { AlertTriangle, Ban, Info } from 'lucide-react';

export const cardClass =
  'rounded-desk border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#121622] shadow-sm';

export const primaryButton =
  'inline-flex items-center justify-center gap-1.5 rounded-desk bg-vermilion-500 px-3.5 py-2 min-h-[44px] sm:min-h-0 text-sm font-semibold text-white hover:bg-vermilion-600 disabled:cursor-not-allowed disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-vermilion-500 focus-visible:ring-offset-2 dark:focus-visible:ring-offset-[#0c0f17]';

export const secondaryButton =
  'inline-flex items-center justify-center gap-1.5 rounded-desk border border-slate-300 dark:border-slate-700 bg-white dark:bg-transparent px-3 py-2 min-h-[44px] sm:min-h-0 text-sm font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800/60 disabled:cursor-not-allowed disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-vermilion-500';

export const inputClass =
  'w-full rounded-desk border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-base sm:text-sm text-slate-900 dark:text-slate-100 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-vermilion-500/40 focus:border-vermilion-500';

export const eyebrowClass =
  'text-xs font-mono uppercase tracking-widest text-vermilion-600 dark:text-vermilion-400 font-semibold';

const STATE_LABELS: Record<RunState, string> = {
  draft: 'Ready to analyze',
  analyzing: 'Analyzing posting…',
  analysis_ready: 'Review requirements',
  aligning: 'Matching evidence…',
  alignment_review: 'Review alignment',
  proposing: 'Drafting edits…',
  proposal_review: 'Review edits',
  briefing: 'Writing brief…',
  complete: 'Complete',
  error: 'Needs attention',
  cancelled: 'Cancelled',
};

export function stateLabel(state: RunState): string {
  return STATE_LABELS[state] ?? state;
}

export const StatusPill: React.FC<{ status: StepStatus | 'needs_review' | 'complete' }> = ({ status }) => {
  const styles: Record<string, string> = {
    pending: 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400',
    running: 'bg-amber-100 text-amber-800 dark:bg-amber-950/40 dark:text-amber-300',
    done: 'bg-sky-100 text-sky-800 dark:bg-sky-950/40 dark:text-sky-300',
    needs_review: 'bg-sky-100 text-sky-800 dark:bg-sky-950/40 dark:text-sky-300',
    approved: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300',
    complete: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300',
    stale: 'bg-orange-100 text-orange-800 dark:bg-orange-950/40 dark:text-orange-300',
    error: 'bg-rose-100 text-rose-800 dark:bg-rose-950/40 dark:text-rose-300',
  };
  const labels: Record<string, string> = {
    pending: 'Not run',
    running: 'Running',
    done: 'Needs review',
    needs_review: 'Needs review',
    approved: 'Approved',
    complete: 'Complete',
    stale: 'Stale',
    error: 'Error',
  };
  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold ${styles[status]}`}>
      {labels[status]}
    </span>
  );
};

export const IssueList: React.FC<{ issues?: ValidationIssue[] }> = ({ issues }) => {
  if (!issues || issues.length === 0) return null;
  return (
    <ul className="mt-2 space-y-1">
      {issues.map((issue, idx) => {
        const block = issue.severity === 'block';
        const Icon = block ? Ban : issue.kind.startsWith('deslop') ? Info : AlertTriangle;
        return (
          <li
            key={`${issue.kind}-${idx}`}
            className={`flex items-start gap-1.5 text-xs ${
              block ? 'text-rose-700 dark:text-rose-300' : 'text-amber-800 dark:text-amber-300'
            }`}
          >
            <Icon className="mt-0.5 h-3.5 w-3.5 flex-shrink-0" aria-hidden="true" />
            <span>
              <span className="sr-only">{block ? 'Blocking: ' : 'Warning: '}</span>
              {issue.message}
            </span>
          </li>
        );
      })}
    </ul>
  );
};

export const CitationChip: React.FC<{ id: string; onClick?: (id: string) => void; onRemove?: (id: string) => void }> = ({
  id,
  onClick,
  onRemove,
}) => (
  <span className="inline-flex items-center gap-1 rounded-md border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 px-1.5 py-0.5 font-mono text-[11px] text-slate-700 dark:text-slate-300">
    {onClick ? (
      <button type="button" onClick={() => onClick(id)} className="hover:text-vermilion-600 dark:hover:text-vermilion-400 focus-visible:outline-none focus-visible:underline">
        {id}
      </button>
    ) : (
      id
    )}
    {onRemove && (
      <button
        type="button"
        onClick={() => onRemove(id)}
        aria-label={`Remove citation ${id}`}
        className="text-slate-400 hover:text-rose-600"
      >
        ×
      </button>
    )}
  </span>
);
