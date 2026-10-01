import { randomUUID } from 'node:crypto';
import {
  canonicalJson,
  hasUnappliedChanges,
  type RevisionToken,
  AlignmentMatrixSchema,
  DefensibilityBriefSchema,
  JobAnalysisSchema,
  ProposalSetSchema,
  RedactionBlockedError,
  ResumeSpecSchema,
  STEP_JSON_SCHEMAS,
  TAILORING_STEPS,
  alignmentSummary,
  applyProposals,
  auditSlop,
  buildAlignmentPrompt,
  buildAnalysisPrompt,
  buildBriefPrompt,
  buildProposalsPrompt,
  buildSystemPrompt,
  citedEvidenceIds,
  compileMarkdownResume,
  isBlocked,
  lintCitations,
  pageBudgetOverruns,
  redactText,
  renderBriefMarkdown,
  validateAlignment,
  validateAnalysis,
  validateMetrics,
  validateProposals,
  type DraftEnvelope,
  type AlignmentMatrix,
  type DefensibilityBrief,
  type EvidenceStore,
  type JobAnalysis,
  type PrivacyRulesConfig,
  type Proposal,
  type ProposalSet,
  type ResumeSpec,
  type RunManifest,
  type RunState,
  type TailoringStep,
} from '@featherduster/core';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import yaml from 'js-yaml';
import type { ZodType, ZodTypeAny, output as ZodOutput } from 'zod';
import { RunnerError, type ModelRunner, type RunnerId } from '../runners/types.js';
import { detectRunners, type RunnerFactory, type RunnerInfo } from '../runners/registry.js';
import { loadTailoringConfig, recordRunnerConsent, type TailoringConfig } from './config.js';
import { loadTailoringSkill } from './skill-text.js';
import { DraftRepositoryError } from './drafts/errors.js';
import { DraftService } from './drafts/service.js';
import { RUN_FILES, RunStore, RunStoreError, writeRunArtifactAtomic } from './store.js';

export interface TailoringEvent {
  slug: string;
  step: TailoringStep | null;
  kind: 'status' | 'token' | 'state';
  text?: string;
  state?: RunState;
}

export interface BaseResumeRef {
  id: string;
  name: string;
  spec: ResumeSpec;
}

export interface OrchestratorDeps {
  drafts?: DraftService;
  workspaceDir: string;
  runnerFactory: RunnerFactory;
  loadEvidence: () => EvidenceStore;
  loadPrivacyRules: () => PrivacyRulesConfig;
  loadResumes: () => BaseResumeRef[];
  emit: (event: TailoringEvent) => void;
  now?: () => Date;
}

export class TailoringError extends Error {
  readonly status: number;
  readonly code: string;
  readonly detail?: unknown;
  constructor(status: number, code: string, message: string, detail?: unknown) {
    super(message);
    this.name = 'TailoringError';
    this.status = status;
    this.code = code;
    this.detail = detail;
  }
}

const RUNNING_STATE: Record<TailoringStep, RunState> = {
  analysis: 'analyzing',
  alignment: 'aligning',
  proposals: 'proposing',
  brief: 'briefing',
};

const PREVIOUS_STEP: Record<TailoringStep, TailoringStep | null> = {
  analysis: null,
  alignment: 'analysis',
  proposals: 'alignment',
  brief: 'proposals',
};

const STEP_FILE: Record<TailoringStep, (typeof RUN_FILES)[keyof typeof RUN_FILES]> = {
  analysis: RUN_FILES.analysis,
  alignment: RUN_FILES.alignment,
  proposals: RUN_FILES.proposals,
  brief: RUN_FILES.briefData,
};

const HAS_OUTPUT = new Set(['done', 'approved', 'stale']);

/** Derives the run state from step statuses. `error`/`cancelled` are sticky until the next action. */
export function deriveRunState(manifest: RunManifest): RunState {
  const s = manifest.steps;
  for (const step of TAILORING_STEPS) {
    if (s[step].status === 'running') return RUNNING_STATE[step];
  }
  if (manifest.state === 'error' || manifest.state === 'cancelled') return manifest.state;
  if (HAS_OUTPUT.has(s.brief.status)) return 'complete';
  if (HAS_OUTPUT.has(s.proposals.status)) return 'proposal_review';
  if (HAS_OUTPUT.has(s.alignment.status)) return 'alignment_review';
  if (HAS_OUTPUT.has(s.analysis.status)) return 'analysis_ready';
  return 'draft';
}

function hash(text: string): string {
  return crypto.createHash('sha256').update(text).digest('hex').slice(0, 16);
}

export interface RunDetail {
  draft?: DraftEnvelope;
  base_notice?: string;
  manifest: RunManifest;
  posting: string;
  base_resume: ResumeSpec | null;
  analysis: JobAnalysis | null;
  alignment: AlignmentMatrix | null;
  alignment_summary: { backed: number; transferable: number; gap: number } | null;
  proposals: Proposal[] | null;
  page_budget: { overBy: number; proposalIds: string[] } | null;
  resume: ResumeSpec | null;
  brief_markdown: string | null;
}

interface InFlight {
  slug: string;
  step: TailoringStep;
  controller: AbortController;
  cancelled: boolean;
}

export class TailoringOrchestrator {
  readonly store: RunStore;
  readonly drafts: DraftService;
  private inFlight: InFlight | null = null;
  private settledWriteGuard: (() => void) | undefined;
  private readonly now: () => Date;

