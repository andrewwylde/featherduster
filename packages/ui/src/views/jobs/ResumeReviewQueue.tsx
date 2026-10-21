import { useCallback, useEffect, useState } from 'react';
import type { ArtifactVersion, PreparationQueueItem } from '@featherduster/core';
import { apiClient, type PreparationBatchProgress } from '../../api/client.js';
import { useIntentKey, useJobsData } from '../../hooks/useJobsData.js';
import { JobResumeReview } from './JobResumeReview.js';
import { advanceReviewPass, emptyReviewPass, reconcileReviewPass, queueIdentity, type ReviewQueuePass } from './resume-review-queue-model.js';
import { cardClass, secondaryButton } from '../tailoring/ui.js';

export function ResumeReviewQueue({ batchId, navigate }: { batchId: string; navigate: (path: string) => void }) {
  const load = useCallback(() => apiClient.getPreparationBatch(batchId), [batchId]);
  const { data, error, refresh } = useJobsData(load);
  const storageKey = `resume-review-pass:${batchId}`;
  const [pass, setPass] = useState<ReviewQueuePass>(() => {
    try {
      const saved = JSON.parse(sessionStorage.getItem(storageKey) ?? 'null');
      if (saved && (saved.activeJob === null || typeof saved.activeJob === 'string') && Array.isArray(saved.deferred) && Array.isArray(saved.reviewed)) return saved;
    } catch { /* a corrupt saved pass never grants approval */ }
    return emptyReviewPass();
  });
  useEffect(() => { if (data) setPass(previous => reconcileReviewPass(data.queue, previous)); }, [data]);
  useEffect(() => { sessionStorage.setItem(storageKey, JSON.stringify(pass)); }, [pass, storageKey]);
  const deferredCount = data?.queue.filter(item => pass.deferred.includes(queueIdentity(item))).length ?? 0;
  const advance = (item: PreparationQueueItem, action: 'approved' | 'later') => {
    if (data) setPass(previous => advanceReviewPass(data.queue, previous, item, action));
    void refresh();
  };
  return <main className="max-w-5xl mx-auto space-y-4 min-w-0">
    <header className="space-y-2"><h1 className="text-lg sm:text-2xl font-semibold">Review prepared resumes</h1>
      <details><summary className="cursor-pointer min-h-8 text-sm underline">Queue progress and actions</summary>
      <div className="space-y-2 py-2"><p>Review each current PDF, then approve its exact version. Approval never downloads or submits an application.</p>
      {data && <p role="status">Preparing {data.counts.preparing} · Needs your answer {data.counts.questions} · Ready for your review {data.counts.ready} · Approved {data.counts.approved}</p>}
      <div className="flex flex-wrap gap-3"><button className={secondaryButton} onClick={() => navigate(`/jobs/preparation-batches/${batchId}/questions`)}>Answer preparation questions</button>
        <button onClick={event => { void refresh(); const panel = event.currentTarget.closest('details'); if (panel) panel.open = false; }}>Refresh progress</button><button onClick={() => navigate('/jobs')}>Saved jobs</button></div></div></details>
    </header>
    {error && <p role="alert">{error}</p>}
    {data && data.counts.technical > 0 && <details className="space-y-3"><summary className="cursor-pointer text-sm underline">Other jobs: {data.counts.technical} need recovery — review actions</summary>
      {data.members.filter(m => m.state === 'technical').map(member => <TechnicalRecovery key={member.job_id} jobId={member.job_id} company={member.company} role={member.role} reviewInputsFirst={member.recovery_action === 'refresh_inputs'} diagnostic={member.diagnostic} refresh={refresh} navigate={navigate} />)}
    </details>}
    {data && pass.activeJob ? <QueueResume key={pass.activeJob} jobId={pass.activeJob} progress={data} refresh={() => void refresh()} navigate={navigate}
      onApproved={artifact => advance({ job_id: artifact.job_id, artifact_id: artifact.id, artifact_fingerprint: artifact.version_fingerprint, approved: true }, 'approved')}
      onLater={item => advance(item, 'later')} /> : data ? <section className={`${cardClass} p-5 space-y-3`}>
      <h2>{data.counts.preparing ? 'Preparation continues' : deferredCount ? 'All remaining resumes reviewed later' : 'Review pass complete'}</h2>
      <p>Approved {data.counts.approved} · Deferred {deferredCount}. Deferred versions remain unapproved.</p>
      {deferredCount > 0 && <button className={secondaryButton} onClick={() => setPass(previous => reconcileReviewPass(data.queue, { ...previous, deferred: [], activeJob: null }))}>Revisit deferred resumes</button>}
      <ul>{data.queue.map(item => <li key={item.artifact_id} className="py-2 space-x-2"><span>{item.company} — {item.role}</span><a href={apiClient.jobPdfUrl(item.job_id, item.artifact_id) + '?download=1'}>Download {item.approved ? 'approved' : 'unapproved'} PDF</a><button onClick={() => setPass(previous => ({ ...previous, activeJob: item.job_id }))}>Review {item.company ?? 'resume'}</button>{item.posting_url && <a href={item.posting_url} target="_blank" rel="noreferrer">Original job posting</a>}</li>)}</ul>
    </section> : <p role="status">Loading preparation…</p>}
  </main>;
}
function TechnicalRecovery({ jobId, company, role, reviewInputsFirst, diagnostic, refresh, navigate }: { jobId: string; company?: string | null; role?: string | null; reviewInputsFirst?: boolean; diagnostic?: string; refresh: () => Promise<void>; navigate: (path: string) => void }) {
  const [error, setError] = useState(''), [busy, setBusy] = useState(false), key = useIntentKey();
  return <section aria-label={`Preparation recovery for ${company ?? jobId}`} className={`${cardClass} p-4 space-y-2`}><h2 className="font-semibold">{company} — {role}: {reviewInputsFirst ? 'Starting inputs changed' : 'Preparation needs technical recovery'}</h2><p>Your saved work is retained. {reviewInputsFirst ? 'Review the changed inputs before preparing again.' : 'No factual confirmation is needed for this failure.'}</p>
    <div className="flex flex-wrap gap-2">{!reviewInputsFirst && <button className={secondaryButton} disabled={busy} onClick={async () => { setBusy(true); setError(''); try { const { job } = await apiClient.getJob(jobId); await apiClient.retryAutomaticPreparation(jobId, { expected_revision: job.revision, idempotency_key: key({ jobId, revision: job.revision }) }); await refresh(); } catch (e) { setError((e as Error).message); } finally { setBusy(false); } }}>Retry checks</button>}
    <button className={secondaryButton} onClick={() => navigate(`/jobs/${jobId}/inputs`)}>Review current inputs</button></div><details><summary>Technical details</summary><p className="break-words">{diagnostic}</p></details>{error && <p role="alert">{error}</p>}</section>;
}
function QueueResume({ jobId, progress, navigate, refresh, onApproved, onLater }: { jobId: string; progress: PreparationBatchProgress;
  navigate: (path: string) => void; refresh: () => void; onApproved: (artifact: ArtifactVersion) => void; onLater: (item: PreparationQueueItem) => void }) {
  const load = useCallback(() => apiClient.getJob(jobId), [jobId]), { data, error, refresh: reload } = useJobsData(load);
  const [undoError, setUndoError] = useState(''), [undoing, setUndoing] = useState(false), key = useIntentKey();
  const current = progress.queue.find(q => q.job_id === jobId), position = progress.batch.members.findIndex(m => m.job_id === jobId) + 1;
  const onSaved = () => { void reload(); refresh(); };
  if (!data) return <p role={error ? 'alert' : 'status'}>{error ?? 'Loading current resume…'}</p>;
  return <article className="space-y-3 min-w-0"><header><p>Selection {position} of {progress.batch.members.length} · {progress.queue.filter(q => !q.approved).length} awaiting approval</p>
    <h2 className="text-xl font-semibold">{data.job.company} — {data.job.role}</h2>
    {(data.job.canonical_url ?? data.job.original_url ?? data.job.context_url) && <a className="underline" href={data.job.canonical_url ?? data.job.original_url ?? data.job.context_url ?? ''} target="_blank" rel="noreferrer">Original job posting</a>}</header>
    {(progress.repairs ?? []).filter(r => r.job_id === jobId && r.meaningful).map(repair => <section key={repair.id} className="space-y-1 text-xs"><h3 className="font-semibold">{repair.undone ? 'Automatic wording change — undone as a checked edit' : 'Automatic wording change'}</h3>
      <p><del>{repair.before}</del> → <span>{repair.after}</span></p>
      <details><summary className="cursor-pointer underline">Change details and Undo</summary><p>{repair.reason}</p>
      <button className="min-h-11 underline" disabled={undoing || repair.undone} onClick={async () => { setUndoing(true); setUndoError(''); try { await apiClient.undoPreparationRepair(jobId, repair.id, { expected_revision: data.job.revision, idempotency_key: key({ repair: repair.id, revision: data.job.revision }) }); onSaved(); } catch (e) { setUndoError((e as Error).message); } finally { setUndoing(false); } }}>Undo wording change</button></details></section>)}
    {(progress.decisions ?? []).filter(d => d.job_id === jobId).map(decision => <section key={decision.id} className="space-y-1 text-xs"><h3>{decision.decision === 'omit' ? 'Omission you approved during preparation' : 'Narrower wording you selected'}</h3><p>{decision.before}</p>{decision.after && <p>{decision.after}</p>}<p>{decision.reason}</p></section>)}
    {undoError && <p role="alert">{undoError}</p>}
    <JobResumeReview job={data.job} artifacts={data.artifacts} events={data.events} onSaved={onSaved} navigate={navigate}
      queue={{ artifactId: current?.artifact_id ?? null, repairHistory: progress.repairs.filter(repair => repair.job_id === jobId), onApproved, onLater: () => { if (current) onLater(current); } }} />
  </article>;
}
