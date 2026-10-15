import { describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { EvidenceStore } from '../src/parsers/index-store.js';
import { EvidenceEntrySchema } from '../src/schemas/evidence.js';
import { serializeEvidenceMarkdown } from '../src/parsers/evidence-parser.js';
import { applyCorpusSnapshot, applicableSkillSupport, queryCorpus, supportsTerm } from '../src/corpus/knowledge.js';
import type { CorpusUpdate, SkillSupport } from '../src/corpus/schemas.js';
import {
  CorpusChangeSchema, CorpusSnapshotSchema, CorpusUpdateSchema,
  EvidenceAmendmentSchema, FeedbackEventSchema, SkillSupportSchema,
} from '../src/corpus/schemas.js';

const id = '11111111-1111-4111-8111-111111111111';
const hash = 'a'.repeat(64);
const source = { evidence_id: 'ev-1', evidence_fingerprint: hash, quote: 'Built APIs.' };
const relationship = {
  skill: 'backend', facet: 'application development', permitted_terms: ['backend'],
  support: 'direct', scope: { kind: 'workspace' }, sources: [source], explanation: 'API implementation.',
};
const entry = {
  id: 'ev-1', date: '2026-01-01', company: 'Example', title: 'APIs', summary: 'Built APIs.',
  impact: '', themes: [], confidence: 'verified', in_flight: false, metrics: [], internal_references: [],
};
const feedback = {
  schema_version: 1, id, workspace_id: 'workspace', job_id: null, proposal_id: null,
  review_revision: null, kind: 'rejection', before: 'Proposal', after: '', explanation: '',
  scope: { kind: 'job', key: id }, recorded_by: 'local-human', recorded_at: '2026-10-14T00:00:00.000Z',
};

describe('corpus contracts', () => {
  it('round trips a strictly source-backed relationship', () => {
    expect(SkillSupportSchema.parse(JSON.parse(JSON.stringify(relationship)))).toEqual(relationship);
  });
  it('rejects empty passages, missing sources, and forged change provenance', () => {
    expect(SkillSupportSchema.safeParse({ ...relationship, sources: [{ ...source, quote: ' ' }] }).success).toBe(false);
    expect(SkillSupportSchema.safeParse({ ...relationship, sources: [] }).success).toBe(false);
    expect(CorpusChangeSchema.safeParse({ kind: 'skill_support', value: relationship, recorded_by: 'model' }).success).toBe(false);
    expect(SkillSupportSchema.safeParse({ ...relationship, candidate_confirmed: true }).success).toBe(false);
  });
  it('preserves amendment identity and rejects undeclared nested authority', () => {
    const amendment = { evidence_id: 'ev-1', base_fingerprint: hash, entry, narrative: '', confirmation_basis: 'user_confirmed', explanation: 'Correction' };
    expect(EvidenceAmendmentSchema.safeParse(amendment).success).toBe(true);
    expect(EvidenceAmendmentSchema.safeParse({ ...amendment, entry: { ...entry, id: 'ev-2' } }).success).toBe(false);
    expect(EvidenceAmendmentSchema.safeParse({ ...amendment, entry: { ...entry, verified_by: 'model' } }).success).toBe(false);
  });
  it('stores unexplained rejection as feedback, without inferred knowledge', () => {
    expect(FeedbackEventSchema.parse(feedback)).toEqual(feedback);
    expect(CorpusChangeSchema.safeParse(feedback).success).toBe(false);
  });
  it('validates immutable update and snapshot boundaries', () => {
    const update = { schema_version: 1, id, workspace_id: 'workspace', revision: 1, feedback_id: id,
      supersedes: null, change: { kind: 'skill_support', value: relationship }, recorded_at: feedback.recorded_at };
    expect(CorpusSnapshotSchema.parse({ schema_version: 1, revision: 1, updates: [update] }).updates).toEqual([update]);
    for (const patch of [{ id: 'bad' }, { revision: Infinity }, { revision: -1 }, { revision: 0.5 }, { schema_version: 2 }, { recorded_at: 'yesterday' }]) {
      expect(CorpusUpdateSchema.safeParse({ ...update, ...patch }).success).toBe(false);
    }
    expect(CorpusSnapshotSchema.safeParse({ schema_version: 1, revision: 0, updates: [], ready: true }).success).toBe(false);
  });
});

const versioning = { fingerprint: (record: import('../src/parsers/index-store.js').EvidenceRecord) =>
  createHash('sha256').update(serializeEvidenceMarkdown(record.entry, record.narrative)).digest('hex') };
function corpusFixture() {
  const store = new EvidenceStore();
  const record = store.add(EvidenceEntrySchema.parse(entry), 'Built APIs and fixed BFF authentication.');
  const support = SkillSupportSchema.parse({ ...relationship, sources: [{ ...source,
    quote: 'Built APIs', evidence_fingerprint: versioning.fingerprint(record),
    source_status: { confidence: 'verified', in_flight: false },
  }] });
  const update: CorpusUpdate = CorpusUpdateSchema.parse({ schema_version: 1, id,
    workspace_id: 'workspace', revision: 1, feedback_id: id, supersedes: null,
    change: { kind: 'skill_support', value: support }, recorded_at: feedback.recorded_at });
  const snapshot = { schema_version: 1 as const, revision: 1, updates: [update] };
  return { store, record, support, update, snapshot };
}

describe('effective corpus', () => {
  it('grounds only complete direct terms with every bound citation', () => {
    const { store, snapshot } = corpusFixture();
    const view = applyCorpusSnapshot(store, snapshot, versioning);
    expect(supportsTerm(' Backend ', ['ev-1'], view.evidence.getAll(), view.support)).toBe(true);
    for (const term of ['Kafka', 'backend architecture', '40%']) {
      expect(supportsTerm(term, ['ev-1'], view.evidence.getAll(), view.support)).toBe(false);
    }
    expect(supportsTerm('backend', [], view.evidence.getAll(), view.support)).toBe(false);
    expect(supportsTerm('backend', ['ev-1'], view.evidence.getAll(), view.support.map(s => ({ ...s, support: 'transferable' })))).toBe(false);
  });
  it('requires exact context for restricted relationships', () => {
    const { support } = corpusFixture();
    const scoped: SkillSupport = { ...support, scope: { kind: 'role', key: 'engineer' } };
    expect(applicableSkillSupport([scoped], {})).toEqual([]);
    expect(applicableSkillSupport([scoped], { role: 'designer' })).toEqual([]);
    expect(applicableSkillSupport([support, scoped], { role: 'engineer' })).toEqual([support, scoped]);
  });
  it('rejects missing, retracted, and changed passages', () => {
    for (const mutation of ['missing', 'retracted', 'passage']) {
      const { store, record, snapshot } = corpusFixture();
      if (mutation === 'missing') store.remove(record.id);
      if (mutation === 'retracted') store.add({ ...record.entry, confidence: 'retracted' }, record.narrative);
      if (mutation === 'passage') store.add({ ...record.entry, summary: '' }, 'Different work.');
      const view = applyCorpusSnapshot(store, snapshot, versioning);
      expect(view.support).toEqual([]);
      expect(view.issues).toHaveLength(1);
    }
  });
  it('rebinds unrelated edits only with unchanged captured source status', () => {
    const { store, record, snapshot } = corpusFixture();
    store.add({ ...record.entry, title: 'New title' }, record.narrative);
    const view = applyCorpusSnapshot(store, snapshot, versioning);
    expect(view.support).toHaveLength(1);
    expect(view.support[0].sources[0].evidence_fingerprint).toBe(versioning.fingerprint(store.get('ev-1')!));
    expect(snapshot.updates[0].change).not.toEqual({ kind: 'skill_support', value: view.support[0] });
    store.add({ ...record.entry, confidence: 'provisional' }, record.narrative);
    expect(applyCorpusSnapshot(store, snapshot, versioning).support).toEqual([]);
  });
  it('folds withdrawals and explicit supersession without mutating history', () => {
    const { store, snapshot, update, support } = corpusFixture();
    const negative: CorpusUpdate = { ...update, id: '22222222-2222-4222-8222-222222222222', revision: 2,
      change: { kind: 'skill_support', value: { ...support, support: 'unsupported' } } };
    const conflicting = applyCorpusSnapshot(store, { ...snapshot, revision: 2, updates: [update, negative] }, versioning);
    expect(conflicting.support).toEqual([]);
    expect(conflicting.issues.every(i => i.code === 'conflict')).toBe(true);
    const resolved = applyCorpusSnapshot(store, { ...snapshot, revision: 2, updates: [update, { ...negative, supersedes: id }] }, versioning);
    expect(resolved.support).toHaveLength(1);
    expect(supportsTerm('backend', ['ev-1'], store.getAll(), resolved.support)).toBe(false);
    const withdrawal: CorpusUpdate = { ...negative, change: { kind: 'withdrawal', update_id: id, reason: 'Undo' } };
    expect(applyCorpusSnapshot(store, { ...snapshot, revision: 2, updates: [update, withdrawal] }, versioning).support).toEqual([]);
    expect(applyCorpusSnapshot(store, snapshot, versioning).support).toHaveLength(1);
  });
  it('keeps amendments provisional and new metrics unverified while preserving source', () => {
    const { store, record, snapshot, update } = corpusFixture();
    const amendment: CorpusUpdate = { ...update, change: { kind: 'evidence_amendment', value: {
      evidence_id: record.id, base_fingerprint: versioning.fingerprint(record),
      entry: { ...record.entry, summary: 'Corrected', metrics: [{ name: 'Latency', value: '20%', status: 'verified' }] },
      narrative: 'Corrected narrative', confirmation_basis: 'user_confirmed', explanation: 'Correction',
    } } };
    const view = applyCorpusSnapshot(store, { ...snapshot, updates: [amendment] }, versioning);
    expect(view.evidence.get('ev-1')?.confidence).toBe('provisional');
    expect(view.evidence.get('ev-1')?.entry.confidence).toBe('provisional');
    expect(view.evidence.get('ev-1')?.metrics[0].status).toBe('unverified');
    expect(store.get('ev-1')).toEqual(record);
    store.add({ ...record.entry, title: 'Externally edited' }, record.narrative);
    expect(applyCorpusSnapshot(store, { ...snapshot, updates: [amendment] }, versioning).issues[0].code).toBe('source_changed');
  });
  it('enriches search without fake records and preserves existing filters', () => {
    const { store, snapshot } = corpusFixture();
    const view = applyCorpusSnapshot(store, snapshot, versioning);
    expect(queryCorpus(view, { search: 'backend' }, {}).map(m => m.record.id)).toEqual(['ev-1']);
    expect(queryCorpus(view, { search: 'backend', company: 'Other' }, {})).toEqual([]);
    expect(view.evidence.size).toBe(1);
    expect(view.evidence.get('ev-1')?.themes).toEqual([]);
  });
});

describe('corpus regression boundaries', () => {
  it.each(['employer', 'project', 'role', 'job'] as const)('requires matching %s context', kind => {
    const { support } = corpusFixture();
    const scoped: SkillSupport = { ...support, scope: { kind, key: 'exact' } };
    const key = kind === 'job' ? 'job_id' : kind;
    expect(applicableSkillSupport([scoped], {})).toEqual([]);
    expect(applicableSkillSupport([scoped], { [key]: 'Exact' })).toEqual([]);
    expect(applicableSkillSupport([scoped], { [key]: 'exact' })).toEqual([scoped]);
  });
  it('requires every source, keeps negative support local, and exposes rebinding', () => {
    const { store, record, snapshot, support } = corpusFixture();
    const second = store.add({ ...record.entry, id: 'ev-2' }, record.narrative);
    const multiple: SkillSupport = { ...support, sources: [...support.sources, { ...support.sources[0], evidence_id: second.id }] };
    expect(supportsTerm('backend', ['ev-1'], store.getAll(), [multiple])).toBe(false);
    expect(supportsTerm('backend', ['ev-1', 'ev-2'], store.getAll(), [multiple])).toBe(true);
    const negative: SkillSupport = { ...support, support: 'unsupported', sources: [{ ...support.sources[0], evidence_id: second.id }] };
    expect(supportsTerm('backend', ['ev-1'], store.getAll(), [support, negative])).toBe(true);
    store.add({ ...record.entry, title: 'Unrelated title' }, record.narrative);
    expect(applyCorpusSnapshot(store, snapshot, versioning).rebindings).toHaveLength(1);
    const legacy = structuredClone(snapshot);
    if (legacy.updates[0].change.kind === 'skill_support') delete legacy.updates[0].change.value.sources[0].source_status;
    expect(applyCorpusSnapshot(store, legacy, versioning).support).toEqual([]);
  });
  it('preserves all query filters and does not change original evidence counts', () => {
    const { store, snapshot } = corpusFixture();
    const before = structuredClone(store.getAll());
    const view = applyCorpusSnapshot(store, snapshot, versioning);
    for (const filters of [{ confidence: 'provisional' }, { in_flight: true }, { hasMissingMetrics: true }, { theme: 'missing' }, { themes: ['missing'] }]) {
      expect(queryCorpus(view, { search: 'backend', ...filters })).toEqual([]);
    }
    expect(queryCorpus(view, { search: 'API' })).toHaveLength(1);
    expect(store.getAll()).toEqual(before);
    expect(view.evidence.size).toBe(store.size);
  });
});