  constructor(private readonly deps: OrchestratorDeps) {
    this.store = new RunStore(deps.workspaceDir, (slug, action) => {
      this.drafts.assertRunMutationAvailable(slug);
      const manifest = this.store.exists(slug) ? this.store.readManifest(slug) : undefined;
      const write = () => action(() => this.assertRunAssociationUnchanged(slug, manifest?.draft_id));
      return manifest?.draft_id ? this.drafts.repository.withRunMutation(manifest.draft_id, write) : write();
    });
    this.drafts = deps.drafts ?? new DraftService(deps);
    if (!deps.drafts) this.drafts.recover();
    this.drafts.prepareCompletion = slug => this.prepareCompletion(slug);
    this.drafts.completionPreflight = spec => this.completionPreflight(spec);
    this.now = deps.now ?? (() => new Date());
    this.recoverInterrupted();
  }

  // -------------------------------------------------------------------------
  // Queries
  // -------------------------------------------------------------------------

  config(): TailoringConfig {
    return loadTailoringConfig(this.deps.workspaceDir);
  }

  async runners(): Promise<{ runners: RunnerInfo[]; consent: TailoringConfig['runner_consent'] }> {
    const config = this.config();
    return { runners: await detectRunners(config.runner, this.deps.runnerFactory), consent: config.runner_consent };
  }

  listRuns(): Array<RunManifest & { needs_review: boolean }> {
    return this.store.list().map((m) => ({
      ...m,
      needs_review: ['analysis_ready', 'alignment_review', 'proposal_review'].includes(m.state),
    }));
  }
  /** Evidence ID → runs whose approved alignment or accepted proposals cite it. */
  citationIndex(): Record<string, Array<{ slug: string; title: string }>> {
    const index: Record<string, Array<{ slug: string; title: string }>> = {};
    for (const manifest of this.store.list()) {
      const ids = new Set<string>();
      const alignment = this.store.readJson(manifest.slug, RUN_FILES.alignment, (raw) => AlignmentMatrixSchema.parse(raw));
      alignment?.rows.forEach((row) => row.citations.forEach((c) => ids.add(c)));
      const proposals = this.store.readJson(manifest.slug, RUN_FILES.proposals, (raw) => ProposalSetSchema.parse(raw));
      proposals?.proposals
        .filter((p) => p.decision === 'accepted')
        .forEach((p) => p.citations.forEach((c) => ids.add(c)));
      for (const id of ids) {
        (index[id] ??= []).push({ slug: manifest.slug, title: manifest.title || manifest.slug });
      }
    }
    return index;
  }


  getRun(slug: string): RunDetail {
    const manifest = this.associatedManifest(slug);
    const analysis = this.store.readJson(slug, RUN_FILES.analysis, (raw) => JobAnalysisSchema.parse(raw));
    const alignment = this.store.readJson(slug, RUN_FILES.alignment, (raw) => AlignmentMatrixSchema.parse(raw));
    const proposalSet = this.store.readJson(slug, RUN_FILES.proposals, (raw) => ProposalSetSchema.parse(raw));
    const resumeText = this.store.readText(slug, RUN_FILES.resume);
    let resume: ResumeSpec | null = null;
    if (resumeText) {
      const parsed = ResumeSpecSchema.safeParse(yaml.load(resumeText));
      resume = parsed.success ? parsed.data : null;
    }
    const draft = manifest.draft_id ? this.drafts.adoptRun(slug) : undefined;
    const base = draft?.record.base;
    return {
      ...(draft ? { draft } : {}),
      ...(draft?.record.kind === 'run' && draft.record.legacyBaseNotice ? { base_notice: draft.record.legacyBaseNotice } : !base ? { base_notice: 'Legacy run: base is missing and the historical base is unknown. Restore the source to continue.' } : {}),
      manifest,
      posting: this.store.readText(slug, RUN_FILES.posting) ?? '',
      base_resume: base?.spec ?? null,
      analysis,
      alignment,
      alignment_summary: alignment ? alignmentSummary(alignment) : null,
      proposals: proposalSet?.proposals ?? null,
      page_budget: base && proposalSet ? pageBudgetOverruns(base.spec, proposalSet.proposals) : null,
      resume,
      brief_markdown: this.store.readText(slug, RUN_FILES.brief),
    };
  }

  // -------------------------------------------------------------------------
  // Commands
  // -------------------------------------------------------------------------

  createRun(input: { posting: unknown; base_resume: unknown; runner: unknown; label?: unknown }): RunManifest {
    return this.drafts.createLegacyRun(input);
  }

  recordConsent(runnerId: unknown): void {
    if (typeof runnerId !== 'string' || !['claude-code', 'codex', 'anthropic-api', 'ollama', 'fake'].includes(runnerId)) {
      throw new TailoringError(400, 'invalid_runner', 'Unknown runner.');
    }
    recordRunnerConsent(this.deps.workspaceDir, runnerId as RunnerId, this.now().toISOString().slice(0, 10));
  }

