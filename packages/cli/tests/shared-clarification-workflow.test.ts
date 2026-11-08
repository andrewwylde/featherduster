import { afterEach, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { tmpdir } from 'node:os';
import yaml from 'js-yaml';
import * as C from '@featherduster/core';
import { automaticPreparationFixture, installAutomaticContent } from './fixtures/automatic-preparation-fixture.js';
import { affectedClarificationDrafts, updateSelectedClarificationDrafts, undoClarificationUpdate } from '../src/jobs/clarification-updates.js';
import { openJobsDatabase } from '../src/jobs/database.js';
import { JobsRepository } from '../src/jobs/repository.js';
import { JobArtifactsService } from '../src/jobs/artifacts.js';
import { JobDraftRepository } from '../src/tailoring/drafts/repository.js';
import { CorpusRepository } from '../src/corpus/repository.js';
import { createJobsRuntime } from '../src/jobs/runtime.js';
import { fingerprint } from '../src/jobs/files.js';
import { getLatexTemplate } from '../src/jobs/templates.js';
import { JobSemanticService } from '../src/jobs/semantic-service.js';
const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => { for (const fn of cleanups.splice(0)) await fn(); });

function create52JobWorkspaceWithOneCorrection() {
  const root = fs.mkdtempSync(path.join(tmpdir(), 'clarification-bounded-'));
  const time = '2026-11-08T12:00:00.000Z';
  const db = openJobsDatabase(root);
  const repo = new JobsRepository(db, { now: () => time });
  const artifacts = new JobArtifactsService(repo, { now: () => time });
  const drafts = new JobDraftRepository(repo);
  const corpusRepo = new CorpusRepository(repo);

  const workId = fingerprint(JSON.stringify(['Acme', 'Engineer', '2020', 'Present', ['ev-work']]));
  const initialClarification: C.Clarification = {
    schema_version: 1, id: randomUUID(), job_id: randomUUID(), input_snapshot_id: randomUUID(), revision: 0,
    kind: 'confirmation', fact: { work_id: workId, predicate: 'feature-identity', qualifiers: [] }, claim_ids: ['claim-1'],
    question: 'Is this the same work?', assertion: 'AI Analytics was our name for this reporting feature.',
    actor: 'user', recorded_at: time, source_ids: ['ev-work'], confirmed: true,
    confirmed_claims: ['Implemented AI Analytics.'], supersedes: null,
  };
  const feedback1: C.FeedbackEvent = {
    schema_version: 1, id: randomUUID(), workspace_id: db.workspaceId,
    job_id: null, proposal_id: null, review_revision: null, kind: 'fact',
    before: 'AI Analytics was our name for this reporting feature.',
    after: 'AI Analytics was our name for this reporting feature.',
    explanation: 'Initial confirmation', recorded_at: time,
    scope: { kind: 'project', key: workId }, recorded_by: 'local-human',
  };
  const u1 = corpusRepo.apply(feedback1, {
    kind: 'clarification',
    value: {
      scope: { kind: 'project', key: workId }, clarification: initialClarification,
      sources: [{ evidence_id: 'ev-work', evidence_fingerprint: fingerprint('Implemented Time Spend reporting.'), quote: 'Implemented Time Spend reporting.' }],
      explanation: 'Initial confirmation',
    },
  }, 0, null);

  const correctionClarification: C.Clarification = {
    schema_version: 1, id: randomUUID(), job_id: initialClarification.job_id, input_snapshot_id: initialClarification.input_snapshot_id, revision: 1,
    kind: 'correction', fact: { work_id: workId, predicate: 'feature-identity', qualifiers: [] }, claim_ids: ['claim-1'],
    question: 'Is this the same work?', assertion: 'Its correct name is Time Spend reporting.',
    actor: 'user', recorded_at: time, source_ids: ['ev-work'], confirmed: true,
    confirmed_claims: ['Implemented Time Spend reporting.'], supersedes: initialClarification.id,
    corrected_assertion: 'AI Analytics was our name for this reporting feature.', effective_date: '2026-11-05',
  };
  const feedback2: C.FeedbackEvent = {
    schema_version: 1, id: randomUUID(), workspace_id: db.workspaceId,
    job_id: null, proposal_id: null, review_revision: null, kind: 'fact',
    before: 'AI Analytics was our name for this reporting feature.',
    after: 'Its correct name is Time Spend reporting.',
    explanation: 'Correction', recorded_at: time,
    scope: { kind: 'project', key: workId }, recorded_by: 'local-human',
  };
  corpusRepo.apply(feedback2, {
    kind: 'clarification',
    value: {
      scope: { kind: 'project', key: workId }, clarification: correctionClarification,
      sources: [{ evidence_id: 'ev-work', evidence_fingerprint: fingerprint('Implemented Time Spend reporting.'), quote: 'Implemented Time Spend reporting.' }],
      explanation: 'Correction',
    },
  }, u1.revision, u1.id);

  const spec: C.ResumeSpec = {
    profile: { name: 'Test', title: 'Engineer', email: 'test@example.com' },
    experiences: [{ company: 'Acme', role: 'Engineer', startDate: '2020', endDate: 'Present', bullets: [{ text: 'Implemented AI Analytics.', citations: ['ev-work'] }] }],
    education: [], skills: [],
  };
  const evidence = new C.EvidenceStore();
  evidence.add({
    id: 'ev-work', date: '2026-01-01', company: 'Acme', title: 'Work record', summary: 'Implemented Time Spend reporting.',
    impact: 'Documented work', themes: [], confidence: 'verified', in_flight: false, metrics: [], internal_references: []
  }, 'Implemented Time Spend reporting.');

  const runMock = vi.fn(async () => ({ company: '', role: '', seniority: '', mission: '', requirements: [], rows: [], proposals: [] }));
  const runtime = createJobsRuntime(root, {
    automaticDrain: false,
    loadResumes: () => [{ id: 'base', type: 'template', filePath: 'base.json', spec }],
    loadEvidence: () => evidence,
    loadPrivacyRules: () => ({}),
    runnerFactory: () => ({ id: 'fake' as const, model: 'fixture', label: 'Fixture', locality: 'local' as const, detect: async () => ({ available: true, detail: '' }), run: runMock }),
  });
  cleanups.push(async () => {
    await runtime.dispose();
    if (db.db.open) db.close();
    fs.rmSync(root, { recursive: true, force: true });
  });

  // Job 1: Affected job with an artifact containing resume.pdf
  const affectedJobId = randomUUID();
  const laterTime = '2026-11-08T12:01:00.000Z';
  const affectedJob: C.Job = {
    schema_version: 1, id: affectedJobId, workspace_id: db.workspaceId, revision: 0, kind: 'job',
    original_url: null, canonical_url: null, employer_id: null, external_job_id: null, company: 'Acme', role: 'Engineer',
    parent_discovery_id: null, posting_snapshot_id: null, preparation_state: 'queued', application_lifecycle: 'not_started',
    preparation_stage: null, base_resume_id: null, template_id: null, runner: null, policy_fingerprint: null,
    current_attempt_id: null, artifact_version_ids: [], missing_inputs: [], confirmation_provenance: [], state_reason: null,
    created_at: laterTime, updated_at: laterTime,
  };
  repo.createJob(affectedJob, 'create:affected');
  const posting1 = repo.savePostingSnapshot({ schema_version: 1, id: randomUUID(), workspace_id: db.workspaceId, job_id: affectedJobId, source_kind: 'text', original_url: null, final_url: null, retrieved_at: null, captured_at: time, text: 'Acme Engineer', content_fingerprint: fingerprint('Acme Engineer') });
  const capture1 = { job_id: affectedJobId, posting_id: posting1.id, base_resume: yaml.dump(spec), selected_evidence: [{ source_id: 'ev-work', bytes: 'Implemented Time Spend reporting.' }], privacy_rules: {}, template: getLatexTemplate('default'), runner_configuration: { runner: 'test', model: 'fixture' }, policy: { schema_version: 1 as const, mode: 'manual' as const, output_format: 'latex' as const, page_budget: 1, max_model_calls: 1, timeout_ms: 1000, max_repair_attempts: 0, model_retry_count: 0 } };
  const input1 = artifacts.captureInputs(capture1);
  const draft1 = drafts.create({ schema_version: 1, id: randomUUID(), workspace_id: db.workspaceId, job_id: affectedJobId, revision: 0, input_snapshot_id: input1.id, parent_artifact_version_id: null, candidate: spec, proposals: { proposals: [] }, created_at: time, updated_at: time });
  const attempt1 = repo.claimJob({ job_id: affectedJobId, input_snapshot_id: input1.id, mode: 'manual', stop_generation: 0, lease_ms: 10000, idempotency_key: randomUUID() }).result!;
  artifacts.publishCandidate({ draft_id: draft1.id, expected_draft_revision: 0, fence: { attempt_id: attempt1.id, owner_token: attempt1.owner_token, stop_generation: 0 }, source: 'tex', pdf: 'pdf bytes', previews: ['preview png'], validation_report: '{}', validation_result: 'passed' });
  db.db.prepare("UPDATE attempts SET status='completed' WHERE id=?").run(attempt1.id);

  // 51 Unaffected jobs (some with artifacts and PDFs, some saved)
  for (let i = 2; i <= 52; i++) {
    const unrelatedId = randomUUID();
    const unrelatedJob: C.Job = {
      schema_version: 1, id: unrelatedId, workspace_id: db.workspaceId, revision: 0, kind: 'job',
      original_url: null, canonical_url: null, employer_id: null, external_job_id: null, company: `Unrelated ${i}`, role: `Role ${i}`,
      parent_discovery_id: null, posting_snapshot_id: null, preparation_state: 'queued', application_lifecycle: 'not_started',
      preparation_stage: null, base_resume_id: null, template_id: null, runner: null, policy_fingerprint: null,
      current_attempt_id: null, artifact_version_ids: [], missing_inputs: [], confirmation_provenance: [], state_reason: null,
      created_at: time, updated_at: time,
    };
    repo.createJob(unrelatedJob, `create:unrelated:${i}`);
    if (i <= 5) {
      const unrelatedSpec: C.ResumeSpec = {
        profile: { name: `Unrelated ${i}`, title: 'Dev', email: `u${i}@example.com` },
        experiences: [{ company: `OtherCo ${i}`, role: 'Dev', startDate: '2021', endDate: '2022', bullets: [{ text: `Built unrelated feature ${i}.`, citations: [] }] }],
        education: [], skills: [],
      };
      const p = repo.savePostingSnapshot({ schema_version: 1, id: randomUUID(), workspace_id: db.workspaceId, job_id: unrelatedId, source_kind: 'text', original_url: null, final_url: null, retrieved_at: null, captured_at: time, text: `Posting ${i}`, content_fingerprint: fingerprint(`Posting ${i}`) });
      const inp = artifacts.captureInputs({ job_id: unrelatedId, posting_id: p.id, base_resume: yaml.dump(unrelatedSpec), selected_evidence: [], privacy_rules: {}, template: getLatexTemplate('default'), runner_configuration: { runner: 'test', model: 'fixture' }, policy: { schema_version: 1 as const, mode: 'manual' as const, output_format: 'latex' as const, page_budget: 1, max_model_calls: 1, timeout_ms: 1000, max_repair_attempts: 0, model_retry_count: 0 } });
      const d = drafts.create({ schema_version: 1, id: randomUUID(), workspace_id: db.workspaceId, job_id: unrelatedId, revision: 0, input_snapshot_id: inp.id, parent_artifact_version_id: null, candidate: unrelatedSpec, proposals: { proposals: [] }, created_at: time, updated_at: time });
      const att = repo.claimJob({ job_id: unrelatedId, input_snapshot_id: inp.id, mode: 'manual', stop_generation: 0, lease_ms: 10000, idempotency_key: randomUUID() }).result!;
      artifacts.publishCandidate({ draft_id: d.id, expected_draft_revision: 0, fence: { attempt_id: att.id, owner_token: att.owner_token, stop_generation: 0 }, source: 'tex', pdf: `unrelated pdf ${i}`, previews: ['preview png'], validation_report: '{}', validation_result: 'passed' });
      db.db.prepare("UPDATE attempts SET status='completed' WHERE id=?").run(att.id);
    }
  }

  const fsTracker = {
    readFile: (_filePath: string) => {},
  };
  const origReadArtifact = runtime.repository.database.files.readArtifact.bind(runtime.repository.database.files);
  runtime.repository.database.files.readArtifact = (ref, jobId, id) => {
    fsTracker.readFile(ref.id);
    return origReadArtifact(ref, jobId, id);
  };
  const origReadSnapshot = runtime.repository.database.files.readSnapshot.bind(runtime.repository.database.files);
  runtime.repository.database.files.readSnapshot = (ref, jobId, id) => {
    fsTracker.readFile(ref.id);
    return origReadSnapshot(ref, jobId, id);
  };

  return {
    fs: fsTracker,
    runtime,
    affectedJobId,
  };
}

