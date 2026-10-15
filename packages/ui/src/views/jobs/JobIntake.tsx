import { useRef, useState } from 'react';
import { Plus, Eye, Link2, FileText, CheckCircle2, AlertCircle, ArrowUpRight, Sparkles } from 'lucide-react';
import { apiClient, type IntakePreview, type IntakeResult } from '../../api/client.js';
import { useIntentKey } from '../../hooks/useJobsData.js';
import { cardClass, inputClass, primaryButton, secondaryButton } from '../tailoring/ui.js';

export function JobIntake({
  onSaved,
  fallback,
}: {
  onSaved: () => void;
  fallback?: { id: string; revision: number };
}) {
  const [mode, setMode] = useState<'urls' | 'text'>(fallback ? 'text' : 'urls');
  const [input, setInput] = useState('');
  const [preview, setPreview] = useState<IntakePreview | null>(null);
  const [result, setResult] = useState<IntakeResult | null>(null);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const inFlight = useRef(false);
  const key = useIntentKey();

  const run = async (commit: boolean) => {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setMessage('');
    try {
      if (commit && preview) {
        setResult(await apiClient.addJobs(preview.preview_id, key(preview.preview_id)));
        setPreview(null);
        onSaved();
        const status = await apiClient.getJobsControl();
        setMessage(
          status.control.stopped_at || !status.control.automatic_preparation_enabled
            ? 'Saved; automatic preparation is stopped.'
            : 'Saved.'
        );
      } else {
        setResult(null);
        setPreview(
          await apiClient.previewJobs({
            mode,
            input,
            ...(fallback ? { fallback_job_id: fallback.id, expected_revision: fallback.revision } : {}),
          })
        );
      }
    } catch (e) {
      setMessage(
        `${e instanceof Error ? e.message : 'Intake failed'}. Preview again if expired; your text is retained.`
      );
    } finally {
      setBusy(false);
      inFlight.current = false;
    }
  };

  const items = result?.items ?? preview?.preview.items ?? [];

  return (
    <section className={`${cardClass} p-5 space-y-4`} aria-label="Job intake">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 border-b border-slate-100 dark:border-slate-800/80 pb-3">
        <div>
          <h2 className="text-base font-semibold text-slate-900 dark:text-white flex items-center gap-2">
            <Plus className="h-4 w-4 text-vermilion-500" />
            {fallback ? 'Paste posting text' : 'Add jobs'}
          </h2>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
            {fallback
              ? 'Attach raw job description prose directly to this role.'
              : 'Paste job listing URLs or markdown text. Duplicate links are safely canonicalized.'}
          </p>
        </div>

        {!fallback && (
          <div className="flex items-center gap-1 rounded-lg bg-slate-100 p-1 dark:bg-slate-800/80">
            <button
              type="button"
              className={`inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium transition-colors ${
                mode === 'urls'
                  ? 'bg-white text-slate-900 shadow-sm dark:bg-slate-900 dark:text-white'
                  : 'text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white'
              }`}
              onClick={() => {
                setMode('urls');
                setPreview(null);
                setResult(null);
              }}
            >
              <Link2 className="h-3.5 w-3.5" />
              URLs
            </button>
            <button
              type="button"
              className={`inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium transition-colors ${
                mode === 'text'
                  ? 'bg-white text-slate-900 shadow-sm dark:bg-slate-900 dark:text-white'
                  : 'text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white'
              }`}
              onClick={() => {
                setMode('text');
                setPreview(null);
                setResult(null);
              }}
            >
              <FileText className="h-3.5 w-3.5" />
              Posting text
            </button>

            {/* Hidden accessibility select for screen readers and tests */}
            <label className="sr-only">
              Intake mode{' '}
              <select
                value={mode}
                disabled={busy}
                onChange={(e) => {
                  setMode(e.target.value as 'urls' | 'text');
                  setPreview(null);
                  setResult(null);
                }}
              >
                <option value="urls">URLs (one per line)</option>
                <option value="text">Posting text</option>
              </select>
            </label>
          </div>
        )}
      </div>

      <div className="space-y-1.5">
        <label className="block text-xs font-medium text-slate-700 dark:text-slate-300">
          {mode === 'text' ? 'Posting text' : 'Job URLs'}
        </label>
        <textarea
          className={`${inputClass} min-h-28 font-mono text-xs`}
          disabled={busy}
          placeholder={
            mode === 'urls'
              ? 'https://jobs.lever.co/company/...\nhttps://job-boards.greenhouse.io/...'
              : 'Paste raw job description, requirements, and company mission here...'
          }
          value={input}
          aria-label={mode === 'text' ? 'Posting text' : 'Job URLs'}
          onChange={(e) => {
            setInput(e.target.value);
            setPreview(null);
            setResult(null);
          }}
        />
      </div>

      <div className="flex items-center gap-3">
        <button
          className={`${secondaryButton} text-xs font-medium`}
          disabled={busy || !input.trim()}
          onClick={() => void run(false)}
        >
          <Eye className="h-3.5 w-3.5" />
          Preview
        </button>

        {preview && (
          <button
            className={`${primaryButton} text-xs font-medium`}
            disabled={busy}
            onClick={() => void run(true)}
          >
            <Plus className="h-3.5 w-3.5" />
            Add jobs
          </button>
        )}

        {busy && <span className="text-xs text-slate-500 animate-pulse">Checking postings…</span>}
      </div>

      {items.length > 0 && (
        <div className="rounded-lg border border-slate-200 dark:border-slate-800 divide-y divide-slate-100 dark:divide-slate-800/60 overflow-hidden bg-slate-50/50 dark:bg-slate-900/30">
          <ul className="divide-y divide-slate-200/60 dark:divide-slate-800">
            {items.map((row) => (
              <li key={row.index} className="p-3 text-xs space-y-1">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="font-semibold text-slate-900 dark:text-slate-100 truncate">
                      {row.job?.company ?? row.original}
                    </span>
                    {row.job?.role && (
                      <span className="text-slate-500 truncate">— {row.job.role}</span>
                    )}
                  </div>
                  <div className="shrink-0">
                    {'disposition' in row ? (
                      <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-medium text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300">
                        <CheckCircle2 className="h-3 w-3" />
                        {String(row.disposition)}
                      </span>
                    ) : row.valid ? (
                      <span className="inline-flex items-center gap-1 rounded-full bg-sky-50 px-2 py-0.5 text-[11px] font-medium text-sky-700 dark:bg-sky-950/40 dark:text-sky-300">
                        <Sparkles className="h-3 w-3" />
                        Ready to add
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 rounded-full bg-rose-50 px-2 py-0.5 text-[11px] font-medium text-rose-700 dark:bg-rose-950/40 dark:text-rose-300">
                        <AlertCircle className="h-3 w-3" />
                        Invalid
                      </span>
                    )}
                  </div>
                </div>

                {row.error && (
                  <p className="text-rose-600 dark:text-rose-400 flex items-center gap-1">
                    <AlertCircle className="h-3 w-3 shrink-0" />
                    {row.error.message}
                  </p>
                )}

                {row.fallback_available && (
                  <p className="text-amber-600 dark:text-amber-400 text-[11px]">
                    Paste posting text after saving.
                  </p>
                )}

                {!!(row.duplicate_id || ('job_id' in row && row.job_id)) && (
                  <a
                    className="inline-flex items-center gap-1 text-vermilion-600 hover:text-vermilion-700 dark:text-vermilion-400 font-medium underline text-[11px]"
                    href={`/jobs/${row.duplicate_id || ('job_id' in row && row.job_id)}`}
                  >
                    Open job
                    <ArrowUpRight className="h-3 w-3" />
                  </a>
                )}

                {row.candidates.map((c, i) => (
                  <p key={i} className="text-slate-500 text-[11px] pl-2 border-l border-slate-300">
                    {c.company} — {c.role} (discovered; not queued)
                  </p>
                ))}
              </li>
            ))}
          </ul>
        </div>
      )}

      {message && (
        <p
          role="status"
          className="text-xs font-medium text-emerald-700 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-950/40 p-2.5 rounded-lg border border-emerald-200 dark:border-emerald-800/60"
        >
          {message}
        </p>
      )}
    </section>
  );
}
