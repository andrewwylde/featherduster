import { afterEach, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { EvidenceStore, type ResumeSpec } from '@featherduster/core';
import { createApp } from '../src/server.js';
import { createJobsRuntime, type JobsRuntime } from '../src/jobs/runtime.js';
import { confirmJobFacts } from './fixtures/confirm-job-facts.js';

const cleanup: (() => Promise<void>)[] = [];
afterEach(async () => { for (const fn of cleanup.splice(0)) await fn(); });
const resume = (bullet: string): ResumeSpec => ({ profile: { name: 'Test', title: 'Engineer', email: 'a@b.com' }, experiences: [{ company: 'Acme', role: 'Engineer', startDate: '2020-01', endDate: '2024-01', bullets: [{ text: bullet }] }], education: [], skills: [] } as unknown as ResumeSpec);
function fixture() {
  const root = mkdtempSync(path.join(tmpdir(), 'jobs-base-'));
  mkdirSync(path.join(root, 'resumes/templates'), { recursive: true });
  const writeBase = (value: string | ResumeSpec) => writeFileSync(path.join(root, 'resumes/templates/base.json'), JSON.stringify(typeof value === 'string' ? resume(value) : value));
  writeBase('Reduced latency by 91%.');
  let runtime!: JobsRuntime;
  const run = vi.fn(async () => ({}));
  const rendered: ResumeSpec[] = [];
  const evidence = new EvidenceStore([{ entry: { id: 'ev-one', date: '2026-01-01', company: 'acme', title: 'Systems', summary: 'Built APIs', impact: 'Reliability', themes: [], confidence: 'verified', in_flight: false, metrics: [], internal_references: [] }, narrative: 'Improved service reliability for internal teams.' }]);
  const app = createApp(root, {
    jobsRuntimeFactory: (w, d) => runtime = createJobsRuntime(w, d),
    jobsDependencies: { automaticDrain: false, loadEvidence: () => evidence,
      runnerFactory: () => ({ id: 'fake', model: 'fake', label: 'Fake', locality: 'local', detect: async () => ({ available: true, detail: '' }), run }),
      renderer: { preflight: async () => ({ available: true, tools: [], diagnostics: [] }), renderPdf: async ({ spec }: { spec: ResumeSpec }) => { rendered.push(spec); return { status: 'passed', source: 'latex', pdf: Buffer.from('pdf'), previews: [{ page: 1, mimeType: 'image/png', bytes: Buffer.from('png') }], report: { passed: true, pageCount: 1, pageBudget: 1, coverage: 1, missingFragments: [], diagnostics: [] }, diagnostics: [] }; } } as never,
    },
  });
  cleanup.push(async () => { await app.disposeJobs(); rmSync(root, { recursive: true, force: true }); });
  const request = (url: string, body?: unknown, method = 'POST') => app.request(url, body === undefined ? undefined : { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const blocked = async () => {
    const p = await (await request('/api/jobs/preview', { mode: 'text', input: `Backend engineer opening ${randomUUID()}` })).json();
    const id = (await (await request('/api/jobs', { preview_id: p.preview_id, idempotency_key: randomUUID() })).json()).items[0].job_id as string;
    const job = runtime.repository.getJob(id);
    const input = (await (await request(`/api/jobs/${id}/inputs`, { expected_revision: job.revision })).json()).input_snapshot;
    run.mockResolvedValueOnce({ company: 'Acme', role: 'Engineer', seniority: '', mission: '', requirements: [{ id: 'r1', text: 'APIs', terms: ['APIs'], tier: 'must', quote: 'APIs' }] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ proposals: [{ id: 'p', type: 'summary.rewrite', target: {}, before: '', after: 'Built APIs.', citations: ['ev-one'], requirement_ids: ['r1'] }] });
    expect((await request(`/api/jobs/${id}/prepare`, { expected_revision: job.revision, input_snapshot_id: input.id, idempotency_key: randomUUID() })).status).toBe(202);
    await runtime.service.worker.whenIdle();
    run.mockReset();
    return { id, input, view: await (await request(`/api/jobs/${id}/proposals`)).json() };
  };
  const correct = (id: string, view: { review: { id: string; revision: number; input_fingerprint: string } }, text: string, extra: Record<string, unknown> = {}) => request(`/api/jobs/${id}/starting-resume`, {
    expected_job_revision: runtime.repository.getJob(id).revision, review_id: view.review.id, expected_review_revision: view.review.revision, input_fingerprint: view.review.input_fingerprint,
    path: 'experiences.0.bullets.0.text', text, idempotency_key: randomUUID(), ...extra,
  }, 'PUT');
  // Refresh inputs, then explicitly prepare them with synthetic responses that keep the review blocked on its proposal.
  const refreshAndPrepare = async (id: string, ready = false) => {
    const job = runtime.repository.getJob(id);
    const refreshed = await (await request(`/api/jobs/${id}/inputs`, { expected_revision: job.revision })).json();
    const term = ready ? 'APIs' : 'Kafka';
    run.mockResolvedValueOnce({ company: 'Acme', role: 'Engineer', seniority: '', mission: '', requirements: [{ id: 'r1', text: term, terms: [term], tier: 'must', quote: term }] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ proposals: [{ id: 'p', type: 'summary.rewrite', target: {}, before: '', after: `Built ${term}.`, citations: ['ev-one'], requirement_ids: ['r1'] }] });
    if (ready) run.mockResolvedValueOnce({});
    const action = job.preparation_state === 'resume_ready' ? 'reprepare' : job.preparation_state === 'needs_input' ? 'resume' : 'prepare';
    expect((await request(`/api/jobs/${id}/${action}`, { expected_revision: job.revision, input_snapshot_id: refreshed.input_snapshot.id, idempotency_key: randomUUID() })).status).toBe(202);
    await runtime.service.worker.whenIdle();
    return { refreshed, view: await (await request(`/api/jobs/${id}/proposals`)).json() };
  };
  return { root, request, run, rendered, blocked, correct, writeBase, refreshAndPrepare, runtime: () => runtime };
}
const baseBlockers = (review: { validation: { issues: { subject: { kind: string; path?: string }; details: { severity: string; message: string; kind?: string }[] }[] } }) => review.validation.issues.filter(i => i.subject.kind === 'candidate' && i.details.some(d => d.severity === 'block' && d.kind !== 'fact_review'));

it('rechecks a saved starting-resume correction in the active review without capturing inputs or invoking models', async () => {
  const f = fixture(); const { id, input, view } = await f.blocked();
  expect(baseBlockers(view.review).map(i => i.details[0].message)).toEqual(['Numbers not supported by cited verified evidence: 91%.']);
  const before = f.runtime().repository.getJob(id); const control = f.runtime().repository.getControl();
  const response = await f.correct(id, view, 'Improved service reliability for internal teams.');
  expect(response.status).toBe(200);
  const { result } = await response.json();
  expect(result.review).toMatchObject({ id: view.review.id, revision: view.review.revision + 1, input_snapshot_id: input.id, base_corrections: [{ path: 'experiences.0.bullets.0.text', before: 'Reduced latency by 91%.', after: 'Improved service reliability for internal teams.', recorded_by: 'local-human' }] });
  expect(baseBlockers(result.review)).toEqual([]);
  expect(result.review.validation.status).toBe('blocked');
  expect(result.review.validation.issues.some((i: any) => i.details.some((d: any) => d.kind === 'fact_review'))).toBe(true);
  expect(result.review.validation.fingerprint).not.toBe(view.review.validation.fingerprint);
  expect(result.job.revision).toBe(before.revision + 1);
  expect(result.job.recovery).toMatchObject({ kind: 'proposals' });
  const after = await (await f.request(`/api/jobs/${id}/proposals`)).json();
  expect(after).toMatchObject({ input_stale: false, latest_input_snapshot_id: input.id, review: { revision: view.review.revision + 1 } });
  expect(after.captured.base_resume.experiences[0].bullets[0].text).toBe('Reduced latency by 91%.');
  expect(f.run).not.toHaveBeenCalled();
  expect(f.runtime().repository.getControl()).toEqual(control);
  expect(f.runtime().repository.getJob(id).current_attempt_id).toBe(before.current_attempt_id);
  // Rechecking the saved revision reproduces the overlay-aware validation.
  const binding = { expected_job_revision: result.job.revision, expected_review_revision: result.review.revision, input_fingerprint: input.fingerprint };
  expect((await f.request(`/api/jobs/${id}/proposals/${view.review.id}/recheck`, binding)).status).toBe(200);
  // The validation fingerprint covers the overlay, so a forged correction cannot reuse a checked fingerprint.
  const proposals = f.runtime().proposals;
  const forged = proposals.evaluate(proposals.proposals.getGeneration(result.review.generation_id), { ...result.review, base_corrections: [{ ...result.review.base_corrections[0], after: 'Reduced latency by 99%.' }] });
  expect(forged.validation.fingerprint).not.toBe(result.review.validation.fingerprint);
  expect(forged.validation.status).toBe('blocked');
});

it('keeps an unsupported corrected passage blocked', async () => {
  const f = fixture(); const { id, view } = await f.blocked();
  const { result } = await (await f.correct(id, view, 'Reduced latency by 85%.')).json();
  expect(baseBlockers(result.review).map(i => i.details[0].message)).toEqual(['Numbers not supported by cited verified evidence: 85%.']);
  expect(result.review.validation.status).toBe('blocked');
});

it('continues with the effective starting resume so the corrected passage reaches the rendered resume', async () => {
  const f = fixture(); const { id, input, view } = await f.blocked();
  await f.correct(id, view, 'Improved service reliability for internal teams.');
  const result = confirmJobFacts(f.runtime(), id);
  f.run.mockResolvedValue({ summary: 'Brief', items: [] });
  const started = await f.request(`/api/jobs/${id}/proposals/${view.review.id}/continue`, { expected_job_revision: result.job.revision, expected_review_revision: result.review.revision, input_fingerprint: input.fingerprint, validation_fingerprint: result.review.validation.fingerprint, idempotency_key: randomUUID() });
  expect(started.status).toBe(202);
  await f.runtime().service.worker.whenIdle();
  expect(f.runtime().repository.getJob(id).preparation_state).toBe('resume_ready');
  expect(f.rendered.at(-1)!.experiences[0].bullets[0].text).toBe('Improved service reliability for internal teams.');
  const job = f.runtime().repository.getJob(id);
  const review = f.runtime().artifacts.review(id, job.artifact_version_ids.at(-1)!);
  expect(review.draft.candidate.experiences[0].bullets[0].text).toBe('Improved service reliability for internal teams.');
  expect(review.base_resume.experiences[0].bullets[0].text).toBe('Improved service reliability for internal teams.');
});

it('keeps real conflict detection for other clients and outdated review revisions', async () => {
  const f = fixture(); const { id, view } = await f.blocked();
  const key = randomUUID();
  const first = await f.correct(id, view, 'Built APIs.', { idempotency_key: key });
  expect(first.status).toBe(200);
  // An exact replay of the same intent returns the stored result.
  const replay = await f.request(`/api/jobs/${id}/starting-resume`, { expected_job_revision: f.runtime().repository.getJob(id).revision - 1, review_id: view.review.id, expected_review_revision: view.review.revision, input_fingerprint: view.review.input_fingerprint, path: 'experiences.0.bullets.0.text', text: 'Built APIs.', idempotency_key: key }, 'PUT');
  expect((await replay.json()).replayed).toBe(true);
  // A second client still bound to the old review revision conflicts.
  expect((await f.correct(id, view, 'Built APIs with tests.')).status).toBe(409);
  expect((await f.correct(id, view, 'Built APIs with tests.', { expected_job_revision: 0 })).status).toBe(409);
  expect((await f.correct(id, { review: { ...view.review, revision: view.review.revision + 1 } }, 'Built APIs.', { path: 'experiences.9.bullets.0.text' })).status).toBe(400);
  expect(f.run).not.toHaveBeenCalled();
});

it('keeps a job-local correction as overlay data through refresh, prepare, refresh, prepare and still allows revert', async () => {
  const f = fixture(); const { id, view } = await f.blocked();
  const fixedText = 'Improved service reliability for internal teams.';
  await f.correct(id, view, fixedText);
  for (let round = 0; round < 2; round++) {
    const { refreshed, view: next } = await f.refreshAndPrepare(id);
    // Snapshots capture the shared resume unchanged; the correction lives only in the review overlay.
    expect(f.runtime().artifacts.capturedContext(refreshed.input_snapshot.id).base_resume.experiences[0].bullets[0].text).toBe('Reduced latency by 91%.');
    expect(refreshed.unapplied_base_corrections).toEqual([]);
    expect(next).toMatchObject({ input_stale: false, latest_input_snapshot_id: refreshed.input_snapshot.id, review: { input_snapshot_id: refreshed.input_snapshot.id, base_corrections: [{ path: 'experiences.0.bullets.0.text', before: 'Reduced latency by 91%.', after: fixedText }] } });
    expect(baseBlockers(next.review)).toEqual([]);
    // The fresh generation was prompted with the effective starting resume.
    expect(JSON.stringify(f.run.mock.calls.at(-1))).toContain(fixedText);
    expect(JSON.stringify(f.run.mock.calls.at(-1))).not.toContain('91%');
  }
  const current = await (await f.request(`/api/jobs/${id}/proposals`)).json();
  const reverted = (await (await f.correct(id, current, 'Reduced latency by 91%.')).json()).result;
  expect(reverted.review.base_corrections).toEqual([]);
  expect(baseBlockers(reverted.review).map((i: { details: { message: string }[] }) => i.details[0].message)).toEqual(['Numbers not supported by cited verified evidence: 91%.']);
});

it('reports a correction as unapplied when the shared wording at its location changed', async () => {
  const f = fixture(); const { id, view } = await f.blocked();
  await f.correct(id, view, 'Built APIs.');
  f.writeBase('Reduced latency by 40%.');
  const { refreshed, view: next } = await f.refreshAndPrepare(id);
  expect(refreshed.unapplied_base_corrections).toMatchObject([{ path: 'experiences.0.bullets.0.text', before: 'Reduced latency by 91%.', after: 'Built APIs.' }]);
  expect(next.review.base_corrections ?? []).toEqual([]);
  expect(next.captured.base_resume.experiences[0].bullets[0].text).toBe('Reduced latency by 40%.');
});

it('anchors a carried correction to its employer when the shared resume reorders experiences with identical wording', async () => {
  const f = fixture();
  const job = (company: string) => ({ company, role: 'Engineer', startDate: '2020-01', endDate: '2024-01', bullets: [{ text: 'Reduced latency by 91%.' }] });
  const spec = (...companies: string[]) => ({ ...resume('x'), experiences: companies.map(job) }) as unknown as ResumeSpec;
  f.writeBase(spec('Acme', 'Globex'));
  const { id, view } = await f.blocked();
  const saved = (await (await f.correct(id, view, 'Improved service reliability for internal teams.')).json()).result;
  expect(saved.review.base_corrections[0].anchor).toEqual({ company: 'Acme', role: 'Engineer', startDate: '2020-01' });
  f.writeBase(spec('Globex', 'Acme'));
  const { view: swapped } = await f.refreshAndPrepare(id);
  expect(swapped.review.base_corrections).toMatchObject([{ path: 'experiences.1.bullets.0.text', after: 'Improved service reliability for internal teams.', anchor: { company: 'Acme' } }]);
  expect(baseBlockers(swapped.review).map((i: { subject: { path: string } }) => i.subject.path)).toEqual(['experiences.0.bullets.0.text']);
  // Two experiences that share an anchor are ambiguous: report, never guess.
  f.writeBase(spec('Acme', 'Acme'));
  const { refreshed, view: ambiguous } = await f.refreshAndPrepare(id);
  expect(refreshed.unapplied_base_corrections).toMatchObject([{ anchor: { company: 'Acme' } }]);
  expect(ambiguous.review.base_corrections ?? []).toEqual([]);
});

it('rejects leading-zero location aliases and oversized corrections', async () => {
  const f = fixture(); const { id, view } = await f.blocked();
  expect((await f.correct(id, view, 'Built APIs.', { path: 'experiences.00.bullets.0.text' })).status).toBe(400);
  expect((await f.correct(id, view, 'x'.repeat(8193))).status).toBe(400);
});

it('reports a stored overlay that no longer matches its captured wording as a clear invalid request', async () => {
  const f = fixture(); const { id } = await f.blocked();
  const repository = f.runtime().proposals.proposals;
  const review = repository.getActive(id)!;
  const forged = { ...review, revision: review.revision + 1, base_corrections: [{ path: 'experiences.0.bullets.0.text', before: 'Different captured wording.', after: 'Built APIs.', recorded_by: 'local-human', recorded_at: new Date().toISOString() }], validation: { ...review.validation, review_revision: review.revision + 1 } };
  repository.appendReview(forged, review.revision);
  const binding = { expected_job_revision: f.runtime().repository.getJob(id).revision, expected_review_revision: forged.revision, input_fingerprint: review.input_fingerprint };
  const recheck = await f.request(`/api/jobs/${id}/proposals/${review.id}/recheck`, binding);
  expect(recheck.status).toBe(400);
  expect((await recheck.json()).error).toMatch(/no longer matches/);
  expect((await f.correct(id, { review: { ...review, revision: forged.revision } }, 'Built APIs again.')).status).toBe(400);
  expect((await f.request(`/api/jobs/${id}/proposals`)).status).toBe(200);
});

it('publishes a fresh preparation after confirming facts about the carried correction', async () => {
  const f = fixture(); const { id, view } = await f.blocked();
  await f.correct(id, view, 'Improved service reliability for internal teams.');
  await f.refreshAndPrepare(id, true);
  expect(f.runtime().repository.getJob(id).preparation_state).toBe('needs_input');
  const result = confirmJobFacts(f.runtime(), id);
  f.run.mockResolvedValue({ summary: 'Brief', items: [] });
  f.runtime().proposals.continue({ job_id: id, review_id: result.review.id, expected_job_revision: result.job.revision,
    expected_review_revision: result.review.revision, input_fingerprint: result.review.input_fingerprint,
    validation_fingerprint: result.review.validation.fingerprint, idempotency_key: randomUUID() });
  await f.runtime().service.worker.whenIdle();
  const job = f.runtime().repository.getJob(id);
  expect(job.preparation_state).toBe('resume_ready');
  expect(f.rendered.at(-1)!.experiences[0].bullets[0].text).toBe('Improved service reliability for internal teams.');
  expect(f.runtime().artifacts.review(id, job.artifact_version_ids.at(-1)!).base_resume.experiences[0].bullets[0].text).toBe('Improved service reliability for internal teams.');
});
