import { randomUUID } from 'node:crypto';
import yaml from 'js-yaml';
import { z } from 'zod';
import * as C from '@featherduster/core';
import type { ModelRunner } from '../runners/types.js';
import type { LatexRenderer } from '../render/latex-renderer.js';
import { loadTailoringSkill } from '../tailoring/skill-text.js';
import { JobDraftRepository } from '../tailoring/drafts/repository.js';
import { getLatexTemplate } from './templates.js';
import { JobArtifactsService } from './artifacts.js';
import { fingerprint } from './files.js';
import { JobsRepository, type OwnershipFence } from './repository.js';

export const attemptFence = (a: C.Attempt): OwnershipFence => ({ attempt_id: a.id, owner_token: a.owner_token, stop_generation: a.stop_generation });
export class PreparationBlocked extends Error {}
/** Stops logical execution even when a provider ignores cancellation; late rejections are observed. */
export function abortable<T>(work: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise((resolve, reject) => {
    const abort = () => reject(signal.reason ?? new Error('Aborted'));
    signal.addEventListener('abort', abort, { once: true });
    work.then(resolve, reject).finally(() => signal.removeEventListener('abort', abort));
    if (signal.aborted) abort();
  });
}
const renderedSchema = z.object({
  source: z.string().min(1), pdf: z.string().min(1), previews: z.array(z.string().min(1)).min(1),
  report: z.object({ passed: z.literal(true), pageCount: z.number().int().positive(), pageBudget: z.number().int().positive(), coverage: z.number(), missingFragments: z.array(z.string()), diagnostics: z.array(z.object({ code: z.string(), message: z.string() })) }),
});
const deslopSchema = z.object({ candidate: C.ResumeSpecSchema, edits: z.array(z.object({ path: z.string(), before: z.string(), after: z.string(), fixes: z.array(z.string()) })), issues: z.array(C.ValidationIssueSchema) });
export interface PreparationDependencies {
  repository: JobsRepository;
  artifacts: JobArtifactsService;
  resolveRunner(settings: { runner: string; model: string }): ModelRunner | null;
  hasConsent(runner: ModelRunner): boolean;
  renderer: Pick<LatexRenderer, 'preflight' | 'renderPdf'>;
}
export class JobPreparation {
  constructor(private readonly deps: PreparationDependencies) {}
  async run(attempt: C.Attempt, signal: AbortSignal, previousAttemptId?: string): Promise<void> {
    const { repository: r, artifacts, renderer } = this.deps;
    const fence = attemptFence(attempt);
    const guard = () => { signal.throwIfAborted(); if (!r.isAttemptCurrent(fence)) throw new Error('Ownership lost'); };
    guard();
    const input = artifacts.getInputSnapshot(attempt.input_snapshot_id);
    const read = (ref: C.ImmutableReference) => r.database.files.readSnapshot(ref, input.job_id, input.id).toString();
    const base = C.ResumeSpecSchema.parse(yaml.load(read(input.base_resume)));
    const rules = C.PrivacyRulesConfigSchema.parse(JSON.parse(read(input.privacy_rules)));
    const template = C.LatexTemplateProfileSchema.parse(JSON.parse(read(input.template)));
    if (JSON.stringify(template) !== JSON.stringify(getLatexTemplate(template.id))) throw new PreparationBlocked('Template is not an installed trusted profile');
    if (input.policy.mode !== 'candidate' || template.page_budget !== input.policy.page_budget) throw new PreparationBlocked('Select candidate mode and a matching template page budget');
    const settings = z.object({ runner: z.string(), model: z.string() }).parse(JSON.parse(read(input.runner_configuration)));
    const runner = this.deps.resolveRunner(settings);
    if (!runner || runner.model !== settings.model || runner.id !== settings.runner) throw new PreparationBlocked('Saved runner/model is unavailable');
    const consent = () => { if (runner.locality === 'cloud' && !this.deps.hasConsent(runner)) throw new PreparationBlocked('Cloud runner consent required'); };
    consent();
    const detection = await abortable(runner.detect(), signal); guard();
    if (!detection.available) throw new PreparationBlocked(detection.detail);
    const tools = await abortable(renderer.preflight(template.id, signal), signal); guard();
    if (!tools.available) throw new PreparationBlocked(tools.diagnostics.map(d => d.message).join('; '));
    const evidence = new C.EvidenceStore();
    for (const ref of input.selected_evidence) {
      const text = read(ref);
      const entries = text.trimStart().startsWith('---') ? [C.parseEvidenceMarkdown(text)] : C.parseEvidenceLedger(text);
      for (const entry of entries) evidence.add(entry);
    }
    const all = evidence.getAll();
    const posting = r.getPostingSnapshot(input.posting.id).text;
    const skill = loadTailoringSkill(r.database.files.workspace);
    const opts = { locality: runner.locality, rules, evidenceIds: all.map(e => e.id) };
    let prefix = true;
    let old: C.Checkpoint[] = [];
    if (previousAttemptId) {
      const prior = r.getAttempt(previousAttemptId);
      if (prior.job_id !== attempt.job_id || prior.workspace_id !== attempt.workspace_id) throw new Error('Checkpoint job mismatch');
      if (prior.input_snapshot_id === input.id) old = r.listCheckpoints(prior.id);
    }
    const stage = async <T>(name: C.PreparationStage, schema: z.ZodType<T, z.ZodTypeDef, unknown>, execute: () => Promise<T>): Promise<T> => {
      guard(); r.recordAttemptProgress(fence, { stage: name });
      const cp = prefix ? old.find(c => c.completed_stage === name) : undefined;
      let data: T;
      if (cp) {
        if (cp.input_fingerprint !== input.fingerprint || cp.output_references.length !== 1) throw new Error('Invalid checkpoint binding');
        const bytes = r.database.files.readArtifact(cp.output_references[0]!, attempt.job_id);
        if (fingerprint(bytes) !== cp.output_fingerprint) throw new Error('Checkpoint fingerprint mismatch');
        const envelope = z.object({ schema_version: z.literal(1), stage: z.literal(name), input_fingerprint: z.literal(input.fingerprint), data: schema }).parse(JSON.parse(bytes.toString()));
        data = envelope.data as T;
      } else { prefix = false; data = schema.parse(await execute()); }
      guard();
      r.database.db.transaction(() => {
        guard();
        const id = randomUUID();
        const bytes = JSON.stringify({ schema_version: 1, stage: name, input_fingerprint: input.fingerprint, data });
        const ref = { id: `${r.database.files.bundlePath('artifacts', attempt.job_id, id)}/checkpoint.json`, fingerprint: fingerprint(bytes) };
        r.database.files.writeBundle('artifacts', attempt.job_id, id, { 'checkpoint.json': bytes });
        r.saveCheckpoint({ schema_version: 1, id, workspace_id: attempt.workspace_id, job_id: attempt.job_id, attempt_id: attempt.id, completed_stage: name, input_fingerprint: input.fingerprint, output_fingerprint: ref.fingerprint, output_references: [ref], completed_at: new Date().toISOString() }, fence);
      }).immediate();
      return data;
    };
    const model = async <T>(name: C.TailoringStep, prompt: string, schema: z.ZodType<T, z.ZodTypeDef, unknown>): Promise<T> => {
      for (let retry = 0; ; retry++) {
        guard(); consent();
        r.recordAttemptProgress(fence, { model_calls: 1, repair_attempts: retry ? 1 : 0 });
        const raw = await abortable(runner.run({ system: C.buildSystemPrompt(skill.skill, name), prompt, schema: C.STEP_JSON_SCHEMAS[name], signal, transportRetryCount: 0, onProgress: () => {} }), signal);
        guard(); const parsed = schema.safeParse(raw);
        if (parsed.success) return parsed.data;
        if (retry >= input.policy.model_retry_count) throw new Error('Model output did not match the stage schema');
        prompt += '\nReturn corrected JSON matching the schema.';
      }
    };
    await stage('preflight', z.literal(true), async () => true);
    const analysis = await stage('analysis', C.JobAnalysisSchema, async () => C.validateAnalysis(await model('analysis', C.buildAnalysisPrompt(posting, skill.jdRubric, opts), C.JobAnalysisSchema), posting));
    const alignment = await stage('alignment', C.AlignmentMatrixSchema, async () => {
      const value = await model('alignment', C.buildAlignmentPrompt(analysis, all, base, opts), C.AlignmentMatrixSchema);
      return C.validateAlignment({ rows: value.rows.map(row => ({ ...row, candidate_confirmed: false })) }, analysis, all);
    });
    if (alignment.rows.some(row => row.issues?.some(i => i.severity === 'block'))) throw new PreparationBlocked('Resolve evidence alignment issues');
    const proposals = await stage('proposals', C.ProposalSetSchema, async () => {
      const value = await model('proposals', C.buildProposalsPrompt(analysis, alignment, base, all, opts), C.ProposalSetSchema);
      const fresh = value.proposals.map(p => ({ ...p, decision: 'pending' as const, edited_after: undefined, checks: [] }));
      const validated = C.applyCandidateProposals(base, fresh, { analysis, alignment, evidence: all });
      if (!validated.valid) throw new PreparationBlocked(validated.issues.filter(i => i.severity === 'block').map(i => i.message).join('; '));
      return { proposals: validated.proposals };
    });
    const applied = C.applyCandidateProposals(base, proposals.proposals, { analysis, alignment, evidence: all });
    if (!applied.valid) throw new PreparationBlocked(applied.issues.filter(i => i.severity === 'block').map(i => i.message).join('; '));
    await stage('brief', C.DefensibilityBriefSchema, () => model('brief', C.buildBriefPrompt(analysis, alignment, applied.proposals.filter(p => applied.appliedProposalIds.includes(p.id)), all, opts), C.DefensibilityBriefSchema));
    const cleaned = await stage('deslop', deslopSchema, async () => C.deslopCandidate(applied.candidate));
    if (cleaned.issues.some(i => i.severity === 'block')) throw new PreparationBlocked('Candidate editorial checks blocked publication');
    const compiled = await stage('compile', renderedSchema, async () => {
      const result = await abortable(renderer.renderPdf({ templateId: template.id, spec: cleaned.candidate, rules, signal }), signal); guard();
      if (result.status === 'blocked') throw new PreparationBlocked(result.diagnostics.map(d => d.message).join('; '));
      if (result.status !== 'passed') throw new Error(result.diagnostics.map(d => d.message).join('; ') || 'PDF validation failed');
      return renderedSchema.parse({ source: result.source, pdf: result.pdf?.toString('base64'), previews: result.previews.map(p => p.bytes.toString('base64')), report: result.report });
    });
    await stage('verify', z.literal(true), async () => {
      if (compiled.report.pageCount > input.policy.page_budget || compiled.report.pageBudget !== input.policy.page_budget || !Buffer.from(compiled.pdf, 'base64').length || compiled.previews.some(p => !Buffer.from(p, 'base64').length)) throw new Error('Invalid PDF/page budget');
      return true;
    });
    guard();
    r.database.db.transaction(() => {
      guard(); const now = new Date().toISOString();
      const draft = new JobDraftRepository(r).create({ schema_version: 1, id: randomUUID(), workspace_id: attempt.workspace_id, job_id: attempt.job_id, revision: 0, input_snapshot_id: input.id, parent_artifact_version_id: null, candidate: cleaned.candidate, proposals: { proposals: applied.proposals }, created_at: now, updated_at: now });
      artifacts.publishCandidate({ draft_id: draft.id, expected_draft_revision: draft.revision, fence, source: compiled.source, pdf: Buffer.from(compiled.pdf, 'base64'), previews: compiled.previews.map(p => Buffer.from(p, 'base64')), validation_report: JSON.stringify(compiled.report), validation_result: 'passed' });
    }).immediate();
  }
}
