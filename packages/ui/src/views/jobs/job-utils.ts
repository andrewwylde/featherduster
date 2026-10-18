import type { Job, JobEvent } from '@featherduster/core';

/** "1 job", "2 jobs"; pass the plural when it is not the singular plus "s" (e.g. "job needs" / "jobs need"). */
export function pluralize(count: number, singular: string, plural = `${singular}s`): string {
  return `${count} ${count === 1 ? singular : plural}`;
}

/** Locale-formatted date and time for display; keep the ISO value in <time dateTime>. */
export function formatDateTime(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? iso : date.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}

export const jobFilters = ['All', 'Queued', 'Preparing', 'Needs input', 'Resume ready', 'Archived'] as const;
export type JobFilter = typeof jobFilters[number];

/** Reason codes the posting capture writes as `code: message`; see posting-fetcher and intake. */
const reasonDescriptions: Record<string, string> = {
  capture_failed: "We couldn't capture the posting from its link. Paste the posting text instead.",
  invalid_url: "The posting link isn't a valid web address. Paste the posting text instead.",
  blocked_destination: "That posting link points somewhere Featherduster won't fetch. Paste the posting text instead.",
  dns_error: "The posting's website couldn't be found. Paste the posting text instead.",
  redirect_error: "The posting link redirected too often or to a blocked address. Paste the posting text instead.",
  timeout: 'The posting took too long to load. Paste the posting text instead.',
  too_large: 'The posting page is too large to capture. Paste the posting text instead.',
  http_error: "The posting's website returned an error. Paste the posting text instead.",
  unsupported_content: "The posting link didn't return a readable web page. Paste the posting text instead.",
  network_error: "The posting couldn't be reached over the network. Paste the posting text instead.",
};
/** Only the whitelisted codes above are treated as codes. */
const knownReasonCode = (reason: string | null | undefined) => {
  const code = /^([a-z][a-z0-9_]*):\s/.exec(reason ?? '')?.[1];
  return code && Object.hasOwn(reasonDescriptions, code) ? code : null;
};
/** An unrecognised `snake_case: detail` reason is still an internal code and must not be shown raw. */
const looksLikeReasonCode = (reason: string) => /^[a-z][a-z0-9]*(?:_[a-z0-9]+)+:\s/.test(reason);

/** Human text for a job's state reason; raw `code: detail` reasons are never shown. */
export function describeStateReason(reason: string | null | undefined): string | null {
  if (!reason) return null;
  const code = knownReasonCode(reason);
  if (code) return reasonDescriptions[code];
  return looksLikeReasonCode(reason) ? 'Preparation stopped and needs a look. Check Posting and History for details.' : reason;
}

/** A failed URL capture the user has since fixed by pasting posting text, with no preparation started. */
export function hasRecoveredCapture(job: Job): boolean {
  return job.preparation_state === 'needs_input' && knownReasonCode(job.state_reason) !== null
    && Boolean(job.posting_snapshot_id) && !job.current_attempt_id && job.missing_inputs.length === 0;
}

/** The preparation state the UI presents; a recovered capture reads as an ordinary saved job. */
export function displayPreparationState(job: Job): Job['preparation_state'] {
  return hasRecoveredCapture(job) ? 'saved' : job.preparation_state;
}

export type PreparationAction = 'prepare' | 'resume' | 'retry' | 'reprepare';
/** The host action that starts preparation from the job's current state. A recovered capture is
 *  displayed as saved but is still needs_input on the host, which only accepts `resume` there. */
export function preparationActionFor(job: Job): PreparationAction | null {
  if (hasRecoveredCapture(job)) return 'resume';
  const state = job.preparation_state;
  return state === 'saved' || state === 'queued' ? 'prepare' : state === 'needs_input' ? 'resume' : state === 'resume_ready' ? 'reprepare'
    : state === 'failed' || state === 'interrupted' || state === 'cancelled' ? 'retry' : null;
}

/** The host cancels active work with this reason when the user chooses Stop processing. */
export function stoppedByUser(job: Pick<Job, 'state_reason'>): boolean {
  return job.state_reason === 'Processing stopped';
}
/** Guidance for a start the host refused because automatic work is stopped or paused. */
export function startPreventedHelp(message: string | null | undefined): string | null {
  return /processing is stopped or paused/i.test(message ?? '') ? 'Open Automatic work controls and choose Start automatic preparation, then try again.' : null;
}

/** Cancel only makes sense while work is queued or running. */
export function hasCancellableWork(job: Job): boolean {
  return job.preparation_state === 'queued' || job.preparation_state === 'preparing';
}

export function isNeedsInput(job: Job): boolean {
  if (hasRecoveredCapture(job)) return job.application_lifecycle === 'needs_input';
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
    case 'Archived':
      return job.preparation_state === 'skipped' || job.preparation_state === 'cancelled';
    default:
      return true;
  }
}

/** The API client aborts slow requests with a message that names the endpoint; never show that path. */
export function isRequestTimeout(error: unknown): boolean {
  return error instanceof Error && (error.name === 'TimeoutError' || /^Request timed out\b/.test(error.message));
}

const sentence = (text: string) => /[.!?…]$/.test(text.trim()) ? text.trim() : `${text.trim()}.`;

/** Plain, punctuated text for a failed request; timeouts get the caller's sentence. */
export function requestErrorMessage(error: unknown, options: { timeout: string; fallback: string }): string {
  if (isRequestTimeout(error)) return options.timeout;
  return sentence(error instanceof Error && error.message.trim() ? error.message : options.fallback);
}

const preparationEvents: Record<string, string> = {
  saved: 'Returned to saved', queued: 'Queued for preparation', preparing: 'Preparation started',
  needs_input: 'Preparation paused for your input', resume_ready: 'Resume ready for review', failed: 'Preparation failed',
  interrupted: 'Preparation interrupted', skipped: 'Preparation skipped', cancelled: 'Preparation cancelled',
};
const applicationStates: Record<string, string> = {
  not_started: 'not started', draft: 'in draft', needs_input: 'needing your input', submitted: 'submitted',
  outcome_recorded: 'outcome recorded', unknown: 'unknown',
};
const channelActions: Record<string, string> = {
  form_draft_prepared: 'Application form draft prepared', resume_attached: 'Resume attached', application_submitted: 'Application submitted',
  email_drafted: 'Email drafted', email_sent: 'Email sent', survey_completed: 'Survey completed', user_reported_outcome: 'Outcome reported',
};
export const actorLabel = (kind: string) => kind === 'user' ? 'You' : kind === 'worker' ? 'Background worker' : kind === 'import' ? 'Imported' : kind;

/** A short human description of a history event; raw fields belong in a "Details" disclosure. */
export function describeJobEvent(payload: JobEvent['payload']): string {
  switch (payload.kind) {
    case 'preparation_transition': return preparationEvents[payload.to] ?? 'Preparation status changed';
    case 'application_transition': return `Application marked as ${applicationStates[payload.to] ?? 'changed'}`;
    case 'proposal_review': return `Proposal review saved (revision ${payload.revision})`;
    case 'resume_finalized': return 'Edited resume finalized';
    case 'resume_review': return 'Resume approved (not an application submission)';
    case 'channel_action': return channelActions[payload.action] ?? 'Application activity recorded';
    case 'import_history': return `Imported from earlier history${payload.original_status ? ` · status ${payload.original_status}` : ''}`;
    default: return 'Job updated';
  }
}
