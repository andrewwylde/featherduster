// Disposable, fixture-backed acceptance. Only the model runner is deterministic;
// HTTP handlers, persistence, checks, LaTeX compilation and PDF verification are real.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { serve } from '@hono/node-server';
import { chromium, expect } from 'playwright/test';
import yaml from 'js-yaml';
import { evidenceSnapshot, extractReadableTrace, runObservedCommand } from './resume-finalization-inspection.mjs';
import { currentIdentity, captureManifest } from './resume-finalization-evidence.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const arg = name => process.argv[process.argv.indexOf(name) + 1];
const mode = process.argv[2];
assert.ok(['capture', 'identity'].includes(mode), 'Use capture or identity');
assert.ok(process.argv.includes('--evidence-dir'), '--evidence-dir is required');
const out = path.resolve(arg('--evidence-dir'));
if (mode === 'capture') fs.mkdirSync(out, { recursive: true });
else assert.ok(fs.statSync(out).isDirectory(), 'The captured evidence directory must exist');
const stateFile = path.join(out, 'fixture.json');
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const editedName = 'Jordan Rivera';
const execution = [];
if (mode === 'capture') {
  for (const [name, command] of [['build', 'npm run build'], ['tests', 'npm test']]) {
    const argv = process.platform === 'win32'
      ? [process.env.ComSpec || 'cmd.exe', '/d', '/s', '/c', command]
      : ['sh', '-c', command];
    const result = await runObservedCommand(argv, root, 240000);
    fs.writeFileSync(path.join(out, `${name}.log`), result.stdout + result.stderr);
    execution.push({ ...result, stdout: `${name}.log`, stderr: `${name}.log` });
    console.log(JSON.stringify({ event: 'engineering-command', command, exit_code: result.exit_code, log: `${name}.log` }));
    assert.equal(result.exit_code, 0, `${command} failed; see ${name}.log`);
  }
}
// Load the actual runtime only after the capture's build has completed.
const { createApp, loadResumeSpecs } = await import('../packages/cli/dist/server.js');
const { createJobsRuntime } = await import('../packages/cli/dist/jobs/runtime.js');
const { initWorkspace } = await import('../packages/cli/dist/commands/init.js');
const { PdfVerifier } = await import('../packages/cli/dist/render/pdf-verifier.js');
const { LatexRenderer } = await import('../packages/cli/dist/render/latex-renderer.js');
// Prefer explicitly configured Poppler, then its conventional per-user Windows
// installation. Never substitute Xpdf or a synthetic verifier for the real tools.
const installedPoppler = process.platform === 'win32' && process.env.LOCALAPPDATA
  ? path.join(process.env.LOCALAPPDATA, 'Programs', 'poppler', 'Library', 'bin') : undefined;
const popplerBin = process.env.POPPLER_BIN || (installedPoppler && fs.existsSync(path.join(installedPoppler, 'pdftotext.exe')) ? installedPoppler : undefined);
const verifier = new PdfVerifier(popplerBin ? { tools: Object.fromEntries(['pdfinfo', 'pdftotext', 'pdftoppm'].map(name => [name, { command: path.join(popplerBin, name + (process.platform === 'win32' ? '.exe' : '')) }])) } : {});
let modelCalls = 0;
const runner = { id: 'fake', model: 'fixture', label: 'Disposable acceptance fixture', locality: 'local',
  detect: async () => ({ available: true, detail: 'Fixture runner; no cloud request' }),
  run: async () => {
    modelCalls++;
    return { company: 'Harbor Systems', role: 'Senior Engineer', seniority: '', mission: '', requirements: [], boilerplate: [], rows: [],
      proposals: modelCalls === 3 ? [{ id: 'summary-correction', type: 'summary.rewrite', target: {}, before: '',
        after: 'Software engineer building reliable services. [METRIC NEEDED]', citations: ['harbor-api'] }] : [] };
  } };

