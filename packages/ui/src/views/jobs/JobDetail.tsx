import { useCallback, useRef, useState } from 'react';
import {
  ArrowLeft,
  FileText,
  Target,
  FileCheck,
  HelpCircle,
  History,
  Sparkles,
  RefreshCw,
  AlertCircle,
  ExternalLink,
  Settings,
  XCircle,
} from 'lucide-react';
import { apiClient } from '../../api/client.js';
import { useIntentKey, useJobsData } from '../../hooks/useJobsData.js';
import { jobSections, type JobSection } from '../../routing.js';
import { WorkerControls } from './WorkerControls.js';
import { JobIntake } from './JobIntake.js';
import { JobAnswers } from './JobAnswers.js';
import { JobResumeReview } from './JobResumeReview.js';
import { cardClass, primaryButton, secondaryButton } from '../tailoring/ui.js';

export function JobDetail({
  id,
  section,
  navigate,
}: {
  id: string;
  section: JobSection;
  navigate: (path: string) => void;
}) {
  const load = useCallback(() => apiClient.getJob(id), [id]);
  const { data, error, refresh } = useJobsData(load);
  const [failure, setFailure] = useState('');
  const [busy, setBusy] = useState(false);
  const pending = useRef(false);
  const captured = useRef<{ revision: number; id: string } | null>(null);
  const intentKey = useIntentKey();

  const prepare = async (action: 'prepare' | 'resume' | 'retry') => {
    if (!data || pending.current) return;
    pending.current = true;
    setBusy(true);
    setFailure('');
    try {
      let input = action !== 'prepare' ? data.attempt?.input_snapshot_id : null;
      if (!input) {
        if (captured.current?.revision !== data.job.revision) {
          captured.current = {
            revision: data.job.revision,
            id: (await apiClient.captureJobInputs(id, data.job.revision)).input_snapshot.id,
          };
        }
        input = captured.current!.id;
      }
      const body = { expected_revision: data.job.revision, input_snapshot_id: input };
      await apiClient.prepareJob(id, action, {
        ...body,
        idempotency_key: intentKey({ action, ...body }),
      });
      await refresh();
    } catch (e) {
      setFailure(e instanceof Error ? e.message : 'Preparation failed');
    } finally {
      pending.current = false;
      setBusy(false);
    }
  };

  const cancel = async () => {
    if (!data || pending.current) return;
    pending.current = true;
    setBusy(true);
    setFailure('');
    try {
      await apiClient.cancelJob(id, {
        expected_revision: data.job.revision,
        idempotency_key: intentKey({ cancel: id, revision: data.job.revision }),
        reason: 'Cancelled by user from job details',
      });
      await refresh();
    } catch (e) {
      setFailure(e instanceof Error ? e.message : 'Cancellation failed');
    } finally {
      pending.current = false;
      setBusy(false);
    }
  };

  const job = data?.job;
  const hasReview = data?.proposal_review?.availability === 'available';
  const canRecover = data?.proposal_review?.availability === 'missing_output' && data.proposal_review.recoverable;
  const setup = job?.recovery?.kind === 'setup';
  const recoveryAction = hasReview ? { label: 'Resolve proposals', path: `/jobs/${id}/resume` }
    : setup ? { label: 'Resolve setup', path: '/settings' }
    : canRecover ? { label: 'Recover proposal review', path: `/jobs/${id}/resume` }
    : job?.recovery?.kind === 'render' ? { label: 'Inspect render failure', path: `/jobs/${id}/resume` }
    : job?.recovery && job.recovery.kind !== 'fact' ? { label: 'Resolve proposals', path: `/jobs/${id}/resume` } : null;

  const sectionIcon = (key: string) => {
    switch (key) {
      case 'posting':
        return <FileText className="h-4 w-4" />;
      case 'fit':
        return <Target className="h-4 w-4" />;
      case 'resume':
        return <FileCheck className="h-4 w-4" />;
      case 'answers':
        return <HelpCircle className="h-4 w-4" />;
      case 'history':
        return <History className="h-4 w-4" />;
      default:
        return null;
    }
  };

  return (
    <div className="space-y-6 max-w-6xl mx-auto min-w-0">
      {/* Top Breadcrumb & Return */}
      <div className="flex items-center justify-between">
        <button
          className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white transition-colors min-h-[44px] underline"
          onClick={() => navigate('/jobs')}
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          Back to Jobs
        </button>
      </div>

      <WorkerControls
        jobs={job ? [job] : []}
        onJobMutated={() => void refresh()}
        navigate={navigate}
      />

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
            Reload job
          </button>
        </div>
      )}

      {!data && !error && (
        <div className="flex items-center justify-center gap-2 p-12 text-sm text-slate-500 dark:text-slate-400">
          <RefreshCw className="h-4 w-4 animate-spin text-vermilion-500" />
          <span>Loading job…</span>
        </div>
      )}

      {data && job && (
        <>
          {/* Job Header Hero Card */}
          <div className={`${cardClass} p-6 space-y-4`}>
            <div className="flex flex-col md:flex-row md:items-start md:justify-between gap-4">
              <div className="space-y-1.5">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-mono uppercase tracking-wider text-slate-500 dark:text-slate-400">
                    Job Details
                  </span>
                  {job.canonical_url && (
                    <a
                      href={job.canonical_url}
                      target="_blank"
                      rel="noreferrer"
                      className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 inline-flex items-center gap-0.5 text-xs"
                    >
                      <ExternalLink className="h-3 w-3" />
                      Posting link
                    </a>
                  )}
                </div>

                <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-slate-900 dark:text-white">
                  {job.company ?? 'Unknown company'} — {job.role ?? 'Untitled role'}
                </h1>

                <p className="text-xs text-slate-500 dark:text-slate-400">
                  Preparation: {job.preparation_state} · Application: {job.application_lifecycle}
                </p>

                <p className="text-xs font-medium text-slate-700 dark:text-slate-300">
                  {job.preparation_stage} {job.state_reason}
                </p>
              </div>

              {/* Action Buttons */}
              {job.kind === 'job' && (
                <div className="flex flex-wrap items-center gap-2.5">
                  {job.preparation_state === 'queued' && (
                    <button
                      className={`${primaryButton} text-xs font-semibold`}
                      disabled={busy}
                      onClick={() => void prepare('prepare')}
                    >
                      <Sparkles className="h-3.5 w-3.5" />
                      Prepare resume
                    </button>
                  )}

                  {job.preparation_state === 'needs_input' && (
                    <button
                      className={`${primaryButton} text-xs font-semibold`}
                      disabled={busy}
                      onClick={() => recoveryAction ? navigate(recoveryAction.path) : void prepare('resume')}
                    >
                      <RefreshCw className="h-3.5 w-3.5" />
                      {recoveryAction?.label ?? 'Resume job'}
                    </button>
                  )}

                  {setup && hasReview && <button className={secondaryButton} onClick={() => navigate('/settings')}>Resolve setup</button>}
                  {['failed', 'interrupted', 'cancelled'].includes(job.preparation_state) && (
                    <button
                      className={`${secondaryButton} text-xs font-semibold`}
                      disabled={busy}
                      onClick={() => recoveryAction ? navigate(recoveryAction.path) : void prepare('retry')}
                    >
                      <RefreshCw className="h-3.5 w-3.5" />
                      {recoveryAction?.label ?? 'Retry'}
                    </button>
                  )}

                  {['queued', 'preparing', 'needs_input'].includes(job.preparation_state) && (
                    <button
                      type="button"
                      className="inline-flex items-center gap-1.5 rounded-desk border border-rose-200 dark:border-rose-900/60 bg-white dark:bg-slate-900 px-3 py-1.5 text-xs font-semibold text-rose-700 dark:text-rose-300 hover:bg-rose-50 dark:hover:bg-rose-950/40 transition-colors"
                      disabled={busy}
                      onClick={() => void cancel()}
                    >
                      <XCircle className="h-3.5 w-3.5 text-rose-500" />
                      Cancel job
                    </button>
                  )}

                  <a
                    href="/settings"
                    className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white px-3 py-2 underline"
                  >
                    <Settings className="h-3.5 w-3.5" />
                    Settings (runner, consent and tools)
                  </a>
                </div>
              )}
            </div>

            {setup && <p role="status">Last attempt setup diagnostic: {job.state_reason}. PDF tools must be repaired in the service environment, not by editing proposals or changing the model timeout. Settings does not automatically restart preparation.</p>}
            {failure && (
              <div
                role="alert"
                className="flex items-center justify-between rounded-lg border border-rose-200 bg-rose-50 p-3 text-xs text-rose-800 dark:border-rose-900/50 dark:bg-rose-950/40 dark:text-rose-300"
              >
                <span>{failure}</span>
                <button className="underline font-semibold" onClick={() => void refresh()}>
                  Reload job
                </button>
              </div>
            )}
          </div>

          {/* Section Navigation Tabs */}
          <nav
            aria-label="Job sections"
            className="flex gap-2 overflow-x-auto border-b border-slate-200 dark:border-slate-800 pb-px"
          >
            {Object.entries(jobSections).map(([key, label]) => {
              const active = section === key;
              return (
                <a
                  key={key}
                  href={`/jobs/${id}/${key}`}
                  aria-current={active ? 'page' : undefined}
                  className={`inline-flex items-center gap-2 px-4 py-2.5 text-xs font-medium border-b-2 transition-all min-h-[44px] shrink-0 underline ${
                    active
                      ? 'border-vermilion-500 text-vermilion-600 dark:text-vermilion-400 font-semibold'
                      : 'border-transparent text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-200'
                  }`}
                  onClick={(e) => {
                    if (!e.metaKey && !e.ctrlKey) {
                      e.preventDefault();
                      navigate(`/jobs/${id}/${key}`);
                    }
                  }}
                >
                  {sectionIcon(key)}
                  {label}
                </a>
              );
            })}
          </nav>

          {/* Section 1: Posting */}
          {section === 'posting' && (
            <section className={`${cardClass} p-6 space-y-4`}>
              <div className="flex items-center justify-between">
                <h2 className="text-lg font-bold text-slate-900 dark:text-white flex items-center gap-2">
                  <FileText className="h-5 w-5 text-vermilion-500" />
                  Posting
                </h2>
              </div>

              {data.posting ? (
                <div className="space-y-3">
                  <div className="rounded-lg bg-slate-50 dark:bg-slate-900/60 p-3 text-xs text-slate-600 dark:text-slate-400 space-y-1 border border-slate-200/60 dark:border-slate-800">
                    <p>
                      Original: {data.posting.original_url ?? 'Pasted text'} · Final:{' '}
                      {data.posting.final_url ?? 'Pasted text'} · Captured: {data.posting.captured_at}
                    </p>
                  </div>

                  <pre className="whitespace-pre-wrap break-words font-sans text-xs text-slate-800 dark:text-slate-200 leading-relaxed bg-white dark:bg-[#0c0f17] p-5 rounded-lg border border-slate-200 dark:border-slate-800">
                    {data.posting.text}
                  </pre>
                </div>
              ) : (
                <p className="text-xs text-slate-500 dark:text-slate-400">No captured posting.</p>
              )}

              {job.missing_inputs.some((q) => q.key === 'posting_text') && (
                <div className="mt-4 border-t border-slate-200 dark:border-slate-800 pt-4">
                  <JobIntake fallback={{ id, revision: job.revision }} onSaved={() => void refresh()} />
                </div>
              )}
            </section>
          )}

          {/* Section 2: Fit */}
          {section === 'fit' && (
            <section className={`${cardClass} p-6 space-y-6`}>
              <h2 className="text-lg font-bold text-slate-900 dark:text-white flex items-center gap-2">
                <Target className="h-5 w-5 text-vermilion-500" />
                Fit
              </h2>

              {data.analysis ? (
                <div className="space-y-6">
                  {/* Mission */}
                  <div className="rounded-xl border border-slate-200/80 bg-slate-50/70 p-4 dark:border-slate-800 dark:bg-slate-900/50 space-y-1.5">
                    <h3 className="text-xs font-mono uppercase tracking-wider text-slate-500 dark:text-slate-400">
                      Role Mission
                    </h3>
                    <p className="text-sm font-medium text-slate-900 dark:text-slate-100">
                      {data.analysis.mission}
                    </p>
                  </div>

                  {/* Requirements and Quotes */}
                  <div className="space-y-3">
                    <h3 className="text-sm font-semibold text-slate-900 dark:text-white">
                      Requirements and posting quotes
                    </h3>
                    <ul className="space-y-3">
                      {data.analysis.requirements.map((r) => (
                        <li
                          key={r.id}
                          className="rounded-lg border border-slate-200 dark:border-slate-800 p-4 space-y-2 bg-white dark:bg-slate-950/40"
                        >
                          <p className="text-xs font-semibold text-slate-900 dark:text-white">
                            {r.text}
                          </p>
                          <blockquote className="border-l-2 border-vermilion-500 pl-3 text-xs italic text-slate-600 dark:text-slate-400">
                            {r.quote}
                          </blockquote>
                        </li>
                      ))}
                    </ul>
                  </div>

                  {/* Evidence Alignment */}
                  <div className="space-y-3">
                    <h3 className="text-sm font-semibold text-slate-900 dark:text-white">
                      Backed, transferable and gap evidence
                    </h3>
                    <ul className="divide-y divide-slate-100 dark:divide-slate-800">
                      {data.alignment ? (
                        data.alignment.rows.map((row) => (
                          <li key={row.requirement_id} className="py-3 text-xs space-y-1">
                            <div className="flex items-center gap-2">
                              <span className="font-mono text-slate-500">{row.requirement_id}:</span>
                              <strong
                                className={`rounded px-1.5 py-0.5 text-[11px] ${
                                  row.classification === 'backed'
                                    ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-300'
                                    : row.classification === 'transferable'
                                      ? 'bg-sky-100 text-sky-800 dark:bg-sky-950/50 dark:text-sky-300'
                                      : 'bg-amber-100 text-amber-800 dark:bg-amber-950/50 dark:text-amber-300'
                                }`}
                              >
                                {row.classification}
                              </strong>
                            </div>
                            <p className="text-slate-700 dark:text-slate-300">{row.rationale}</p>
                            <p className="text-[11px] text-slate-500">
                              Citations: {row.citations.join(', ') || 'None'}
                            </p>
                            {row.issues?.map((issue, i) => (
                              <p key={i} className="text-[11px] text-amber-600 dark:text-amber-400 font-medium">
                                {issue.severity}: {issue.message}
                              </p>
                            ))}
                          </li>
                        ))
                      ) : (
                        <li className="py-2 text-xs text-slate-500">Not assessed</li>
                      )}
                    </ul>
                  </div>
                </div>
              ) : (
                <p className="text-xs text-slate-500 dark:text-slate-400">Not assessed</p>
              )}
            </section>
          )}

          {/* Section 3: Blocker Answers */}
          {section === 'answers' && (
            <JobAnswers job={job} answers={data.answers} onSaved={() => void refresh()} />
          )}

          {/* Section 4: Resume Review */}
          {section === 'resume' && (
            <JobResumeReview
              job={job}
              artifacts={data.artifacts}
              events={data.events}
              onSaved={() => void refresh()}
              navigate={navigate}
            />
          )}

          {/* Section 5: Application History */}
          {section === 'history' && (
            <section className={`${cardClass} p-6 space-y-4`}>
              <div>
                <h2 className="text-lg font-bold text-slate-900 dark:text-white flex items-center gap-2">
                  <History className="h-5 w-5 text-vermilion-500" />
                  Application History
                </h2>
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                  Resume approval and email sent do not mean application submitted.
                </p>
              </div>

              {!data.events.length && (
                <p className="text-xs text-slate-500 dark:text-slate-400 py-4">
                  No recorded history.
                </p>
              )}

              <ol className="divide-y divide-slate-100 dark:divide-slate-800">
                {data.events.map((event) => (
                  <li key={event.id} className="py-3 text-xs space-y-1.5 break-words">
                    <div className="flex items-center gap-2 text-slate-500">
                      <time className="font-mono text-[11px]">{event.created_at}</time>
                      <span>—</span>
                      <span className="font-semibold text-slate-700 dark:text-slate-300">
                        {event.actor.kind}
                      </span>
                    </div>

                    {event.payload.kind === 'channel_action' ? (
                      <div className="rounded-lg bg-slate-50 dark:bg-slate-900/40 p-3 space-y-1 border border-slate-200/60 dark:border-slate-800">
                        <p className="font-semibold text-slate-900 dark:text-white">
                          {event.payload.action} — {event.payload.status.replace('_', ' ')}
                        </p>
                        <p>
                          {event.payload.channel} → {event.payload.destination}
                        </p>
                        <p className="text-[11px] text-slate-500">
                          Verification: {event.payload.verification_method}. Confirmation:{' '}
                          {event.payload.confirmation_reference ?? 'None'}
                        </p>
                        <p className="text-[11px] text-slate-500">
                          Artifact: {event.payload.artifact_version_id ?? 'None'}
                        </p>
                        {event.payload.original_notes && <p>{event.payload.original_notes}</p>}
                      </div>
                    ) : event.payload.kind === 'application_transition' ||
                      event.payload.kind === 'preparation_transition' ? (
                      <p className="text-slate-800 dark:text-slate-200">
                        {event.payload.kind}: {event.payload.from} → {event.payload.to} —{' '}
                        {event.payload.reason}
                      </p>
                    ) : event.payload.kind === 'resume_review' ? (
                      <p className="text-emerald-700 dark:text-emerald-400 font-medium">
                        Resume approved: {event.payload.artifact_version_id} (not submitted)
                      </p>
                    ) : event.payload.kind === 'proposal_review' ? (
                      <p>Proposal review saved: revision {event.payload.revision}</p>
                    ) : (
                      <div className="rounded-lg bg-slate-50 dark:bg-slate-900/40 p-3 space-y-1">
                        <p className="font-medium">
                          Imported status: {event.payload.original_status ?? 'Unknown'}
                        </p>
                        <p>{event.payload.notes}</p>
                        <pre className="whitespace-pre-wrap break-words text-[11px] font-mono text-slate-600 dark:text-slate-400">
                          {event.payload.events_json}
                        </pre>
                      </div>
                    )}
                  </li>
                ))}
              </ol>
            </section>
          )}
        </>
      )}
    </div>
  );
}
