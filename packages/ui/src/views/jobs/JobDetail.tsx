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
import { JobDetailsEditor } from './JobDetailsEditor.js';
import { JobIntake } from './JobIntake.js';
import { JobAnswers } from './JobAnswers.js';
import { JobMaterialReview } from './JobMaterialReview.js';
import { JobFitReview } from './JobFitReview.js';
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
      let input = (!data.activity || data.activity === 'resume') && action !== 'prepare' && data.job.recovery?.kind !== 'stale_inputs' ? data.attempt?.input_snapshot_id : null;
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
  const focusedCorrection = section === 'resume' && hasReview && job?.preparation_state === 'needs_input';
  const setup = job?.recovery?.kind === 'setup';
  const recoveryAction = hasReview ? { label: 'Resolve proposals', path: `/jobs/${id}/resume` }
    : setup ? { label: 'Resolve setup', path: '/settings' }
    : canRecover ? { label: 'Recover proposal review', path: `/jobs/${id}/resume` }
    : job?.recovery?.kind === 'render' ? { label: 'Inspect render failure', path: `/jobs/${id}/resume` }
    : job?.recovery && !['fact', 'stale_inputs'].includes(job.recovery.kind) ? { label: 'Resolve proposals', path: `/jobs/${id}/resume` } : null;

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
    <div className="space-y-4 max-w-6xl mx-auto min-w-0">
      {/* Top Breadcrumb & Return */}
      <div className="flex items-center justify-between">
        <button
          className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white transition-colors min-h-[44px] underline"
          onClick={() => navigate('/jobs')}
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          Back to saved jobs
        </button>
      </div>



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
          <div className={`${cardClass} p-4 space-y-3`}>
            <div className="flex flex-col md:flex-row md:items-start md:justify-between gap-4">
              <div className="space-y-1.5">
                <div className={focusedCorrection ? 'hidden' : 'flex items-center gap-2'}>
                  <span className="text-xs font-mono uppercase tracking-wider text-slate-500 dark:text-slate-400">
                    Job Details
                  </span>
                  {(job.context_url || job.canonical_url) && (
                    <a
                      href={job.context_url || job.canonical_url || undefined}
                      target="_blank"
                      rel="noreferrer"
                      className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 inline-flex items-center gap-0.5 text-xs"
                    >
                      <ExternalLink className="h-3 w-3" />
                      Posting link
                    </a>
                  )}
                </div>

                <h1 className={`${focusedCorrection ? 'text-base sm:text-xl' : 'text-xl sm:text-2xl'} font-bold tracking-tight text-slate-900 dark:text-white`}>
                  {job.company ?? 'Unknown company'} — {job.role ?? 'Untitled role'}
                </h1>

                <p className={focusedCorrection ? 'hidden' : 'text-xs text-slate-500 dark:text-slate-400'}>
                  {job.preparation_state === 'saved' ? 'Saved. Choose an optional activity below.' : job.preparation_state === 'resume_ready' ? 'Resume available for review.' : job.preparation_state === 'needs_input' ? 'Preparation needs your attention.' : data.activity === 'fit' ? 'Fit assessment' : data.activity === 'cover_letter' ? 'Cover-letter preparation' : data.activity === 'interview_brief' ? 'Interview-brief preparation' : 'Resume preparation'}
                </p>

                <p className={focusedCorrection ? 'hidden' : 'text-xs font-medium text-slate-700 dark:text-slate-300'}>
                  {job.state_reason}
                </p>
              </div>

              {section === 'posting' && <button className={primaryButton} onClick={() => navigate(`/jobs/${id}/resume`)}>Tailor resume</button>}
              {/* Action Buttons */}
              {!focusedCorrection && job.kind === 'job' && (section === 'resume' || section === 'posting') && (
                <div className="flex flex-wrap items-center gap-2.5">
                  {section === 'resume' && ['saved', 'queued'].includes(job.preparation_state) && (
                    <button
                      className={`${primaryButton} text-xs font-semibold`}
                      disabled={busy}
                      onClick={() => void prepare('prepare')}
                    >
                      <Sparkles className="h-3.5 w-3.5" />
                      Prepare resume
                    </button>
                  )}

                  {job.preparation_state === 'needs_input' && !(section === 'resume' && hasReview) && (
                    <button
                      className={`${primaryButton} text-xs font-semibold`}
                      disabled={busy}
                      onClick={() => recoveryAction ? navigate(recoveryAction.path) : void prepare('resume')}
                    >
                      <RefreshCw className="h-3.5 w-3.5" />
                      {recoveryAction?.label ?? (job.recovery?.kind === 'stale_inputs' ? 'Prepare with current context' : 'Resume job')}
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

            {setup && section !== 'fit' && <p role="status">Last attempt setup diagnostic: {job.state_reason}. PDF tools must be repaired in the service environment, not by editing proposals or changing the model timeout. Settings does not automatically restart preparation.</p>}
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

              <JobDetailsEditor key={job.id} job={job} posting={data.posting} onSaved={() => void refresh()} />
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
          {section === 'fit' && <JobFitReview key={id} job={job} onSaved={() => void refresh()} navigate={navigate} />}

          {(section === 'cover_letter' || section === 'interview_brief') && <JobMaterialReview key={`${id}:${section}`} job={job} kind={section} onSaved={() => void refresh()} />}

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

          {/* Section 5: Retained history */}
          {section === 'history' && (
            <section className={`${cardClass} p-6 space-y-4`}>
              <div>
                <h2 className="text-lg font-bold text-slate-900 dark:text-white flex items-center gap-2">
                  <History className="h-5 w-5 text-vermilion-500" />
                  Retained history
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
      <WorkerControls
        jobs={job ? [job] : []}
        onJobMutated={() => void refresh()}
        navigate={navigate}
      />
    </div>
  );
}
