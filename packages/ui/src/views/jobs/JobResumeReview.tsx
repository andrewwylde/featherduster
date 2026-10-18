import { JobResumeDetails } from './JobResumeDetails.js';
import { describeJobEvent } from './job-utils.js';
import { JobExports } from './JobExports.js';
import { JobProposalReview } from './JobProposalReview.js';
import { useEffect, useRef, useState } from 'react';
import {
  FileText,
  Download,
  GitCompare,
  ShieldCheck,
  Sparkles,
} from 'lucide-react';
import { compileMarkdownResume, type ArtifactVersion, type Job, type JobEvent } from '@featherduster/core';
import { apiClient, ApiError, type JobReview } from '../../api/client.js';
import { useIntentKey } from '../../hooks/useJobsData.js';
import { BriefMarkdown } from '../tailoring/steps/BriefStep.js';
import { wordDiff } from '../tailoring/wordDiff.js';
import { cardClass, inputClass, primaryButton, secondaryButton } from '../tailoring/ui.js';

export function JobResumeReview({
  job,
  artifacts,
  events,
  onSaved,
  navigate,
}: {
  job: Job;
  artifacts: ArtifactVersion[];
  events: JobEvent[];
  onSaved: () => void;
  navigate: (path: string) => void;
}) {
  const [selected, setSelected] = useState(artifacts.at(-1)?.id ?? '');
  const [review, setReview] = useState<JobReview | null>(null);
  const [revision, setRevision] = useState(job.revision);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [conflict, setConflict] = useState(false);
  const [reload, setReload] = useState(0);
  const pending = useRef(false);
  // Set as soon as approval succeeds, before the refreshed events arrive, so the status and focus move together.
  const [approvedHere, setApprovedHere] = useState<string | null>(null);
  const approvalStatus = useRef<HTMLSpanElement>(null);
  const intentKey = useIntentKey();
  const latestArtifact = artifacts.at(-1)?.id ?? '';
  const previousLatest = useRef(latestArtifact);
  useEffect(() => {
    if (selected === previousLatest.current) setSelected(latestArtifact);
    previousLatest.current = latestArtifact;
  }, [latestArtifact, selected]);
  const displayedReview = review?.artifact.id === selected ? review : null;

  const workingDraft = displayedReview?.working_draft;
  const pendingEdits = !!workingDraft && JSON.stringify(workingDraft.candidate) !== JSON.stringify(displayedReview?.draft.candidate);

  useEffect(() => {
    if (!selected && artifacts.length) setSelected(artifacts.at(-1)!.id);
  }, [artifacts, selected]);

  useEffect(() => {
    let live = true;
    setError('');
    setConflict(false);
    setRevision(job.revision);
    if (selected) {
      apiClient.getJobReview(job.id, selected).then(
        (r) => {
          if (live) setReview(r);
        },
        (e) => {
          if (live) setError(e.message);
        }
      );
    }
    return () => {
      live = false;
    };
  }, [job.id, job.revision, selected, reload]);

  const act = async (editing: boolean) => {
    if (!displayedReview || pending.current) return;
    pending.current = true;
    setBusy(true);
    setError('');
    const a = displayedReview.artifact;
    const payload = { expected_job_revision: revision, artifact_fingerprint: a.version_fingerprint };
    try {
      if (editing) {
        const { draft } = await apiClient.editJobResume(job.id, a.id, {
          ...payload,
          idempotency_key: intentKey({ editing, id: a.id, ...payload }),
        });
        navigate(`/tailor/canvas/jobs/${job.id}/${draft.id}`);
      } else {
        await apiClient.approveJobResume(job.id, a.id, {
          ...payload,
          input_snapshot_id: a.input_snapshot_id,
          input_fingerprint: a.input_fingerprint,
          idempotency_key: intentKey({ editing, id: a.id, ...payload }),
        });
        setApprovedHere(a.id);
        onSaved();
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Review action failed');
      if (e instanceof ApiError && e.status === 409) setConflict(true);
    } finally {
      pending.current = false;
      setBusy(false);
    }
  };

  const approved =
    displayedReview &&
    events.find(
      (e) =>
        e.payload.kind === 'resume_review' &&
        e.payload.artifact_version_id === displayedReview.artifact.id &&
        e.payload.artifact_fingerprint === displayedReview.artifact.version_fingerprint &&
        e.payload.input_fingerprint === displayedReview.artifact.input_fingerprint
    );

  const isApproved = Boolean(approved) || (!!displayedReview && approvedHere === displayedReview.artifact.id);
  useEffect(() => { if (approvedHere) approvalStatus.current?.focus(); }, [approvedHere]);

const downloadCurrent = async () => {
  if (!displayedReview || pending.current) return;
  pending.current = true; setBusy(true); setError('');
  try {
    const selection = { artifact_id: displayedReview.artifact.id,
      artifact_fingerprint: displayedReview.artifact.version_fingerprint, dossier: false };
    const response = await fetch(`/api/jobs/${job.id}/exports/current/resume.pdf?selection=${encodeURIComponent(JSON.stringify(selection))}&download=1`);
    if (!response.ok) { const body = await response.json(); throw Error(body.error ?? 'Download failed. Retry.'); }
    const blob = await response.blob(), href = URL.createObjectURL(blob), link = document.createElement('a');
    link.href = href; link.download = 'resume.pdf'; link.click();
    setTimeout(() => URL.revokeObjectURL(href), 1000);
  } catch (e) { setError(e instanceof Error ? e.message : 'Download failed. Retry.'); }
  finally { pending.current = false; setBusy(false); }
};

const preview = displayedReview && (<>
          <div className={`${cardClass} p-5 space-y-3`}>
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold text-slate-900 dark:text-white flex items-center gap-2">
                <FileText className="h-4 w-4 text-vermilion-500" />
                Rendered Resume Preview
              </h3>

              {displayedReview.artifact.pdf ? (
                <a
                  className="inline-flex items-center gap-1 text-xs text-vermilion-600 hover:text-vermilion-700 dark:text-vermilion-400 font-medium underline"
                  href={apiClient.jobPdfUrl(job.id, selected)}
                  target="_blank"
                  rel="noreferrer"
                >
                  <Download className="h-3 w-3" />
                  Open PDF
                </a>
              ) : null}
            </div>

            {/* The validated page images render everywhere; an embedded PDF needs a browser PDF viewer
                (headless and some mobile browsers have none), so it is only a fallback. */}
            {displayedReview.preview_count ? (
              <div className="space-y-3">
                {Array.from({ length: displayedReview.preview_count }, (_, i) => (
                  <img
                    className="w-full max-w-full rounded-lg border border-slate-200 dark:border-slate-800 bg-white shadow-sm"
                    key={i}
                    alt={`Resume page ${i + 1}`}
                    src={apiClient.jobPreviewUrl(job.id, selected, i + 1)}
                  />
                ))}
              </div>
            ) : displayedReview.artifact.pdf ? (
              <div className="space-y-2">
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  No preview pages available. If the PDF does not appear below, use Open PDF.
                </p>
                <div className="overflow-hidden rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-950">
                  <iframe
                    title="Resume PDF preview"
                    className="block w-full h-[650px]"
                    src={apiClient.jobPdfUrl(job.id, selected)}
                  />
                </div>
              </div>
            ) : (
              <p className="text-xs text-slate-500 dark:text-slate-400">PDF unavailable.</p>
            )}
          </div>


</>);
const comparison = displayedReview && (<>
          {/* Base to Candidate Diff */}
          <div className={`${cardClass} p-5 space-y-3`}>
            <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800/80 pb-3">
              <h2 className="font-semibold text-slate-900 dark:text-white flex items-center gap-2 text-sm">
                <GitCompare className="h-4 w-4 text-vermilion-500" />
                Base to candidate diff
              </h2>
              <div className="flex items-center gap-3 text-[11px]">
                <span className="flex items-center gap-1 text-emerald-700 dark:text-emerald-400">
                  <span className="h-2 w-2 rounded-full bg-emerald-500" /> Added
                </span>
                <span className="flex items-center gap-1 text-rose-700 dark:text-rose-400">
                  <span className="h-2 w-2 rounded-full bg-rose-500" /> Removed
                </span>
              </div>
            </div>

            <div className="whitespace-pre-wrap break-words text-xs leading-relaxed font-sans p-4 rounded-lg bg-slate-50/50 dark:bg-slate-950/40 border border-slate-200/60 dark:border-slate-800">
              {wordDiff(
                compileMarkdownResume(displayedReview.base_resume),
                compileMarkdownResume(displayedReview.draft.candidate)
              ).map((part, i) =>
                part.type === 'added' ? (
                  <ins
                    className="bg-emerald-100 text-emerald-950 dark:bg-emerald-950/60 dark:text-emerald-200 px-1 py-0.5 rounded text-xs no-underline font-medium border-b border-emerald-400"
                    key={i}
                  >
                    {part.text}
                  </ins>
                ) : part.type === 'removed' ? (
                  <del
                    className="bg-rose-100 text-rose-950 dark:bg-rose-950/60 dark:text-rose-300 px-1 py-0.5 rounded text-xs line-through opacity-75"
                    key={i}
                  >
                    {part.text}
                  </del>
                ) : (
                  <span key={i} className="text-slate-800 dark:text-slate-200">
                    {part.text}
                  </span>
                )
              )}
            </div>
          </div>

          {/* Proposals & Rationales */}
          <div className={`${cardClass} p-5 space-y-3`}>
            <h2 className="font-semibold text-slate-900 dark:text-white flex items-center gap-2 text-sm">
              <Sparkles className="h-4 w-4 text-vermilion-500" />
              Proposal rationales and citations
            </h2>
            <pre className="whitespace-pre-wrap break-words font-mono text-[11px] bg-slate-50 dark:bg-slate-950 p-4 rounded-lg border border-slate-200 dark:border-slate-800 text-slate-800 dark:text-slate-200">
              {JSON.stringify(displayedReview.draft.proposals, null, 2)}
            </pre>
          </div>

          {/* Evidence Alignment */}
          <div className={`${cardClass} p-5 space-y-3`}>
            <h2 className="font-semibold text-slate-900 dark:text-white flex items-center gap-2 text-sm">
              <ShieldCheck className="h-4 w-4 text-vermilion-500" />
              Evidence alignment
            </h2>
            <pre className="whitespace-pre-wrap break-words font-mono text-[11px] bg-slate-50 dark:bg-slate-950 p-4 rounded-lg border border-slate-200 dark:border-slate-800 text-slate-800 dark:text-slate-200">
              {displayedReview.alignment ? JSON.stringify(displayedReview.alignment, null, 2) : 'Not assessed'}
            </pre>
          </div>

          {/* Brief */}
          <div className={`${cardClass} p-5 space-y-3`}>
            <h2 className="font-semibold text-slate-900 dark:text-white flex items-center gap-2 text-sm">
              <FileText className="h-4 w-4 text-vermilion-500" />
              Brief
            </h2>
            {displayedReview.brief_markdown ? (
              <div className="prose dark:prose-invert max-w-none text-xs">
                <BriefMarkdown markdown={displayedReview.brief_markdown} />
              </div>
            ) : (
              <p className="text-xs text-slate-500">No brief available.</p>
            )}
          </div>

</>);
const previous = pendingEdits || job.recovery?.kind === 'stale_inputs';
const historical = selected !== latestArtifact;
const unavailable = !displayedReview;
const checksContent = displayedReview ? <section className="space-y-3">
  <p>Validation: {displayedReview.artifact.validation_result}. Human approval: {isApproved ? 'Approved for this version' : 'Not approved for this version'}.</p>
  <span ref={approvalStatus} tabIndex={-1} role="status" aria-label="Approval">{isApproved ? 'Approved for this version' : ''}</span>
  {!isApproved && <button disabled={busy || conflict || pendingEdits || job.recovery?.kind === 'stale_inputs'
    || historical || job.revision !== revision || displayedReview.artifact.validation_result !== 'passed' || !displayedReview.artifact.pdf}
    onClick={() => void act(false)}>Approve Resume</button>}
  <pre className="whitespace-pre-wrap break-words text-xs">{JSON.stringify(displayedReview.validation_report, null, 2)}</pre>
</section> : <p>No generated resume checks yet.</p>;
return <section className="space-y-4 min-w-0">
  <div><h2 className="text-lg font-semibold">{historical ? 'Historical resume' : previous ? 'Previous finalized resume' : 'Resume'}</h2></div>
  <button disabled={busy} onClick={() => { onSaved(); setReload(n => n + 1); }}>Reload review</button>
  {error && <div role="alert"><p>{error}</p><button onClick={() => { onSaved(); setReload(n => n + 1); }}>Retry</button></div>}
  <JobResumeDetails actions={<>
    {displayedReview && <button className={primaryButton} disabled={busy || conflict || job.revision !== revision || historical}
      onClick={() => workingDraft ? navigate(`/tailor/canvas/jobs/${job.id}/${workingDraft.id}`) : void act(true)}>
      {workingDraft ? 'Continue editing' : 'Edit resume'}
    </button>}
    {displayedReview?.artifact.pdf && (previous || historical ?
      <a href={`${apiClient.jobPdfUrl(job.id, selected)}?download=1`}>{historical ? 'Download historical PDF' : 'Download previous PDF'}</a>
      : <button className={secondaryButton} disabled={busy} onClick={() => void downloadCurrent()}>Download PDF</button>)}
  </>} notice={open => <>
    {pendingEdits && <p role="status">You have draft changes — continue editing to include them in a new PDF.</p>}
    {job.recovery?.kind === 'stale_inputs' && <p role="status">Starting inputs changed. This is the previous PDF. <button onClick={() => navigate(`/jobs/${job.id}`)}>Review posting and inputs</button></p>}
    {artifacts.length > 0 && job.preparation_state === 'needs_input' && job.recovery?.kind !== 'stale_inputs' &&
      <p role="status">Preparation needs attention. <button onClick={() => open(job.recovery?.kind === 'render' ? 'checks' : 'corrections')}>Resolve preparation issues</button></p>}
    {historical && <button onClick={() => setSelected(latestArtifact)}>Return to current resume</button>}
    {!artifacts.length && <p role="status">{job.preparation_state === 'preparing' ? 'Preparing your resume…' : 'No generated resume yet.'}
      {job.preparation_state === 'needs_input' ? <button onClick={() => open('corrections')}>Resolve corrections</button>
        : <button onClick={() => navigate(`/jobs/${job.id}`)}>Review posting and preparation</button>}</p>}
    {displayedReview && displayedReview.artifact.validation_result !== 'passed' && <p role="status">This version needs attention. <button onClick={() => open('checks')}>View checks</button></p>}
    {job.revision !== revision && <p role="status">The job changed. <button onClick={() => { onSaved(); setReload(n => n + 1); }}>Reload review</button></p>}
  </>} preview={unavailable ? (artifacts.length && !error ? <p role="status">Loading resume…</p> : null) : preview}
    renderView={view => {
      if (view === 'checks') return checksContent;
      if (view === 'corrections') return <JobProposalReview job={job} onSaved={onSaved} />;
      if (view === 'comparison') return displayedReview ? comparison : <p>No comparison available yet.</p>;
      if (view === 'exports') return displayedReview ? <JobExports job={job} artifact={displayedReview.artifact}
        blocked={job.recovery?.kind === 'stale_inputs' ? 'Starting inputs changed. Prepare with current inputs; historical files remain available.' : pendingEdits || historical} /> : <p>No exports available yet.</p>;
      return <section className="space-y-4">
        <label className="flex min-w-0 flex-col gap-2 text-sm font-medium text-slate-700 dark:text-slate-300">Artifact version <select
          className={`${inputClass} min-h-11 min-w-0 max-w-full [color-scheme:light] dark:[color-scheme:dark]`}
          aria-label="Artifact version" value={selected} onChange={e => setSelected(e.target.value)} disabled={busy}>
          {artifacts.map(a => <option key={a.id} value={a.id}>{new Date(a.created_at).toLocaleString()} · {a.id.slice(0, 8)}</option>)}
        </select></label>
        <ol>{events.map(event => <li key={event.id}>{event.created_at} · {describeJobEvent(event.payload)}</li>)}</ol>
      </section>;
    }} />
</section>;

}