async function setup() {
  const f = automaticPreparationFixture(cleanup => cleanups.push(cleanup));
  installAutomaticContent(f, 'feature');
  const jobs = await Promise.all([f.add(), f.add()]), r = f.runtime();
  const batch = r.prepareBatch({ members: jobs.map(j => ({ job_id: j.id, expected_revision: j.revision })), idempotency_key: randomUUID() }).result;
  await vi.waitFor(() => expect(r.readBatch(batch.id).counts.preparing).toBe(0), { timeout: 10000 });
  expect(r.readBatch(batch.id).counts.questions, JSON.stringify(jobs.map(j => r.repository.getJob(j.id)))).toBe(2);
  const answer = (jobId: string, assertion: string, extra: Partial<C.SaveFactClarification> = {}) => {
    const view = r.semantic.read(jobId, extra.target), fact = view.facts[0];
    return r.semantic.clarify(jobId, { target: view.target, expected_job_revision: view.job_revision, expected_semantic_revision: view.semantic_revision,
      input_fingerprint: view.input_fingerprint, idempotency_key: randomUUID(), claim_ids: [fact.claim.id], fact: fact.claim.fact,
      assertion, confirmed: true, kind: 'confirmation', source_ids: fact.evidence.map(q => q.evidence_id), supersedes: null,
      reuse: 'project', expected_corpus_revision: view.corpus_revision, ...extra });
  };
  return { f, r, jobs, answer, batch };
}

