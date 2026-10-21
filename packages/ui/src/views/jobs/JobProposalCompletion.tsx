import { useState } from 'react';
import { CheckCircle2, FileText, Sparkles, RefreshCw, Eye } from 'lucide-react';
import { cardClass } from '../tailoring/ui.js';
import { compileMarkdownResume } from '@featherduster/core';

export function JobProposalCompletion({
  acceptedCount,
  rejectedCount,
  totalCount,
  candidatePreview,
  onGeneratePdf,
  onOpenDrawer,
  busy,
  message,
}: {
  acceptedCount: number;
  rejectedCount: number;
  totalCount: number;
  candidatePreview: any;
  onGeneratePdf: () => Promise<void>;
  onOpenDrawer: () => void;
  busy: boolean;
  message?: string;
}) {
  const [showPreview, setShowPreview] = useState(false);

  return (
    <div className={`${cardClass} p-8 text-center space-y-6 max-w-2xl mx-auto border border-emerald-200 dark:border-emerald-900/50 shadow-md`}>
      <div className="mx-auto w-14 h-14 rounded-full bg-emerald-100 dark:bg-emerald-950/70 text-emerald-600 dark:text-emerald-400 flex items-center justify-center">
        <CheckCircle2 className="h-8 w-8" />
      </div>

      <div className="space-y-1.5">
        <h2 className="text-xl font-bold text-slate-900 dark:text-white">
          All Tailored Passages Reviewed!
        </h2>
        <p className="text-xs sm:text-sm text-slate-600 dark:text-slate-400 max-w-md mx-auto">
          All factual questions and validation blockers have been resolved. Your tailored resume is ready to compile into PDF.
        </p>
      </div>

      {/* Summary Metrics */}
      <div className="grid grid-cols-3 gap-3 p-4 rounded-xl bg-slate-50 dark:bg-slate-900/50 border border-slate-200/80 dark:border-slate-800 text-left">
        <div>
          <span className="text-[11px] font-mono uppercase text-slate-400">Total Passages</span>
          <p className="text-base font-bold text-slate-800 dark:text-slate-200">{totalCount}</p>
        </div>
        <div>
          <span className="text-[11px] font-mono uppercase text-emerald-600 dark:text-emerald-400">Accepted Edits</span>
          <p className="text-base font-bold text-emerald-600 dark:text-emerald-400">{acceptedCount}</p>
        </div>
        <div>
          <span className="text-[11px] font-mono uppercase text-slate-500">Originals Kept</span>
          <p className="text-base font-bold text-slate-700 dark:text-slate-300">{rejectedCount}</p>
        </div>
      </div>

      {message && (
        <div role="status" className="text-xs font-medium text-emerald-700 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-950/40 p-3 rounded-lg border border-emerald-200 dark:border-emerald-800/60">
          {message}
        </div>
      )}

      {/* Primary Actions */}
      <div className="flex flex-col sm:flex-row items-center justify-center gap-3 pt-2">
        <button
          type="button"
          disabled={busy}
          onClick={onGeneratePdf}
          className="w-full sm:w-auto inline-flex items-center justify-center gap-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-semibold text-sm px-6 py-2.5 shadow-sm transition-all min-h-[44px]"
        >
          {busy ? (
            <>
              <RefreshCw className="h-4 w-4 animate-spin" />
              <span>Starting preparation…</span>
            </>
          ) : (
            <>
              <Sparkles className="h-4 w-4" />
              <span>Generate Tailored PDF</span>
            </>
          )}
        </button>

        <button
          type="button"
          disabled={busy}
          onClick={onOpenDrawer}
          className="w-full sm:w-auto inline-flex items-center justify-center gap-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 text-xs font-semibold px-4 py-2.5 hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors min-h-[44px]"
        >
          <FileText className="h-4 w-4 text-slate-500" />
          <span>Review all passages</span>
        </button>
      </div>

      {/* Resume Markdown Preview Accordion */}
      {candidatePreview && (
        <div className="pt-2 text-left">
          <button
            type="button"
            onClick={() => setShowPreview(!showPreview)}
            className="text-xs text-slate-500 hover:text-slate-800 dark:hover:text-slate-300 inline-flex items-center gap-1.5 underline"
          >
            <Eye className="h-3.5 w-3.5" />
            <span>{showPreview ? 'Hide resume text' : 'Inspect compiled resume text'}</span>
          </button>

          {showPreview && (
            <pre className="mt-3 p-4 rounded-lg bg-slate-50 dark:bg-[#0c0f17] border border-slate-200 dark:border-slate-800 text-xs font-mono whitespace-pre-wrap break-words max-h-96 overflow-y-auto">
              {compileMarkdownResume(candidatePreview)}
            </pre>
          )}
        </div>
      )}
    </div>
  );
}
