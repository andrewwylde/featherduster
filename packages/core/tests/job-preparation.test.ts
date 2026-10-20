import { describe, expect, it } from 'vitest';
import {
  applyCandidateProposals, canUsePreparationStep, completeCandidateStep, createInputSnapshot,
  deslopCandidate, invalidatePreparationSteps, isPreparationOutputCurrent, validateCandidateProposals,
  EvidenceStore, ProposalSchema, StepRecordSchema, JobAnalysisSchema,
  type ResumeSpec, type ProposalValidationContext, type CreateInputSnapshotInput,
} from '../src/index.js';

const base: ResumeSpec = {
  profile: { name: 'A', title: 'Engineer', email: 'a@b.dev' }, summary: 'Backend engineer.',
  experiences: [{ company: 'Co', role: 'Engineer', startDate: '2020', endDate: 'Present',
    bullets: [{ text: 'Built Go services.', citations: ['source'] }, { text: 'Second.' }, { text: 'Third.' }] }],
  skills: [{ category: 'Tools', skills: ['Go', 'RabbitMQ', 'C++', 'Node.js', 'gRPC', 'unfamiliar'] }], education: [],
};
function context(): ProposalValidationContext {
  const store = new EvidenceStore();
  store.add({ id: 'source', date: '2025', company: 'Co', title: 'Go services', summary: 'Built Go and RabbitMQ services.',
    impact: 'Reduced latency by 30%.', themes: ['Go', 'RabbitMQ'], confidence: 'verified', in_flight: false,
    metrics: [{ name: 'latency', value: '30%', status: 'verified' }], internal_references: [] });
  store.add({ ...store.get('source')!.entry, id: 'ev-003', confidence: 'retracted' });
  return { baseResume: base, evidence: store.getAll(), analysis: JobAnalysisSchema.parse({ company: '', role: '', seniority: '', mission: '',
    requirements: [{ id: 'k', tier: 'must', text: 'Kafka', quote: 'Kafka', terms: ['Kafka'] }] }),
    alignment: { rows: [{ requirement_id: 'k', classification: 'transferable', citations: ['source'], rationale: '', adjacent_tool: 'RabbitMQ', candidate_confirmed: true }] } };
}
const proposal = (after = 'Built Go and RabbitMQ services with 30% lower latency.') => ProposalSchema.parse({ id: 'p', type: 'bullet.rewrite', target: { experience_index: 0, bullet_index: 0 }, after, citations: ['source'] });
const blocked = (text: string, ctx = context()) => validateCandidateProposals([proposal(text)], ctx)[0].checks.some(c => c.severity === 'block');

