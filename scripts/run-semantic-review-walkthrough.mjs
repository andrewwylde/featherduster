// Synthetic workspace only. Real HTTP, SQLite, browser, renderer and PDF verification.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
import yaml from 'js-yaml';
import { serve } from '@hono/node-server';
import { chromium, expect } from 'playwright/test';
import { createApp } from '../packages/cli/dist/server.js';
import { createJobsRuntime } from '../packages/cli/dist/jobs/runtime.js';
import { initWorkspace } from '../packages/cli/dist/commands/init.js';
import { LatexRenderer } from '../packages/cli/dist/render/latex-renderer.js';
import { PdfVerifier } from '../packages/cli/dist/render/pdf-verifier.js';
import { SEMANTIC_SUITE_VERSION } from '../packages/cli/dist/jobs/semantic-evaluation.js';
const out = path.resolve('requests/semantic-review-walkthrough');
fs.mkdirSync(out, { recursive: true });
const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'fd-semantic-walkthrough-'));
await initWorkspace({ workspace, silent: true });
const candidate = { profile: { name: 'Jordan Example', title: 'Software Engineer', email: 'jordan@example.com' },
  summary: 'Implemented backend services.', experiences: [
    { company: 'Acme', role: 'Engineer', startDate: '2022-01', endDate: 'Present', bullets: [
      { text: 'Shipped a production API.', citations: ['api'] },
      { text: 'Delivered a production API.', citations: ['api'] },
    ] },
    { company: 'Other Project', role: 'Engineer', startDate: '2020-01', endDate: '2021-12', bullets: [
      { text: 'Shipped a production API.', citations: ['other'] },
      { text: 'Shipped a production data service.', citations: ['data'] },
    ] },
  ], skills: [{ category: 'Engineering', skills: ['API development'] }], education: [] };
fs.writeFileSync(path.join(workspace, 'resumes', 'templates', 'semantic.yaml'), yaml.dump(candidate));
const entries = [
  ['backend', 'Acme', 'Server handlers', 'Implemented server-side request handlers and database queries.'],
  ['api', 'Acme', 'API prototype', 'Built an internal API prototype. Deployment status not recorded.'],
  ['other', 'Other Project', 'Other API', 'Built another API. Deployment status not recorded.'],
  ['data', 'Other Project', 'Data service', 'Built a data service prototype. Never deployed.'],
].map(([id, company, title, summary]) => ({ id, company, title, summary, date: '2026-01-01',
  impact: '', themes: [], confidence: 'verified', in_flight: false, metrics: [], internal_references: [] }));
fs.writeFileSync(path.join(workspace, 'evidence', 'evidence-ledger.yaml'), yaml.dump({ entries }));
const calls = [], journal = [], consoleErrors = [];
let offline = false;
const runner = { id: 'fake', model: 'semantic-fixture', label: 'Synthetic semantic fixture', locality: 'local',
  detect: async () => ({ available: true, detail: 'Synthetic fixture' }),
  run: async req => {
    if (req.system.startsWith('Classify whether')) {
      const batch = JSON.parse(req.prompt); calls.push(batch.subjects.map(p => p.text));
      if (offline) throw Error('Synthetic classifier outage');
      return { passages: batch.subjects.map(p => {
        const production = /production/.test(p.text), contradiction = /data service/.test(p.text);
        const sourceId = contradiction ? 'data' : production ? p.work_context?.includes('Other Project') ? 'other' : 'api' : 'backend';
        const source = batch.sources.find(s => s.evidence_id === sourceId && s.field === 'summary') ?? batch.sources[0];
        return { subject_ref: p.ref, claims: [{ text: p.text,
          fact: { predicate: production ? 'production' : 'backend', qualifiers: [] }, qualifier_text: [],
          state: contradiction ? 'contradicted' : production ? 'needs_clarification' : 'supported',
          evidence: source ? [{ source_ref: source.ref, quote: source.text }] : [],
          explanation: contradiction ? 'The older source says never deployed.' : production ? 'Deployment is not recorded.' : 'Server-side implementation supports backend experience.',
          ...(production ? { question: 'Was this API deployed for real users?' } : {}) }] };
      }) };
    }
    return { company: 'Acme', role: 'Engineer', seniority: '', mission: '', requirements: [], rows: [], proposals: [] };
  } };