it('persists exact project answers across reload, reuses matching work and rejects implicit conflicts', async () => {
  const { f, r, jobs, answer } = await setup();
  const exact = '  AI Analytics was our name for this reporting feature.\nI built its interface.  ';
  const saved = answer(jobs[0].id, exact);
  expect(saved.clarifications[0].assertion).toBe(exact);
  expect(r.semantic.read(jobs[1].id).facts[0].resolution).toMatchObject({ provenance: 'human', explanation: exact });
  const before = r.corpus.repository.snapshot();
  const listJobs = vi.spyOn(r.repository, 'listJobs');
  expect(affectedClarificationDrafts(r)).toEqual({ corpus_revision: before.revision, jobs: [] });
  expect(listJobs).not.toHaveBeenCalled();
  listJobs.mockRestore();
  expect(() => answer(jobs[1].id, 'It was a different feature.')).toThrow(/explicit supersession/);
  expect(r.corpus.repository.snapshot()).toEqual(before);
  expect(r.semantic.store.clarifications(jobs[1].id, r.semantic.context(jobs[1].id).captured.input.id)).toHaveLength(0);
  const reopened = await f.reopen();
  expect(reopened.semantic.read(jobs[1].id).facts[0].resolution?.explanation).toBe(exact);
}, 15000);

