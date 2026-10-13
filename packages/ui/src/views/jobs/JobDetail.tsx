import { useCallback, useRef, useState } from 'react';
import { apiClient } from '../../api/client.js';
import { useIntentKey, useJobsData } from '../../hooks/useJobsData.js';
import { jobSections, type JobSection } from '../../routing.js';
import { WorkerControls } from './WorkerControls.js';
import { JobIntake } from './JobIntake.js';
import { JobAnswers } from './JobAnswers.js';
import { JobResumeReview } from './JobResumeReview.js';

export function JobDetail({ id, section, navigate }: { id: string; section: JobSection; navigate: (path: string) => void }) {
  const load = useCallback(() => apiClient.getJob(id), [id]);
  const { data, error, refresh } = useJobsData(load);
  const [failure, setFailure] = useState('');
  const [busy, setBusy] = useState(false);
  const pending = useRef(false);
  const captured = useRef<{ revision: number; id: string } | null>(null);
  const intentKey = useIntentKey();
  const prepare = async (action: 'prepare' | 'resume' | 'retry') => {
    if (!data || pending.current) return;
    pending.current = true; setBusy(true); setFailure('');
    try {
      let input = action !== 'prepare' ? data.attempt?.input_snapshot_id : null;
      if (!input) {
        if (captured.current?.revision !== data.job.revision) captured.current = { revision: data.job.revision, id: (await apiClient.captureJobInputs(id, data.job.revision)).input_snapshot.id };
        input = captured.current!.id;
      }
      const body = { expected_revision: data.job.revision, input_snapshot_id: input };
      await apiClient.prepareJob(id, action, { ...body, idempotency_key: intentKey({ action, ...body }) });
      await refresh();
    } catch (e) { setFailure(e instanceof Error ? e.message : 'Preparation failed'); }
    finally { pending.current = false; setBusy(false); }
  };
  const job = data?.job;
  return <div className="space-y-4 min-w-0">
    <button className="underline min-h-[44px]" onClick={() => navigate('/jobs')}>Back to Jobs</button><WorkerControls />
    {error && <p role="alert">{error} <button onClick={() => void refresh()}>Reload job</button></p>}
    {!data && !error && <p>Loading job…</p>}
    {data && job && <>
      <h1 className="text-2xl font-bold">{job.company ?? 'Unknown company'} — {job.role ?? 'Untitled role'}</h1>
      <p>Preparation: {job.preparation_state} · Application: {job.application_lifecycle}</p><p>{job.preparation_stage} {job.state_reason}</p>
      {job.kind === 'job' && <div className="flex flex-wrap gap-3">
        {job.preparation_state === 'queued' && <button className="min-h-[44px] border rounded px-3" disabled={busy} onClick={() => void prepare('prepare')}>Prepare resume</button>}
        {job.preparation_state === 'needs_input' && <button className="min-h-[44px] border rounded px-3" disabled={busy} onClick={() => void prepare('resume')}>Resume job</button>}
        {['failed', 'interrupted', 'cancelled'].includes(job.preparation_state) && <button className="min-h-[44px] border rounded px-3" disabled={busy} onClick={() => void prepare('retry')}>Retry</button>}
        <a href="/settings" className="underline">Settings (runner, consent and tools)</a>
      </div>}
      {failure && <p role="alert">{failure} <button onClick={() => void refresh()}>Reload job</button></p>}
      <nav aria-label="Job sections" className="flex gap-4 overflow-x-auto border-b">{Object.entries(jobSections).map(([key, label]) => <a className="min-h-[44px] shrink-0 py-3 underline" aria-current={section === key ? 'page' : undefined} key={key} href={`/jobs/${id}/${key}`} onClick={e => { if (!e.metaKey && !e.ctrlKey) { e.preventDefault(); navigate(`/jobs/${id}/${key}`); } }}>{label}</a>)}</nav>
      {section === 'posting' && <section className="space-y-3"><h2>Posting</h2>{data.posting ? <><p>Original: {data.posting.original_url ?? 'Pasted text'} · Final: {data.posting.final_url ?? 'Pasted text'} · Captured: {data.posting.captured_at}</p><pre className="whitespace-pre-wrap break-words font-sans">{data.posting.text}</pre></> : <p>No captured posting.</p>}{job.missing_inputs.some(q => q.key === 'posting_text') && <JobIntake fallback={{ id, revision: job.revision }} onSaved={() => void refresh()} />}</section>}
      {section === 'fit' && <section className="space-y-3"><h2>Fit</h2>{data.analysis ? <>
        <h3>Requirements and posting quotes</h3><p>{data.analysis.mission}</p>
        <ul className="space-y-3">{data.analysis.requirements.map(r => <li className="border rounded p-3" key={r.id}><p>{r.text}</p><blockquote className="border-l-2 pl-3">{r.quote}</blockquote></li>)}</ul>
        <h3>Backed, transferable and gap evidence</h3>
        <ul>{data.alignment ? data.alignment.rows.map(row => <li className="border-b py-3" key={row.requirement_id}>{row.requirement_id}: <strong>{row.classification}</strong><p>{row.rationale}</p><p>Citations: {row.citations.join(', ') || 'None'}</p>{row.issues?.map((issue, i) => <p key={i}>{issue.severity}: {issue.message}</p>)}</li>) : <li>Not assessed</li>}</ul>
      </> : <p>Not assessed</p>}</section>}
      {section === 'answers' && <JobAnswers job={job} answers={data.answers} onSaved={() => void refresh()} />}
      {section === 'resume' && <JobResumeReview job={job} artifacts={data.artifacts} events={data.events} onSaved={() => void refresh()} navigate={navigate} />}
      {section === 'history' && <section><h2>Application History</h2><p>Resume approval and email sent do not mean application submitted.</p>{!data.events.length && <p>No recorded history.</p>}
        <ol>{data.events.map(event => <li className="border-b py-3 break-words" key={event.id}><time>{event.created_at}</time> — {event.actor.kind}
          {event.payload.kind === 'channel_action' ? <div><p>{event.payload.action} — {event.payload.status.replace('_', ' ')}</p><p>{event.payload.channel} → {event.payload.destination}</p><p>Verification: {event.payload.verification_method}. Confirmation: {event.payload.confirmation_reference ?? 'None'}</p><p>Artifact: {event.payload.artifact_version_id ?? 'None'}</p><p>{event.payload.original_notes}</p></div>
            : event.payload.kind === 'application_transition' || event.payload.kind === 'preparation_transition' ? <p>{event.payload.kind}: {event.payload.from} → {event.payload.to} — {event.payload.reason}</p>
            : event.payload.kind === 'resume_review' ? <p>Resume approved: {event.payload.artifact_version_id} (not submitted)</p>
            : <div><p>Imported status: {event.payload.original_status ?? 'Unknown'}</p><p>{event.payload.notes}</p><pre className="whitespace-pre-wrap break-words">{event.payload.events_json}</pre></div>}
        </li>)}</ol>
      </section>}
    </>}
  </div>;
}
