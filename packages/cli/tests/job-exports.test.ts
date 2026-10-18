import { openJobsDatabase } from '../src/jobs/database.js';
import { JobsRepository } from '../src/jobs/repository.js';
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
  const dossierMd = result.files.find(f => f.name === 'confidential-dossier.md')!.bytes.toString();
  expect(dossierMd).toContain('# 🛡️ Confidential Evidence Dossier (Private Candidate Preparation — Not the Interview Brief):');
  expect(dossierMd).not.toContain('# 🛡️ Interview Defense Brief:');
  expect(dossierMd).toContain('Strictly Confidential');
  const dossierHtml = result.files.find(f => f.name === 'confidential-dossier.html')!.bytes.toString();
  expect(dossierHtml).toContain('<h1>Confidential Evidence Dossier (Private Candidate Preparation — Not the Interview Brief):');
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
  const briefOnlySelection = { ...f.selection, interview_brief: selection.interview_brief, dossier: false };
  expect(f.runtime.exports.files(f.job.id, briefOnlySelection).files.some(x => x.confidential)).toBe(false);
  const deniedDossier = await f.app.request(`/api/jobs/${f.job.id}/exports/current/confidential-dossier.md?selection=${encodeURIComponent(JSON.stringify(briefOnlySelection))}`);
  expect(deniedDossier.status).toBe(404);
  const release = f.runtime.exports.save(f.job.id, selection, 'all-materials');
  expect(release.files).toHaveLength(12);
  expect(release.files.some(x => x.confidential)).toBe(false);
  expect(() => f.runtime.exports.content(f.job.id, release.id, 'confidential-dossier.md')).toThrow(/not found/);
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
async function editFixture() {
  const f = await fixture();
  const draft = f.runtime.artifacts.continueEditing({ job_id: f.job.id,
    expected_job_revision: f.runtime.repository.getJob(f.job.id).revision,
    artifact_version_id: f.artifact.id, artifact_fingerprint: f.artifact.version_fingerprint, idempotency_key: 'edit-job' });
  f.run.mockClear(); f.deps.renderer.renderPdf.mockClear();
  return { ...f, draft };
}
it('saves empty required text, checks reactively, then finalizes only the corrected version', async () => {
  const f = await editFixture();
  const candidate = structuredClone(f.draft.candidate); candidate.profile.name = '';
  const saved = await f.app.request(`/api/jobs/${f.job.id}/drafts/${f.draft.id}`, {
    method: 'PUT', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ expected_revision: f.draft.revision, candidate }),
  });
  expect(saved.status).toBe(200);
  expect(f.deps.renderer.renderPdf).not.toHaveBeenCalled();
  const blocked = await f.runtime.drafts.check(f.job.id, f.draft.id, candidate);
  expect(blocked.status).toBe('blocked');
  candidate.profile.name = 'Edited Name';
  const checked = await f.runtime.drafts.check(f.job.id, f.draft.id, candidate);
  expect(checked.status).toBe('ready');
  const latest = f.runtime.repository.getLatestDraft(f.draft.id);
  const next = f.runtime.repository.saveDraft({ ...latest, candidate }, latest.revision);
  const request = { expected_job_revision: checked.job_revision, expected_draft_revision: next.revision,
    binding: checked.binding, idempotency_key: 'finish-edits' };
  const first = await f.runtime.drafts.finalize(f.job.id, next.id, request);
  const replay = await f.runtime.drafts.finalize(f.job.id, next.id, request);
  expect(first.artifact.id).toBe(replay.artifact.id);
  const review = f.runtime.artifacts.review(f.job.id, first.artifact.id);
  expect(review.draft.candidate.profile.name).toBe('Edited Name');
  expect(review.working_draft).toBeNull();
  expect(f.runtime.exports.files(f.job.id, { artifact_id: first.artifact.id,
    artifact_fingerprint: first.artifact.version_fingerprint, dossier: false }).files[0].name).toBe('resume.pdf');
  expect(f.run).not.toHaveBeenCalled();
  expect(f.runtime.repository.listEvents(f.job.id).some(e => e.payload.kind === 'resume_review')).toBe(false);
});
it('invalidates a passing check when privacy changes and retains the prior PDF', async () => {
  const f = await editFixture(), checked = await f.runtime.drafts.check(f.job.id, f.draft.id, f.draft.candidate);
  f.privacy({ banned_keywords: ['Synthetic'], strip_patterns: [], replacements: [] });
  await expect(f.runtime.drafts.finalize(f.job.id, f.draft.id, {
    expected_job_revision: checked.job_revision, expected_draft_revision: f.draft.revision,
    binding: checked.binding, idempotency_key: 'changed-privacy',
  })).rejects.toThrow();
  expect(f.runtime.repository.getJob(f.job.id).artifact_version_ids).toEqual([f.artifact.id]);
});

