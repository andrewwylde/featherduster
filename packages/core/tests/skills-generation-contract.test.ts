import { expect, it } from 'vitest';
import {
  PROPOSALS_JSON_SCHEMA, LEGACY_PROPOSALS_JSON_SCHEMA, FreshProposalSetSchema,
  ProposalSchema, ProposalGenerationSchema, SYNTHESIS_POLICY, isSynthesisPolicy,
  normalizeGenerationProposals, validateProposals, validateProposalReview,
  applyProposals, applyProposalPatches, MixedDraftGeneratedPatchSchema,
  buildSynthesisSystemPrompt, type Proposal, type ResumeSpec,
  undoProposalInDraft,
} from '../src/index.js';

const original = ['GitHub Actions', 'Docker', 'Kubernetes/Helm', 'OpenTelemetry', 'Datadog', 'Cypress'];
const retained = original.filter(s => s !== 'Docker');
const base: ResumeSpec = { profile: { name: 'Test', title: 'Engineer', email: 'test@example.com' }, experiences: [], education: [], skills: [{ category: 'Delivery', skills: original }, { category: 'Web', skills: ['TypeScript'] }] };
const context = { analysis: { company: '', role: '', seniority: '', mission: '', requirements: [], boilerplate: [] }, alignment: { rows: [] }, evidence: [], baseResume: base, requireSkillsIntent: true };
const raw = (patch: Partial<Proposal> = {}) => ({ id: 'delivery', type: 'skills.prune', target: { experience_index: -1, bullet_index: -1, skill_group_index: 0 }, before: original.join(', '), after: retained.join(', '), order: [], skills: ['Docker'], before_skills: original, result_skills: retained, allow_empty_group: false, source_bullets: [], claim_bindings: [], citations: [], requirement_ids: [], rationale: 'Remove Docker.', ...patch });
const uuid = '11111111-1111-4111-8111-111111111111';
const generation = (policy: string | undefined, proposals: Proposal[]) => ({ schema_version: 1, id: uuid, workspace_id: 'workspace', job_id: uuid, input_snapshot_id: uuid, input_fingerprint: 'input', attempt_id: uuid, generation_policy: policy, raw_output: { id: 'raw', fingerprint: 'raw' }, proposals: { proposals }, created_at: '2026-11-10T00:00:00.000Z' });

it('carries required skills intent through actual wire, fresh admission, normalization and application', () => {
  const item = (PROPOSALS_JSON_SCHEMA as any).properties.proposals.items;
  expect(item.required).toEqual(expect.arrayContaining(['before_skills', 'result_skills', 'allow_empty_group']));
  expect(item.additionalProperties).toBe(false);
  expect((LEGACY_PROPOSALS_JSON_SCHEMA as any).properties.proposals.items.properties).not.toHaveProperty('before_skills');
  expect(SYNTHESIS_POLICY).toBe('accomplishments-2');
  const admitted = FreshProposalSetSchema.parse(JSON.parse(JSON.stringify({ proposals: [raw()] })));
  const captured = normalizeGenerationProposals(admitted.proposals, SYNTHESIS_POLICY);
  expect(ProposalGenerationSchema.parse(generation(SYNTHESIS_POLICY, captured)).generation_policy).toBe(SYNTHESIS_POLICY);
  const checked = validateProposals(captured, context);
  expect(checked[0].checks.filter(c => c.severity === 'block')).toEqual([]);
  const candidate = applyProposals(base, checked.map(p => ({ ...p, decision: 'accepted' })));
  expect(candidate.skills[0].skills).toEqual(retained);
  expect(candidate.skills[1]).toEqual(base.skills[1]);
  expect(applyProposals(base, checked.map(p => ({ ...p, decision: 'rejected' })))).toEqual(base);
  expect(buildSynthesisSystemPrompt('', 'proposals')).toContain('skills=["Docker"]');
});

it('blocks an inverted remove list despite a reassuring After and rationale', () => {
  const p = FreshProposalSetSchema.parse({ proposals: [raw({ skills: retained })] });
  const checked = validateProposals(normalizeGenerationProposals(p.proposals, SYNTHESIS_POLICY), context);
  expect(checked[0].checks).toEqual(expect.arrayContaining([expect.objectContaining({ severity: 'block', kind: 'skills_contract' })]));
  expect(applyProposals(base, checked.map(p => ({ ...p, decision: 'accepted' })))).toEqual(base);
});

it('requires fresh fields by generation policy while keeping old remove-list records readable', () => {
  const legacy = ProposalSchema.parse({ ...raw(), before_skills: undefined, result_skills: undefined, allow_empty_group: undefined });
  expect(FreshProposalSetSchema.safeParse({ proposals: [legacy] }).success).toBe(false);
  expect(ProposalGenerationSchema.safeParse(generation(SYNTHESIS_POLICY, [legacy])).success).toBe(false);
  for (const policy of [undefined, 'accomplishments-1']) {
    const stored = ProposalGenerationSchema.parse(generation(policy, [legacy]));
    expect(stored.proposals.proposals[0].before_skills).toBeUndefined();
    const checked = validateProposals(stored.proposals.proposals, { ...context, requireSkillsIntent: false });
    expect(applyProposals(base, checked.map(p => ({ ...p, decision: 'accepted' }))).skills[0].skills).toEqual(retained);
  }
  expect(isSynthesisPolicy('accomplishments-1')).toBe(true);
  expect(isSynthesisPolicy(undefined)).toBe(false);
});

