import { sameFact, type JobFact, type JobFacts } from '@featherduster/core';

export function factAnswerKeys(jobId: string, inputFingerprint: string, fact: JobFact) {
  const legacy = `fact-answer:${jobId}:${inputFingerprint}:${fact.passage.subject.id}`;
  return { current: `${legacy}:${fact.claim.id}`, legacy };
}
export function readFactAnswer(current: string, legacy: string, claimText: string) {
  try {
    const value = JSON.parse(localStorage.getItem(current) ?? localStorage.getItem(legacy) ?? '{}');
    return value.claimText === claimText ? value : {};
  } catch { return {}; }
}
export function retainedFactAnswer(data: JobFacts, fact: JobFact) {
  const superseded = new Set(data.clarifications?.flatMap(c => c.supersedes ? [c.supersedes] : []));
  const saved = data.clarifications?.filter(c => c.confirmed === false && !superseded.has(c.id) && sameFact(c.fact, fact.claim.fact)
    && (!c.confirmed_claims || c.confirmed_claims.includes(fact.claim.text))).at(-1);
  const keys = factAnswerKeys(data.job_id, data.input_fingerprint, fact);
  const local = readFactAnswer(keys.current, keys.legacy, fact.claim.text);
  return { assertion: typeof local.assertion === 'string' ? local.assertion : saved?.assertion ?? '', saved: !!saved };
}
