import { useEffect, useRef, useState } from 'react';
import { compileMarkdownResume, type ArtifactVersion, type Job, type JobEvent } from '@featherduster/core';
import { apiClient, ApiError, type JobReview } from '../../api/client.js';
import { useIntentKey } from '../../hooks/useJobsData.js';
import { BriefMarkdown } from '../tailoring/steps/BriefStep.js';
import { wordDiff } from '../tailoring/wordDiff.js';

export function JobResumeReview({ job, artifacts, events, onSaved, navigate }: { job: Job; artifacts: ArtifactVersion[]; events: JobEvent[]; onSaved: () => void; navigate: (path: string) => void }) {
  const [selected, setSelected] = useState(artifacts.at(-1)?.id ?? '');
  const [review, setReview] = useState<JobReview | null>(null);
  const [revision, setRevision] = useState(job.revision);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [conflict, setConflict] = useState(false);
  const [reload, setReload] = useState(0);
  const pending = useRef(false);
  const intentKey = useIntentKey();
  useEffect(() => { if (!selected && artifacts.length) setSelected(artifacts.at(-1)!.id); }, [artifacts, selected]);
  useEffect(() => {
    let live = true; setReview(null); setError(''); setConflict(false); setRevision(job.revision);
    if (selected) apiClient.getJobReview(job.id, selected).then(r => { if (live) setReview(r); }, e => { if (live) setError(e.message); });
    return () => { live = false; };
  }, [job.id, selected, reload]); // Revision is bound to the displayed review, not polling updates.
  const act = async (editing: boolean) => {
    if (!review || pending.current) return;
    pending.current = true; setBusy(true); setError('');
    const a = review.artifact;
    const payload = { expected_job_revision: revision, artifact_fingerprint: a.version_fingerprint };
    try {
      if (editing) {
        const { draft } = await apiClient.editJobResume(job.id, a.id, { ...payload, idempotency_key: intentKey({ editing, id: a.id, ...payload }) });
        navigate(`/tailor/canvas/jobs/${job.id}/${draft.id}`);
      } else {
        await apiClient.approveJobResume(job.id, a.id, { ...payload, input_snapshot_id: a.input_snapshot_id, input_fingerprint: a.input_fingerprint, idempotency_key: intentKey({ editing, id: a.id, ...payload }) });
        onSaved();
      }
    } catch (e) { setError(e instanceof Error ? e.message : 'Review action failed'); if (e instanceof ApiError && e.status === 409) setConflict(true); }
    finally { pending.current = false; setBusy(false); }
  };
  const approved = review && events.find(e => e.payload.kind === 'resume_review' && e.payload.artifact_version_id === review.artifact.id && e.payload.artifact_fingerprint === review.artifact.version_fingerprint && e.payload.input_fingerprint === review.artifact.input_fingerprint);
  if (!artifacts.length) return <p>No resume artifact yet. Prepare a resume first.</p>;
  return <section className="space-y-4 min-w-0">
    <label>Artifact version <select className="max-w-full border bg-transparent p-2" value={selected} disabled={busy} onChange={e => setSelected(e.target.value)}>{artifacts.map(a => <option key={a.id} value={a.id}>{a.created_at} — {a.id}</option>)}</select></label>
    {error && <p role="alert">{error}</p>}
    <button className="min-h-[44px] underline" disabled={busy} onClick={() => { onSaved(); setReload(n => n + 1); }}>Reload review</button>
    {!review && !error && <p>Loading verified review…</p>}
    {review && <>
      <p>Validation: {review.artifact.validation_result}. Human approval: {approved ? `Approved ${approved.created_at}` : 'Not approved for this version'}.</p>
      <div className="flex flex-wrap gap-3">
        <button className="min-h-[44px] border rounded px-4" disabled={busy || conflict || job.revision !== revision || review.artifact.validation_result !== 'passed' || !review.artifact.pdf} onClick={() => void act(false)}>Approve Resume</button>
        <button className="min-h-[44px] border rounded px-4" disabled={busy || conflict || job.revision !== revision} onClick={() => void act(true)}>Continue Editing</button>
      </div>
      {job.revision !== revision && <p>Job changed. Reload review before taking action.</p>}
      {review.artifact.pdf ? <><a className="underline" href={apiClient.jobPdfUrl(job.id, selected)} target="_blank" rel="noreferrer">Open PDF</a><iframe title="Resume PDF preview" className="hidden md:block w-full h-[600px]" src={apiClient.jobPdfUrl(job.id, selected)} /></> : <p>PDF unavailable.</p>}
      {review.preview_count ? Array.from({ length: review.preview_count }, (_, i) => <img className="max-w-full md:hidden" key={i} alt={`Resume page ${i + 1}`} src={apiClient.jobPreviewUrl(job.id, selected, i + 1)} />) : <p>No preview pages available. Use the PDF link.</p>}
      <details><summary>Validation diagnostics</summary><pre className="whitespace-pre-wrap break-words">{JSON.stringify(review.validation_report, null, 2)}</pre></details>
      <h2 className="font-semibold">Base to candidate diff</h2>
      <div className="whitespace-pre-wrap break-words">{wordDiff(compileMarkdownResume(review.base_resume), compileMarkdownResume(review.draft.candidate)).map((part, i) => part.type === 'added' ? <ins className="bg-green-100 text-green-900" key={i}>{part.text}</ins> : part.type === 'removed' ? <del className="bg-red-100 text-red-900" key={i}>{part.text}</del> : <span key={i}>{part.text}</span>)}</div>
      <h2 className="font-semibold">Proposal rationales and citations</h2><pre className="whitespace-pre-wrap break-words">{JSON.stringify(review.draft.proposals, null, 2)}</pre>
      <h2 className="font-semibold">Evidence alignment</h2><pre className="whitespace-pre-wrap break-words">{review.alignment ? JSON.stringify(review.alignment, null, 2) : 'Not assessed'}</pre>
      <h2 className="font-semibold">Brief</h2>{review.brief_markdown ? <BriefMarkdown markdown={review.brief_markdown} /> : <p>No brief available.</p>}
    </>}
  </section>;
}
