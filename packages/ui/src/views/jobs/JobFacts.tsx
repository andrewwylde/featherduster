import { readFactAnswer, retainedFactAnswer } from './fact-answer-state.js';
import { SourcePicker } from '../../components/SourcePicker.js';
import { useCallback, useEffect, useRef, useState } from 'react';
import { groupReviewFacts, sameFact, type JobFact, type JobFacts as Facts, type SemanticTarget, type SourceQuote, type SemanticSource } from '@featherduster/core';
import { apiClient } from '../../api/client.js';
import { cardClass, inputClass, primaryButton, secondaryButton } from '../tailoring/ui.js';
const passageLabel = (fact: JobFact) => {
  if (fact.passage.subject.path === 'summary') return 'Resume summary';
  if (fact.passage.work_context) {
    try { const work = JSON.parse(fact.passage.work_context); if (work.company && work.role) return `${work.role} at ${work.company}`; } catch {}
  }
  const match = /^experiences\.(\d+)\.bullets\.(\d+)\.text$/.exec(fact.passage.subject.path);
  return match ? `Experience ${Number(match[1]) + 1}, bullet ${Number(match[2]) + 1}` : 'Resume wording';
};
const sourceLabel = (sources: SemanticSource[], id: string) => sources.find(s => s.evidence_id === id && s.field === 'title')?.text ?? 'Captured evidence';

