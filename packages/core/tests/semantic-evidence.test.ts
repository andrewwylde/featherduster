import { expect, it } from 'vitest';
import { FactSchema, ClarificationSchema, SemanticResultSchema, ClaimSchema, SourceQuoteSchema, SubjectSchema } from '../src/jobs/semantic-evidence.js';
import { sameFact, resolveSemanticFindings, validClaimBinding } from '../src/jobs/semantic-policy.js';
import type { ClaimResult, SemanticPassage, SemanticSource } from '../src/jobs/semantic-evidence.js';

it('does not generalize a fact across work or stronger qualifiers', () => {
  const fact = FactSchema.parse({ work_id: 'api-a', predicate: 'production', qualifiers: [] });
  expect(sameFact(fact, { ...fact, work_id: 'api-b' })).toBe(false);
  expect(sameFact(fact, { ...fact, qualifiers: ['100000 users'] })).toBe(false);
  expect(sameFact(fact, { ...fact })).toBe(true);
});
it('requires dated, source-specific contradiction corrections', () => {
  const clarification = { schema_version: 1, id: '11111111-1111-4111-8111-111111111111', job_id: '11111111-1111-4111-8111-111111111111', input_snapshot_id: '11111111-1111-4111-8111-111111111111', revision: 0, kind: 'correction', fact: { work_id: 'api-a', predicate: 'production', qualifiers: [] }, claim_ids: ['claim'], question: 'Deployed?', assertion: 'Deployed after prototype', actor: 'user', recorded_at: '2026-10-20T00:00:00Z', source_ids: ['source'], supersedes: null, corrected_assertion: 'Never deployed', effective_date: '2026-02-30' };
  expect(ClarificationSchema.safeParse(clarification).success).toBe(false);
  expect(ClarificationSchema.safeParse({ ...clarification, effective_date: '2026-02-28' }).success).toBe(true);
  expect(ClarificationSchema.safeParse({ ...clarification, effective_date: '2026-02-28', source_ids: [] }).success).toBe(false);
});
it('rejects empty automatic support and forged properties', () => {
  expect(SemanticResultSchema.safeParse({ state: 'supported', passages: [], ready: true }).success).toBe(false);
  expect(FactSchema.safeParse({ work_id: 'work', predicate: 'backend', qualifiers: [], trusted: true }).success).toBe(false);
});
it('never clears independent checks through semantic support', () => {
  const findings = [{ kind: 'unsupported_experience', claim_id: 'backend' }, { kind: 'metric_unverified', claim_id: 'backend' }, { kind: 'privacy', claim_id: 'backend' }, { kind: 'unsupported_citation', claim_id: 'backend' }];
  expect(resolveSemanticFindings(findings, new Set(['backend'])).map(f => f.kind)).toEqual(['metric_unverified', 'privacy', 'unsupported_citation']);
});
it('cannot borrow a quoted source from another employer for an employment bullet', () => {
  const subject = { id: 's', path: 'experiences.0.bullets.0.text', passage_fingerprint: 'hash' };
  const passage: SemanticPassage = { subject, work_id: 'work', work_context: JSON.stringify({ company: 'Acme' }), text: 'Built APIs.', inherited: true };
  const source: SemanticSource = { evidence_id: 'e', evidence_fingerprint: 'hash', work_id: 'other', company: 'Other Company', field: 'summary', start: 0, text: 'Built APIs.' };
  const result: ClaimResult = { claim: { id: 'c', subject, text: passage.text, start: 0, end: passage.text.length,
    fact: { work_id: 'work', predicate: 'backend', qualifiers: [] }, qualifier_text: [] }, state: 'supported',
    evidence: [{ evidence_id: 'e', evidence_fingerprint: 'hash', field: 'summary', start: 0, end: source.text.length, quote: source.text }], explanation: 'Literal match.' };
  expect(validClaimBinding(result, passage, [source])).toBe(false);
  expect(validClaimBinding(result, passage, [{ ...source, company: 'ACME' }])).toBe(true);
});

it('preserves exact verbatim text with leading or trailing whitespace in claims and source quotes', () => {
  const subject = SubjectSchema.parse({ id: 's', path: 'path', passage_fingerprint: 'fp' });
  const textWithEdgeSpace = 'Built a UI; ';
  const claim = ClaimSchema.parse({
    id: 'c1',
    subject,
    text: textWithEdgeSpace,
    start: 0,
    end: textWithEdgeSpace.length,
    fact: { work_id: 'w1', predicate: 'built', qualifiers: [] },
    qualifier_text: [],
  });
  expect(claim.text).toBe(textWithEdgeSpace);
  expect(claim.end - claim.start).toBe(textWithEdgeSpace.length);

  const quoteWithEdgeSpace = ' shipped an API. ';
  const quote = SourceQuoteSchema.parse({
    evidence_id: 'e1',
    evidence_fingerprint: 'fp',
    field: 'narrative',
    start: 5,
    end: 5 + quoteWithEdgeSpace.length,
    quote: quoteWithEdgeSpace,
  });
  expect(quote.quote).toBe(quoteWithEdgeSpace);
  expect(quote.end - quote.start).toBe(quoteWithEdgeSpace.length);

  // Whitespace-only quote or claim must fail
  expect(SourceQuoteSchema.safeParse({ ...quote, quote: '   ', start: 0, end: 3 }).success).toBe(false);
  expect(ClaimSchema.safeParse({ ...claim, text: '   ', start: 0, end: 3 }).success).toBe(false);
});
