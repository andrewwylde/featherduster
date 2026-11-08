import { useEffect, useRef, useState } from 'react';
import { apiClient, type JobsDetail, type ResumeRecord } from '../../api/client.js';
import { useIntentKey } from '../../hooks/useJobsData.js';
import { ResumeVariantPicker } from '../../components/ResumeVariantPicker.js';
import { cardClass, primaryButton, secondaryButton } from '../tailoring/ui.js';

/** Review is read-only until the user explicitly requests a new preparation. */
export function JobInputReview({ data, navigate, initialResumes }: {
  data: JobsDetail;
  navigate(path: string): void;
  initialResumes?: ResumeRecord[];
}) {
  const { job, posting } = data;
  const captured = data.capturedInputs ?? data.captured;
  const capturedResumePath = captured?.resume_path ?? captured?.input?.resolved_resume_path;
  const capturedResumeFingerprint = captured?.resume_fingerprint ?? captured?.input?.resolved_resume_fingerprint;
  const capturedResumeId = captured?.resume_id ?? captured?.input?.base_resume?.id;
  const capturedCreatedAt = captured?.input?.created_at;

  const [resumes, setResumes] = useState<ResumeRecord[]>(initialResumes ?? []);
  const defaultResume = resumes.find(r => r.type === 'template') ?? (data.resolvedDefaultId ? resumes.find(r => r.id === data.resolvedDefaultId) : undefined) ?? resumes[0];
  const [baseId, setBaseId] = useState(job.base_resume_id ?? defaultResume?.id ?? '');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const pending = useRef(false);
  const capturedRef = useRef<{ key: string; id: string }>();
  const intent = useIntentKey();

  useEffect(() => {
    let active = true;
    apiClient.getResumes().then(values => {
      if (!active) return;
      const saved = values.filter(r => !!r.filePath);
      setResumes(saved);
      const def = saved.find(r => r.type === 'template') ?? (data.resolvedDefaultId ? saved.find(r => r.id === data.resolvedDefaultId) : undefined) ?? saved[0];
      setBaseId(job.base_resume_id ?? def?.id ?? '');
    }).catch(e => { if (active) setError(e instanceof Error ? e.message : 'Could not load starting resumes.'); });
    return () => { active = false; };
  }, [job.base_resume_id, data.resolvedDefaultId]);

  const selected = resumes.find(r => r.id === baseId);
  const resolvedDefaultLabel = defaultResume?.filePath || defaultResume?.name || (data.resolvedDefaultId && (capturedResumeId === data.resolvedDefaultId || capturedResumePath) ? capturedResumePath : undefined) || data.resolvedDefaultId;
  const isExplicitSelection = Boolean(baseId && (!defaultResume || baseId !== defaultResume.id));
  const nextSelectionText = isExplicitSelection && selected
    ? (selected.filePath || selected.name || selected.id)
    : resolvedDefaultLabel
      ? `Default: ${resolvedDefaultLabel}`
      : selected
        ? (selected.filePath || selected.name || selected.id)
        : 'Starting resume';

  const prepare = async () => {
    const effectiveId = baseId || defaultResume?.id;
    if (pending.current || !effectiveId) return;
    pending.current = true; setBusy(true); setError('');
    try {
      const key = JSON.stringify([job.revision, effectiveId]);
      if (capturedRef.current?.key !== key) {
        const result = await apiClient.captureJobInputs(job.id, job.revision, { base_resume_id: effectiveId });
        if (result.unapplied_base_corrections?.length) throw new Error('Some earlier starting-resume corrections no longer match. Review those corrections in Resume before preparing again.');
        capturedRef.current = { key, id: result.input_snapshot.id };
      }
      const action = job.preparation_state === 'needs_input' ? 'resume' : job.preparation_state === 'resume_ready' ? 'reprepare' : job.preparation_state === 'failed' ? 'retry' : 'prepare';
      const body = { expected_revision: job.revision, input_snapshot_id: capturedRef.current.id };
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
    {captured && (
      <div data-testid="captured-inputs-section" className="rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900/60 p-4 space-y-1.5 text-sm">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">Captured inputs for active draft/PDF</h3>
        <div data-testid="captured-resume-label" className="font-medium text-slate-900 dark:text-slate-100">
          {capturedResumePath || capturedResumeId || 'Saved base resume'} (Captured for current draft)
        </div>
        {capturedResumeFingerprint && (
          <div data-testid="captured-resume-fingerprint" className="text-xs text-slate-500 font-mono">
            Fingerprint: {capturedResumeFingerprint}
          </div>
        )}
        {capturedCreatedAt && (
          <div className="text-xs text-slate-500">
            Captured: <time>{new Date(capturedCreatedAt).toLocaleString()}</time>
          </div>
        )}
      </div>
    )}
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <label className="block text-sm font-semibold">Next preparation selection
          <select className="sr-only" aria-label="Starting resume" value={baseId} disabled={busy} onChange={e => setBaseId(e.target.value)}>
            {resolvedDefaultLabel ? (
              <option value="">Default: {resolvedDefaultLabel}</option>
            ) : (
              <option value="">Select a saved starting resume</option>
            )}
            {resumes.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}
          </select>
        </label>
        <span data-testid="next-selection-label" className="text-xs font-mono text-slate-500 dark:text-slate-400">
          {nextSelectionText}
        </span>
      </div>
      <ResumeVariantPicker
        options={resumes.map(r => ({
          id: r.id,
          name: r.name,
          type: r.type,
          filePath: r.filePath,
          extension: r.filePath ? r.filePath.split('.').pop() : undefined,
          modifiedAt: (r as any).modifiedAt,
        }))}
        value={baseId}
        onSelect={setBaseId}
      />
    </div>
    {selected && <details><summary>Preview starting resume</summary><p className="whitespace-pre-wrap">{selected.spec.profile.name} — {selected.spec.profile.title}</p><p>{selected.spec.summary}</p></details>}
    <div><h3 className="font-semibold">Current posting and context</h3><p className="whitespace-pre-wrap max-h-64 overflow-y-auto text-sm">{posting?.text ?? 'No saved posting. Add posting text before preparing.'}</p></div>
    <p className="text-sm">Preparation uses current evidence and support for this job, current privacy rules, and the selected starting resume.</p>
    <button className={secondaryButton} disabled={busy} onClick={() => navigate(`/jobs/${job.id}/posting`)}>Edit job details and posting</button>
    <p>Your saved draft and previous PDFs are retained. This generates a new resume; edits in the old draft are not automatically carried over.</p>
    {error && <p role="alert">{error}</p>}
    <button className={primaryButton} disabled={busy || (!selected && !defaultResume) || !posting || !['saved', 'queued', 'needs_input', 'resume_ready', 'failed'].includes(job.preparation_state)} onClick={() => void prepare()}>{busy ? 'Preparing…' : 'Prepare with current inputs'}</button>
  </section>;
}
