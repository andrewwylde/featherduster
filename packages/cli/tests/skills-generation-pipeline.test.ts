import { afterEach, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import * as C from '@featherduster/core';
import { automaticPreparationFixture } from './fixtures/automatic-preparation-fixture.js';
import { ProposalRepository } from '../src/jobs/proposal-repository.js';
import { fingerprint } from '../src/jobs/files.js';
import { automaticFixtureRunner } from '../../../scripts/automatic-resume-fixture.mjs';

const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => { for (const cleanup of cleanups.splice(0)) await cleanup(); });
const original = ['GitHub Actions', 'Docker', 'Cypress'];
const retained = ['GitHub Actions', 'Cypress'];
const operation = (inverted = false) => ({ id: 'delivery', type: 'skills.prune', target: { experience_index: -1, bullet_index: -1, skill_group_index: 0 }, before: original.join(', '), after: retained.join(', '), skills: inverted ? retained : ['Docker'], before_skills: original, result_skills: retained, allow_empty_group: false, order: [], citations: [], requirement_ids: [], rationale: 'Remove Docker.', source_bullets: [], claim_bindings: [] });

it('admits the shipped automatic case 2 fixture and repairs its duplicate/unknown reorder without adding capabilities', async () => {
  const f = automaticPreparationFixture(cleanup => cleanups.push(cleanup));
  f.spec.skills = [{ category: 'Engineering', skills: ['TypeScript', 'SQL'] }];
  f.spec.experiences = [{ company: 'Harbor Systems', role: 'Engineer', startDate: '2022', endDate: 'Present', bullets: [
    { text: 'Implemented caching.', citations: ['harbor-cache'] }, { text: 'Built release automation.', citations: ['harbor-release'] },
  ] }];
  for (const [id, summary] of [['harbor-cache', 'Implemented caching.'], ['harbor-release', 'Built release automation.']]) {
    f.evidence.add({ id, date: '2026-01-01', company: 'Harbor Systems', title: summary, summary, impact: 'Documented implementation', themes: [], confidence: 'verified', in_flight: false, metrics: [], internal_references: [] }, summary);
  }
  const dispatches: any[] = [], fixture = automaticFixtureRunner(dispatches);
  f.run.mockImplementation(request => fixture.run(request));
  const r = f.runtime(), preview = await r.intake.preview({ mode: 'text', input: 'AUTOMATIC_CASE_2 Senior Engineer role, product delivery.' });
  const job = r.repository.getJob(r.intake.commit(preview, randomUUID())[0].job_id!);
  const batch = r.prepareBatch({ members: [{ job_id: job.id, expected_revision: job.revision }], idempotency_key: randomUUID() }).result;
  await vi.waitFor(() => expect(r.batches.members(batch.id)[0].state).not.toMatch(/pending|running/), { timeout: 12000 });
  const view = r.proposals.read(job.id);
  expect(view.availability).toBe('available');
  if (view.availability !== 'available') throw Error('Fixture failed fresh admission before structural repair');
  const raw = dispatches.find(d => d.operation === 'proposals').result;
  expect(C.FreshProposalSetSchema.safeParse(raw).success).toBe(true);
  expect(view.generation.proposals.proposals.find(p => p.id === 'skills')).toMatchObject({ skills: ['SQL', 'SQL', 'Invented capability'], before_skills: ['TypeScript', 'SQL'], allow_empty_group: false });
  const skills = C.applyProposalPatches(view.generation.proposals.proposals, [], view.review.patches).proposals.find(p => p.id === 'skills')!;
  expect(skills).toMatchObject({ skills: ['SQL', 'TypeScript'], result_skills: ['SQL', 'TypeScript'], before_skills: ['TypeScript', 'SQL'], allow_empty_group: false });
  expect(view.review.candidate_preview.skills[0].skills).toEqual(['SQL', 'TypeScript']);
  expect(view.review.candidate_preview.experiences[0].bullets.map(b => b.text).join(' ')).not.toContain('Led implementation');
  const repairs = r.repository.database.db.prepare('SELECT payload FROM preparation_repairs WHERE job_id=?').all(job.id).map(row => JSON.parse((row as { payload: string }).payload));
  expect(repairs).toEqual(expect.arrayContaining([expect.objectContaining({ proposal_id: 'skills', after: JSON.stringify(['SQL', 'TypeScript']) })]));
  expect(dispatches.filter(d => d.operation === 'proposals')).toHaveLength(1);
  const member = r.batches.members(batch.id)[0];
  expect(r.batches.cycle(member.cycle_id).usage.calls).toBeLessThanOrEqual(r.repository.getInputSnapshot(member.input_snapshot_id).policy.max_model_calls);
  expect(dispatches.filter(d => ['analysis', 'alignment', 'proposals', 'brief'].includes(d.operation))).toHaveLength(4);
});

