import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Cloud, HardDrive, Plus, RefreshCw, Sparkles } from 'lucide-react';
import {
  apiClient,
  type ResumeRecord,
  type RunnerId,
  type RunnerInfo,
  type TailoringRunSummary,
} from '../../api/client';
import { useTailoringEvents } from '../../hooks/useTailoringEvents';
import { StatusPill, cardClass, eyebrowClass, inputClass, primaryButton, secondaryButton, stateLabel } from './ui';

interface TailoringRunListProps {
  onOpenRun: (slug: string) => void;
  onOpenSettings?: () => void;
  /** Posting handed over from the Exports canvas ("Run full tailoring"). */
  initialPosting?: string;
  onInitialPostingConsumed?: () => void;
}

export const TailoringRunList: React.FC<TailoringRunListProps> = ({ onOpenRun, onOpenSettings, initialPosting, onInitialPostingConsumed }) => {
  const [runs, setRuns] = useState<TailoringRunSummary[]>([]);
  const [runners, setRunners] = useState<RunnerInfo[]>([]);
  const [resumes, setResumes] = useState<ResumeRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [showForm, setShowForm] = useState(false);
  const [posting, setPosting] = useState('');
  const [label, setLabel] = useState('');
  const [baseResume, setBaseResume] = useState('');
  const [runner, setRunner] = useState<RunnerId | ''>('');
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoadError(null);
    try {
      const [runList, runnerRes, resumeList] = await Promise.all([
        apiClient.listTailoringRuns(),
        apiClient.getRunners(),
        apiClient.getResumes(),
      ]);
      setRuns(runList);
      setRunners(runnerRes.runners);
      setResumes(resumeList);
      setBaseResume((prev) => prev || resumeList.find((r) => r.type === 'template')?.id || resumeList[0]?.id || '');
      setRunner((prev) => {
        if (prev) return prev;
        const preferred =
          runnerRes.runners.find((r) => r.isDefault && r.available) ?? runnerRes.runners.find((r) => r.available);
        return preferred?.id ?? runnerRes.runners.find((r) => r.isDefault)?.id ?? '';
      });
    } catch (err: any) {
      setLoadError(err?.message || 'Failed to load tailoring runs');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (initialPosting) {
      setPosting(initialPosting);
      setShowForm(true);
      onInitialPostingConsumed?.();
    }
  }, [initialPosting, onInitialPostingConsumed]);

  useTailoringEvents(
    useMemo(
      () => ({
        onEvent: (evt) => {
          if (evt.kind === 'state') apiClient.listTailoringRuns().then(setRuns).catch(() => undefined);
        },
        onFileChange: () => apiClient.listTailoringRuns().then(setRuns).catch(() => undefined),
      }),
      []
    )
  );

  const selectedRunner = runners.find((r) => r.id === runner);
  const canCreate = posting.trim().length >= 20 && !!baseResume && !!runner && !creating;

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canCreate || !runner) return;
    setCreating(true);
    setCreateError(null);
    try {
      const res = await apiClient.createTailoringRun({ posting, base_resume: baseResume, runner, label: label.trim() || undefined });
      onOpenRun(res.slug);
    } catch (err: any) {
      setCreateError(err?.message || 'Could not create run');
    } finally {
      setCreating(false);
    }
  };

  const reviewCount = runs.filter((r) => r.needs_review).length;

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <span className={eyebrowClass}>Tailor</span>
          <h1 className="mt-1.5 text-2xl sm:text-3xl font-bold tracking-tight text-slate-900 dark:text-white">
            Tailor your resume to a job
          </h1>
          <p className="mt-2 max-w-2xl text-sm leading-relaxed text-slate-600 dark:text-slate-300">
            Paste a posting and the tailoring skill works through four reviewed steps: break down the posting, match it
            to your evidence, propose cited edits, and write an interview defensibility brief. Nothing lands on your
            resume without your approval.
          </p>
        </div>
        <button type="button" className={primaryButton} onClick={() => setShowForm((v) => !v)} aria-expanded={showForm}>
          <Plus className="h-4 w-4" aria-hidden="true" />
          New tailoring run
        </button>
      </header>

      {loadError && (
        <div role="alert" className="rounded-desk border border-rose-200 bg-rose-50 p-4 text-sm text-rose-900 dark:border-rose-900/50 dark:bg-rose-950/20 dark:text-rose-200">
          {loadError}{' '}
          <button type="button" className="underline" onClick={load}>
            Try again
          </button>
        </div>
      )}

      {showForm && (
        <form onSubmit={handleCreate} className={`${cardClass} p-5 lg:p-6 space-y-4`} aria-label="New tailoring run">
          <div>
            <label htmlFor="tailor-posting" className="text-sm font-semibold text-slate-800 dark:text-slate-100">
              Job posting
            </label>
            <textarea
              id="tailor-posting"
              rows={9}
              value={posting}
              onChange={(e) => setPosting(e.target.value)}
              placeholder="Paste the full job posting text…"
              className={`${inputClass} mt-1.5 font-sans leading-relaxed`}
            />
          </div>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
            <div>
              <label htmlFor="tailor-label" className="text-sm font-semibold text-slate-800 dark:text-slate-100">
                Run name <span className="font-normal text-slate-500">(optional)</span>
              </label>
              <input
                id="tailor-label"
                value={label}
                onChange={(e) => setLabel(e.target.value)}
                placeholder="acme-staff-platform"
                className={`${inputClass} mt-1.5`}
              />
            </div>
            <div>
              <label htmlFor="tailor-base" className="text-sm font-semibold text-slate-800 dark:text-slate-100">
                Base resume
              </label>
              <select id="tailor-base" value={baseResume} onChange={(e) => setBaseResume(e.target.value)} className={`${inputClass} mt-1.5`}>
                {resumes.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.name} ({r.type})
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor="tailor-runner" className="text-sm font-semibold text-slate-800 dark:text-slate-100">
                Model runner
              </label>
              <select
                id="tailor-runner"
                value={runner}
                onChange={(e) => setRunner(e.target.value as RunnerId)}
                className={`${inputClass} mt-1.5`}
              >
                {runners.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.label}
                    {r.available ? '' : ' (unavailable)'}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {selectedRunner && (
            <p
              className={`flex items-start gap-2 text-xs leading-relaxed ${
                selectedRunner.available ? 'text-slate-600 dark:text-slate-400' : 'text-amber-800 dark:text-amber-300'
              }`}
            >
              {selectedRunner.locality === 'cloud' ? (
                <Cloud className="mt-0.5 h-3.5 w-3.5 flex-shrink-0" aria-hidden="true" />
              ) : (
                <HardDrive className="mt-0.5 h-3.5 w-3.5 flex-shrink-0" aria-hidden="true" />
              )}
              <span>
                {selectedRunner.detail}.{' '}
                {selectedRunner.locality === 'cloud'
                  ? 'Cloud runner: evidence is redacted with your privacy rules before it is sent.'
                  : 'Local runner: evidence never leaves this machine.'}{' '}
                {onOpenSettings && (
                  <button type="button" onClick={onOpenSettings} className="font-medium text-vermilion-600 underline dark:text-vermilion-400">
                    Configure runners
                  </button>
                )}
              </span>
            </p>
          )}

          {createError && (
            <p role="alert" className="text-sm text-rose-700 dark:text-rose-300">
              {createError}
            </p>
          )}

          <div className="flex items-center justify-end gap-3">
            <button type="button" className={secondaryButton} onClick={() => setShowForm(false)}>
              Cancel
            </button>
            <button type="submit" className={primaryButton} disabled={!canCreate}>
              <Sparkles className="h-4 w-4" aria-hidden="true" />
              {creating ? 'Creating…' : 'Create run'}
            </button>
          </div>
        </form>
      )}

      <section aria-labelledby="tailor-runs-heading" className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 id="tailor-runs-heading" className="text-sm font-semibold text-slate-800 dark:text-slate-200">
            Runs {reviewCount > 0 && <span className="ml-2 text-xs font-normal text-sky-700 dark:text-sky-300">{reviewCount} need review</span>}
          </h2>
          <button type="button" onClick={load} className="text-xs text-slate-500 hover:text-slate-800 dark:hover:text-slate-200 inline-flex items-center gap-1">
            <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" /> Refresh
          </button>
        </div>

        {loading ? (
          <p className="text-sm text-slate-500">Loading runs…</p>
        ) : runs.length === 0 ? (
          <div className={`${cardClass} p-8 text-center`}>
            <p className="text-sm text-slate-600 dark:text-slate-300">No tailoring runs yet.</p>
            <p className="mt-1 text-xs text-slate-500">Start one from a job posting to see your evidence mapped against it.</p>
          </div>
        ) : (
          <ul className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
            {runs.map((run) => (
              <li key={run.slug}>
                <button
                  type="button"
                  onClick={() => onOpenRun(run.slug)}
                  className={`${cardClass} w-full p-4 text-left transition-colors hover:border-vermilion-300 dark:hover:border-vermilion-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-vermilion-500`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <span className="font-semibold text-slate-900 dark:text-white line-clamp-2">{run.title || run.slug}</span>
                    {run.needs_review ? (
                      <StatusPill status="needs_review" />
                    ) : run.state === 'complete' ? (
                      <StatusPill status="complete" />
                    ) : run.state === 'error' ? (
                      <StatusPill status="error" />
                    ) : null}
                  </div>
                  <p className="mt-1 text-xs text-slate-600 dark:text-slate-400">{stateLabel(run.state)}</p>
                  <p className="mt-3 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-slate-500">
                    <span>{new Date(run.updated).toLocaleString()}</span>
                    <span>{run.runner}</span>
                    <span className="font-mono">{run.slug}</span>
                  </p>
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
};