it('rejects cross-claim shared corrections within the same work identity and saves the new answer separately', async () => {
  const { f, r, jobs, answer } = await setup();
  const prior = 'AI Analytics was the reporting feature.';
  answer(jobs[0].id, prior);
  const shared = r.corpus.repository.snapshot().updates[0];
  const run = f.run.getMockImplementation()!;
  f.run.mockImplementation(async request => {
    const result = await run(request) as any;
    for (const p of result.passages ?? []) for (const c of p.claims) c.fact.predicate = 'component_library';
    return result;
  });
  const view = r.proposals.read(jobs[0].id);
  if (view.availability !== 'available') throw Error('Missing review');
  r.proposals.correctBase({ job_id: jobs[0].id, review_id: view.review.id, expected_job_revision: r.repository.getJob(jobs[0].id).revision,
    expected_review_revision: view.review.revision, input_fingerprint: view.review.input_fingerprint,
    path: 'experiences.0.bullets.0.text', text: 'Implemented accessible components.', idempotency_key: randomUUID() });
  const facts = r.semantic.read(jobs[0].id);
  r.semantic.start(jobs[0].id, { target: facts.target, expected_job_revision: facts.job_revision, expected_semantic_revision: facts.semantic_revision,
    input_fingerprint: facts.input_fingerprint, reason: 'edit', idempotency_key: randomUUID() });
  await r.semantic.wait(jobs[0].id);
  expect(() => answer(jobs[0].id, 'I built keyboard navigation.', { kind: 'correction', corrected_assertion: prior,
    effective_date: '2026-11-06', supersedes_shared: shared.id })).toThrow(/active shared answer/);
  expect(r.corpus.repository.snapshot().updates).toHaveLength(1);
  answer(jobs[0].id, 'I built keyboard navigation.');
  const history = r.corpus.repository.snapshot();
  expect(history.updates).toHaveLength(2);
  expect(history.updates[1].supersedes).toBeNull();
  expect(C.activeCorpusUpdates(history)).toHaveLength(2);
  expect(r.semantic.read(jobs[1].id).facts[0].resolution?.explanation).toBe(prior);
}, 15000);

