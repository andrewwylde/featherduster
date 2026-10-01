import { describe, expect, it, vi } from 'vitest';
import { DEFAULT_STARTER_RESUME } from '../src/schemas/resume.js';
import { JobAnalysisSchema } from '../src/tailoring/schemas.js';
import * as core from '../src/index.js';
const { DraftRecordSchema, DraftUpdateSchema, ManualDraftPayloadSchema, SetupPayloadSchema, canonicalJson, hasUnappliedChanges } = core;

// Model the committed workflow contract even when local workflow edits add override.
vi.mock('../src/tailoring/schemas.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/tailoring/schemas.js')>();
  const omitMask: Record<string, true> = { override: true };
  const proposalWithoutOverride = actual.ProposalSchema.omit(omitMask);
  return {
    ...actual,
    ProposalSchema: proposalWithoutOverride,
    ProposalSetSchema: actual.ProposalSetSchema.extend({ proposals: proposalWithoutOverride.array() }),
  };
});

const analysis = { company: '', role: '', seniority: '', mission: '', requirements: [{ id: 'r1', tier: 'must', text: '', quote: '', terms: [] }], boilerplate: [] };
const setup = { posting: '', label: '', baseResumeId: '', runner: '' };
const common = { schemaVersion: 1, id: 'e8837c41-00ca-4939-9d1f-c1d1b01ba891', lifecycle: 'draft', revision: 0, createdAt: '2026-09-30T12:00:00Z', editedAt: '2026-09-30T12:00:00Z', savedAt: '2026-09-30T12:00:00Z', context: {}, appliedContent: {} };
const run = () => DraftRecordSchema.parse({ ...common, kind: 'run', runSlug: 'example', base: { resumeId: 'base', spec: DEFAULT_STARTER_RESUME, fingerprint: 'hash' }, payload: { analysis, proposalTextById: {}, artifactTokens: {} }, appliedContent: { analysis } });

