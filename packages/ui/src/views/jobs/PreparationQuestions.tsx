import { useCallback, useState } from 'react';
import { apiClient, type PreparationQuestionGroup, type PreparationMaterialQuestion } from '../../api/client.js';
import { useIntentKey, useJobsData } from '../../hooks/useJobsData.js';
import { cardClass, inputClass, primaryButton, secondaryButton } from '../tailoring/ui.js';
export function PreparationQuestions({ batchId, navigate }: { batchId: string; navigate: (path: string) => void }) {
  const load = useCallback(() => apiClient.getPreparationQuestions(batchId), [batchId]), { data, error, refresh } = useJobsData(load);
  return <main className="max-w-4xl mx-auto space-y-4"><h1 className="text-2xl font-semibold">Preparation questions</h1>
    <p>Answer only for the selected jobs and work shown below. Other jobs continue preparing. Shared evidence and resumes are unchanged.</p>
    <button className={secondaryButton} onClick={() => navigate(`/jobs/preparation-batches/${batchId}/review`)}>Review prepared PDFs</button>
    {error && <p role="alert">{error}</p>}{data && !data.groups.length && !data.materials?.length && <p>No unresolved factual questions. Check preparation progress for technical recovery or material decisions.</p>}
    {data?.materials?.map(material => <MaterialDecision key={`${material.review_id}:${material.proposal_id}`} material={material} batchId={batchId} onSaved={() => void refresh()} />)}
    {data?.groups.map(group => <Question key={group.id} group={group} batchId={batchId} onSaved={() => void refresh()} />)}
  </main>;
}
function Question({ group, batchId, onSaved }: { group: PreparationQuestionGroup; batchId: string; onSaved: () => void }) {
  const storage = `preparation-answer:${batchId}:${JSON.stringify([group.members[0].fact, group.members[0].assertion, group.members.map(m => m.job_id)])}`;
  const [answer, setAnswer] = useState(() => sessionStorage.getItem(storage) ?? '');
  const [selected, setSelected] = useState(() => group.members.map(m => m.job_id));
  const [confirmed, setConfirmed] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const [result, setResult] = useState(''), [older, setOlder] = useState(''), [date, setDate] = useState('');
  const key = useIntentKey(), correction = group.members[0].state === 'contradicted';
  const act = async (action: 'answer' | 'narrower' | 'later') => {
    const payload = { members: group.members.filter(m => selected.includes(m.job_id)), action, assertion: answer.trim() || 'Answer later',
      confirmed, kind: correction ? 'correction' : 'confirmation', ...(correction ? { corrected_assertion: older, effective_date: date } : {}) };
    setBusy(true); setError('');
    try {
      const response = await apiClient.answerPreparationQuestion(batchId, group.id, { ...payload, idempotency_key: key(payload) });
      setResult(response.result.map(item => `${group.details.find(d => d.job_id === item.job_id)?.company ?? item.job_id}: ${item.status}${item.error ? ` — ${item.error}` : ''}`).join('\n'));
      onSaved();
    } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  };
  return <section className={`${cardClass} p-5 space-y-3 min-w-0`}><h2 className="text-lg font-semibold">{group.members[0].question}</h2>
    <p className="break-words">Claim: {group.members[0].assertion}</p>
    <fieldset><legend>Apply this answer only to selected jobs</legend>{group.members.map(member => {
      const detail = group.details.find(d => d.job_id === member.job_id);
      return <label key={member.job_id} className="flex gap-2 py-2"><input type="checkbox" checked={selected.includes(member.job_id)} onChange={e => setSelected(previous => e.target.checked ? [...previous, member.job_id] : previous.filter(id => id !== member.job_id))} />
        {detail?.company} — {detail?.role} · {member.fact.predicate} · {member.fact.qualifiers.join(', ') || 'no additional qualifiers'}</label>;
    })}</fieldset>
    {group.details.map(detail => <details key={detail.job_id}><summary>{detail.company}: captured sources and work scope</summary>
      <p className="break-words">Work: {group.members.find(m => m.job_id === detail.job_id)?.fact.work_id}</p>
      {detail.facts.map(fact => <div key={fact.claim.id}><p>{fact.explanation}</p>{fact.evidence.map((quote, i) => <blockquote className="whitespace-pre-wrap break-words" key={i}>{quote.evidence_id}: {quote.quote}</blockquote>)}</div>)}
      {!detail.facts.some(f => f.evidence.length) && detail.sources?.map((source, i) => <blockquote className="whitespace-pre-wrap break-words" key={i}>{source.evidence_id}: {source.text}</blockquote>)}
    </details>)}
    <label className="block" htmlFor={`preparation-answer-${group.id}`}>Your factual answer</label>
    <textarea id={`preparation-answer-${group.id}`} className={`${inputClass} w-full`} value={answer} onChange={e => { setAnswer(e.target.value); sessionStorage.setItem(storage, e.target.value); }} />
    {correction && <><label className="block">Older assertion being corrected<input className={inputClass} value={older} onChange={e => setOlder(e.target.value)} /></label><label className="block">Effective date<input type="date" className={inputClass} value={date} onChange={e => setDate(e.target.value)} /></label></>}
    <label className="flex gap-2"><input type="checkbox" checked={confirmed} onChange={e => setConfirmed(e.target.checked)} />I confirm this answer for this work and the visibly selected jobs.</label>
    {group.members.every(member => member.narrower) && <section className="space-y-2"><p>Use captured narrower wording instead of confirming the uncertain claim:</p>{[...new Set(group.members.map(member => member.narrower!.text))].map(text => <blockquote key={text}>{text}</blockquote>)}<button className={secondaryButton} disabled={busy || !selected.length} onClick={() => void act('narrower')}>Use narrower wording</button></section>}
    <div className="flex flex-wrap gap-3"><button className={primaryButton} disabled={busy || !selected.length || !answer.trim() || (correction && (!date || !older))} onClick={() => void act('answer')}>Save answer</button>
      <button className={secondaryButton} disabled={busy || !selected.length} onClick={() => void act('later')}>Answer later</button></div>
    {error && <p role="alert">{error}</p>}{result && <p role="status" className="whitespace-pre-wrap">{result}</p>}
  </section>;
}
function MaterialDecision({ material, batchId, onSaved }: { material: PreparationMaterialQuestion; batchId: string; onSaved: () => void }) {
  const [error, setError] = useState(''), [busy, setBusy] = useState(false), key = useIntentKey();
  const decide = async (action: 'omit' | 'retain' | 'later') => {
    const body = { job_id: material.job_id, expected_job_revision: material.job_revision, review_id: material.review_id,
      expected_review_revision: material.review_revision, input_fingerprint: material.input_fingerprint, proposal_id: material.proposal_id, action };
    setBusy(true); setError('');
    try { await apiClient.decidePreparationMaterial(batchId, { ...body, idempotency_key: key(body) }); onSaved(); }
    catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  };
  return <section className={`${cardClass} p-5 space-y-3`}><h2 className="text-lg font-semibold">{material.question}</h2><p>{material.company} — {material.role}</p>
    <blockquote>{material.before}</blockquote><p>{material.reason}</p><p>This is a content decision, not a factual confirmation. Retaining keeps the exact wording shown above.</p>
    <div className="flex flex-wrap gap-3"><button className={primaryButton} disabled={busy} onClick={() => void decide('retain')}>Keep documented accomplishment</button>
      <button className={secondaryButton} disabled={busy} onClick={() => void decide('omit')}>Omit this accomplishment</button>
      <button className={secondaryButton} disabled={busy} onClick={() => void decide('later')}>Answer later</button></div>{error && <p role="alert">{error}</p>}
  </section>;
}
