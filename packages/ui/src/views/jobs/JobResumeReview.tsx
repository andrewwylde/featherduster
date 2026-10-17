import { JobExports } from './JobExports.js';
import { JobProposalReview } from './JobProposalReview.js';
import { useEffect, useRef, useState } from 'react';
import {
  FileCheck,
  CheckCircle2,
  Edit3,
  FileText,
  AlertTriangle,
  Download,
  RefreshCw,
  GitCompare,
  ShieldCheck,
  Sparkles,
} from 'lucide-react';
import { compileMarkdownResume, type ArtifactVersion, type Job, type JobEvent } from '@featherduster/core';
import { apiClient, ApiError, type JobReview } from '../../api/client.js';
import { useIntentKey } from '../../hooks/useJobsData.js';
import { BriefMarkdown } from '../tailoring/steps/BriefStep.js';
import { wordDiff } from '../tailoring/wordDiff.js';
import { cardClass, primaryButton, secondaryButton } from '../tailoring/ui.js';

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

  if (!artifacts.length) {
    return (
      <><JobProposalReview job={job} onSaved={onSaved} /><div className={`${cardClass} p-8 text-center text-xs text-slate-500 dark:text-slate-400 space-y-2`}>
        <FileText className="h-8 w-8 mx-auto text-slate-400" />
        <p>No resume artifact yet. Resolve proposals or inspect Posting setup first.</p>
      </div></>
    );
  }

  return (
    <section className="space-y-6 min-w-0">
      {job.preparation_state !== 'resume_ready' ? <JobProposalReview job={job} onSaved={onSaved} /> : <details><summary>Earlier corrections</summary><JobProposalReview job={job} onSaved={onSaved} /></details>}
      {pendingEdits && workingDraft && <section className={`${cardClass} p-5 space-y-3`}>
        <h2 className="font-semibold">Current working resume — edits pending checks</h2>
        <p>The PDF below is the last validated version, not these edits. Editing does not approve or publish them.</p>
        <button className={primaryButton} onClick={() => navigate(`/tailor/canvas/jobs/${job.id}/${workingDraft.id}`)}>Return to working resume</button>
        <pre className="whitespace-pre-wrap break-words text-sm">{compileMarkdownResume(workingDraft.candidate)}</pre>
      </section>}
      {job.recovery?.kind === 'stale_inputs' && <p role="status">Starting inputs changed. This PDF belongs to the previous inputs; it is not a newly checked correction.</p>}
      {/* Top Review Controls Card */}
      <div className={`${cardClass} p-5 space-y-4`}>
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div className="space-y-1">
            <h2 className="text-base font-bold text-slate-900 dark:text-white flex items-center gap-2">
              <FileCheck className="h-5 w-5 text-vermilion-500" />
              {pendingEdits || job.recovery?.kind === 'stale_inputs' ? 'Last validated resume' : selected !== latestArtifact ? 'Historical resume' : 'Current resume'}
            </h2>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Review the saved PDF. Validation, human approval and submitting an application are separate actions.
            </p>
          </div>

          <div className="flex items-center gap-2">
            <details><summary>Historical versions</summary><label className="text-xs font-medium text-slate-700 dark:text-slate-300 flex items-center gap-2">
              Artifact version{' '}
              <select
                className="rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-1.5 text-xs text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-1 focus:ring-vermilion-500"
                value={selected}
                disabled={busy}
                aria-label="Artifact version"
                onChange={(e) => setSelected(e.target.value)}
              >
                {artifacts.map((a) => (
                  <option key={a.id} value={a.id}>
                    {new Date(a.created_at).toLocaleString(undefined, {
                      month: 'short',
                      day: 'numeric',
                      hour: '2-digit',
                      minute: '2-digit',
                    })}{' '}
                    ({a.id.slice(0, 8)})
                  </option>
                ))}
              </select>
            </label></details>

            <button
              className="text-xs text-slate-500 hover:text-slate-800 dark:hover:text-slate-200 underline p-1 min-h-[44px] sm:min-h-0"
              disabled={busy}
              onClick={() => {
                onSaved();
                setReload((n) => n + 1);
              }}
            >
              Reload review
            </button>
          </div>
        </div>

        {error && (
          <div
            role="alert"
            className="rounded-lg border border-rose-200 bg-rose-50 p-3 text-xs text-rose-800 dark:border-rose-900/50 dark:bg-rose-950/40 dark:text-rose-300"
          >
            {error}
          </div>
        )}

        {!displayedReview && !error && (
          <div className="flex items-center gap-2 text-xs text-slate-500 py-4">
            <RefreshCw className="h-4 w-4 animate-spin text-vermilion-500" />
            <span>Loading verified review…</span>
          </div>
        )}

        {displayedReview && (
          <>
            <div className="flex flex-wrap items-center gap-3 pt-2 border-t border-slate-100 dark:border-slate-800/80 text-xs">
              <p className="text-slate-700 dark:text-slate-300">
                Validation: {displayedReview.artifact.validation_result}. Human approval:{' '}
                {approved ? `Approved ${approved.created_at}` : 'Not approved for this version'}.
              </p>

              <span
                className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[11px] font-semibold ${
                  displayedReview.artifact.validation_result === 'passed'
                    ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800'
                    : 'bg-rose-50 text-rose-700 dark:bg-rose-950/50 dark:text-rose-300 border border-rose-200 dark:border-rose-800'
                }`}
              >
                {displayedReview.artifact.validation_result === 'passed' ? (
                  <CheckCircle2 className="h-3 w-3" />
                ) : (
                  <AlertTriangle className="h-3 w-3" />
                )}
                {displayedReview.artifact.validation_result}
              </span>

              {approved && (
                <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2.5 py-0.5 text-[11px] font-semibold text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-200">
                  <ShieldCheck className="h-3 w-3" />
                  Approved
                </span>
              )}
            </div>

            <JobExports job={job} artifact={displayedReview.artifact} blocked={pendingEdits || selected !== latestArtifact || job.recovery?.kind === 'stale_inputs'} />

            {/* Main Action Buttons */}
            <div className="flex flex-wrap items-center gap-3 pt-2">
              <button
                className={`${primaryButton} text-xs font-semibold`}
                disabled={
                  busy ||
                  conflict ||
                  pendingEdits ||
                  job.recovery?.kind === 'stale_inputs' ||
                  selected !== latestArtifact ||
                  job.revision !== revision ||
                  displayedReview.artifact.validation_result !== 'passed' ||
                  !displayedReview.artifact.pdf
                }
                onClick={() => void act(false)}
              >
                <CheckCircle2 className="h-3.5 w-3.5" />
                Approve Resume
              </button>

              <button
                className={`${secondaryButton} text-xs font-semibold`}
                disabled={busy || conflict || job.revision !== revision}
                onClick={() => workingDraft ? navigate(`/tailor/canvas/jobs/${job.id}/${workingDraft.id}`) : void act(true)}
              >
                <Edit3 className="h-3.5 w-3.5" />
                Continue Editing
              </button>
            </div>

            {job.revision !== revision && (
              <p className="text-xs text-amber-600 dark:text-amber-400 font-medium">
                Job changed. Reload review before taking action.
              </p>
            )}
          </>
        )}
      </div>

      {displayedReview && (
        <div className="space-y-6">
          {/* PDF Viewer & Page Previews */}
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

            {displayedReview.artifact.pdf ? (
              <div className="overflow-hidden rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-950">
                <iframe
                  title="Resume PDF preview"
                  className="hidden md:block w-full h-[650px]"
                  src={apiClient.jobPdfUrl(job.id, selected)}
                />
              </div>
            ) : (
              <p className="text-xs text-slate-500 dark:text-slate-400">PDF unavailable.</p>
            )}

            {displayedReview.preview_count ? (
              <div className="space-y-3 md:hidden">
                {Array.from({ length: displayedReview.preview_count }, (_, i) => (
                  <img
                    className="max-w-full rounded-lg border border-slate-200 dark:border-slate-800 shadow-sm"
                    key={i}
                    alt={`Resume page ${i + 1}`}
                    src={apiClient.jobPreviewUrl(job.id, selected, i + 1)}
                  />
                ))}
              </div>
            ) : (
              <p className="text-xs text-slate-500 md:hidden">
                No preview pages available. Use the PDF link.
              </p>
            )}
          </div>

          {/* Validation Diagnostics Accordion */}
          <details className={`${cardClass} p-4 text-xs group`}>
            <summary className="font-semibold text-slate-900 dark:text-white cursor-pointer select-none flex items-center justify-between">
              <span>Validation diagnostics</span>
              <span className="text-slate-400 text-[11px] group-open:rotate-180 transition-transform">
                ▼
              </span>
            </summary>
            <pre className="mt-3 whitespace-pre-wrap break-words font-mono text-[11px] bg-slate-50 dark:bg-slate-950 p-4 rounded-lg border border-slate-200 dark:border-slate-800 text-slate-800 dark:text-slate-200">
              {JSON.stringify(displayedReview.validation_report, null, 2)}
            </pre>
          </details>

          <details><summary>Comparison, evidence and preparation history</summary>
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
          </details>
        </div>
      )}
    </section>
  );
}