async function makeFixture() {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'featherduster-resume-finalization-'));
  await initWorkspace({ workspace, silent: true });
  const spec = { profile: { name: 'Jordan Morgan', title: 'Senior Software Engineer', email: 'jordan@example.com', location: 'Portland, OR' },
    summary: 'Software engineer building reliable services and helping teams maintain clear operational practices.',
    experiences: [
      { company: 'Harbor Systems', role: 'Senior Software Engineer', startDate: '2022-01', endDate: 'Present', bullets: [
        { text: 'Maintained service APIs and documented incident response procedures.', citations: ['harbor-api'] },
        { text: 'Worked with product teams to simplify release coordination.', citations: ['harbor-release'] },
      ] },
      { company: 'Cedar Labs', role: 'Software Engineer', startDate: '2018-06', endDate: '2021-12', bullets: [
        { text: 'Built internal reporting tools and maintained automated tests.', citations: ['cedar-tools'] },
        { text: 'Documented support workflows and helped colleagues investigate service failures.', citations: ['cedar-tools'] },
      ] },
    ], education: [{ institution: 'Cascadia University', degree: 'BS Computer Science', year: '2018' }],
    skills: [{ category: 'Engineering', skills: ['Service development', 'Automated testing', 'Incident response'] }] };
  for (const [folder, names] of Object.entries({ templates: ['Senior Engineer', 'Principal Engineer', 'Platform Engineer', 'Engineering Generalist', 'Services Engineer', 'Technical Lead', 'Engineering Manager', 'Operations Engineer', 'Data Engineer', 'Release Engineer'],
    tailored: ['Senior Backend Engineer', 'Staff Engineer', 'Product Engineer', 'Systems Engineer', 'Reliability Engineer', 'Infrastructure Engineer', 'Application Engineer', 'Tools Engineer', 'Integration Engineer', 'Developer Experience Engineer'] })) {
    for (const name of names) fs.writeFileSync(path.join(workspace, 'resumes', folder, `${name}.yaml`), yaml.dump(spec));
  }
  const entries = [
    ['harbor-api', 'Harbor Systems', 'Service APIs', 'Maintained service APIs and documented incident response procedures.'],
    ['harbor-release', 'Harbor Systems', 'Release coordination', 'Worked with product teams to simplify release coordination.'],
    ['cedar-tools', 'Cedar Labs', 'Reporting tools', 'Built internal reporting tools and maintained automated tests. Documented support workflows and helped colleagues investigate service failures.'],
  ].map(([id, company, title, summary]) => ({ id, company, title, summary, date: '2026-01-01', impact: 'Clearer operations', themes: ['engineering'], confidence: 'verified', in_flight: false, metrics: [], internal_references: [] }));
  fs.writeFileSync(path.join(workspace, 'evidence', 'evidence-ledger.yaml'), yaml.dump({ entries }));
  return { workspace, spec };
}

