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
async function fixture(posting = 'Synthetic needs API maintenance.') {
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
  - id: node
    date: '2026-01-02'
    company: Synthetic
    title: Migration
    summary: Led the Node.js migration.
    impact: Speed
    themes: [platform]
    confidence: verified
    in_flight: false
    metrics: []
    internal_references: []
  - id: team
    date: '2026-01-04'
    company: Synthetic
    title: Team
    summary: I led a team of 12 engineers.
    impact: Delivery
    themes: [platform]
    confidence: verified
    in_flight: false
    metrics: []
    internal_references: []
  - id: offsite
    date: '2026-01-03'
    company: Synthetic
    title: Backups
    summary: Built an off-site backup system.
    impact: Resilience
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
  const job = runtime.intake.commit(await runtime.intake.preview({ mode: 'text', input: posting }), 'save')[0].job!;
  const request = { expected_revision: job.revision, idempotency_key: 'generate', evidence_ids: ['api'] };
  const app = new Hono(); mountJobsRoutes(app, () => runtime);
  return { evidence, root, runtime, app, job, deps, run, runner, content, request, privacy: (v: any) => { privacy = v; } };
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
  expect((f.run.mock.calls.at(-1) as unknown as [{ system: string }])[0].system).toMatch(/Never write placeholders such as \[METRIC NEEDED\]/);
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

const HARBOR = 'Synthetic Harbor Tools is hiring a Platform Engineer. The role needs API maintenance and Kubernetes production operations.';
async function generated(f: Awaited<ReturnType<typeof fixture>>, content: unknown) {
  f.run.mockResolvedValueOnce(content);
  f.runtime.assessFit(f.job.id, f.request, 'cover_letter'); await f.runtime.service.worker.whenIdle();
  return f.runtime.materials.read(f.job.id, 'cover_letter').current!;
}
const issueKeys = (m: { validation: { issues: { passage_id: string; kind: string }[] } }) => m.validation.issues.map(i => `${i.passage_id}:${i.kind}`);

it('regression (v2 Sol letter): gap prose stays blocked, the gap-note channel checks, and gaps never export', async () => {
  const f = await fixture(HARBOR); const [claim] = f.content.paragraphs[0].claims;
  const observed = { kind: 'cover_letter', paragraphs: [
    { id: 'apis', text: 'Maintained APIs.', claims: [claim] },
    { id: 'evidence-gap', text: 'The supplied sources do not establish Kubernetes production operations.', claims: [] },
  ] };
  const blocked = await generated(f, observed);
  expect(issueKeys(blocked)).toEqual(['evidence-gap:unbound_text']);
  const letter = { kind: 'cover_letter' as const, paragraphs: [
    { id: 'opening', text: 'Dear hiring team, I would like to apply for the Platform Engineer role at Synthetic Harbor Tools.', claims: [], references: [{ text: 'Platform Engineer' }, { text: 'Synthetic Harbor Tools' }] },
    { id: 'apis', text: 'Your posting asks for API maintenance. I maintained APIs.', claims: [claim], references: [{ text: 'API maintenance' }] },
    { id: 'closing', text: 'Thank you for considering my application. I would welcome the opportunity to discuss the role. Sincerely,', claims: [], references: [] },
  ], gap_notes: [{ requirement_quote: 'Kubernetes production operations', transferable_evidence: [] }] };
  const saved = f.runtime.materials.save(f.job.id, 'cover_letter', { expected_revision_id: blocked.id, idempotency_key: 'structured', content: letter }).result;
  expect(saved.validation).toMatchObject({ status: 'checked', issues: [], version: 'extractive-materials-v2' });
  const reviewed = f.runtime.materials.review(f.job.id, 'cover_letter', { expected_revision_id: saved.id, idempotency_key: 'review' }).result;
  const text = f.runtime.materials.export(f.job.id, 'cover_letter', reviewed.id, 'text');
  expect(text).toContain('Platform Engineer role at Synthetic Harbor Tools');
  expect(text).not.toContain('Kubernetes');
  expect(f.run).toHaveBeenCalledTimes(1);
});

it('keeps unsupported experience blocked even when it borrows posting or connective wording', async () => {
  const f = await fixture(HARBOR); const [claim] = f.content.paragraphs[0].claims;
  const m = await generated(f, { kind: 'cover_letter', paragraphs: [
    { id: 'invented', text: 'I operated Kubernetes production operations.', claims: [], references: [] },
    { id: 'borrowed', text: 'My Kubernetes production operations.', claims: [], references: [{ text: 'Kubernetes production operations' }] },
    { id: 'metric', text: 'I led a team of 12 at Synthetic Harbor Tools.', claims: [], references: [{ text: 'Synthetic Harbor Tools' }] },
    { id: 'forged-reference', text: 'Your posting asks for a Kubernetes expert.', claims: [], references: [{ text: 'a Kubernetes expert' }] },
    { id: 'forged-claim', text: 'I maintained Kafka.', claims: [{ ...claim, text: 'maintained Kafka.' }], references: [] },
    { id: 'partial-word', text: 'Your posting asks for API maintenances.', claims: [], references: [{ text: 'API maintenance' }] },
    { id: 'control', text: 'Your posting asks for \u0001.', claims: [], references: [] },
  ], gap_notes: [{ requirement_quote: 'ten years of Rust', transferable_evidence: [] }] });
  expect(m.validation.status).toBe('blocked');
  expect(issueKeys(m)).toEqual(expect.arrayContaining([
    'invented:unbound_text', 'borrowed:unbound_text', 'metric:unbound_text',
    'forged-reference:posting_reference', 'forged-claim:unsupported_claim', 'letter-gap-0:requirement',
    'partial-word:unbound_text', 'control:unbound_text',
  ]));
});

it('does not let a reference named like an internal mark forge a posting reference next to a claim', async () => {
  const f = await fixture('Synthetic Harbor Tools is hiring a Claim Operations Engineer. The role needs API maintenance.'); const [claim] = f.content.paragraphs[0].claims;
  const m = await generated(f, { kind: 'cover_letter', paragraphs: [
    { id: 'forged', text: 'For: I maintained APIs at Synthetic Harbor Tools.', claims: [{ ...claim, text: 'Maintained APIs' }], references: [{ text: 'claim' }, { text: 'Synthetic Harbor Tools' }] },
  ] });
  const issue = m.validation.issues.find(i => i.passage_id === 'forged' && i.kind === 'unbound_text');
  expect(issue?.message).toContain('posting wording joined to an evidence claim');
});

it('keeps sentence terminators when removing a claim and checks word boundaries only at word edges', async () => {
  const f = await fixture(HARBOR); const [claim] = f.content.paragraphs[0].claims;
  const m = await generated(f, { kind: 'cover_letter', paragraphs: [
    { id: 'terminator', text: 'I maintained APIs. Your posting asks for API maintenance.', claims: [claim], references: [{ text: 'API maintenance' }] },
    { id: 'adjacent', text: 'Maintained APIs.Maintained APIs.', claims: [claim, claim], references: [] },
  ] });
  expect(issueKeys(m)).toEqual([]);
});

async function extraSources() {
  const f = await fixture(HARBOR);
  const src = (id: string, quote: string) => ({ evidence_id: id, evidence_fingerprint: sourceFingerprint(f.evidence.getAll().find(e => e.id === id)!), quote });
  const run = async (content: unknown) => { f.run.mockResolvedValueOnce(content); f.runtime.assessFit(f.job.id, { ...f.request, evidence_ids: ['api', 'node', 'offsite', 'team'] }, 'cover_letter'); await f.runtime.service.worker.whenIdle(); return f.runtime.materials.read(f.job.id, 'cover_letter').current!; };
  return { src, run };
}

it('keeps only trailing claim terminators so a dotted claim cannot move the sentence break', async () => {
  const { src, run } = await extraSources();
  const m = await run({ kind: 'cover_letter', paragraphs: [
    { id: 'node', text: 'I led the Node.js migration at Synthetic Harbor Tools.', claims: [{ text: 'led the Node.js migration', sources: [src('node', 'Led the Node.js migration.')] }], references: [{ text: 'Synthetic Harbor Tools' }] },
  ] });
  expect(m.validation.issues.find(i => i.passage_id === 'node' && i.kind === 'unbound_text')?.message).toContain('posting wording joined to an evidence claim');
});

it('treats in-word joiners as word characters so claims cannot match part of a word', async () => {
  const { src, run } = await extraSources();
  const off = src('offsite', 'Built an off-site backup system.');
  const m = await run({ kind: 'cover_letter', paragraphs: [
    { id: 'split', text: 'Built an on-site backup system.', claims: [{ text: 'Built an', sources: [off] }, { text: '-site backup system', sources: [off] }], references: [] },
  ] });
  expect(issueKeys(m)).toContain('split:unsupported_claim');
});

it('allows a sentence that begins with a claim after a posting-attributed sentence', async () => {
  const { src, run } = await extraSources();
  const m = await run({ kind: 'cover_letter', paragraphs: [
    { id: 'team', text: 'Your posting asks for API maintenance. I led a team of 12 engineers.', claims: [{ text: 'I led a team of 12 engineers.', sources: [src('team', 'I led a team of 12 engineers.')] }], references: [{ text: 'API maintenance' }] },
  ] });
  expect(issueKeys(m)).toEqual([]);
});

it('instructs one concise company/role letter with gap notes in one bounded call', async () => {
  const f = await fixture(HARBOR); f.runtime.assessFit(f.job.id, f.request, 'cover_letter'); await f.runtime.service.worker.whenIdle();
  expect(f.run).toHaveBeenCalledTimes(1);
  const [call] = f.run.mock.calls[0] as unknown as [{ system: string; schema: { required: string[] } }];
  expect(call.system).toMatch(/opening naming the role and company/);
  expect(call.system).toMatch(/gap_notes entry quoting that requirement/);
  expect(call.system).toMatch(/Do not present posting wording as your own experience/);
  expect(call.system).toMatch(/must attribute it to the posting/);
  expect(call.system).toMatch(/asks for X and for Y/);
  expect(call.system).toMatch(/as its own claim quoting/);
  expect(call.schema.required).toContain('gap_notes');
});

it('the prompt\'s example letter shape validates when filled with real posting and evidence wording', async () => {
  const f = await fixture(HARBOR); const [claim] = f.content.paragraphs[0].claims;
  f.run.mockResolvedValueOnce({ kind: 'cover_letter', paragraphs: [
    { id: 'opening', text: 'Dear hiring team, I would like to apply for the Platform Engineer role at Synthetic Harbor Tools.', claims: [], references: [{ text: 'Platform Engineer' }, { text: 'Synthetic Harbor Tools' }] },
    { id: 'requirement-1', text: 'Your posting asks for API maintenance and for Kubernetes production operations. I maintained APIs.', claims: [claim], references: [{ text: 'API maintenance' }, { text: 'Kubernetes production operations' }] },
    { id: 'closing', text: 'Thank you for considering my application. I would welcome the opportunity to discuss the role. Sincerely,', claims: [], references: [] },
  ], gap_notes: [] });
  f.runtime.assessFit(f.job.id, f.request, 'cover_letter'); await f.runtime.service.worker.whenIdle();
  expect(f.runtime.materials.read(f.job.id, 'cover_letter').current?.validation).toMatchObject({ status: 'checked', issues: [] });
});