  /**
   * Validates preconditions and builds the model input synchronously (so the HTTP
   * layer can return 403/409/422 immediately), then executes the runner in the background.
   */
  async startStep(slug: string, stepName: string): Promise<{ started: true; step: TailoringStep }> {
    const step = this.parseStep(stepName);
    const manifest = this.associatedManifest(slug);
    const startingDraft = this.assertSettled(manifest);

    if (this.inFlight) {
      throw new TailoringError(409, 'busy', `Another step is already running (${this.inFlight.slug} / ${this.inFlight.step}).`);
    }
    const prev = PREVIOUS_STEP[step];
    if (prev && manifest.steps[prev].status !== 'approved') {
      throw new TailoringError(409, 'previous_step_not_approved', `Approve the ${prev} step before running ${step}.`);
    }

    this.requireBaseResume(manifest);
    const config = this.config();
    const runner = this.deps.runnerFactory(manifest.runner as RunnerId, config.runner);
    if (!runner) throw new TailoringError(409, 'runner_unavailable', `Runner "${manifest.runner}" is not available.`);
    const detection = await runner.detect();
    if (!detection.available) {
      throw new TailoringError(409, 'runner_unavailable', detection.detail);
    }
    if (runner.locality === 'cloud' && runner.id !== 'fake' && !config.runner_consent[runner.id]) {
      throw new TailoringError(403, 'consent_required', `Consent is required before sending redacted evidence to ${runner.label}.`, {
        runner: runner.id,
      });
    }

    const currentManifest = this.associatedManifest(slug);
    const currentDraft = this.assertSettled(currentManifest);
    if (canonicalJson(currentDraft?.token ?? null) !== canonicalJson(startingDraft?.token ?? null)) throw new DraftRepositoryError(409, 'stale_revision', 'Draft changed while checking runner availability');
    if (prev && currentManifest.steps[prev].status !== 'approved') throw new TailoringError(409, 'previous_step_not_approved', `Approve the ${prev} step before running ${step}.`);
    const { system, prompt } = this.buildInput(slug, step, runner);

    // Claim the lock before any await-free state write.
    if (this.inFlight) {
      throw new TailoringError(409, 'busy', 'Another step is already running.');
    }
    const controller = new AbortController();
    const flight: InFlight = { slug, step, controller, cancelled: false };
    this.inFlight = flight;

    const fresh = this.store.readManifest(slug);
    fresh.steps[step] = { ...fresh.steps[step], status: 'running', error: null, raw_output: null };
    fresh.error = null;
    fresh.state = 'draft';
    try { this.withSettledWrites(slug, () => this.saveManifest(fresh, step), startingDraft); }
    catch (error) { this.inFlight = null; throw error; }

    void this.execute(flight, runner, system, prompt, config.runner.step_timeout_seconds * 1000);
    return { started: true, step };
  }

  /** Returns the exact (redacted, for cloud runners) model input for a step without running it. */
  previewInput(slug: string, stepName: string): { runner: string; locality: 'local' | 'cloud'; system: string; prompt: string } {
    const step = this.parseStep(stepName);
    const manifest = this.associatedManifest(slug);
    this.assertSettled(manifest);
    const prev = PREVIOUS_STEP[step];
    if (prev && manifest.steps[prev].status !== 'approved') {
      throw new TailoringError(409, 'previous_step_not_approved', `Approve the ${prev} step before previewing ${step}.`);
    }
    this.requireBaseResume(manifest);
    const runner = this.deps.runnerFactory(manifest.runner as RunnerId, this.config().runner);
    if (!runner) throw new TailoringError(409, 'runner_unavailable', `Runner "${manifest.runner}" is not available.`);
    this.assertSettled(this.associatedManifest(slug));
    const { system, prompt } = this.buildInput(slug, step, runner);
    return { runner: runner.label, locality: runner.locality, system, prompt };
  }

  cancel(slug: string): { cancelled: boolean } {
    if (!this.inFlight || this.inFlight.slug !== slug) return { cancelled: false };
    this.inFlight.cancelled = true;
    this.inFlight.controller.abort();
    return { cancelled: true };
  }

  saveStep(slug: string, stepName: string, body: unknown): RunDetail {
    const step = this.parseStep(stepName);
    this.assertNotRunning(slug);
    const manifest = this.associatedManifest(slug);
    const draft = this.assertSettled(manifest);
    if (!draft) throw new TailoringError(409, 'base_resume_missing', 'Restore the missing base resume before editing this legacy run.');
    if (!HAS_OUTPUT.has(manifest.steps[step].status)) {
      throw new TailoringError(409, 'no_output', `The ${step} step has no output to edit yet.`);
    }
    const payload = (body && typeof body === 'object' && 'data' in (body as any) ? (body as any).data : body) as unknown;

    if (step === 'brief') throw new TailoringError(400, 'not_editable', 'The brief is regenerated, not edited.');
    const sources = this.captureSources(slug);
    this.drafts.assertArtifactTokens(draft, sources);
    const data = this.prepareStepData(slug, manifest, step, payload);
    const fresh = this.store.readManifest(slug);
    const wasApproved = fresh.steps[step].status === 'approved';
    fresh.steps[step] = { ...fresh.steps[step], status: 'done', completed_at: this.now().toISOString() };
    // Decisions on proposals don't invalidate earlier output; editing an approved step stales everything after it.
    if (wasApproved || step !== 'proposals') this.markDownstreamStale(fresh, step);
    fresh.error = null;
    fresh.state = 'draft';
    fresh.updated = this.now().toISOString(); fresh.state = deriveRunState(fresh);
    this.drafts.publishStep({ draft, step, data, manifest: fresh, operationId: crypto.randomUUID(), command: 'sync', request: { origin: 'legacy-save', step }, sources });
    this.deps.emit({ slug, step, kind: 'state', state: fresh.state });
    return this.getRun(slug);
  }