const poppler = process.env.POPPLER_BIN ?? path.join(process.env.LOCALAPPDATA ?? '', 'Programs', 'poppler', 'Library', 'bin');
const verifier = new PdfVerifier(fs.existsSync(path.join(poppler, 'pdftotext.exe')) ? { tools: Object.fromEntries(['pdfinfo', 'pdftotext', 'pdftoppm'].map(n => [n, { command: path.join(poppler, n + '.exe') }])) } : {});
const actualRenderer = new LatexRenderer({ verifier });
let holdRender, releaseRender;
const renderer = { preflight: (...args) => actualRenderer.preflight(...args), renderPdf: async request => {
  if (holdRender) { holdRender(); await new Promise(resolve => { releaseRender = resolve; }); holdRender = undefined; }
  return actualRenderer.renderPdf(request);
} };
let runtime;
const app = createApp(workspace, { uiDir: path.resolve('packages/cli/dist/ui'),
  jobsDependencies: { runnerFactory: () => runner, automaticDrain: false, renderer },
  jobsRuntimeFactory: (w, d) => runtime = createJobsRuntime(w, d) });
app.initializeJobs();
// A fake authority record exists only in this disposable test database.
runtime.semantic.store.saveEvaluation({ configuration_key: runtime.semantic.configurationKey(runner), suite_hash: SEMANTIC_SUITE_VERSION,
  passed: true, observations: [], recorded_at: new Date().toISOString() });