it.each([
  { skills: ['Missing'] }, { skills: ['Docker', 'docker'] },
  { before_skills: [...original].reverse() }, { result_skills: [...retained, 'Rust'] },
  { skills: [], result_skills: original },
])('rejects inconsistent or stale fresh skills intent: %j', patch => {
  expect(validateProposals([ProposalSchema.parse(raw(patch))], context)[0].checks.some(c => c.severity === 'block')).toBe(true);
});

it('rejects overlapping fresh group operations without mutating either group', () => {
  const proposals = [ProposalSchema.parse(raw()), ProposalSchema.parse(raw({ id: 'other', skills: ['Cypress'], result_skills: original.filter(s => s !== 'Cypress') }))];
  const review = validateProposalReview(base, proposals, context, undefined, () => []);
  expect(review.valid).toBe(false);
  expect(review.candidate).toEqual(base);
  expect(review.proposals.every(p => p.checks.some(c => c.kind === 'target_conflict'))).toBe(true);
});

it('validates a full reorder, rejects a partial permutation, and preserves legacy partial ordering', () => {
  const p = ProposalSchema.parse(raw({ type: 'skills.reorder', skills: [...original].reverse(), result_skills: [...original].reverse() }));
  const checked = validateProposals([p], context);
  expect(checked[0].checks.filter(c => c.severity === 'block')).toEqual([]);
  expect(applyProposals(base, checked.map(p => ({ ...p, decision: 'accepted' }))).skills[0].skills).toEqual([...original].reverse());
  const partial = ProposalSchema.parse(raw({ type: 'skills.reorder', skills: ['Cypress'], result_skills: ['Cypress'] }));
  expect(validateProposals([partial], context)[0].checks.some(c => c.kind === 'skills_contract')).toBe(true);
  const legacy = ProposalSchema.parse({ ...partial, before_skills: undefined, result_skills: undefined, allow_empty_group: undefined });
  expect(applyProposals(base, validateProposals([legacy], { ...context, requireSkillsIntent: false }).map(p => ({ ...p, decision: 'accepted' }))).skills[0].skills).toEqual(['Cypress', ...original.filter(s => s !== 'Cypress')]);
});

it('recomputes edited result lists and requires explicit whole-group intent through mixed patches', () => {
  const p = ProposalSchema.parse(raw());
  const complete = MixedDraftGeneratedPatchSchema.parse({ proposal_id: p.id, skills: original, allow_empty_group: true });
  const cleared = applyProposalPatches([p], [], [complete]);
  expect(cleared.proposals[0].result_skills).toEqual([]);
  expect(validateProposals(cleared.proposals, context)[0].checks.filter(c => c.severity === 'block')).toEqual([]);
  const accidental = applyProposalPatches([p], [], [{ proposal_id: p.id, skills: original }]);
  expect(validateProposals(accidental.proposals, context)[0].checks.some(c => c.kind === 'skills_contract')).toBe(true);
  const restored = applyProposalPatches([p], cleared.patches, [{ proposal_id: p.id, skills: ['Docker'] }]);
  expect(restored.proposals[0].result_skills).toEqual(retained);
  expect(restored.proposals[0].allow_empty_group).toBe(false);
});

it('does not admit machine overrides while preserving legacy normalization bytes', () => {
  expect(FreshProposalSetSchema.safeParse({ proposals: [{ ...raw(), override: true }] }).success).toBe(false);
  expect(normalizeGenerationProposals([{ ...raw(), override: true }], SYNTHESIS_POLICY)[0].override).toBeUndefined();
  expect(normalizeGenerationProposals([{ ...raw(), override: true }], 'accomplishments-1')[0].override).toBe(true);
});

it('undoes a removed whole group without replacing the following group or unrelated edits', () => {
  const p = ProposalSchema.parse(raw({ skills: original, result_skills: [], allow_empty_group: true }));
  const current = structuredClone(base); current.skills.shift(); current.skills[0].skills.push('React');
  const restored = undoProposalInDraft(current, base, p);
  expect(restored.skills).toEqual([base.skills[0], { category: 'Web', skills: ['TypeScript', 'React'] }]);
  const ambiguous = structuredClone(current); ambiguous.skills.push({ category: 'Delivery', skills: [] }, { category: 'Delivery', skills: [] });
  expect(() => undoProposalInDraft(ambiguous, base, p)).toThrow(/ambiguous/);
});

it('undoes against group identity after preceding groups disappear and refuses changed skill wording', () => {
  const withPrior = structuredClone(base); withPrior.skills.unshift({ category: 'Languages', skills: ['Go'] });
  const p = ProposalSchema.parse(raw({ target: { experience_index: -1, bullet_index: -1, skill_group_index: 1 } }));
  const current = applyProposals(withPrior, [{ ...p, decision: 'accepted' }]); current.skills.shift(); current.skills[1].skills.push('React');
  const restored = undoProposalInDraft(current, withPrior, p);
  expect(restored.skills[0].skills).toEqual(original);
  expect(restored.skills[1].skills).toEqual(['TypeScript', 'React']);
  current.skills[0].skills.push('Rust');
  expect(() => undoProposalInDraft(current, withPrior, p)).toThrow(/wording changed/);
});
