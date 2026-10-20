import { describe, it, expect } from 'vitest';
import { DEFAULT_STARTER_RESUME, ProposalSchema, ProposalPatchSchema, applyProposalPatches, normalizeGenerationProposals, detectProposalConflicts, normalizeProposalIssues, validateProposalReview, ProposalReviewRevisionSchema, BaseCorrectionSchema, relocateBaseCorrection, ResumeSpecSchema } from '../src/index.js';
const p = (id = 'p') => ProposalSchema.parse({ id, type: 'summary.rewrite', target: {}, after: 'Engineer' });
describe('proposal review boundary', () => {
  it('normalizes duplicate and empty IDs once and removes model authority', () => {
    const values = normalizeGenerationProposals([{ ...p(), id: '', decision: 'accepted', checks: [{ severity: 'block', kind: 'bad', message: 'bad' }] }, p(), p(), p('proposal-1')]);
    expect(new Set(values.map(v => v.id)).size).toBe(4);
    expect(values.every(v => v.decision === 'pending' && v.checks.length === 0)).toBe(true);
  });
  it('rejects all forged patch fields, unknown IDs and duplicate edits', () => {
    for (const field of ['id', 'type', 'target', 'after', 'checks', 'status', 'ready']) expect(ProposalPatchSchema.safeParse({ proposal_id: 'p', decision: 'pending', [field]: 'forged' }).success).toBe(false);
    expect(ProposalPatchSchema.safeParse({ proposal_id: 'p', decision: 'accepted' }).success).toBe(false);
    expect(() => applyProposalPatches([p()], [], [{ proposal_id: 'other', decision: 'rejected' }])).toThrow();
    expect(() => applyProposalPatches([p()], [], [{ proposal_id: 'p', decision: 'rejected' }, { proposal_id: 'p', decision: 'pending' }])).toThrow();
  });
  it('keeps cumulative overlays, clears machine checks and invalidates only changed claims', () => {
    const generation = [p(), p('other')];
    const first = applyProposalPatches(generation, [], [{ proposal_id: 'p', edited_after: 'Revised' }]);
    const groundings = [{ proposal_id: 'p' }, { proposal_id: 'other' }] as Parameters<typeof applyProposalPatches>[3];
    const next = applyProposalPatches(generation, first.patches, [{ proposal_id: 'other', citations: ['ev-001'] }], groundings);
    expect(next.proposals[0].edited_after).toBe('Revised');
    expect(next.groundings).toEqual([{ proposal_id: 'p' }]);
    expect(generation[0].edited_after).toBeUndefined();
    expect(applyProposalPatches(generation, next.patches, [{ proposal_id: 'p', decision: 'rejected' }], next.groundings).groundings).toEqual(next.groundings);
  });
  it('blocks competing targets but permits reorder plus insertion', () => {
    expect(detectProposalConflicts([p(), p('other')])).toHaveLength(2);
    const reorder = ProposalSchema.parse({ ...p(), type: 'bullet.reorder', target: { experience_index: 0 }, order: [0] });
    const add = ProposalSchema.parse({ ...p('add'), type: 'bullet.add', target: { experience_index: 0, bullet_index: 0 } });
    expect(detectProposalConflicts([reorder, add])).toEqual([]);
    expect(detectProposalConflicts([reorder, { ...reorder, id: 'r2' }])).toHaveLength(2);
    expect(detectProposalConflicts([p(), { ...p('other'), decision: 'rejected' }])).toEqual([]);
  });
  it('groups grounding without losing individual issue details', () => {
    const issues = normalizeProposalIssues([{ subject: { kind: 'proposal', proposal_id: 'p' }, issues: [{ severity: 'block', kind: 'unsupported_experience', message: 'backend' }, { severity: 'block', kind: 'unsupported_citation', message: 'missing' }] }]);
    expect(issues).toHaveLength(1); expect(issues[0].details).toHaveLength(2);
  });
  it('all-rejected proposals cannot bypass retained metric, citation, placeholder or privacy checks', () => {
    const base = structuredClone(DEFAULT_STARTER_RESUME);
    base.summary = 'Kafka 900% ev-999 [METRIC NEEDED] SECRET';
    const result = validateProposalReview(base, [{ ...p(), decision: 'rejected' }], { analysis: { company: '', role: '', seniority: '', mission: '', requirements: [{ id: 'r', tier: 'must', text: 'Kafka', quote: '', terms: ['Kafka'] }], boilerplate: [] }, alignment: { rows: [] }, evidence: [] }, { banned_keywords: ['SECRET'], replacements: [], strip_patterns: [] });
    expect(result.valid).toBe(false);
    const kinds = result.issues.flatMap(i => i.details.map(d => d.kind));
    expect(kinds).toEqual(expect.arrayContaining(['unsupported_experience', 'metric_unverified', 'unsupported_citation', 'metric_needed', 'privacy']));
    expect(result.issues.every(i => i.subject.kind === 'candidate' && i.action === 'refresh_base')).toBe(true);
  });
  it('does not accept arbitrary review objects', () => { expect(ProposalReviewRevisionSchema.safeParse({ ready: true }).success).toBe(false); });
  it('scans published wording for privacy without treating internal citation IDs as wording', () => {
    const base = structuredClone(DEFAULT_STARTER_RESUME);
    base.experiences[0].bullets[0] = { text: 'Built SECRET tooling.', citations: ['SECRET-source'] };
    const result = validateProposalReview(base, [], { analysis: { company: '', role: '', seniority: '', mission: '', requirements: [], boilerplate: [] }, alignment: { rows: [] }, evidence: [] }, { banned_keywords: ['SECRET'], replacements: [], strip_patterns: [] });
    const privacy = result.issues.filter(i => i.details.some(d => d.kind === 'privacy'));
    expect(privacy.some(i => i.subject.kind === 'candidate' && i.subject.path === 'experiences.0.bullets.0.text')).toBe(true);
    expect(privacy.some(i => i.subject.kind === 'candidate' && i.subject.path.includes('.citations'))).toBe(false);
    expect(result.issues.some(i => i.details.some(d => d.kind === 'unsupported_citation'))).toBe(true);
  });
});