  applyDraft(id: string, input: { expected: RevisionToken; artifactToken: RevisionToken | null; operationId: string; step: 'analysis' | 'alignment' | 'proposals' }) {
    const request = { step: input.step, artifactToken: input.artifactToken };
    const prior = this.drafts.operations.lookup(input.operationId);
    if (prior) {
      if (prior.operation.command !== 'apply' || prior.operation.draftId !== id.toLowerCase() || canonicalJson(prior.operation.expected) !== canonicalJson(input.expected) || canonicalJson(prior.operation.request) !== canonicalJson(request))
        throw new DraftRepositoryError(409, 'operation_conflict', 'Operation id was used for a different request');
      const receipt = this.drafts.operations.execute(prior.operation);
      return { ...receipt.acknowledgement, run: (receipt.result as unknown as { run: RunDetail }).run };
    }
    const draft = this.drafts.get(id);
    if (draft.record.kind !== 'run' || !draft.record.runSlug) throw new DraftRepositoryError(409, 'invalid_kind', 'Apply requires a run draft');
    if (canonicalJson(draft.token) !== canonicalJson(input.expected)) throw new DraftRepositoryError(409, 'stale_revision', 'Draft changed before Apply');
    const record = draft.record, slug = record.runSlug!;
    const sources = this.captureSources(slug);
    this.assertNotRunning(slug);
    const manifest = this.associatedManifest(slug);
    if (Object.values(manifest.steps).some((state) => state.status === 'running')) throw new DraftRepositoryError(409, 'busy', 'A step is running');
    if (canonicalJson(record.payload.artifactTokens[input.step] ?? null) !== canonicalJson(input.artifactToken)) throw new DraftRepositoryError(409, 'artifact_conflict', 'Artifact token changed');
    const target = sources.find((source) => source.path.endsWith('/' + STEP_FILE[input.step]))!;
    if (target.expectedHash !== (input.artifactToken?.fingerprint ?? null)) throw new DraftRepositoryError(409, 'artifact_conflict', 'Artifact changed outside the draft');
    this.drafts.assertArtifactTokens(draft, sources, TAILORING_STEPS.slice(0, TAILORING_STEPS.indexOf(input.step) + 1));
    // Applying downstream content must not validate against unapplied upstream recovery.
    for (const upstream of (['analysis', 'alignment', 'proposals'] as const).slice(0, TAILORING_STEPS.indexOf(input.step))) {
      if (canonicalJson(record.payload[upstream] ?? null) !== canonicalJson(record.appliedContent[upstream] ?? null)) throw new DraftRepositoryError(409, 'unapplied_changes', 'Apply unapplied upstream edits first');
    }
    let payload = record.payload[input.step];
    if (input.step === 'proposals' && record.payload.proposals) {
      const proposals = structuredClone(record.payload.proposals.proposals);
      for (const [proposalId, text] of Object.entries(record.payload.proposalTextById)) {
        const proposal = proposals.find((item) => item.id === proposalId);
        if (!proposal || !text.trim()) throw new DraftRepositoryError(422, 'invalid_apply', 'Finish or discard unfinished inline edits before Apply');
        proposal.edited_after = text;
      }
      payload = { proposals };
    }
    let data: unknown;
    try { data = this.prepareStepData(slug, manifest, input.step, payload); }
    catch (error) {
      if (error instanceof TailoringError && error.code === 'invalid_payload') throw new DraftRepositoryError(422, 'invalid_apply', 'Draft is not valid for Apply');
      throw error;
    }
    const wasApproved = manifest.steps[input.step].status === 'approved';
    manifest.steps[input.step] = { ...manifest.steps[input.step], status: 'done', completed_at: this.now().toISOString(), error: null };
    if (wasApproved || input.step !== 'proposals') this.markDownstreamStale(manifest, input.step);
    manifest.error = null; manifest.state = deriveRunState({ ...manifest, state: 'draft' }); manifest.updated = this.now().toISOString();
    const { draft: previousDraft, ...run } = this.getRun(slug);
    run.manifest = manifest;
    if (input.step === 'analysis') run.analysis = data as JobAnalysis;
    if (input.step === 'alignment') { run.alignment = data as AlignmentMatrix; run.alignment_summary = alignmentSummary(run.alignment); }
    if (input.step === 'proposals') { run.proposals = (data as ProposalSet).proposals; run.page_budget = pageBudgetOverruns(record.base.spec, run.proposals); }
    const result = this.drafts.publishStep({ draft, result: JSON.parse(JSON.stringify({ run })), step: input.step, data, manifest, operationId: input.operationId, command: 'apply', request, sources, consumeBuffers: input.step === 'proposals' });
    this.deps.emit({ slug, step: input.step, kind: 'state', state: manifest.state });
    return { ...result, run };
  }

  private captureSources(slug: string) {
    return [RUN_FILES.manifest, RUN_FILES.posting, RUN_FILES.analysis, RUN_FILES.alignment, RUN_FILES.proposals, RUN_FILES.briefData, RUN_FILES.brief].map((file) => {
      const bytes = this.store.readText(slug, file);
      return { path: `tailoring/${slug}/${file}`, expectedHash: bytes === null ? null : crypto.createHash('sha256').update(bytes).digest('hex') };
    });
  }

