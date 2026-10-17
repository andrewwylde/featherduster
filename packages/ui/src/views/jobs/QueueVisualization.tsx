import { useEffect, useState } from 'react';
import {
  Activity,
  AlertCircle,
  CheckCircle2,
  Clock,
  Layers,
  Play,
  Sparkles,
  XCircle,
} from 'lucide-react';
import type { Attempt, Job } from '@featherduster/core';
import { apiClient } from '../../api/client.js';
import { useIntentKey } from '../../hooks/useJobsData.js';
import { isNeedsInput } from './job-utils.js';
import { secondaryButton } from '../tailoring/ui.js';

export const PIPELINE_STAGES = [
  { id: 'preflight', label: 'Preflight', desc: 'Verifying runner configuration, compiler dependencies, and baseline inputs.' },
  { id: 'analysis', label: 'Analysis', desc: 'Extracting hard requirements, preferred competencies, and domain vocabulary.' },
  { id: 'alignment', label: 'Alignment', desc: 'Grounding requirements against verified accomplishment ledger entries.' },
  { id: 'proposals', label: 'Proposals', desc: 'Synthesizing tailored bullet revisions with immutable evidence citations.' },
  { id: 'brief', label: 'Brief', desc: 'Assembling candidate interview talking points and defense strategy.' },
  { id: 'deslop', label: 'De-Slop', desc: 'Auditing and stripping AI buzzwords, vague adjectives, and empty hedges.' },
  { id: 'compile', label: 'Compile', desc: 'Typesetting and compiling single-page Typst/LaTeX deliverable.' },
  { id: 'verify', label: 'Verify', desc: 'Inspecting PDF text extraction, metric retention, and page budget.' },
] as const;

function getStageIndex(stage: string | null | undefined): number {
  if (!stage) return 0;
  const idx = PIPELINE_STAGES.findIndex((s) => s.id === stage);
  return idx >= 0 ? idx : 0;
}

function useElapsedTime(startedAt?: string | null): string {
  const [elapsed, setElapsed] = useState<number>(() => {
    if (!startedAt) return 0;
    return Math.max(0, Math.floor((Date.now() - new Date(startedAt).getTime()) / 1000));
  });

  useEffect(() => {
    if (!startedAt) {
      setElapsed(0);
      return;
    }
    const update = () => {
      setElapsed(Math.max(0, Math.floor((Date.now() - new Date(startedAt).getTime()) / 1000)));
    };
    update();
    const timer = setInterval(update, 1000);
    return () => clearInterval(timer);
  }, [startedAt]);

  const mins = Math.floor(elapsed / 60);
  const secs = elapsed % 60;
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}

export interface QueueVisualizationProps {
  activeAttempts: Omit<Attempt, 'owner_token'>[];
  jobs: Job[];
  onRefresh?: () => Promise<void> | void;
  navigate?: (path: string) => void;
}

