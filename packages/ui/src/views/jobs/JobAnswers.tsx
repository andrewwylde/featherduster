import { useRef, useState } from 'react';
import { HelpCircle } from 'lucide-react';
import type { Job, ScopedAnswer } from '@featherduster/core';
import { apiClient } from '../../api/client.js';
import { cardClass, inputClass, primaryButton } from '../tailoring/ui.js';
import { describeStateReason, hasRecoveredCapture } from './job-utils.js';

const scopeLabel = (scope: ScopedAnswer['scope']) =>
  scope.kind === 'job'
    ? `Job: ${scope.job_id}`
    : scope.kind === 'employer'
      ? `Employer: ${scope.employer_id}`
      : 'Candidate';

function AnswerEditor({
  job,
  question,
  saved,
  onSaved,
}: {
  job: Job;
  question: Job['missing_inputs'][number];
  saved?: ScopedAnswer;
  onSaved: () => void;
}) {
  const [value, setValue] = useState(JSON.stringify(saved?.value ?? ''));
  const [status, setStatus] = useState<ScopedAnswer['status']>(saved?.status ?? 'unknown');
  const [revision, setRevision] = useState(job.revision);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const pending = useRef(false);

  const save = async () => {
    if (pending.current) return;
    pending.current = true;
    setBusy(true);
    setMessage('');
    try {
      const result = await apiClient.saveJobAnswer(job.id, {
        expected_revision: revision,
        key: question.key,
        question: question.question,
        scope: question.scope,
        status,
        value: status === 'unknown' ? null : JSON.parse(value),
      });
      setRevision(result.job.revision);
      setMessage('Saved. Resume job separately when ready.');
      onSaved();
    } catch (e) {
      setMessage(e instanceof Error ? e.message : 'Unable to save answer');
    } finally {
      pending.current = false;
      setBusy(false);
    }
  };

  return (
    <fieldset className={`${cardClass} p-5 space-y-4`}>
      <legend className="text-sm font-semibold text-slate-900 dark:text-white px-1">
        {question.question}
      </legend>

      <div className="flex flex-wrap items-center gap-2 text-xs">
        <span className="rounded-full bg-slate-100 dark:bg-slate-800 px-2.5 py-0.5 font-medium text-slate-700 dark:text-slate-300">
          {scopeLabel(question.scope)}
        </span>
        <span className="text-slate-500">{question.reason}</span>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <div className="sm:col-span-1 space-y-1">
          <label className="block text-xs font-medium text-slate-700 dark:text-slate-300">
            Status{' '}
            <select
              className="mt-1 w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 text-xs text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-1 focus:ring-vermilion-500"
              value={status}
              aria-label="Status"
              onChange={(e) => setStatus(e.target.value as ScopedAnswer['status'])}
            >
              {['confirmed', 'inferred', 'unknown', 'privacy_preference'].map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </label>
        </div>

        <div className="sm:col-span-2 space-y-1">
          <label className="block text-xs font-medium text-slate-700 dark:text-slate-300">
            Answer value (JSON string, number, boolean or string array)
          </label>
          <textarea
            className={`${inputClass} font-mono text-xs min-h-[44px]`}
            value={value}
            disabled={status === 'unknown'}
            aria-label="Answer value (JSON string, number, boolean or string array)"
            onChange={(e) => setValue(e.target.value)}
          />
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2 pt-1 border-t border-slate-100 dark:border-slate-800/80">
        <button
          className={`${primaryButton} text-xs font-semibold`}
          disabled={busy}
          onClick={() => void save()}
        >
          {status === 'confirmed' ? 'Confirm answer' : 'Save answer'}
        </button>

        <button
          className="text-xs text-slate-500 hover:text-slate-800 dark:hover:text-slate-200 underline px-2 py-1 min-h-[44px] sm:min-h-0"
          onClick={() => {
            setRevision(job.revision);
            setMessage('Revision reconciled; review your answer before saving.');
          }}
        >
          Reconcile revision (keep input)
        </button>
      </div>

      {saved && (
        <p className="text-[11px] text-slate-500 dark:text-slate-400">
          Provenance: {saved.provenance.source_type} / {saved.provenance.reference}. Confirmed:{' '}
          {saved.confirmed_at ?? 'Not confirmed'}
        </p>
      )}

      {message && (
        <p
          role="status"
          className="text-xs font-medium text-emerald-700 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-950/40 p-2.5 rounded-lg border border-emerald-200 dark:border-emerald-800/60"
        >
          {message}
        </p>
      )}
    </fieldset>
  );
}

export function JobAnswers({
  job,
  answers,
  onSaved,
}: {
  job: Job;
  answers: ScopedAnswer[];
  onSaved: () => void;
}) {
  const same = (
    a: { key: string; scope: ScopedAnswer['scope'] },
    b: { key: string; scope: ScopedAnswer['scope'] }
  ) => a.key === b.key && JSON.stringify(a.scope) === JSON.stringify(b.scope);

  if (job.recovery && job.recovery.kind !== 'fact') return <section className={`${cardClass} p-4 space-y-3`}>
    <h2>Resolve {job.recovery.kind}</h2>{!hasRecoveredCapture(job) && describeStateReason(job.state_reason) && <p>{describeStateReason(job.state_reason)}</p>}
    <p>This is not a candidate fact. A confirmed answer cannot bypass validation.</p>
    <a href={`/jobs/${job.id}/resume`}>Open proposal review, diagnostics and input refresh</a>
    {job.recovery.kind === 'setup' && <a className="block" href="/settings">Open runner and consent settings</a>}
  </section>;

  const questions = [
    ...job.missing_inputs,
    ...answers
      .filter((a) => !job.missing_inputs.some((q) => same(q, a)))
      .map((a) => ({ key: a.key, question: a.question, scope: a.scope, reason: 'Saved answer' })),
  ];

  return (
    <section className="space-y-4">
      <div className="flex items-center gap-2">
        <HelpCircle className="h-5 w-5 text-vermilion-500" />
        <h2 className="text-lg font-bold text-slate-900 dark:text-white">Scoped answers</h2>
      </div>

      {!questions.length && (
        <div className={`${cardClass} p-8 text-center text-xs text-slate-500 dark:text-slate-400`}>
          No missing questions or saved answers.
        </div>
      )}

      {questions.map((q) =>
        /posting_text|select_opening|consent|runner|tool|base_resume/.test(q.key) ? (
          <div
            key={q.key}
            className="rounded-lg bg-amber-50 p-3 text-xs text-amber-800 dark:bg-amber-950/40 dark:text-amber-300 border border-amber-200 dark:border-amber-800/50"
          >
            {q.question}: {q.reason}. Use Posting or Settings; this is not a candidate fact.
          </div>
        ) : (
          <AnswerEditor
            key={`${q.key}:${JSON.stringify(q.scope)}`}
            job={job}
            question={q}
            saved={answers.find((a) => same(a, q))}
            onSaved={onSaved}
          />
        )
      )}
    </section>
  );
}
