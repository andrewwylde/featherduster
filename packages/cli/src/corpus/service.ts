import fs from 'node:fs';
import { randomUUID } from 'node:crypto';
import * as C from '@featherduster/core';
import { z } from 'zod';
import { CorpusRepository, semanticCorpusChange } from './repository.js';
import { sourceFingerprint } from './load.js';
import { RepositoryError } from '../jobs/repository.js';

const clientSupport = C.SkillSupportSchema.extend({ sources: z.array(C.SourceSupportSchema.omit({ source_status: true }).strict()).min(1) }).strict();
export const CorpusRequestSchema = z.object({
  workspace_id: z.string().uuid(), expected_revision: z.number().int().nonnegative(),
  idempotency_key: z.string().trim().min(1), explanation: z.string().trim().min(1),
  supersedes: z.string().uuid().nullable().default(null),
  change: z.discriminatedUnion('kind', [
    z.object({ kind: z.literal('skill_support'), value: clientSupport }).strict(),
    z.object({ kind: z.literal('evidence_amendment'), value: C.EvidenceAmendmentSchema }).strict(),
    z.object({ kind: z.literal('withdrawal'), update_id: z.string().uuid(), reason: z.string().trim().min(1) }).strict(),
  ]),
}).strict();
export type CorpusRequest = z.infer<typeof CorpusRequestSchema>;
export class CorpusService {
  constructor(readonly repository: CorpusRepository, private readonly source: () => C.EvidenceStore, private readonly onCommit: () => void = () => {}) {}
  read(context: C.CorpusContext = {}) {
    return this.repository.jobs.database.db.transaction(() => {
      const snapshot = this.repository.snapshot();
      const source = this.source();
      const effective = C.applyCorpusSnapshot(source, snapshot, { fingerprint: sourceFingerprint });
      const superseded = new Set(snapshot.updates.flatMap(u => u.supersedes ? [u.supersedes] : []));
      const withdrawn = new Set(snapshot.updates.flatMap(u => u.change.kind === 'withdrawal' ? [u.change.update_id] : []));
      const history = snapshot.updates.map(update => ({ update, state: withdrawn.has(update.id) ? 'withdrawn' : superseded.has(update.id) ? 'superseded' : effective.issues.some(i => i.update_id === update.id) ? 'conflicted' : update.change.kind === 'withdrawal' ? 'withdrawal' : 'active', withdraw_url: `/api/corpus/updates/${update.id}/withdraw` }));
      return { history, workspace_id: this.repository.jobs.database.workspaceId, snapshot, ...effective, support: C.applicableSkillSupport(effective.support, context), records: source.getAll().map(record => ({ source: record, effective: effective.evidence.get(record.id), fingerprint: sourceFingerprint(record), storage_kind: record.filePath && (/evidence-ledger/i.test(record.filePath) || fs.readFileSync(record.filePath, 'utf8').includes('entries:')) ? 'ledger' : 'standalone' })), feedback: this.repository.listFeedback() };
    })();
  }
  private prepare(input: CorpusRequest) {
    const request = CorpusRequestSchema.parse(input);
    if (request.workspace_id !== this.repository.jobs.database.workspaceId) throw new RepositoryError('invalid_relationship', 'Wrong workspace');
    const snapshot = this.repository.snapshot();
    if (snapshot.revision !== request.expected_revision) throw new RepositoryError('revision_conflict', 'Stale corpus revision');
    const source = this.source();
    const change: C.CorpusChange = structuredClone(request.change);
    if (change.kind === 'skill_support') {
      for (const binding of change.value.sources) {
        const record = source.get(binding.evidence_id);
        if (!record || record.confidence === 'retracted' || sourceFingerprint(record) !== binding.evidence_fingerprint) throw new RepositoryError('invalid_relationship', 'Source version missing, changed or retracted');
        if (![record.title, record.summary, record.impact, record.narrative].some(v => v.includes(binding.quote))) throw new RepositoryError('invalid_relationship', 'Quote is not a literal source passage');
        binding.source_status = { confidence: record.confidence, in_flight: record.in_flight };
      }
    } else if (change.kind === 'evidence_amendment') {
      const a = change.value;
      const original = source.get(a.evidence_id);
      if (!original || original.confidence === 'retracted' || sourceFingerprint(original) !== a.base_fingerprint) throw new RepositoryError('invalid_relationship', 'Amendment base changed or missing');
      if (original.in_flight && !a.entry.in_flight) throw new RepositoryError('invalid_relationship', 'An in-flight source cannot be upgraded to completed');
      if (a.entry.confidence !== 'provisional') throw new RepositoryError('invalid_relationship', 'Amendments must be provisional');
      for (const metric of a.entry.metrics) {
        const previous = original.metrics.find(m => m.name === metric.name && m.value === metric.value);
        if (metric.status !== (previous?.status ?? 'unverified')) throw new RepositoryError('invalid_relationship', 'Metric verification cannot be upgraded');
      }
    }
    const feedback: C.FeedbackEvent = { schema_version: 1, id: randomUUID(), workspace_id: request.workspace_id, job_id: null, proposal_id: null, review_revision: null, kind: change.kind === 'evidence_amendment' ? 'fact' : 'grounding', before: '', after: JSON.stringify(change), explanation: request.explanation, scope: change.kind === 'skill_support' ? change.value.scope : { kind: 'workspace' }, recorded_by: 'local-human', recorded_at: new Date().toISOString() };
    const update: C.CorpusUpdate = { schema_version: 1, id: randomUUID(), workspace_id: request.workspace_id, revision: snapshot.revision + 1, feedback_id: feedback.id, supersedes: request.supersedes, change, recorded_at: feedback.recorded_at };
    const inactive = new Set(snapshot.updates.flatMap(u => [...(u.supersedes ? [u.supersedes] : []), ...(u.change.kind === 'withdrawal' ? [u.change.update_id] : [])]));
    const active = snapshot.updates.filter(u => !inactive.has(u.id) && u.change.kind !== 'withdrawal');
    if (request.supersedes && !active.some(u => u.id === request.supersedes)) throw new RepositoryError('invalid_relationship', 'Supersession target is not active');
    if (change.kind === 'withdrawal' && !active.some(u => u.id === change.update_id)) throw new RepositoryError('invalid_relationship', 'Withdrawal target is not active');
    const equivalent = !request.supersedes && active.find(u => semanticCorpusChange(u.change) === semanticCorpusChange(change));
    const effective = C.applyCorpusSnapshot(source, equivalent ? snapshot : { ...snapshot, revision: update.revision, updates: [...snapshot.updates, update] }, { fingerprint: sourceFingerprint });
    const conflicts = effective.issues.filter(i => i.update_id === update.id);
    return { request, feedback, update, conflicts, confidence_changes: source.getAll().filter(r => r.confidence !== effective.evidence.get(r.id)?.confidence).map(r => ({ evidence_id: r.id, before: r.confidence, after: effective.evidence.get(r.id)?.confidence })), records: source.getAll().map(r => ({ source: r, effective: effective.evidence.get(r.id) })) };
  }
  preview(input: CorpusRequest) { return this.prepare(input); }
  remember(input: CorpusRequest) {
    const request = CorpusRequestSchema.parse(input);
    const result = this.repository.jobs.withReceipt('corpus', request.idempotency_key, request, () => {
      const prepared = this.prepare(request);
      if (prepared.conflicts.length) throw new RepositoryError('invalid_relationship', prepared.conflicts.map(i => i.message).join('; '));
      // Re-read ledger bytes immediately before publication, not only during preview.
      for (const record of prepared.records) {
        const live = this.source().get(record.source.id);
        if (!live || sourceFingerprint(live) !== sourceFingerprint(record.source)) throw new RepositoryError('revision_conflict', 'Source changed during save');
      }
      return this.repository.apply(prepared.feedback, prepared.update.change, request.expected_revision, request.supersedes);
    });
    try {
      C.CorpusUpdateSchema.parse(result.result);
      if (result.result.workspace_id !== this.repository.jobs.database.workspaceId) throw new Error('Foreign receipt');
    } catch { throw new RepositoryError('corrupt_data', 'Invalid stored corpus receipt'); }
    if (!result.replayed) this.onCommit();
    return result;
  }
  withdraw(input: CorpusRequest) {
    if (input.change.kind !== 'withdrawal') throw new RepositoryError('invalid_relationship', 'Expected withdrawal');
    return this.remember(input);
  }
}
