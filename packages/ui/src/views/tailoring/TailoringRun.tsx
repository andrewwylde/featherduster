import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, CheckCircle2, Cloud, ExternalLink, HardDrive, Loader2, Play, RotateCcw, ShieldCheck, Square } from 'lucide-react';
import type { AlignmentMatrix, EvidenceRecord, JobAnalysis, Proposal, TailoringStep } from '@featherduster/core';
import {
  ApiError,
  apiClient,
  type FinalizeResponse,
  type RunnerId,
  type TailoringEvent,
  type TailoringRunDetail,
} from '../../api/client';
import { useTailoringEvents } from '../../hooks/useTailoringEvents';
import { useModalA11y } from '../../hooks/useModalA11y';
import { AnalysisStep } from './steps/AnalysisStep';
import { AlignmentStep } from './steps/AlignmentStep';
import { ProposalsStep } from './steps/ProposalsStep';
import { BriefMarkdown } from './steps/BriefStep';
import { StatusPill, cardClass, eyebrowClass, primaryButton, secondaryButton, stateLabel } from './ui';

interface TailoringRunProps {
  slug: string;
  onBack: () => void;
  onOpenInCanvas: (resumeId: string) => void;
}

const STEPS: Array<{ id: TailoringStep; title: string; blurb: string; next: string }> = [
  { id: 'analysis', title: 'Break down the posting', blurb: 'Must-haves, nice-to-haves, and company vocabulary, each quoted from the posting.', next: 'Approve & match evidence' },
  { id: 'alignment', title: 'Match your evidence', blurb: 'Each requirement rated backed, transferable, or gap against your ledger.', next: 'Approve & draft edits' },
  { id: 'proposals', title: 'Review cited edits', blurb: 'Typed resume edits, each checked against the Ledger Ceiling, metrics, slop, and page budget.', next: 'Approve edits & write brief' },
  { id: 'brief', title: 'Defensibility brief', blurb: 'Anchor stories, honest bridges for transferable skills, and how to address gaps.', next: '' },
];

const NEXT_STEP: Partial<Record<TailoringStep, TailoringStep>> = { analysis: 'alignment', alignment: 'proposals', proposals: 'brief' };