  private prepareStepData(slug: string, manifest: RunManifest, step: 'analysis' | 'alignment' | 'proposals', payload: unknown): unknown {
    switch (step) {
      case 'analysis': return validateAnalysis(this.parseOr400(JobAnalysisSchema, payload), this.store.readText(slug, RUN_FILES.posting) ?? '');
      case 'alignment': return validateAlignment(this.parseOr400(AlignmentMatrixSchema, payload), this.requireAnalysis(slug), this.deps.loadEvidence().getAll());
      case 'proposals': return { proposals: this.revalidateProposals(slug, manifest, this.parseOr400(ProposalSetSchema, payload).proposals) };
    }
  }

  private assertSettled(manifest: RunManifest): DraftEnvelope | undefined {
    this.drafts.assertRunMutationAvailable(manifest.slug);
    const draft = manifest.draft_id ? this.drafts.get(manifest.draft_id) : undefined;
    if (draft && hasUnappliedChanges(draft.record)) throw new DraftRepositoryError(409, 'unapplied_changes', 'Apply unapplied draft edits before continuing');
    if (draft) this.drafts.assertArtifactTokens(draft, this.captureSources(manifest.slug));
    return draft;
  }

  private withSettledWrites<T>(slug: string, action: () => T, expectedDraft?: DraftEnvelope): T {
    const manifest = this.associatedManifest(slug);
    const draft = manifest.draft_id
      ? this.drafts.repository.withRunMutation(manifest.draft_id, () => this.assertSettled(manifest))
      : this.assertSettled(manifest);
    if (expectedDraft && canonicalJson(draft?.token ?? null) !== canonicalJson(expectedDraft.token)) throw new DraftRepositoryError(409, 'stale_revision', 'Draft changed while preparing workflow inputs');
    const previous = this.settledWriteGuard;
    this.settledWriteGuard = () => {
      const current = this.assertSettled(manifest);
      if (draft && canonicalJson(current?.token ?? null) !== canonicalJson(draft.token)) throw new DraftRepositoryError(409, 'stale_revision', 'Draft changed during workflow command');
    };
    try { return action(); } finally { this.settledWriteGuard = previous; }
  }

  approveStep(slug: string, stepName: string): RunDetail {
    return this.withSettledWrites(slug, () => this.approveSettledStep(slug, stepName));
  }

  private assertUpstreamReviewed(manifest: RunManifest, step: TailoringStep): void {
    const record = manifest.draft_id ? this.drafts.get(manifest.draft_id).record : undefined;
    if (record?.kind !== 'run' || !record.upstreamSync) return;
    const prior = TAILORING_STEPS.slice(0, TAILORING_STEPS.indexOf(step) + 1);
    if (record.upstreamSync.staleSteps.some(stale => prior.includes(stale)) || (prior.includes('proposals') && record.upstreamSync.reviewProposalIds.length)) throw new DraftRepositoryError(409, 'upstream_review', 'Upstream changed the base. Review and Apply or regenerate stale outputs and reject or replace ambiguous proposals before approval.');
  }
  private approveSettledStep(slug: string, stepName: string): RunDetail {
    const step = this.parseStep(stepName);
    this.assertNotRunning(slug);
    const manifest = this.associatedManifest(slug);
    this.assertUpstreamReviewed(manifest, step);
    this.assertSettled(manifest);
    const status = manifest.steps[step].status;
    if (status === 'approved') return this.getRun(slug);
    if (status !== 'done') {
      throw new TailoringError(409, 'not_ready', status === 'stale' ? `The ${step} step is stale; re-run it first.` : `The ${step} step has no output to approve.`);
    }

    if (step === 'alignment') {
      const alignment = this.store.readJson(slug, RUN_FILES.alignment, (raw) => AlignmentMatrixSchema.parse(raw));
      const blocking = alignment?.rows.filter((r) => r.issues?.some((i) => i.severity === 'block')) ?? [];
      if (blocking.length > 0) {
        throw new TailoringError(409, 'blocking_issues', `Resolve blocking issues on ${blocking.map((r) => r.requirement_id).join(', ')} first.`);
      }
    }
    if (step === 'proposals') {
      const set = this.store.readJson(slug, RUN_FILES.proposals, (raw) => ProposalSetSchema.parse(raw));
      const proposals = set?.proposals ?? [];
      const acceptedBlocked = proposals.filter((p) => p.decision === 'accepted' && isBlocked(p));
      if (acceptedBlocked.length > 0) {
        throw new TailoringError(409, 'blocking_issues', `Accepted proposals have blocking checks: ${acceptedBlocked.map((p) => p.id).join(', ')}.`);
      }
      const pending = proposals.filter((p) => p.decision === 'pending');
      if (pending.length > 0) {
        throw new TailoringError(409, 'pending_decisions', `Accept or reject every proposal first (${pending.length} pending).`);
      }
      const base = this.requireBaseResume(manifest);
      const applied = applyProposals(base.spec, proposals);
      this.store.writeText(slug, RUN_FILES.resume, yaml.dump(applied, { indent: 2, lineWidth: 120 }));
    }

    const fresh = this.store.readManifest(slug);
    fresh.steps[step] = { ...fresh.steps[step], status: 'approved' };
    fresh.error = null;
    fresh.state = 'draft';
    if (step === 'analysis' && !fresh.title) {
      const analysis = this.requireAnalysis(slug);
      fresh.title = [analysis.company, analysis.role].filter(Boolean).join(' — ');
    }
    this.saveManifest(fresh, step);
    return this.getRun(slug);
  }

