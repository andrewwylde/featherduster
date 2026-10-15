import { useCallback, useState } from 'react';
import { Briefcase, Clock, ChevronRight, FileCheck, HelpCircle, Sparkles, AlertCircle, RefreshCw, ArrowUpDown, XCircle } from 'lucide-react';
import type { Job } from '@featherduster/core';
import { apiClient } from '../../api/client.js';
import { useIntentKey, useJobsData } from '../../hooks/useJobsData.js';
import { WorkerControls } from './WorkerControls.js';
import { JobIntake } from './JobIntake.js';
import { cardClass, primaryButton } from '../tailoring/ui.js';

const filters = ['All', 'Queued', 'Preparing', 'Needs input', 'Resume ready', 'Applied', 'Archived'] as const;

export function isNeedsInput(job: Job): boolean {
  return (
    job.preparation_state === 'needs_input' ||
    job.application_lifecycle === 'needs_input' ||
    (Array.isArray(job.missing_inputs) && job.missing_inputs.length > 0)
  );
}

export function isQueued(job: Job): boolean {
  return job.preparation_state === 'queued' && !isNeedsInput(job);
}

export function getJobPriority(job: Job): number {
  if (isNeedsInput(job)) return 0;
  if (isQueued(job)) return 1;
  return 2;
}

export function compareJobs(a: Job, b: Job, order: 'desc' | 'asc' = 'desc'): number {
  const priorityDiff = getJobPriority(a) - getJobPriority(b);
  if (priorityDiff !== 0) return priorityDiff;

  const timeA = a.created_at ? new Date(a.created_at).getTime() : 0;
  const timeB = b.created_at ? new Date(b.created_at).getTime() : 0;
  const validTimeA = Number.isNaN(timeA) ? 0 : timeA;
  const validTimeB = Number.isNaN(timeB) ? 0 : timeB;

  const dateDiff = order === 'desc' ? validTimeB - validTimeA : validTimeA - validTimeB;
  if (dateDiff !== 0) return dateDiff;

  return a.id.localeCompare(b.id);
}

export function matchesJobFilter(job: Job, filter: typeof filters[number]) {
  switch (filter) {
    case 'Queued':
      return isQueued(job);
    case 'Preparing':
      return job.preparation_state === 'preparing';
    case 'Needs input':
      return isNeedsInput(job);
    case 'Resume ready':
      return job.preparation_state === 'resume_ready';
    case 'Applied':
      return job.application_lifecycle === 'submitted';
    case 'Archived':
      return job.preparation_state === 'skipped' || job.preparation_state === 'cancelled';
    default:
      return true;
  }
}

function prepBadgeStyle(state: Job['preparation_state']) {
  switch (state) {
    case 'resume_ready':
      return 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300 border-emerald-200 dark:border-emerald-800';
    case 'preparing':
      return 'bg-amber-50 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300 border-amber-200 dark:border-amber-800 animate-pulse';
    case 'needs_input':
      return 'bg-purple-50 text-purple-700 dark:bg-purple-950/40 dark:text-purple-300 border-purple-200 dark:border-purple-800';
    case 'queued':
      return 'bg-sky-50 text-sky-700 dark:bg-sky-950/40 dark:text-sky-300 border-sky-200 dark:border-sky-800';
    case 'skipped':
    case 'cancelled':
      return 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400 border-slate-200 dark:border-slate-700';
    case 'failed':
      return 'bg-rose-50 text-rose-700 dark:bg-rose-950/40 dark:text-rose-300 border-rose-200 dark:border-rose-800';
    default:
      return 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400 border-slate-200 dark:border-slate-700';
  }
}

function lifecycleBadgeStyle(lifecycle: Job['application_lifecycle']) {
  switch (lifecycle) {
    case 'submitted':
      return 'bg-blue-50 text-blue-700 dark:bg-blue-950/40 dark:text-blue-300 border-blue-200 dark:border-blue-800';
    case 'outcome_recorded':
      return 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300 border-emerald-200 dark:border-emerald-800';
    case 'needs_input':
      return 'bg-amber-50 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300 border-amber-200 dark:border-amber-800';
    default:
      return 'bg-slate-50 text-slate-600 dark:bg-slate-900/40 dark:text-slate-400 border-slate-200 dark:border-slate-800';
  }
}