it('invalidates a grounding only when its captured source binding changes', () => {
  const groundings = [{ proposal_id: 'p', sources: [{ evidence_id: 'ev-1', evidence_fingerprint: 'old' }] }, { proposal_id: 'other', sources: [{ evidence_id: 'ev-2', evidence_fingerprint: 'same' }] }] as Parameters<typeof applyProposalPatches>[3];
  const result = applyProposalPatches([p(), p('other')], [], [], groundings, new Map([['ev-1', 'new'], ['ev-2', 'same']]));
  expect(result.groundings.map(g => g.proposal_id)).toEqual(['other']);
});

describe('starting-resume correction relocation', () => {
  const exp = (company: string, ...texts: string[]) => ({ company, role: 'Engineer', startDate: '2020-01', endDate: '2024-01', bullets: texts.map(text => ({ text })) });
  const spec = (...experiences: ReturnType<typeof exp>[]) => ResumeSpecSchema.parse({ profile: { name: 'T', title: 'E', email: 'a@b.com' }, experiences, education: [], skills: [] });
  const fix = { path: 'experiences.0.bullets.0.text', before: 'Cut cost 91%.', after: 'Cut cost.', recorded_by: 'local-human', recorded_at: new Date().toISOString() };
  it('parses older anchor-less corrections and carries them only on an exact index and text match', () => {
    expect(BaseCorrectionSchema.parse(fix)).toEqual(fix);
    expect(relocateBaseCorrection(spec(exp('Acme', 'Cut cost 91%.')), fix)).toMatchObject({ status: 'carried', correction: { path: fix.path } });
    expect(relocateBaseCorrection(spec(exp('Globex', 'Other.'), exp('Acme', 'Cut cost 91%.')), fix)).toEqual({ status: 'unapplied' });
  });
  it('follows an anchored employer and its captured wording, never a different employer with the same text', () => {
    const anchored = { ...fix, anchor: { company: 'Acme', role: 'Engineer', startDate: '2020-01' } };
    expect(relocateBaseCorrection(spec(exp('Globex', 'Cut cost 91%.'), exp('Acme', 'New first.', 'Cut cost 91%.')), anchored)).toMatchObject({ status: 'carried', correction: { path: 'experiences.1.bullets.1.text' } });
    expect(relocateBaseCorrection(spec(exp('Acme', 'Cut cost 91%.'), exp('Acme', 'Cut cost 91%.')), anchored)).toEqual({ status: 'unapplied' });
    expect(relocateBaseCorrection(spec(exp('Globex', 'Cut cost 91%.')), anchored)).toEqual({ status: 'unapplied' });
    expect(relocateBaseCorrection(spec(exp('Acme', 'Cut cost.')), anchored)).toEqual({ status: 'already_shared' });
  });
  it('rejects leading-zero location aliases', () => {
    expect(BaseCorrectionSchema.safeParse({ ...fix, path: 'experiences.01.bullets.0.text' }).success).toBe(false);
  });
});