describe('candidate preparation', () => {
  it('accepts exact semantic support while retaining metrics, citations and content invalidation', () => {
    const text = 'Built Kafka services.';
    const ctx = { ...context(), semanticSupport: [{ path: 'experiences.0.bullets.0.text', proposal_id: 'p', text, resolved: true, citations: ['source'] }] };
    expect(blocked(text, ctx)).toBe(false);
    expect(blocked('Owned Kafka architecture.', ctx)).toBe(true);
    expect(blocked(text, { ...ctx, semanticSupport: [{ ...ctx.semanticSupport[0], resolved: false }] })).toBe(true);
    const metrics = 'Built Kafka services for 999 users.';
    expect(validateCandidateProposals([proposal(metrics)], { ...ctx, semanticSupport: [{ ...ctx.semanticSupport[0], text: metrics }] })[0].checks.map(c => c.kind)).toContain('metric_unverified');
    expect(validateCandidateProposals([{ ...proposal(text), citations: ['missing'] }], ctx)[0].checks.map(c => c.kind)).toContain('unsupported_citation');
    const reordered = ProposalSchema.parse({ id: 'p', type: 'skills.reorder', target: { skill_group_index: 0 }, skills: ['Kafka'], after: text });
    expect(validateCandidateProposals([reordered], ctx)[0].checks.map(c => c.kind)).toContain('ledger_ceiling');
  });
  it('completes without approval and enforces mode, freshness and blocks', () => {
    const original = StepRecordSchema.parse({ status: 'running', error: 'old' });
    const done = completeCandidateStep(original, 'hash', 'now');
    expect(done).toMatchObject({ status: 'done', input_hash: 'hash', completed_at: 'now', error: null });
    expect(original.status).toBe('running');
    expect(canUsePreparationStep('candidate', done, 'hash', [])).toBe(true);
    expect(canUsePreparationStep('manual', done, 'hash', [])).toBe(false);
    expect(canUsePreparationStep('manual', { ...done, status: 'approved' }, 'hash', [])).toBe(true);
    for (const status of ['pending', 'running', 'stale', 'error'] as const) expect(canUsePreparationStep('candidate', { ...done, status }, 'hash', [])).toBe(false);
    for (const input_hash of [null, 'old']) expect(canUsePreparationStep('candidate', { ...done, input_hash }, 'hash', [])).toBe(false);
    expect(canUsePreparationStep('candidate', done, 'hash', [{ severity: 'block', kind: 'x', message: 'x' }])).toBe(false);
  });
  it('requires exact verified metrics, not placeholders, substrings or human edits', () => {
    expect(blocked(proposal().after)).toBe(false);
    for (const text of ['Reduced latency 3%.', 'Reduced latency 90%.', 'Served customers: 90.', '[METRIC NEEDED]']) expect(blocked(text)).toBe(true);
    const p = { ...proposal(), edited_after: 'Reduced latency 90%.' };
    const result = validateCandidateProposals([p], context())[0];
    expect(result.checks.some(c => c.severity === 'block')).toBe(true);
    expect(result.edited_after).toBe(p.edited_after);
    const ctx = context();
    const records = ctx.evidence as ReturnType<EvidenceStore['getAll']>;
    records[0].entry.metrics[0].status = 'pending';
    expect(blocked(proposal().after, ctx)).toBe(true);
    records[0].entry.metrics[0].status = 'verified';
    records[0].entry.confidence = 'provisional';
    expect(blocked(proposal().after, ctx)).toBe(true);
  });
  it('preserves versions and citation digits but rejects unsupported citations', () => {
    const p = proposal('Used Node.js 22.1, p99 and k8s (ev-003).');
    expect(validateCandidateProposals([p], context())[0].after).toBe(p.after);
    for (const citations of [[], ['missing'], ['ev-003'], ['source', 'ev-003']]) {
      expect(validateCandidateProposals([{ ...proposal(), citations }], context())[0].checks.some(c => c.severity === 'block')).toBe(true);
    }
    expect(blocked('Built Go (ev-999).')).toBe(true);
    expect(blocked('Used Node.js 22.1, p99 and k8s.')).toBe(false);
  });
  it('does not upgrade transferable experience through flags, base skills or omitted requirements', () => {
    const ctx = context();
    ctx.baseResume = { ...base, skills: [{ category: 'Tools', skills: ['Kafka'] }] };
    expect(blocked('Built Kafka services.', ctx)).toBe(true);
    ctx.alignment.rows[0].classification = 'backed';
    expect(blocked('Built Kafka services.', ctx)).toBe(true);
    expect(ctx.alignment.rows[0].candidate_confirmed).toBe(true);
    const p = { ...proposal(), checks: [{ severity: 'block' as const, kind: 'prior', message: 'Human block' }] };
    expect(validateCandidateProposals([p], ctx)[0].checks).toContainEqual(p.checks[0]);
  });
  it('applies all operation types on original indices without accepting human proposals', () => {
    const ops = [proposal(), ...[
      { type: 'summary.rewrite', after: 'Built Go services.' },
      { type: 'bullet.drop', target: { experience_index: 0, bullet_index: 1 } },
      { type: 'bullet.reorder', target: { experience_index: 0 }, order: [2, 1, 0] },
      { type: 'bullet.add', target: { experience_index: 0, bullet_index: 1 }, after: 'Built RabbitMQ services.' },
      { type: 'skills.reorder', target: { skill_group_index: 0 }, skills: ['RabbitMQ', 'Go'] },
      { type: 'skills.prune', target: { skill_group_index: 0 }, skills: ['C++'] },
    ].map((p, i) => ProposalSchema.parse({ id: `p${i}`, target: {}, citations: ['source'], ...p }))];
    ops[0].edited_after = 'Built Go services.';
    const before = structuredClone({ base, ops });
    const result = applyCandidateProposals(base, ops, context());
    expect(result.valid).toBe(true);
    expect(result.appliedProposalIds).toHaveLength(7);
    expect(result.candidate.experiences[0].bullets.map(b => b.text)).toEqual(['Third.', 'Built RabbitMQ services.', 'Built Go services.']);
    expect(result.candidate.skills[0].skills.slice(0, 2)).toEqual(['RabbitMQ', 'Go']);
    expect(result.candidate.skills[0].skills).not.toContain('C++');
    expect(result.proposals.every(p => p.decision === 'pending')).toBe(true);
    result.candidate.experiences[0].bullets[2].citations!.push('mutated');
    result.proposals[0].target.bullet_index = 99;
    result.proposals[0].checks.push({ severity: 'block', kind: 'x', message: 'x' });
    expect({ base, ops }).toEqual(before);
  });
  it('skips rejected and unsafe edits and reports invalid retained content', () => {
    expect(applyCandidateProposals(base, [], context()).candidate).toEqual(base);
    const result = applyCandidateProposals(base, [proposal('Built Kafka.'), { ...proposal(), id: 'r', decision: 'rejected' }], context());
    expect(result.valid).toBe(false);
    expect(result.appliedProposalIds).toEqual([]);
    for (const summary of ['[METRIC NEEDED]', 'Built systems (ev-999).', 'Built systems (ev-003).']) {
      expect(applyCandidateProposals({ ...base, summary }, [], context()).valid).toBe(false);
    }
  });
  it('cleans prose while preserving technical tokens, numbers, citations and code', () => {
    const summary = 'It is worth noting that unfamiliar truly handles 45%, 4.2M and 800ms with p99, C++, Node.js and gRPC (ev-001).';
    const input = structuredClone(base);
    input.summary = summary;
    input.experiences[0].bullets[0].text = 'Basically built `simply delve` and ```\ntruly code\n``` with ZPROTECTED0Z.';
    const result = deslopCandidate(input);
    expect(result.candidate.summary).toBe('unfamiliar handles 45%, 4.2M and 800ms with p99, C++, Node.js and gRPC (ev-001).');
    expect(result.candidate.experiences[0].bullets[0].text).toContain('`simply delve` and ```\ntruly code\n```');
    expect(result.candidate.experiences[0].bullets[0].text).toContain('ZPROTECTED0Z');
    expect(result.edits.length).toBe(2);
    expect(deslopCandidate(result.candidate).edits).toEqual([]);
    expect(input.summary).toBe(summary);
    expect(deslopCandidate({ ...base, summary: 'Move the needle.' }).issues.length).toBeGreaterThan(0);
    expect(deslopCandidate(base).edits).toEqual([]);
    result.candidate.experiences[0].bullets[0].citations!.push('new');
    expect(input.experiences[0].bullets[0].citations).toEqual(['source']);
  });
  it('composes validation, application and cleaning without manufacturing approval', () => {
    const p = proposal('It is worth noting that Go truly supports RabbitMQ.');
    const applied = applyCandidateProposals(base, [p], context());
    expect(applied.valid).toBe(true);
    expect(deslopCandidate(applied.candidate).candidate.experiences[0].bullets[0].text).toBe('Go supports RabbitMQ.');
    expect(p.decision).toBe('pending');
    expect(completeCandidateStep(StepRecordSchema.parse({}), 'hash', 'now').status).toBe('done');
  });
});