  finalize(slug: string): { filePath: string; preflight: Record<string, unknown> } {
    const draft = this.drafts.adoptRun(slug);
    if (!draft) throw new TailoringError(409, 'missing_base', 'Base resume is missing');
    if (draft.record.lifecycle === 'completed' && draft.record.completion) return { filePath: draft.record.completion.path, preflight: this.completionPreflight(draft.record.completion.spec) };
    const result = this.drafts.complete(draft.record.id, draft.token, randomUUID());
    return { filePath: result.completion.path, preflight: this.completionPreflight(result.completion.spec) };
  }

  private prepareCompletion(slug: string): { spec: ResumeSpec; preflight: Record<string, unknown> } {
    const associated = this.associatedManifest(slug);
    if (associated.draft_id) this.drafts.repository.withRunMutation(associated.draft_id, () => undefined);
    this.assertNotRunning(slug);
    const manifest = this.associatedManifest(slug);
    this.assertUpstreamReviewed(manifest, 'brief');
    this.assertSettled(manifest);
    this.requireBaseResume(manifest);
    if (manifest.steps.proposals.status !== 'approved') {
      throw new TailoringError(409, 'not_ready', 'Approve the proposals step before saving the resume.');
    }
    const text = this.store.readText(slug, RUN_FILES.resume);
    const parsed = text ? ResumeSpecSchema.safeParse(yaml.load(text)) : null;
    if (!parsed || !parsed.success) throw new TailoringError(409, 'not_ready', 'Applied resume is missing; re-approve proposals.');
    const spec = parsed.data;

    return { spec, preflight: this.completionPreflight(spec) };
  }

  private completionPreflight(spec: ResumeSpec): Record<string, unknown> {
    const store = this.deps.loadEvidence();
    const rules = this.deps.loadPrivacyRules();
    let markdown = compileMarkdownResume(spec);
    for (const exp of spec.experiences) {
      for (const b of exp.bullets) for (const c of b.citations ?? []) if (!markdown.includes(c)) markdown += `\n(${c})`;
    }
    const citations = lintCitations(markdown, store);
    const metrics = validateMetrics(markdown, store);
    const redaction = redactText(markdown, rules);
    const slop = auditSlop(markdown);
    const preflight = {
      isClean: citations.isClean && metrics.isClean && redaction.isClean,
      danglingCitations: citations.danglingCitations,
      metricIssues: metrics.issues,
      violations: redaction.violations,
      slop: { score: slop.score, band: slop.slopBand, summary: slop.summary },
    };

    return preflight;
  }

  // -------------------------------------------------------------------------
  // Internals
  // -------------------------------------------------------------------------

  private async execute(flight: InFlight, runner: ModelRunner, system: string, prompt: string, timeoutMs: number): Promise<void> {
    const { slug, step, controller } = flight;
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    let rawOutput: unknown = undefined;
    try {
      const schema = STEP_JSON_SCHEMAS[step];
      const onProgress = (evt: { kind: 'status' | 'token'; text: string }) =>
        this.deps.emit({ slug, step, kind: evt.kind, text: evt.text });

      rawOutput = await runner.run({ system, prompt, schema, signal: controller.signal, onProgress });
      let validated = this.parseStepOutput(step, rawOutput);
      if (!validated.success) {
        onProgress({ kind: 'status', text: 'Output failed schema validation; retrying once…' });
        const retryPrompt = `${prompt}\n\n## Previous Attempt Rejected\nYour previous output failed schema validation:\n${validated.error}\nReturn corrected JSON that satisfies the schema.`;
        rawOutput = await runner.run({ system, prompt: retryPrompt, schema, signal: controller.signal, onProgress });
        validated = this.parseStepOutput(step, rawOutput);
        if (!validated.success) {
          throw new RunnerError('invalid_output', 'Model output did not match the schema after one retry.', validated.error);
        }
      }

      const sources = this.captureSources(slug);
      const manifest = this.associatedManifest(slug);
      manifest.steps[step] = {
        status: 'done',
        completed_at: this.now().toISOString(),
        input_hash: hash(system + prompt),
        error: null,
        raw_output: null,
      };
      this.markDownstreamStale(manifest, step);
      manifest.error = null;
      manifest.state = 'draft';
      manifest.updated = this.now().toISOString(); manifest.state = deriveRunState(manifest);
      this.persistStepOutput(slug, step, validated.data, manifest, sources);
    } catch (err) {
      const aborted = controller.signal.aborted;
      const manifest = this.safeReadManifest(slug);
      if (manifest) {
        const hadOutput = fs.existsSync(path.join(this.store.runDir(slug), STEP_FILE[step]));
        const message = flight.cancelled
          ? 'Cancelled.'
          : aborted
          ? `Timed out after ${Math.round(timeoutMs / 1000)}s.`
          : err instanceof RunnerError
          ? err.message
          : err instanceof Error
          ? err.message
          : String(err);
        const detail = err instanceof RunnerError && err.detail ? `\n${err.detail}` : '';
        manifest.steps[step] = {
          ...manifest.steps[step],
          status: flight.cancelled ? (hadOutput ? 'stale' : 'pending') : 'error',
          error: flight.cancelled ? null : message + detail,
          raw_output: rawOutput === undefined ? null : JSON.stringify(rawOutput).slice(0, 20000),
        };
        manifest.error = flight.cancelled ? null : message;
        manifest.state = flight.cancelled ? 'cancelled' : 'error';
        try { this.saveManifest(manifest, step, true); }
        catch (publicationError) {
          // An interrupted journal owns its planned status and output. Recovery must
          // finish it before any ordinary error-status write can touch those files.
          if (!(publicationError instanceof DraftRepositoryError)) throw publicationError;
          this.deps.emit({ slug, step, kind: 'status', text: publicationError.detail });
        }
      }
    } finally {
      clearTimeout(timer);
      if (this.inFlight === flight) this.inFlight = null;
    }
  }

