import { randomUUID } from 'node:crypto';
import * as C from '@featherduster/core';
import { SemanticRepository, type SemanticOperation } from './semantic-repository.js';
import { JobArtifactsService } from './artifacts.js';
import { ProposalRepository } from './proposal-repository.js';
import { JobsRepository, RepositoryError } from './repository.js';
import { fingerprint } from './files.js';
import { canonicalResumeValue as canonical } from './resume-context.js';
import { sourceFingerprint } from '../corpus/load.js';
import type { ModelRunner } from '../runners/types.js';
import { classifyBatch, semanticPrompt, SEMANTIC_SYSTEM, SEMANTIC_PROMPT_HASH } from './semantic-classifier.js';
import { SEMANTIC_SUITE_VERSION, semanticConfigurationKey } from './semantic-evaluation.js';
export { SEMANTIC_SUITE_VERSION } from './semantic-evaluation.js';
export interface SemanticDependencies {
  runner(settings: { runner: string; model: string }): ModelRunner | null;
  consent(runner: ModelRunner): boolean;
  timeoutMs(): number;
  currentRules?(): C.PrivacyRulesConfig;
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
      const proposal = proposals.find(proposal => proposal.decision !== 'rejected' && (proposal.edited_after ?? proposal.after) === p.text);
      return proposal ? { ...p, inherited: false, subject: { ...p.subject, proposal_id: proposal.id } } : p;
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
    const clarifications = this.store.clarifications(jobId, input.id);
    const evaluated = this.store.evaluation(ctx.configurationKey, SEMANTIC_SUITE_VERSION)?.passed === true;
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
        const machine = valid && c.state === 'supported' && c.evidence.length > 0;
        return { ...c, evidence: [...c.evidence, ...(human?.supporting_quotes ?? [])], state: valid ? c.state : 'unavailable', passage: p,
          resolution: human ? { provenance: 'human' as const, explanation: human.assertion }
            : machine ? { provenance: 'model' as const, explanation: c.explanation } : null };
      });
    });
    const latest = this.jobs.database.db.prepare('SELECT payload FROM semantic_operations WHERE job_id=? AND target_fingerprint=? ORDER BY sequence DESC LIMIT 1').get(jobId, ctx.candidateFingerprint) as { payload: string } | undefined;
    const storedOperation = latest ? JSON.parse(latest.payload) as SemanticOperation : undefined;
    const operation = storedOperation ? this.operation(jobId, storedOperation.id) : undefined;
    return { job_id: jobId, job_revision: ctx.job.revision, input_fingerprint: input.fingerprint, semantic_revision: this.store.head(jobId),
      target: ctx.target, candidate_fingerprint: ctx.candidateFingerprint, facts, clarifications, sources: ctx.sources,
      support_fingerprint: fingerprint(canonical({ facts: facts.map(f => [f.claim, f.evidence, f.resolution]), input: input.fingerprint, evidence: ctx.evidenceFingerprint, configuration: ctx.configurationKey, policy: C.SEMANTIC_VERSION })),
      execution: facts.every(f => f.resolution) ? 'complete' : operation?.state ?? 'unchecked', ...(operation?.reason ? { reason: operation.reason } : {}),
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
    return { revision: this.store.head(jobId), configuration_key: ctx.configurationKey,
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
      if (!lease || lease.expires_at <= new Date().toISOString()) return { operation_id: op.id, state: 'unavailable' as const, reason: 'The previous check was interrupted. Retry explicitly or review facts manually.' };
    }
    return { operation_id: op.id, state: op.state, reason: op.reason };
  }
  private async execute(op: SemanticOperation, ctx: ReturnType<SemanticService['context']>, signal: AbortSignal) {
    if (!ctx.runner) throw Error('Configured runner is unavailable. Review facts manually.');
    if (ctx.runner.locality === 'cloud' && !this.deps.consent(ctx.runner)) throw Error('Cloud runner consent is required. Review facts manually or configure consent.');
    const existing = this.store.results(op.job_id, op.input_snapshot_id);
    const uncached = ctx.passages.filter(p => !existing.some(r => r.configuration_key === ctx.configurationKey
      && r.policy_version === C.SEMANTIC_VERSION && r.evidence_set_fingerprint === ctx.evidenceFingerprint
      && r.input_fingerprint === ctx.captured.input.fingerprint && r.passages.some(v => v.subject.id === p.subject.id && v.subject.passage_fingerprint === p.subject.passage_fingerprint)));
    for (let offset = 0; offset < uncached.length; offset += C.SEMANTIC_LIMITS.passages) {
      if (signal.aborted) throw Error('Classification cancelled.');
      if (ctx.runner.locality === 'cloud' && !this.deps.consent(ctx.runner)) throw Error('Cloud runner consent changed. Review facts manually.');
      if (this.deps.currentRules && canonical(C.PrivacyRulesConfigSchema.parse(this.deps.currentRules())) !== canonical(ctx.rules))
        throw Error('Privacy rules changed. Review current inputs before checking evidence.');
      const batch = uncached.slice(offset, offset + C.SEMANTIC_LIMITS.passages);
      const ranked = C.discoverEvidence(batch.map(p => p.text).join('\n'), ctx.sources.map((s, i) => ({ id: String(i), fingerprint: s.evidence_fingerprint, work_id: s.work_id, text: s.text, retracted: false })));
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
      const call = this.store.reserve(op.id, Math.min(60000, this.deps.timeoutMs()) + 10000), started = Date.now();
      const outcome = await classifyBatch(ctx.runner, { subjects: batch, sources, configuration_key: ctx.configurationKey,
        configuredStepTimeoutMs: this.deps.timeoutMs(), coverage: { searched_source_count: ctx.captured.evidence.getAll().length,
          omitted_source_ids: [...new Set(ctx.sources.filter(s => !sources.includes(s)).map(s => s.evidence_id))], truncated: sources.length !== ctx.sources.length } }, signal);
      if (outcome.status === 'unavailable') { this.store.failCall(call, outcome.reason, Date.now() - started); return; }
      try {
        // One result per batch; cache identity includes its exact submitted passage set.
        this.store.complete(call, { schema_version: 1, id: randomUUID(), job_id: op.job_id, input_snapshot_id: op.input_snapshot_id,
          input_fingerprint: ctx.captured.input.fingerprint, candidate_fingerprint: ctx.candidateFingerprint,
          cache_key: batch.length === 1 ? this.cacheKey(ctx, batch[0]) : fingerprint(canonical(batch.map(p => this.cacheKey(ctx, p)))),
          head_revision: 0, passages: outcome.passages.map(p => ({ ...p, claims: p.claims.map(c => ({ ...c,
            claim: { ...c.claim, id: fingerprint(canonical([p.subject.id, c.claim.start, c.claim.end, c.claim.fact])) } })) })),
          configuration_key: ctx.configurationKey, policy_version: C.SEMANTIC_VERSION,
          evidence_set_fingerprint: ctx.evidenceFingerprint, clarification_fingerprints: [], provenance: 'model', recorded_at: new Date().toISOString() }, Date.now() - started);
      } catch (e) { this.store.failCall(call, e instanceof Error ? e.message : 'Result superseded', Date.now() - started); return; }
    }
    this.store.finish(op.id, op.job_id);
  }
  clarify(jobId: string, request: C.SaveFactClarification): C.JobFacts {
    const read = this.read(jobId, request.target), ctx = this.context(jobId, request.target);
    if (!ctx.inputCurrent || request.input_fingerprint !== read.input_fingerprint) this.fail('Inputs changed. Review current inputs.');
    const selected = read.facts.filter(f => request.claim_ids.includes(f.claim.id));
    if (selected.length !== new Set(request.claim_ids).size || !selected.every(f => C.sameFact(f.claim.fact, request.fact))) throw new RepositoryError('invalid_relationship', 'Select facts about the same work and exact claim scope.');
    if (selected.some(f => f.state === 'contradicted') && request.kind !== 'correction') throw new RepositoryError('ineligible', 'Record a dated correction to resolve contradictory evidence.');
    if (request.source_ids.some(id => !ctx.sources.some(s => s.evidence_id === id))) throw new RepositoryError('invalid_relationship', 'Use captured sources for this job.');
    if (request.supporting_quotes?.some(q => !request.source_ids.includes(q.evidence_id) || !ctx.sources.some(s =>
      s.evidence_id === q.evidence_id && s.evidence_fingerprint === q.evidence_fingerprint && s.field === q.field
      && q.start >= s.start && q.end <= s.start + s.text.length && s.text.slice(q.start - s.start, q.end - s.start) === q.quote)))
      throw new RepositoryError('invalid_relationship', 'The selected quotation must match captured evidence exactly.');
    if (request.kind === 'correction' && !selected.every(f => f.state !== 'contradicted' || (f.evidence.every(q => request.source_ids.includes(q.evidence_id)) && f.evidence.some(q => q.quote.includes(request.corrected_assertion ?? '\0')))))
      throw new RepositoryError('invalid_relationship', 'Identify the contradictory source assertion being corrected.');
    this.store.clarify(C.ClarificationSchema.parse({ schema_version: 1, id: randomUUID(), job_id: jobId, input_snapshot_id: ctx.captured.input.id,
      revision: 0, kind: request.kind, fact: request.fact, claim_ids: request.claim_ids, question: selected.map(f => f.question ?? f.claim.text).join('\n'),
      assertion: request.assertion, actor: 'local-human', recorded_at: new Date().toISOString(), source_ids: request.source_ids,
      supersedes: request.supersedes, corrected_assertion: request.corrected_assertion, effective_date: request.effective_date,
      supporting_quotes: request.supporting_quotes, confirmed: request.confirmed }),
      request.expected_semantic_revision, request.expected_job_revision, request.idempotency_key);
    return this.read(jobId, request.target);
  }
  async dispose() { this.disposed = true; for (const r of this.running.values()) r.controller.abort(); await Promise.allSettled([...this.running.values()].map(r => r.promise)); }
}
