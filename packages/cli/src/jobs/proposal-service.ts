import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import * as C from '@featherduster/core';
import { sourceFingerprint } from '../corpus/load.js';
import { CorpusRequestSchema, CorpusService } from '../corpus/service.js';
import { JobArtifactsService } from './artifacts.js';
import { fingerprint } from './files.js';
import { JobsRepository, RepositoryError, type OwnershipFence } from './repository.js';
import { ProposalRepository } from './proposal-repository.js';
import type { JobsService } from './service.js';

const uuid = z.string().uuid();
const revision = z.number().int().nonnegative();
const text = z.string().min(1);
const canonical = (value: unknown): string => JSON.stringify(value, (_, v) => v && typeof v === 'object' && !Array.isArray(v) ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => a.localeCompare(b))) : v);
export const ReviewBindingSchema = z.object({ expected_job_revision: revision, expected_review_revision: revision, input_fingerprint: text }).strict();
export const SaveReviewSchema = ReviewBindingSchema.extend({
  patches: z.array(C.ProposalPatchSchema),
  removed_grounding_ids: z.array(uuid).optional(),
  groundings: z.array(z.object({ proposal_id: text, claim_fingerprint: text, term: text, sources: z.array(C.SourceSupportSchema.omit({ source_status: true }).strict()).min(1), explanation: text }).strict()),
  feedback_kind: C.FeedbackEventSchema.shape.kind, explanation: z.string(),
  remember: z.object({ expected_corpus_revision: revision, change: CorpusRequestSchema.shape.change, supersedes: uuid.optional() }).strict().optional(),
  idempotency_key: text,
}).strict();
export const ContinueReviewSchema = ReviewBindingSchema.extend({ validation_fingerprint: text, idempotency_key: text }).strict();
export const RecoverReviewSchema = z.object({ expected_job_revision: revision, input_snapshot_id: uuid, idempotency_key: text }).strict();
type Binding = z.infer<typeof ReviewBindingSchema> & { job_id: string; review_id: string };
export type SaveProposalReviewRequest = z.infer<typeof SaveReviewSchema> & { job_id: string; review_id: string };
export const claimFingerprint = (p: C.Proposal) => fingerprint(canonical({ proposal_id: p.id, text: p.edited_after ?? p.after, citations: p.citations }));