export function QueueVisualization({
  activeAttempts,
  jobs,
  onRefresh,
  navigate,
}: QueueVisualizationProps) {
  const [busyId, setBusyId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [confirmCancelId, setConfirmCancelId] = useState<string | null>(null);
  const key = useIntentKey();

  const activeAttempt = activeAttempts[0];
  const activeJob = activeAttempt
    ? jobs.find((j) => j.id === activeAttempt.job_id) ?? null
    : null;

  const currentStageIndex = getStageIndex(activeAttempt?.current_stage);
  const currentStageMeta = PIPELINE_STAGES[currentStageIndex];
  const elapsedTimeStr = useElapsedTime(activeAttempt?.started_at);

  const queuedJobs = jobs.filter(
    (j) => j.preparation_state === 'queued' && !isNeedsInput(j)
  );

  const handleCancelJob = async (job: Job) => {
    if (busyId) return;
    setBusyId(job.id);
    setActionError(null);
    try {
      await apiClient.cancelJob(job.id, {
        expected_revision: job.revision,
        idempotency_key: key({ cancel: job.id, revision: job.revision }),
        reason: 'Cancelled by user from queue',
      });
      setConfirmCancelId(null);
      await onRefresh?.();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Failed to cancel job');
    } finally {
      setBusyId(null);
    }
  };

  const handlePrepareNow = async (job: Job) => {
    if (busyId) return;
    setBusyId(job.id);
    setActionError(null);
    try {
      const captured = await apiClient.captureJobInputs(job.id, job.revision);
      const nextRev = captured.input_snapshot ? job.revision + 1 : job.revision;
      await apiClient.prepareJob(job.id, 'prepare', {
        expected_revision: nextRev,
        input_snapshot_id: captured.input_snapshot.id,
        idempotency_key: key({ prepare: job.id, revision: job.revision }),
      });
      await onRefresh?.();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Failed to start preparation');
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="space-y-4 pt-2" aria-label="Queue visualization">
      {/* Action Error Banner */}
      {actionError && (
        <div
          role="alert"
          className="flex items-center justify-between rounded-lg border border-rose-200 bg-rose-50 p-3 text-xs text-rose-800 dark:border-rose-900/50 dark:bg-rose-950/40 dark:text-rose-300"
        >
          <div className="flex items-center gap-2">
            <AlertCircle className="h-4 w-4 shrink-0 text-rose-600" />
            <span>{actionError}</span>
          </div>
          <button
            type="button"
            className="text-xs font-semibold underline text-rose-700 hover:text-rose-900 dark:text-rose-300"
            onClick={() => setActionError(null)}
          >
            Dismiss
          </button>
        </div>
      )}

      {/* 1. Active Task Card */}
      {activeAttempt && activeJob ? (
        <div className="rounded-xl border border-amber-200/80 bg-amber-50/40 dark:border-amber-900/60 dark:bg-amber-950/20 p-4 space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 border-b border-amber-200/60 dark:border-amber-900/40 pb-3">
            <div className="flex items-center gap-2.5">
              <span className="relative flex h-3 w-3">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-amber-400 opacity-75" />
                <span className="relative inline-flex h-3 w-3 rounded-full bg-amber-500" />
              </span>
              <div>
                <span className="text-[10px] font-mono uppercase tracking-widest text-amber-800 dark:text-amber-300 font-bold">
                  Active Worker Task
                </span>
                <h3 className="text-sm font-semibold text-slate-900 dark:text-white flex items-center gap-1.5">
                  <a
                    href={`/jobs/${activeJob.id}`}
                    onClick={(e) => {
                      if (navigate && !e.ctrlKey && !e.metaKey) {
                        e.preventDefault();
                        navigate(`/jobs/${activeJob.id}`);
                      }
                    }}
                    className="hover:text-vermilion-600 dark:hover:text-vermilion-400 hover:underline transition-colors"
                  >
                    {activeJob.company ?? 'Unknown Company'} — {activeJob.role ?? 'Untitled Role'}
                  </a>
                </h3>
              </div>
            </div>

            {/* Metrics & Cancel Active */}
            <div className="flex items-center gap-2 shrink-0">
              <div className="flex items-center gap-1.5 rounded-lg border border-amber-200 dark:border-amber-800/80 bg-white dark:bg-slate-900 px-2.5 py-1 text-xs text-slate-700 dark:text-slate-300">
                <Clock className="h-3 w-3 text-amber-600 dark:text-amber-400" />
                <span className="font-mono font-medium">{elapsedTimeStr}</span>
              </div>

              {activeAttempt.resource_usage.model_calls > 0 && (
                <div className="flex items-center gap-1 rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 px-2 py-1 text-xs text-slate-600 dark:text-slate-400">
                  <Sparkles className="h-3 w-3 text-vermilion-500" />
                  <span>{activeAttempt.resource_usage.model_calls} calls</span>
                </div>
              )}

              {confirmCancelId === activeJob.id ? (
                <div className="flex items-center gap-1.5">
                  <span className="text-xs text-rose-600 font-medium">Cancel active?</span>
                  <button
                    type="button"
                    className="rounded-lg bg-rose-600 px-2.5 py-1 text-xs font-semibold text-white hover:bg-rose-700 disabled:opacity-50"
                    disabled={busyId === activeJob.id}
                    onClick={() => void handleCancelJob(activeJob)}
                  >
                    {busyId === activeJob.id ? 'Cancelling…' : 'Yes, cancel'}
                  </button>
                  <button
                    type="button"
                    className="rounded-lg border border-slate-200 dark:border-slate-700 px-2 py-1 text-xs text-slate-600 hover:text-slate-900 dark:text-slate-400"
                    onClick={() => setConfirmCancelId(null)}
                  >
                    No
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  className="inline-flex items-center gap-1 rounded-lg border border-rose-200 dark:border-rose-900/60 bg-white dark:bg-slate-900 px-2.5 py-1 text-xs font-medium text-rose-700 dark:text-rose-300 hover:bg-rose-50 dark:hover:bg-rose-950/40 transition-colors"
                  onClick={() => setConfirmCancelId(activeJob.id)}
                >
                  <XCircle className="h-3.5 w-3.5 text-rose-500" />
                  <span>Cancel task</span>
                </button>
              )}
            </div>
          </div>

          {/* Current Stage Description */}
          <div className="flex items-start gap-2.5 rounded-lg bg-white/80 dark:bg-slate-900/80 border border-amber-200/50 dark:border-amber-900/40 p-3 text-xs">
            <Activity className="h-4 w-4 text-vermilion-500 shrink-0 mt-0.5 animate-pulse" />
            <div>
              <span className="font-semibold text-slate-800 dark:text-slate-200">
                {currentStageMeta.label}:{' '}
              </span>
              <span className="text-slate-600 dark:text-slate-400">
                {currentStageMeta.desc}
              </span>
            </div>
          </div>

          {/* Pipeline Stage Steps Indicator */}
          <div className="space-y-1.5">
            <span className="text-[10px] font-mono uppercase tracking-wider text-slate-400 font-semibold">
              Pipeline Progress
            </span>
            <div className="grid grid-cols-2 sm:grid-cols-4 md:grid-cols-8 gap-1.5">
              {PIPELINE_STAGES.map((stage, idx) => {
                const isPassed = idx < currentStageIndex;
                const isCurrent = idx === currentStageIndex;

                return (
                  <div
                    key={stage.id}
                    title={`${stage.label}: ${stage.desc}`}
                    className={`flex flex-col items-center justify-center p-2 rounded-lg border text-center transition-all ${
                      isCurrent
                        ? 'border-vermilion-500/80 bg-white dark:bg-slate-900 text-vermilion-700 dark:text-vermilion-400 shadow-sm ring-1 ring-vermilion-400/30'
                        : isPassed
                          ? 'border-emerald-200 dark:border-emerald-900/60 bg-emerald-50/50 dark:bg-emerald-950/20 text-emerald-700 dark:text-emerald-400'
                          : 'border-slate-200/60 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-900/40 text-slate-400'
                    }`}
                  >
                    <div className="flex items-center gap-1 mb-0.5">
                      {isPassed ? (
                        <CheckCircle2 className="h-3 w-3 text-emerald-600 dark:text-emerald-400" />
                      ) : isCurrent ? (
                        <span className="h-2 w-2 rounded-full bg-vermilion-500 animate-pulse" />
                      ) : (
                        <span className="text-[9px] font-mono text-slate-400">{idx + 1}</span>
                      )}
                    </div>
                    <span className="text-[11px] font-medium leading-none truncate max-w-full">
                      {stage.label}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      ) : null}

      {/* 2. Upcoming Queue Section */}
      <div className="space-y-2.5">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Layers className="h-4 w-4 text-slate-500" />
            <h3 className="text-xs font-mono uppercase tracking-wider text-slate-600 dark:text-slate-300 font-semibold">
              Upcoming Queue
            </h3>
            <span className="rounded-full bg-slate-100 dark:bg-slate-800 px-2 py-0.5 text-[10px] font-bold text-slate-600 dark:text-slate-400">
              {queuedJobs.length} {queuedJobs.length === 1 ? 'job' : 'jobs'}
            </span>
          </div>
          {queuedJobs.length > 0 && (
            <span className="text-[11px] text-slate-400">
              Processes automatically in sequence
            </span>
          )}
        </div>

        {queuedJobs.length === 0 ? (
          <div className="rounded-xl border border-dashed border-slate-200 dark:border-slate-800 p-6 text-center text-xs text-slate-500 dark:text-slate-400">
            <p>Queue is empty. Automatic preparation will process newly added jobs as they arrive.</p>
          </div>
        ) : (
          <ul className="space-y-2">
            {queuedJobs.map((job, idx) => (
              <li
                key={job.id}
                className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2.5 rounded-xl border border-slate-200/80 dark:border-slate-800 bg-white dark:bg-slate-900 p-3 hover:border-slate-300 dark:hover:border-slate-700 transition-colors shadow-xs"
              >
                <div className="flex items-center gap-3 min-w-0">
                  <span
                    className={`flex h-6 w-14 shrink-0 items-center justify-center rounded-md text-[10px] font-mono font-bold ${
                      idx === 0
                        ? 'bg-sky-100 text-sky-800 dark:bg-sky-950 dark:text-sky-300 border border-sky-300/60 dark:border-sky-800'
                        : 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400'
                    }`}
                  >
                    {idx === 0 ? '#1 Next' : `#${idx + 1}`}
                  </span>

                  <div className="min-w-0">
                    <h4 className="text-xs font-semibold leading-snug truncate">
                      <a
                        href={`/jobs/${job.id}`}
                        onClick={(e) => {
                          if (navigate && !e.ctrlKey && !e.metaKey) {
                            e.preventDefault();
                            navigate(`/jobs/${job.id}`);
                          }
                        }}
                        className="text-slate-900 dark:text-white hover:text-vermilion-600 dark:hover:text-vermilion-400 hover:underline transition-colors"
                      >
                        {job.company ?? 'Unknown company'} — {job.role ?? 'Untitled role'}
                      </a>
                    </h4>
                    <p className="text-[11px] text-slate-400 truncate">
                      Imported {new Date(job.created_at).toLocaleDateString(undefined, {
                        month: 'short',
                        day: 'numeric',
                        hour: '2-digit',
                        minute: '2-digit',
                      })}
                    </p>
                  </div>
                </div>

                {/* Queue Item Actions */}
                <div className="flex items-center gap-2 self-end sm:self-center shrink-0">
                  <button
                    type="button"
                    className={`${secondaryButton} text-xs py-1 px-2.5 min-h-[36px] sm:min-h-0`}
                    disabled={busyId === job.id}
                    title="Jump queue and prepare this job immediately"
                    onClick={() => void handlePrepareNow(job)}
                  >
                    <Play className="h-3 w-3 fill-current text-slate-600 dark:text-slate-300" />
                    <span>Prepare now</span>
                  </button>

                  {confirmCancelId === job.id ? (
                    <div className="flex items-center gap-1">
                      <span className="text-[11px] text-rose-600">Cancel?</span>
                      <button
                        type="button"
                        className="rounded-md bg-rose-600 px-2 py-1 text-[11px] font-semibold text-white hover:bg-rose-700 disabled:opacity-50"
                        disabled={busyId === job.id}
                        onClick={() => void handleCancelJob(job)}
                      >
                        Yes
                      </button>
                      <button
                        type="button"
                        className="rounded-md border border-slate-200 dark:border-slate-700 px-1.5 py-1 text-[11px] text-slate-600"
                        onClick={() => setConfirmCancelId(null)}
                      >
                        No
                      </button>
                    </div>
                  ) : (
                    <button
                      type="button"
                      className="inline-flex items-center gap-1 rounded-md border border-slate-200 dark:border-slate-700 px-2 py-1 text-xs text-slate-500 hover:text-rose-600 dark:hover:text-rose-400 hover:border-rose-200 dark:hover:border-rose-900/60 transition-colors"
                      title="Cancel and remove this job from queue"
                      onClick={() => setConfirmCancelId(job.id)}
                    >
                      <XCircle className="h-3.5 w-3.5" />
                      <span>Cancel</span>
                    </button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
