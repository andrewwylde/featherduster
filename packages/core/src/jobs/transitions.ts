import { ApplicationLifecycleSchema, PreparationStateSchema } from './schemas.js';
import type { ApplicationLifecycle, Job, PreparationState } from './schemas.js';

const preparationEdges: Record<string, { from: PreparationState[]; to: PreparationState }> = {
  prepare: { from: ['saved'], to: 'queued' },
  claim: { from: ['queued'], to: 'preparing' },
  block: { from: ['queued', 'preparing'], to: 'needs_input' },
  material_complete: { from: ['preparing'], to: 'saved' },
  fit_complete: { from: ['preparing'], to: 'saved' },
  complete: { from: ['preparing'], to: 'resume_ready' },
  fail: { from: ['preparing'], to: 'failed' },
  interrupt: { from: ['preparing'], to: 'interrupted' },
  skip: { from: ['queued', 'preparing'], to: 'skipped' },
  cancel: { from: ['queued', 'preparing', 'needs_input'], to: 'cancelled' },
  resume: { from: ['needs_input'], to: 'queued' },
  retry: { from: ['failed', 'interrupted', 'cancelled'], to: 'queued' },
  override: { from: ['skipped'], to: 'queued' },
  reprepare: { from: ['resume_ready'], to: 'queued' },
};
export type PreparationAction = 'prepare' | 'claim' | 'block' | 'complete' | 'fit_complete' | 'material_complete' | 'fail' | 'interrupt' | 'skip' | 'cancel' | 'resume' | 'retry' | 'override' | 'reprepare';
export type ApplicationTarget = ApplicationLifecycle;

/** Topology only: callers own transactions, readiness gates, attempts and events. */
export function transitionPreparation(job: Job, action: PreparationAction): Job {
  const state = PreparationStateSchema.parse(job.preparation_state);
  const edge = Object.prototype.hasOwnProperty.call(preparationEdges, action) ? preparationEdges[action] : undefined;
  if (!edge || !edge.from.includes(state)) throw new Error(`Invalid preparation action "${action}" from "${state}".`);
  return { ...job, preparation_state: edge.to };
}

const applicationEdges: Record<ApplicationLifecycle, ApplicationLifecycle[]> = {
  not_started: ['draft', 'needs_input', 'submitted', 'outcome_recorded', 'unknown'],
  draft: ['needs_input', 'submitted', 'outcome_recorded', 'unknown'],
  needs_input: ['draft', 'submitted', 'outcome_recorded', 'unknown'],
  submitted: ['outcome_recorded', 'unknown'],
  outcome_recorded: ['unknown'],
  unknown: ['not_started', 'draft', 'needs_input', 'submitted', 'outcome_recorded'],
};

/** Tracking is independent of preparation and never authorizes transmission. */
export function transitionApplication(job: Job, target: ApplicationTarget): Job {
  const from = ApplicationLifecycleSchema.parse(job.application_lifecycle);
  const to = ApplicationLifecycleSchema.parse(target);
  if (from !== to && !applicationEdges[from].includes(to)) throw new Error(`Invalid application transition from "${from}" to "${to}".`);
  return { ...job, application_lifecycle: to };
}
