import { randomUUID } from 'node:crypto';
import { CorpusRepository } from '../corpus/repository.js';
import * as C from '@featherduster/core';
import { SemanticRepository, type SemanticOperation } from './semantic-repository.js';
import { JobArtifactsService } from './artifacts.js';
import { ProposalRepository } from './proposal-repository.js';
import { JobsRepository, RepositoryError } from './repository.js';
import { fingerprint } from './files.js';
import { canonicalResumeValue as canonical } from './resume-context.js';
import { sourceFingerprint } from '../corpus/load.js';
import type { ModelRunner } from '../runners/types.js';
import { classifyBatch, semanticPrompt, SEMANTIC_REQUEST_SYSTEM as SEMANTIC_SYSTEM, SEMANTIC_PROMPT_HASH, mapToSemanticBatchFailure } from './semantic-classifier.js';
import { SEMANTIC_SUITE_VERSION, semanticConfigurationKey } from './semantic-evaluation.js';
export { SEMANTIC_SUITE_VERSION } from './semantic-evaluation.js';
export { SemanticService as JobSemanticService };
export interface SemanticDependencies {
  runner(settings: { runner: string; model: string }): ModelRunner | null;
  consent(runner: ModelRunner): boolean;
  timeoutMs(): number;
  currentRules?(): C.PrivacyRulesConfig;
  beforeDispatch?(jobId: string, key: string, kind: 'model' | 'retry', inputSnapshotId: string): boolean | void;
}
export class SemanticService {
  readonly store: SemanticRepository;
  private running = new Map<string, { controller: AbortController; promise: Promise<void> }>();
  private disposed = false;
  constructor(readonly jobs: JobsRepository, readonly artifacts: JobArtifactsService, private deps: SemanticDependencies) {
    this.store = new SemanticRepository(jobs);
  }
  private fail(message: string): never { throw new RepositoryError('revision_conflict', message); }
  configurationKey(runner: ModelRunner) { return semanticConfigurationKey(runner); }
  context(jobId: string, target?: C.SemanticTarget, override?: { candidate: C.ResumeSpec; proposals: C.Proposal[] }) {
    const job = this.jobs.getJob(jobId), reviews = new ProposalRepository(this.jobs);
    let inputId: string, candidate: C.ResumeSpec, proposals: C.Proposal[] = [];
    let loaded: ReturnType<JobArtifactsService['capturedContext']> | undefined;
    if (target?.kind === 'draft') {
      const draft = this.jobs.getLatestDraft(target.draft_id);
      if (draft.job_id !== job.id) throw new RepositoryError('invalid_relationship', 'Draft belongs to another job');
      inputId = draft.input_snapshot_id; candidate = target.candidate; proposals = draft.proposals.proposals;
    } else {
      const review = reviews.getActive(job.id);
      if (!review) throw new RepositoryError('not_found', 'Prepare a resume before reviewing facts.');
      if (target && (target.review_id !== review.id || target.review_revision !== review.revision)) this.fail('Review changed. Reload current facts.');
      target = { kind: 'review', review_id: review.id, review_revision: review.revision };
      inputId = review.input_snapshot_id;
      const generation = reviews.getGeneration(review.generation_id);
      loaded = this.artifacts.capturedContext(inputId);
      const base = C.effectiveBaseResume(loaded.base_resume, review);
      proposals = C.applyProposalPatches(generation.proposals.proposals, [], review.patches).proposals;
      // Inventory intended content, including edits that literal validation currently rejects.
      candidate = C.applyProposals(base, proposals.filter(p => p.decision !== 'rejected').map(p => ({ ...p, decision: 'accepted' as const, checks: [] })));
    }
    if (override) { candidate = override.candidate; proposals = override.proposals; }
    const captured = loaded ?? this.artifacts.capturedContext(inputId);
    const latest = this.jobs.database.db.prepare("SELECT id FROM input_snapshots WHERE job_id=? AND json_extract(payload,'$.schema_version')=1 ORDER BY rowid DESC LIMIT 1").get(jobId) as { id: string } | undefined;
    const inputCurrent = latest?.id === inputId && job.recovery?.kind !== 'stale_inputs';
    const read = (ref: C.ImmutableReference) => this.jobs.database.files.readSnapshot(ref, jobId, inputId).toString();
    const settings = JSON.parse(read(captured.input.runner_configuration)) as { runner: string; model: string };
    const rules = C.PrivacyRulesConfigSchema.parse(JSON.parse(read(captured.input.privacy_rules)));
    const runner = this.deps.runner(settings);
    const configurationKey = runner ? this.configurationKey(runner) : fingerprint(canonical([settings, SEMANTIC_PROMPT_HASH]));
    const evidence = captured.evidence.getAll();
    const evidenceFingerprint = fingerprint(canonical(evidence.map(e => [e.id, sourceFingerprint(e)]).sort(([a], [b]) => a.localeCompare(b))));
    const passages = C.inventoryPassages(candidate, fingerprint).map(p => {
      const proposal = C.proposalForPassage(proposals, p.subject.path, p.text);
      // Citation edits invalidate the cached check even when the visible wording is unchanged.
      return proposal ? { ...p, inherited: false, subject: { ...p.subject, id: fingerprint(canonical([p.subject.id, proposal.id, proposal.citations, proposal.claim_bindings ?? []])), proposal_id: proposal.id },
        work_context: JSON.stringify({ ...(p.work_context ? JSON.parse(p.work_context) : {}), selected_evidence: proposal.citations,
          proposed_claim_bindings: proposal.claim_bindings ?? [] }) } : p;
    });
    const sources: C.SemanticSource[] = evidence.filter(e => e.confidence !== 'retracted').flatMap(e =>
      (['title', 'summary', 'impact', 'narrative'] as const).filter(field => !!e[field]?.trim()).map(field => ({
        evidence_id: e.id, evidence_fingerprint: sourceFingerprint(e), work_id: e.id, company: e.company, field, start: 0, text: e[field],
      })));
    return { job, target: target!, captured, candidate, candidateFingerprint: fingerprint(canonical(candidate)), inputCurrent,
      runner, rules, configurationKey, evidenceFingerprint, passages, sources, proposals };
  }
  private cacheKey(ctx: ReturnType<SemanticService['context']>, p: C.SemanticPassage) {
    return fingerprint(canonical([p.text, p.work_id, ctx.captured.input.fingerprint, ctx.evidenceFingerprint, ctx.configurationKey, C.SEMANTIC_VERSION]));
  }
  read(jobId: string, target?: C.SemanticTarget, override?: { candidate: C.ResumeSpec; proposals: C.Proposal[] }): C.JobFacts {
    return this.jobs.database.files.withReadScope(() => this.readVerified(jobId, target, override));
  }
  private readVerified(jobId: string, target?: C.SemanticTarget, override?: { candidate: C.ResumeSpec; proposals: C.Proposal[] }): C.JobFacts {
    const ctx = this.context(jobId, target, override), input = ctx.captured.input;
    const records = this.store.results(jobId, input.id).filter(r => r.evidence_set_fingerprint === ctx.evidenceFingerprint && r.configuration_key === ctx.configurationKey && r.policy_version === C.SEMANTIC_VERSION);
    const knowledge = new CorpusRepository(this.jobs).snapshot();
    const corrected = C.correctedClarificationIds(knowledge);
    const localClarifications = this.store.clarifications(jobId, input.id);
    const shared = C.reusableClarifications(knowledge, [...records.flatMap(r => r.passages.flatMap(p => p.claims.map(c => c.claim.fact))), ...ctx.passages.map(p => ({ work_id: p.work_id, predicate: `passage:${p.subject.passage_fingerprint}`, qualifiers: [] }))], ctx.sources);
    const clarifications = [...localClarifications.filter(c => !corrected.has(c.id)), ...shared.filter(c => !localClarifications.some(l => l.id === c.id))];
    const evaluated = this.store.evaluation(ctx.configurationKey, SEMANTIC_SUITE_VERSION)?.passed === true;
    const conflicts = C.knownClarificationConflicts(knowledge, ctx.passages);
    const facts: C.JobFact[] = ctx.passages.flatMap(p => {
      const result = records.flatMap(r => r.passages).find(v => v.subject.id === p.subject.id && v.subject.passage_fingerprint === p.subject.passage_fingerprint);
      const fallback: C.ClaimResult = { claim: { id: `passage:${p.subject.id}`, subject: p.subject, text: p.text, start: 0, end: p.text.length,
        fact: { work_id: p.work_id, predicate: `passage:${p.subject.passage_fingerprint}`, qualifiers: [] }, qualifier_text: [] },
        state: 'unavailable', evidence: [], explanation: 'This wording has not had a completed evidence check.', question: 'Can you confirm this exact wording describes your work?' };
      return (result?.claims ?? [fallback]).map(original => {
        const c: C.ClaimResult = { ...original, claim: { ...original.claim, subject: p.subject } };
        const valid = ctx.inputCurrent && (original === fallback || C.validClaimBinding(c, p, ctx.sources));
        const human = valid ? C.matchingClarification(c, clarifications)
          ?? (c.state !== 'contradicted' ? C.matchingClarification(fallback, clarifications) : undefined) : undefined;
        // Evaluation measures configuration quality; each claim must independently
        // pass the immutable source/span checks before it can grant support.
        const oldAnswers = knowledge.updates.flatMap(u => u.change.kind === 'clarification' ? [u.change.value.clarification] : []);
        const conflict = conflicts.some(conflict => conflict.path === p.subject.path) || [...localClarifications, ...oldAnswers].some(old => corrected.has(old.id) && old.fact.work_id === c.claim.fact.work_id
          && (!old.confirmed_claims || old.confirmed_claims.includes(c.claim.text)));
        const proposal = ctx.proposals.find(p => p.id === c.claim.subject.proposal_id);
        const mappingValid = !proposal || c.evidence.every(q => proposal.citations.includes(q.evidence_id));
        const machine = valid && mappingValid && !conflict && c.state === 'supported' && c.evidence.length > 0;
        return { ...c, ...(conflict && !human ? { explanation: 'A saved correction supersedes the answer supporting this wording. Review the corrected fact before reusing it.', question: 'How should this passage reflect the corrected fact?' } : {}), evidence: [...c.evidence, ...(human?.supporting_quotes ?? [])], state: !valid ? 'unavailable' : conflict && !human ? 'needs_clarification' : c.state, passage: p,
          resolution: human ? { provenance: 'human' as const, explanation: human.assertion }
            : machine ? { provenance: 'model' as const, explanation: c.explanation } : null };
      });
    });
    const latest = this.jobs.database.db.prepare('SELECT payload FROM semantic_operations WHERE job_id=? AND target_fingerprint=? ORDER BY sequence DESC LIMIT 1').get(jobId, ctx.candidateFingerprint) as { payload: string } | undefined;
    const storedOperation = latest ? JSON.parse(latest.payload) as SemanticOperation : undefined;
    const operation = storedOperation ? this.operation(jobId, storedOperation.id) : undefined;
    return { job_id: jobId, job_revision: ctx.job.revision, input_fingerprint: input.fingerprint, semantic_revision: this.store.head(jobId),
      corpus_revision: knowledge.revision, shared_clarifications: C.activeCorpusUpdates(knowledge).flatMap(u => u.change.kind === 'clarification' ? [{ update_id: u.id, clarification: u.change.value.clarification }] : []),
      target: ctx.target, candidate_fingerprint: ctx.candidateFingerprint, facts, clarifications, sources: ctx.sources,
      support_fingerprint: fingerprint(canonical({ facts: facts.map(f => [f.claim, f.evidence, f.resolution]), input: input.fingerprint, evidence: ctx.evidenceFingerprint, configuration: ctx.configurationKey, policy: C.SEMANTIC_VERSION })),
      execution: facts.length > 0 && facts.every(f => f.resolution) ? 'complete' : operation?.state ?? 'unchecked', ...(operation?.reason ? { reason: operation.reason } : {}),
      failures: operation?.failures,
      batches_succeeded: operation?.batches_succeeded,
      batches_failed: operation?.batches_failed,
      batchesSucceeded: operation?.batches_succeeded,
      batchesFailed: operation?.batches_failed,
      configuration_evaluated: evaluated, usage: this.store.usage(jobId) };
  }
  support(jobId: string, inputId: string, candidate: C.ResumeSpec, proposals: C.Proposal[], target?: C.SemanticTarget) {
    const ctx = this.context(jobId, target, { candidate, proposals });
    if (ctx.captured.input.id !== inputId) this.fail('Evidence decisions belong to different inputs.');
    const view = this.read(jobId, target, { candidate, proposals });
    return { support: C.semanticSupport(view), fingerprint: view.support_fingerprint };
  }
  binding(jobId: string, target?: C.SemanticTarget): NonNullable<C.ArtifactVersion['semantic_binding']> {
    const ctx = this.context(jobId, target);
    const knowledge = new CorpusRepository(this.jobs).snapshot();
    const relevant = knowledge.updates.filter(u => { const change = u.change; return change.kind === 'clarification' && ctx.passages.some(p => p.work_id === change.value.clarification.fact.work_id); });
    return { revision: this.store.head(jobId), configuration_key: ctx.configurationKey,
      ...(relevant.length ? { clarification_fingerprint: fingerprint(canonical(relevant)) } : {}),
      evaluated: this.store.evaluation(ctx.configurationKey, SEMANTIC_SUITE_VERSION)?.passed === true };
  }
  start(jobId: string, request: C.StartSemanticCheck, cycleId?: string, signal?: AbortSignal) {
    if (this.disposed) throw new RepositoryError('ineligible', 'Checker is shutting down.');
    const ctx = this.context(jobId, request.target);
    if (!ctx.inputCurrent || request.input_fingerprint !== ctx.captured.input.fingerprint) this.fail('Inputs changed. Review current inputs.');
    const op = this.store.begin({ job_id: jobId, input_snapshot_id: ctx.captured.input.id, expected_job_revision: request.expected_job_revision,
      expected_semantic_revision: request.expected_semantic_revision, cycle_id: cycleId ?? `edit:${request.idempotency_key}`,
      target_fingerprint: ctx.candidateFingerprint, idempotency_key: request.idempotency_key, automatic: !!cycleId });
    if (this.running.get(jobId)?.promise && this.activeId.get(jobId) === op.id) return { operation_id: op.id, state: op.state };
    if (op.state !== 'checking') return { operation_id: op.id, state: op.state };
    // Replaying an interrupted dispatch must not spend another model call.
    const dispatched = this.jobs.database.db.prepare('SELECT 1 FROM semantic_calls WHERE json_extract(payload,\'$.operation_id\')=? LIMIT 1').get(op.id);
    if (dispatched) return this.operation(jobId, op.id);
    const prior = this.running.get(jobId); prior?.controller.abort();
    const controller = new AbortController(), abort = () => controller.abort();
    signal?.addEventListener('abort', abort, { once: true }); if (signal?.aborted) abort();
    this.activeId.set(jobId, op.id);
    const promise = (async () => {
      if (prior) await prior.promise;
      try { await this.execute(op, ctx, controller.signal); }
      catch (e) { this.store.finish(op.id, jobId, e instanceof Error ? e.message : 'Classification unavailable'); }
      finally { signal?.removeEventListener('abort', abort); if (this.activeId.get(jobId) === op.id) { this.running.delete(jobId); this.activeId.delete(jobId); } }
    })();
    this.running.set(jobId, { controller, promise });
    return { operation_id: op.id, state: 'checking' as const };
  }
  private activeId = new Map<string, string>();
  async wait(jobId: string) { await this.running.get(jobId)?.promise; }
  operation(jobId: string, id: string) {
    const op = this.store.operation(jobId, id);
    if (op.state === 'checking' && this.activeId.get(jobId) !== id) {
      const lease = this.jobs.database.db.prepare('SELECT expires_at FROM semantic_leases WHERE job_id=?').get(jobId) as { expires_at: string } | undefined;
      if (!lease || lease.expires_at <= new Date().toISOString()) return { operation_id: op.id, state: 'unavailable' as const, reason: 'The previous check was interrupted. Retry explicitly or review facts manually.', failures: op.failures, batches_succeeded: op.batches_succeeded, batches_failed: op.batches_failed, batchesSucceeded: op.batches_succeeded, batchesFailed: op.batches_failed };
    }
    return { operation_id: op.id, state: op.state, reason: op.reason, failures: op.failures, batches_succeeded: op.batches_succeeded, batches_failed: op.batches_failed, batchesSucceeded: op.batches_succeeded, batchesFailed: op.batches_failed };
  }
  async classifyJobPassages(jobId: string, options?: { batchSize?: number; target?: C.SemanticTarget }) {
    const current = this.read(jobId, options?.target);
    this.start(jobId, {
      target: current.target,
      expected_job_revision: current.job_revision,
      expected_semantic_revision: current.semantic_revision,
      input_fingerprint: current.input_fingerprint,
      reason: 'check',
      idempotency_key: randomUUID(),
    });
    await this.wait(jobId);
    const read = this.read(jobId, options?.target);
    return {
      ...read,
      batchesSucceeded: read.batchesSucceeded ?? 0,
      batchesFailed: read.batchesFailed ?? 0,
      passages: read.facts.map(f => ({ ...f, status: f.state })),
      failures: read.failures ?? [],
    };
  }
  private async execute(op: SemanticOperation, ctx: ReturnType<SemanticService['context']>, signal: AbortSignal) {
    if (!ctx.runner) throw Error('Configured runner is unavailable. Review facts manually.');
    if (ctx.runner.locality === 'cloud' && !this.deps.consent(ctx.runner)) throw Error('Cloud runner consent is required. Review facts manually or configure consent.');
    const existing = this.store.results(op.job_id, op.input_snapshot_id);
    const uncached = ctx.passages.filter(p => !existing.some(r => r.configuration_key === ctx.configurationKey
      && r.policy_version === C.SEMANTIC_VERSION && r.evidence_set_fingerprint === ctx.evidenceFingerprint
      && r.input_fingerprint === ctx.captured.input.fingerprint && r.passages.some(v => v.subject.id === p.subject.id && v.subject.passage_fingerprint === p.subject.passage_fingerprint)));
    // Four passages keep real resume responses within the existing 60-second
    // deadline; eight remains the transport maximum, not the default batch size.
    const batchSize = Math.min(4, C.SEMANTIC_LIMITS.passages);
    const failures: C.SemanticBatchFailure[] = [];
    let batchesSucceeded = 0;
    let batchesFailed = 0;
    for (let offset = 0; offset < uncached.length; offset += batchSize) {
      if (signal.aborted) throw Error('Classification cancelled.');
      if (ctx.runner.locality === 'cloud' && !this.deps.consent(ctx.runner)) throw Error('Cloud runner consent changed. Review facts manually.');
      if (this.deps.currentRules && canonical(C.PrivacyRulesConfigSchema.parse(this.deps.currentRules())) !== canonical(ctx.rules))
        throw Error('Privacy rules changed. Review current inputs before checking evidence.');
      const batch = uncached.slice(offset, offset + batchSize);
      const batchIndex = Math.floor(offset / batchSize) + 1;
      const query = batch.map(p => `${p.text}\n${p.work_context ?? ''}`).join('\n');
      const ranked = C.discoverEvidence(query, ctx.sources.map((s, i) => ({ id: String(i), fingerprint: s.evidence_fingerprint, work_id: s.work_id, text: `${s.evidence_id}\n${s.company ?? ''}\n${s.text}`, retracted: false })));
      const cited = new Set(batch.flatMap(p => { try {
        const context = JSON.parse(p.work_context ?? '{}');
        return [...(context.cited_work ?? []), ...(context.selected_evidence ?? [])] as string[];
      } catch { return []; } }));
      ranked.matches.sort((a, b) => Number(cited.has(ctx.sources[Number(b.id)].evidence_id)) - Number(cited.has(ctx.sources[Number(a.id)].evidence_id)) || b.score - a.score);
      // Include identities, work context, JSON escaping and coverage metadata in
      // the bound, rather than counting only source text.
      let chars = semanticPrompt({ subjects: batch, sources: [], configuration_key: ctx.configurationKey,
        configuredStepTimeoutMs: this.deps.timeoutMs(), coverage: { searched_source_count: ctx.captured.evidence.getAll().length,
          omitted_source_ids: [...new Set(ctx.sources.map(s => s.evidence_id))], truncated: true } }).length + SEMANTIC_SYSTEM.length;
      let sourceCount = 0;
      const sources = ranked.matches.flatMap(m => {
        const source = ctx.sources[Number(m.id)];
        // Whole captured fields preserve negation. Never silently truncate a source sentence.
        if (ctx.runner!.locality === 'cloud') { const redacted = C.redactText(source.text, ctx.rules); if (!redacted.isClean || redacted.redactedText !== source.text) return []; }
        const size = JSON.stringify({ ...source, ref: `s${sourceCount + 1}` }).length + 1;
        if (chars + size > C.SEMANTIC_LIMITS.inputChars) return [];
        chars += size; sourceCount++; return [source];
      });
      if (ctx.runner.locality === 'cloud' && batch.some(p => { const redacted = C.redactText(p.text, ctx.rules); return !redacted.isClean || redacted.redactedText !== p.text; }))
        throw Error('These claims contain wording that cannot be sent under the current privacy rules. Review them manually.');
      const dispatchKey = `${op.id}:${batch.map(p => p.subject.id).join(':')}`;
      const automatic = this.deps.beforeDispatch?.(op.job_id, dispatchKey, 'model', op.input_snapshot_id);
      let call = this.store.reserve(op.id, Math.min(60000, this.deps.timeoutMs()) + 10000), started = Date.now();
      const request = { subjects: batch, sources, configuration_key: ctx.configurationKey,
        configuredStepTimeoutMs: this.deps.timeoutMs(), coverage: { searched_source_count: ctx.captured.evidence.getAll().length,
          omitted_source_ids: [...new Set(ctx.sources.filter(s => !sources.includes(s)).map(s => s.evidence_id))], truncated: sources.length !== ctx.sources.length } };
      let outcome = await classifyBatch(ctx.runner, request, signal, batchIndex);
      if (outcome.status === 'unavailable' && automatic && !signal.aborted && /timeout|timed out|temporar|offline|ECONNRESET|ECONNREFUSED|rate.limit|\b503\b/i.test(outcome.reason)) {
        this.store.recordBatchFailure(call, outcome.failure ?? mapToSemanticBatchFailure(new Error(outcome.reason), batchIndex, batch.map(p => p.subject.id)), outcome.reason, Date.now() - started);
        this.deps.beforeDispatch?.(op.job_id, `${dispatchKey}:retry`, 'retry', op.input_snapshot_id);
        call = this.store.reserve(op.id, Math.min(60000, this.deps.timeoutMs()) + 10000); started = Date.now();
        outcome = await classifyBatch(ctx.runner, request, signal, batchIndex);
      }
      if (outcome.status === 'unavailable') {
        batchesFailed++;
        const failure = outcome.failure ?? mapToSemanticBatchFailure(new Error(outcome.reason), batchIndex, batch.map(p => p.subject.id));
        failures.push(failure);
        this.store.recordBatchFailure(call, failure, outcome.reason, Date.now() - started);
        continue;
      }
      try {
        // One result per batch; cache identity includes its exact submitted passage set.
        this.store.complete(call, { schema_version: 1, id: randomUUID(), job_id: op.job_id, input_snapshot_id: op.input_snapshot_id,
          input_fingerprint: ctx.captured.input.fingerprint, candidate_fingerprint: ctx.candidateFingerprint,
          cache_key: batch.length === 1 ? this.cacheKey(ctx, batch[0]) : fingerprint(canonical(batch.map(p => this.cacheKey(ctx, p)))),
          head_revision: 0, passages: outcome.passages.map(p => ({ ...p, claims: p.claims.map(c => ({ ...c,
            claim: { ...c.claim, id: fingerprint(canonical([p.subject.id, c.claim.start, c.claim.end, c.claim.fact])) } })) })),
          configuration_key: ctx.configurationKey, policy_version: C.SEMANTIC_VERSION,
          evidence_set_fingerprint: ctx.evidenceFingerprint, clarification_fingerprints: [], provenance: 'model', recorded_at: new Date().toISOString() }, Date.now() - started);
        batchesSucceeded++;
      } catch (e) {
        batchesFailed++;
        const failure = mapToSemanticBatchFailure(e, batchIndex, batch.map(p => p.subject.id));
        failures.push(failure);
        this.store.recordBatchFailure(call, failure, e instanceof Error ? e.message : 'Result superseded', Date.now() - started);
        continue;
      }
    }
    if (failures.length > 0) {
      const summaryReason = failures.map(f => `Batch ${f.batch_index ?? '?'}: ${f.safe_diagnostic}`).join('; ');
      this.store.finish(op.id, op.job_id, summaryReason, failures, batchesSucceeded, batchesFailed);
    } else {
      this.store.finish(op.id, op.job_id, undefined, undefined, batchesSucceeded, 0);
    }
  }
  clarify(jobId: string, request: C.SaveFactClarification): C.JobFacts {
    return this.jobs.withReceipt('fact_clarification', `${jobId}:${request.idempotency_key}`, request, () => this.saveClarification(jobId, request)).result;
  }
  private saveClarification(jobId: string, request: C.SaveFactClarification): C.JobFacts {
    const read = this.read(jobId, request.target), ctx = this.context(jobId, request.target);
    const sharedCorrection = request.supersedes_shared ? read.shared_clarifications?.find(c => c.update_id === request.supersedes_shared) : undefined;
    if (request.supersedes_shared && (request.reuse !== 'project' || request.kind !== 'correction' || !sharedCorrection
      || !C.sameFact(sharedCorrection.clarification.fact, request.fact)
      || sharedCorrection.clarification.assertion !== request.corrected_assertion))
      throw new RepositoryError('invalid_relationship', 'Identify the active shared answer being corrected and preserve its exact previous answer.');
    if (!ctx.inputCurrent || request.input_fingerprint !== read.input_fingerprint) this.fail('Inputs changed. Review current inputs.');
    const selected = read.facts.filter(f => request.claim_ids.includes(f.claim.id));
    if (selected.length !== new Set(request.claim_ids).size || !selected.every(f => C.sameFact(f.claim.fact, request.fact))) throw new RepositoryError('invalid_relationship', 'Select facts about the same work and exact claim scope.');
    if (selected.some(f => f.state === 'contradicted') && request.kind !== 'correction') throw new RepositoryError('ineligible', 'Record a dated correction to resolve contradictory evidence.');
    if (request.source_ids.some(id => !ctx.sources.some(s => s.evidence_id === id))) throw new RepositoryError('invalid_relationship', 'Use captured sources for this job.');
    if (request.supporting_quotes?.some(q => !request.source_ids.includes(q.evidence_id) || !ctx.sources.some(s =>
      s.evidence_id === q.evidence_id && s.evidence_fingerprint === q.evidence_fingerprint && s.field === q.field
      && q.start >= s.start && q.end <= s.start + s.text.length && s.text.slice(q.start - s.start, q.end - s.start) === q.quote)))
      throw new RepositoryError('invalid_relationship', 'The selected quotation must match captured evidence exactly.');
    if (request.kind === 'correction' && !sharedCorrection && !selected.every(f => f.state !== 'contradicted' || (f.evidence.every(q => request.source_ids.includes(q.evidence_id)) && f.evidence.some(q => q.quote.includes(request.corrected_assertion ?? '\0')))))
      throw new RepositoryError('invalid_relationship', 'Identify the contradictory source assertion being corrected.');
    const value = C.ClarificationSchema.parse({ schema_version: 1, id: randomUUID(), job_id: jobId, input_snapshot_id: ctx.captured.input.id,
      revision: 0, kind: request.kind, fact: request.fact, claim_ids: request.claim_ids, question: selected.map(f => f.question ?? f.claim.text).join('\n'),
      assertion: request.assertion, actor: 'local-human', recorded_at: new Date().toISOString(), source_ids: request.source_ids,
      supersedes: this.store.clarifications(jobId, ctx.captured.input.id).some(c => c.id === request.supersedes) ? request.supersedes : null, corrected_assertion: request.corrected_assertion, effective_date: request.effective_date,
      supporting_quotes: request.supporting_quotes, confirmed: request.confirmed, confirmed_claims: selected.map(f => f.claim.text) });
    this.jobs.database.db.transaction(() => {
      const saved = this.store.clarify(value, request.expected_semantic_revision, request.expected_job_revision, request.idempotency_key);
      if (request.reuse === 'project' && request.confirmed === true) {
        const corpus = new CorpusRepository(this.jobs);
        // A replay must not create another shared revision.
        if (corpus.snapshot().updates.some(u => u.change.kind === 'clarification' && u.change.value.clarification.id === saved.id)) return;
        if (request.expected_corpus_revision === undefined) this.fail('Reload shared answers before saving project knowledge.');
        const quotes = [...(request.supporting_quotes ?? []), ...selected.flatMap(f => f.evidence)];
        const sources = quotes.map(q => ({ evidence_id: q.evidence_id, evidence_fingerprint: q.evidence_fingerprint, quote: q.quote }));
        if (!sources.length) throw new RepositoryError('invalid_relationship', 'Select supporting evidence before sharing this answer. You can save it for this job without evidence.');
        const feedback: C.FeedbackEvent = { schema_version: 1, id: randomUUID(), workspace_id: ctx.job.workspace_id, job_id: jobId,
          proposal_id: null, review_revision: null, kind: 'fact', before: request.corrected_assertion ?? '', after: request.assertion,
          explanation: saved.question, scope: { kind: 'project', key: saved.fact.work_id }, recorded_by: 'local-human', recorded_at: saved.recorded_at };
        corpus.apply(feedback, { kind: 'clarification', value: { scope: { kind: 'project', key: saved.fact.work_id },
          clarification: saved, sources, explanation: saved.question } }, request.expected_corpus_revision!, request.supersedes_shared ?? null);
      }
    }).immediate();
    return this.read(jobId, request.target);
  }
  async dispose() { this.disposed = true; for (const r of this.running.values()) r.controller.abort(); await Promise.allSettled([...this.running.values()].map(r => r.promise)); }
}
