import React from 'react';
import {
  ArrowRight,
  FileText,
  GitPullRequest,
  Maximize2,
  MessageSquare,
  ShieldAlert,
  Sparkles,
  WandSparkles,
} from 'lucide-react';
import type { TailoringRunSummary } from '../../api/client';
import { EvidenceBadge } from '../../components/desk/EvidenceBadge';
import { evidenceStatus, type BriefingModel } from '../../data/deskModel';
import {
  generateDefenseQuestions,
  evaluateDefenseAnswer,
  type DefenseEvaluation,
} from '@featherduster/core';

interface PrivateBriefingProps {
  loading: boolean;
  error: string | null;
  briefing: BriefingModel | null;
  runs: TailoringRunSummary[];
  onStrengthen: (evidenceId: string) => void;
  onViewThreads: () => void;
  onOpenTailor: () => void;
  onOpenRun: (slug: string) => void;
  onOpenEvidence: () => void;
  onRetry: () => void;
}

const card = 'rounded-desk border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#121622] p-6 shadow-sm';
const eyebrow = 'text-xs font-mono uppercase tracking-widest text-vermilion-600 dark:text-vermilion-400 font-semibold';

export const PrivateBriefing: React.FC<PrivateBriefingProps> = ({
  loading,
  error,
  briefing,
  runs,
  onStrengthen,
  onViewThreads,
  onOpenTailor,
  onOpenRun,
  onOpenEvidence,
  onRetry,
}) => {
  const needsReview = runs.filter((r) => r.needs_review);
  const [selectedEntryId, setSelectedEntryId] = React.useState<string | null>(null);
  const [activeQuestionId, setActiveQuestionId] = React.useState<string>('attribution');
  const [answerText, setAnswerText] = React.useState<string>('');
  const [evaluation, setEvaluation] = React.useState<DefenseEvaluation | null>(null);

  const tailorPanel = (
    <section aria-labelledby="tailor-heading" className={card}>
      <span className={eyebrow}>Tailor</span>
      <h2 id="tailor-heading" className="mt-1 text-base font-bold text-slate-900 dark:text-white">Applying somewhere?</h2>
      <p className="mt-1 text-xs leading-relaxed text-slate-600 dark:text-slate-400">
        Paste a posting and the tailoring skill matches it to this ledger, proposes cited edits, and writes an interview brief.
      </p>
      <button type="button" onClick={onOpenTailor} className="mt-4 inline-flex items-center gap-1.5 rounded-desk bg-vermilion-500 px-3.5 py-2 text-sm font-semibold text-white hover:bg-vermilion-600">
        <WandSparkles className="h-4 w-4" aria-hidden="true" /> Tailor for a job
      </button>
      {needsReview.length > 0 && (
        <ul aria-label="Runs needing review" className="mt-4 space-y-1.5 border-t border-slate-100 pt-4 dark:border-slate-800/80">
          {needsReview.map((r) => (
            <li key={r.slug}>
              <button type="button" onClick={() => onOpenRun(r.slug)} className="flex w-full items-center justify-between rounded-desk px-2 py-1.5 text-left text-sm hover:bg-slate-100 dark:hover:bg-slate-800/60">
                <span className="truncate text-slate-800 dark:text-slate-200">{r.title || r.slug}</span>
                <span className="ml-2 text-xs text-sky-700 dark:text-sky-300">Needs review</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );

  if (error && !briefing) {
    return (
      <div role="alert" className="rounded-desk border border-rose-200 bg-rose-50 p-6 text-rose-900 dark:border-rose-900/50 dark:bg-rose-950/20 dark:text-rose-200">
        <p className="font-semibold">Your briefing could not load.</p>
        <p className="mt-1 text-sm">{error}</p>
        <button type="button" onClick={onRetry} className="mt-4 rounded-desk border border-rose-300 px-3 py-2 text-sm font-semibold">Try again</button>
      </div>
    );
  }
  if (loading) return <p className="text-sm text-slate-500">Reading your ledger…</p>;

  if (!briefing) {
    return (
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
        <section className={`${card} lg:col-span-7`}>
          <span className={eyebrow}>Briefing</span>
          <h1 className="mt-1.5 text-2xl font-bold text-slate-900 dark:text-white">Your ledger is empty</h1>
          <p className="mt-2 text-sm text-slate-600 dark:text-slate-300">
            The briefing is built only from your evidence entries. Capture your first one to see threads and gaps here.
          </p>
          <button type="button" onClick={onOpenEvidence} className="mt-4 rounded-desk bg-vermilion-500 px-3.5 py-2 text-sm font-semibold text-white hover:bg-vermilion-600">
            Capture evidence
          </button>
        </section>
        <div className="lg:col-span-5">{tailorPanel}</div>
      </div>
    );
  }

  const { thread, recent, needsProof, totals } = briefing;
  const activeRecord = (recent.find((r) => r.id === selectedEntryId) || recent[0]) || null;
  const defenseQuestions = activeRecord ? generateDefenseQuestions(activeRecord.entry) : [];
  const currentQuestion = defenseQuestions.find((q) => q.id === activeQuestionId) || defenseQuestions[0];

  const handleEvaluate = () => {
    if (!activeRecord || !currentQuestion) return;
    const result = evaluateDefenseAnswer(answerText, activeRecord.entry, currentQuestion);
    setEvaluation(result);
  };

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
      <div className="space-y-6 lg:col-span-7">
        <section className={card} aria-labelledby="lead-heading">
          <span className={eyebrow}>Briefing</span>
          <h1 id="lead-heading" className="mt-1.5 text-2xl sm:text-3xl font-bold leading-tight tracking-tight text-slate-900 dark:text-white">
            Your strongest thread: {thread.title}
          </h1>
          <p className="mt-2 text-sm text-slate-600 dark:text-slate-300">
            Computed from your ledger: the theme with the most entries, and its most recent work.
          </p>
          <p className="mt-1 font-mono text-xs text-slate-500">
            {totals.entries} entries · {totals.verified} verified · {totals.needsProof} need proof · {totals.threads} threads
          </p>

          <ul aria-label="Recent entries" className="mt-5 space-y-3">
            {recent.map((r) => (
              <li key={r.id} className="rounded-desk border border-slate-200/90 bg-slate-50/50 p-4 dark:border-slate-800 dark:bg-slate-900/40">
                <div className="flex items-start justify-between gap-3">
                  <span className="font-mono text-xs text-slate-500">{r.id} · {r.entry.company}</span>
                  <span className="font-mono text-xs text-slate-500">{r.entry.date}</span>
                </div>
                <h3 className="mt-1.5 text-sm font-semibold text-slate-900 dark:text-white">{r.entry.title}</h3>
                <p className="mt-1 text-xs leading-relaxed text-slate-600 dark:text-slate-400">{r.entry.impact}</p>
                <div className="mt-3 flex items-center justify-between border-t border-slate-200/50 pt-2 dark:border-slate-800/50">
                  <EvidenceBadge status={evidenceStatus(r)} />
                  <span className="flex items-center gap-2 text-[11px] text-slate-500">
                    {r.entry.internal_references.slice(0, 2).map((ref) => (
                      <span key={`${ref.type}-${ref.ref}`} className="inline-flex items-center gap-1">
                        {ref.type.toLowerCase() === 'pr' ? <GitPullRequest className="h-3 w-3" aria-hidden="true" /> : <FileText className="h-3 w-3" aria-hidden="true" />}
                        {ref.type} {ref.ref}
                      </span>
                    ))}
                  </span>
                </div>
              </li>
            ))}
          </ul>

          <div className="mt-5 flex justify-end border-t border-slate-100 pt-4 dark:border-slate-800/80">
            <button type="button" onClick={onViewThreads} className="inline-flex items-center gap-1.5 text-xs font-medium text-vermilion-600 hover:underline dark:text-vermilion-400">
              <Maximize2 className="h-3.5 w-3.5" aria-hidden="true" /> See all threads
            </button>
          </div>
        </section>
      </div>

      <div className="space-y-6 lg:col-span-5">
        {tailorPanel}

        {activeRecord && currentQuestion && (
          <section className={card} aria-labelledby="defense-heading">
            <div className="flex items-center justify-between">
              <div>
                <span className={eyebrow}>Mock Cross-Examination</span>
                <h2 id="defense-heading" className="mt-1 text-base font-bold text-slate-900 dark:text-white">
                  Interview Defense Simulator
                </h2>
              </div>
              <span className="inline-flex items-center gap-1 rounded-full bg-vermilion-50 px-2 py-0.5 text-xs font-semibold text-vermilion-700 dark:bg-vermilion-950/40 dark:text-vermilion-300">
                <ShieldAlert className="h-3.5 w-3.5" aria-hidden="true" /> Defense Mode
              </span>
            </div>

            <p className="mt-1 text-xs text-slate-600 dark:text-slate-400">
              Skeptical Staff+ interviewer probing your active evidence. Defend your claims without buzzwords or hollow fluff.
            </p>

            {recent.length > 1 && (
              <div className="mt-3 flex flex-wrap gap-1.5">
                {recent.map((r) => (
                  <button
                    key={r.id}
                    type="button"
                    onClick={() => { setSelectedEntryId(r.id); setEvaluation(null); }}
                    className={`rounded px-2 py-1 text-xs font-medium transition ${
                      activeRecord.id === r.id
                        ? 'bg-slate-900 text-white dark:bg-white dark:text-slate-900'
                        : 'bg-slate-100 text-slate-700 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-300'
                    }`}
                  >
                    {r.id}: {r.entry.title.slice(0, 16)}…
                  </button>
                ))}
              </div>
            )}

            <div className="mt-3 flex flex-wrap gap-1 border-b border-slate-100 pb-2 dark:border-slate-800">
              {defenseQuestions.map((q) => (
                <button
                  key={q.id}
                  type="button"
                  onClick={() => { setActiveQuestionId(q.id); setEvaluation(null); }}
                  className={`rounded-desk px-2.5 py-1 text-xs font-medium ${
                    currentQuestion.id === q.id
                      ? 'bg-vermilion-500 text-white'
                      : 'text-slate-600 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800'
                  }`}
                >
                  {q.id.charAt(0).toUpperCase() + q.id.slice(1).replace('_', ' ')}
                </button>
              ))}
            </div>

            <div className="mt-3 rounded-desk border border-slate-200/80 bg-slate-50/60 p-3.5 dark:border-slate-800 dark:bg-slate-900/60">
              <div className="flex items-center gap-1.5 text-[11px] font-semibold text-slate-500">
                <MessageSquare className="h-3.5 w-3.5 text-vermilion-500" aria-hidden="true" />
                {currentQuestion.interviewerRole} asks:
              </div>
              <p className="mt-1 text-xs font-medium leading-relaxed text-slate-800 dark:text-slate-200">
                "{currentQuestion.prompt}"
              </p>
            </div>

            <div className="mt-3">
              <label htmlFor="defense-answer-input" className="sr-only">Your defense answer</label>
              <textarea
                id="defense-answer-input"
                aria-label="Your defense answer"
                rows={3}
                value={answerText}
                onChange={(e) => setAnswerText(e.target.value)}
                placeholder="Deliver your pitch: state your exact personal contribution, root mechanisms, profiling tools, and trade-offs accepted..."
                className="w-full rounded-desk border border-slate-200 bg-white p-2.5 text-xs text-slate-900 placeholder:text-slate-400 focus:border-vermilion-500 focus:outline-none dark:border-slate-800 dark:bg-slate-900 dark:text-white"
              />
            </div>

            <div className="mt-2 flex items-center justify-between">
              <span className="text-[11px] text-slate-400">
                {answerText.trim().split(/\s+/).filter(Boolean).length} words
              </span>
              <button
                type="button"
                onClick={handleEvaluate}
                disabled={!answerText.trim()}
                className="inline-flex items-center gap-1.5 rounded-desk bg-slate-900 px-3 py-1.5 text-xs font-semibold text-white hover:bg-slate-800 disabled:opacity-50 dark:bg-white dark:text-slate-900 dark:hover:bg-slate-100"
              >
                <Sparkles className="h-3.5 w-3.5" aria-hidden="true" /> Evaluate Defense
              </button>
            </div>

            {evaluation && (
              <div
                role="region"
                aria-label="Defense Evaluation"
                className="mt-3 rounded-desk border border-slate-200 p-3.5 text-xs dark:border-slate-800 bg-slate-50/50 dark:bg-slate-900/40"
              >
                <div className="flex items-center justify-between border-b border-slate-200/60 pb-2 dark:border-slate-800/60">
                  <div className="flex items-center gap-2">
                    <span
                      className={`rounded px-2 py-0.5 font-bold uppercase tracking-wider text-[10px] ${
                        evaluation.verdict === 'defensible'
                          ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300'
                          : evaluation.verdict === 'vulnerable'
                          ? 'bg-amber-100 text-amber-800 dark:bg-amber-950/60 dark:text-amber-300'
                          : 'bg-rose-100 text-rose-800 dark:bg-rose-950/60 dark:text-rose-300'
                      }`}
                    >
                      {evaluation.verdict}
                    </span>
                    <span className="font-semibold text-slate-700 dark:text-slate-300">
                      Score: {evaluation.score}/100
                    </span>
                  </div>
                  {evaluation.groundedMetrics.length > 0 && (
                    <span className="text-[11px] text-emerald-600 dark:text-emerald-400">
                      {evaluation.groundedMetrics.length} metrics cited
                    </span>
                  )}
                </div>

                {evaluation.strengths.length > 0 && (
                  <div className="mt-2 space-y-1">
                    <span className="font-semibold text-emerald-700 dark:text-emerald-400">Strengths:</span>
                    <ul className="list-inside list-disc text-slate-600 dark:text-slate-300 space-y-0.5">
                      {evaluation.strengths.map((s, idx) => (
                        <li key={idx}>{s}</li>
                      ))}
                    </ul>
                  </div>
                )}

                {evaluation.improvements.length > 0 && (
                  <div className="mt-2 space-y-1">
                    <span className="font-semibold text-rose-700 dark:text-rose-400">Areas to Defend:</span>
                    <ul className="list-inside list-disc text-slate-600 dark:text-slate-300 space-y-0.5">
                      {evaluation.improvements.map((imp, idx) => (
                        <li key={idx}>{imp}</li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            )}
          </section>
        )}
        <section className={card} aria-labelledby="proof-heading">
          <h2 id="proof-heading" className="text-sm font-bold text-slate-900 dark:text-white">Still needs proof in {thread.title}</h2>
          {needsProof.length === 0 ? (
            <p className="mt-3 text-sm text-emerald-700 dark:text-emerald-300">Every entry in this thread is verified.</p>
          ) : (
            <ul aria-label="Needs proof" className="mt-3 space-y-2">
              {needsProof.map((r) => (
                <li key={r.id} className="flex items-center justify-between gap-3">
                  <span className="min-w-0">
                    <span className="block truncate text-sm text-slate-800 dark:text-slate-200">{r.entry.title}</span>
                    <EvidenceBadge status={evidenceStatus(r)} />
                  </span>
                  <button
                    type="button"
                    aria-label={`Strengthen ${r.entry.title}`}
                    onClick={() => onStrengthen(r.id)}
                    className="inline-flex flex-shrink-0 items-center gap-1 text-xs font-medium text-vermilion-600 hover:underline dark:text-vermilion-400"
                  >
                    Strengthen <ArrowRight className="h-3 w-3" aria-hidden="true" />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
};
