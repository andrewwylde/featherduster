import { afterEach, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Hono } from 'hono';
import { EvidenceStore, parseEvidenceLedger } from '@featherduster/core';
import { createJobsRuntime } from '../src/jobs/runtime.js';
import { sourceFingerprint } from '../src/corpus/load.js';
import { mountJobsRoutes } from '../src/jobs/routes.js';

const cleanup: (() => Promise<void>)[] = [];
afterEach(async () => { for (const fn of cleanup.splice(0)) await fn(); });
async function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'job-materials-'));
  const evidence = new EvidenceStore();
  for (const e of parseEvidenceLedger(`entries:
  - id: api
    date: '2026-01-01'
    company: Synthetic
    title: API work
    summary: Maintained APIs.
    impact: Reliability
    themes: [platform]
    confidence: verified
    in_flight: false
    metrics: []
    internal_references: []
`)) evidence.add(e);
  const source = { evidence_id: 'api', evidence_fingerprint: sourceFingerprint(evidence.getAll()[0]), quote: 'Maintained APIs.' };
  const content = { kind: 'cover_letter' as const, paragraphs: [{ id: 'opening', text: 'Maintained APIs.', claims: [{ text: 'Maintained APIs.', sources: [source] }] }] };
  const run = vi.fn(async (): Promise<unknown> => content);
  const runner = { id: 'fake' as const, model: 'fake', label: 'Test double', locality: 'local' as const, detect: async () => ({ available: true, detail: '' }), run };
  let privacy: any = {};
  const deps = { loadEvidence: () => evidence, loadResumes: vi.fn(() => []), loadPrivacyRules: () => privacy, runnerFactory: () => runner,
    renderer: { preflight: vi.fn(async () => ({ available: true, tools: [], diagnostics: [] })), renderPdf: vi.fn(async () => ({ status: 'passed' as const, source: 'unit-test source', pdf: Buffer.from('unit-test PDF'), previews: [{ page: 1, mimeType: 'image/png' as const, bytes: Buffer.from('unit-test preview') }], report: { passed: true, pageCount: 1, pageBudget: 1, coverage: 1, missingFragments: [], diagnostics: [] }, diagnostics: [] })) } };
  const runtime = createJobsRuntime(root, deps);
  cleanup.push(async () => { await runtime.dispose(); fs.rmSync(root, { recursive: true, force: true }); });
  const job = runtime.intake.commit(await runtime.intake.preview({ mode: 'text', input: 'Synthetic needs API maintenance.' }), 'save')[0].job!;
  const request = { expected_revision: job.revision, idempotency_key: 'generate', evidence_ids: ['api'] };
  const app = new Hono(); mountJobsRoutes(app, () => runtime);
  return { root, runtime, app, job, deps, run, runner, content, request, privacy: (v: any) => { privacy = v; } };
}
it('generates explicitly through one bounded worker call, persists/checks/reviews without more calls, and reopens', async () => {
  const f = await fixture(); const url = `/api/jobs/${f.job.id}/materials/cover_letter`;
  expect((await f.app.request(url)).status).toBe(200); expect(f.run).not.toHaveBeenCalled();
  const response = await f.app.request(`${url}/generate`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(f.request) });
  expect(response.status).toBe(202); await f.runtime.service.worker.whenIdle();
  const view = f.runtime.materials.read(f.job.id, 'cover_letter');
  expect(view.current?.validation.status).toBe('checked'); expect(view.stale_reasons).toEqual([]);
  expect(f.run).toHaveBeenCalledTimes(1); expect(f.deps.loadResumes).not.toHaveBeenCalled();
  expect(f.runtime.repository.getJob(f.job.id).preparation_state).toBe('saved');
  const saved = f.runtime.materials.save(f.job.id, 'cover_letter', { expected_revision_id: view.current!.id, idempotency_key: 'edit', content: f.content }).result;
  expect(saved.parent_revision_id).toBe(view.current!.id);
  const reviewed = f.runtime.materials.review(f.job.id, 'cover_letter', { expected_revision_id: saved.id, idempotency_key: 'review' }).result;
  expect(reviewed.review?.revision_id).toBe(reviewed.id); expect(f.run).toHaveBeenCalledTimes(1);
  f.runtime.assessFit(f.job.id, f.request, 'cover_letter'); await f.runtime.service.worker.whenIdle(); expect(f.run).toHaveBeenCalledTimes(1);
  expect((await f.app.request(`/api/jobs/${f.job.id}`)).status).toBe(200);
  await f.runtime.dispose(); const reopened = createJobsRuntime(f.root, f.deps);
  try { expect(reopened.materials.read(f.job.id, 'cover_letter').history).toHaveLength(3); } finally { await reopened.dispose(); }
});
it('blocks unsupported prose, forged quotes, metrics and privacy on human edits; CAS cannot erase current text', async () => {
  const f = await fixture(); f.runtime.assessFit(f.job.id, f.request, 'cover_letter'); await f.runtime.service.worker.whenIdle();
  const first = f.runtime.materials.read(f.job.id, 'cover_letter').current!;
  const content = structuredClone(f.content); content.paragraphs[0].text = 'Invented 500% improvement for SecretClient';
  const saved = f.runtime.materials.save(f.job.id, 'cover_letter', { expected_revision_id: first.id, idempotency_key: 'bad', content }).result;
  expect(saved.validation.status).toBe('blocked');
  expect(() => f.runtime.materials.review(f.job.id, 'cover_letter', { expected_revision_id: saved.id, idempotency_key: 'review' })).toThrow(/checks/);
  expect(() => f.runtime.materials.save(f.job.id, 'cover_letter', { expected_revision_id: first.id, idempotency_key: 'stale', content: f.content })).toThrow(/changed/);
  expect(f.runtime.materials.read(f.job.id, 'cover_letter').current?.id).toBe(saved.id);
  f.privacy({ banned_keywords: ['SecretClient'] });
  expect(f.runtime.materials.read(f.job.id, 'cover_letter').stale_reasons).toContain('privacy');
});
it('requires an actual current resume for interview claim defense, with no runner call', async () => {
  const f = await fixture();
  expect(() => f.runtime.assessFit(f.job.id, f.request, 'interview_brief')).toThrow(/resume first/);
  expect(f.run).not.toHaveBeenCalled(); expect(f.runtime.repository.active()).toHaveLength(0);
});
it('Stop refuses admission; ignored abort cannot publish late material', async () => {
  const f = await fixture(); let entered!: () => void, release!: (v: unknown) => void;
  const started = new Promise<void>(r => { entered = r; });
  f.run.mockImplementationOnce(() => { entered(); return new Promise(r => { release = r; }); });
  f.runtime.assessFit(f.job.id, f.request, 'cover_letter'); await started;
  f.runtime.service.stopProcessing('stop'); await f.runtime.service.worker.whenIdle();
  release(f.content); await Promise.resolve();
  expect(f.runtime.materials.read(f.job.id, 'cover_letter').current).toBeNull();
  expect(() => f.runtime.assessFit(f.job.id, { ...f.request, expected_revision: f.runtime.repository.getJob(f.job.id).revision, idempotency_key: 'stopped' }, 'cover_letter')).toThrow(/stopped/);
});
it('a save made during generation wins instead of being replaced by late output', async () => {
  const f = await fixture(); f.runtime.assessFit(f.job.id, f.request, 'cover_letter'); await f.runtime.service.worker.whenIdle();
  const first = f.runtime.materials.read(f.job.id, 'cover_letter').current!;
  let entered!: () => void, release!: (v: unknown) => void;
  const started = new Promise<void>(r => { entered = r; });
  f.run.mockImplementationOnce(() => { entered(); return new Promise(r => { release = r; }); });
  f.runtime.assessFit(f.job.id, { ...f.request, expected_revision: f.runtime.repository.getJob(f.job.id).revision, idempotency_key: 'again' }, 'cover_letter'); await started;
  const saved = f.runtime.materials.save(f.job.id, 'cover_letter', { expected_revision_id: first.id, idempotency_key: 'during', content: f.content }).result;
  release(f.content); await f.runtime.service.worker.whenIdle();
  expect(f.runtime.materials.read(f.job.id, 'cover_letter').current?.id).toBe(saved.id);
  expect(f.runtime.repository.getJob(f.job.id).state_reason).toMatch(/edits were retained/);
});
it('interview defends actual current resume claims, exports reviewed prose only, and detects pending resume edits', async () => {
  const f = await fixture();
  const spec = { profile: { name: 'Synthetic', title: 'Maintained APIs.', email: 'synthetic@example.com' }, experiences: [], education: [], skills: [] };
  fs.writeFileSync(path.join(f.root, 'base.yaml'), JSON.stringify(spec));
  f.deps.loadResumes.mockReturnValue([{ id: 'base', type: 'template', filePath: 'base.yaml', spec }] as never);
  f.run.mockImplementation(async () => ({ company: '', role: '', seniority: '', mission: '', requirements: [], rows: [], proposals: [] }));
  const input = f.runtime.captureInputs(f.job.id, f.job.revision);
  f.runtime.service.prepare({ job_id: f.job.id, expected_revision: f.job.revision, input_snapshot_id: input.id, idempotency_key: 'resume' });
  await f.runtime.service.worker.whenIdle();
  const ready = f.runtime.repository.getJob(f.job.id); expect(ready.preparation_state).toBe('resume_ready');
  const p = f.content.paragraphs[0];
  const brief = { kind: 'interview_brief' as const, stories: [{ id: 'story', resume_claim: { path: 'profile.title', text: 'Maintained APIs.' }, situation: p, contribution: p, outcome: p, tradeoffs: p }], questions: [{ question: 'What did you maintain?', answer: p }], gaps: [] };
  f.run.mockResolvedValue(brief);
  f.runtime.assessFit(f.job.id, { ...f.request, expected_revision: ready.revision }, 'interview_brief');
  await f.runtime.service.worker.whenIdle();
  const material = f.runtime.materials.read(f.job.id, 'interview_brief').current!;
  expect(material.validation.status).toBe('checked'); expect(material.resume).not.toBeNull();
  expect(f.runtime.repository.getJob(f.job.id).preparation_state).toBe('resume_ready');
  const reviewed = f.runtime.materials.review(f.job.id, 'interview_brief', { expected_revision_id: material.id, idempotency_key: 'review' }).result;
  const text = f.runtime.materials.export(f.job.id, 'interview_brief', reviewed.id, 'text');
  expect(text).toContain('My contribution: Maintained APIs.'); expect(text).not.toContain('evidence_fingerprint');
  expect(f.runtime.materials.export(f.job.id, 'interview_brief', reviewed.id, 'html')).toContain('<!doctype html>');
  const artifact = f.runtime.artifacts.getArtifact(ready.artifact_version_ids[0]);
  const draft = f.runtime.artifacts.continueEditing({ job_id: f.job.id, expected_job_revision: f.runtime.repository.getJob(f.job.id).revision, artifact_version_id: artifact.id, artifact_fingerprint: artifact.version_fingerprint, idempotency_key: 'fork' });
  f.runtime.repository.saveDraft({ ...draft, candidate: { ...draft.candidate, profile: { ...draft.candidate.profile, title: 'Changed current claim' } } }, draft.revision);
  expect(f.runtime.materials.read(f.job.id, 'interview_brief').stale_reasons).toContain('resume');
  expect(() => f.runtime.materials.export(f.job.id, 'interview_brief', reviewed.id, 'text')).toThrow(/current checked/);
  expect(f.runtime.repository.getJob(f.job.id).artifact_version_ids).toEqual(ready.artifact_version_ids);
});
