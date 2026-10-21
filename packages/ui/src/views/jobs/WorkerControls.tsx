import { useCallback, useRef, useState } from 'react';
import { Play, Pause, Square, AlertCircle, RefreshCw, Cpu, Layers, ChevronDown, ChevronUp } from 'lucide-react';
import type { Job } from '@featherduster/core';
import { apiClient } from '../../api/client.js';
import { useIntentKey, useJobsData } from '../../hooks/useJobsData.js';
import { cardClass, primaryButton, secondaryButton } from '../tailoring/ui.js';
import { QueueVisualization } from './QueueVisualization.js';
import { isNeedsInput, pluralize, preparationDestination } from './job-utils.js';

export interface WorkerControlsProps {
  jobs?: Job[];
  onJobMutated?: () => void;
  navigate?: (path: string) => void;
}

export function WorkerControls({
  jobs = [],
  onJobMutated,
  navigate,
}: WorkerControlsProps = {}) {
  const load = useCallback(() => apiClient.getJobsControl(), []);
  const { data, error, refresh } = useJobsData(load);
  const [failure, setFailure] = useState<string | null>(null);
  const [pending, setPending] = useState<string[]>([]);
  const [showQueue, setShowQueue] = useState(false);
  const [reviewJobs, setReviewJobs] = useState<Job[] | null>(null);
  const [reviewLinks, setReviewLinks] = useState<Record<string, { batch_id: string; state: string }>>({});
  const [loadingReviews, setLoadingReviews] = useState(false);
  const openReviews = async () => {
    setLoadingReviews(true); setFailure(null);
    try { const result = await apiClient.getJobs(); setReviewJobs(result.jobs.filter(isNeedsInput)); setReviewLinks(result.preparation_links ?? {}); }
    catch (e) { setFailure(e instanceof Error ? e.message : 'Could not load jobs needing review.'); }
    finally { setLoadingReviews(false); }
  };
  const inflight = useRef(new Set<string>());
  const key = useIntentKey();

  const queuedCount = jobs.filter(
    (j) => j.preparation_state === 'queued' && !isNeedsInput(j)
  ).length;

  const act = async (action: 'start' | 'pause' | 'stop') => {
    if (inflight.current.has(action)) return;
    inflight.current.add(action);
    setPending([...inflight.current]);
    setFailure(null);
    try {
      await apiClient.controlJobs(action, key({ action, revision: data?.control.revision }));
      await refresh();
      onJobMutated?.();
    } catch (e) {
      setFailure(e instanceof Error ? e.message : 'Control request failed');
    } finally {
      inflight.current.delete(action);
      setPending([...inflight.current]);
    }
  };

  const isProcessing = Boolean(data?.active.length);
  const isStopped = Boolean(data?.control.stopped_at || !data?.control.automatic_preparation_enabled);
  // Start only changes something when automatic work is off, stopped or set to pause.
  const automaticOn = Boolean(data && data.control.automatic_preparation_enabled && !data.control.stopped_at && !data.control.pause_after_current);
  // Nothing to stop once the worker is stopped and idle, unless a Start is still in flight.
  const nothingToStop = Boolean(data?.control.stopped_at && !isProcessing && !pending.includes('start'));
  const status = error
    ? 'Host unavailable'
    : !data
      ? 'Loading worker…'
      : isProcessing
        ? 'Processing'
        : data.control.stopped_at
          ? 'Stopped'
          : data.needs_review_count ? `Idle — ${pluralize(data.needs_review_count, 'job needs', 'jobs need')} review` : 'Idle';

  const getBadgeStyle = () => {
    if (error) {
      return 'bg-rose-50 text-rose-700 dark:bg-rose-950/50 dark:text-rose-300 border-rose-200 dark:border-rose-900/60';
    }
    if (!data) {
      return 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400 border-slate-200 dark:border-slate-700';
    }
    if (isProcessing) {
      return 'bg-amber-50 text-amber-700 dark:bg-amber-950/50 dark:text-amber-300 border-amber-200 dark:border-amber-900/60';
    }
    if (isStopped) {
      return 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300 border-slate-200 dark:border-slate-700';
    }
    return 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300 border-emerald-200 dark:border-emerald-900/60';
  };

  const getDot = () => {
    if (error) {
      return <span className="h-2 w-2 rounded-full bg-rose-500" />;
    }
    if (!data) {
      return <RefreshCw className="h-3 w-3 animate-spin text-slate-400" />;
    }
    if (isProcessing) {
      return (
        <span className="relative flex h-2 w-2">
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-amber-400 opacity-75" />
          <span className="relative inline-flex h-2 w-2 rounded-full bg-amber-500" />
        </span>
      );
    }
    if (isStopped) {
      return <span className="h-2 w-2 rounded-full bg-slate-400" />;
    }
    return <span className="h-2 w-2 rounded-full bg-emerald-500" />;
  };

  return (
    <section
      aria-label="Worker controls"
      className={`${cardClass} p-4 transition-all duration-150`}
    >
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300">
            <Cpu className="h-5 w-5" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className="text-xs font-mono uppercase tracking-wider text-slate-500 dark:text-slate-400">
                Background Worker
              </span>
              <span
                role="status"
                className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-semibold ${getBadgeStyle()}`}
              >
                {getDot()}
                {status}
                {data?.control.pause_after_current ? ' — Pause after current requested' : ''}
              </span>
            </div>
          </div>
        </div>

        {/* Action Controls */}
        <div className="flex flex-wrap items-center gap-2">
          {!!data?.needs_review_count && <button className={primaryButton} disabled={loadingReviews} onClick={() => void openReviews()}>
            {loadingReviews ? 'Loading reviews…' : 'Review jobs'}
          </button>}
          <details><summary className="cursor-pointer text-xs underline">Automatic work controls</summary><div className="flex flex-wrap gap-2">
          {/* Start Button */}
          <button
            className={`${isStopped ? primaryButton : secondaryButton} text-xs font-medium min-h-[44px] sm:min-h-0 sm:py-1.5`}
            disabled={!data || pending.length > 0 || automaticOn}
            onClick={() => void act('start')}
          >
            <Play className="h-3.5 w-3.5 fill-current" />
            Start automatic preparation
          </button>
          {automaticOn && <p className="self-center text-xs text-slate-600 dark:text-slate-400">Automatic preparation is on.</p>}

          {/* Pause Button */}
          <button
            className={`${secondaryButton} text-xs font-medium min-h-[44px] sm:min-h-0 sm:py-1.5`}
            disabled={!data || pending.length > 0 || !automaticOn}
            onClick={() => void act('pause')}
          >
            <Pause className="h-3.5 w-3.5" />
            Pause after current
          </button>

          </div></details>
          {/* Stop Button */}
          <button
            className="inline-flex items-center justify-center gap-1.5 rounded-desk border border-rose-200 dark:border-rose-900/60 bg-rose-50/50 dark:bg-rose-950/20 px-3 py-1.5 min-h-[44px] sm:min-h-0 text-xs font-medium text-rose-700 dark:text-rose-300 hover:bg-rose-100 dark:hover:bg-rose-900/40 disabled:cursor-not-allowed disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-500"
            disabled={!data || pending.includes('stop') || nothingToStop}
            onClick={() => void act('stop')}
          >
            <Square className="h-3.5 w-3.5 fill-current" />
            Stop processing
          </button>

          {/* Queue View Toggle */}
          <button
            type="button"
            className="inline-flex items-center justify-center gap-1.5 rounded-desk border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-1.5 min-h-[44px] sm:min-h-0 text-xs font-medium text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-vermilion-500"
            onClick={() => setShowQueue(!showQueue)}
            aria-expanded={showQueue}
            title={showQueue ? 'Hide queue visualization' : 'Show queue visualization'}
          >
            <Layers className="h-3.5 w-3.5 text-slate-500" />
            <span>
              Queue ({isProcessing ? '1 active' : queuedCount === 0 ? 'empty' : `${queuedCount} queued`})
            </span>
            {showQueue ? (
              <ChevronUp className="h-3.5 w-3.5 text-slate-400" />
            ) : (
              <ChevronDown className="h-3.5 w-3.5 text-slate-400" />
            )}
          </button>
        </div>
      </div>

      {reviewJobs && <section aria-label="Jobs needing review" className="mt-4 space-y-2">
        <h3 className="font-semibold">Jobs needing review</h3>
        {!reviewJobs.length && <p>No jobs currently need review.</p>}
        {reviewJobs.map(job => {
          const section = job.recovery?.kind === 'stale_inputs' ? 'inputs' : job.recovery?.kind === 'proposals' ? 'proposals' : 'resume';
          const href = preparationDestination(job, reviewLinks[job.id]) ?? `/jobs/${job.id}/${section}`;
          return <a key={job.id} className={`${secondaryButton} block`} href={href} onClick={e => {
            if (navigate && !e.ctrlKey && !e.metaKey && !e.shiftKey && !e.altKey) { e.preventDefault(); navigate(href); }
          }}>Review {job.company ?? 'Unknown company'} — {job.role ?? 'Untitled role'}</a>;
        })}
      </section>}
      {showQueue && (
        <div className="mt-4 border-t border-slate-200/80 dark:border-slate-800 pt-3">
          <QueueVisualization
            activeAttempts={data?.active ?? []}
            jobs={jobs}
            onRefresh={async () => {
              await refresh();
              onJobMutated?.();
            }}
            navigate={navigate}
          />
        </div>
      )}

      {failure && (
        <div
          role="alert"
          className="mt-3 flex items-center gap-2 rounded-lg bg-rose-50 p-2.5 text-xs text-rose-800 dark:bg-rose-950/40 dark:text-rose-300 border border-rose-200 dark:border-rose-900/50"
        >
          <AlertCircle className="h-4 w-4 shrink-0 text-rose-600" />
          <span>{failure}</span>
        </div>
      )}
    </section>
  );
}
