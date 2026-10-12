import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import type { CAC } from 'cac';
import { z } from 'zod';
import { createJobsRuntime, jobDetail, publicJobsResult, type JobsRuntimeDependencies } from '../jobs/runtime.js';
import { jobFilters, preparationRequest } from '../jobs/routes.js';
import { previewPrototypeImport, commitPrototypeImport } from '../jobs/importer.js';
import { loadResumeSpecs, loadEvidenceStore, loadPrivacyRules } from '../server.js';

export interface JobsCommandOptions {
  workspace?: string; json?: boolean; idempotencyKey?: string;
  text?: boolean; file?: string; preview?: boolean;
  expectedRevision?: number | string; inputSnapshot?: string;
  format?: string; sourceNamespace?: string; limit?: number | string;
  preparationState?: string; applicationLifecycle?: string; kind?: string;
}
export interface JobsCommandDependencies extends Partial<JobsRuntimeDependencies> { runtimeFactory?: typeof createJobsRuntime }
const actions = ['add', 'list', 'get', 'prepare', 'resume', 'retry', 'stop', 'start', 'import', 'process'] as const;
export async function runJobsCommand(action: string, argument?: string, options: JobsCommandOptions = {}, dependencies: JobsCommandDependencies = {}) {
  let runtime: ReturnType<typeof createJobsRuntime> | undefined;
  let interrupted = false;
  const interrupt = () => { interrupted = true; void runtime?.dispose(); };
  try {
    z.enum(actions).parse(action);
    if (!['add', 'get', 'prepare', 'resume', 'retry', 'import'].includes(action) && argument !== undefined) throw new Error('Unexpected argument');
    const workspace = path.resolve(options.workspace ?? process.cwd());
    runtime = (dependencies.runtimeFactory ?? createJobsRuntime)(workspace, {
      loadResumes: () => loadResumeSpecs(workspace, false), loadEvidence: () => loadEvidenceStore(workspace), loadPrivacyRules: () => loadPrivacyRules(workspace), ...dependencies, automaticDrain: false,
    });
    const r = runtime.repository; const service = runtime.service;
    const key = z.string().trim().min(1).parse(options.idempotencyKey ?? randomUUID());
    let result: unknown; let exitCode = 0;
    if (['prepare', 'resume', 'retry', 'process'].includes(action)) { process.on('SIGINT', interrupt); process.on('SIGTERM', interrupt); }
    switch (action) {
      case 'add': {
        if (argument !== undefined && options.file) throw new Error('Use either an argument or --file');
        const input = options.file ? fs.readFileSync(path.resolve(options.file), 'utf8') : argument;
        const preview = await runtime.intake.preview({ mode: options.text ? 'text' : 'urls', input: z.string().min(1).parse(input) });
        if (options.preview) { result = preview; exitCode = preview.items.some(i => i.error) ? 1 : 0; }
        else { const items = runtime.intake.commit(preview, key); result = { items }; exitCode = items.some(i => i.error) ? 1 : 0; }
        break;
      }
      case 'list': {
        const filters = jobFilters.parse({ preparation_state: options.preparationState, application_lifecycle: options.applicationLifecycle, kind: options.kind });
        result = { jobs: r.listJobs().filter(j => Object.entries(filters).every(([k, v]) => v === undefined || j[k as keyof typeof j] === v)) }; break;
      }
      case 'get': result = jobDetail(runtime, z.string().uuid().parse(argument)); break;
      case 'start': result = { ...service.startAutomaticPreparation(key), message: 'Automatic preparation enabled; open a host or run jobs process to execute work.' }; break;
      case 'stop': result = service.stopProcessing(key); break;
      case 'import': {
        const request = z.object({ source_path: z.string().min(1), format: z.enum(['json', 'sqlite']), source_namespace: z.string().trim().min(1) }).parse({ source_path: argument, format: options.format, source_namespace: options.sourceNamespace });
        const preview = previewPrototypeImport(r, request);
        const items = options.preview ? preview.items : commitPrototypeImport(r, preview);
        result = { ...preview, items }; exitCode = preview.errors.length || items.some(i => i.error) ? 1 : 0; break;
      }
      case 'prepare': case 'resume': case 'retry': {
        const request = preparationRequest.parse({ expected_revision: options.expectedRevision === undefined ? undefined : Number(options.expectedRevision), input_snapshot_id: options.inputSnapshot, idempotency_key: key });
        const job_id = z.string().uuid().parse(argument);
        const receipt = service[action]({ ...request, job_id });
        await service.worker.whenIdle();
        if (interrupted) throw new Error('Interrupted');
        result = { receipt, ...jobDetail(runtime, job_id) };
        exitCode = r.getJob(job_id).preparation_state === 'resume_ready' ? 0 : 1; break;
      }
      case 'process': {
        const limit = z.number().int().positive().parse(Number(options.limit ?? 1));
        const selected = r.listJobs().filter(j => j.kind === 'job' && j.preparation_state === 'queued' && !j.missing_inputs.length && !['submitted', 'outcome_recorded', 'unknown'].includes(j.application_lifecycle)).slice(0, limit);
        const items: unknown[] = [];
        for (const job of selected) {
          if (interrupted) throw new Error('Interrupted');
          const control = r.getControl();
          if (control.stopped_at || control.pause_after_current || r.active().length) break;
          try {
            const fresh = r.getJob(job.id);
            const input = runtime.captureInputs(job.id, fresh.revision);
            service.prepare({ job_id: job.id, expected_revision: fresh.revision, input_snapshot_id: input.id, idempotency_key: randomUUID() });
            await service.worker.whenIdle();
            if (interrupted) throw new Error('Interrupted');
            const detail = jobDetail(runtime, job.id); items.push(detail);
            if (detail.job.preparation_state !== 'resume_ready') exitCode = 1;
          } catch (error) { items.push({ job_id: job.id, error: error instanceof Error ? error.message : String(error) }); exitCode = 1; break; }
        }
        result = { items }; break;
      }
    }
    return { result: publicJobsResult(result), exitCode: interrupted ? 1 : exitCode };
  } catch (error) { return { result: { error: error instanceof Error ? error.message : String(error) }, exitCode: 1 }; }
  finally { process.removeListener('SIGINT', interrupt); process.removeListener('SIGTERM', interrupt); await runtime?.dispose(); }
}
export function registerJobsCommand(cli: CAC): void {
  cli.command('jobs <action> [argument]', 'Manage durable jobs: add/list/get/prepare/resume/retry/stop/start/import/process')
    .option('-w, --workspace <dir>', 'Workspace directory').option('--json', 'Machine-readable JSON')
    .option('--idempotency-key <key>', 'Stable mutation key').option('--text', 'Posting prose input')
    .option('--file <path>', 'Read UTF-8 inbox').option('--preview', 'Preview without committing')
    .option('--expected-revision <revision>', 'Expected job revision').option('--input-snapshot <id>', 'Saved input snapshot')
    .option('--format <format>', 'Import format: json or sqlite').option('--source-namespace <name>', 'Stable import source')
    .option('--limit <count>', 'Maximum queued jobs to process').option('--preparation-state <state>', 'Filter preparation state')
    .option('--application-lifecycle <state>', 'Filter application lifecycle').option('--kind <kind>', 'Filter kind')
    .action(async (action: string, argument: string | undefined, options: JobsCommandOptions) => {
      const output = await runJobsCommand(action, argument, options);
      console.log(JSON.stringify(output.result, null, options.json ? undefined : 2));
      process.exitCode = output.exitCode;
    });
}
