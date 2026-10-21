import { PreparationBatchRepository } from './preparation-batch-repository.js';
import { PreparationCoordinator } from './preparation-coordinator.js';
import { JobDraftRepository } from '../tailoring/drafts/repository.js';
import type { AutomaticRepairRecord } from './automatic-repair.js';
import { PreparationQuestions } from './preparation-questions.js';
import { JobDraftFinalization } from './draft-finalization.js';
import { SemanticService } from './semantic-service.js';
import { JobExports } from './exports.js';
import { JobMaterials } from './materials.js';
import { JobFit } from './fit.js';
import { selectJobSkillset } from './skillset.js';
import { ProposalRepository } from './proposal-repository.js';
import { ProposalService } from './proposal-service.js';
import { CorpusRepository } from '../corpus/repository.js';
import { CorpusService } from '../corpus/service.js';
import fs from 'node:fs';
import path from 'node:path';
import yaml from 'js-yaml';
import * as C from '@featherduster/core';
import { openJobsDatabase } from './database.js';
import { JobsRepository, RepositoryError } from './repository.js';
import { PostingIntakeService } from './intake.js';
import { JobArtifactsService, JobRunnerConfigurationSchema } from './artifacts.js';
import { JobPreparation, type PreparationDependencies } from './preparation.js';
import { JobsService } from './service.js';
import { getLatexTemplate } from './templates.js';
import { LatexRenderer } from '../render/latex-renderer.js';
import { defaultRunnerFactory, type RunnerFactory } from '../runners/registry.js';
import type { RunnerId } from '../runners/types.js';
import { loadTailoringConfig, loadAutomaticPreparationLimits } from '../tailoring/config.js';