it('forks previously edited published drafts, preserves historical approval and blocks conflicting PDF reuse', async () => {
  const { r, jobs, answer, batch } = await setup();
  const prior = 'AI Analytics is the recorded reporting feature.';
  answer(jobs[0].id, prior);
  for (const j of jobs) r.coordinator.answered(j.id);
  await vi.waitFor(() => expect(r.readBatch(batch.id).counts.ready).toBe(2), { timeout: 10000 });
  const shared = r.corpus.repository.snapshot().updates[0];
  const fork = (jobId: string) => {
    const job = r.repository.getJob(jobId), artifact = r.artifacts.getArtifact(job.artifact_version_ids.at(-1)!);
    return r.artifacts.continueEditing({ job_id: jobId, artifact_version_id: artifact.id, artifact_fingerprint: artifact.version_fingerprint,
      expected_job_revision: job.revision, idempotency_key: randomUUID() });
  };
  let draft = fork(jobs[1].id);
  draft = r.repository.saveDraft({ ...draft, candidate: { ...draft.candidate, profile: { ...draft.candidate.profile, title: 'Unrelated user wording' } } }, draft.revision);
  const checked = await r.drafts.check(jobs[1].id, draft.id, draft.candidate);
  expect(checked.status).toBe('ready');
  const published = (await r.drafts.finalize(jobs[1].id, draft.id, { expected_job_revision: checked.job_revision, expected_draft_revision: draft.revision,
    binding: checked.binding, idempotency_key: randomUUID() })).artifact;
  r.artifacts.approveResume({ reviewer_id: 'local-human', job_id: jobs[1].id, expected_job_revision: r.repository.getJob(jobs[1].id).revision, artifact_version_id: published.id,
    artifact_fingerprint: published.version_fingerprint, input_snapshot_id: published.input_snapshot_id, input_fingerprint: published.input_fingerprint, idempotency_key: randomUUID() });
  const historical = r.artifacts.review(jobs[1].id, published.id).draft;
  let correction = fork(jobs[0].id);
  const candidate = C.replaceSelectedPassages(correction.candidate, [{ path: 'experiences.0.bullets.0.text', before: 'Implemented AI Analytics.', after: 'Implemented Time Spend reporting.' }]);
  correction = r.repository.saveDraft({ ...correction, candidate }, correction.revision);
  const target = { kind: 'draft' as const, draft_id: correction.id, candidate };
  const facts = r.semantic.read(jobs[0].id, target);
  r.semantic.start(jobs[0].id, { target, expected_job_revision: facts.job_revision, expected_semantic_revision: facts.semantic_revision,
    input_fingerprint: facts.input_fingerprint, reason: 'edit', idempotency_key: randomUUID() });
  await r.semantic.wait(jobs[0].id);
  answer(jobs[0].id, 'Its correct name is Time Spend reporting.', { target, kind: 'correction', corrected_assertion: prior, effective_date: '2026-11-05', supersedes_shared: shared.id });
  expect(() => r.exports.files(jobs[1].id, { artifact_id: published.id, artifact_fingerprint: published.version_fingerprint, dossier: false })).toThrow(/factual correction conflicts/);
  const affected = affectedClarificationDrafts(r), selected = affected.jobs.find(j => j.job_id === jobs[1].id)!;
  const key = randomUUID();
  const result = await updateSelectedClarificationDrafts(r, { expected_corpus_revision: affected.corpus_revision, idempotency_key: key,
    jobs: [{ job_id: selected.job_id, fingerprint: selected.fingerprint, edits: selected.edits.map(({ path, before, after }) => ({ path, before, after })) }] });
  expect(result.results[0].status, JSON.stringify(result)).toBe('ready');
  expect(r.repository.getLatestDraft(historical.id)).toEqual(historical);
  const current = r.repository.getJob(jobs[1].id), fresh = r.artifacts.review(jobs[1].id, current.artifact_version_ids.at(-1)!);
  expect(fresh.draft.candidate.profile.title).toBe('Unrelated user wording');
  expect(fresh.draft.candidate.experiences[0].bullets[0].text).toBe('Implemented Time Spend reporting.');
  expect(r.repository.listEvents(jobs[1].id).filter(e => e.payload.kind === 'resume_review')).toHaveLength(1);
  undoClarificationUpdate(r, `${key}:${jobs[1].id}`);
  expect(r.artifacts.review(jobs[1].id, fresh.artifact.id).working_draft?.candidate.experiences[0].bullets[0].text).toBe('Implemented AI Analytics.');
  expect(r.repository.getLatestDraft(fresh.draft.id)).toEqual(fresh.draft);
}, 25000);