const snapshotInput = (): CreateInputSnapshotInput => ({
  schema_version: 1, id: '11111111-1111-4111-8111-111111111111', workspace_id: 'ws', job_id: '22222222-2222-4222-8222-222222222222', created_at: '2025-01-01T00:00:00Z',
  posting: { id: 'posting', fingerprint: 'a' }, base_resume: { id: 'base', fingerprint: 'b' },
  selected_evidence: [{ id: 'source', fingerprint: 'c' }, { id: 'other', fingerprint: 'd' }],
  privacy_rules: { id: 'privacy', fingerprint: 'e' }, template: { id: 'template', fingerprint: 'f' }, runner_configuration: { id: 'runner', fingerprint: 'g' },
  policy: { schema_version: 1, mode: 'candidate', output_format: 'latex', max_model_calls: 4, timeout_ms: 100, max_repair_attempts: 1 },
});
describe('preparation snapshots', () => {
  it('normalizes defaults and key order but excludes identity and time', async () => {
    const input = snapshotInput();
    const original = structuredClone(input);
    const first = await createInputSnapshot(input);
    expect(first.fingerprint).toMatch(/^[0-9a-f]{64}$/);
    const second = await createInputSnapshot({ ...input, id: input.job_id, created_at: '2026-01-01T00:00:00Z', posting: { fingerprint: 'a', id: 'posting' }, policy: { ...input.policy, page_budget: 1, model_retry_count: 0 } });
    expect(second.fingerprint).toBe(first.fingerprint);
    expect(input).toEqual(original);
    first.posting.id = 'mutation';
    expect(input.posting.id).toBe('posting');
  });
  it('hashes every dependency and evidence order', async () => {
    const first = await createInputSnapshot(snapshotInput());
    for (const key of ['posting', 'base_resume', 'privacy_rules', 'template', 'runner_configuration'] as const) {
      const input = snapshotInput(); input[key].fingerprint += 'new';
      expect((await createInputSnapshot(input)).fingerprint).not.toBe(first.fingerprint);
    }
    for (const mutate of [
      (i: CreateInputSnapshotInput) => { i.policy.mode = 'manual'; },
      (i: CreateInputSnapshotInput) => { i.selected_evidence.reverse(); },
      (i: CreateInputSnapshotInput) => { i.selected_evidence.pop(); },
      (i: CreateInputSnapshotInput) => { i.selected_evidence[0].fingerprint = 'new'; },
      (i: CreateInputSnapshotInput) => { i.workspace_id = 'other'; },
    ]) {
      const input = snapshotInput(); mutate(input);
      expect((await createInputSnapshot(input)).fingerprint).not.toBe(first.fingerprint);
    }
  });
  it('invalidates downstream output without mutating records or historic bindings', async () => {
    const snapshot = await createInputSnapshot(snapshotInput());
    const done = completeCandidateStep(StepRecordSchema.parse({}), snapshot.fingerprint, 'now');
    const steps = { analysis: done, alignment: { ...done, input_hash: null }, proposals: done, brief: StepRecordSchema.parse({ status: 'error' }) };
    const stale = invalidatePreparationSteps(steps, snapshot.fingerprint);
    expect(stale.analysis.status).toBe('done');
    expect(stale.alignment.status).toBe('stale');
    expect(stale.proposals.status).toBe('stale');
    expect(stale.brief.status).toBe('error');
    expect(steps.proposals.status).toBe('done');
    expect(invalidatePreparationSteps({ analysis: { ...done, status: 'stale' }, brief: done }, snapshot.fingerprint).brief!.status).toBe('stale');
    const output = { workspace_id: snapshot.workspace_id, job_id: snapshot.job_id, input_fingerprint: snapshot.fingerprint };
    expect(isPreparationOutputCurrent(output, snapshot)).toBe(true);
    for (const patch of [{ input_fingerprint: null }, { workspace_id: 'other' }, { job_id: 'other' }, { input_snapshot_id: 'old' }]) expect(isPreparationOutputCurrent({ ...output, ...patch }, snapshot)).toBe(false);
  });
});

