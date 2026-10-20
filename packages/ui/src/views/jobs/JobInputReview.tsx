import { useEffect, useRef, useState } from 'react';
import { apiClient, type JobsDetail, type ResumeRecord } from '../../api/client.js';
import { useIntentKey } from '../../hooks/useJobsData.js';
import { cardClass, inputClass, primaryButton, secondaryButton } from '../tailoring/ui.js';

/** Review is read-only until the user explicitly requests a new preparation. */
export function JobInputReview({ data, navigate }: { data: JobsDetail; navigate(path: string): void }) {
  const { job, posting } = data;
  const [resumes, setResumes] = useState<ResumeRecord[]>([]);
  const [baseId, setBaseId] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const pending = useRef(false);
  const captured = useRef<{ key: string; id: string }>();
  const intent = useIntentKey();
  useEffect(() => {
    let active = true;
    apiClient.getResumes().then(values => {
      if (!active) return;
      const saved = values.filter(r => !!r.filePath);
      setResumes(saved);
      setBaseId(job.base_resume_id ?? saved.find(r => r.type === 'template')?.id ?? '');
    }).catch(e => { if (active) setError(e instanceof Error ? e.message : 'Could not load starting resumes.'); });
    return () => { active = false; };
  }, [job.base_resume_id]);
  const selected = resumes.find(r => r.id === baseId);
  const prepare = async () => {
    if (pending.current || !selected) return;
    pending.current = true; setBusy(true); setError('');
    try {
      const key = JSON.stringify([job.revision, baseId]);
      if (captured.current?.key !== key) {
        const result = await apiClient.captureJobInputs(job.id, job.revision, { base_resume_id: baseId });
        if (result.unapplied_base_corrections?.length) throw new Error('Some earlier starting-resume corrections no longer match. Review those corrections in Resume before preparing again.');
        captured.current = { key, id: result.input_snapshot.id };
      }
      const action = job.preparation_state === 'needs_input' ? 'resume' : job.preparation_state === 'resume_ready' ? 'reprepare' : job.preparation_state === 'failed' ? 'retry' : 'prepare';
      const body = { expected_revision: job.revision, input_snapshot_id: captured.current.id };
      await apiClient.prepareJob(job.id, action, { ...body, idempotency_key: intent({ action, ...body }) });
      navigate(`/jobs/${job.id}/resume`);
    } catch (e) { setError(e instanceof Error ? e.message : 'Preparation failed. Your saved draft is retained.'); }
    finally { pending.current = false; setBusy(false); }
  };
  return <section className={`${cardClass} p-6 space-y-4`} aria-label="Current resume inputs">
    <h2 className="text-lg font-bold">Current resume inputs</h2>
    <p>Review the saved context below before preparing a new resume for this job.</p>
    {job.recovery?.kind === 'stale_inputs' && <p role="status">The job context has changed since the previous preparation. Retrying checks on the old draft cannot update its inputs.</p>}
    <dl className="space-y-2 text-sm">
      <div><dt className="font-semibold">Company</dt><dd>{job.company ?? 'Not set'}</dd></div>
      <div><dt className="font-semibold">Position</dt><dd>{job.role ?? 'Not set'}</dd></div>
      <div><dt className="font-semibold">Notes</dt><dd className="whitespace-pre-wrap">{job.notes || 'None'}</dd></div>
      <div><dt className="font-semibold">Template</dt><dd>{job.template_id ?? 'Default template'}</dd></div>
      <div><dt className="font-semibold">Runner</dt><dd>{job.runner ?? 'Current workspace runner'}</dd></div>
    </dl>
    <label className="block text-sm font-semibold">Starting resume
      <select className={inputClass} value={baseId} disabled={busy} onChange={e => setBaseId(e.target.value)}>
        <option value="">Select a saved starting resume</option>
        {resumes.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}
      </select>
    </label>
    {selected && <details><summary>Preview starting resume</summary><p className="whitespace-pre-wrap">{selected.spec.profile.name} — {selected.spec.profile.title}</p><p>{selected.spec.summary}</p></details>}
    <div><h3 className="font-semibold">Current posting and context</h3><p className="whitespace-pre-wrap max-h-64 overflow-y-auto text-sm">{posting?.text ?? 'No saved posting. Add posting text before preparing.'}</p></div>
    <p className="text-sm">Preparation uses current evidence and support for this job, current privacy rules, and the selected starting resume.</p>
    <button className={secondaryButton} disabled={busy} onClick={() => navigate(`/jobs/${job.id}/posting`)}>Edit job details and posting</button>
    <p>Your saved draft and previous PDFs are retained. This generates a new resume; edits in the old draft are not automatically carried over.</p>
    {error && <p role="alert">{error}</p>}
    <button className={primaryButton} disabled={busy || !selected || !posting || !['saved', 'queued', 'needs_input', 'resume_ready', 'failed'].includes(job.preparation_state)} onClick={() => void prepare()}>{busy ? 'Preparing…' : 'Prepare with current inputs'}</button>
  </section>;
}
