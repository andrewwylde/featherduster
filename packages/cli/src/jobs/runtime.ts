import fs from 'node:fs';
import path from 'node:path';
import yaml from 'js-yaml';
import * as C from '@featherduster/core';
import { openJobsDatabase } from './database.js';
import { JobsRepository, RepositoryError } from './repository.js';
import { PostingIntakeService } from './intake.js';
import { JobArtifactsService } from './artifacts.js';
import { JobPreparation, type PreparationDependencies } from './preparation.js';
import { JobsService } from './service.js';
import { getLatexTemplate } from './templates.js';
import { LatexRenderer } from '../render/latex-renderer.js';
import { defaultRunnerFactory, type RunnerFactory } from '../runners/registry.js';
import type { RunnerId } from '../runners/types.js';
import { loadTailoringConfig } from '../tailoring/config.js';

export interface JobsRuntimeDependencies {
  loadResumes(): { id: string; type: string; filePath: string; spec: C.ResumeSpec }[];
  loadEvidence(): C.EvidenceStore;
  loadPrivacyRules(): C.PrivacyRulesConfig;
  runnerFactory?: RunnerFactory;
  renderer?: PreparationDependencies['renderer'];
  fetcher?: NonNullable<ConstructorParameters<typeof PostingIntakeService>[1]>['fetcher'];
  automaticDrain?: boolean;
}
export interface InputSelection { base_resume_id?: string; template_id?: string; runner?: RunnerId; evidence_ids?: string[] }
export function createJobsRuntime(workspace: string, deps: JobsRuntimeDependencies) {
  const database = openJobsDatabase(workspace);
  const repository = new JobsRepository(database);
  const artifacts = new JobArtifactsService(repository);
  const intake = new PostingIntakeService(repository, { fetcher: deps.fetcher });
  const listeners = new Set<(event: C.JobEvent) => void>();
  let cursor = (database.db.prepare('SELECT COALESCE(MAX(sequence),0) AS n FROM events').get() as { n: number }).n;
  let timer: ReturnType<typeof setInterval> | undefined;
  let disposed: Promise<void> | undefined;
  const flushEvents = () => {
    if (disposed) return;
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
  const captureInputs = (jobId: string, revision: number, selection: InputSelection = {}) => database.db.transaction(() => {
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
    if (!runner || !runner.model) return invalid('Configure a runner and model first');
    const all = deps.loadEvidence().getAll();
    const evidence = selection.evidence_ids ? selection.evidence_ids.map(id => all.find(e => e.id === id) ?? invalid(`Unknown evidence: ${id}`)) : all;
    return artifacts.captureInputs({ job_id: job.id, posting_id: job.posting_snapshot_id, base_resume: yaml.dump(base.spec), selected_evidence: evidence.map(e => ({ source_id: e.id, bytes: C.serializeEvidenceMarkdown(e, e.narrative) })), privacy_rules: deps.loadPrivacyRules(), template, runner_configuration: { runner: runner.id, model: runner.model }, policy: { schema_version: 1, mode: 'candidate', output_format: 'latex', page_budget: template.page_budget, max_model_calls: 4, max_repair_attempts: 0, model_retry_count: 0, timeout_ms: config.step_timeout_seconds * 4000 } });
  }).immediate();
  const preparation = new JobPreparation({ repository, artifacts, resolveRunner, hasConsent: runner => !!loadTailoringConfig(workspace).runner_consent[runner.id], renderer: deps.renderer ?? new LatexRenderer() });
  const service = new JobsService({ repository, preparation, automaticDrain: deps.automaticDrain, resolveInput: job => captureInputs(job.id, job.revision).id, onEvent: flushEvents });
  return { repository, artifacts, intake, service, captureInputs, flushEvents,
    subscribe(listener: (event: C.JobEvent) => void) { monitor(); listeners.add(listener); return () => { listeners.delete(listener); }; },
    initialize() { monitor(); service.initialize(); },
    dispose(): Promise<void> { if (!disposed) { clearInterval(timer); listeners.clear(); disposed = service.dispose().finally(() => database.close()); } return disposed; },
  };
}
export type JobsRuntime = ReturnType<typeof createJobsRuntime>;
/** Never send worker fencing credentials across a transport. */
export function publicJobsResult<T>(value: T): T { return JSON.parse(JSON.stringify(value, (key, v) => key === 'owner_token' ? undefined : v)); }
export function jobDetail(runtime: JobsRuntime, id: string) {
  const r = runtime.repository; const job = r.getJob(id);
  return publicJobsResult({ job, posting: job.posting_snapshot_id ? r.getPostingSnapshot(job.posting_snapshot_id) : null, attempt: job.current_attempt_id ? r.getAttempt(job.current_attempt_id) : null, artifacts: job.artifact_version_ids.map(id => runtime.artifacts.getArtifact(id)), events: r.listEvents(id) });
}