describe('tailoring recovery contracts', () => {
  it('preserves incomplete setup without workflow validation', () => {
    expect(SetupPayloadSchema.parse(setup)).toEqual(setup);
    expect(DraftRecordSchema.parse({ ...common, kind: 'setup', base: null, payload: setup }).payload).toEqual(setup);
  });
  it('rejects malformed payloads, tokens, timestamps and record kind mismatches', () => {
    expect(SetupPayloadSchema.safeParse({ ...setup, posting: 1 }).success).toBe(false);
    expect(SetupPayloadSchema.safeParse({ ...setup, posting: 'x'.repeat(262145) }).success).toBe(false);
    expect(DraftRecordSchema.safeParse({ ...common, kind: 'manual', base: null, payload: setup }).success).toBe(false);
    expect(DraftRecordSchema.safeParse({ ...common, kind: 'setup', base: null, payload: setup, savedAt: 'yesterday' }).success).toBe(false);
    expect(DraftUpdateSchema.safeParse({ expected: { revision: -1, fingerprint: 'hash' }, mutationId: 'm1', change: 'context', context: {} }).success).toBe(false);
  });
  it('bounds strings inside validated base snapshots too', () => {
    const record = run();
    record.base!.spec.profile.name = 'x'.repeat(262145);
    expect(DraftRecordSchema.safeParse(record).success).toBe(false);
  });
  it('distinguishes content updates from context updates', () => {
    const update = { expected: { revision: 0, fingerprint: 'hash' }, mutationId: 'm1' };
    expect(DraftUpdateSchema.safeParse({ ...update, change: 'context', context: {} }).success).toBe(true);
    expect(DraftUpdateSchema.safeParse({ ...update, change: 'content', payload: setup }).success).toBe(true);
    expect(DraftUpdateSchema.safeParse({ ...update, change: 'context', context: {}, payload: setup }).success).toBe(false);
    expect(DraftUpdateSchema.safeParse({ ...update, change: 'content' }).success).toBe(false);
  });
  it('recovers blank requirements while leaving workflow schemas strict', () => {
    expect(run().payload).toMatchObject({ analysis });
    expect(JobAnalysisSchema.safeParse(analysis).success).toBe(false);
  });
  it('roundtrips manual IDs, excluded bullets, citations and blank profile fields', () => {
    const manual = { profile: { name: '', title: '', email: '', links: { github: '' } }, summary: '', experiences: [{ id: 'exp1', company: '', role: '', startDate: '', endDate: '', bullets: [{ id: 'b1', text: '', included: false, citations: ['ev1'] }] }], education: [{ institution: '', degree: '', year: '' }], skills: [{ category: '', skills: [''] }], jobDescription: '', selectedResumeId: '', squeezeMode: false };
    expect(ManualDraftPayloadSchema.parse(JSON.parse(JSON.stringify(manual)))).toEqual(manual);
  });
  it('ignores context and artifact token changes when comparing applied content', () => {
    const record = run();
    record.context = { activeStep: 'alignment', mobilePane: 'context' };
    if (record.kind === 'run') record.payload.artifactTokens.analysis = { revision: 4, fingerprint: 'new' };
    expect(hasUnappliedChanges(record)).toBe(false);
    if (record.kind === 'run') record.payload.analysis!.company = 'New company';
    expect(hasUnappliedChanges(record)).toBe(true);
  });
  it('includes proposal overrides, checks, citations and unfinished text', () => {
    const proposal = { id: 'p1', type: 'bullet.rewrite', target: { experience_index: 0, bullet_index: 0, skill_group_index: -1 }, before: '', after: 'A', order: [], skills: [], citations: ['ev1'], requirement_ids: ['r1'], rationale: '', decision: 'pending', override: false, checks: [{ severity: 'block', kind: 'test', message: 'test' }] };
    const record = DraftRecordSchema.parse({ ...run(), payload: { proposals: { proposals: [proposal] }, proposalTextById: {}, artifactTokens: {} }, appliedContent: { proposals: { proposals: [proposal] } } });
    expect(hasUnappliedChanges(record)).toBe(false);
    if (record.kind !== 'run') throw new Error('run expected');
    record.payload.proposals!.proposals[0].override = true;
    expect(hasUnappliedChanges(record)).toBe(true);
    record.payload.proposals!.proposals[0].override = false;
    record.payload.proposalTextById.p1 = '';
    expect(hasUnappliedChanges(record)).toBe(true);
    record.payload.proposalTextById.p1 = 'A';
    expect(hasUnappliedChanges(record)).toBe(false);
    record.payload.proposals!.proposals[0].checks[0].message = 'Changed check';
    expect(hasUnappliedChanges(record)).toBe(true);
    record.payload.proposals!.proposals[0].checks[0].message = 'test';
    expect(hasUnappliedChanges(record)).toBe(false);
    record.payload.proposals!.proposals[0].citations.push('ev2');
    expect(hasUnappliedChanges(record)).toBe(true);
    record.payload.proposals!.proposals[0].citations.pop();
    expect(hasUnappliedChanges(record)).toBe(false);
  });
  it('preserves completion proposal overrides independently of the workflow schema', () => {
    const proposal = {
      id: 'p1', type: 'bullet.rewrite',
      target: { experience_index: 0, bullet_index: 0, skill_group_index: -1 },
      override: true,
    };
    expect(core.ProposalSetSchema.parse({ proposals: [proposal] }).proposals[0]).not.toHaveProperty('override');
    const completion = {
      outputId: 'output1', path: 'tailored/output1.yaml', completedAt: common.savedAt,
      spec: DEFAULT_STARTER_RESUME,
      runArtifacts: {
        posting: 'Example posting', base: run().base,
        manifest: {
          slug: 'example', created: common.createdAt, updated: common.savedAt,
          runner: 'manual', base_resume: 'base', state: 'complete',
          steps: { analysis: {}, alignment: {}, proposals: {}, brief: {} },
        },
        proposals: { proposals: [proposal] },
      },
    };
    const recovered = core.DraftCompletionSchema.parse(completion);
    expect(recovered.runArtifacts!.proposals!.proposals[0]).toMatchObject({ id: 'p1', override: true });
    expect(core.DraftCompletionSchema.safeParse({
      ...completion,
      runArtifacts: { ...completion.runArtifacts, proposals: { proposals: [{ ...proposal, override: 'yes' }] } },
    }).success).toBe(false);
    expect(core.DraftCompletionSchema.safeParse({
      ...completion,
      runArtifacts: { ...completion.runArtifacts, proposals: { proposals: [{ ...proposal, id: '' }] } },
    }).success).toBe(false);
  });
  it('does not require applying setup or manual content', () => {
    expect(hasUnappliedChanges(DraftRecordSchema.parse({ ...common, kind: 'setup', base: null, payload: setup }))).toBe(false);
  });
  it('canonicalizes nested object keys while preserving array order', () => {
    expect(canonicalJson({ z: [{ b: 2, a: 1 }], a: 'x' })).toBe('{"a":"x","z":[{"a":1,"b":2}]}');
    expect(canonicalJson({ b: 1, a: 2 })).toBe(canonicalJson({ a: 2, b: 1 }));
    expect(canonicalJson([1, 2])).not.toBe(canonicalJson([2, 1]));
    expect(canonicalJson({ optional: undefined, value: null })).toBe('{"value":null}');
    expect(() => canonicalJson(Number.NaN)).toThrow();
    expect(() => canonicalJson(undefined)).toThrow();
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    expect(() => canonicalJson(circular)).toThrow();
  });
});