const server = serve({ fetch: app.fetch, hostname: '127.0.0.1', port: 0 });
await new Promise(resolve => server.once('listening', resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
page.on('pageerror', e => consoleErrors.push(e.message));
async function request(url, body, method = 'POST', expected = 200) {
  const response = await fetch(origin + url, body === undefined ? undefined : { method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const text = await response.text();
  journal.push({ url, method: body === undefined ? 'GET' : method, status: response.status });
  assert.equal(response.status, expected, `${url}: ${text}`);
  return JSON.parse(text);
}
function clarification(view, fact, extras = {}) {
  return { target: view.target, expected_job_revision: view.job_revision, expected_semantic_revision: view.semantic_revision,
    input_fingerprint: view.input_fingerprint, idempotency_key: randomUUID(), claim_ids: [fact.claim.id], fact: fact.claim.fact,
    assertion: 'Fixture user confirms this exact work.', kind: 'confirmation', source_ids: [], supersedes: null, ...extras };
}
try {
  const preview = await request('/api/jobs/preview', { mode: 'text', input: 'Acme seeks an API engineer.', details: { company: 'Acme', role: 'Engineer' } });
  const id = (await request('/api/jobs', { preview_id: preview.preview_id, idempotency_key: randomUUID() })).items[0].job_id;
  const job = runtime.repository.getJob(id);
  const input = (await request(`/api/jobs/${id}/inputs`, { expected_revision: job.revision }, 'POST', 201)).input_snapshot;
  await request(`/api/jobs/${id}/prepare`, { expected_revision: job.revision, input_snapshot_id: input.id, idempotency_key: randomUUID() }, 'POST', 202);
  await runtime.service.worker.whenIdle();
  assert.equal(runtime.repository.getJob(id).preparation_state, 'needs_input');
  let facts = await request(`/api/jobs/${id}/facts`);
  assert.equal(facts.facts[0].resolution.provenance, 'model');
  assert.ok(facts.facts[0].evidence.some(e => e.evidence_id === 'backend'));
  assert.equal(calls.length, 1);
  await page.goto(`${origin}/jobs/${id}/proposals`);
  await expect(page.getByRole('heading', { name: 'Facts to review' })).toBeVisible();
  await page.screenshot({ path: path.join(out, 'desktop-facts.png'), fullPage: true });
  await page.getByLabel('Your factual answer').fill('I need to verify deployment.');
  await page.getByRole('button', { name: 'Save answer, keep unresolved' }).click();
  await expect(page.getByText(/Answer saved. This fact still needs/)).toBeVisible();
  await page.getByLabel('Your factual answer').fill('I deployed this API for our customers.');
  await page.getByRole('button', { name: 'Confirm for this job and continue' }).click();
  await expect(page.getByText('3 of 5 resolved')).toBeVisible();
  facts = await request(`/api/jobs/${id}/facts`);
  assert.equal(facts.facts.filter(f => f.resolution).length, 3);
  assert.equal(facts.facts[3].resolution, null, 'Other project must remain unresolved');
  await page.getByLabel('Your factual answer').fill('I deployed the other project API too.');
  await page.getByRole('button', { name: 'Confirm for this job and continue' }).click();
  await expect(page.getByLabel('Effective date')).toBeVisible();
  await page.getByLabel('Your factual answer').fill('The data service was deployed after the older prototype note.');
  await page.getByLabel('Exact older assertion being corrected').fill('Never deployed.');
  await page.getByLabel('Effective date').fill('2026-02-01');
  await page.getByRole('button', { name: 'Confirm for this job and continue' }).click();
  await expect(page.getByText('All facts resolved. Resume checks still apply.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Generate PDF from reviewed resume' })).toBeEnabled();
  await page.setViewportSize({ width: 375, height: 900 });
  await page.screenshot({ path: path.join(out, 'mobile-resolved.png'), fullPage: true });
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), 'Mobile overflow');
  await page.getByRole('button', { name: 'Generate PDF from reviewed resume' }).click();
  await runtime.service.worker.whenIdle();
  await expect.poll(() => runtime.repository.getJob(id).preparation_state, { timeout: 60000 }).toBe('resume_ready');
  const ready = runtime.repository.getJob(id), artifact = runtime.artifacts.getArtifact(ready.artifact_version_ids.at(-1));
  fs.writeFileSync(path.join(out, 'resume.pdf'), runtime.artifacts.content(id, artifact.id));
  const draft = (await request(`/api/jobs/${id}/artifacts/${artifact.id}/continue-editing`, { expected_job_revision: ready.revision, artifact_fingerprint: artifact.version_fingerprint, idempotency_key: randomUUID() })).draft;
  journal.push({ event: 'prepared', artifact: artifact.id, semantic: artifact.semantic_binding });
  // Draft edit, classifier outage, saving, and explicit manual fallback.
  const edited = { ...draft.candidate, summary: 'Implemented backend request handlers.' };
  offline = true;
  const target = { kind: 'draft', draft_id: draft.id, candidate: edited };
  facts = await request(`/api/jobs/${id}/facts/view`, target);
  await request(`/api/jobs/${id}/facts/check`, { target, expected_job_revision: facts.job_revision,
    expected_semantic_revision: facts.semantic_revision, input_fingerprint: facts.input_fingerprint,
    reason: 'edit', idempotency_key: randomUUID() }, 'POST', 202);
  await runtime.semantic.wait(id);
  const saved = await request(`/api/jobs/${id}/drafts/${draft.id}`, { expected_revision: draft.revision, candidate: edited }, 'PUT');
  facts = await request(`/api/jobs/${id}/facts/view`, target);
  for (const unresolved of facts.facts.filter(f => !f.resolution)) {
    facts = await request(`/api/jobs/${id}/facts/clarifications`, clarification(facts, unresolved));
  }
  const check = await request(`/api/jobs/${id}/drafts/${draft.id}/check`, { candidate: edited });
  assert.equal(check.status, 'ready');
  const finalizeBody = { expected_draft_revision: saved.draft.revision, expected_job_revision: check.job_revision,
    binding: check.binding, idempotency_key: randomUUID() };
  runtime.drafts.cache.clear(); // Test-only: force rendering inside finalization.
  let entered;
  const enteredRender = new Promise(resolve => { entered = resolve; });
  holdRender = entered;
  const staleFinalize = request(`/api/jobs/${id}/drafts/${draft.id}/finalize`, finalizeBody, 'POST', 409);
  await enteredRender;
  facts = await request(`/api/jobs/${id}/facts/view`, target);
  const first = facts.facts[0];
  await request(`/api/jobs/${id}/facts/clarifications`, clarification(facts, first, { assertion: 'Reconfirmed against the exact edited wording.' }));
  releaseRender(); await staleFinalize;
  assert.equal(runtime.repository.getJob(id).artifact_version_ids.length, ready.artifact_version_ids.length);
  const fresh = await request(`/api/jobs/${id}/drafts/${draft.id}/check`, { candidate: edited });
  const body = { ...finalizeBody, binding: fresh.binding, expected_job_revision: fresh.job_revision, idempotency_key: randomUUID() };
  const finalized = await request(`/api/jobs/${id}/drafts/${draft.id}/finalize`, body, 'POST', 201);
  assert.deepEqual(await request(`/api/jobs/${id}/drafts/${draft.id}/finalize`, body, 'POST', 201), finalized);
  const beforeReads = calls.length;
  await request(`/api/jobs/${id}/facts/view`, target);
  runtime.artifacts.review(id, artifact.id);
  assert.equal(calls.length, beforeReads);
  assert.equal(calls.length, 2, 'Only preparation and one changed draft dispatch');
  assert.deepEqual(consoleErrors, []);
  fs.writeFileSync(path.join(out, 'report.json'), JSON.stringify({ passed: true, workspace, job: id, calls, journal, consoleErrors,
    asset_hash: createHash('sha256').update(fs.readFileSync('packages/cli/dist/ui/index.html')).digest('hex'),
    semantic_records: runtime.semantic.store.results(id, input.id).map(r => ({ id: r.id, fingerprint: r.cache_key })),
    clarifications: runtime.semantic.store.clarifications(id, input.id).length }, null, 2));
  console.log(`Semantic walkthrough passed: ${out}`);
} finally {
  fs.writeFileSync(path.join(out, 'journal.json'), JSON.stringify({ journal, consoleErrors, calls, workspace }, null, 2));
  await browser.close(); await app.disposeJobs(); await new Promise(resolve => server.close(resolve));
}
