import { afterEach, expect, it, vi } from 'vitest';
import { automaticPreparationFixture, installAutomaticContent } from './fixtures/automatic-preparation-fixture.js';
const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => { for (const cleanup of cleanups.splice(0)) await cleanup(); });
it('Undo creates a checked edit, resumes after a human answer, and leaves historical approval attached to its artifact', async () => {
  const f = automaticPreparationFixture(cleanup => cleanups.push(cleanup)); installAutomaticContent(f, 'qualifier');
  const job = await f.add(), r = f.runtime(), batch = r.prepareBatch({ members: [{ job_id: job.id, expected_revision: job.revision }], idempotency_key: 'qualifier' }).result;
  await vi.waitFor(() => expect(r.readBatch(batch.id).counts.ready).toBe(1), { timeout: 10000 });
  const artifact = r.artifacts.getArtifact(r.readBatch(batch.id).queue[0].artifact_id);
  const approve = (key: string) => r.artifacts.approveResume({ job_id: job.id, expected_job_revision: r.repository.getJob(job.id).revision,
    artifact_version_id: artifact.id, artifact_fingerprint: artifact.version_fingerprint, input_snapshot_id: artifact.input_snapshot_id,
    input_fingerprint: artifact.input_fingerprint, reviewer_id: 'local-human', idempotency_key: key });
  const approved = approve('approve'); expect(approve('another-delivery').id).toBe(approved.id);
  const repair = r.readBatch(batch.id).repairs.find(repair => repair.meaningful)!;
  r.undoRepair(job.id, repair.id, { expected_revision: r.repository.getJob(job.id).revision, idempotency_key: 'undo' });
  expect(() => approve('stale')).toThrow(/pending edits/);
  await vi.waitFor(() => expect(r.readBatch(batch.id).counts.questions).toBe(1), { timeout: 10000 });
  const group = r.questions.read(batch.id)[0];
  r.questions.answer(batch.id, group.id, { members: group.members, action: 'answer', assertion: 'I led this implementation.', confirmed: true, kind: 'confirmation', idempotency_key: 'human-answer' });
  await vi.waitFor(() => expect(r.readBatch(batch.id).queue.some(item => item.artifact_id !== artifact.id)).toBe(true), { timeout: 10000 });
  const current = r.readBatch(batch.id).queue[0]; expect(current).toBeDefined(); expect(current.approved).toBe(false);
  expect(r.repository.listEvents(job.id).filter(event => event.payload.kind === 'resume_review')).toHaveLength(1);
  expect(r.artifacts.review(job.id, current.artifact_id).draft.candidate.experiences[0].bullets[0].text).toBe('Led implementation of caching.');
  expect(r.repository.getJob(job.id).application_lifecycle).toBe('not_started');
}, 25000);
it('Stop prevents a late automatic draft check from publishing while preserving the saved edit', async () => {
  const f = automaticPreparationFixture(cleanup => cleanups.push(cleanup)), job = await f.add(), r = f.runtime();
  const batch = r.prepareBatch({ members: [{ job_id: job.id, expected_revision: job.revision }], idempotency_key: 'stop-draft' }).result;
  await vi.waitFor(() => expect(r.readBatch(batch.id).counts.ready).toBe(1), { timeout: 10000 });
  const artifact = r.artifacts.getArtifact(r.readBatch(batch.id).queue[0].artifact_id), current = r.repository.getJob(job.id);
  const draft = r.artifacts.continueEditing({ job_id: job.id, artifact_version_id: artifact.id, artifact_fingerprint: artifact.version_fingerprint, expected_job_revision: current.revision, idempotency_key: 'edit' });
  const saved = r.repository.saveDraft({ ...draft, candidate: { ...draft.candidate, profile: { ...draft.candidate.profile, title: 'Saved during Stop' } } }, draft.revision);
  let entered!: () => void, release!: () => void;
  const enteredPromise = new Promise<void>(resolve => { entered = resolve; }), gate = new Promise<void>(resolve => { release = resolve; });
  const original = f.deps.renderer.renderPdf;
  vi.spyOn(f.deps.renderer, 'renderPdf').mockImplementationOnce(async () => { entered(); await gate; return original(); });
  r.coordinator.edited(job.id, saved); await enteredPromise;
  r.service.stopProcessing('stop-during-render'); release(); await r.coordinator.whenIdle();
  expect(r.repository.getJob(job.id).artifact_version_ids).toEqual([artifact.id]);
  expect(r.repository.getLatestDraft(draft.id).candidate.profile.title).toBe('Saved during Stop');
  expect(r.repository.getControl().stopped_at).not.toBeNull();
}, 15000);