let state = mode === 'identity' ? JSON.parse(fs.readFileSync(stateFile, 'utf8')) : await makeFixture();
assert.ok(path.basename(state.workspace).startsWith('featherduster-resume-finalization-'), 'Never operate on user jobs');
let runtime;
const app = createApp(state.workspace, { uiDir: path.join(root, 'packages/cli/dist/ui'),
  jobsDependencies: { runnerFactory: () => runner, automaticDrain: false, renderer: new LatexRenderer({ verifier }) },
  jobsRuntimeFactory: (workspace, deps) => (runtime = createJobsRuntime(workspace, deps)),
});
app.initializeJobs();
const server = serve({ fetch: app.fetch, hostname: '127.0.0.1', port: 0 });
await new Promise((resolve, reject) => { server.once('listening', resolve); server.once('error', reject); });
const origin = `http://127.0.0.1:${server.address().port}`;
let browser, context, page;
const captures = [], progression = [], errors = [];
const journal = [];
async function observe(action, detail = {}) {
  const ui = page ? await page.evaluate(() => ({
    url: location.href, viewport: { width: innerWidth, height: innerHeight },
    active: { tag: document.activeElement?.tagName, text: document.activeElement?.textContent, label: document.activeElement?.getAttribute('aria-label') },
    fields: Array.from(document.querySelectorAll('[data-resume-path]')).map(el => ({ path: el.getAttribute('data-resume-path'), value: el.value, invalid: el.getAttribute('aria-invalid') })),
    finalize_disabled: Array.from(document.querySelectorAll('button')).find(el => el.textContent === 'Finalize resume')?.disabled,
    statuses: Array.from(document.querySelectorAll('[role="status"]')).map(el => el.textContent),
  })) : null;
  journal.push({ sequence: journal.length, at: new Date().toISOString(), action, detail, ui });
}
const json = async url => { const response = await fetch(origin + url); assert.equal(response.status, 200); return response.json(); };
async function servedAssets() {
  const html = await (await fetch(origin)).text();
  const urls = [...html.matchAll(/(?:src|href)="([^" ]+\.(?:js|css))"/g)].map(m => m[1]);
  assert.ok(urls.length >= 2, 'Actual built UI must be served');
  return { '/': sha(html), ...Object.fromEntries(await Promise.all(urls.map(async url => {
    const response = await fetch(origin + url);
    assert.equal(response.status, 200, `Served asset unavailable: ${url}`);
    return [url, sha(Buffer.from(await response.arrayBuffer()))];
  }))) };
}
async function shot(name, scenario) {
  await page.evaluate(() => scrollTo(0, 0));
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  await page.screenshot({ path: path.join(out, `${name}.png`), fullPage: true });
  captures.push({ path: `${name}.png`, scenario, viewport: page.viewportSize(), url: page.url() });
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `${name}: horizontal page overflow`);
}
async function download(name, label) {
  const waiting = page.waitForEvent('download');
  await page.getByRole(label === 'Download PDF' ? 'button' : 'link', { name: label, exact: true }).click();
  const file = await waiting; await file.saveAs(path.join(out, name));
  const bytes = fs.readFileSync(path.join(out, name));
  assert.equal(bytes.subarray(0, 5).toString(), '%PDF-');
  await observe('browser-download', { label, suggested_filename: file.suggestedFilename(), path: name, bytes: bytes.length, sha256: sha(bytes) });
}
async function ready() { await expect(page.getByText('Ready to finalize', { exact: true })).toBeVisible({ timeout: 90000 }); }
async function verifyPersisted() {
  const detail = await json(`/api/jobs/${state.jobId}`), job = detail.job;
  assert.equal(job.artifact_version_ids.length, 2);
  assert.equal(job.artifact_version_ids[0], state.parentId);
  const artifactId = job.artifact_version_ids.at(-1);
  const review = await json(`/api/jobs/${state.jobId}/artifacts/${artifactId}/review`);
  assert.equal(review.artifact.origin, 'manual');
  assert.equal(review.artifact.parent_version_id, state.parentId);
  assert.equal(review.draft.candidate.profile.name, editedName);
  assert.equal(review.working_draft, null);
  assert.equal(review.validation_report.passed, true);
  assert.equal(review.validation_report.pageCount, 1);
  assert.equal(review.validation_report.pageBudget, 1);
  assert.equal(detail.events.filter(e => e.payload.kind === 'resume_finalized').length, 1);
  assert.equal(detail.events.filter(e => e.payload.kind === 'resume_review').length, 0);
  const revisions = runtime.repository.database.db.prepare('SELECT payload FROM draft_revisions WHERE id=? ORDER BY revision').all(state.draftId).map(row => JSON.parse(row.payload));
  assert.ok(revisions.some(d => d.candidate.profile.name === ''), 'Invalid draft persisted durably');
  assert.equal(revisions.at(-1).candidate.profile.name, editedName);
  const receipts = runtime.repository.database.db.prepare("SELECT result FROM mutation_receipts WHERE operation='finalize_job_draft'").all();
  assert.equal(receipts.length, 1);
  assert.equal(JSON.parse(receipts[0].result).artifact.id, artifactId);
  const resumes = await json('/api/resumes');
  assert.equal(resumes.length, state.variantCount, 'No reusable variant created');
  const selection = encodeURIComponent(JSON.stringify({ artifact_id: artifactId, artifact_fingerprint: review.artifact.version_fingerprint, dossier: false }));
  const response = await fetch(`${origin}/api/jobs/${state.jobId}/exports/current/resume.pdf?selection=${selection}&download=1`);
  assert.equal(response.status, 200); assert.match(response.headers.get('content-disposition'), /attachment/);
  const pdf = Buffer.from(await response.arrayBuffer());
  // Identity verification must not change captured files, even on a failed probe.
  const scratch = mode === 'identity' ? fs.mkdtempSync(path.join(os.tmpdir(), 'resume-identity-')) : out;
  let verified;
  try {
    const pdfPath = path.join(scratch, 'verified-current.pdf');
    fs.writeFileSync(pdfPath, pdf);
    verified = await verifier.verify(pdfPath, { expectedText: [editedName, ...review.draft.candidate.experiences.flatMap(e => e.bullets.map(b => b.text))], pageBudget: 1 });
    assert.equal(verified.report.passed, true, JSON.stringify(verified.report));
  } finally { if (mode === 'identity') fs.rmSync(scratch, { recursive: true, force: true }); }
  const savedBytes = fs.readFileSync(path.join(out, 'finalized.pdf'));
  assert.equal(sha(pdf), sha(savedBytes), 'Current served PDF is the captured download');
  return { job_id: job.id, job_revision: job.revision, artifactId, artifact_fingerprint: review.artifact.version_fingerprint,
    parent_artifact_id: review.artifact.parent_version_id, input_fingerprint: review.artifact.input_fingerprint,
    draft_id: review.draft.id, draft_revision: review.draft.revision, draft_history: revisions,
    events: detail.events, finalization_receipts: receipts.map(row => JSON.parse(row.result)),
    pdf_sha256: sha(pdf), page_report: verified.report, variantCount: resumes.length, variants: resumes };
}
async function captureIdentityProbes(expectedIdentity) {
  const results = [];
  for (const index of [1, 2]) {
    const before = evidenceSnapshot(out);
    const result = await runObservedCommand([process.execPath, fileURLToPath(import.meta.url), 'identity', '--evidence-dir', out], root);
    assert.equal(result.exit_code, 0, result.stderr);
    const actual = JSON.parse(result.stdout);
    assert.deepEqual(Object.keys(actual).sort(), ['outcome_identity', 'served_build_identity']);
    assert.deepEqual(actual, expectedIdentity);
    const after = evidenceSnapshot(out);
    assert.deepEqual(after, before, 'Identity changed captured evidence files');
    // Record only after the immutable probe completes; the probe never writes here.
    fs.writeFileSync(path.join(out, `identity-${index}.stdout.json`), result.stdout);
    const observed = { ...result, stdout_file: `identity-${index}.stdout.json`, before, after, identity: actual };
    results.push(observed);
    console.log(JSON.stringify({ event: 'identity-probe', index, argv: result.argv, exit_code: result.exit_code, stdout: actual, captured_files_unchanged: true }));
  }
  // Regress a cloned disposable fixture through real repository APIs. Never edit
  // the tested fixture, captured evidence, or any existing user career workspace.
  const clone = fs.mkdtempSync(path.join(os.tmpdir(), 'featherduster-resume-finalization-regression-'));
  const probe = fs.mkdtempSync(path.join(os.tmpdir(), 'resume-regression-probe-'));
  try {
    fs.cpSync(state.workspace, clone, { recursive: true, filter: src => !src.endsWith('-wal') && !src.endsWith('-shm') });
    const databaseFile = path.join(clone, path.relative(state.workspace, runtime.repository.database.db.name));
    fs.rmSync(databaseFile, { force: true });
    await runtime.repository.database.db.backup(databaseFile);
    const { openJobsDatabase } = await import('../packages/cli/dist/jobs/database.js');
    const { JobsRepository } = await import('../packages/cli/dist/jobs/repository.js');
    const { JobArtifactsService } = await import('../packages/cli/dist/jobs/artifacts.js');
    const database = openJobsDatabase(clone), repository = new JobsRepository(database), artifacts = new JobArtifactsService(repository);
    let regression;
    try {
      const job = repository.getJob(state.jobId), parent = repository.getArtifact(job.artifact_version_ids.at(-1));
      const draft = artifacts.continueEditing({ job_id: job.id, artifact_version_id: parent.id,
        artifact_fingerprint: parent.version_fingerprint, expected_job_revision: job.revision, idempotency_key: randomUUID() });
      const saved = repository.saveDraft({ ...draft, candidate: { ...draft.candidate,
        profile: { ...draft.candidate.profile, name: 'Regressed pending draft' } } }, draft.revision);
      regression = { clone_workspace: clone, job_id: job.id, current_artifact: parent.id,
        pending_draft_id: saved.id, pending_draft_revision: saved.revision, candidate: saved.candidate };
    } finally { database.close(); }
    fs.writeFileSync(path.join(probe, 'fixture.json'), JSON.stringify({ ...state, workspace: clone }));
    fs.copyFileSync(path.join(out, 'finalized.pdf'), path.join(probe, 'finalized.pdf'));
    const before = evidenceSnapshot(out), probeBefore = evidenceSnapshot(probe);
    const result = await runObservedCommand([process.execPath, fileURLToPath(import.meta.url), 'identity', '--evidence-dir', probe], root);
    assert.notEqual(result.exit_code, 0, 'A pending regressed current draft must invalidate identity');
    assert.equal(result.stdout, '', 'Failed identity must not emit a successful identity');
    assert.match(result.stderr, /AssertionError/);
    const after = evidenceSnapshot(out), probeAfter = evidenceSnapshot(probe);
    assert.deepEqual(after, before);
    assert.deepEqual(probeAfter, probeBefore);
    fs.writeFileSync(path.join(out, 'identity-regression.stderr.txt'), result.stderr);
    results.push({ ...result, regression, original_before: before, original_after: after,
      probe_before: probeBefore, probe_after: probeAfter, stderr_file: 'identity-regression.stderr.txt' });
    console.log(JSON.stringify({ event: 'identity-regression-probe', argv: result.argv, exit_code: result.exit_code,
      regression, original_capture_unchanged: true, regression_probe_files_unchanged: true }));
  } finally {
    fs.rmSync(clone, { recursive: true, force: true });
    fs.rmSync(probe, { recursive: true, force: true });
  }
  return results;
}