  private parseStepOutput(step: TailoringStep, raw: unknown): { success: true; data: unknown } | { success: false; error: string } {
    const schema: ZodType<unknown> =
      step === 'analysis' ? JobAnalysisSchema : step === 'alignment' ? AlignmentMatrixSchema : step === 'proposals' ? ProposalSetSchema : DefensibilityBriefSchema;
    const result = schema.safeParse(raw);
    if (result.success) return { success: true, data: result.data };
    return {
      success: false,
      error: result.error.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`).slice(0, 20).join('\n'),
    };
  }

  private persistStepOutput(slug: string, step: TailoringStep, data: unknown, manifest: RunManifest, sources: ReturnType<TailoringOrchestrator['captureSources']>): void {
    const publish = (value: unknown, briefMarkdown?: string) => {
      this.drafts.publishStep({ draft: this.drafts.get(manifest.draft_id!), step, data: value, manifest, operationId: crypto.randomUUID(), command: 'sync', request: { origin: 'generation', step }, sources, briefMarkdown });
      this.deps.emit({ slug, step, kind: 'state', state: manifest.state });
    };
    switch (step) {
      case 'analysis': {
        const posting = this.store.readText(slug, RUN_FILES.posting) ?? '';
        publish(validateAnalysis(data as JobAnalysis, posting));
        return;
      }
      case 'alignment': {
        const analysis = this.requireAnalysis(slug);
        const matrix = data as AlignmentMatrix;
        // Preserve the user's "confirmed by me" flags across re-runs.
        const previous = this.store.readJson(slug, RUN_FILES.alignment, (raw) => AlignmentMatrixSchema.parse(raw));
        const confirmed = new Set(previous?.rows.filter((r) => r.candidate_confirmed).map((r) => r.requirement_id) ?? []);
        matrix.rows = matrix.rows.map((r) => ({ ...r, candidate_confirmed: confirmed.has(r.requirement_id) }));
        publish(validateAlignment(matrix, analysis, this.deps.loadEvidence().getAll()));
        return;
      }
      case 'proposals': {
        const set = data as ProposalSet;
        const fresh = set.proposals.map((p) => ({ ...p, decision: 'pending' as const, edited_after: undefined, checks: [] }));
        publish({ proposals: this.revalidateProposals(slug, manifest, fresh) });
        return;
      }
      case 'brief': {
        const brief = data as DefensibilityBrief;
        const analysis = this.requireAnalysis(slug);
        const alignment = this.requireAlignment(slug);
        publish(brief, renderBriefMarkdown(brief, analysis, alignment));
        return;
      }
    }
  }

  private revalidateProposals(slug: string, manifest: RunManifest, proposals: Proposal[]): Proposal[] {
    const analysis = this.requireAnalysis(slug);
    const alignment = this.requireAlignment(slug);
    const base = this.requireBaseResume(manifest);
    const validated = validateProposals(
      proposals.map((p) => ({ ...p, checks: [] })),
      {
        analysis,
        alignment,
        baseResume: base.spec,
        evidence: this.deps.loadEvidence().getAll(),
        deslopWarnBand: this.config().deslop_warn_band,
      }
    );
    const budget = pageBudgetOverruns(base.spec, validated);
    return validated.map((p) =>
      budget.proposalIds.includes(p.id)
        ? {
            ...p,
            checks: [
              ...p.checks,
              { severity: 'warn' as const, kind: 'page_budget', message: `Accepted edits add ~${budget.overBy} line(s) beyond the base resume.` },
            ],
          }
        : p
    );
  }

  private buildInput(slug: string, step: TailoringStep, runner: ModelRunner): { system: string; prompt: string } {
    const skill = loadTailoringSkill(this.deps.workspaceDir);
    const evidence = this.deps.loadEvidence();
    const all = evidence.getAll();
    const opts = {
      locality: runner.locality,
      rules: this.deps.loadPrivacyRules(),
      evidenceIds: all.map((r) => r.id),
    };
    const manifest = this.associatedManifest(slug);
    try {
      let prompt: string;
      switch (step) {
        case 'analysis':
          prompt = buildAnalysisPrompt(this.store.readText(slug, RUN_FILES.posting) ?? '', skill.jdRubric, opts);
          break;
        case 'alignment':
          prompt = buildAlignmentPrompt(this.requireAnalysis(slug), all, this.requireBaseResume(manifest).spec, opts);
          break;
        case 'proposals': {
          const alignment = this.requireAlignment(slug);
          const cited = citedEvidenceIds(alignment).map((id) => evidence.get(id)).filter((r): r is NonNullable<typeof r> => !!r);
          prompt = buildProposalsPrompt(this.requireAnalysis(slug), alignment, this.requireBaseResume(manifest).spec, cited, opts);
          break;
        }
        case 'brief': {
          const alignment = this.requireAlignment(slug);
          const proposals = this.store.readJson(slug, RUN_FILES.proposals, (raw) => ProposalSetSchema.parse(raw))?.proposals ?? [];
          const accepted = proposals.filter((p) => p.decision === 'accepted' && !isBlocked(p));
          const ids = new Set([...citedEvidenceIds(alignment), ...accepted.flatMap((p) => p.citations)]);
          const cited = Array.from(ids).map((id) => evidence.get(id)).filter((r): r is NonNullable<typeof r> => !!r);
          prompt = buildBriefPrompt(this.requireAnalysis(slug), alignment, accepted, cited, opts);
          break;
        }
      }
      return { system: buildSystemPrompt(skill.skill, step), prompt };
    } catch (err) {
      if (err instanceof RedactionBlockedError) {
        throw new TailoringError(422, 'banned_keyword', err.message, err.violations);
      }
      throw err;
    }
  }

  private markDownstreamStale(manifest: RunManifest, step: TailoringStep): void {
    const idx = TAILORING_STEPS.indexOf(step);
    for (const later of TAILORING_STEPS.slice(idx + 1)) {
      if (HAS_OUTPUT.has(manifest.steps[later].status) || manifest.steps[later].status === 'error') {
        manifest.steps[later] = { ...manifest.steps[later], status: 'stale' };
      }
    }
  }

  private saveManifest(manifest: RunManifest, step: TailoringStep | null, keepErrorState = false): void {
    manifest.updated = this.now().toISOString();
    if (!keepErrorState) manifest.state = deriveRunState({ ...manifest, state: 'draft' });
    else manifest.state = deriveRunState(manifest);
    this.store.writeManifest(manifest);
    this.deps.emit({ slug: manifest.slug, step, kind: 'state', state: manifest.state });
  }

  private recoverInterrupted(): void {
    for (const manifest of this.store.list()) {
      let changed = false;
      for (const step of TAILORING_STEPS) {
        if (manifest.steps[step].status === 'running') {
          manifest.steps[step] = { ...manifest.steps[step], status: 'error', error: 'Interrupted: the server stopped while this step was running.' };
          manifest.error = 'interrupted';
          manifest.state = 'error';
          changed = true;
        }
      }
      if (changed) {
        manifest.updated = this.now().toISOString();
        try { this.store.writeManifest(manifest); }
        catch (error) {
          // Pending/corrupt draft intent is exposed by the recovery list, and must retain its files.
          if (!(error instanceof DraftRepositoryError)) throw error;
        }
      }
    }
  }

  private safeReadManifest(slug: string): RunManifest | null {
    try {
      return this.store.readManifest(slug);
    } catch {
      return null;
    }
  }

  private assertNotRunning(slug: string): void {
    if ((this.inFlight && this.inFlight.slug === slug) || Object.values(this.store.readManifest(slug).steps).some((step) => step.status === 'running')) {
      throw new TailoringError(409, 'busy', 'A step is running for this run; wait or cancel it first.');
    }
  }

  private parseStep(step: string): TailoringStep {
    if (!(TAILORING_STEPS as readonly string[]).includes(step)) {
      throw new TailoringError(400, 'invalid_step', `Unknown step "${step}".`);
    }
    return step as TailoringStep;
  }

  private parseOr400<S extends ZodTypeAny>(schema: S, payload: unknown): ZodOutput<S> {
    const result = schema.safeParse(payload);
    if (!result.success) {
      throw new TailoringError(400, 'invalid_payload', 'Invalid step data.', result.error.issues);
    }
    return result.data;
  }

  /** Pure reads only: called with artifact ownership, after any required draft lock. */
  private assertRunAssociationUnchanged(slug: string, expectedDraftId: string | undefined): void {
    this.drafts.assertRunMutationAvailable(slug);
    this.settledWriteGuard?.();
    const current = this.store.exists(slug) ? this.store.readManifest(slug) : undefined;
    if (current?.draft_id !== expectedDraftId) throw new DraftRepositoryError(409, 'association_conflict', 'Run association changed; retry after reloading');
  }

  private associatedManifest(slug: string): RunManifest {
    this.drafts.adoptRun(slug);
    return this.store.readManifest(slug);
  }

  private requireBaseResume(manifest: RunManifest): BaseResumeRef {
    const draft = this.drafts.adoptRun(manifest.slug);
    const base = draft?.record.base ? { id: draft.record.base.resumeId, name: draft.record.base.resumeId, spec: draft.record.base.spec } : undefined;
    if (!base) throw new TailoringError(409, 'base_resume_missing', `Base resume "${manifest.base_resume}" no longer exists.`);
    return base;
  }

  private requireAnalysis(slug: string): JobAnalysis {
    const analysis = this.store.readJson(slug, RUN_FILES.analysis, (raw) => JobAnalysisSchema.parse(raw));
    if (!analysis) throw new TailoringError(409, 'missing_analysis', 'Run the analysis step first.');
    return analysis;
  }

  private requireAlignment(slug: string): AlignmentMatrix {
    const alignment = this.store.readJson(slug, RUN_FILES.alignment, (raw) => AlignmentMatrixSchema.parse(raw));
    if (!alignment) throw new TailoringError(409, 'missing_alignment', 'Run the alignment step first.');
    return alignment;
  }
}

export { RunStoreError };