describe('source-bound terminology in candidate validation', () => {
  it('permits only the bound direct term without clearing other requirements or metrics', () => {
    const ctx = context();
    ctx.analysis.requirements[0].terms = ['backend', 'Kafka', 'music', 'ownership'];
    const support: import('../src/index.js').SkillSupport = {
      skill: 'backend', facet: 'application development', permitted_terms: ['backend'], support: 'direct',
      scope: { kind: 'workspace' }, explanation: 'Go services implement backend applications',
      sources: [{ evidence_id: 'source', evidence_fingerprint: 'a'.repeat(64), quote: 'Built Go and RabbitMQ services.', source_status: { confidence: 'verified', in_flight: false } }],
    };
    expect(blocked('Built backend services.', ctx)).toBe(true);
    ctx.skillSupport = [support];
    expect(blocked('Built backend services.', ctx)).toBe(false);
    for (const text of ['Built backend Kafka services.', 'Built backend music services.', 'Backend ownership.', 'Built backend services with 90% improvement.']) expect(blocked(text, ctx)).toBe(true);
    for (const level of ['transferable', 'unsupported'] as const) {
      ctx.skillSupport = [{ ...support, support: level }];
      expect(blocked('Built backend services.', ctx)).toBe(true);
    }
    ctx.skillSupport = [support];
    (ctx.evidence as ReturnType<EvidenceStore['getAll']>)[0].summary = 'Changed work';
    expect(blocked('Built backend services.', ctx)).toBe(true);
  });
});