it.each([false, true])('runs the actual fresh wire-to-review path and rejects inverted=%s', async inverted => {
  const f = automaticPreparationFixture(cleanup => cleanups.push(cleanup));
  f.spec.skills = [{ category: 'Delivery', skills: original }];
  f.run.mockImplementation(async request => {
    if (request.schema.properties?.proposals) {
      const item = (request.schema.properties.proposals as any).items;
      expect(item.required).toEqual(expect.arrayContaining(['before_skills', 'result_skills', 'allow_empty_group']));
      expect(request.system).toContain(C.SYNTHESIS_POLICY);
      return { proposals: [operation(inverted)] };
    }
    return { company: '', role: '', seniority: '', mission: '', requirements: [], rows: [], proposals: [] };
  });
  const job = await f.add(), r = f.runtime();
  const batch = r.prepareBatch({ members: [{ job_id: job.id, expected_revision: job.revision }], idempotency_key: randomUUID() }).result;
  await vi.waitFor(() => expect(r.batches.members(batch.id)[0].state).not.toMatch(/pending|running/), { timeout: 12000 });
  const review = r.proposals.read(job.id);
  expect(review.availability).toBe('available');
  if (review.availability !== 'available') throw Error('Missing captured generation');
  expect(review.generation.generation_policy).toBe(C.SYNTHESIS_POLICY);
  expect(review.review.validation.status).toBe(inverted ? 'blocked' : 'ready');
  expect(review.review.candidate_preview.skills[0].skills).toEqual(inverted ? original : retained);
});

it('continues a saved accomplishments-1 review without regenerating proposals or relabeling checkpoints', async () => {
  const f = automaticPreparationFixture(cleanup => cleanups.push(cleanup));
  f.spec.skills = [{ category: 'Delivery', skills: original }];
  const r = f.runtime(), repo = r.repository, job = await f.add();
  const input = r.captureInputs(job.id, job.revision, { runner: 'fake' });
  repo.transitionPreparation(job.id, 'prepare', repo.getJob(job.id).revision, randomUUID());
  const attempt = repo.claimJob({ job_id: job.id, input_snapshot_id: input.id, mode: 'manual', stop_generation: 0, lease_ms: 30000, idempotency_key: randomUUID() }).result!;
  const fence = { attempt_id: attempt.id, owner_token: attempt.owner_token, stop_generation: attempt.stop_generation };
  for (const [stage, data] of [['preflight', true], ['analysis', { company: '', role: '', seniority: '', mission: '', requirements: [] }], ['alignment', { rows: [] }]] as const) {
    const id = randomUUID(), bytes = JSON.stringify({ schema_version: 1, generation_policy: 'accomplishments-1', stage, input_fingerprint: input.fingerprint, data });
    const ref = { id: `${repo.database.files.bundlePath('artifacts', job.id, id)}/checkpoint.json`, fingerprint: fingerprint(bytes) };
    repo.database.files.writeBundle('artifacts', job.id, id, { 'checkpoint.json': bytes });
    repo.saveCheckpoint({ schema_version: 1, id, workspace_id: job.workspace_id, job_id: job.id, attempt_id: attempt.id, completed_stage: stage, input_fingerprint: input.fingerprint, output_fingerprint: ref.fingerprint, output_references: [ref], completed_at: new Date().toISOString() }, fence);
  }
  const legacy = { ...operation(), before_skills: undefined, result_skills: undefined, allow_empty_group: undefined };
  const raw = JSON.stringify({ proposals: [legacy] }), id = randomUUID();
  const repository = new ProposalRepository(repo);
  const generation = repository.saveGeneration({ schema_version: 1, generation_policy: 'accomplishments-1', id, workspace_id: job.workspace_id, job_id: job.id, input_snapshot_id: input.id, input_fingerprint: input.fingerprint, attempt_id: attempt.id, raw_output: { id: `${repo.database.files.bundlePath('artifacts', job.id, id)}/raw-output.json`, fingerprint: fingerprint(raw) }, proposals: { proposals: C.normalizeGenerationProposals([legacy], 'accomplishments-1') }, created_at: new Date().toISOString() }, fence, raw);
  const review = r.proposals.initial(generation, fence);
  expect(review.validation.status).toBe('ready');
  repo.transitionPreparation(job.id, 'block', repo.getJob(job.id).revision, randomUUID(), fence);
  r.proposals.continue({ job_id: job.id, review_id: review.id, expected_job_revision: repo.getJob(job.id).revision, expected_review_revision: review.revision, input_fingerprint: input.fingerprint, validation_fingerprint: review.validation.fingerprint, idempotency_key: randomUUID() });
  await r.service.worker.whenIdle();
  expect(repo.getJob(job.id).preparation_state).toBe('resume_ready');
  expect(f.run).toHaveBeenCalledTimes(1);
  expect(f.run.mock.calls[0][0].system).toContain('Application policy accomplishments-1');
  const continued = repo.getJob(job.id).current_attempt_id!;
  for (const cp of repo.listCheckpoints(continued)) {
    const bytes = repo.database.files.readArtifact(cp.output_references[0], job.id);
    expect(JSON.parse(bytes.toString()).generation_policy).toBe('accomplishments-1');
  }
  expect(repository.getGeneration(generation.id)).toEqual(generation);
});