/** No runners or renderer dependencies: editing and rechecking cannot execute models. */
export class ProposalService {
  constructor(readonly jobs: JobsRepository, readonly proposals: ProposalRepository, readonly artifacts: JobArtifactsService, readonly corpus: CorpusService, private readonly lifecycle?: JobsService) {}
  private fail(message: string): never { throw new RepositoryError('invalid_relationship', message); }
  private context(g: C.ProposalGeneration) {
    const context = this.artifacts.preparationContext(g.attempt_id);
    if (!context.analysis || !context.alignment || !context.captured) return this.fail('Saved analysis and alignment are required');
    const rules = C.PrivacyRulesConfigSchema.parse(JSON.parse(this.jobs.database.files.readSnapshot(context.captured.input.privacy_rules, g.job_id, g.input_snapshot_id).toString()));
    return { ...context, analysis: context.analysis, alignment: context.alignment, captured: context.captured, rules };
  }
  private currentInput(jobId: string, inputId: string) {
    const row = this.jobs.database.db.prepare("SELECT id FROM input_snapshots WHERE job_id=? AND json_extract(payload, '$.schema_version')=1 ORDER BY rowid DESC LIMIT 1").get(jobId) as { id: string } | undefined;
    if (row?.id !== inputId) throw new RepositoryError('revision_conflict', 'Inputs changed; refresh and explicitly prepare a new version');
  }
  private bound(request: Binding) {
    const job = this.jobs.getJob(request.job_id);
    const review = this.proposals.getActive(job.id);
    if (job.revision !== request.expected_job_revision || !review || review.id !== request.review_id || review.revision !== request.expected_review_revision) throw new RepositoryError('revision_conflict', 'Stale job or review; reload before saving');
    if (review.input_fingerprint !== request.input_fingerprint) this.fail('Review input mismatch');
    this.currentInput(job.id, review.input_snapshot_id);
    if (this.jobs.active().some(a => a.job_id === job.id)) throw new RepositoryError('invalid_ownership', 'Cannot edit an active attempt');
    return { job, review, generation: this.proposals.getGeneration(review.generation_id) };
  }
  read(jobId: string): C.ProposalReadResponse {
    return this.jobs.database.files.withReadScope(() => this.readVerified(jobId));
  }
  private readVerified(jobId: string): C.ProposalReadResponse {
    const job = this.jobs.getJob(jobId);
    const review = this.proposals.getActive(jobId);
    const latest = this.jobs.database.db.prepare("SELECT id FROM input_snapshots WHERE job_id=? AND json_extract(payload, '$.schema_version')=1 ORDER BY rowid DESC LIMIT 1").get(jobId) as { id: string } | undefined;
    const latest_input_snapshot_id = latest?.id ?? null;
    if (!review) {
      const input_snapshot_id = job.current_attempt_id ? this.jobs.getAttempt(job.current_attempt_id).input_snapshot_id : null;
      const source = input_snapshot_id ? this.recoverySource(job, input_snapshot_id) : null;
      return { availability: 'missing_output' as const, latest_input_snapshot_id, recoverable: !!source && input_snapshot_id === latest_input_snapshot_id && job.preparation_state === 'needs_input' && job.preparation_stage === 'proposals', input_snapshot_id };
    }
    const generation = this.proposals.getGeneration(review.generation_id);
    const ctx = this.context(generation);
    const history = (this.jobs.database.db.prepare('SELECT id,revision FROM proposal_review_revisions WHERE job_id=? ORDER BY rowid').all(jobId) as { id: string; revision: number }[]).map(r => this.proposals.getRevision(r.id, r.revision));
    return { availability: 'available' as const, generation, generations: [...new Set(history.map(r => r.generation_id))].map(id => this.proposals.getGeneration(id)), review, history, latest_input_snapshot_id, input_stale: latest_input_snapshot_id !== review.input_snapshot_id, corpus_revision: this.corpus.repository.snapshot().revision, captured: { source_fingerprints: Object.fromEntries(ctx.captured.evidence.getAll().map(r => [r.id, sourceFingerprint(r)])), input: ctx.captured.input, base_resume: ctx.captured.base_resume, evidence: ctx.captured.evidence.getAll(), knowledge: ctx.captured.knowledge, skillSupport: ctx.captured.skillSupport, analysis: ctx.analysis, alignment: ctx.alignment } };
  }
  evaluate(g: C.ProposalGeneration, review: Pick<C.ProposalReviewRevision, 'id' | 'revision' | 'patches' | 'groundings'>) {
    const ctx = this.context(g);
    const overlay = C.applyProposalPatches(g.proposals.proposals, [], review.patches);
    for (const grounding of review.groundings) {
      const p = overlay.proposals.find(p => p.id === grounding.proposal_id);
      if (!p || claimFingerprint(p) !== grounding.claim_fingerprint || !C.containsTerm(p.edited_after ?? p.after, grounding.term)) this.fail('Grounding claim changed');
      for (const binding of grounding.sources) {
        const record = ctx.captured.evidence.get(binding.evidence_id);
        if (!p.citations.includes(binding.evidence_id) || !record || record.confidence === 'retracted' || sourceFingerprint(record) !== binding.evidence_fingerprint || ![record.title, record.summary, record.impact, record.narrative].some(t => t.includes(binding.quote))) this.fail('Grounding source, citation or literal passage mismatch');
      }
    }
    const supportFor = (p: C.Proposal): C.SkillSupport[] => [...ctx.captured.skillSupport, ...review.groundings.filter(x => x.proposal_id === p.id).map(x => ({ skill: x.term, facet: x.term, permitted_terms: [x.term], support: 'direct' as const, scope: { kind: 'job' as const, key: g.job_id }, sources: x.sources, explanation: x.explanation }))];
    const result = C.validateProposalReview(ctx.captured.base_resume, overlay.proposals, { analysis: ctx.analysis, alignment: ctx.alignment, evidence: ctx.captured.evidence.getAll(), skillSupport: ctx.captured.skillSupport }, ctx.rules, supportFor);
    const validation: C.ProposalReviewRevision['validation'] = { authority: 'server', version: '1', fingerprint: fingerprint(canonical({ generation_id: g.id, input_fingerprint: g.input_fingerprint, review_revision: review.revision, proposals: overlay.proposals, groundings: review.groundings, validator_version: 1 })), generation_id: g.id, input_fingerprint: g.input_fingerprint, review_revision: review.revision, status: result.valid ? 'ready' : 'blocked', issues: result.issues };
    return { candidate_preview: result.candidate, validation, proposals: result.proposals, appliedProposalIds: result.appliedProposalIds };
  }
  initial(g: C.ProposalGeneration, fence: OwnershipFence) {
    const value = { schema_version: 1 as const, id: randomUUID(), revision: 0, workspace_id: g.workspace_id, job_id: g.job_id, generation_id: g.id, input_snapshot_id: g.input_snapshot_id, input_fingerprint: g.input_fingerprint, patches: [], groundings: [], feedback_ids: [], corpus_update_ids: [], created_at: new Date().toISOString() };
    const { candidate_preview, validation } = this.evaluate(g, value);
    const active = this.proposals.getActive(g.job_id);
    return this.jobs.database.db.transaction(() => {
      const saved = this.proposals.appendReview({ ...value, candidate_preview, validation }, null, fence, active ?? undefined);
      this.event(saved, fence); return saved;
    }).immediate();
  }
  private event(review: C.ProposalReviewRevision, fence?: OwnershipFence) {
    this.jobs.appendEvent({ schema_version: 1, id: randomUUID(), workspace_id: review.workspace_id, job_id: review.job_id, created_at: new Date().toISOString(), actor: fence ? { kind: 'worker', id: 'proposal-preparation' } : { kind: 'user', id: 'local-human' }, attempt_id: fence?.attempt_id ?? null, idempotency_key: null, payload: { kind: 'proposal_review', review_id: review.id, revision: review.revision, generation_id: review.generation_id, input_fingerprint: review.input_fingerprint } });
  }
  save(request: SaveProposalReviewRequest): C.ProposalSaveResponse {
    const { job_id, review_id, ...body } = request;
    SaveReviewSchema.parse(body);
    return this.jobs.withReceipt('proposal_save', request.idempotency_key, request, () => {
      const { job, review, generation } = this.bound(request);
      const overlay = C.applyProposalPatches(generation.proposals.proposals, review.patches, request.patches, review.groundings);
      const nextRevision = review.revision + 1;
      if (request.removed_grounding_ids?.some(id => !review.groundings.some(g => g.id === id))) this.fail('Unknown grounding removal');
      const groundings = [...overlay.groundings.filter(g => !request.removed_grounding_ids?.includes(g.id) && !request.groundings.some(n => n.proposal_id === g.proposal_id && n.term === g.term)), ...request.groundings.map(g => ({ ...g, id: randomUUID(), recorded_by: 'local-human', recorded_at: new Date().toISOString() }))].map(g => ({ ...g, review_id, review_revision: nextRevision }));
      const draft = { ...review, revision: nextRevision, patches: overlay.patches, groundings, created_at: new Date().toISOString() };
      const { candidate_preview, validation } = this.evaluate(generation, draft);
      const feedback: C.FeedbackEvent = { schema_version: 1, id: randomUUID(), workspace_id: job.workspace_id, job_id, proposal_id: null, review_revision: nextRevision, kind: request.feedback_kind, before: canonical(review.patches), after: canonical(overlay.patches), explanation: request.explanation, scope: { kind: 'job', key: job_id }, recorded_by: 'local-human', recorded_at: draft.created_at };
      if (!request.remember) this.corpus.repository.saveFeedback(feedback);
      let update: C.CorpusUpdate | undefined;
      if (request.remember) {
        const memory = request.remember;
        const prepared = this.corpus.preview({ workspace_id: job.workspace_id, expected_revision: memory.expected_corpus_revision, idempotency_key: request.idempotency_key, explanation: request.explanation, change: memory.change, supersedes: memory.supersedes ?? null });
        if (prepared.conflicts.length) this.fail(prepared.conflicts.map(c => c.message).join('; '));
        update = this.corpus.repository.apply(feedback, prepared.update.change, memory.expected_corpus_revision, memory.supersedes ?? null);
      }
      const saved = this.proposals.appendReview({ ...draft, candidate_preview, validation, feedback_ids: [...review.feedback_ids, feedback.id], corpus_update_ids: [...review.corpus_update_ids, ...(update ? [update.id] : [])] }, review.revision);
      const stale = job.recovery?.kind === 'stale_inputs' || request.remember?.change.kind === 'evidence_amendment';
      const savedJob = this.jobs.updateJob({ ...job, recovery: stale ? { kind: 'stale_inputs', subject: {}, action: 'refresh_inputs' } : { kind: 'proposals', subject: {}, action: 'review_proposals' } }, job.revision);
      this.event(saved);
      return { job: savedJob, review: saved, corpus_revision: this.corpus.repository.snapshot().revision, update, requires_refresh: stale };
    });
  }
  recheck(request: Binding) {
    const { job_id, review_id, ...body } = request; ReviewBindingSchema.parse(body);
    return this.jobs.database.db.transaction(() => {
      const { review, generation } = this.bound(request);
      const result = this.evaluate(generation, review);
      if (canonical(result.validation) !== canonical(review.validation) || canonical(result.candidate_preview) !== canonical(review.candidate_preview)) throw new RepositoryError('corrupt_data', 'Saved validation does not match its inputs');
      return { review };
    }).immediate();
  }
  continue(request: Binding & { validation_fingerprint: string; idempotency_key: string }) {
    const { job_id, review_id, ...body } = request; ContinueReviewSchema.parse(body);
    if (!this.lifecycle) throw new Error('Lifecycle unavailable');
    return this.lifecycle.admitReview(request, () => {
      const { job, review } = this.bound(request);
      this.recheck({ job_id, review_id, expected_job_revision: request.expected_job_revision, expected_review_revision: request.expected_review_revision, input_fingerprint: request.input_fingerprint });
      if (job.recovery?.kind === 'stale_inputs' || review.validation.status !== 'ready' || review.validation.fingerprint !== request.validation_fingerprint) this.fail('Continue requires the exact ready saved revision');
      return { job, input_snapshot_id: review.input_snapshot_id, bind: (attempt: C.Attempt) => this.proposals.bindAttempt(attempt.id, review.id, review.revision, review.validation.fingerprint, { attempt_id: attempt.id, owner_token: attempt.owner_token, stop_generation: attempt.stop_generation }) };
    });
  }
  recover(request: z.infer<typeof RecoverReviewSchema> & { job_id: string }) {
    const { job_id, ...body } = request; RecoverReviewSchema.parse(body);
    if (!this.lifecycle) throw new Error('Lifecycle unavailable');
    return this.lifecycle.admitReview(request, () => {
      const job = this.jobs.getJob(job_id); const view = this.read(job_id);
      if (job.revision !== request.expected_job_revision) throw new RepositoryError('revision_conflict', 'Stale job revision');
      if (view.availability !== 'missing_output' || !view.recoverable || view.input_snapshot_id !== request.input_snapshot_id) this.fail('Historical recovery requires missing output and a saved proposals-stage prefix');
      this.currentInput(job_id, request.input_snapshot_id);
      const source = this.recoverySource(job, request.input_snapshot_id);
      if (!source) this.fail('Historical recovery requires missing output and a saved proposals-stage prefix');
      return { job, input_snapshot_id: request.input_snapshot_id, previous_attempt_id: source.id, bind: (attempt: C.Attempt) => { const current = this.jobs.getJob(job_id); this.jobs.updateJob({ ...current, recovery: { kind: 'proposals', subject: {}, action: 'review_proposals', recovery_attempt_id: attempt.id } }, current.revision); } };
    });
  }
  private recoverySource(job: C.Job, inputSnapshotId: string): C.Attempt | null {
    if (job.preparation_state !== 'needs_input' || job.preparation_stage !== 'proposals') return null;
    const attempts = this.jobs.database.db.prepare('SELECT id FROM attempts WHERE job_id=? AND input_snapshot_id=? ORDER BY rowid DESC').all(job.id, inputSnapshotId) as { id: string }[];
    for (const row of attempts) {
      const checkpoints = this.jobs.listCheckpoints(row.id);
      if (!['preflight', 'analysis', 'alignment'].every(stage => checkpoints.some(c => c.completed_stage === stage))) continue;
      if (checkpoints.some(c => c.completed_stage === 'proposals')) continue;
      const context = this.artifacts.preparationContext(row.id);
      if (context.analysis && context.alignment) return this.jobs.getAttempt(row.id);
    }
    return null;
  }
}
