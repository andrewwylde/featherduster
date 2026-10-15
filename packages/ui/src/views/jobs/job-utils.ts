import type { Job } from '@featherduster/core';

export const jobFilters = ['All', 'Queued', 'Preparing', 'Needs input', 'Resume ready', 'Applied', 'Archived'] as const;
export type JobFilter = typeof jobFilters[number];

export function isNeedsInput(job: Job): boolean {
  return (
    job.preparation_state === 'needs_input' ||
    job.application_lifecycle === 'needs_input' ||
    (Array.isArray(job.missing_inputs) && job.missing_inputs.length > 0)
  );
}

export function isQueued(job: Job): boolean {
  return job.preparation_state === 'queued' && !isNeedsInput(job);
}

export function getJobPriority(job: Job): number {
  if (isNeedsInput(job)) return 0;
  if (isQueued(job)) return 1;
  return 2;
}

export function compareJobs(a: Job, b: Job, order: 'desc' | 'asc' = 'desc'): number {
  const priorityDiff = getJobPriority(a) - getJobPriority(b);
  if (priorityDiff !== 0) return priorityDiff;

  const timeA = a.created_at ? new Date(a.created_at).getTime() : 0;
  const timeB = b.created_at ? new Date(b.created_at).getTime() : 0;
  const validTimeA = Number.isNaN(timeA) ? 0 : timeA;
  const validTimeB = Number.isNaN(timeB) ? 0 : timeB;

  const dateDiff = order === 'desc' ? validTimeB - validTimeA : validTimeA - validTimeB;
  if (dateDiff !== 0) return dateDiff;

  return a.id.localeCompare(b.id);
}

export function matchesJobFilter(job: Job, filter: JobFilter | string): boolean {
  switch (filter) {
    case 'Queued':
      return isQueued(job);
    case 'Preparing':
      return job.preparation_state === 'preparing';
    case 'Needs input':
      return isNeedsInput(job);
    case 'Resume ready':
      return job.preparation_state === 'resume_ready';
    case 'Applied':
      return job.application_lifecycle === 'submitted';
    case 'Archived':
      return job.preparation_state === 'skipped' || job.preparation_state === 'cancelled';
    default:
      return true;
  }
}