/** Polling only reads. Classification starts only from an edit or an explicit action. */
export function JobFacts({ jobId, target, onResolved, onRevise, onKeepOriginal, reactive = false, passagePath, passageText, focusRequest = 0, onFactsChanged, wordingChangesRequired = false, checksPending = false }: {
  wordingChangesRequired?: boolean; checksPending?: boolean; jobId: string; passagePath?: string; passageText?: string; focusRequest?: number; target?: SemanticTarget; onResolved?(): void | Promise<void>; onFactsChanged?(facts: Facts): void; reactive?: boolean;
  onRevise?(fact: JobFact): void; onKeepOriginal?(fact: JobFact): Promise<void>;
}) {
  const identity = JSON.stringify([jobId, target]);
  const generation = useRef({ identity, value: 0 });
  if (generation.current.identity !== identity) generation.current = { identity, value: generation.current.value + 1 };
  const sequence = generation.current.value;
  const [view, setView] = useState<{ identity: string; data: Facts }>();
  const [error, setError] = useState(''), [busy, setBusy] = useState(false);
  const [selected, setSelected] = useState<string>();
  useEffect(() => { setSelected(undefined); setSaveFeedback(undefined); }, [focusRequest, passagePath]);
  const [savingClaim, setSavingClaim] = useState<string>();
  const [saveFeedback, setSaveFeedback] = useState<{ error: boolean; text: string }>();
  const [savePhase, setSavePhase] = useState<'saving' | 'checking'>();
  const current = useRef(identity); current.current = identity;
  const priorEdit = useRef(identity), lock = useRef(false);
  const readSequence = useRef(0);
  const inFlight = useRef<{ sequence: number; promise: Promise<Facts> }>();
  const data = view?.identity === identity ? view.data : undefined;
  const dataRef = useRef(data); dataRef.current = data;
  const factsChanged = useRef(onFactsChanged); factsChanged.current = onFactsChanged;
  useEffect(() => { if (data) factsChanged.current?.(data); }, [data]);
  const load = useCallback(async () => {
    if (inFlight.current?.sequence === sequence) return inFlight.current.promise;
    const readId = ++readSequence.current;
    const promise = (target ? apiClient.viewJobFacts(jobId, target) : apiClient.getJobFacts(jobId)).then(next => {
      if (current.current === identity && generation.current.value === sequence && readId === readSequence.current) { setView({ identity, data: next }); }
      return next;
    }).finally(() => { if (inFlight.current?.promise === promise) inFlight.current = undefined; });
    inFlight.current = { sequence, promise };
    return promise;
  }, [identity, sequence]);
  useEffect(() => {
    let alive = true;
    const read = () => load().catch(e => { if (alive) setError(e instanceof Error ? e.message : 'Facts unavailable.'); });
    void read();
    return () => { alive = false; };
  }, [load]);
  useEffect(() => {
    if (data?.execution !== 'checking') return;
    const timer = setTimeout(() => { void load().catch(e => setError(e instanceof Error ? e.message : 'Facts unavailable.')); }, 2000);
    return () => clearTimeout(timer);
  }, [load, data]);
  const check = useCallback(async (reason: 'edit' | 'check' | 'retry') => {
    if (lock.current || dataRef.current?.execution === 'checking') return;
    if (reason === 'edit') priorEdit.current = identity;
    lock.current = true; setBusy(true); setError('');
    try {
      const snapshot = await load();
      if (current.current !== identity || generation.current.value !== sequence || snapshot.execution === 'checking') return;
      await apiClient.startJobFactCheck(jobId, { target: snapshot.target, input_fingerprint: snapshot.input_fingerprint,
        expected_job_revision: snapshot.job_revision, expected_semantic_revision: snapshot.semantic_revision,
        reason, idempotency_key: crypto.randomUUID() });
      await load();
    } catch (e) { if (current.current === identity) setError(e instanceof Error ? e.message : 'Check unavailable.'); }
    finally { lock.current = false; setBusy(false); }
  }, [identity, sequence, load]);
  useEffect(() => {
    if (!reactive || busy || priorEdit.current === identity || dataRef.current?.execution === 'checking') return;
    const timer = setTimeout(() => { void check('edit'); }, 600);
    return () => clearTimeout(timer);
  }, [identity, reactive, check, busy]);
  const resolvedCallback = useRef(onResolved); resolvedCallback.current = onResolved;
  const checkedFingerprint = useRef<string>();
  useEffect(() => {
    if (!reactive || !data || data.execution === 'checking' || checkedFingerprint.current === data.support_fingerprint) return;
    checkedFingerprint.current = data.support_fingerprint;
    void resolvedCallback.current?.();
  }, [reactive, data?.support_fingerprint, data?.execution]);
  const visibleFacts = (data?.facts ?? []).filter(f => (!passagePath || f.passage.subject.path === passagePath) && (!passageText || f.passage.text === passageText));
  const groups = groupReviewFacts(visibleFacts);
  const pendingGroups = groups.filter(g => !g.resolved);
  const questionGroups = pendingGroups.filter(g => g.facts.some(f => ['needs_clarification', 'contradicted'].includes(f.state)));
  const questionCount = questionGroups.length;
  const group = pendingGroups.find(g => g.facts.some(f => !f.resolution && f.claim.id === selected)) ?? questionGroups.find(g => data && g.facts.some(f => retainedFactAnswer(data, f).assertion.trim())) ?? questionGroups[0] ?? pendingGroups[0];
  const unresolved = visibleFacts.filter(f => !f.resolution);
  const fact = group?.facts.find(f => !f.resolution);
  const answerable = !!fact && ['needs_clarification', 'contradicted'].includes(fact.state);
  const resolvedCount = visibleFacts.length - unresolved.length;
  const totalFacts = data?.facts.length ?? 0;
  const totalResolved = data?.facts.filter(f => f.resolution).length ?? 0;
  const savedConfirmation = data?.clarifications.filter(c => c.confirmed && visibleFacts.some(f => f.resolution?.provenance === 'human' && sameFact(f.claim.fact, c.fact))).at(-1);
  const savedClaim = savedConfirmation && visibleFacts.find(f => f.resolution && sameFact(f.claim.fact, savedConfirmation.fact));
  const isHumanConf = savedConfirmation?.support_basis === 'human_confirmation';
  const persistedFeedback = savedClaim ? { error: false, text: isHumanConf ? 'Saved — confirmed by you for this employment' : `Saved and confirmed for this job: “${savedClaim.claim.text}”` } : undefined;
  const shownFeedback = saveFeedback ?? persistedFeedback;
  const feedback = shownFeedback && <p role={shownFeedback.error ? 'alert' : 'status'} className={`rounded border p-3 text-sm ${shownFeedback.error ? 'border-red-400 bg-red-50 dark:bg-red-950/30' : 'border-emerald-500 bg-emerald-50 dark:bg-emerald-950/30'}`}>{shownFeedback.text}</p>;
  return <section aria-label="Facts to review" className={`${cardClass} p-4 space-y-3`}>
    <div className="flex justify-between gap-3"><h2 className="font-semibold">Facts to review</h2>
      {data && <span role="status">{resolvedCount} of {visibleFacts.length} resolved</span>}</div>
    {!!totalFacts && <div className="space-y-1">
      <p className="text-sm">Resume facts: {totalResolved} of {totalFacts} resolved · {totalFacts - totalResolved} remaining</p>
      <progress aria-label="Resume fact review progress" className="w-full h-3 accent-emerald-600" max={totalFacts} value={totalResolved} />
      <p role="status" className="text-xs">{savePhase === 'saving' ? 'Saving your answer…' : savePhase === 'checking' ? 'Answer saved. Updating resume checks…' : totalResolved === totalFacts ? 'All listed facts have saved support. The resume status above shows any remaining work.' : 'Progress advances when a saved result resolves a fact.'}</p>
    </div>}
    <p className="text-sm">{questionCount ? 'Answer factual questions or correct the wording. You can reuse a supported answer for this project, or keep it in this job.' : 'Saved factual answers and supporting evidence are shown here.'}</p>
    {error && <p role="alert">{error}</p>}
    {!data && !error && <p role="status">Loading facts…</p>}
    {data && <>
      {data.failures && data.failures.length > 0 && (
        <div role="alert" aria-label="Needs retry" className="rounded border border-amber-500 bg-amber-50 dark:bg-amber-950/30 p-3 text-sm space-y-2">
          <div className="flex items-center justify-between">
            <span className="font-semibold text-amber-800 dark:text-amber-200">Needs retry</span>
            <button
              type="button"
              className={secondaryButton}
              disabled={busy || data.execution === 'checking'}
              onClick={() => void check('retry')}
            >
              Retry failed checks
            </button>
          </div>
          <ul className="list-disc list-inside space-y-1">
            {data.failures.map((f, i) => (
              <li key={i}>
                {f.batch_index !== undefined ? `Batch ${f.batch_index}: ` : ''}{f.safe_diagnostic}
              </li>
            ))}
          </ul>
        </div>
      )}
      {data.execution === 'checking' && <p role="status">Checking captured evidence…</p>}
      {data.reason && <p>{data.reason}</p>}
      <button className={secondaryButton} disabled={busy || data.execution === 'checking'} onClick={() => void check(data.execution === 'unavailable' ? 'retry' : 'check')}>{data.execution === 'unavailable' ? 'Retry evidence check' : 'Check evidence'}</button>
      <p role="status" aria-label="Next required action" className="font-medium text-sm">{savePhase ? savePhase === 'saving' ? 'Next: wait for your answer to save.' : 'Next: wait for resume checks to finish.' : checksPending || data.execution === 'checking' ? 'Next: wait for resume checks to finish.' : fact && answerable ? retainedFactAnswer(data, fact).assertion.trim() ? 'Next: finish saving or confirming your existing answer below.' : 'Next: answer the question below.' : wordingChangesRequired ? 'Next: review the wording or evidence changes below. Your factual answers are already saved.' : !pendingGroups.length && visibleFacts.length ? passagePath ? 'No factual action is needed for this passage. Follow the resume status above for the next step.' : 'No factual action is needed. Follow the resume status above for the next step.' : 'Next: run or retry the evidence check.'}</p>
      {fact && answerable ? <FactEditor key={`${identity}:${fact.claim.id}`} recoveryKey={`fact-answer:${jobId}:${data.input_fingerprint}:${fact.passage.subject.id}:${fact.claim.id}`}
        legacyRecoveryKey={`fact-answer:${jobId}:${data.input_fingerprint}:${fact.passage.subject.id}`}
        focusRequest={focusRequest} fact={fact} related={group!.facts.filter(f => !f.resolution)} sources={data.sources ?? []} sharedAnswers={(data.shared_clarifications ?? []).filter(c => sameFact(c.clarification.fact, fact.claim.fact))}
        savedAnswer={retainedFactAnswer(data, fact).saved ? retainedFactAnswer(data, fact).assertion : undefined}
        feedback={<>{feedback}{!!shownFeedback && questionCount > 0 && <p className="text-sm">{questionCount} {questionCount === 1 ? 'question remains' : 'questions remain'} in this passage. {fact.resolution ? 'Choose Open next unanswered question to continue.' : 'The question above still needs your answer.'}</p>}</>} checking={savePhase === 'checking'} inputsDisabled={savingClaim === fact.claim.id && savePhase === 'saving'} disabled={busy} onSave={async (assertion, date, correction, quotes, confirmed, reuse, replaceShared) => {
        if (lock.current) return;
        lock.current = true; setBusy(true); setSavingClaim(fact.claim.id); setSavePhase('saving'); setError(''); setSaveFeedback(undefined);
        try {
          const next = await apiClient.saveJobFactClarification(jobId, { target: data.target,
            expected_job_revision: data.job_revision, expected_semantic_revision: data.semantic_revision,
            input_fingerprint: data.input_fingerprint, idempotency_key: crypto.randomUUID(), claim_ids: group!.facts.filter(f => !f.resolution).map(f => f.claim.id),
            fact: fact.claim.fact, assertion, confirmed, reuse, expected_corpus_revision: data.corpus_revision, kind: fact.state === 'contradicted' || replaceShared ? 'correction' : 'confirmation',
            ...(replaceShared ? { supersedes_shared: replaceShared } : {}),
            source_ids: [...new Set([...group!.facts.flatMap(f => f.evidence.map(e => e.evidence_id)), ...quotes.map(q => q.evidence_id)])], supporting_quotes: quotes,
            supersedes: data.clarifications.find(c => sameFact(c.fact, fact.claim.fact))?.id ?? null,
            ...(fact.state === 'contradicted' || replaceShared ? { effective_date: date, corrected_assertion: correction } : {}) });
          if (current.current !== identity) return;
          readSequence.current++;
          setView({ identity, data: next });
          const resolved = group!.facts.filter(f => !f.resolution).every(saved => next.facts.some(f => f.claim.id === saved.claim.id && f.resolution));
          setSelected(next.facts.find(f => !f.resolution && (!passagePath || f.passage.subject.path === passagePath))?.claim.id);
          setSaveFeedback({ error: false, text: !confirmed ? 'Answer saved. This fact still needs confirmation or revised wording.' : resolved
            ? `Saved and confirmed ${reuse === 'employer' ? 'for this employment' : reuse === 'project' ? 'for this project' : 'for this job'}: “${fact.claim.text}”`
            : 'Answer saved, but this fact is still unresolved. Review the explanation and supporting evidence, or revise the wording.' });
          try {
            if (resolved || !confirmed) localStorage.removeItem(`fact-answer:${jobId}:${data.input_fingerprint}:${fact.passage.subject.id}:${fact.claim.id}`);
            const legacyKey = `fact-answer:${jobId}:${data.input_fingerprint}:${fact.passage.subject.id}`;
            if ((resolved || !confirmed) && JSON.parse(localStorage.getItem(legacyKey) ?? '{}').claimText === fact.claim.text) localStorage.removeItem(legacyKey);
          } catch {}
          if (onResolved) {
            setSavePhase('checking');
            try { await onResolved(); inFlight.current = undefined; await load(); }
            catch (e) { setSaveFeedback({ error: true, text: `Your answer was saved. Resume checks need retry: ${e instanceof Error ? e.message : 'Checks unavailable.'} Use Update resume checks below.` }); }
          }
        } catch (e) {
          // A lost response is not proof that the transaction failed. Read the saved
          // result before offering another confirmation or repeating the question.
          inFlight.current = undefined; readSequence.current++;
          let latest: Facts | undefined;
          try { latest = await load(); } catch { /* Keep the retained answer when status cannot be read. */ }
          if (current.current !== identity) return;
          const recorded = latest?.clarifications.some(c => c.confirmed === confirmed && c.assertion === assertion
            && sameFact(c.fact, fact.claim.fact) && c.claim_ids.includes(fact.claim.id));
          if (recorded) {
            setSaveFeedback({ error: false, text: confirmed ? 'Your confirmation was saved. The response was interrupted; the saved result has been recovered.' : 'Your answer was saved without confirmation. The saved result has been recovered.' });
            try { localStorage.removeItem(`fact-answer:${jobId}:${data.input_fingerprint}:${fact.passage.subject.id}:${fact.claim.id}`); } catch {}
            if (onResolved) {
              setSavePhase('checking');
              try { await onResolved(); inFlight.current = undefined; await load(); }
              catch (checkError) { setSaveFeedback({ error: true, text: `Your answer was saved. Resume checks need retry: ${checkError instanceof Error ? checkError.message : 'Checks unavailable.'} Use Update resume checks below.` }); }
            }
          } else setSaveFeedback({ error: true, text: `${latest ? 'Confirmation not recorded.' : 'Could not verify whether your answer was saved.'} ${e instanceof Error ? e.message : 'Could not save this answer.'} Your text is still here; retry saving the existing answer.` });
        }
        finally { lock.current = false; setBusy(false); setSavingClaim(undefined); setSavePhase(undefined); }
      }} /> : <p role="status">{fact && !answerable ? 'The evidence check has not produced an answerable question for this claim. Run or retry Check evidence above; you do not need to confirm it again.' : !visibleFacts.length ? 'No claims are available for this passage yet. Choose Check evidence to identify the facts that need review.' : passagePath ? 'All facts in this passage have saved support.' : 'All listed facts have saved support.'}</p>}
      {(!fact || !answerable) && feedback}
      {fact && onRevise && <button className={secondaryButton} disabled={busy} onClick={() => onRevise(fact)}>Revise wording</button>}
      {fact?.passage.subject.proposal_id && onKeepOriginal && <button className={secondaryButton} disabled={busy} onClick={async () => {
        setBusy(true); try { await onKeepOriginal(fact); await load(); } catch (e) { setError(e instanceof Error ? e.message : 'Could not restore original wording.'); } finally { setBusy(false); }
      }}>Keep original wording</button>}
      {!!pendingGroups.length && <details><summary>Other facts ({pendingGroups.length})</summary><ul>{pendingGroups.map(g => <li key={g.id}><button className="text-left underline min-h-11" onClick={() => setSelected(g.id)}>{g.facts[0].claim.text}</button></li>)}</ul></details>}
      {!!resolvedCount && <details><summary>Resolved facts and supporting sources</summary>{visibleFacts.filter(f => f.resolution).map(f => <div key={f.claim.id} className="py-2">
        <p>{f.claim.text}</p>
        <div className="flex items-center gap-2">
          {(f.support_label === 'Confirmed by you' || f.resolution?.provenance === 'human') && (
            <span role="status" aria-label="Confirmed by you" className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-200">
              Confirmed by you
            </span>
          )}
          <p className="text-sm">{f.support_label ?? (f.resolution?.provenance === 'human' ? 'Confirmed by you' : 'Supported by captured evidence')}: {f.resolution?.explanation}</p>
        </div>
        {f.evidence.map((q, i) => <blockquote key={i}>{sourceLabel(data.sources ?? [], q.evidence_id)}: {q.quote}</blockquote>)}
        {f.question && <p className="text-sm">Completed question: {f.question}</p>}
      </div>)}</details>}
      {onResolved && <button className={primaryButton} disabled={busy || data.execution === 'checking'} onClick={async () => {
        setBusy(true); try { await onResolved(); } catch (e) { setError(e instanceof Error ? e.message : 'Checks unavailable.'); } finally { setBusy(false); }
      }}>Update resume checks</button>}
      <details><summary>Check usage</summary><p>{data.usage.dispatched} model calls · {Math.round(data.usage.elapsed_ms / 1000)} seconds. Token usage and cost are unavailable from this runner.</p></details>
    </>}
  </section>;
}
function FactEditor({ fact, related, sources, sharedAnswers, savedAnswer, recoveryKey, legacyRecoveryKey, disabled, inputsDisabled, feedback, checking, focusRequest, onSave }: { focusRequest: number; feedback?: import('react').ReactNode; checking: boolean; fact: JobFact; related: JobFact[]; sources: SemanticSource[]; sharedAnswers: NonNullable<Facts['shared_clarifications']>; savedAnswer?: string; recoveryKey: string; legacyRecoveryKey: string; disabled: boolean; inputsDisabled: boolean; onSave(assertion: string, date: string, correction: string, quotes: SourceQuote[], confirmed: boolean, reuse: 'job' | 'project' | 'employer', replaceShared: string): Promise<void> }) {
  const isTitleFact = fact.claim.fact.predicate === 'formal_title'
    || fact.passage.subject.path.endsWith('.role')
    || /formal title|title at/i.test(fact.question ?? '');
  const [restored] = useState(() => readFactAnswer(recoveryKey, legacyRecoveryKey, fact.claim.text));
  const retained = !!(restored.assertion?.trim() || savedAnswer?.trim());
  const [assertion, setAssertion] = useState<string>(restored.assertion ?? savedAnswer ?? ''), [date, setDate] = useState<string>(restored.date ?? ''), [correction, setCorrection] = useState<string>(restored.correction ?? '');
  const [sourceIndex, setSourceIndex] = useState(restored.sourceIndex ?? ''), [quote, setQuote] = useState(restored.quote ?? '');
  const [reuse, setReuse] = useState<'job' | 'project' | 'employer'>((restored.reuse as 'job' | 'project' | 'employer') ?? (isTitleFact ? 'employer' : fact.evidence.length ? 'project' : 'job'));
  const [replaceShared, setReplaceShared] = useState<string>(sharedAnswers.some(c => c.update_id === restored.replaceShared) ? restored.replaceShared : '');
  const validReplacement = (reuse === 'project' || reuse === 'employer') && sharedAnswers.some(c => c.update_id === replaceShared) ? replaceShared : '';
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => { heading.current?.focus({ preventScroll: true }); if (focusRequest) heading.current?.scrollIntoView?.({ block: 'start' }); }, [focusRequest]);
  useEffect(() => { try { localStorage.setItem(recoveryKey, JSON.stringify({ assertion, date, correction, reuse, replaceShared, sourceIndex, quote, claimText: fact.claim.text })); } catch {} }, [recoveryKey, assertion, date, correction, reuse, replaceShared, sourceIndex, quote, fact.claim.text]);
  const source = sourceIndex ? sources[Number(sourceIndex) - 1] : undefined;
  const start = source?.text.indexOf(quote) ?? -1;
  const quotes: SourceQuote[] = source && quote.trim() && start >= 0 ? [{ evidence_id: source.evidence_id, evidence_fingerprint: source.evidence_fingerprint, field: source.field, start: source.start + start, end: source.start + start + quote.length, quote }] : [];
  const needsSource = reuse === 'project' && !related.some(f => f.evidence.length) && !quotes.length;
  return <form className="space-y-3 border rounded p-3" onSubmit={e => { e.preventDefault(); if (needsSource || disabled) return; void onSave(assertion, date, correction, quotes, true, reuse, validReplacement); }}>
    <p className="text-xs">{passageLabel(fact)}{fact.passage.inherited ? ' · Existing wording' : ' · Proposed wording'}</p>
    <h3 ref={heading} tabIndex={-1} className="font-semibold scroll-mt-24">{retained ? savedAnswer ? 'Confirm your saved answer' : 'Finish saving your earlier answer' : fact.question ?? 'Does this exact claim accurately describe your work?'}</h3>
    {retained && <p className="text-sm">{savedAnswer ? 'Your answer was saved without confirmation. You can confirm that existing answer below.' : 'Your answer is retained in this browser, but no saved confirmation matches this claim. Save the existing answer below; you do not need to retype it.'}</p>}
    <details><summary className="cursor-pointer">Wording to confirm</summary><blockquote className="text-sm mt-2">{fact.claim.text}</blockquote></details>
    {related.length > 1 && <details><summary>Affects {related.length} passages about this work</summary>{related.map(f => <p key={f.claim.id}>{f.claim.text}</p>)}</details>}
    {restored.assertion && restored.claimText !== fact.claim.text && <p>Your earlier answer is retained. Review it against this question before confirming.</p>}
    <p className="text-sm">{fact.explanation}</p>
    {retained ? <details><summary className="cursor-pointer">Review or edit your earlier answer</summary>
      <p className="text-sm">{fact.question}</p>
      <label className="block">Your factual answer<textarea className={inputClass} required value={assertion} disabled={inputsDisabled} onChange={e => setAssertion(e.target.value)} /></label>
    </details> : <label className="block">Your factual answer<textarea className={inputClass} required value={assertion} disabled={inputsDisabled} onChange={e => setAssertion(e.target.value)} /></label>}
    <p className="text-xs">Confirm only if the highlighted wording accurately describes your work. Otherwise, edit the wording. You can also save your answer and leave the question unresolved.</p>
    {!!fact.evidence.length && <details><summary className="cursor-pointer">Evidence checked ({fact.evidence.length})</summary>{fact.evidence.map((q, i) => <blockquote key={i} className="text-sm mt-2">{sourceLabel(sources, q.evidence_id)}: {q.quote}</blockquote>)}</details>}
    <details><summary>Use supporting evidence</summary>
      <label className="block">Captured source<SourcePicker label="Captured source" value={sourceIndex} disabled={inputsDisabled} onSelect={value => { setSourceIndex(value); setQuote(''); }} options={sources.map((s, i) => ({ id: String(i + 1), name: sourceLabel(sources, s.evidence_id), type: s.field }))} /></label>
      {source && <><blockquote>{source.text}</blockquote><label className="block">Exact supporting quotation<textarea className={inputClass} value={quote} disabled={inputsDisabled} onChange={e => setQuote(e.target.value)} /></label>{quote && start < 0 && <p role="alert">Copy an exact passage from this source.</p>}</>}
    </details>
    <label className="block">Reuse this answer<select className={inputClass} value={reuse} onChange={e => setReuse(e.target.value as 'job' | 'project' | 'employer')} disabled={inputsDisabled}>
      {isTitleFact ? (
        <>
          <option value="employer">Remember for this employment</option>
          <option value="job">This job only</option>
        </>
      ) : (
        <>
          <option value="project">Matching work in this project</option>
          <option value="job">This job only</option>
        </>
      )}
    </select></label>
    {(reuse === 'project' || reuse === 'employer') && sharedAnswers.length > 0 && <label className="block">Correct an earlier answer about this claim (optional)<select className={inputClass} value={validReplacement} onChange={e => { setReplaceShared(e.target.value); setCorrection(sharedAnswers.find(c => c.update_id === e.target.value)?.clarification.assertion ?? ''); }} disabled={inputsDisabled}>
      <option value="">Keep existing shared answers</option>{sharedAnswers.map(c => <option key={c.update_id} value={c.update_id}>{c.clarification.assertion}</option>)}
    </select></label>}
    {(fact.state === 'contradicted' || validReplacement) && <>
      <label className="block">Exact older assertion being corrected<input className={inputClass} required value={correction} disabled={inputsDisabled} onChange={e => setCorrection(e.target.value)} /></label>
      <label className="block">Effective date<input className={inputClass} type="date" required value={date} disabled={inputsDisabled} onChange={e => setDate(e.target.value)} /></label>
    </>}
    {needsSource && <div className="rounded border border-amber-400 bg-amber-50 dark:bg-amber-950/30 p-3 text-sm space-y-2">
      <p>To reuse this answer across the project, add a quotation under Use supporting evidence. You can confirm it for this job now without a source.</p>
      <button type="button" className={secondaryButton} disabled={disabled || !assertion.trim() || (fact.state === 'contradicted' && (!date || !correction.trim()))} onClick={() => { setReuse('job'); void onSave(assertion, date, correction, [], true, 'job', ''); }}>Confirm for this job instead</button>
    </div>}
    {feedback}
    <button className={`${primaryButton} min-h-11`} disabled={disabled || needsSource || !assertion.trim() || (!!source && !quotes.length)}>{inputsDisabled ? 'Saving…' : checking ? 'Updating checks…' : retained ? reuse === 'employer' ? 'Save existing answer for this employment' : reuse === 'project' ? 'Save existing answer for this project' : 'Save existing answer for this job' : reuse === 'employer' ? 'Confirm and save for this employment' : reuse === 'project' ? 'Confirm and save for this project' : 'Confirm for this job and continue'}</button>
    {fact.state !== 'contradicted' && <button type="button" className={`${secondaryButton} min-h-11`} disabled={disabled || !assertion.trim()} onClick={() => void onSave(assertion, date, correction, quotes, false, 'job', '')}>Save answer, keep unresolved</button>}
  </form>;
}