it('keeps job-only and deferred answers local and idempotency keys bound to reuse intent', async () => {
  const { r, jobs, answer } = await setup();
  answer(jobs[0].id, 'I need to verify the feature name.', { confirmed: false, reuse: 'job' });
  expect(r.semantic.read(jobs[0].id).facts[0].resolution).toBeNull();
  expect(r.corpus.repository.snapshot().updates).toHaveLength(0);
  const key = randomUUID();
  answer(jobs[0].id, 'I built it.', { reuse: 'job', idempotency_key: key });
  expect(r.semantic.read(jobs[1].id).facts[0].resolution).toBeNull();
  expect(() => answer(jobs[0].id, 'I built it.', { reuse: 'project', idempotency_key: key })).toThrow(/idempotency|different request/i);
}, 15000);

it('corrects selected drafts only, preserves unrelated edits, rejects stale targets and supports replay and undo', async () => {
  const { r, jobs, answer } = await setup();
  const prior = 'This feature was called AI Analytics.';
  answer(jobs[0].id, prior);
  const shared = r.corpus.repository.snapshot().updates[0];
  const correct = (jobId: string, text: string) => {
    const view = r.proposals.read(jobId);
    if (view.availability !== 'available') throw Error('Missing review');
    return r.proposals.correctBase({ job_id: jobId, review_id: view.review.id, expected_job_revision: r.repository.getJob(jobId).revision,
      expected_review_revision: view.review.revision, input_fingerprint: view.review.input_fingerprint, path: 'experiences.0.bullets.0.text', text, idempotency_key: randomUUID() });
  };
  correct(jobs[0].id, 'Implemented Time Spend reporting.');
  const facts = r.semantic.read(jobs[0].id);
  r.semantic.start(jobs[0].id, { target: facts.target, expected_job_revision: facts.job_revision, expected_semantic_revision: facts.semantic_revision,
    input_fingerprint: facts.input_fingerprint, reason: 'edit', idempotency_key: randomUUID() });
  await r.semantic.wait(jobs[0].id);
  answer(jobs[0].id, 'The correct feature name is Time Spend reporting.', { kind: 'correction', corrected_assertion: prior, effective_date: '2026-11-05', supersedes_shared: shared.id });
  expect(r.semantic.read(jobs[1].id).facts[0]).toMatchObject({ state: 'needs_clarification', resolution: null });
  const affected = affectedClarificationDrafts(r);
  expect(affected.jobs.map(j => j.job_id)).toEqual([jobs[1].id]);
  const selection = affected.jobs[0];
  expect(selection.edits[0].after).toBe('Implemented Time Spend reporting.');
  const request = { expected_corpus_revision: affected.corpus_revision, idempotency_key: randomUUID(), jobs: [{ job_id: selection.job_id, fingerprint: 'stale', edits: selection.edits.map(({ path, before, after }) => ({ path, before, after })) }] };
  expect((await updateSelectedClarificationDrafts(r, request)).results[0].status).toBe('needs_retry');
  request.jobs[0].fingerprint = selection.fingerprint; request.idempotency_key = randomUUID();
  const original = r.semantic.context(jobs[1].id).candidate;
  const result = await updateSelectedClarificationDrafts(r, request);
  expect(result.results[0].status).toBe('ready');
  const changed = r.semantic.context(jobs[1].id).candidate;
  expect(changed).toEqual(C.replaceSelectedPassages(original, request.jobs[0].edits));
  expect((await updateSelectedClarificationDrafts(r, request)).results[0].status).toBe('ready');
  await vi.waitFor(() => expect(r.repository.getJob(jobs[1].id).artifact_version_ids).toHaveLength(1), { timeout: 10000 });
  const publishedId = r.repository.getJob(jobs[1].id).artifact_version_ids[0];
  const undone = undoClarificationUpdate(r, `${request.idempotency_key}:${jobs[1].id}`).result;
  expect('draft' in undone).toBe(true);
  if (!('draft' in undone)) throw Error('Undo must fork the published review');
  expect(undone.draft.candidate).toEqual(original);
  expect(r.artifacts.review(jobs[1].id, publishedId).draft.candidate).toEqual(changed);
  expect(r.semantic.read(jobs[1].id, { kind: 'draft', draft_id: undone.draft.id, candidate: undone.draft.candidate }).facts[0].resolution).toBeNull();
}, 15000);