try {
  if (mode === 'capture') {
    const base = loadResumeSpecs(state.workspace, false).find(r => r.name === 'Senior Engineer');
    const preview = await runtime.intake.preview({ mode: 'text', input: 'Harbor Systems seeks a Senior Engineer to maintain service APIs, testing and incident response.', details: { company: 'Harbor Systems', role: 'Senior Engineer' } });
    const job = runtime.intake.commit(preview, randomUUID())[0].job;
    const input = runtime.captureInputs(job.id, job.revision, { base_resume_id: base.id, runner: 'fake' });
    runtime.service.prepare({ job_id: job.id, expected_revision: job.revision, input_snapshot_id: input.id, idempotency_key: randomUUID() });
    await runtime.service.worker.whenIdle();
    assert.equal(runtime.repository.getJob(job.id).preparation_state, 'needs_input');
    const correction = runtime.proposals.read(job.id);
    assert.equal(correction.availability, 'available');
    const binding = () => ({ job_id: job.id, review_id: correction.review.id,
      expected_job_revision: runtime.repository.getJob(job.id).revision,
      expected_review_revision: runtime.proposals.read(job.id).review.revision, input_fingerprint: input.fingerprint });
    runtime.proposals.save({ ...binding(), patches: [{ proposal_id: 'summary-correction', edited_after: state.spec.summary }],
      groundings: [], feedback_kind: 'wording', explanation: 'Retain supported summary without an invented metric.', idempotency_key: randomUUID() });
    runtime.proposals.continue({ ...binding(), validation_fingerprint: runtime.proposals.read(job.id).review.validation.fingerprint, idempotency_key: randomUUID() });
    await runtime.service.worker.whenIdle();
    const prepared = runtime.repository.getJob(job.id);
    assert.equal(prepared.preparation_state, 'resume_ready', JSON.stringify(prepared));
    state.jobId = job.id; state.parentId = prepared.artifact_version_ids[0]; state.variantCount = loadResumeSpecs(state.workspace, false).length;
    state.modelCalls = modelCalls;
  }
  browser = await chromium.launch({ headless: process.env.HEADLESS === '1' });
  context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, acceptDownloads: true });
  context.setDefaultTimeout(20000);
  if (mode === 'capture') await context.tracing.start({ screenshots: true, snapshots: true, sources: false });
  page = await context.newPage(); page.on('pageerror', error => errors.push(error.stack));
  if (mode === 'capture') page.on('request', request => {
    if (/\/drafts\/.*\/(check|finalize)$|\/drafts\/[^/]+$/.test(new URL(request.url()).pathname))
      journal.push({ sequence: journal.length, at: new Date().toISOString(), action: 'actual-browser-request', url: request.url(), method: request.method(), body: request.postData() });
  });
  if (mode === 'identity') {
    // Re-evaluate actual served application and persisted artifacts, not saved success flags.
    const observed = await verifyPersisted();
    await page.goto(`${origin}/jobs/${state.jobId}/resume`);
    await expect(page.getByAltText('Resume page 1')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Download PDF', exact: true })).toBeVisible();
    const currentAssets = await servedAssets();
    assert.equal(errors.length, 0, errors.join('\n'));
    // The controller compares these fresh identities with the manifest. Never echo
    // saved identities or rewrite evidence during capture/acceptance identity probes.
    console.log(JSON.stringify(currentIdentity(currentAssets, observed)));
  } else {
    await page.goto(`${origin}/jobs`);
    await expect(page.getByRole('button', { name: 'URLs', exact: true })).toHaveAttribute('aria-pressed', 'true');
    await shot('01-urls-desktop', 'narrow-and-intake');
    await page.getByRole('button', { name: 'Posting text', exact: true }).click();
    await expect(page.getByRole('textbox', { name: 'Posting text' })).toBeVisible();
    await page.goto(`${origin}/jobs/${state.jobId}/resume`);
    await expect(page.getByAltText('Resume page 1')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Details', exact: true })).toHaveAttribute('aria-expanded', 'false');
    await expect(page.getByText('Base to candidate diff')).toHaveCount(0);
    await shot('02-resume-first-desktop', 'ready-desktop');
    await page.getByRole('button', { name: 'Edit resume', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Save draft', exact: true })).toBeVisible();
    state.draftId = new URL(page.url()).pathname.split('/').pop();
    await ready();
    // Hold a real successful check response, edit again, then release it. No fabricated results.
    let held, release;
    const heldRequest = new Promise(resolve => { held = resolve; });
    const released = new Promise(resolve => { release = resolve; });
    await page.route('**/drafts/*/check', async route => {
      const response = await route.fetch();
      await observe('hold-actual-check-response', { request: route.request().postDataJSON(), status: response.status(), response: await response.json() });
      held(); await released;
      await observe('release-older-check-response'); await route.fulfill({ response });
    }, { times: 1 });
    if (!await page.locator('[data-resume-path="profile.name"]').isVisible()) await page.getByRole('button', { name: /Profile/ }).click();
    const name = page.locator('[data-resume-path="profile.name"]');
    await name.fill('Jordan Delayed'); await heldRequest;
    await name.fill('');
    await expect(page.getByRole('button', { name: 'Finalize resume', exact: true })).toBeDisabled();
    release();
    await expect(page.getByRole('list', { name: 'Resume issues' })).toContainText('Enter your name');
    await expect(name).toHaveAttribute('aria-invalid', 'true');
    await observe('newer-invalid-edit-remains-blocked-after-older-success');
    await shot('03-invalid-reactive-desktop', 'pending-and-reactive');
    await page.getByRole('button', { name: 'Save draft', exact: true }).click();
    await expect(page.getByText('Draft saved.', { exact: true })).toBeVisible();
    await page.reload();
    if (!await page.locator('[data-resume-path="profile.name"]').isVisible()) await page.getByRole('button', { name: /Profile/ }).click();
    await expect(page.locator('[data-resume-path="profile.name"]')).toHaveValue('');
    await observe('reload-restores-saved-invalid-name', { persisted: await json(`/api/jobs/${state.jobId}/drafts/${state.draftId}`) });
    await page.getByRole('button', { name: 'Back to resume', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Previous finalized resume' })).toBeVisible();
    await shot('04-pending-previous-desktop', 'pending-and-reactive');
    await download('previous.pdf', 'Download previous PDF');
    assert.equal(sha(fs.readFileSync(path.join(out, 'previous.pdf'))), sha(runtime.artifacts.content(state.jobId, state.parentId)));
    await page.getByRole('button', { name: 'Continue editing', exact: true }).click();
    if (!await page.locator('[data-resume-path="profile.name"]').isVisible()) await page.getByRole('button', { name: /Profile/ }).click();
    await page.locator('[data-resume-path="profile.name"]').fill(editedName);
    await ready();
    // A delayed transport error also belongs only to its old request, never the
    // newer edit. Fetch the real server response, then simulate its lost transport.
    let errorHeld, errorRelease;
    const waitError = new Promise(resolve => { errorHeld = resolve; });
    const releaseError = new Promise(resolve => { errorRelease = resolve; });
    await page.route('**/drafts/*/check', async route => {
      const response = await route.fetch();
      await observe('hold-check-before-delayed-transport-error', { request: route.request().postDataJSON(), actual_response: await response.json() });
      errorHeld(); await releaseError; await route.abort('connectionfailed');
    }, { times: 1 });
    await page.locator('[data-resume-path="profile.title"]').fill('Senior Software Engineer ');
    await waitError;
    await page.locator('[data-resume-path="profile.title"]').fill('Senior Software Engineer');
    await expect(page.getByRole('button', { name: 'Finalize resume', exact: true })).toBeDisabled();
    errorRelease(); await ready();
    await expect(page.getByRole('button', { name: 'Retry checks', exact: true })).toHaveCount(0);
    await observe('older-transport-error-did-not-overwrite-current-ready-state');
    // Narrow editor: current inline feedback, nonblocking save, and accessible controls.
    await page.setViewportSize({ width: 375, height: 1000 });
    await page.getByRole('tab', { name: 'Job Matcher & Variant' }).click();
    await page.locator('[data-resume-path="profile.title"]').fill('');
    await expect(page.locator('[data-resume-path="profile.title"]')).toHaveAttribute('aria-invalid', 'true');
    await shot('05-invalid-editor-375', 'narrow-and-intake');
    await page.getByRole('button', { name: 'Save draft', exact: true }).click();
    await expect(page.getByText('Draft saved.', { exact: true })).toBeVisible();
    await page.route('**/drafts/*/check', route => route.abort('connectionfailed'), { times: 1 });
    await page.locator('[data-resume-path="profile.title"]').fill('Senior Software Engineer');
    await expect(page.getByRole('button', { name: 'Retry checks', exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Save draft', exact: true }).click();
    await expect(page.getByText('Draft saved.', { exact: true })).toBeVisible();
    await shot('05-checks-unavailable-saved-375', 'pending-and-reactive');
    await observe('checker-unavailable-but-draft-saved', { persisted: await json(`/api/jobs/${state.jobId}/drafts/${state.draftId}`) });
    await page.getByRole('button', { name: 'Retry checks', exact: true }).click();
    await ready(); await observe('retry-current-check-ready'); await shot('05-ready-editor-375', 'narrow-and-intake');
    await page.setViewportSize({ width: 1440, height: 1000 });
    const summary = page.locator('[data-resume-path="summary"]');
    const savedSummary = await summary.inputValue();
    await summary.fill(savedSummary + ' Unsaved local addition.');
    await page.getByRole('button', { name: 'Back to resume', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Save and return', exact: true })).toBeFocused();
    await page.getByRole('button', { name: 'Keep editing', exact: true }).click();
    await expect(summary).toHaveValue(savedSummary + ' Unsaved local addition.');
    await page.getByRole('button', { name: 'Back to resume', exact: true }).click();
    await page.getByRole('button', { name: 'Discard unsaved changes and return', exact: true }).click();
    await page.getByRole('button', { name: 'Continue editing', exact: true }).click();
    await expect(page.locator('[data-resume-path="summary"]')).toHaveValue(savedSummary);
    // Internal navigation uses the same save/stay/discard guard and intended destination.
    await summary.fill(savedSummary + ' Local note.');
    await page.getByRole('link', { name: 'Jobs', exact: true }).click();
    await page.getByRole('button', { name: 'Keep editing', exact: true }).click();
    await summary.fill(savedSummary);
    await page.locator('[data-resume-path="profile.name"]').fill(editedName + ' ');
    await page.getByRole('link', { name: 'Jobs', exact: true }).click();
    await page.getByRole('button', { name: 'Save and return', exact: true }).click();
    await expect(page).toHaveURL(`${origin}/jobs`);
    await page.goto(`${origin}/jobs/${state.jobId}/resume`);
    await page.getByRole('button', { name: 'Continue editing', exact: true }).click();
    if (!await page.locator('[data-resume-path="profile.name"]').isVisible()) await page.getByRole('button', { name: /Profile/ }).click();
    await page.locator('[data-resume-path="profile.name"]').fill(editedName);
    await ready(); await observe('exact-candidate-ready-before-finalize'); await shot('05-ready-finalize-desktop', 'ready-desktop');
    // Lose the response after the real server has committed; recover the same intent after reload.
    await page.route('**/drafts/*/finalize', async route => {
      const response = await route.fetch(); assert.equal(response.status(), 201);
      await observe('finalization-committed-response-deliberately-lost', { request: route.request().postDataJSON(), response: await response.json() });
      await route.abort('connectionfailed');
    }, { times: 1 });
    await page.getByRole('button', { name: 'Finalize resume', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Check finalization result' })).toBeEnabled();
    await page.reload();
    await observe('reloaded-pending-finalization-intent');
    await page.getByRole('button', { name: 'Check finalization result' }).click();
    await expect(page).toHaveURL(`${origin}/jobs/${state.jobId}/resume`);
    await expect(page.getByAltText('Resume page 1')).toBeVisible();
    await download('finalized.pdf', 'Download PDF');
    await shot('06-finalized-desktop', 'ready-desktop');
    assert.equal(modelCalls, state.modelCalls, 'No model calls during editing/finalization');
    progression.push(await verifyPersisted());
    // Every secondary destination, keyboard-only menu and focus restoration at both widths.
    for (const width of [1440, 375]) {
      await page.setViewportSize({ width, height: 1000 });
      for (const label of ['Checks', 'Corrections', 'Comparison & evidence', 'Version history', 'More export options']) {
        const trigger = page.getByRole('button', { name: 'Details', exact: true });
        await trigger.focus(); await page.keyboard.press('Enter');
        await expect(page.getByRole('menuitem', { name: 'Checks', exact: true })).toBeFocused();
        const labels = ['Checks', 'Corrections', 'Comparison & evidence', 'Version history', 'More export options'];
        for (let n = 0; n < labels.indexOf(label); n++) await page.keyboard.press('ArrowDown');
        await page.keyboard.press('Enter');
        await expect(page.getByRole('heading', { name: label, exact: true })).toBeFocused();
        await observe('keyboard-details-heading-focused', { label, width });
        await shot(`07-details-${labels.indexOf(label)}-${width}`, 'narrow-and-intake');
        if (label === 'Version history' && width === 375) {
          const selector = page.getByRole('combobox', { name: 'Artifact version' });
          const currentArtifact = await selector.inputValue();
          const auditColors = async () => {
            const control = await selector.evaluate(element => {
              const style = getComputedStyle(element);
              const luminance = color => {
                const channels = color.match(/[\d.]+/g).slice(0, 3).map(Number).map(value => {
                  const srgb = value / 255;
                  return srgb <= 0.04045 ? srgb / 12.92 : ((srgb + 0.055) / 1.055) ** 2.4;
                });
                return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
              };
              const foreground = luminance(style.color), background = luminance(style.backgroundColor);
              return { theme: document.documentElement.classList.contains('dark') ? 'dark' : 'light',
                color: style.color, background: style.backgroundColor,
                contrast: (Math.max(foreground, background) + 0.05) / (Math.min(foreground, background) + 0.05),
                selected: element.value, selected_label: element.selectedOptions[0].textContent,
                bounds: element.getBoundingClientRect().toJSON(), viewport_width: innerWidth };
            });
            assert.ok(control.contrast >= 4.5, `History selector contrast: ${JSON.stringify(control)}`);
            await observe('history-selector-readable-colors', control);
          };
          await auditColors();
          await page.getByRole('button', { name: 'Toggle theme', exact: true }).click();
          await expect(page.locator('html')).not.toHaveClass(/dark/);
          await auditColors();
          await shot('07-history-control-light-375', 'narrow-and-intake');
          await selector.focus();
          await page.keyboard.press('ArrowUp'); await page.keyboard.press('Enter');
          await expect(selector).toHaveValue(state.parentId);
          await expect(page.getByRole('heading', { name: 'Historical resume', exact: true })).toBeVisible();
          await expect(page.getByRole('link', { name: 'Download historical PDF', exact: true })).toBeVisible();
          await observe('keyboard-selected-historical-version', { historical_artifact: state.parentId, current_artifact: currentArtifact });
          await shot('07-history-selected-light-375', 'narrow-and-intake');
          await page.getByRole('button', { name: 'Back to resume', exact: true }).click();
          await expect(page.getByAltText('Resume page 1')).toHaveAttribute('src', new RegExp(state.parentId));
          await shot('07-history-preview-light-375', 'narrow-and-intake');
          await page.getByRole('button', { name: 'Return to current resume', exact: true }).click();
          await expect(page.getByAltText('Resume page 1')).toHaveAttribute('src', new RegExp(currentArtifact));
          await expect(page.getByRole('button', { name: 'Download PDF', exact: true })).toBeVisible();
          await expect(page.getByRole('heading', { name: 'Resume', exact: true })).toBeVisible();
          await observe('returned-from-history-to-current-resume', { current_artifact: currentArtifact, preview: await page.getByAltText('Resume page 1').getAttribute('src') });
          await shot('07-returned-current-light-375', 'narrow-and-intake');
          await trigger.click();
          await page.getByRole('menuitem', { name: 'Version history', exact: true }).click();
          await expect(selector).toHaveValue(currentArtifact);
          await page.getByRole('button', { name: 'Toggle theme', exact: true }).click();
          await expect(page.locator('html')).toHaveClass(/dark/);
        }
        await page.getByRole('button', { name: 'Back to resume', exact: true }).click();
        await expect(trigger).toBeFocused();
        await observe('details-return-focus-restored', { label, width });
      }
      await page.getByRole('button', { name: 'Details', exact: true }).click();
      await page.keyboard.press('Escape');
      await expect(page.getByRole('menu')).toHaveCount(0);
      await shot(`08-finalized-${width}`, 'ready-desktop');
      await page.goto(`${origin}/jobs`);
      await expect(page.getByRole('button', { name: 'URLs', exact: true })).toHaveAttribute('aria-pressed', 'true');
      await shot(`09-urls-${width}`, 'narrow-and-intake');
      await page.goto(`${origin}/tailor/canvas`);
      if (width === 375) await page.getByRole('tab', { name: 'Job Matcher & Variant' }).click();
      const picker = page.getByRole('combobox', { name: 'Select resume variant' });
      await expect(picker).not.toHaveValue(''); const before = await picker.inputValue(); await picker.focus();
      await picker.fill('snr eng');
      await expect(page.getByRole('option', { name: 'Senior Engineer (template)', exact: true })).toBeVisible();
      await shot(`10-fuzzy-${width}`, 'narrow-and-intake');
      await page.keyboard.press('Escape');
      await expect(picker).toHaveValue(before);
      await picker.fill('zzzzzz'); await expect(page.getByText('No matching resumes')).toBeVisible();
      await observe('visible-no-match', { query: await picker.inputValue(), message: await page.getByText('No matching resumes').innerText(), width });
      await shot(`10-no-match-${width}`, 'narrow-and-intake');
      await picker.fill('snr eng'); await page.keyboard.press('ArrowDown'); await page.keyboard.press('Enter');
      await expect(picker).toHaveValue('Senior Engineer (template)');
      await observe('keyboard-variant-selection', { selected: await picker.inputValue(), width });
      await page.goto(`${origin}/jobs/${state.jobId}/resume`);
    }
    assert.equal(errors.length, 0, errors.join('\n'));
    state.servedAssets = await servedAssets(); delete state.spec;
    fs.writeFileSync(stateFile, JSON.stringify(state, null, 2));
    await context.tracing.stop({ path: path.join(out, 'trace.zip') });
    const observed = await verifyPersisted();
    const extractedTrace = extractReadableTrace(path.join(out, 'trace.zip'), out);
    fs.writeFileSync(path.join(out, 'interaction-journal.jsonl'), journal.map(row => JSON.stringify(row)).join('\n') + '\n');
    for (const filename of ['previous.pdf', 'finalized.pdf']) {
      const command = name => popplerBin ? path.join(popplerBin, name + (process.platform === 'win32' ? '.exe' : '')) : name;
      for (const [tool, args, extension] of [
        ['pdftotext', ['-enc', 'UTF-8', '-layout', path.join(out, filename), '-'], '.txt'],
        ['pdfinfo', [path.join(out, filename)], '.info.txt'],
      ]) {
        const result = await runObservedCommand([command(tool), ...args], root);
        assert.equal(result.exit_code, 0, result.stderr);
        fs.writeFileSync(path.join(out, filename + extension), result.stdout);
      }
    }
    const probeResults = await captureIdentityProbes(currentIdentity(state.servedAssets, observed));
    fs.writeFileSync(path.join(out, 'identity-probes.json'), JSON.stringify(probeResults, null, 2));
    fs.writeFileSync(path.join(out, 'engineering-commands.json'), JSON.stringify(execution, null, 2));
    const planPath = 'docs/superpowers/plans/2026-10-18-resume-editing-and-finalization.md';
    const plan = fs.readFileSync(path.join(root, planPath), 'utf8');
    fs.writeFileSync(path.join(out, 'approved-plan.md'), plan);
    fs.copyFileSync(path.join(root, 'docs/superpowers/specs/2026-10-18-resume-editing-and-finalization-design.md'), path.join(out, 'approved-design.md'));
    const sections = plan.split(/\n## Task /).slice(1).map(section => ({
      task: section.split('\n')[0],
      source_files: [...new Set(section.match(/packages\/[a-zA-Z0-9/_.-]+\.(?:tsx|ts)/g) ?? [])]
        .filter(file => fs.existsSync(path.join(root, file))).map(file => ({ path: file, sha256: sha(fs.readFileSync(path.join(root, file))) })),
    }));
    assert.equal(sections.length, 11);
    fs.writeFileSync(path.join(out, 'checkpoint-source-index.json'), JSON.stringify({ plan: planPath, plan_sha256: sha(plan), tasks: sections, engineering_commands: execution }, null, 2));
    const details = { contract_id: 'resume-editing-finalization', captured_at: new Date().toISOString(), origin,
      engineering: execution, extractedTrace, identity_probes: probeResults,
      fixture_workspace: state.workspace, poppler_bin: popplerBin ?? 'PATH', captures, progression,
      servedAssets: state.servedAssets, observed, errors,
      notes: 'Visible Chromium with real fixture API, SQLite, LaTeX and Poppler; delayed/lost responses intercept actual responses, never synthesize success.' };
    fs.writeFileSync(path.join(out, 'capture-state.json'), JSON.stringify(details, null, 2));
    const artifacts = [
      ...captures.map(({ path }) => ({ path, kind: 'screenshot' })),
      ...['trace.zip', 'trace-events.jsonl', 'trace-network.jsonl', 'trace-actions.jsonl', 'trace-api.jsonl', 'interaction-journal.jsonl'].map(path => ({ path, kind: 'trace' })),
      ...['capture-state.json', 'fixture.json', 'previous.pdf', 'finalized.pdf', 'verified-current.pdf',
        'previous.pdf.txt', 'previous.pdf.info.txt', 'finalized.pdf.txt', 'finalized.pdf.info.txt',
        'build.log', 'tests.log', 'engineering-commands.json', 'identity-probes.json',
        'approved-plan.md', 'approved-design.md', 'checkpoint-source-index.json',
        'identity-1.stdout.json', 'identity-2.stdout.json', 'identity-regression.stderr.txt'].map(path => ({ path, kind: 'state' })),

    ];
    const manifest = captureManifest(currentIdentity(state.servedAssets, observed),
      ['ready-desktop', 'pending-and-reactive', 'narrow-and-intake'], artifacts);
    fs.writeFileSync(process.argv.includes('--manifest') ? path.resolve(arg('--manifest')) : path.join(out, 'manifest.json'), JSON.stringify(manifest, null, 2));
    console.log(JSON.stringify({ status: 'captured', captures: captures.length, out }));
  }
} catch (error) {
  if (mode === 'capture' && page) { await page.screenshot({ path: path.join(out, 'capture-failure.png'), fullPage: true }).catch(() => {}); fs.writeFileSync(path.join(out, 'capture-failure.txt'), `${error.stack}\n${await page.locator('body').innerText().catch(() => '')}`); }
  if (mode === 'capture' && context) await context.tracing.stop({ path: path.join(out, 'failure-trace.zip') }).catch(() => {});
  throw error;
} finally {
  await browser?.close();
  await app.disposeJobs();
  server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
}