async function checkedFixture() {
  const f = await editFixture();
  const checked = await f.runtime.drafts.check(f.job.id, f.draft.id, f.draft.candidate);
  const request = { expected_job_revision: checked.job_revision, expected_draft_revision: f.draft.revision,
    binding: checked.binding, idempotency_key: 'finalize-once' };
  return { ...f, checked, request };
}
it('concurrent identical finalizations publish once and changed intent is rejected', async () => {
  const f = await checkedFixture();
  const [a, b] = await Promise.all([
    f.runtime.drafts.finalize(f.job.id, f.draft.id, f.request),
    f.runtime.drafts.finalize(f.job.id, f.draft.id, f.request),
  ]);
  expect(a.artifact.id).toBe(b.artifact.id);
  expect(f.runtime.repository.getJob(f.job.id).artifact_version_ids).toHaveLength(2);
  await expect(f.runtime.drafts.finalize(f.job.id, f.draft.id, { ...f.request,
    binding: { ...f.request.binding, candidate_fingerprint: 'different' },
  })).rejects.toMatchObject({ code: 'idempotency_conflict' });
});
it('a save from another database connection fences the checked revision', async () => {
  const f = await checkedFixture(), db = openJobsDatabase(f.root);
  try {
    const other = new JobsRepository(db);
    other.saveDraft({ ...f.draft, candidate: { ...f.draft.candidate, summary: 'New draft' } }, f.draft.revision);
    await expect(f.runtime.drafts.finalize(f.job.id, f.draft.id, f.request)).rejects.toMatchObject({ code: 'revision_conflict' });
    expect(f.runtime.repository.getJob(f.job.id).artifact_version_ids).toEqual([f.artifact.id]);
  } finally { db.close(); }
});
it('render outages preserve drafts and are retryable', async () => {
  const f = await editFixture();
  f.deps.renderer.renderPdf.mockRejectedValueOnce(Error('compiler failed'));
  const result = await f.runtime.drafts.check(f.job.id, f.draft.id, f.draft.candidate);
  expect(result.status).toBe('unavailable');
  expect(f.runtime.repository.getLatestDraft(f.draft.id)).toEqual(f.draft);
  expect((await f.runtime.drafts.check(f.job.id, f.draft.id, f.draft.candidate)).status).toBe('ready');
});
it('a failed publication preserves the prior artifact and a retry can complete', async () => {
  const f = await checkedFixture();
  const write = vi.spyOn(f.runtime.repository.database.files, 'writeBundle').mockImplementationOnce(() => { throw Error('disk full'); });
  await expect(f.runtime.drafts.finalize(f.job.id, f.draft.id, f.request)).rejects.toThrow('disk full');
  expect(f.runtime.repository.getJob(f.job.id).artifact_version_ids).toEqual([f.artifact.id]);
  expect(f.runtime.repository.getLatestDraft(f.draft.id)).toEqual(f.draft);
  write.mockRestore();
  const result = await f.runtime.drafts.finalize(f.job.id, f.draft.id, f.request);
  expect(result.artifact.parent_version_id).toBe(f.artifact.id);
});

it('downloads the previous PDF despite pending edits without creating a release', async () => {
  const f = await editFixture();
  f.runtime.repository.saveDraft({ ...f.draft, candidate: { ...f.draft.candidate, summary: 'Pending edit' } }, f.draft.revision);
  const response = await f.app.request(`/api/jobs/${f.job.id}/artifacts/${f.artifact.id}/pdf?download=1`);
  expect(response.status).toBe(200);
  expect(response.headers.get('Content-Disposition')).toContain(`resume-${f.artifact.id}.pdf`);
  expect(await response.text()).toBe('synthetic test PDF');
  expect(f.runtime.exports.list(f.job.id)).toEqual([]);
});
it.each(['privacy', 'evidence'] as const)('rejects a check when %s changes during rendering', async kind => {
  const f = await editFixture();
  const rendered = await f.deps.renderer.renderPdf();
  let release!: (value: typeof rendered) => void;
  f.deps.renderer.renderPdf.mockImplementationOnce(() => new Promise(resolve => { release = resolve; }));
  const checking = f.runtime.drafts.check(f.job.id, f.draft.id, f.draft.candidate);
  const rejected = expect(checking).rejects.toMatchObject({ code: 'ineligible' });
  await vi.waitFor(() => expect(release).toBeTypeOf('function'));
  if (kind === 'privacy') f.privacy({ banned_keywords: ['Private'], strip_patterns: [], replacements: [] });
  else f.evidence.add({ ...f.evidence.getAll()[0].entry, summary: 'A newly corrected source' });
  release(rendered); await rejected;
  expect(f.runtime.repository.getLatestDraft(f.draft.id)).toEqual(f.draft);
  expect(f.runtime.repository.getJob(f.job.id).artifact_version_ids).toEqual([f.artifact.id]);
});
it('uses the durable finalization receipt after reopening the runtime', async () => {
  const f = await checkedFixture();
  const first = await f.runtime.drafts.finalize(f.job.id, f.draft.id, f.request);
  await f.runtime.dispose();
  const reopened = createJobsRuntime(f.root, f.deps);
  try {
    expect((await reopened.drafts.finalize(f.job.id, f.draft.id, f.request)).artifact.id).toBe(first.artifact.id);
    expect(reopened.repository.getJob(f.job.id).artifact_version_ids).toHaveLength(2);
  } finally { await reopened.dispose(); }
});
