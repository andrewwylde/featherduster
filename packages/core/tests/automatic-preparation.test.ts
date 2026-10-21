import { describe, expect, it } from 'vitest';
import { automaticRepairDecision, resolveOriginalTarget, reserveAutomaticOperation } from '../src/jobs/automatic-preparation.js';

describe('conservative automatic preparation', () => {
  it('retains implementation when removing a supported qualifier and asks for material changes', () => {
    expect(automaticRepairDecision({ kind: 'qualifier', before: 'Led implementation of caching', after: 'Implementation of caching', supported: true, unique_content_removed: false, conflict: false })).toBe('repair');
    for (const kind of ['omission', 'uncertain', 'conflict'] as const) expect(automaticRepairDecision({ kind, before: 'Built caching', after: '', supported: true, unique_content_removed: true, conflict: false })).toBe('question');
    expect(automaticRepairDecision({ kind: 'outage', before: '', after: '', supported: false, unique_content_removed: false, conflict: false })).toBe('technical');
    expect(automaticRepairDecision({ kind: 'qualifier', before: 'Led caching', after: 'Caching', supported: false, unique_content_removed: false, conflict: false })).toBe('question');
  });
  it('resolves original contents after reorder, rejecting ambiguous anchors', () => {
    const anchor = { work_id: 'project-a', text: 'Built caching' };
    expect(resolveOriginalTarget([{ work_id: 'project-a', text: 'Built queues' }, anchor], anchor)).toBe(1);
    expect(resolveOriginalTarget([anchor, anchor], anchor)).toBeNull();
    expect(resolveOriginalTarget([{ ...anchor, work_id: 'project-b' }], anchor)).toBeNull();
  });
  it('caps retry and repair allowances as well as total captured budget', () => {
    const policy = { max_model_calls: 7, max_repair_attempts: 2, timeout_ms: 1000 };
    let usage = { calls: 4, repairs: 0, retries: 0, elapsed_ms: 1 };
    usage = reserveAutomaticOperation(policy, usage, 'retry');
    expect(() => reserveAutomaticOperation(policy, usage, 'retry')).toThrow();
    usage = reserveAutomaticOperation(policy, usage, 'repair');
    usage = reserveAutomaticOperation(policy, usage, 'repair');
    expect(() => reserveAutomaticOperation(policy, usage, 'repair')).toThrow();
    expect(() => reserveAutomaticOperation(policy, usage, 'model')).toThrow();
  });
});

it('never publishes duplicate bullets or unsupported added skills from a checked edit', async () => {
  const { checkCandidateFields } = await import('../src/jobs/candidate-checks.js');
  const { ResumeSpecSchema } = await import('../src/schemas/resume.js');
  const base = ResumeSpecSchema.parse({ profile: { name: 'Test', title: 'Engineer', email: 'test@example.com' }, experiences: [{ company: 'Acme', role: 'Engineer', startDate: '2020', endDate: 'Present', bullets: [{ text: 'Built tooling.' }] }], skills: [{ category: 'Tools', skills: ['SQL'] }], education: [] });
  const candidate = structuredClone(base);
  candidate.experiences[0].bullets.push({ text: 'Built tooling.' }); candidate.skills[0].skills.push('Invented capability');
  const issues = checkCandidateFields(candidate, [], { baseResume: base, analysis: { company: '', role: '', seniority: '', mission: '', requirements: [], boilerplate: [] }, alignment: { rows: [] }, evidence: [] });
  expect(issues.some(issue => issue.code === 'duplicate_bullet' && issue.severity === 'block')).toBe(true);
  expect(issues.some(issue => issue.code === 'unsupported_skill' && issue.severity === 'block')).toBe(true);
});