export function JobsView({ navigate }: { navigate: (path: string) => void }) {
  const load = useCallback(() => apiClient.getJobs(), []);
  const { data, error, refresh } = useJobsData(load);
  const [filter, setFilter] = useState<typeof filters[number]>('All');
  const [sortOrder, setSortOrder] = useState<'desc' | 'asc'>('desc');
  const [confirmCancelId, setConfirmCancelId] = useState<string | null>(null);
  const [busyCancelId, setBusyCancelId] = useState<string | null>(null);
  const key = useIntentKey();

  const handleCancelJob = async (job: Job) => {
    if (busyCancelId) return;
    setBusyCancelId(job.id);
    try {
      await apiClient.cancelJob(job.id, {
        expected_revision: job.revision,
        idempotency_key: key({ cancel: job.id, revision: job.revision }),
        reason: 'Cancelled by user from jobs list',
      });
      setConfirmCancelId(null);
      await refresh();
    } catch {
      // Error is surfaced in network/logging
    } finally {
      setBusyCancelId(null);
    }
  };

  const allJobs = data?.jobs ?? [];
  const jobs = allJobs
    .filter((job) => matchesJobFilter(job, filter))
    .sort((a, b) => compareJobs(a, b, sortOrder));

  const filterCounts = filters.reduce(
    (acc, f) => {
      acc[f] = allJobs.filter((job) => matchesJobFilter(job, f)).length;
      return acc;
    },
    {} as Record<typeof filters[number], number>
  );

  return (
    <div className="space-y-6 max-w-6xl mx-auto">
      {/* Page Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 border-b border-slate-200 dark:border-slate-800 pb-4">
        <div>
          <div className="flex items-center gap-2.5">
            <h1 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-white flex items-center gap-2">
              <Briefcase className="h-6 w-6 text-vermilion-500" />
              Jobs
            </h1>
            {data && (
              <span className="rounded-full bg-slate-100 dark:bg-slate-800 px-2.5 py-0.5 text-xs font-semibold text-slate-600 dark:text-slate-300">
                {allJobs.length} {allJobs.length === 1 ? 'record' : 'records'}
              </span>
            )}
          </div>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
            Durable intake, evidence-backed fit analysis, and version-bound resume review.
          </p>
        </div>
      </div>

      {/* Background Worker Controls */}
      <WorkerControls
        jobs={allJobs}
        onJobMutated={() => void refresh()}
        navigate={navigate}
      />

      {/* Intake Drawer / Form */}
      <JobIntake onSaved={() => void refresh()} />

      {/* Filter Tabs Bar */}
      <div className="space-y-2">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          {/* Visual Pills for Human Users */}
          <div className="flex flex-wrap items-center gap-1.5 p-1 rounded-xl bg-slate-100/80 dark:bg-slate-900/60 border border-slate-200/60 dark:border-slate-800">
            {filters.map((f) => (
              <button
                key={f}
                type="button"
                className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition-all ${
                  filter === f
                    ? 'bg-white text-slate-900 shadow-sm dark:bg-slate-800 dark:text-white font-semibold'
                    : 'text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-200'
                }`}
                onClick={() => setFilter(f)}
              >
                <span>{f}</span>
                {allJobs.length > 0 && (
                  <span
                    className={`text-[10px] rounded-full px-1.5 py-0.2 ${
                      filter === f
                        ? 'bg-slate-100 text-slate-800 dark:bg-slate-700 dark:text-slate-200'
                        : 'bg-slate-200/60 text-slate-500 dark:bg-slate-800/80'
                    }`}
                  >
                    {filterCounts[f]}
                  </span>
                )}
              </button>
            ))}
          </div>

          <div className="flex items-center gap-2.5">
            {/* Sort order toggle */}
            <button
              type="button"
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-2.5 py-1.5 text-xs font-medium text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors focus:outline-none focus:ring-1 focus:ring-vermilion-500 min-h-[44px] sm:min-h-0"
              onClick={() => setSortOrder((prev) => (prev === 'desc' ? 'asc' : 'desc'))}
              title={`Sorted by: Needs input, Queued, Others · Sub-sort: ${sortOrder === 'desc' ? 'Newest first' : 'Oldest first'}`}
              aria-label="Toggle sort order"
            >
              <ArrowUpDown className="h-3.5 w-3.5 text-slate-400" />
              <span>{sortOrder === 'desc' ? 'Newest' : 'Oldest'}</span>
            </button>

            {/* Synchronized accessible select (visible or accessible) */}
            <label className="text-xs text-slate-500 flex items-center gap-2">
              Filter jobs{' '}
              <select
                className="min-h-[44px] sm:min-h-0 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-1.5 text-xs text-slate-700 dark:text-slate-300 focus:outline-none focus:ring-1 focus:ring-vermilion-500"
                value={filter}
                aria-label="Filter jobs"
                onChange={(e) => setFilter(e.target.value as typeof filter)}
              >
                {filters.map((f) => (
                  <option key={f} value={f}>
                    {f}
                  </option>
                ))}
              </select>
            </label>
          </div>
        </div>

        {filter === 'Archived' && (
          <p className="text-xs text-slate-500 dark:text-slate-400 italic">
            Skipped and cancelled jobs; records are retained.
          </p>
        )}
      </div>

      {/* Status Messages */}
      {error && (
        <div
          role="alert"
          className="flex items-center justify-between rounded-xl border border-rose-200 bg-rose-50 p-4 text-xs text-rose-800 dark:border-rose-900/50 dark:bg-rose-950/40 dark:text-rose-300"
        >
          <div className="flex items-center gap-2">
            <AlertCircle className="h-4 w-4 shrink-0 text-rose-600" />
            <span>{error}</span>
          </div>
          <button
            className="underline font-semibold text-rose-700 hover:text-rose-900 dark:text-rose-300"
            onClick={() => void refresh()}
          >
            Retry loading jobs
          </button>
        </div>
      )}

      {!data && !error && (
        <div
          role="status"
          className="flex items-center justify-center gap-2 p-12 text-sm text-slate-500 dark:text-slate-400"
        >
          <RefreshCw className="h-4 w-4 animate-spin text-vermilion-500" />
          <span>Loading jobs…</span>
        </div>
      )}

      {data && !data.jobs.length && (
        <div className={`${cardClass} p-12 text-center space-y-3`}>
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-slate-100 dark:bg-slate-800 text-slate-400">
            <Briefcase className="h-6 w-6" />
          </div>
          <h3 className="text-base font-semibold text-slate-900 dark:text-white">
            No jobs yet. Preview a posting to get started.
          </h3>
          <p className="text-xs text-slate-500 dark:text-slate-400 max-w-md mx-auto">
            Paste a link from Lever, Greenhouse, or any employer career page above to initiate intake.
          </p>
        </div>
      )}

      {Boolean(data?.jobs.length && !jobs?.length) && (
        <div className={`${cardClass} p-8 text-center text-xs text-slate-500 dark:text-slate-400`}>
          No jobs match this filter.
        </div>
      )}

      {/* Jobs Cards List */}
      <ul className="space-y-3">
        {jobs?.map((job) => {
          const initials = (job.company || 'Job')
            .split(' ')
            .map((w) => w[0])
            .slice(0, 2)
            .join('')
            .toUpperCase();

          return (
            <li
              key={job.id}
              className={`${cardClass} p-5 space-y-3 break-words hover:border-slate-300 dark:hover:border-slate-700 transition-all hover:shadow-md group`}
            >
              <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
                {/* Left: Avatar + Title */}
                <div className="flex items-start gap-3.5 min-w-0">
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-slate-100 dark:bg-slate-800 text-xs font-bold text-slate-700 dark:text-slate-200 border border-slate-200/60 dark:border-slate-700/60">
                    {initials}
                  </div>

                  <div className="min-w-0">
                    <h2 className="text-base font-semibold leading-tight">
                      <a
                        className="text-slate-900 dark:text-white hover:text-vermilion-600 dark:hover:text-vermilion-400 transition-colors flex items-center gap-1.5 group-hover:underline"
                        href={`/jobs/${job.id}`}
                        onClick={(e) => {
                          if (!e.ctrlKey && !e.metaKey) {
                            e.preventDefault();
                            navigate(`/jobs/${job.id}`);
                          }
                        }}
                      >
                        <span>{job.company ?? 'Unknown company'} — {job.role ?? 'Untitled role'}</span>
                        <ChevronRight className="h-4 w-4 shrink-0 text-slate-400 group-hover:translate-x-0.5 transition-transform" />
                      </a>
                    </h2>

                    {/* Preserves test assertion text while styled cleanly */}
                    <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                      Preparation: {job.preparation_state} · Application: {job.application_lifecycle}
                    </p>
                  </div>
                </div>

                {/* Right: Status Pills */}
                <div className="flex flex-wrap items-center gap-2 shrink-0">
                  <span
                    className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-xs font-medium ${prepBadgeStyle(
                      job.preparation_state
                    )}`}
                  >
                    {job.preparation_state === 'resume_ready' && <FileCheck className="h-3 w-3" />}
                    {job.preparation_state === 'preparing' && <Sparkles className="h-3 w-3" />}
                    {job.preparation_state === 'needs_input' && <HelpCircle className="h-3 w-3" />}
                    {job.preparation_state}
                  </span>

                  <span
                    className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium ${lifecycleBadgeStyle(
                      job.application_lifecycle
                    )}`}
                  >
                    {job.application_lifecycle}
                  </span>
                </div>
              </div>

              {/* Sub-status & reason note */}
              <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-600 dark:text-slate-400 border-t border-slate-100 dark:border-slate-800/80 pt-2.5">
                <p>
                  <span className="font-medium text-slate-700 dark:text-slate-300">Stage: </span>
                  {job.preparation_stage ?? 'Not assessed'}
                  {job.state_reason ? ` — ${job.state_reason}` : ''}
                </p>

                <p>
                  {job.kind === 'discovery' ? 'Discovery — select an opening' : 'Fit: Not assessed'}
                </p>

                <div className="ml-auto flex items-center gap-1 text-[11px] text-slate-400">
                  <Clock className="h-3 w-3" />
                  <time dateTime={job.created_at} title={`Imported/Created: ${new Date(job.created_at).toLocaleString()}`}>
                    Imported{' '}
                    {new Date(job.created_at).toLocaleDateString(undefined, {
                      month: 'short',
                      day: 'numeric',
                      hour: '2-digit',
                      minute: '2-digit',
                    })}
                  </time>
                </div>
              </div>

              {/* Action row */}
              <div className="pt-2 flex items-center justify-end gap-2">
                {['queued', 'preparing', 'needs_input'].includes(job.preparation_state) && (
                  confirmCancelId === job.id ? (
                    <div className="flex items-center gap-1.5">
                      <span className="text-xs text-rose-600 font-medium">Cancel job?</span>
                      <button
                        type="button"
                        className="rounded-lg bg-rose-600 px-2.5 py-1 text-xs font-semibold text-white hover:bg-rose-700 disabled:opacity-50"
                        disabled={busyCancelId === job.id}
                        onClick={() => void handleCancelJob(job)}
                      >
                        {busyCancelId === job.id ? 'Cancelling…' : 'Yes'}
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
                      className="inline-flex items-center gap-1 rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 px-2.5 py-1 text-xs font-medium text-slate-500 hover:text-rose-600 dark:hover:text-rose-400 hover:border-rose-200 dark:hover:border-rose-900/60 transition-colors"
                      onClick={() => setConfirmCancelId(job.id)}
                    >
                      <XCircle className="h-3.5 w-3.5" />
                      <span>Cancel job</span>
                    </button>
                  )
                )}

                {Boolean(job.artifact_version_ids.length) && (
                  <button
                    className={`${primaryButton} text-xs font-semibold min-h-[44px] sm:min-h-0 sm:py-1.5`}
                    onClick={() => navigate(`/jobs/${job.id}/resume`)}
                  >
                    <FileCheck className="h-3.5 w-3.5" />
                    Review resume
                  </button>
                )}
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
