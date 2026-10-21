import type { PreparationQueueItem } from '@featherduster/core';
export interface ReviewQueuePass { activeJob: string | null; deferred: string[]; reviewed: string[] }
export const emptyReviewPass = (): ReviewQueuePass => ({ activeJob: null, deferred: [], reviewed: [] });
export const queueIdentity = (item: PreparationQueueItem) => `${item.job_id}:${item.artifact_id}:${item.artifact_fingerprint}`;
export function nextReviewItem(items: PreparationQueueItem[], pass: ReviewQueuePass) {
  return items.find(item => !item.approved && !pass.deferred.includes(queueIdentity(item)) && !pass.reviewed.includes(queueIdentity(item))) ?? null;
}
export function reconcileReviewPass(items: PreparationQueueItem[], pass: ReviewQueuePass): ReviewQueuePass {
  // Keep the job pinned even if its old artifact temporarily leaves the ready queue during editing.
  return pass.activeJob ? pass : { ...pass, activeJob: nextReviewItem(items, pass)?.job_id ?? null };
}
export function advanceReviewPass(items: PreparationQueueItem[], pass: ReviewQueuePass, item: PreparationQueueItem, action: 'approved' | 'later'): ReviewQueuePass {
  const identity = queueIdentity(item), key = action === 'approved' ? 'reviewed' : 'deferred';
  const next = { ...pass, activeJob: null, [key]: [...new Set([...pass[key], identity])] };
  return reconcileReviewPass(items, next);
}