it('bounds work during discovery with 52 saved jobs and does not read unrelated PDF bytes', async () => {
  const fixture = create52JobWorkspaceWithOneCorrection();
  const readSpy = vi.spyOn(fixture.fs, 'readFile');

  const result = await affectedClarificationDrafts(fixture.runtime);

  expect(result.jobs).toHaveLength(1);
  expect(result.jobs[0].job_id).toBe(fixture.affectedJobId);

  // Assert no PDF or heavy artifact byte reads occurred for unaffected jobs
  const pdfReads = readSpy.mock.calls.filter(([path]) => String(path).endsWith('.pdf'));
  expect(pdfReads).toHaveLength(0);
});

it('bounds work and returns pagination cursor when duration budget is exceeded', async () => {
  const fixture = create52JobWorkspaceWithOneCorrection();
  const capped = await affectedClarificationDrafts(fixture.runtime, { maxDurationMs: 0 });

  expect(capped.incomplete).toBe(true);
  expect(typeof capped.next_cursor).toBe('string');
  expect(capped.next_cursor?.length).toBeGreaterThan(0);
  expect(capped.jobs).toHaveLength(0);

  // Resuming from cursor with sufficient budget completes discovery and finds affected job placed after cursor
  const resumed = await affectedClarificationDrafts(fixture.runtime, { cursor: capped.next_cursor, maxDurationMs: 5000 });
  expect(resumed.incomplete).toBeUndefined();
  expect(resumed.jobs).toHaveLength(1);
  expect(resumed.jobs[0].job_id).toBe(fixture.affectedJobId);

  // Resuming specifically with cursor set to the affected job evaluates it without off-by-one skip
  const resumedExact = await affectedClarificationDrafts(fixture.runtime, { cursor: fixture.affectedJobId, maxDurationMs: 5000 });
  expect(resumedExact.jobs).toHaveLength(1);
  expect(resumedExact.jobs[0].job_id).toBe(fixture.affectedJobId);
});