export interface JobsRuntimeDependencies {
  loadResumes(): { id: string; type: string; filePath: string; spec: C.ResumeSpec }[];
  loadEvidence(): C.EvidenceStore;
  loadPrivacyRules(): C.PrivacyRulesConfig;
  runnerFactory?: RunnerFactory;
  renderer?: PreparationDependencies['renderer'];
  fetcher?: NonNullable<ConstructorParameters<typeof PostingIntakeService>[1]>['fetcher'];
  automaticDrain?: boolean;
}
export interface InputSelection { base_resume_id?: string; template_id?: string; runner?: RunnerId; evidence_ids?: string[]; automatic?: boolean }
export function createJobsRuntime(workspace: string, deps: JobsRuntimeDependencies) {
  const database = openJobsDatabase(workspace);
  const repository = new JobsRepository(database);
  const artifacts = new JobArtifactsService(repository);
  const batches = new PreparationBatchRepository(repository);
  const intake = new PostingIntakeService(repository, { fetcher: deps.fetcher });
  const corpusListeners = new Set<(event: { revision: number; update_ids: string[] }) => void>();
  const corpusRepository = new CorpusRepository(repository);
  let corpusCursor = corpusRepository.snapshot().revision;
  const corpus = new CorpusService(corpusRepository, deps.loadEvidence, () => flushEvents());
  const listeners = new Set<(event: C.JobEvent) => void>();
  let cursor = (database.db.prepare('SELECT COALESCE(MAX(sequence),0) AS n FROM events').get() as { n: number }).n;
  let timer: ReturnType<typeof setInterval> | undefined;
  let disposed: Promise<void> | undefined;
  const flushEvents = () => {
    if (disposed) return;
    const updates = corpusRepository.snapshot().updates.filter(u => u.revision > corpusCursor);
    if (updates.length) {
      corpusCursor = updates[updates.length - 1].revision;
      for (const listener of corpusListeners) { try { listener({ revision: corpusCursor, update_ids: updates.map(u => u.id) }); } catch { /* isolate observers */ } }
    }
    const rows = database.db.prepare('SELECT sequence,payload FROM events WHERE sequence>? ORDER BY sequence').all(cursor) as { sequence: number; payload: string }[];
    for (const row of rows) {
      const event = C.JobEventSchema.parse(JSON.parse(row.payload)); cursor = row.sequence;
      for (const listener of listeners) { try { listener(event); } catch { /* isolate observers */ } }
    }
  };
  const monitor = () => {
    if (!timer) {
      flushEvents();
      timer = setInterval(() => { try { flushEvents(); } catch (error) { console.error('Jobs event reconciliation failed', error); } }, 5000);
      timer.unref?.();
    }
  };
  const resolveRunner: PreparationDependencies['resolveRunner'] = settings => {
    const config = loadTailoringConfig(workspace).runner;
    const id = settings.runner as RunnerId;
    if (id !== 'fake' && !(id in config)) return null;
    if (id !== 'fake') config[id] = { ...config[id], model: settings.model } as never;
    return (deps.runnerFactory ?? defaultRunnerFactory)(id, config);
  };
  const captureInputs = (jobId: string, revision: number, selection: InputSelection = {}): C.InputSnapshot => database.db.transaction(() => {
    const job = repository.getJob(jobId);
    if (job.revision !== revision) throw new RepositoryError('revision_conflict', 'Stale job revision');
    const invalid = (message: string): never => { throw new RepositoryError('invalid_relationship', message); };
    if (!job.posting_snapshot_id) return invalid('Capture posting text first');
    const resumes = deps.loadResumes().filter(r => fs.existsSync(path.resolve(workspace, r.filePath)) && !!r.filePath);
    const baseId = selection.base_resume_id ?? job.base_resume_id;
    const base = baseId ? resumes.find(r => r.id === baseId) : resumes.find(r => r.type === 'template');
    if (!base) return invalid('Select a saved base resume');
    let template: C.LatexTemplateProfile;
    try { template = getLatexTemplate(selection.template_id ?? job.template_id ?? 'default'); } catch { return invalid('Unknown installed template'); }
    const config = loadTailoringConfig(workspace).runner;
    const id = selection.runner ?? job.runner ?? config.default;
    const runner = (deps.runnerFactory ?? defaultRunnerFactory)(id as RunnerId, config);
    if (!runner || !JobRunnerConfigurationSchema.safeParse({ runner: runner.id, model: runner.model }).success) return invalid('Configure a runner and model first');
    const view = corpus.read({ job_id: job.id, employer: job.employer_id ?? undefined, role: job.role ?? undefined });
    const { evidence, knowledge } = selectJobSkillset(view, selection.evidence_ids);
    const limits = selection.automatic ? loadAutomaticPreparationLimits(workspace) : { max_model_calls: 4, max_repair_attempts: 0 };
    return artifacts.captureInputs({ corpus_knowledge: knowledge, job_id: job.id, posting_id: job.posting_snapshot_id, base_resume: yaml.dump(base.spec), selected_evidence: evidence.map(e => ({ source_id: e.id, bytes: C.serializeEvidenceMarkdown(e, e.narrative) })), privacy_rules: deps.loadPrivacyRules(), template, runner_configuration: { runner: runner.id, model: runner.model }, policy: { schema_version: 1, mode: 'candidate', output_format: 'latex', page_budget: template.page_budget, max_model_calls: limits.max_model_calls, max_repair_attempts: limits.max_repair_attempts, model_retry_count: 0, timeout_ms: config.step_timeout_seconds * 4000 } });
  }).immediate();
  const fit = new JobFit(repository);
  const materials = new JobMaterials(repository, artifacts, (id, ids) => selectFit(id, ids), deps.loadPrivacyRules);
  // Native tool startup can exceed five seconds on a busy Windows host.
  const renderer = deps.renderer ?? new LatexRenderer({ probeTimeoutMs: 15000 });
  const semantic = new SemanticService(repository, artifacts, { runner: resolveRunner,
    consent: runner => runner.locality === 'local' || !!loadTailoringConfig(workspace).runner_consent[runner.id],
    timeoutMs: () => loadTailoringConfig(workspace).runner.step_timeout_seconds * 1000, currentRules: deps.loadPrivacyRules,
    beforeDispatch: (jobId, key, kind, inputSnapshotId) => { const member = batches.enrolled(jobId); if (member?.input_snapshot_id === inputSnapshotId) { batches.reserve(member, `semantic:${key}`, kind); return true; } return false; } });
  const preparation = new JobPreparation({ repository, artifacts, semantic, resolveRunner, hasConsent: runner => !!loadTailoringConfig(workspace).runner_consent[runner.id], renderer });
  const service = new JobsService({ repository, preparation: { run: (attempt, signal, previous) => repository.getExecutionInput(attempt.input_snapshot_id).schema_version === 3 ? materials.run(attempt, signal, { resolveRunner, hasConsent: runner => !!loadTailoringConfig(workspace).runner_consent[runner.id] }) : repository.getExecutionInput(attempt.input_snapshot_id).schema_version === 2 ? fit.run(attempt, signal, { resolveRunner, hasConsent: runner => !!loadTailoringConfig(workspace).runner_consent[runner.id] }) : preparation.run(attempt, signal, previous) }, automaticDrain: deps.automaticDrain, resolveInput: job => captureInputs(job.id, job.revision).id, onEvent: flushEvents });
  const proposals = new ProposalService(repository, new ProposalRepository(repository), artifacts, corpus, service, semantic);
  const selectFit = (id: string, ids?: string[]) => {
    const job = repository.getJob(id);
    return selectJobSkillset(corpus.read({ job_id: id, employer: job.employer_id ?? undefined, role: job.role ?? undefined }), ids);
  };
const drafts = new JobDraftFinalization(repository, artifacts, selectFit, deps.loadPrivacyRules, renderer, semantic);

  const readFit = (id: string) => fit.read(id, ids => selectFit(id, ids), deps.loadPrivacyRules());
  const assessFit = (id: string, request: { expected_revision: number; idempotency_key: string; evidence_ids?: string[]; runner?: RunnerId }, materialKind?: C.MaterialContent['kind']) => {
    // Capture and admission are atomic; a replay never captures or invokes again.
    const events = new Set(repository.listEvents(id).map(event => event.id));
    const receipt = repository.withReceipt(materialKind ? 'generate_material' : 'assess_fit', request.idempotency_key, { id, materialKind, ...request }, () => {
      const job = repository.getJob(id);
      if (job.revision !== request.expected_revision) throw new RepositoryError('revision_conflict', 'Reload the changed job before assessing fit');
      const control = repository.getControl();
      if (control.stopped_at || control.pause_after_current) throw new RepositoryError('ineligible', 'Processing is stopped or paused; explicitly Start first');
      if (service.worker.busy || repository.active().length) throw new RepositoryError('ineligible', 'Worker busy');
      const config = loadTailoringConfig(workspace).runner;
      const runner = (deps.runnerFactory ?? defaultRunnerFactory)(request.runner ?? config.default, config);
      if (!runner || !JobRunnerConfigurationSchema.safeParse({ runner: runner.id, model: runner.model }).success) throw new RepositoryError('invalid_relationship', 'Configure a runner and model in Settings');
      const input = materialKind ? materials.capture(id, materialKind, selectFit(id, request.evidence_ids), { runner: runner.id, model: runner.model }, config.step_timeout_seconds * 1000) : fit.capture(id, selectFit(id, request.evidence_ids), deps.loadPrivacyRules(), { runner: runner.id, model: runner.model }, config.step_timeout_seconds * 2000);
      const args = { job_id: id, expected_revision: job.revision, input_snapshot_id: input.id, idempotency_key: `fit:${request.idempotency_key}` };
      const action = job.preparation_state === 'resume_ready' ? 'reprepare' : job.preparation_state === 'needs_input' ? 'resume' : ['failed', 'cancelled', 'interrupted'].includes(job.preparation_state) ? 'retry' : undefined;
      return repository.requestPreparation({ ...args, action, lease_ms: 30000 }).result;
    });
    // Launch only after the outer receipt and capture transaction commits.
    if (!receipt.replayed && receipt.result.attempt) {
      service.worker.notify(id, events);
      service.worker.launch(receipt.result.attempt);
    }
    return receipt;
  };
  const exports = new JobExports(repository, artifacts, materials, selectFit, deps.loadPrivacyRules, semantic);
  const coordinator = new PreparationCoordinator(batches, service, proposals, drafts, semantic, flushEvents);
  const questions = new PreparationQuestions(batches, semantic, coordinator, proposals);
  const prepareBatch = (request: unknown) => { const result = batches.create(request, (id, revision) => captureInputs(id, revision, { automatic: true })); coordinator.initialize(); coordinator.wake(); return result; };
  const readBatch = (id: string) => {
    const batch = batches.get(id), members = batches.members(id).map(member => {
      const job = repository.getJob(member.job_id);
      return { ...member, company: job.company, role: job.role, recovery_action: job.recovery?.action, ...(job.recovery?.kind === 'stale_inputs' ? { state: 'technical' as const, diagnostic: 'Starting inputs changed. Review current inputs before preparing this job again.' } : {}) };
    });
    const queue = members.flatMap(member => {
      const job = repository.getJob(member.job_id), artifactId = job.artifact_version_ids.at(-1);
      if (!artifactId || !['ready'].includes(member.state)) return [];
      const artifact = artifacts.getArtifact(artifactId);
      try { exports.files(job.id, { artifact_id: artifact.id, artifact_fingerprint: artifact.version_fingerprint, dossier: false }); }
      catch { return []; }
      const approved = repository.listEvents(job.id).some(e => e.payload.kind === 'resume_review' && e.payload.artifact_version_id === artifact.id && e.payload.artifact_fingerprint === artifact.version_fingerprint);
      return [{ job_id: job.id, artifact_id: artifact.id, artifact_fingerprint: artifact.version_fingerprint, approved, company: job.company, role: job.role, posting_url: job.canonical_url ?? job.original_url ?? job.context_url }];
    });
    const undone = (database.db.prepare("SELECT result FROM mutation_receipts WHERE operation='automatic_repair_undo'").all() as { result: string }[]).map(row => JSON.parse(row.result).repair_id);
    const repairs = (database.db.prepare('SELECT payload FROM preparation_repairs ORDER BY rowid').all() as { payload: string }[]).map(row => JSON.parse(row.payload) as AutomaticRepairRecord).filter(repair => batch.members.some(m => m.job_id === repair.job_id && m.input_snapshot_id === repair.input_snapshot_id)).map(repair => ({ ...repair, undone: undone.includes(repair.id) }));
    const decisions = (database.db.prepare('SELECT payload FROM preparation_decisions ORDER BY rowid').all() as { payload: string }[]).map(row => JSON.parse(row.payload)).filter(value => batch.members.some(m => m.job_id === value.job_id));
    return { batch, members, queue, repairs, decisions, counts: { preparing: members.filter(m => ['pending', 'running'].includes(m.state)).length,
      questions: members.filter(m => ['question', 'later'].includes(m.state)).length, technical: members.filter(m => m.state === 'technical').length,
      ready: queue.filter(q => !q.approved).length, approved: queue.filter(q => q.approved).length } };
  };
  const undoRepair = (jobId: string, repairId: string, request: { expected_revision: number; idempotency_key: string }) => {
    const result = repository.withReceipt('automatic_repair_undo', request.idempotency_key, { jobId, repairId, ...request }, () => {
      const job = repository.getJob(jobId);
      if (job.revision !== request.expected_revision || repository.active().some(a => a.job_id === jobId)) throw new RepositoryError('revision_conflict', 'Job changed. Reload before undoing this wording.');
      const row = database.db.prepare('SELECT payload FROM preparation_repairs WHERE id=? AND job_id=?').get(repairId, jobId) as { payload: string } | undefined;
      if (!row) throw new RepositoryError('not_found', 'Repair not found.');
      const repair = JSON.parse(row.payload) as AutomaticRepairRecord, artifactId = job.artifact_version_ids.at(-1);
      if (!artifactId) throw new RepositoryError('ineligible', 'Finish preparing before undoing a review change.');
      const view = artifacts.review(jobId, artifactId);
      if (view.artifact.input_snapshot_id !== repair.input_snapshot_id) throw new RepositoryError('revision_conflict', 'This repair belongs to different starting inputs.');
      const draft = view.working_draft ?? artifacts.continueEditing({ job_id: jobId, artifact_version_id: artifactId, artifact_fingerprint: view.artifact.version_fingerprint,
        expected_job_revision: job.revision, idempotency_key: `undo-fork:${request.idempotency_key}` });
      const candidate = structuredClone(draft.candidate);
      if (repair.original_target.experience_index >= 0) {
        const original = view.base_resume.experiences[repair.original_target.experience_index];
        const experiences = candidate.experiences.filter(e => e.company === original?.company && e.role === original.role && e.startDate === original.startDate);
        const bullets = experiences.flatMap(e => e.bullets.filter(b => b.text === repair.after));
        if (bullets.length !== 1) throw new RepositoryError('revision_conflict', 'The repaired wording changed or is ambiguous. Edit the current draft instead.');
        bullets[0].text = repair.before;
      } else if (candidate.summary === repair.after) candidate.summary = repair.before;
      else throw new RepositoryError('revision_conflict', 'The repaired summary changed. Edit the current draft instead.');
      const saved = new JobDraftRepository(repository).save({ ...draft, candidate }, draft.revision);
      return { draft: saved, repair_id: repairId };
    });
    if (!result.replayed) coordinator.edited(jobId, result.result.draft);
    return result;
  };
  return { repository, artifacts, intake, service, corpus, proposals, semantic, batches, coordinator, questions, prepareBatch, readBatch, undoRepair, captureInputs, assessFit, readFit, materials, exports, drafts, flushEvents,
    subscribeCorpus(listener: (event: { revision: number; update_ids: string[] }) => void) { monitor(); corpusListeners.add(listener); return () => { corpusListeners.delete(listener); }; },
    subscribe(listener: (event: C.JobEvent) => void) { monitor(); listeners.add(listener); return () => { listeners.delete(listener); }; },
    initialize() { monitor(); service.initialize(); coordinator.initialize(); },
dispose(): Promise<void> {
  if (!disposed) {
    clearInterval(timer); listeners.clear(); corpusListeners.clear();
    const stoppingCoordinator = coordinator.dispose();
    disposed = Promise.allSettled([stoppingCoordinator, drafts.dispose(), service.dispose(), semantic.dispose()]).then(results => {
      database.close();
      const failed = results.find((r): r is PromiseRejectedResult => r.status === 'rejected');
      if (failed) throw failed.reason;
    });
  }
  return disposed;
},
  };
}
export type JobsRuntime = ReturnType<typeof createJobsRuntime>;
/** Never send worker fencing credentials across a transport. */
export function publicJobsResult<T>(value: T): T { return JSON.parse(JSON.stringify(value, (key, v) => key === 'owner_token' ? undefined : v)); }
export function jobDetail(runtime: JobsRuntime, id: string) {
  const r = runtime.repository; const job = r.getJob(id);
  const review = runtime.proposals.read(id);
  const proposal_review = review.availability === 'available' ? { availability: review.availability, review_id: review.review.id, revision: review.review.revision, status: review.review.validation.status, blocking_count: review.review.validation.issues.filter(i => i.details.some(d => d.severity === 'block')).length, input_stale: review.input_stale } : { availability: review.availability, recoverable: review.recoverable };
  const activeInput = job.current_attempt_id ? r.getExecutionInput(r.getAttempt(job.current_attempt_id).input_snapshot_id) : null;
  return publicJobsResult({ job, activity: activeInput && activeInput.schema_version !== 1 ? activeInput.activity : 'resume', proposal_review, answers: [...r.listAnswers({ kind: 'candidate' }), ...(job.employer_id ? r.listAnswers({ kind: 'employer', employer_id: job.employer_id }) : []), ...r.listAnswers({ kind: 'job', job_id: id })], ...runtime.artifacts.preparationContext(job.current_attempt_id), posting: job.posting_snapshot_id ? r.getPostingSnapshot(job.posting_snapshot_id) : null, attempt: job.current_attempt_id ? r.getAttempt(job.current_attempt_id) : null, artifacts: job.artifact_version_ids.map(id => runtime.artifacts.getArtifact(id)), events: r.listEvents(id) });
}
