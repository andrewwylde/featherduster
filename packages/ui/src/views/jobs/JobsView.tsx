import { useCallback, useEffect, useState } from 'react';
import { SharedFactUpdates } from './SharedFactUpdates.js';
import { Briefcase, ChevronRight, FileCheck, AlertCircle, RefreshCw, ArrowUpDown, XCircle, CheckCircle, X, LayoutGrid, Table2 } from 'lucide-react';
import type { Job } from '@featherduster/core';
import { apiClient } from '../../api/client.js';
import { useIntentKey, useJobsData } from '../../hooks/useJobsData.js';
import { WorkerControls } from './WorkerControls.js';
import { JobIntake } from './JobIntake.js';
import { cardClass, primaryButton, secondaryButton } from '../tailoring/ui.js';

import {
  jobFilters as filters,
  isNeedsInput,
  isQueued,
  getJobPriority,
  compareJobs,
  matchesJobFilter,
  displayPreparationState,
  hasCancellableWork,
  pluralize,
  preparationDestination,
} from './job-utils.js';

export {
  filters,
  isNeedsInput,
  isQueued,
  getJobPriority,
  compareJobs,
  matchesJobFilter,
};

const jobListStatus = (state: Job['preparation_state']) => state === 'saved' ? 'Saved · preparation is optional' : state === 'resume_ready' ? 'Resume ready to review' : state === 'needs_input' ? 'Preparation needs your attention' : state === 'preparing' ? 'Preparing resume' : 'Open to review preparation';