it('allows confirming formal title without ledger quotation and reuses it for the same employment in another job', async () => {
  const root = fs.mkdtempSync(path.join(tmpdir(), 'clarification-reuse-'));
  const time = '2026-11-08T12:00:00.000Z';
  const db = openJobsDatabase(root);
  const fixtureRepo = new JobsRepository(db, { now: () => time });
  const artifacts = new JobArtifactsService(fixtureRepo, { now: () => time });
  const drafts = new JobDraftRepository(fixtureRepo);
  cleanups.push(async () => {
    if (db.db.open) db.close();
    fs.rmSync(root, { recursive: true, force: true });
  });

  const mockRunner = {
    id: 'fake' as const,
    model: 'fixture',
    label: 'Fixture',
    locality: 'local' as const,
    detect: async () => ({ available: true, detail: '' }),
    run: vi.fn(async () => ({ passages: [] })),
  };

  const specKong: C.ResumeSpec = {
    profile: { name: 'Test', title: 'Senior Software Engineer', email: 'test@example.com' },
    experiences: [{
      company: 'Kong',
      role: 'Senior Software Engineer',
      startDate: '2021',
      endDate: '2024',
      bullets: [{ text: 'Built gateway plugin architecture.', citations: [] }],
    }],
    education: [],
    skills: [],
  };

  const job1Id = randomUUID();
  const job1: C.Job = {
    schema_version: 1, id: job1Id, workspace_id: db.workspaceId, revision: 0, kind: 'job',
    original_url: null, canonical_url: null, employer_id: null, external_job_id: null, company: 'Kong', role: 'Senior Software Engineer',
    parent_discovery_id: null, posting_snapshot_id: null, preparation_state: 'saved', application_lifecycle: 'not_started',
    preparation_stage: null, base_resume_id: null, template_id: null, runner: null, policy_fingerprint: null,
    current_attempt_id: null, artifact_version_ids: [], missing_inputs: [], confirmation_provenance: [], state_reason: null,
    created_at: time, updated_at: time,
  };
  fixtureRepo.createJob(job1, 'create:job-1');
  const posting1 = fixtureRepo.savePostingSnapshot({ schema_version: 1, id: randomUUID(), workspace_id: db.workspaceId, job_id: job1Id, source_kind: 'text', original_url: null, final_url: null, retrieved_at: null, captured_at: time, text: 'Senior Software Engineer at Kong', content_fingerprint: fingerprint('Senior Software Engineer at Kong') });
  const input1 = artifacts.captureInputs({ job_id: job1Id, posting_id: posting1.id, base_resume: yaml.dump(specKong), selected_evidence: [], privacy_rules: {}, template: getLatexTemplate('default'), runner_configuration: { runner: 'test', model: 'fixture' }, policy: { schema_version: 1 as const, mode: 'manual' as const, output_format: 'latex' as const, page_budget: 1, max_model_calls: 1, timeout_ms: 1000, max_repair_attempts: 0, model_retry_count: 0 } });
  drafts.create({ schema_version: 1, id: randomUUID(), workspace_id: db.workspaceId, job_id: job1Id, revision: 0, input_snapshot_id: input1.id, parent_artifact_version_id: null, candidate: specKong, proposals: { proposals: [] }, created_at: time, updated_at: time });

  const job2Id = randomUUID();
  const job2: C.Job = {
    schema_version: 1, id: job2Id, workspace_id: db.workspaceId, revision: 0, kind: 'job',
    original_url: null, canonical_url: null, employer_id: null, external_job_id: null, company: 'Another Employer', role: 'Staff Engineer',
    parent_discovery_id: null, posting_snapshot_id: null, preparation_state: 'saved', application_lifecycle: 'not_started',
    preparation_stage: null, base_resume_id: null, template_id: null, runner: null, policy_fingerprint: null,
    current_attempt_id: null, artifact_version_ids: [], missing_inputs: [], confirmation_provenance: [], state_reason: null,
    created_at: time, updated_at: time,
  };
  fixtureRepo.createJob(job2, 'create:job-2');
  const posting2 = fixtureRepo.savePostingSnapshot({ schema_version: 1, id: randomUUID(), workspace_id: db.workspaceId, job_id: job2Id, source_kind: 'text', original_url: null, final_url: null, retrieved_at: null, captured_at: time, text: 'Staff Engineer', content_fingerprint: fingerprint('Staff Engineer') });
  const input2 = artifacts.captureInputs({ job_id: job2Id, posting_id: posting2.id, base_resume: yaml.dump(specKong), selected_evidence: [], privacy_rules: {}, template: getLatexTemplate('default'), runner_configuration: { runner: 'test', model: 'fixture' }, policy: { schema_version: 1 as const, mode: 'manual' as const, output_format: 'latex' as const, page_budget: 1, max_model_calls: 1, timeout_ms: 1000, max_repair_attempts: 0, model_retry_count: 0 } });
  drafts.create({ schema_version: 1, id: randomUUID(), workspace_id: db.workspaceId, job_id: job2Id, revision: 0, input_snapshot_id: input2.id, parent_artifact_version_id: null, candidate: specKong, proposals: { proposals: [] }, created_at: time, updated_at: time });

  const service = new JobSemanticService(fixtureRepo, mockRunner);

  // 1. Confirm title at Kong with no ledger quotations
  const answer = await service.saveHumanConfirmation({
    job_id: job1Id,
    employment: { employer: 'Kong', period: '2021 - 2024' },
    question: 'Was Senior Software Engineer your formal title at Kong?',
    confirmed_title: 'Senior Software Engineer',
    scope: 'remember_for_employment',
  });

  expect(answer.support_basis).toBe('human_confirmation');
  expect(answer.sources).toHaveLength(0);

  // 2. Classify a second job with Kong employment
  const secondJobResult = await service.resolveJobSupport(job2Id, { employer: 'Kong' });
  const titleClaim = secondJobResult.passages.find(p => p.text.includes('Senior Software Engineer'));
  expect(titleClaim?.status).toBe('supported');
  expect(titleClaim?.support_label).toBe('Confirmed by you');
});

