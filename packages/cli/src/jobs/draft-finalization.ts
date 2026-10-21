import * as C from '@featherduster/core';
import { JobArtifactsService } from './artifacts.js';
import { JobsRepository, RepositoryError } from './repository.js';
import { fingerprint } from './files.js';
import { sourceFingerprint } from '../corpus/load.js';
import { claimFingerprint } from './proposal-service.js';
import { currentResumeContext, canonicalResumeValue as canonical, type SelectResumeEvidence } from './resume-context.js';
import { checkedRender, type CheckedPdf } from './checked-render.js';
import type { LatexRenderer } from '../render/latex-renderer.js';
import type { SemanticService } from './semantic-service.js';
type Cached = { result: C.JobDraftCheck; output?: CheckedPdf; expires: number; bytes: number };
export class JobDraftFinalization {
  private cache = new Map<string, Cached>();
  private running = new Map<string, AbortController>();
  private operations = new Set<Promise<unknown>>();
  private renderControllers = new Set<AbortController>();
  private closed = false;
  constructor(private r: JobsRepository, private artifacts: JobArtifactsService,
    private select: SelectResumeEvidence, private rules: () => C.PrivacyRulesConfig,
    private renderer: Pick<LatexRenderer, 'renderPdf'>, private semantic?: SemanticService) {}
  private context(jobId: string, draftId: string, candidate: C.ResumeSpec) {
    const draft = this.r.getLatestDraft(draftId);
    if (draft.job_id !== jobId || !draft.parent_artifact_version_id) throw new RepositoryError('invalid_relationship', 'Select a job-linked draft.');
    const ctx = currentResumeContext(this.r, this.artifacts, jobId, draft.parent_artifact_version_id, this.select, this.rules);
    if (draft.input_snapshot_id !== ctx.context.input.id) throw new RepositoryError('invalid_relationship', 'Draft inputs changed.');
    const semantic = this.semantic?.support(jobId, draft.input_snapshot_id, candidate, draft.proposals.proposals, { kind: 'draft', draft_id: draftId, candidate });
    const binding: C.DraftBinding = { candidate_fingerprint: fingerprint(canonical(candidate)),
      context_fingerprint: semantic ? fingerprint(canonical([ctx.contextFingerprint, semantic.fingerprint])) : ctx.contextFingerprint, input_snapshot_id: ctx.context.input.id,
      input_fingerprint: ctx.context.input.fingerprint, parent_artifact_id: ctx.artifact.id,
      parent_artifact_fingerprint: ctx.artifact.version_fingerprint };
    return { ...ctx, draft, binding, semantic };
  }
  private key(jobId: string, draftId: string, binding: C.DraftBinding) { return canonical({ jobId, draftId, binding }); }
  private prune() {
    for (const [key, v] of this.cache) if (v.expires <= Date.now()) this.cache.delete(key);
    while (this.cache.size > 8 || [...this.cache.values()].reduce((n, v) => n + v.bytes, 0) > 32 * 1024 * 1024) {
      this.cache.delete(this.cache.keys().next().value!);
    }
  }
  private supports(ctx: ReturnType<JobDraftFinalization['context']>) {
    const review = this.artifacts.attemptReview(ctx.artifact.attempt_id);
    const proposals = ctx.draft.proposals.proposals.filter(p => p.decision !== 'rejected');
    const supportFor = (p: C.Proposal): C.SkillSupport[] => {
      const groundings = (review?.groundings ?? []).filter(g => g.proposal_id === p.id && g.claim_fingerprint === claimFingerprint(p)
        && C.containsTerm(p.edited_after ?? p.after, g.term) && g.sources.every(s => {
          const record = ctx.context.evidence.get(s.evidence_id);
          return p.citations.includes(s.evidence_id) && !!record && record.confidence !== 'retracted'
            && sourceFingerprint(record) === s.evidence_fingerprint
            && [record.title, record.summary, record.impact, record.narrative].some(t => t.includes(s.quote));
        }));
      return [...ctx.context.skillSupport, ...groundings.map(g => ({ skill: g.term, facet: g.term, permitted_terms: [g.term],
        support: 'direct' as const, scope: { kind: 'job' as const, key: ctx.job.id }, sources: g.sources, explanation: g.explanation }))];
    };
    return { proposals, supportFor };
  }
  private track<T>(work: () => Promise<T>): Promise<T> {
    if (this.closed) return Promise.reject(new RepositoryError('ineligible', 'Resume checker is shutting down.'));
    const promise = Promise.resolve().then(work);
    this.operations.add(promise);
    void promise.then(() => this.operations.delete(promise), () => this.operations.delete(promise));
    return promise;
  }
  check(jobId: string, draftId: string, raw: C.ResumeSpec): Promise<C.JobDraftCheck> {
    return this.track(() => this.checkNow(jobId, draftId, raw));
  }
  private async render(request: Parameters<LatexRenderer['renderPdf']>[0], budget: number) {
    const controller = new AbortController(); this.renderControllers.add(controller);
    const timeout = setTimeout(() => controller.abort(Error('PDF check timed out. Retry.')), 60000);
    try { return await checkedRender(this.renderer, { ...request, signal: controller.signal }, budget); }
    finally { clearTimeout(timeout); this.renderControllers.delete(controller); }
  }
  private async checkNow(jobId: string, draftId: string, raw: C.ResumeSpec): Promise<C.JobDraftCheck> {
    if (this.closed) throw new RepositoryError('ineligible', 'Resume checker is shutting down. Retry after reconnecting.');
    const candidate = C.DraftResumeSpecSchema.parse(raw), ctx = this.context(jobId, draftId, candidate);
    const key = this.key(jobId, draftId, ctx.binding); this.prune();
    const hit = this.cache.get(key);
    if (hit) return { ...hit.result, job_revision: ctx.job.revision };
    if (this.running.has(draftId)) throw new RepositoryError('ineligible', 'A resume check is still running. Retry when it finishes.');
    const controller = new AbortController(); this.running.set(draftId, controller);
    const timeout = setTimeout(() => controller.abort(Error('PDF check timed out. Retry.')), 60000);
    try {
      const parent = this.artifacts.review(jobId, ctx.artifact.id), { proposals, supportFor } = this.supports(ctx);
      if (!parent.analysis || !parent.alignment) throw new RepositoryError('ineligible', 'The preparation context is unavailable. Review job inputs.');
      const issues = C.checkCandidateFields(candidate, proposals, { baseResume: parent.base_resume,
        analysis: parent.analysis, alignment: parent.alignment, evidence: ctx.context.evidence.getAll(), skillSupport: ctx.context.skillSupport, semanticSupport: ctx.semantic?.support }, ctx.rules, supportFor);
      let output: CheckedPdf | undefined;
      let status: C.JobDraftCheck['status'] = issues.some(i => i.severity === 'block') ? 'blocked' : 'ready';
      if (status === 'ready') {
        const rendered = await this.render({ templateId: ctx.template.id, spec: candidate, rules: ctx.rules }, ctx.context.input.policy.page_budget);
        issues.push(...rendered.issues); status = rendered.status; output = rendered.output;
      }
      if (this.closed) throw new RepositoryError('ineligible', 'Resume checker is shutting down.');
      const fresh = this.context(jobId, draftId, candidate);
      if (canonical(fresh.binding) !== canonical(ctx.binding)) throw new RepositoryError('revision_conflict', 'Inputs changed during checking. Check again.');
      const result: C.JobDraftCheck = { binding: ctx.binding, job_revision: fresh.job.revision, status, issues };
      if (status !== 'unavailable' && !controller.signal.aborted && !this.closed) {
        this.cache.set(key, { result, output, expires: Date.now() + 300000, bytes: Buffer.byteLength(JSON.stringify({ result, output })) });
        this.prune();
      }
      return result;
    } finally { clearTimeout(timeout); this.running.delete(draftId); }
  }
  finalize(jobId: string, draftId: string, raw: C.FinalizeJobDraftRequest, publicationGuard?: () => void): Promise<{ artifact: C.ArtifactVersion }> {
    return this.track(() => this.finalizeNow(jobId, draftId, raw, publicationGuard));
  }
  private async finalizeNow(jobId: string, draftId: string, raw: C.FinalizeJobDraftRequest, publicationGuard?: () => void): Promise<{ artifact: C.ArtifactVersion }> {
    const request = C.FinalizeJobDraftRequestSchema.parse(raw);
    const { idempotency_key, ...body } = request, receiptInput = { jobId, draftId, ...body };
    // Probe the durable receipt before requiring a still-current parent. A replay is allowed after publication.
    const absent = Symbol('absent');
    try { return this.r.withReceipt('finalize_job_draft', idempotency_key, receiptInput, () => { throw absent; }).result as { artifact: C.ArtifactVersion }; }
    catch (e) { if (e !== absent) throw e; }
    const saved = this.r.getLatestDraft(draftId), ctx = this.context(jobId, draftId, saved.candidate);
    if (ctx.job.revision !== request.expected_job_revision || saved.revision !== request.expected_draft_revision
      || canonical(ctx.binding) !== canonical(request.binding)) throw new RepositoryError('revision_conflict', 'The saved draft or its inputs changed. Check again.');
    const checked = await this.checkNow(jobId, draftId, saved.candidate);
    if (checked.status !== 'ready') throw new RepositoryError('ineligible', 'Resolve the current resume checks before finalizing.');
    let output = this.cache.get(this.key(jobId, draftId, checked.binding))?.output;
    // Large PDFs may intentionally exceed the cache budget. Re-render without requiring an unbounded cache.
    if (!output) {
      const rendered = await this.render({ templateId: ctx.template.id, spec: saved.candidate, rules: ctx.rules }, ctx.context.input.policy.page_budget);
      if (rendered.status !== 'ready' || !rendered.output) throw new RepositoryError('ineligible', rendered.issues.map(i => i.message).join('; '));
      output = rendered.output;
    }
    if (this.closed) throw new RepositoryError('ineligible', 'Resume checker is shutting down.');
    const verified = output;
    return this.r.withReceipt('finalize_job_draft', idempotency_key, receiptInput, () => {
      publicationGuard?.();
      const fresh = this.context(jobId, draftId, this.r.getLatestDraft(draftId).candidate);
      if (canonical(fresh.binding) !== canonical(request.binding)) throw new RepositoryError('revision_conflict', 'The checked content changed. Check again.');
      const artifact = this.artifacts.publishManualCandidate({ draft_id: draftId,
        expected_draft_revision: request.expected_draft_revision, expected_job_revision: request.expected_job_revision,
        parent_artifact_id: request.binding.parent_artifact_id, parent_artifact_fingerprint: request.binding.parent_artifact_fingerprint,
        source: verified.source, pdf: Buffer.from(verified.pdf, 'base64'), previews: verified.previews.map(p => Buffer.from(p, 'base64')),
        validation_report: JSON.stringify(verified.report), idempotency_key,
        semantic_binding: this.semantic?.binding(jobId, { kind: 'draft', draft_id: draftId, candidate: saved.candidate }) });
      return { artifact };
    }).result;
  }
  async dispose() {
    this.closed = true;
    for (const c of this.running.values()) c.abort(Error('Shutdown'));
    for (const c of this.renderControllers) c.abort(Error('Shutdown'));
    await Promise.allSettled([...this.operations]); this.cache.clear();
  }
}

