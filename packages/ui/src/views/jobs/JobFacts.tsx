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
export function JobFacts({ jobId, target, onResolved, onRevise, onKeepOriginal, reactive = false }: {
  jobId: string; target?: SemanticTarget; onResolved?(): void | Promise<void>; reactive?: boolean;
  onRevise?(fact: JobFact): void; onKeepOriginal?(fact: JobFact): Promise<void>;
}) {
  const identity = JSON.stringify([jobId, target]);
  const generation = useRef({ identity, value: 0 });
  if (generation.current.identity !== identity) generation.current = { identity, value: generation.current.value + 1 };
  const sequence = generation.current.value;
  const [view, setView] = useState<{ identity: string; data: Facts }>();
  const [error, setError] = useState(''), [busy, setBusy] = useState(false);
  const [selected, setSelected] = useState<string>();
  const [savingClaim, setSavingClaim] = useState<string>();
  const current = useRef(identity); current.current = identity;
  const priorEdit = useRef(identity), lock = useRef(false);
  const readSequence = useRef(0);
  const inFlight = useRef<{ sequence: number; promise: Promise<Facts> }>();
  const data = view?.identity === identity ? view.data : undefined;
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
    if (lock.current) return;
    if (reason === 'edit') priorEdit.current = identity;
    lock.current = true; setBusy(true); setError('');
    try {
      const snapshot = await load();
      if (current.current !== identity || generation.current.value !== sequence) return;
      await apiClient.startJobFactCheck(jobId, { target: snapshot.target, input_fingerprint: snapshot.input_fingerprint,
        expected_job_revision: snapshot.job_revision, expected_semantic_revision: snapshot.semantic_revision,
        reason, idempotency_key: crypto.randomUUID() });
      await load();
    } catch (e) { if (current.current === identity) setError(e instanceof Error ? e.message : 'Check unavailable.'); }
    finally { lock.current = false; setBusy(false); }
  }, [identity, sequence, load]);
  useEffect(() => {
    if (!reactive || busy || priorEdit.current === identity) return;
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
  const groups = groupReviewFacts(data?.facts ?? []);
  const pendingGroups = groups.filter(g => !g.resolved);
  const group = groups.find(g => g.facts.some(f => f.claim.id === selected)) ?? pendingGroups[0];
  const unresolved = data?.facts.filter(f => !f.resolution) ?? [];
  const fact = group?.facts[0];
  const resolvedCount = (data?.facts.length ?? 0) - unresolved.length;
  return <section aria-label="Facts to review" className={`${cardClass} p-4 space-y-3`}>
    <div className="flex justify-between gap-3"><h2 className="font-semibold">Facts to review</h2>
      {data && <span role="status">{resolvedCount} of {data.facts.length} resolved</span>}</div>
    <p className="text-sm">Confirm what you did, or correct the wording. Answers apply only to this job and the same work.</p>
    {error && <p role="alert">{error}</p>}
    {!data && !error && <p role="status">Loading facts…</p>}
    {data && <>
      {data.execution === 'checking' && <p role="status">Checking captured evidence…</p>}
      {data.reason && <p>{data.reason}</p>}
      {!data.configuration_evaluated && <p className="text-sm">Automatic support is not enabled for this model configuration. You can still confirm individual facts.</p>}
      <button className={secondaryButton} disabled={busy || data.execution === 'checking'} onClick={() => void check(data.execution === 'unavailable' ? 'retry' : 'check')}>{data.execution === 'unavailable' ? 'Retry evidence check' : 'Check evidence'}</button>
      {fact ? <FactEditor key={`${identity}:${fact.claim.id}`} recoveryKey={`fact-answer:${jobId}:${data.input_fingerprint}:${fact.passage.subject.id}`}
        fact={fact} related={group!.facts} sources={data.sources ?? []} inputsDisabled={savingClaim === fact.claim.id} disabled={busy || data.execution === 'checking'} onSave={async (assertion, date, correction, quotes, confirmed) => {
        if (lock.current) return;
        lock.current = true; setBusy(true); setSavingClaim(fact.claim.id); setError('');
        try {
          const next = await apiClient.saveJobFactClarification(jobId, { target: data.target,
            expected_job_revision: data.job_revision, expected_semantic_revision: data.semantic_revision,
            input_fingerprint: data.input_fingerprint, idempotency_key: crypto.randomUUID(), claim_ids: group!.facts.map(f => f.claim.id),
            fact: fact.claim.fact, assertion, confirmed, kind: fact.state === 'contradicted' ? 'correction' : 'confirmation',
            source_ids: [...new Set([...group!.facts.flatMap(f => f.evidence.map(e => e.evidence_id)), ...quotes.map(q => q.evidence_id)])], supporting_quotes: quotes,
            supersedes: data.clarifications.find(c => sameFact(c.fact, fact.claim.fact))?.id ?? null,
            ...(fact.state === 'contradicted' ? { effective_date: date, corrected_assertion: correction } : {}) });
          if (current.current !== identity) return;
          readSequence.current++;
          setView({ identity, data: next });
          setSelected(next.facts.find(f => !f.resolution)?.claim.id);
          if (!confirmed) setError('Answer saved. This fact still needs confirmation or revised wording.');
          try { localStorage.removeItem(`fact-answer:${jobId}:${data.input_fingerprint}:${fact.passage.subject.id}`); } catch {}
          await onResolved?.();
          if (onResolved) await load();
        } catch (e) { setError(e instanceof Error ? e.message : 'Could not save this answer.'); }
        finally { lock.current = false; setBusy(false); setSavingClaim(undefined); }
      }} /> : <p role="status">All facts resolved. Resume checks still apply.</p>}
      {fact && onRevise && <button className={secondaryButton} disabled={busy} onClick={() => onRevise(fact)}>Revise wording</button>}
      {fact?.passage.subject.proposal_id && onKeepOriginal && <button className={secondaryButton} disabled={busy} onClick={async () => {
        setBusy(true); try { await onKeepOriginal(fact); await load(); } catch (e) { setError(e instanceof Error ? e.message : 'Could not restore original wording.'); } finally { setBusy(false); }
      }}>Keep original wording</button>}
      {!!pendingGroups.length && <details><summary>Other facts ({pendingGroups.length})</summary><ul>{pendingGroups.map(g => <li key={g.id}><button className="text-left underline min-h-11" onClick={() => setSelected(g.id)}>{g.facts[0].claim.text}</button></li>)}</ul></details>}
      {!!resolvedCount && <details><summary>Resolved facts and supporting sources</summary>{data.facts.filter(f => f.resolution).map(f => <div key={f.claim.id} className="py-2">
        <p>{f.claim.text}</p><p className="text-sm">{f.resolution?.provenance === 'human' ? 'Confirmed for this job' : 'Supported by captured evidence'}: {f.resolution?.explanation}</p>
        {f.evidence.map((q, i) => <blockquote key={i}>{sourceLabel(data.sources ?? [], q.evidence_id)}: {q.quote}</blockquote>)}
        <button className={`${secondaryButton} min-h-11`} disabled={busy} onClick={() => setSelected(f.claim.id)}>Review this fact</button>
      </div>)}</details>}
      {onResolved && <button className={primaryButton} disabled={busy || data.execution === 'checking'} onClick={async () => {
        setBusy(true); try { await onResolved(); } catch (e) { setError(e instanceof Error ? e.message : 'Checks unavailable.'); } finally { setBusy(false); }
      }}>Update resume checks</button>}
      <details><summary>Check usage</summary><p>{data.usage.dispatched} model calls · {Math.round(data.usage.elapsed_ms / 1000)} seconds. Token usage and cost are unavailable from this runner.</p></details>
    </>}
  </section>;
}
function FactEditor({ fact, related, sources, recoveryKey, disabled, inputsDisabled, onSave }: { fact: JobFact; related: JobFact[]; sources: SemanticSource[]; recoveryKey: string; disabled: boolean; inputsDisabled: boolean; onSave(assertion: string, date: string, correction: string, quotes: SourceQuote[], confirmed: boolean): Promise<void> }) {
  const [restored] = useState(() => { try { return JSON.parse(localStorage.getItem(recoveryKey) ?? '{}'); } catch { return {}; } });
  const [assertion, setAssertion] = useState<string>(restored.assertion ?? ''), [date, setDate] = useState<string>(restored.date ?? ''), [correction, setCorrection] = useState<string>(restored.correction ?? '');
  const [sourceIndex, setSourceIndex] = useState(''), [quote, setQuote] = useState('');
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => { heading.current?.focus(); }, []);
  useEffect(() => { try { localStorage.setItem(recoveryKey, JSON.stringify({ assertion, date, correction, claimText: fact.claim.text })); } catch {} }, [recoveryKey, assertion, date, correction, fact.claim.text]);
  const source = sourceIndex ? sources[Number(sourceIndex) - 1] : undefined;
  const start = source?.text.indexOf(quote) ?? -1;
  const quotes: SourceQuote[] = source && quote.trim() && start >= 0 ? [{ evidence_id: source.evidence_id, evidence_fingerprint: source.evidence_fingerprint, field: source.field, start: source.start + start, end: source.start + start + quote.length, quote }] : [];
  return <form className="space-y-3 border rounded p-3" onSubmit={e => { e.preventDefault(); void onSave(assertion, date, correction, quotes, true); }}>
    <p className="text-xs">{passageLabel(fact)}{fact.passage.inherited ? ' · Existing wording' : ' · Proposed wording'}</p>
    <h3 ref={heading} tabIndex={-1} className="font-medium">{fact.claim.text}</h3>
    {related.length > 1 && <details><summary>Affects {related.length} passages about this work</summary>{related.map(f => <p key={f.claim.id}>{f.claim.text}</p>)}</details>}
    <p>{fact.question ?? 'Does this exact claim accurately describe your work?'}</p>
    {restored.assertion && restored.claimText !== fact.claim.text && <p>Your earlier answer is retained. Review it against this question before confirming.</p>}
    <p className="text-sm">{fact.explanation}</p>
    {fact.evidence.map((q, i) => <blockquote key={i} className="text-sm">{sourceLabel(sources, q.evidence_id)}: {q.quote}</blockquote>)}
    <label className="block">Your factual answer<textarea className={inputClass} required value={assertion} disabled={inputsDisabled} onChange={e => setAssertion(e.target.value)} /></label>
    <p className="text-xs">Saving confirms the quoted claim, including its qualifiers. If it is inaccurate, edit the wording instead.</p>
    <details><summary>Use supporting evidence</summary>
      <label className="block">Captured source<SourcePicker label="Captured source" value={sourceIndex} disabled={inputsDisabled} onSelect={value => { setSourceIndex(value); setQuote(''); }} options={sources.map((s, i) => ({ id: String(i + 1), name: sourceLabel(sources, s.evidence_id), type: s.field }))} /></label>
      {source && <><blockquote>{source.text}</blockquote><label className="block">Exact supporting quotation<textarea className={inputClass} value={quote} disabled={inputsDisabled} onChange={e => setQuote(e.target.value)} /></label>{quote && start < 0 && <p role="alert">Copy an exact passage from this source.</p>}</>}
    </details>
    {fact.state === 'contradicted' && <>
      <label className="block">Exact older assertion being corrected<input className={inputClass} required value={correction} disabled={inputsDisabled} onChange={e => setCorrection(e.target.value)} /></label>
      <label className="block">Effective date<input className={inputClass} type="date" required value={date} disabled={inputsDisabled} onChange={e => setDate(e.target.value)} /></label>
    </>}
    <button className={`${primaryButton} min-h-11`} disabled={disabled || !assertion.trim() || (!!source && !quotes.length)}>{inputsDisabled ? 'Saving…' : disabled ? 'Updating checks…' : 'Confirm for this job and continue'}</button>
    {fact.state !== 'contradicted' && <button type="button" className={`${secondaryButton} min-h-11`} disabled={disabled || !assertion.trim()} onClick={() => void onSave(assertion, date, correction, quotes, false)}>Save answer, keep unresolved</button>}
  </form>;
}
