import { expect, it } from 'vitest';
import { advanceReviewPass, emptyReviewPass, reconcileReviewPass } from '../src/views/jobs/resume-review-queue-model.js';
const items = ['selected-b', 'selected-a', 'selected-c'].map(job_id => ({ job_id, artifact_id: 'v1', artifact_fingerprint: 'hash', approved: false }));
it('preserves selection order without interrupting the displayed job as work becomes ready', () => {
  const pass = reconcileReviewPass([items[1]], emptyReviewPass());
  expect(reconcileReviewPass(items, pass).activeJob).toBe(items[1].job_id);
  expect(advanceReviewPass(items, pass, items[1], 'approved').activeJob).toBe(items[0].job_id);
});
it('terminates a deferred pass and requires fresh review of a new version', () => {
  let pass = reconcileReviewPass(items, emptyReviewPass());
  for (const item of items) pass = advanceReviewPass(items, pass, item, 'later');
  expect(pass.activeJob).toBeNull(); expect(pass.deferred).toHaveLength(3);
  expect(reconcileReviewPass(items, pass).activeJob).toBeNull();
  expect(reconcileReviewPass([{ ...items[0], artifact_id: 'v2' }, ...items.slice(1)], pass).activeJob).toBe(items[0].job_id);
});
it('keeps refreshing work pinned when no current approvable PDF exists', () => {
  expect(reconcileReviewPass([], { ...emptyReviewPass(), activeJob: 'editing' }).activeJob).toBe('editing');
});
