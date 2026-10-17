import { afterEach, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Hono } from 'hono';
import { EvidenceStore, parseEvidenceLedger } from '@featherduster/core';
import { createJobsRuntime } from '../src/jobs/runtime.js';
import { mountJobsRoutes } from '../src/jobs/routes.js';
import { sourceFingerprint } from '../src/corpus/load.js';

const cleanup: (() => Promise<void>)[] = [];
afterEach(async () => { vi.restoreAllMocks(); for (const fn of cleanup.splice(0)) await fn(); });
async function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'job-exports-'));
  const evidence = new EvidenceStore();
  parseEvidenceLedger(`entries:
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
    internal_references: [{ type: ticket, ref: PRIVATE-123 }]
`).forEach(e => evidence.add(e));
  expect(evidence.getAll()).toHaveLength(1);
  let rules: any = {};
  const spec = { profile: { name: 'Synthetic', title: 'Maintained APIs.', email: 'synthetic@example.com' }, experiences: [], education: [], skills: [] };
  fs.writeFileSync(path.join(root, 'base.yaml'), JSON.stringify(spec));
  const run = vi.fn(async (): Promise<unknown> => ({ company: '', role: '', seniority: '', mission: '', requirements: [], rows: [], proposals: [] }));
  const deps = { loadEvidence: () => evidence, loadResumes: () => [{ id: 'base', type: 'template', filePath: 'base.yaml', spec }], loadPrivacyRules: () => rules,
    runnerFactory: () => ({ id: 'fake' as const, model: 'fake', label: 'Test double', locality: 'local' as const, detect: async () => ({ available: true, detail: '' }), run }),
    renderer: { preflight: vi.fn(async () => ({ available: true, tools: [], diagnostics: [] })), renderPdf: vi.fn(async () => ({ status: 'passed' as const, source: 'exact validated latex', pdf: Buffer.from('synthetic test PDF'), previews: [{ page: 1, mimeType: 'image/png' as const, bytes: Buffer.from('test preview') }], report: { passed: true, pageCount: 1, pageBudget: 1, coverage: 1, missingFragments: [], diagnostics: [] }, diagnostics: [] })) } };
  const runtime = createJobsRuntime(root, deps);
  cleanup.push(async () => { await runtime.dispose(); fs.rmSync(root, { recursive: true, force: true }); });
  const job = runtime.intake.commit(await runtime.intake.preview({ mode: 'text', input: 'Synthetic needs API maintenance.', details: { company: 'Synthetic', role: 'Engineer' } }), 'save')[0].job!;
  const input = runtime.captureInputs(job.id, job.revision);
  runtime.service.prepare({ job_id: job.id, expected_revision: job.revision, input_snapshot_id: input.id, idempotency_key: 'resume' });
  await runtime.service.worker.whenIdle();
  const ready = runtime.repository.getJob(job.id); expect(ready.preparation_state).toBe('resume_ready');
  const artifact = runtime.artifacts.getArtifact(ready.artifact_version_ids[0]);
  const selection = { artifact_id: artifact.id, artifact_fingerprint: artifact.version_fingerprint, dossier: false };
  const app = new Hono(); mountJobsRoutes(app, () => runtime);
  return { root, runtime, deps, job, input, artifact, selection, run, evidence, app, privacy: (value: any) => { rules = value; } };
}
it('exports all resume formats from one binding, exact validated PDF/source and distinct captured private dossier; no model/render/approval side effects', async () => {
  const f = await fixture(), before = f.runtime.repository.listEvents(f.job.id);
  f.run.mockClear(); f.deps.renderer.renderPdf.mockClear();
  const result = f.runtime.exports.files(f.job.id, { ...f.selection, dossier: true });
  expect(result.files.map(f => f.name)).toEqual(['resume.pdf', 'resume.md', 'resume.txt', 'resume.html', 'resume.typ', 'resume.tex', 'confidential-dossier.md', 'confidential-dossier.html']);
  for (const file of result.files) expect(file.bytes.length).toBeGreaterThan(0);
  expect(result.files.find(f => f.name === 'resume.pdf')!.bytes.toString()).toBe('synthetic test PDF');
  expect(result.files.find(f => f.name === 'resume.tex')!.bytes.toString()).toBe('exact validated latex');
  expect(result.files.filter(f => f.confidential)).toHaveLength(2);
  expect(result.files.find(f => f.name === 'confidential-dossier.md')!.bytes.toString()).toContain('Strictly Confidential');
  const response = await f.app.request(`/api/jobs/${f.job.id}/exports/current/resume.html?selection=${encodeURIComponent(JSON.stringify(f.selection))}&download=1`);
  expect(response.status).toBe(200); expect(response.headers.get('Content-Disposition')).toContain('resume.html');
  expect(await response.text()).toContain('Synthetic');
  expect(f.run).not.toHaveBeenCalled(); expect(f.deps.renderer.renderPdf).not.toHaveBeenCalled(); expect(f.runtime.repository.listEvents(f.job.id)).toEqual(before);
});
it('saves actual files atomically, replays idempotently, reopens shelf, preserves history after privacy/input changes, rejects wrong-job and tampering', async () => {
  const f = await fixture();
  const release = f.runtime.exports.save(f.job.id, f.selection, 'release');
  expect(f.runtime.exports.save(f.job.id, f.selection, 'release')).toEqual(release);
  expect(f.runtime.exports.list(f.job.id)).toHaveLength(1);
  for (const file of release.files) expect(fs.readFileSync(path.join(f.root, file.reference.id)).length).toBeGreaterThan(0);
  await f.runtime.dispose(); const reopened = createJobsRuntime(f.root, f.deps);
  try {
    expect(reopened.exports.list(f.job.id)).toEqual([release]);
    f.privacy({ banned_keywords: ['Synthetic'] });
    expect(() => reopened.exports.files(f.job.id, f.selection)).toThrow(/Privacy rules changed/);
    expect(reopened.exports.content(f.job.id, release.id, 'resume.pdf').bytes.toString()).toBe('synthetic test PDF');
    const other = reopened.intake.commit(await reopened.intake.preview({ mode: 'text', input: 'Another role' }), 'other')[0].job!;
    expect(() => reopened.exports.content(other.id, release.id, 'resume.pdf')).toThrow(/not found/);
    fs.writeFileSync(path.join(f.root, release.files[0].reference.id), 'tampered');
    expect(() => reopened.exports.content(f.job.id, release.id, 'resume.pdf')).toThrow(/missing or changed/);
  } finally { await reopened.dispose(); }
});
it('blocks stale/wrong bindings and pending edits with actionable reasons but retains original review', async () => {
  const f = await fixture();
  expect(() => f.runtime.exports.files(f.job.id, { ...f.selection, artifact_fingerprint: 'wrong' })).toThrow(/Reload/);
  const draft = f.runtime.artifacts.continueEditing({ job_id: f.job.id, expected_job_revision: f.runtime.repository.getJob(f.job.id).revision, artifact_version_id: f.artifact.id, artifact_fingerprint: f.artifact.version_fingerprint, idempotency_key: 'fork' });
  f.runtime.repository.saveDraft({ ...draft, candidate: { ...draft.candidate, summary: 'New unvalidated words' } }, draft.revision);
  expect(() => f.runtime.exports.save(f.job.id, f.selection, 'pending')).toThrow(/pending edits/);
  expect(f.runtime.exports.list(f.job.id)).toEqual([]);
  expect(f.runtime.artifacts.content(f.job.id, f.artifact.id).toString()).toBe('synthetic test PDF');
});
it('rejects partial bundle publication without a shelf receipt and detects changed evidence', async () => {
  const f = await fixture();
  vi.spyOn(f.runtime.repository.database.files, 'writeBundle').mockImplementationOnce(() => { throw Error('Disk full'); });
  expect(() => f.runtime.exports.save(f.job.id, f.selection, 'disk')).toThrow('Disk full');
  expect(f.runtime.exports.list(f.job.id)).toEqual([]);
  f.evidence.add({ ...f.evidence.getAll()[0].entry, summary: 'Changed evidence' });
  expect(() => f.runtime.exports.files(f.job.id, f.selection)).toThrow(/Evidence or scoped support changed/);
});
it('includes reviewed letter and interview as separate real files with exact current resume/context binding', async () => {
  const f = await fixture();
  const p = { id: 'p', text: 'Maintained APIs.', claims: [{ text: 'Maintained APIs.', sources: [{ evidence_id: 'api', evidence_fingerprint: sourceFingerprint(f.evidence.getAll()[0]), quote: 'Maintained APIs.' }] }] };
  const letter = { kind: 'cover_letter', paragraphs: [p] };
  const brief = { kind: 'interview_brief', stories: [{ id: 's', resume_claim: { path: 'profile.title', text: 'Maintained APIs.' }, situation: p, contribution: p, outcome: p, tradeoffs: p }], questions: [{ question: 'What did you maintain?', answer: p }], gaps: [] };
  const selection = { ...f.selection, cover_letter: '', interview_brief: '' };
  for (const [kind, content] of [['cover_letter', letter], ['interview_brief', brief]] as const) {
    f.run.mockResolvedValue(content);
    f.runtime.assessFit(f.job.id, { expected_revision: f.runtime.repository.getJob(f.job.id).revision, evidence_ids: ['api'], idempotency_key: kind }, kind);
    await f.runtime.service.worker.whenIdle();
    const current = f.runtime.materials.read(f.job.id, kind).current!;
    expect(() => f.runtime.exports.files(f.job.id, { ...f.selection, [kind]: current.id })).toThrow(/Review/);
    selection[kind] = f.runtime.materials.review(f.job.id, kind, { expected_revision_id: current.id, idempotency_key: `review-${kind}` }).result.id;
  }
  f.run.mockClear();
  const release = f.runtime.exports.save(f.job.id, selection, 'all-materials');
  expect(release.files).toHaveLength(12);
  expect(f.runtime.exports.content(f.job.id, release.id, 'cover_letter.md').bytes.toString()).toBe('Maintained APIs.');
  expect(f.runtime.exports.content(f.job.id, release.id, 'interview_brief.html').bytes.toString()).toContain('My contribution: Maintained APIs.');
  expect(f.run).not.toHaveBeenCalled();
});