export function JobsView({ navigate }: { navigate: (path: string) => void }) {
  const load = useCallback(() => apiClient.getJobs(), []);
  const { data, error, refresh } = useJobsData(load);
  const [filter, setFilter] = useState<typeof filters[number]>('Needs work');
  const [viewMode, setViewMode] = useState<'cards' | 'table'>(() => {
    try { return localStorage.getItem('jobs-view-mode') === 'table' ? 'table' : 'cards'; } catch { return 'cards'; }
  });
  const changeView = (mode: 'cards' | 'table') => {
    setViewMode(mode);
    try { localStorage.setItem('jobs-view-mode', mode); } catch { /* View remains available without storage. */ }
  };
  const [trackingId, setTrackingId] = useState<string | null>(null);
  const [trackingError, setTrackingError] = useState('');
  const [trackingNotice, setTrackingNotice] = useState('');
  useEffect(() => {
    if (!trackingNotice) return;
    const timeout = window.setTimeout(() => setTrackingNotice(''), 6000);
    return () => window.clearTimeout(timeout);
  }, [trackingNotice]);
  const [sortOrder, setSortOrder] = useState<'desc' | 'asc'>('desc');
  const [confirmCancelId, setConfirmCancelId] = useState<string | null>(null);
  const [busyCancelId, setBusyCancelId] = useState<string | null>(null);
  const key = useIntentKey();
  const [selection, setSelection] = useState<string[]>([]);
  const [preparing, setPreparing] = useState(false), [prepareError, setPrepareError] = useState('');
  const track = async (job: Job, action: 'applied' | 'unapply' | 'archive' | 'restore') => {
    if (trackingId) return;
    setTrackingId(job.id); setTrackingError(''); setTrackingNotice('');
    try {
      await apiClient.trackJob(job.id, { action, expected_revision: job.revision, idempotency_key: key({ job: job.id, action, revision: job.revision }) });
      setSelection(previous => previous.filter(id => id !== job.id));
      setTrackingNotice(`${job.company ?? 'Job'}: ${action === 'applied' ? 'marked applied. Find it in Applied.' : action === 'archive' ? 'archived. Find it in Archived.' : action === 'unapply' ? 'marked not applied.' : 'restored from archive.'}`);
      await refresh();
    } catch (e) { setTrackingError(e instanceof Error ? e.message : 'Could not update job.'); }
    finally { setTrackingId(null); }
  };
  const prepareSelected = async () => {
    setPreparing(true); setPrepareError('');
    try {
      const members = selection.map(id => { const job = data?.jobs.find(j => j.id === id); if (!job) throw Error('A selected job changed. Reload the list.'); return { job_id: id, expected_revision: job.revision }; });
      const result = await apiClient.prepareJobBatch({ members, idempotency_key: key({ members }) });
      sessionStorage.setItem('resume-preparation-recent-batch', result.result.id);
      navigate(`/jobs/preparation-batches/${result.result.id}/review`);
    } catch (e) { setPrepareError((e as Error).message); } finally { setPreparing(false); }
  };

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

  const renderJobs = () => jobs.map(job => {
    const preparationHref = matchesJobFilter(job, 'Needs work') ? preparationDestination(job, data?.preparation_links?.[job.id]) : null;
    const selectionControl = (<label className="flex items-center gap-2 text-sm"><input type="checkbox" aria-label={`Select ${job.company ?? 'job'} ${job.role ?? ''}`} checked={selection.includes(job.id)}
                  disabled={preparing || Boolean(trackingId) || Boolean(job.archived_at) || ['submitted', 'outcome_recorded', 'unknown'].includes(job.application_lifecycle) || job.kind !== 'job' || ['queued', 'preparing'].includes(job.preparation_state)}
                  onChange={event => setSelection(previous => event.target.checked ? [...previous, job.id] : previous.filter(id => id !== job.id))} />Prepare{selection.includes(job.id) ? ` · ${selection.indexOf(job.id) + 1}` : ''}</label>);
    const heading = (<h2 className="text-base font-semibold leading-tight">
                      <a
                        className="text-slate-900 dark:text-white hover:text-vermilion-600 dark:hover:text-vermilion-400 transition-colors flex items-start justify-between gap-3 hover:underline"
                        href={preparationHref ?? `/jobs/${job.id}`}
                        onClick={(e) => {
                          if (!e.ctrlKey && !e.metaKey) {
                            e.preventDefault();
                            navigate(preparationHref ?? `/jobs/${job.id}`);
                          }
                        }}
                      >
                        <span>{job.company ?? 'Unknown company'} — {job.role ?? 'Untitled role'}</span>
                        <ChevronRight className="h-4 w-4 shrink-0 text-slate-400 group-hover:translate-x-0.5 transition-transform" />
                      </a>
                    </h2>);
    const status = (<p className="text-xs leading-relaxed text-slate-500 dark:text-slate-400">
                      {job.archived_at ? 'Archived' : ['submitted', 'outcome_recorded'].includes(job.application_lifecycle) ? 'Applied' : jobListStatus(displayPreparationState(job))}
                    </p>);
    const actions = <div className="flex flex-wrap items-center gap-2">{!hasCancellableWork(job) && <>
                  {job.application_lifecycle !== 'outcome_recorded' && <button className={secondaryButton} disabled={Boolean(trackingId) || preparing} onClick={() => void track(job, job.application_lifecycle === 'submitted' ? 'unapply' : 'applied')}>{job.application_lifecycle === 'submitted' ? 'Mark not applied' : 'Mark applied'}</button>}
                  <button className={secondaryButton} disabled={Boolean(trackingId) || preparing} onClick={() => void track(job, job.archived_at ? 'restore' : 'archive')}>{trackingId === job.id ? 'Saving…' : job.archived_at ? 'Restore from archive' : 'Archive job'}</button>
                </>}
                {hasCancellableWork(job) && <p className="text-xs text-slate-500">Cancel preparation first to mark applied or archive.</p>}
                {preparationHref && <button className={primaryButton} onClick={() => navigate(preparationHref)}>{preparationHref.endsWith('/questions') ? 'Answer preparation questions' : preparationHref.endsWith('/inputs') ? 'Review current inputs' : 'Preparation progress'}</button>}
                {hasCancellableWork(job) && (
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
                )}</div>;
    if (viewMode === 'table') return <tr key={job.id} className="align-top hover:bg-slate-50/70 dark:hover:bg-slate-900/50"><td className="p-4">{selectionControl}</td><td className="min-w-[240px] p-4">{heading}</td><td className="min-w-[160px] p-4">{status}</td><td className="max-w-md p-4"><div className="flex justify-end">{actions}</div></td></tr>;
    return <li key={job.id} className={`${cardClass} flex min-w-0 flex-col`}>
      <div className="flex-1 space-y-4 p-5">
        <div className="flex items-center justify-between gap-3"><span className="text-xs font-medium text-slate-500 dark:text-slate-400">Saved position</span>{selectionControl}</div>
        {heading}
        {status}
      </div>
      <div className="border-t border-slate-100 bg-slate-50/60 p-4 dark:border-slate-800 dark:bg-slate-900/30">{actions}</div>
    </li>;
  });

  return (
    <div className="space-y-6 max-w-6xl mx-auto">
      <SharedFactUpdates onSaved={() => void refresh()} />
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
                {pluralize(filterCounts['Needs work'], 'job needs', 'jobs need')} work
              </span>
            )}
          </div>
          <p className="text-xs leading-relaxed text-slate-500 dark:text-slate-400">
            Save a position, then choose the preparation you need. Saving never starts model work.
          </p>
        </div>
      </div>

      <JobIntake onSaved={() => void refresh()} />
      <WorkerControls jobs={allJobs.filter(job => matchesJobFilter(job, 'Needs work'))} onJobMutated={() => void refresh()} navigate={navigate} />
      {sessionStorage.getItem('resume-preparation-recent-batch') && <button className={primaryButton} onClick={() => navigate(`/jobs/preparation-batches/${sessionStorage.getItem('resume-preparation-recent-batch')}/review`)}>Return to resume preparation</button>}

      <section className={`${cardClass} p-4 space-y-2`}><h2>Prepare selected resumes</h2><p>Jobs prepare in selection order. Only necessary questions pause their own jobs. Each PDF needs your separate approval.</p>
        <button className={primaryButton} disabled={!selection.length || preparing} onClick={() => void prepareSelected()}>Prepare resumes ({selection.length})</button>
        {prepareError && <p role="alert">{prepareError}</p>}
      </section>
      {/* Filter Tabs Bar */}
      <section aria-label="Filter saved jobs and retained history"><div className="space-y-2">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          {/* Visual Pills for Human Users */}
          <div className="flex flex-wrap items-center gap-1.5 p-1 rounded-xl bg-slate-100/80 dark:bg-slate-900/60 border border-slate-200/60 dark:border-slate-800">
            {filters.map((f) => (
              <button
                key={f}
                type="button"
                aria-pressed={filter === f}
                className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition-all ${
                  filter === f
                    ? 'bg-white text-slate-900 shadow-sm dark:bg-slate-800 dark:text-white font-semibold'
                    : 'text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-200'
                }`}
                onClick={() => { setFilter(f); setSelection([]); }}
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
                onChange={(e) => { setFilter(e.target.value as typeof filter); setSelection([]); }}
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
            Archived, skipped and cancelled jobs; resumes and history are retained.
          </p>
        )}
      </div>

        {filter === 'Needs work' && <p className="text-sm text-slate-500">Jobs still to prepare, review or apply to. Mark applied or archive to clear them from this view.</p>}
        {filter === 'Applied' && <p className="text-sm text-slate-500">Applications you recorded as submitted. Mark applied only updates tracking.</p>}
      </section>
      {trackingError && <p role="alert">{trackingError}</p>}
      {trackingNotice && (
        <div className="fixed bottom-6 right-4 z-50 flex max-w-[calc(100vw-2rem)] items-center gap-3 rounded-xl border border-emerald-200 bg-white p-4 text-sm text-slate-900 shadow-lg dark:border-emerald-800 dark:bg-slate-900 dark:text-white sm:right-6 sm:max-w-md">
          <CheckCircle className="h-5 w-5 shrink-0 text-emerald-600 dark:text-emerald-400" aria-hidden="true" />
          <p role="status" aria-atomic="true">{trackingNotice}</p>
          <button type="button" aria-label="Dismiss notification" className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-vermilion-500 dark:hover:bg-slate-800" onClick={() => setTrackingNotice('')}>
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>
      )}

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
            No saved jobs yet. Save a position to get started.
          </h3>
          <p className="text-xs text-slate-500 dark:text-slate-400 max-w-md mx-auto">
            Add a company, position and posting/context above. No resume or runner is required.
          </p>
        </div>
      )}

      {Boolean(data?.jobs.length && !jobs?.length) && (
        <div className={`${cardClass} p-8 text-center text-xs text-slate-500 dark:text-slate-400`}>
          {filter === 'Needs work' ? 'All caught up. Applied and archived jobs are available in the filters above.' : 'No jobs match this filter.'}
        </div>
      )}

      <div className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-xs font-medium text-slate-500 dark:text-slate-400">{pluralize(jobs.length, 'job')}{selection.length > 0 && ` · ${selection.length} selected`}</p>
          <div role="group" aria-label="Job view" className="inline-flex rounded-desk border border-slate-200 bg-slate-100 p-1 dark:border-slate-800 dark:bg-slate-900">
            {([{ mode: 'cards', label: 'Cards', Icon: LayoutGrid }, { mode: 'table', label: 'Table', Icon: Table2 }] as const).map(({ mode, label, Icon }) => (
              <button key={mode} type="button" aria-pressed={viewMode === mode} onClick={() => changeView(mode)} className={`inline-flex min-h-9 items-center gap-2 rounded-desk px-3 text-xs font-semibold focus-visible:outline focus-visible:outline-2 focus-visible:outline-vermilion-500 ${viewMode === mode ? 'bg-white text-slate-900 shadow-sm dark:bg-slate-800 dark:text-white' : 'text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white'}`}><Icon aria-hidden="true" className="h-4 w-4" />{label}</button>
            ))}
          </div>
        </div>
        {viewMode === 'cards' ? <ul aria-label="Saved jobs" className="grid grid-cols-1 gap-4 lg:grid-cols-2">{renderJobs()}</ul> : (
          <div className={`${cardClass} overflow-x-auto`}>
            <table className="w-full min-w-[880px] text-left text-sm">
              <caption className="sr-only">Saved jobs with preparation status and actions</caption>
              <thead className="border-b border-slate-200 bg-slate-50 text-xs text-slate-500 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-400"><tr><th scope="col" className="p-4 font-medium">Prepare</th><th scope="col" className="p-4 font-medium">Company / role</th><th scope="col" className="p-4 font-medium">Status</th><th scope="col" className="p-4 text-right font-medium">Actions</th></tr></thead>
              <tbody className="divide-y divide-slate-200 dark:divide-slate-800">{renderJobs()}</tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
