import { useRef, useState } from 'react';
import type { Job, ScopedAnswer } from '@featherduster/core';
import { apiClient } from '../../api/client.js';

const scopeLabel = (scope: ScopedAnswer['scope']) => scope.kind === 'job' ? `Job: ${scope.job_id}` : scope.kind === 'employer' ? `Employer: ${scope.employer_id}` : 'Candidate';
function AnswerEditor({ job, question, saved, onSaved }: { job: Job; question: Job['missing_inputs'][number]; saved?: ScopedAnswer; onSaved: () => void }) {
  const [value, setValue] = useState(JSON.stringify(saved?.value ?? ''));
  const [status, setStatus] = useState<ScopedAnswer['status']>(saved?.status ?? 'unknown');
  const [revision, setRevision] = useState(job.revision);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const pending = useRef(false);
  const save = async () => {
    if (pending.current) return;
    pending.current = true; setBusy(true); setMessage('');
    try {
      const result = await apiClient.saveJobAnswer(job.id, { expected_revision: revision, key: question.key, question: question.question, scope: question.scope, status, value: status === 'unknown' ? null : JSON.parse(value) });
      setRevision(result.job.revision); setMessage('Saved. Resume job separately when ready.'); onSaved();
    } catch (e) { setMessage(e instanceof Error ? e.message : 'Unable to save answer'); }
    finally { pending.current = false; setBusy(false); }
  };
  return <fieldset className="border rounded p-4 space-y-2">
    <legend>{question.question}</legend><p>{scopeLabel(question.scope)}</p><p>{question.reason}</p>
    <label>Status <select value={status} onChange={e => setStatus(e.target.value as ScopedAnswer['status'])}>{['confirmed', 'inferred', 'unknown', 'privacy_preference'].map(s => <option key={s}>{s}</option>)}</select></label>
    <label className="block">Answer value (JSON string, number, boolean or string array)<textarea className="block w-full border rounded bg-transparent p-2" value={value} disabled={status === 'unknown'} onChange={e => setValue(e.target.value)} /></label>
    <button className="min-h-[44px] border rounded px-3" disabled={busy} onClick={() => void save()}>{status === 'confirmed' ? 'Confirm answer' : 'Save answer'}</button>
    <button className="min-h-[44px] px-3 underline" onClick={() => { setRevision(job.revision); setMessage('Revision reconciled; review your answer before saving.'); }}>Reconcile revision (keep input)</button>
    {saved && <p>Provenance: {saved.provenance.source_type} / {saved.provenance.reference}. Confirmed: {saved.confirmed_at ?? 'Not confirmed'}</p>}
    {message && <p role="status">{message}</p>}
  </fieldset>;
}
export function JobAnswers({ job, answers, onSaved }: { job: Job; answers: ScopedAnswer[]; onSaved: () => void }) {
  const same = (a: { key: string; scope: ScopedAnswer['scope'] }, b: { key: string; scope: ScopedAnswer['scope'] }) => a.key === b.key && JSON.stringify(a.scope) === JSON.stringify(b.scope);
  const questions = [...job.missing_inputs, ...answers.filter(a => !job.missing_inputs.some(q => same(q, a))).map(a => ({ key: a.key, question: a.question, scope: a.scope, reason: 'Saved answer' }))];
  return <section className="space-y-4"><h2 className="font-semibold">Scoped answers</h2>
    {!questions.length && <p>No missing questions or saved answers.</p>}
    {questions.map(q => /posting_text|select_opening|consent|runner|tool|base_resume/.test(q.key) ? <p key={q.key}>{q.question}: {q.reason}. Use Posting or Settings; this is not a candidate fact.</p> : <AnswerEditor key={`${q.key}:${JSON.stringify(q.scope)}`} job={job} question={q} saved={answers.find(a => same(a, q))} onSaved={onSaved} />)}
  </section>;
}