it('blocks changed job scope and newer captured inputs without deleting saved releases', async () => {
  const f = await fixture();
  const saved = f.runtime.exports.save(f.job.id, f.selection, 'before-change');
  const job = f.runtime.repository.getJob(f.job.id);
  f.runtime.repository.saveDetails(job.id, { expected_revision: job.revision, idempotency_key: 'role', changes: { role: 'Different role' } });
  expect(() => f.runtime.exports.files(job.id, f.selection)).toThrow(/Job scope changed/);
  expect(f.runtime.exports.content(job.id, saved.id, 'release.json').bytes.toString()).toContain(f.artifact.id);
  const current = f.runtime.repository.getJob(job.id);
  f.runtime.repository.saveDetails(job.id, { expected_revision: current.revision, idempotency_key: 'restore-role', changes: { role: 'Engineer' } });
  f.runtime.captureInputs(job.id, f.runtime.repository.getJob(job.id).revision);
  expect(() => f.runtime.exports.files(job.id, f.selection)).toThrow(/starting inputs changed/);
  expect(f.runtime.exports.content(job.id, saved.id, 'resume.pdf').bytes.length).toBeGreaterThan(0);
});
it('one damaged release cannot hide a separate intact release', async () => {
  const f = await fixture();
  const first = f.runtime.exports.save(f.job.id, f.selection, 'first');
  const second = f.runtime.exports.save(f.job.id, f.selection, 'second');
  fs.writeFileSync(path.join(f.root, first.files[0].reference.id), 'damaged');
  expect(f.runtime.exports.list(f.job.id).find(r => r.id === first.id)?.unavailable_reason).toMatch(/missing or changed/);
  expect(f.runtime.exports.content(f.job.id, second.id, 'resume.pdf').bytes.toString()).toBe('synthetic test PDF');
});