function escapeRegExp(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

const PostingWithHighlight: React.FC<{ posting: string; highlight: string | null }> = ({ posting, highlight }) => {
  const markRef = useRef<HTMLElement | null>(null);
  useEffect(() => {
    markRef.current?.scrollIntoView?.({ block: 'center', behavior: 'smooth' });
  }, [highlight]);
  if (!highlight) return <>{posting}</>;
  const pattern = highlight.trim().split(/\s+/).map(escapeRegExp).join('\\s+');
  const match = new RegExp(pattern, 'i').exec(posting);
  if (!match) return <>{posting}</>;
  return (
    <>
      {posting.slice(0, match.index)}
      <mark ref={markRef} className="rounded-sm bg-amber-200 text-slate-900 dark:bg-amber-500/40 dark:text-white">
        {match[0]}
      </mark>
      {posting.slice(match.index + match[0].length)}
    </>
  );
};

export const TailoringRun: React.FC<TailoringRunProps> = ({ slug, onBack, onOpenInCanvas }) => {
  const [detail, setDetail] = useState<TailoringRunDetail | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [activeStep, setActiveStep] = useState<TailoringStep | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [statusLine, setStatusLine] = useState<string>('');
  const [tokenTail, setTokenTail] = useState<string>('');
  const [runningSince, setRunningSince] = useState<number | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const [dirty, setDirty] = useState(false);
  const [highlight, setHighlight] = useState<string | null>(null);
  const [evidence, setEvidence] = useState<EvidenceRecord[]>([]);
  const [evidenceFocus, setEvidenceFocus] = useState<string | null>(null);
  const [consent, setConsent] = useState<{ runner: RunnerId; step: TailoringStep; preview: string; label: string } | null>(null);
  const [finalized, setFinalized] = useState<FinalizeResponse | null>(null);
  const [mobilePane, setMobilePane] = useState<'steps' | 'work' | 'context'>('work');

  const consentRef = useRef<HTMLDivElement | null>(null);
  useModalA11y({ isOpen: !!consent, onClose: () => setConsent(null), containerRef: consentRef });

  const refresh = useCallback(async () => {
    try {
      const next = await apiClient.getTailoringRun(slug);
      setDetail(next);
      setLoadError(null);
      return next;
    } catch (err: any) {
      setLoadError(err?.message || 'Failed to load run');
      return null;
    }
  }, [slug]);

  useEffect(() => {
    setDetail(null);
    setActiveStep(null);
    setFinalized(null);
    refresh();
    apiClient.getEvidence().then(setEvidence).catch(() => undefined);
  }, [refresh]);

  const manifest = detail?.manifest;

  useEffect(() => {
    setDirty(false);
  }, [activeStep]);
  const runningStep = manifest ? STEPS.find((s) => manifest.steps[s.id].status === 'running')?.id ?? null : null;

  // Default the active step to the first step that isn't approved yet.
  useEffect(() => {
    if (!manifest || activeStep) return;
    const firstOpen = STEPS.find((s) => manifest.steps[s.id].status !== 'approved');
    setActiveStep(firstOpen?.id ?? 'brief');
  }, [manifest, activeStep]);

  useEffect(() => {
    if (runningStep) {
      setRunningSince((prev) => prev ?? Date.now());
    } else {
      setRunningSince(null);
      setTokenTail('');
    }
  }, [runningStep]);

  useEffect(() => {
    if (!runningSince) return;
    const timer = setInterval(() => setElapsed(Math.round((Date.now() - runningSince) / 1000)), 1000);
    return () => clearInterval(timer);
  }, [runningSince]);

  useTailoringEvents(
    useMemo(
      () => ({
        onEvent: (evt: TailoringEvent) => {
          if (evt.slug !== slug) return;
          if (evt.kind === 'status' && evt.text) setStatusLine(evt.text);
          if (evt.kind === 'token' && evt.text) setTokenTail((prev) => (prev + evt.text).slice(-600));
          if (evt.kind === 'state') refresh();
        },
        onFileChange: (rel: string) => {
          if (rel.replace(/\\/g, '/').startsWith(`tailoring/${slug}/`)) refresh();
        },
      }),
      [slug, refresh]
    )
  );

  // Poll while a step runs in case the event stream is unavailable.
  useEffect(() => {
    if (!runningStep) return;
    const timer = setInterval(refresh, 2000);
    return () => clearInterval(timer);
  }, [runningStep, refresh]);

  const guard = async <T,>(label: string, fn: () => Promise<T>): Promise<T | undefined> => {
    setBusy(label);
    setActionError(null);
    try {
      return await fn();
    } catch (err: any) {
      if (err instanceof ApiError && err.code === 'consent_required' && manifest) {
        const step = (label.split(':')[1] as TailoringStep) ?? 'analysis';
        try {
          const preview = await apiClient.previewTailoringStep(slug, step);
          setConsent({ runner: manifest.runner as RunnerId, step, preview: preview.prompt, label: preview.runner });
        } catch {
          setActionError(err.message);
        }
      } else {
        setActionError(err?.message || 'Something went wrong');
      }
      return undefined;
    } finally {
      setBusy(null);
    }
  };

  const runStep = (step: TailoringStep) =>
    guard(`run:${step}`, async () => {
      setStatusLine('Starting…');
      setTokenTail('');
      setElapsed(0);
      await apiClient.runTailoringStep(slug, step);
      setActiveStep(step);
      await refresh();
    });

  const approveAndContinue = async (step: TailoringStep) => {
    const approved = await guard(`approve:${step}`, async () => {
      await apiClient.approveTailoringStep(slug, step);
      await refresh();
      return true;
    });
    const next = NEXT_STEP[step];
    if (approved && next) {
      setActiveStep(next);
      await runStep(next);
    }
  };

  const save = (step: TailoringStep, data: unknown) =>
    guard(`save:${step}`, async () => {
      const next = await apiClient.saveTailoringStep(slug, step, data);
      setDetail(next);
    });

  const grantConsentAndRun = async () => {
    if (!consent) return;
    const { runner, step } = consent;
    setConsent(null);
    await guard(`consent:${step}`, () => apiClient.grantRunnerConsent(runner));
    await runStep(step);
  };

  const finalize = () =>
    guard('finalize', async () => {
      setFinalized(await apiClient.finalizeTailoringRun(slug));
      await refresh();
    });

  if (loadError && !detail) {
    return (
      <div role="alert" className="rounded-desk border border-rose-200 bg-rose-50 p-6 text-rose-900 dark:border-rose-900/50 dark:bg-rose-950/20 dark:text-rose-200">
        <p className="font-semibold">This run could not load.</p>
        <p className="mt-1 text-sm">{loadError}</p>
        <div className="mt-4 flex gap-2">
          <button type="button" className={secondaryButton} onClick={refresh}>Try again</button>
          <button type="button" className={secondaryButton} onClick={onBack}>Back to runs</button>
        </div>
      </div>
    );
  }
  if (!detail || !manifest || !activeStep) {
    return <p className="text-sm text-slate-500">Loading run…</p>;
  }

  const stepMeta = STEPS.find((s) => s.id === activeStep)!;
  const record = manifest.steps[activeStep];
  const prev = STEPS[STEPS.findIndex((s) => s.id === activeStep) - 1];
  const prevApproved = !prev || manifest.steps[prev.id].status === 'approved';
  const isRunning = record.status === 'running';
  const anyRunning = !!runningStep;
  const readOnly = record.status === 'approved' || anyRunning;
  const hasOutput = ['done', 'approved', 'stale'].includes(record.status);
  const evidenceOptions = evidence.map((e) => ({ id: e.id, title: e.title }));
  const focused = evidenceFocus ? evidence.find((e) => e.id === evidenceFocus) : null;
  const pendingDecisions = detail.proposals?.filter((p) => p.decision === 'pending').length ?? 0;
  const tailoredResumeId = `tailored-${slug}`;

  const approveDisabledReason =
    record.status !== 'done'
      ? null
      : dirty
      ? 'Save your edits first'
      : activeStep === 'alignment' && detail.alignment?.rows.some((r) => r.issues?.some((i) => i.severity === 'block'))
      ? 'Resolve blocking issues first'
      : activeStep === 'proposals' && pendingDecisions > 0
      ? `Decide on ${pendingDecisions} pending edit(s)`
      : null;

  const stepper = (
    <nav aria-label="Tailoring steps" className={`${cardClass} p-3`}>
      <ol className="space-y-1">
        {STEPS.map((s, i) => {
          const st = manifest.steps[s.id];
          const active = s.id === activeStep;
          return (
            <li key={s.id}>
              <button
                type="button"
                onClick={() => {
                  setActiveStep(s.id);
                  setMobilePane('work');
                }}
                aria-current={active ? 'step' : undefined}
                className={`flex w-full items-start gap-2.5 rounded-desk px-2.5 py-2 text-left transition-colors ${
                  active ? 'bg-vermilion-50/70 dark:bg-vermilion-950/25' : 'hover:bg-slate-100/70 dark:hover:bg-slate-800/40'
                }`}
              >
                <span
                  className={`mt-0.5 flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full text-[11px] font-bold ${
                    st.status === 'approved'
                      ? 'bg-emerald-600 text-white'
                      : active
                      ? 'bg-vermilion-500 text-white'
                      : 'bg-slate-200 text-slate-600 dark:bg-slate-800 dark:text-slate-300'
                  }`}
                  aria-hidden="true"
                >
                  {st.status === 'approved' ? '✓' : i + 1}
                </span>
                <span className="min-w-0 flex-1">
                  <span className={`block text-sm ${active ? 'font-semibold text-slate-900 dark:text-white' : 'text-slate-700 dark:text-slate-300'}`}>
                    {s.title}
                  </span>
                  <span className="mt-0.5 block">
                    <StatusPill status={s.id === 'brief' && st.status === 'done' ? 'complete' : st.status} />
                  </span>
                </span>
              </button>
            </li>
          );
        })}
      </ol>
      <p className="mt-3 border-t border-slate-100 px-2.5 pt-3 text-[11px] leading-relaxed text-slate-500 dark:border-slate-800">
        Runner: <span className="font-medium text-slate-700 dark:text-slate-300">{manifest.runner}</span>
        {manifest.model && <> · {manifest.model}</>}
      </p>
    </nav>
  );

  const contextPane = (
    <aside aria-label="Context" className={`${cardClass} p-4`}>
      {focused ? (
        <div>
          <div className="flex items-center justify-between">
            <span className="font-mono text-xs text-slate-500">{focused.id}</span>
            <button type="button" onClick={() => setEvidenceFocus(null)} className="text-xs text-slate-500 hover:text-slate-800 dark:hover:text-slate-200">
              Back to posting
            </button>
          </div>
          <h3 className="mt-1 font-semibold text-slate-900 dark:text-white">{focused.title}</h3>
          <p className="mt-0.5 text-xs text-slate-500">
            {focused.company} · {focused.date} · {focused.entry.confidence}
          </p>
          <p className="mt-2 text-sm text-slate-700 dark:text-slate-300">{focused.summary}</p>
          <p className="mt-2 text-sm font-medium text-slate-800 dark:text-slate-200">{focused.impact}</p>
          {focused.entry.metrics.length > 0 && (
            <ul className="mt-2 space-y-0.5 text-xs text-slate-600 dark:text-slate-400">
              {focused.entry.metrics.map((m) => (
                <li key={m.name}>
                  {m.name}: <span className="font-mono">{m.value}</span> ({m.status})
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : evidenceFocus ? (
        <p className="text-sm text-slate-500">Evidence {evidenceFocus} not found in the ledger.</p>
      ) : (
        <div>
          <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500">Job posting</h3>
          <div className="mt-2 max-h-[70vh] overflow-y-auto whitespace-pre-wrap text-sm leading-relaxed text-slate-700 dark:text-slate-300">
            <PostingWithHighlight posting={detail.posting} highlight={highlight} />
          </div>
        </div>
      )}
    </aside>
  );

  const workPane = (
    <section aria-labelledby="step-title" className={`${cardClass} p-5 lg:p-6`}>
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-100 pb-4 dark:border-slate-800/80">
        <div>
          <h2 id="step-title" className="text-lg font-bold text-slate-900 dark:text-white">
            {stepMeta.title}
          </h2>
          <p className="mt-0.5 text-sm text-slate-600 dark:text-slate-400">{stepMeta.blurb}</p>
        </div>
        <StatusPill status={activeStep === 'brief' && record.status === 'done' ? 'complete' : record.status} />
      </div>

      {record.status === 'stale' && (
        <p className="mt-4 rounded-desk bg-orange-50 px-3 py-2 text-sm text-orange-900 dark:bg-orange-950/30 dark:text-orange-200">
          An earlier step changed after this output was produced. Re-run this step to bring it up to date.
        </p>
      )}
      {record.status === 'error' && record.error && (
        <div role="alert" className="mt-4 rounded-desk bg-rose-50 px-3 py-2 text-sm text-rose-900 dark:bg-rose-950/30 dark:text-rose-200">
          <p className="whitespace-pre-wrap">{record.error}</p>
          {record.raw_output && (
            <details className="mt-2">
              <summary className="cursor-pointer text-xs">Raw model output</summary>
              <pre className="mt-1 max-h-48 overflow-auto whitespace-pre-wrap text-xs">{record.raw_output}</pre>
            </details>
          )}
        </div>
      )}
      {manifest.state === 'cancelled' && record.status !== 'running' && (
        <p className="mt-4 text-sm text-slate-600 dark:text-slate-400">The last model call was cancelled.</p>
      )}
      {actionError && (
        <p role="alert" className="mt-4 rounded-desk bg-rose-50 px-3 py-2 text-sm text-rose-900 dark:bg-rose-950/30 dark:text-rose-200">
          {actionError}
        </p>
      )}

      <div className="mt-5">
        {isRunning ? (
          <div className="space-y-3" aria-live="polite">
            <p className="flex items-center gap-2 text-sm font-medium text-slate-800 dark:text-slate-200">
              <Loader2 className="h-4 w-4 animate-spin text-vermilion-500" aria-hidden="true" />
              {statusLine || 'Working…'} <span className="font-normal text-slate-500">{elapsed}s</span>
            </p>
            {tokenTail && (
              <pre className="max-h-40 overflow-hidden whitespace-pre-wrap rounded-desk bg-slate-50 p-3 font-mono text-xs text-slate-600 dark:bg-slate-900/60 dark:text-slate-400">
                {tokenTail}
              </pre>
            )}
            <button type="button" className={secondaryButton} onClick={() => guard('cancel', () => apiClient.cancelTailoringRun(slug))}>
              <Square className="h-3.5 w-3.5" aria-hidden="true" /> Cancel
            </button>
          </div>
        ) : !hasOutput ? (
          <div className="py-6 text-center">
            <p className="text-sm text-slate-600 dark:text-slate-400">
              {prevApproved ? 'This step has not run yet.' : `Approve “${prev?.title}” first.`}
            </p>
            {prevApproved && (
              <button type="button" className={`${primaryButton} mt-4`} disabled={anyRunning || !!busy} onClick={() => runStep(activeStep)}>
                <Play className="h-4 w-4" aria-hidden="true" /> Run {stepMeta.title.toLowerCase()}
              </button>
            )}
          </div>
        ) : activeStep === 'analysis' && detail.analysis ? (
          <AnalysisStep
            analysis={detail.analysis}
            readOnly={readOnly}
            saving={busy === 'save:analysis'}
            onDirtyChange={setDirty}
            onSave={(a: JobAnalysis) => save('analysis', a)}
            onHighlightQuote={(q) => {
              setEvidenceFocus(null);
              setHighlight(q);
            }}
          />
        ) : activeStep === 'alignment' && detail.alignment && detail.analysis ? (
          <AlignmentStep
            analysis={detail.analysis}
            alignment={detail.alignment}
            evidenceOptions={evidenceOptions}
            readOnly={readOnly}
            saving={busy === 'save:alignment'}
            onDirtyChange={setDirty}
            onSave={(a: AlignmentMatrix) => save('alignment', a)}
            onOpenEvidence={setEvidenceFocus}
          />
        ) : activeStep === 'proposals' && detail.proposals ? (
          <ProposalsStep
            proposals={detail.proposals}
            baseResume={detail.base_resume}
            analysis={detail.analysis}
            pageBudget={detail.page_budget}
            readOnly={readOnly}
            saving={busy === 'save:proposals'}
            onSave={(p: Proposal[]) => save('proposals', { proposals: p })}
            onOpenEvidence={setEvidenceFocus}
          />
        ) : activeStep === 'brief' && detail.brief_markdown ? (
          <div className="space-y-5">
            <BriefMarkdown markdown={detail.brief_markdown} />
            <div className="rounded-desk border border-slate-200 p-4 dark:border-slate-800">
              <h3 className="flex items-center gap-2 text-sm font-semibold text-slate-900 dark:text-white">
                <ShieldCheck className="h-4 w-4 text-vermilion-500" aria-hidden="true" /> Save the tailored resume
              </h3>
              <p className="mt-1 text-xs text-slate-600 dark:text-slate-400">
                Writes <span className="font-mono">resumes/tailored/{slug}.yaml</span> and runs the pre-flight integrity audit.
              </p>
              {finalized && (
                <div className="mt-3 text-sm" aria-live="polite">
                  <p className={`flex items-center gap-1.5 font-medium ${finalized.preflight.isClean ? 'text-emerald-700 dark:text-emerald-300' : 'text-amber-800 dark:text-amber-300'}`}>
                    <CheckCircle2 className="h-4 w-4" aria-hidden="true" />
                    Saved to {finalized.filePath}. {finalized.preflight.isClean ? 'Pre-flight clean.' : 'Pre-flight found issues to review.'}
                  </p>
                  {!finalized.preflight.isClean && (
                    <ul className="mt-1 list-disc pl-5 text-xs text-slate-700 dark:text-slate-300">
                      {finalized.preflight.danglingCitations.length > 0 && <li>Dangling citations: {finalized.preflight.danglingCitations.join(', ')}</li>}
                      {finalized.preflight.metricIssues.length > 0 && <li>{finalized.preflight.metricIssues.length} metric issue(s)</li>}
                      {finalized.preflight.violations.length > 0 && <li>Banned keywords: {finalized.preflight.violations.join(', ')}</li>}
                    </ul>
                  )}
                </div>
              )}
              <div className="mt-3 flex flex-wrap gap-2">
                <button type="button" className={primaryButton} disabled={!!busy || anyRunning} onClick={finalize}>
                  {busy === 'finalize' ? 'Saving…' : finalized ? 'Save again' : 'Save resume'}
                </button>
                {(finalized || manifest.finalized_path) && (
                  <button type="button" className={secondaryButton} onClick={() => onOpenInCanvas(tailoredResumeId)}>
                    <ExternalLink className="h-4 w-4" aria-hidden="true" /> Open in canvas
                  </button>
                )}
              </div>
            </div>
          </div>
        ) : null}
      </div>

      {hasOutput && !isRunning && (
        <div className="sticky bottom-0 -mx-5 -mb-5 mt-6 flex flex-wrap items-center justify-end gap-2 border-t border-slate-100 bg-white/95 p-3.5 backdrop-blur pb-safe dark:border-slate-800/80 dark:bg-[#121622]/95 sm:static sm:mx-0 sm:mb-0 sm:p-0 sm:pt-4 sm:bg-transparent sm:backdrop-none z-10">
          {approveDisabledReason && <span className="mr-auto text-xs text-slate-500">{approveDisabledReason}</span>}
          {prevApproved && (
            <button type="button" className={`${secondaryButton} min-h-[44px] sm:min-h-0`} disabled={anyRunning || !!busy} onClick={() => runStep(activeStep)}>
              <RotateCcw className="h-4 w-4" aria-hidden="true" /> Re-run
            </button>
          )}
          {record.status === 'done' && stepMeta.next && (
            <button
              type="button"
              className={`${primaryButton} min-h-[44px] sm:min-h-0`}
              disabled={!!approveDisabledReason || !!busy || anyRunning}
              onClick={() => approveAndContinue(activeStep)}
            >
              {stepMeta.next}
            </button>
          )}
          {record.status === 'approved' && NEXT_STEP[activeStep] && (
            <button type="button" className={`${secondaryButton} min-h-[44px] sm:min-h-0`} onClick={() => setActiveStep(NEXT_STEP[activeStep]!)}>
              Next step
            </button>
          )}
        </div>
      )}
    </section>
  );

  return (
    <div className="space-y-5">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <button type="button" onClick={onBack} className="mb-2 inline-flex items-center gap-1 text-xs text-slate-500 hover:text-slate-800 dark:hover:text-slate-200">
            <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" /> All runs
          </button>
          <span className={`${eyebrowClass} block`}>Tailoring run</span>
          <h1 className="mt-1 text-2xl font-bold tracking-tight text-slate-900 dark:text-white">{manifest.title || slug}</h1>
          <p className="mt-1 text-sm text-slate-600 dark:text-slate-400" aria-live="polite">
            {stateLabel(manifest.state)}
          </p>
        </div>
      </header>

      {/* Narrow screens: tabs between panes */}
      <div role="tablist" aria-label="Run panes" className="sticky top-14 sm:top-16 z-20 flex gap-1 rounded-desk bg-slate-100/95 p-1 backdrop-blur dark:bg-slate-900/95 lg:hidden shadow-sm">
        {(['steps', 'work', 'context'] as const).map((pane) => (
          <button
            key={pane}
            role="tab"
            type="button"
            aria-selected={mobilePane === pane}
            onClick={() => setMobilePane(pane)}
            className={`flex-1 rounded-md px-3 py-2 text-sm capitalize min-h-[44px] flex items-center justify-center transition-colors ${
              mobilePane === pane ? 'bg-white font-semibold text-slate-900 shadow-sm dark:bg-slate-800 dark:text-white' : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
            }`}
          >
            {pane === 'work' ? 'Current step' : pane}
          </button>
        ))}
      </div>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-12">
        <div className={`${mobilePane === 'steps' ? 'block' : 'hidden'} lg:col-span-3 lg:block`}>{stepper}</div>
        <div className={`${mobilePane === 'work' ? 'block' : 'hidden'} lg:col-span-6 lg:block`}>{workPane}</div>
        <div className={`${mobilePane === 'context' ? 'block' : 'hidden'} lg:col-span-3 lg:block`}>{contextPane}</div>
      </div>

      {consent && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 p-4">
          <div
            ref={consentRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby="consent-title"
            className="w-full max-w-2xl rounded-desk border border-slate-200 bg-white p-6 shadow-xl dark:border-slate-800 dark:bg-[#121622]"
          >
            <h2 id="consent-title" className="flex items-center gap-2 text-lg font-bold text-slate-900 dark:text-white">
              {consent.label === 'Ollama' ? <HardDrive className="h-5 w-5" aria-hidden="true" /> : <Cloud className="h-5 w-5" aria-hidden="true" />}
              Send redacted evidence to {consent.label}?
            </h2>
            <p className="mt-2 text-sm leading-relaxed text-slate-600 dark:text-slate-300">
              This runner calls a cloud model. Before anything is sent, your privacy rules strip ticket IDs, replace confidential
              names, and block banned keywords. Evidence IDs are kept so edits stay cited. Below is exactly what this step sends.
              You'll only be asked once per runner in this workspace.
            </p>
            <pre className="mt-3 max-h-72 overflow-auto whitespace-pre-wrap rounded-desk bg-slate-50 p-3 font-mono text-xs text-slate-700 dark:bg-slate-900/60 dark:text-slate-300">
              {consent.preview}
            </pre>
            <div className="mt-4 flex justify-end gap-2">
              <button type="button" className={secondaryButton} onClick={() => setConsent(null)}>
                Not now
              </button>
              <button type="button" className={primaryButton} onClick={grantConsentAndRun}>
                Allow & run
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
