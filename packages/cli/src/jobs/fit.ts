import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import * as C from '@featherduster/core';
import { fingerprint } from './files.js';
import { JobsRepository, RepositoryError } from './repository.js';
import { abortable, attemptFence, PreparationBlocked, type PreparationDependencies } from './preparation.js';
import { selectJobSkillset } from './skillset.js';
import { loadTailoringSkill } from '../tailoring/skill-text.js';

const selectionSchema = z.object({ fingerprint: z.string(), provenance: z.unknown(), evidence_ids: z.array(z.string()), scope: z.object({ employer: z.string().nullable(), role: z.string().nullable() }) });
const resultSchema = z.object({ analysis: C.JobAnalysisSchema, assessment: C.FitAssessmentSchema, profile: C.CandidateProfileSchema });

/** Immutable fit captures share the worker's input/attempt/checkpoint authority,
 * but never impersonate a resume snapshot or publish a resume artifact. */
export class JobFit {
  constructor(private readonly repository: JobsRepository) {}
  capture(jobId: string, selection: ReturnType<typeof selectJobSkillset>, rules: C.PrivacyRulesConfig, runner: { runner: string; model: string }, timeout: number) {
    const r = this.repository; const job = r.getJob(jobId);
    if (!job.posting_snapshot_id) throw new RepositoryError('invalid_relationship', 'Save posting text before assessing fit');
    const posting = r.getPostingSnapshot(job.posting_snapshot_id);
    const id = randomUUID(); const parent = r.database.files.bundlePath('snapshots', jobId, id);
    const bundle: Record<string, string> = {};
    const add = (name: string, data: unknown) => {
      const bytes = JSON.stringify(data); bundle[name] = bytes;
      return { id: `${parent}/${name}`, fingerprint: fingerprint(bytes) };
    };
    const policy = { timeout_ms: timeout, max_model_calls: 2 as const, max_repair_attempts: 0 as const, model_retry_count: 0 as const };
    const metadata = {
      schema_version: 2 as const, activity: 'fit' as const, id, job_id: jobId, workspace_id: job.workspace_id, created_at: new Date().toISOString(),
      posting: { id: posting.id, fingerprint: posting.content_fingerprint },
      return_state: job.preparation_state === 'resume_ready' ? 'resume_ready' as const : job.preparation_state === 'needs_input' && job.recovery?.kind !== 'setup' ? 'needs_input' as const : 'saved' as const,
      return_missing_inputs: job.recovery?.kind === 'setup' ? [] : job.missing_inputs,
      ...(job.recovery && job.recovery.kind !== 'setup' ? { return_recovery: job.recovery } : {}),
      selected_evidence: selection.evidence.map((e, i) => add(`evidence-${i}.json`, { entry: e.entry, narrative: e.narrative })),
      selection: add('selection.json', { fingerprint: selection.fingerprint, provenance: selection.provenance, evidence_ids: selection.evidence.map(e => e.id), scope: { employer: job.employer_id, role: job.role } }),
      corpus_knowledge: add('corpus.json', selection.knowledge), privacy_rules: add('privacy.json', C.PrivacyRulesConfigSchema.parse(rules)),
      runner_configuration: add('runner.json', runner), policy, policy_fingerprint: fingerprint(JSON.stringify(policy)),
    };
    const bytes = JSON.stringify(metadata); bundle['manifest.json'] = bytes;
    const input = C.FitInputSnapshotSchema.parse({ ...metadata, fingerprint: fingerprint(bytes) });
    r.database.files.writeBundle('snapshots', jobId, id, bundle);
    return r.saveFitInputSnapshot(input);
  }
  context(id: string) {
    const r = this.repository; const input = C.FitInputSnapshotSchema.parse(r.getExecutionInput(id));
    const read = (ref: C.ImmutableReference) => JSON.parse(r.database.files.readSnapshot(ref, input.job_id, input.id).toString());
    const metadata = read({ id: `${r.database.files.bundlePath('snapshots', input.job_id, input.id)}/manifest.json`, fingerprint: input.fingerprint });
    if (JSON.stringify(C.FitInputSnapshotSchema.parse({ ...metadata, fingerprint: input.fingerprint })) !== JSON.stringify(input)) throw new Error('Fit manifest mismatch');
    const posting = r.getPostingSnapshot(input.posting.id);
    if (posting.job_id !== input.job_id || fingerprint(posting.text) !== input.posting.fingerprint || fingerprint(JSON.stringify(input.policy)) !== input.policy_fingerprint) throw new Error('Fit input binding mismatch');
    const evidence = new C.EvidenceStore();
    for (const ref of input.selected_evidence) { const record = read(ref); evidence.add(C.parseEvidenceMarkdown(C.serializeEvidenceMarkdown(record.entry, record.narrative))); }
    const knowledge = C.CorpusSnapshotSchema.parse(read(input.corpus_knowledge!));
    return { input, posting, evidence, knowledge, selection: selectionSchema.parse(read(input.selection)), rules: C.PrivacyRulesConfigSchema.parse(read(input.privacy_rules)), settings: z.object({ runner: z.string(), model: z.string() }).parse(read(input.runner_configuration)) };
  }
  async run(attempt: C.Attempt, signal: AbortSignal, deps: Pick<PreparationDependencies, 'resolveRunner' | 'hasConsent'>) {
    const r = this.repository; const fence = attemptFence(attempt);
    const guard = () => { signal.throwIfAborted(); if (!r.isAttemptCurrent(fence)) throw new Error('Ownership lost'); };
    guard(); const captured = this.context(attempt.input_snapshot_id);
    const { input, settings, posting, evidence, rules, knowledge } = captured;
    const runner = deps.resolveRunner(settings);
    if (!runner || runner.id !== settings.runner || runner.model !== settings.model) throw new PreparationBlocked('Configure the captured runner and model in Settings');
    const consent = () => { if (runner.locality === 'cloud' && !deps.hasConsent(runner)) throw new PreparationBlocked('Cloud runner consent required in Settings'); };
    consent(); const detection = await abortable(runner.detect(), signal); guard();
    if (!detection.available) throw new PreparationBlocked(detection.detail);
    const skill = loadTailoringSkill(r.database.files.workspace);
    const all = evidence.getAll();
    const opts = { locality: runner.locality, rules, skillSupport: knowledge.materialized?.support ?? [], evidenceIds: all.map(e => e.id) };
    const model = async <T>(step: 'analysis' | 'alignment', prompt: string, schema: z.ZodType<T, z.ZodTypeDef, unknown>) => {
      guard(); consent(); r.recordAttemptProgress(fence, { stage: step, model_calls: 1 });
      const raw = await abortable(runner.run({ system: C.buildSystemPrompt(skill.skill, step), prompt, schema: C.STEP_JSON_SCHEMAS[step], signal, transportRetryCount: 0, onProgress: () => {} }), signal);
      guard(); return schema.parse(raw);
    };
    const analysis = C.validateAnalysis(await model('analysis', C.buildAnalysisPrompt(posting.text, skill.jdRubric, opts), C.JobAnalysisSchema), posting.text);
    const raw = await model('alignment', C.buildAlignmentPrompt(analysis, all, null, opts), C.AlignmentMatrixSchema);
    const alignment = C.validateAlignment({ rows: raw.rows.map(row => ({ ...row, candidate_confirmed: false })) }, analysis, all);
    const now = new Date().toISOString();
    // Persist the deliberately empty preference context with the result, so its
    // profile reference is resolvable without pretending to assess preferences.
    const profile = C.CandidateProfileSchema.parse({ schema_version: 1, id: randomUUID(), workspace_id: attempt.workspace_id, revision: 0, facts: [], preferences: [], created_at: now, updated_at: now });
    const assessment = C.assessJobFit({ id: randomUUID(), job_id: attempt.job_id, workspace_id: attempt.workspace_id, posting_snapshot_id: posting.id, assessed_at: now,
      profile, analysis, alignment, evidence: all, posting_facts: {} });
    // Saved transferable/unsupported support and provisional work cannot be
    // upgraded by a model label. Literal source inspection remains available.
    assessment.rows = assessment.rows.map(row => {
      const requirement = analysis.requirements.find(q => q.id === row.requirement_id);
      const support = (knowledge.materialized?.support ?? []).filter(s =>
        s.sources.some(source => row.citations.includes(source.evidence_id)) &&
        s.permitted_terms.some(term => requirement?.terms.some(t => t.toLowerCase() === term.toLowerCase())));
      const uncertain = row.issues?.some(i => i.severity === 'block') || !requirement || requirement.ungrounded ||
        support.some(s => s.support === 'unsupported') ||
        (row.classification === 'backed' && !all.some(e => row.citations.includes(e.id) && e.confidence === 'verified' && !e.in_flight));
      const transferable = row.classification === 'backed' && support.some(s => s.support === 'transferable') && !support.some(s => s.support === 'direct');
      return { ...row, classification: uncertain ? 'gap' as const : transferable ? 'transferable' as const : row.classification,
        issues: [...(row.issues ?? []), ...(uncertain || transferable ? [{ severity: 'warn' as const, kind: 'fit_support_limit', message: 'The captured evidence or saved support does not establish verified direct experience for this requirement.' }] : [])] };
    });
    assessment.coverage = { backed: 0, transferable: 0, gap: 0 };
    for (const row of assessment.rows) assessment.coverage[row.classification]++;
    assessment.material_gap_requirement_ids = assessment.rows.filter(row => row.classification === 'gap' && analysis.requirements.some(q => q.id === row.requirement_id && q.tier === 'must' && !q.ungrounded)).map(row => row.requirement_id);
    if (assessment.coverage.gap || assessment.coverage.transferable) assessment.recommendation = 'review';
    guard();
    r.database.db.transaction(() => {
      guard(); const id = randomUUID();
      const bytes = JSON.stringify({ schema_version: 1, stage: 'fit', input_fingerprint: input.fingerprint, data: resultSchema.parse({ analysis, assessment, profile }) });
      const ref = { id: `${r.database.files.bundlePath('artifacts', attempt.job_id, id)}/fit.json`, fingerprint: fingerprint(bytes) };
      r.database.files.writeBundle('artifacts', attempt.job_id, id, { 'fit.json': bytes });
      r.saveCheckpoint({ schema_version: 1, id, workspace_id: attempt.workspace_id, job_id: attempt.job_id, attempt_id: attempt.id, completed_stage: 'fit', input_fingerprint: input.fingerprint, output_fingerprint: ref.fingerprint, output_references: [ref], completed_at: now }, fence);
    }).immediate();
  }
  read(jobId: string, currentSelection: (ids: string[]) => ReturnType<typeof selectJobSkillset>, rules: C.PrivacyRulesConfig) {
    const r = this.repository; const job = r.getJob(jobId);
    const rows = r.database.db.prepare("SELECT payload FROM attempts WHERE job_id=? AND status='completed' ORDER BY rowid DESC").all(jobId) as { payload: string }[];
    const history = rows.flatMap(row => {
      const attempt = C.AttemptSchema.parse(JSON.parse(row.payload));
      if (r.getExecutionInput(attempt.input_snapshot_id).schema_version !== 2) return [];
      const captured = this.context(attempt.input_snapshot_id); const input = captured.input;
      const cp = r.listCheckpoints(attempt.id).find(cp => cp.completed_stage === 'fit');
      if (!cp || cp.output_references.length !== 1 || cp.input_fingerprint !== input.fingerprint) throw new Error('Invalid fit checkpoint');
      const bytes = r.database.files.readArtifact(cp.output_references[0], jobId);
      if (fingerprint(bytes) !== cp.output_fingerprint) throw new Error('Fit output changed');
      const result = z.object({ schema_version: z.literal(1), stage: z.literal('fit'), input_fingerprint: z.literal(input.fingerprint), data: resultSchema }).parse(JSON.parse(bytes.toString())).data;
      if (result.assessment.profile_id !== result.profile.id || result.assessment.job_id !== jobId || result.assessment.workspace_id !== input.workspace_id || result.assessment.posting_snapshot_id !== input.posting.id) throw new Error('Fit assessment binding mismatch');
      let stale = job.posting_snapshot_id !== input.posting.id || captured.selection.scope.employer !== job.employer_id || captured.selection.scope.role !== job.role || fingerprint(JSON.stringify(C.PrivacyRulesConfigSchema.parse(rules))) !== input.privacy_rules.fingerprint;
      try { stale ||= currentSelection(captured.selection.evidence_ids).fingerprint !== captured.selection.fingerprint; } catch { stale = true; }
      return [{ ...result, input_snapshot_id: input.id, stale, evidence: captured.evidence.getAll().map(e => ({ id: e.id, title: e.title, summary: e.summary, narrative: e.narrative })) }];
    });
    return { current: history[0] ?? null, history };
  }
}
