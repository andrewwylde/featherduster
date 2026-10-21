// Disposable fixture-backed browser proof. Never uses the live career workspace or port 4173.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import yaml from 'js-yaml';
import { spawnSync, spawn } from 'node:child_process';
import { chromium, expect } from 'playwright/test';
import { PdfVerifier } from '../packages/cli/dist/render/pdf-verifier.js';
import { compileTemplateResume, discoverEvidence } from '../packages/core/dist/index.js';
import { getLatexTemplate } from '../packages/cli/dist/jobs/templates.js';
import { makeAutomaticResumeFixture } from './automatic-resume-fixture.mjs';
import { renderedResumePages, screenshotResumeInk } from './automatic-resume-preview.mjs';
import { copyCurrentEngineering } from './automatic-resume-engineering.mjs';
import { fetchCapturedResource } from './automatic-resume-http.mjs';
import { assertCapturedServer, requiredOutcomes, assertRequiredOutcomes } from './automatic-resume-observation.mjs';
import { currentIdentity } from './resume-finalization-evidence.mjs';
import { extractReadableTrace } from './resume-finalization-inspection.mjs';

const args = process.argv.slice(2), identityOnly = args.includes('--identity');
const argument = flag => { const index = args.indexOf(flag); assert.ok(index >= 0 && args[index + 1] && !args[index + 1].startsWith('--'), `${flag} requires an absolute path`); assert.ok(path.isAbsolute(args[index + 1]), `${flag} must be absolute`); return args[index + 1]; };
const manifestPath = argument('--manifest');
const out = identityOnly ? path.dirname(manifestPath) : argument('--evidence-dir');
assert.equal(path.dirname(manifestPath), out, 'Manifest must be in the evidence directory');
const known = new Set(['--identity', '--manifest', '--evidence-dir']);
for (let i = 0; i < args.length; i++) { assert.ok(known.has(args[i]), `Unknown argument: ${args[i]}`); if (args[i] !== '--identity') i++; }
let engineering;
if (!identityOnly) {
  fs.mkdirSync(out, { recursive: true }); assert.ok(!fs.existsSync(manifestPath), 'Use a fresh evidence directory');
  engineering = copyCurrentEngineering(process.cwd(), path.join(out, 'engineering'));
}
const statePath = path.join(out, 'fixture.json'), sha = bytes => createHash('sha256').update(bytes).digest('hex');
let state = identityOnly ? JSON.parse(fs.readFileSync(statePath, 'utf8')) : await makeAutomaticResumeFixture();
assert.ok(path.basename(state.workspace).startsWith('featherduster-automatic-resume-') && fs.existsSync(path.join(state.workspace, '.automatic-resume-disposable')), 'Refusing a non-disposable workspace');
const sharedHashes = () => {
  const files = [];
  const visit = relative => { for (const entry of fs.readdirSync(path.join(state.workspace, relative), { withFileTypes: true })) {
    assert.ok(!entry.isSymbolicLink(), 'Disposable shared sources must not be symlinks');
    const name = `${relative}/${entry.name}`;
    if (entry.isDirectory()) visit(name); else if (entry.isFile()) files.push(name);
  } };
  visit('resumes'); visit('evidence');
  return Object.fromEntries(files.sort().map(file => [file, sha(fs.readFileSync(path.join(state.workspace, file)))]));
};
const poppler = process.env.POPPLER_BIN || (process.platform === 'win32' ? path.join(process.env.LOCALAPPDATA, 'Programs/poppler/Library/bin') : undefined);
const verifier = new PdfVerifier(poppler ? { tools: Object.fromEntries(['pdfinfo', 'pdftotext', 'pdftoppm'].map(name => [name, { command: path.join(poppler, `${name}${process.platform === 'win32' ? '.exe' : ''}`) }])) } : {});
const journal = [], screenshots = [];
let dispatches = [], ownedHost, successful = false, origin = state.host?.origin;
if (!identityOnly) {
  const hostFile = path.join(state.workspace, '.automatic-host.json'), token = randomUUID();
  const log = fs.openSync(path.join(state.workspace, 'automatic-host.log'), 'a');
  ownedHost = spawn(process.execPath, ['scripts/automatic-resume-host.mjs', '--workspace', state.workspace, '--state', hostFile, '--token', token],
    { cwd: process.cwd(), detached: true, windowsHide: true, stdio: ['ignore', log, log] });
  ownedHost.unref(); fs.closeSync(log);
  await expect.poll(() => fs.existsSync(hostFile), { timeout: 30000 }).toBe(true);
  state.host = JSON.parse(fs.readFileSync(hostFile, 'utf8')); origin = state.host.origin;
  assert.equal(state.host.pid, ownedHost.pid, 'Capture must bind its owned original host');
}
assert.ok(origin && new URL(origin).hostname === '127.0.0.1', 'Captured loopback deployment required; identity never starts a replacement');
let browser, context, page, releasePreview, previewDelivery;
async function api(url, body, method = 'POST', expected = 200) {
  const headers = { ...(url.startsWith('/__automatic-resume/') ? { 'x-fixture-token': state.host.token } : {}), ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) };
  const verb = body === undefined ? 'GET' : method;
  if (!identityOnly) journal.push({ action: 'http-start', at: new Date().toISOString(), origin, url, method: verb });
  let response, value;
  try {
    response = await fetchCapturedResource(origin, url, { headers, signal: AbortSignal.timeout(15000), ...(body === undefined ? {} : { method, body: JSON.stringify(body) }) });
    value = await response.json();
  } catch (cause) {
    if (!identityOnly) journal.push({ action: 'http-error', at: new Date().toISOString(), origin, url, method: verb, status: response?.status, error: cause.message, code: cause.code ?? cause.cause?.code });
    throw new Error(`Capture ${verb} ${origin}${url} failed (${cause.code ?? cause.cause?.code ?? cause.name})`, { cause });
  }
  if (!identityOnly) journal.push({ action: 'api', at: new Date().toISOString(), url, method: body === undefined ? 'GET' : method, request: body, status: response.status, response: value });
  assert.equal(response.status, expected, `${url}: ${JSON.stringify(value)}`); return value;
}
async function hostSnapshot() {
  const value = await api('/__automatic-resume/observations');
  assertCapturedServer(value.server, state.host); dispatches = value.dispatches; return value;
}
async function hostControl(body) { return api('/__automatic-resume/control', body); }
async function assets() {
  const html = await (await fetchCapturedResource(origin, '/')).text(), urls = [...html.matchAll(/(?:src|href)="([^" ]+\.(?:js|css))"/g)].map(match => match[1]);
  assert.ok(urls.length >= 2, 'Actual built app must be served');
  if (engineering) assert.equal(sha(html), engineering.outputs['packages/cli/dist/ui/index.html'], 'Served HTML differs from the verified build');
  return { '/': sha(html), ...Object.fromEntries(await Promise.all(urls.map(async url => {
    const response = await fetchCapturedResource(origin, url); assert.equal(response.status, 200);
    const digest = sha(Buffer.from(await response.arrayBuffer()));
    if (engineering) assert.equal(digest, engineering.outputs[`packages/cli/dist/ui${url}`], `Served asset differs from verified build: ${url}`);
    return [url, digest];
  }))) };
}
async function observed() {
  const batch = await api(`/api/jobs/preparation-batches/${state.batchId}`);
  const jobs = await Promise.all(state.jobs.map(async ({ id }) => api(`/api/jobs/${id}`)));
  const supplemental = await Promise.all([state.guardJobId, state.budgetJobId].filter(Boolean).map(id => api(`/api/jobs/${id}`)));
  const artifacts = [];
  for (const detail of [...jobs, ...supplemental]) for (const artifact of detail.artifacts) {
    const review = await api(`/api/jobs/${detail.job.id}/artifacts/${artifact.id}/review`);
    const bytes = Buffer.from(await (await fetchCapturedResource(origin, `/api/jobs/${detail.job.id}/artifacts/${artifact.id}/pdf`)).arrayBuffer());
    assert.ok(bytes.subarray(0, 5).toString() === '%PDF-', 'Actual PDF bytes required');
    // Verification uses a temporary OS directory, never captured evidence or workspace mutations in identity mode.
    const os = await import('node:os'), temp = fs.mkdtempSync(path.join(os.tmpdir(), 'automatic-pdf-probe-'));
    try {
      const file = path.join(temp, 'resume.pdf'); fs.writeFileSync(file, bytes);
      const compiled = compileTemplateResume(getLatexTemplate('default'), review.draft.candidate, {});
      const result = await verifier.verify(file, { expectedText: compiled.expectedText, pageBudget: 1 });
      assert.equal(result.report.passed, true, JSON.stringify(result.report));
      if (!identityOnly) {
        fs.writeFileSync(path.join(out, `${artifact.id}.pdf`), bytes);
        fs.writeFileSync(path.join(out, `${artifact.id}-coverage.json`), JSON.stringify(result.report, null, 2));
        for (const [name, argv, suffix] of [['pdftotext', ['-enc', 'UTF-8', '-layout', file, '-'], 'text.txt'], ['pdfinfo', [file], 'pages.txt']]) {
          const command = poppler ? path.join(poppler, `${name}${process.platform === 'win32' ? '.exe' : ''}`) : name;
          const extracted = spawnSync(command, argv, { encoding: 'utf8', timeout: 30000 });
          assert.equal(extracted.status, 0, extracted.stderr);
          fs.writeFileSync(path.join(out, `${artifact.id}-${suffix}`), extracted.stdout);
        }
      }
      artifacts.push({ id: artifact.id, sha256: sha(bytes), input: artifact.input_fingerprint, draft: review.draft, report: result.report });
    } finally { fs.rmSync(temp, { recursive: true, force: true }); }
  }
  assert.deepEqual(sharedHashes(), state.sharedHashes, 'Shared resumes/evidence must remain unchanged');
  const host = await hostSnapshot();
  return { batch, jobs, supplemental, artifacts, host: { server: host.server, corpus_revision: host.corpus_revision }, durable: host.durable, shared: sharedHashes() };
}
async function queueAction(name) {
  const button = page.getByRole('button', { name, exact: true });
  if (!await button.isVisible()) await page.getByText('Queue progress and actions', { exact: true }).click();
  await button.click();
}
async function shot(name) {
  await page.evaluate(() => scrollTo(0, 0));
  const requiresPdf = /ready-and-changes|ready-pdf|new-(verified-)?pdf|approved-omission-awaiting-pdf/.test(name);
  const pages = await renderedResumePages(page, requiresPdf);
  if (name === 'narrow-ready-pdf') {
    const image = await page.getByAltText('Resume page 1').boundingBox();
    assert.ok(image && image.y <= 650, `Resume-first regression: PDF begins at ${image?.y}px`);
    journal.push({ action: 'narrow-pdf-position', image, viewport: page.viewportSize() });
  }
  if (name === 'narrow-details-menu') {
    const items = await page.getByRole('menuitem').evaluateAll(nodes => nodes.map(node => {
      const r = node.getBoundingClientRect(), hit = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
      return { text: node.textContent, x: r.x, y: r.y, right: r.right, bottom: r.bottom, hittable: !!hit && node.contains(hit) };
    }));
    assert.equal(items.length, 5);
    assert.ok(items.every(item => item.x >= 0 && item.right <= 375 && item.bottom <= 780 && item.hittable), `Clipped Details: ${JSON.stringify(items)}`);
    journal.push({ action: 'narrow-details-hit-targets', items });
  }
  const png = await page.screenshot({ path: path.join(out, `${name}.png`), fullPage: true });
  const paintedPages = await screenshotResumeInk(page, png, pages);
  journal.push({ action: 'preview-render-readiness', name, at: new Date().toISOString(), pages, paintedPages, screenshot_sha256: sha(png) });
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `${name}: horizontal overflow`);
  screenshots.push(`${name}.png`);
  journal.push({ action: 'screenshot', name, url: page.url(), viewport: page.viewportSize(), text: await page.locator('main').last().innerText() });
}
async function otherViewportShot(name) {
  const before = page.viewportSize();
  await page.setViewportSize(before.width === 375 ? { width: 1440, height: 1000 } : { width: 375, height: 850 });
  await shot(name); await page.setViewportSize(before);
}
async function batchReady(predicate) {
  await expect.poll(async () => { const progress = await api(`/api/jobs/preparation-batches/${state.batchId}`); return predicate(progress); }, { timeout: 180000, intervals: [500, 1000] }).toBe(true);
}
try {
  if (identityOnly) {
    const captured = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    assertCapturedServer(await api('/__automatic-resume/identity'), state.host);
    const before = sha(fs.readFileSync(manifestPath)), observedNow = await observed();
    assertRequiredOutcomes(observedNow, state.required);
    const current = currentIdentity(await assets(), observedNow);
    assert.equal(sha(fs.readFileSync(manifestPath)), before);
    assertCapturedServer(await api('/__automatic-resume/identity'), state.host);
    assert.equal(current.served_build_identity, captured.served_build_identity, 'Captured served deployment changed');
    assert.equal(current.outcome_identity, captured.outcome_identity, 'Captured outcomes regressed or changed');
    console.log(JSON.stringify(current));
  } else {
    state.sharedHashes = sharedHashes(); state.jobs = [];
    for (let n = 1; n <= 7; n++) {
      const preview = await api('/api/jobs/preview', { mode: 'text', input: `AUTOMATIC_CASE_${n}: Engineer. Build documented systems.`, details: { company: `Harbor opportunity ${n}`, role: `Engineer ${n}`, context_url: `https://example.com/posting/${n}` } });
      const saved = await api('/api/jobs', { preview_id: preview.preview_id, idempotency_key: `intake-${n}` });
      const id = saved.items[0].job_id, detail = await api(`/api/jobs/${id}`);
      await api(`/api/jobs/${id}`, { expected_revision: detail.job.revision, changes: { base_resume_id: `template-automatic-${n}` } }, 'PUT');
      state.jobs.push({ id, case: n });
    }
    // A real earlier PDF receives explicit human approval before the new selected batch.
    const first = state.jobs[0].id, initial = await api(`/api/jobs/${first}`);
    const captured = await api(`/api/jobs/${first}/inputs`, { expected_revision: initial.job.revision }, 'POST', 201);
    await api(`/api/jobs/${first}/prepare`, { expected_revision: initial.job.revision, input_snapshot_id: captured.input_snapshot.id, idempotency_key: 'historical-prepare' }, 'POST', 202);
    await expect.poll(async () => (await api(`/api/jobs/${first}`)).job.preparation_state, { timeout: 180000 }).toBe('resume_ready');
    const historical = await api(`/api/jobs/${first}`), old = historical.artifacts.at(-1);
    assert.ok(old, JSON.stringify(historical)); state.priorArtifactId = old.id;
    await api(`/api/jobs/${first}/artifacts/${old.id}/approve`, { expected_job_revision: historical.job.revision, artifact_fingerprint: old.version_fingerprint, input_snapshot_id: old.input_snapshot_id, input_fingerprint: old.input_fingerprint, idempotency_key: 'prior-human-approval' });
    browser = await chromium.launch({ headless: true }); context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, acceptDownloads: true });
    await context.tracing.start({ screenshots: true, snapshots: true, sources: true }); page = await context.newPage();
    page.on('response', async response => { if (response.url().includes('/api/jobs')) { let body; try { body = await response.json(); } catch {} journal.push({ action: 'browser-response', url: response.url(), status: response.status(), request: response.request().postData(), response: body }); } });
    const previewGate = new Promise(resolve => { releasePreview = resolve; });
    let heldPreview = false;
    await page.route('**/artifacts/*/previews/*', async route => {
      if (heldPreview) return route.continue();
      heldPreview = true;
      previewDelivery = (async () => { const response = await route.fetch(); await previewGate; await route.fulfill({ response }); })();
      await previewDelivery;
    });
    await page.goto(origin + '/jobs'); await expect(page.getByRole('heading', { name: 'Saved jobs', exact: true })).toBeVisible(); await shot('desktop-start'); await otherViewportShot('narrow-start');
    for (const n of [2, 1, 3, 4, 5, 6, 7]) await page.getByRole('checkbox', { name: `Select Harbor opportunity ${n} Engineer ${n}`, exact: true }).check();
    await hostControl({ hold: { caseId: 2, operation: 'analysis' } });
    const started = page.waitForResponse(response => response.url().endsWith('/api/jobs/preparation-batches') && response.request().method() === 'POST');
    await page.getByRole('button', { name: 'Prepare resumes (7)', exact: true }).click();
    const startResponse = await started, startedBody = await startResponse.json(); assert.equal(startResponse.status(), 202); state.batchId = startedBody.result.id;
    const batchRequest = startResponse.request().postDataJSON();
    await api('/api/jobs/preparation-batches', batchRequest, 'POST', 202);
    await expect.poll(async () => (await hostSnapshot()).control.entered, { timeout: 10000 }).toBe(true);
    const contended = await api(`/api/jobs/preparation-batches/${state.batchId}`), occupied = await api('/api/jobs/control');
    assert.equal(occupied.active.length, 1); assert.equal(contended.members.filter(member => member.state === 'pending').length, 6);
    const beforeWait = (await hostSnapshot()).dispatches.filter(call => call.at >= contended.batch.created_at);
    assert.equal(beforeWait.length, 1); assert.equal(beforeWait[0].caseId, 2);
    assert.equal((await api(`/api/jobs/preparation-batches/${state.batchId}/questions`)).groups.length, 0);
    for (let i = 0; i < 3; i++) { await page.reload(); await api('/api/jobs/preparation-batches', batchRequest, 'POST', 202); }
    const afterWait = (await hostSnapshot()).dispatches.filter(call => call.at >= contended.batch.created_at);
    assert.equal(afterWait.length, 1, 'Pending members must wait, not dispatch duplicate work or ask worker-busy questions');
    fs.writeFileSync(path.join(out, 'worker-contention.json'), JSON.stringify({ occupied, contended, dispatchesBefore: beforeWait, dispatchesAfterRefreshAndReplay: afterWait }, null, 2));
    await page.getByText('Queue progress and actions', { exact: true }).click(); await shot('desktop-worker-contention');
    await page.getByText('Queue progress and actions', { exact: true }).click();
    await hostControl({ release: true });
    await expect(page.getByAltText('Resume page 1')).toBeVisible({ timeout: 180000 });
    await expect(page.getByRole('button', { name: 'Approve & next', exact: true })).toBeDisabled();
    await expect(page.getByText('Loading current PDF preview…', { exact: true })).toBeVisible();
    await expect.poll(() => heldPreview).toBe(true);
    const pendingPixels = await page.getByAltText('Resume page 1').evaluate(image => ({ src: image.src, complete: image.complete, natural_width: image.naturalWidth, state: image.dataset.previewState }));
    assert.equal(pendingPixels.natural_width, 0);
    const readyWhileLoading = await api(`/api/jobs/preparation-batches/${state.batchId}`);
    assert.ok(readyWhileLoading.queue.some(item => item.job_id === state.jobs[1].id), 'The backend is ready while its browser image response is deliberately delayed');
    await page.evaluate(() => scrollTo(0, 0)); await page.screenshot({ path: path.join(out, 'desktop-preview-loading.png'), fullPage: true });
    fs.writeFileSync(path.join(out, 'preview-loading-proof.json'), JSON.stringify({ pendingPixels, approval_disabled: true, backend_ready: true, deliberate_image_delay: true }, null, 2));
    releasePreview(); await previewDelivery; await page.unroute('**/artifacts/*/previews/*');
    await expect(page.getByRole('button', { name: 'Approve & next', exact: true })).toBeEnabled();
    const pinned = await page.getByRole('heading', { name: /^Harbor opportunity \d — Engineer \d$/ }).innerText(); await shot('desktop-ready-and-changes');
    await batchReady(progress => progress.counts.ready >= 3 && progress.counts.questions >= 3 && progress.counts.technical === 1);
    await queueAction('Refresh progress');
    assert.equal(await page.getByRole('heading', { name: /^Harbor opportunity \d — Engineer \d$/ }).innerText(), pinned, 'New readiness must not steal the displayed resume');
    await page.getByText(/Other jobs: .* need recovery — review actions/).click();
    await shot('desktop-technical-recovery'); await otherViewportShot('narrow-technical-recovery');
    await page.getByText(/Other jobs: .* need recovery — review actions/).click();
    await hostSnapshot(); const counts = dispatches.length; for (let i = 0; i < 3; i++) { await page.reload(); await expect(page.getByAltText('Resume page 1')).toBeVisible(); }
    await hostSnapshot(); assert.equal(dispatches.length, counts, 'Reloading must not dispatch model work');
    const progress = await api(`/api/jobs/preparation-batches/${state.batchId}`);
    const retrieval = dispatches.filter(call => call.operation === 'semantic').map(call => ({ call, batch: JSON.parse(call.prompt) }))
      .find(({ batch }) => batch.subjects.some(subject => subject.text === 'Built release automation.' && subject.work_context?.includes('harbor-orchestration')));
    assert.ok(retrieval, 'The captured citation/work context must reach the actual classifier request');
    const selectedSource = retrieval.batch.sources.find(source => source.evidence_id === 'harbor-orchestration' && source.field === 'summary');
    assert.ok(selectedSource, 'Cited context must retrieve the relevant source despite the keyword mismatch');
    assert.equal(discoverEvidence('Built release automation.', [{ id: selectedSource.evidence_id, fingerprint: selectedSource.evidence_fingerprint, work_id: selectedSource.work_id, text: selectedSource.text, retracted: false }]).matches.length, 0);
    fs.writeFileSync(path.join(out, 'retrieval-mismatch-probe.json'), JSON.stringify({ query: 'Built release automation.', selectedSource, coverage: retrieval.batch.coverage, classification: retrieval.call.result }, null, 2));
    assert.deepEqual(progress.batch.members.map(m => m.job_id), [2, 1, 3, 4, 5, 6, 7].map(n => state.jobs[n - 1].id));
    const cacheJob = await api(`/api/jobs/${state.jobs[1].id}`), cacheReview = await api(`/api/jobs/${cacheJob.job.id}/artifacts/${cacheJob.artifacts.at(-1).id}/review`);
    assert.deepEqual(cacheReview.draft.candidate.experiences[0].bullets.map(b => b.text), ['Built release automation.', 'Implemented caching.']);
    assert.deepEqual(cacheReview.draft.candidate.skills[0].skills, ['SQL', 'TypeScript']);
    await queueAction('Answer preparation questions');
    await expect(page.getByRole('heading', { name: 'Is AI Analytics the same feature as Time Spend reporting?' })).toBeVisible(); await shot('desktop-grouped-questions');
    await page.goto(origin + '/jobs');
    await page.getByRole('button', { name: 'Review jobs', exact: true }).click();
    await page.getByRole('link', { name: 'Review Harbor opportunity 3 — Engineer 3', exact: true }).click();
    await expect(page).toHaveURL(origin + `/jobs/preparation-batches/${state.batchId}/questions`);
    await page.goto(origin + '/jobs');
    await page.getByRole('link', { name: 'Harbor opportunity 3 — Engineer 3', exact: true }).click();
    await expect(page).toHaveURL(origin + `/jobs/preparation-batches/${state.batchId}/questions`);
    await shot('desktop-direct-question-navigation');
    const questions = await api(`/api/jobs/preparation-batches/${state.batchId}/questions`), equivalent = questions.groups.find(g => g.members.length === 2 && g.members[0].fact.predicate === 'feature-identity');
    assert.ok(equivalent, 'Two equivalent factual questions must share a group');
    const mismatched = structuredClone(equivalent.members[1]); mismatched.fact.work_id = 'different-employer/different-project';
    const rejectedScope = await api(`/api/jobs/preparation-batches/${state.batchId}/questions/${equivalent.id}/answers`, { members: [mismatched], action: 'answer', assertion: 'This must not be attached to a different project.', confirmed: true, kind: 'confirmation', idempotency_key: 'reject-mismatched-project' });
    assert.equal(rejectedScope.result[0].status, 'conflict');
    const confirmedBoth = await api(`/api/jobs/preparation-batches/${state.batchId}/questions/${equivalent.id}/answers`, { members: equivalent.members, action: 'answer', assertion: 'AI Analytics was the same feature as Time Spend reporting.', confirmed: true, kind: 'confirmation', idempotency_key: 'equivalent-feature-answer' });
    assert.equal(confirmedBoth.result.filter(r => r.status === 'saved').length, 2);
    await batchReady(progress => progress.members.filter(member => [state.jobs[2].id, state.jobs[3].id].includes(member.job_id)).every(member => member.state === 'question'));
    const group = (await api(`/api/jobs/preparation-batches/${state.batchId}/questions`)).groups.find(g => g.members.length === 2 && g.members[0].fact.predicate === 'production-deployment');
    assert.ok(group, 'The next equivalent question must remain independently editable');
    const staleId = state.jobs[3].id, stale = await api(`/api/jobs/${staleId}`);
    await api(`/api/jobs/${staleId}/details`, { expected_revision: stale.job.revision, idempotency_key: 'stale-member', changes: { role: 'Changed role requiring review' } }, 'PUT');
    const answer = { members: group.members, action: 'answer', assertion: 'I need to verify deployment.', confirmed: false, kind: 'confirmation', idempotency_key: 'grouped-answer' };
    const answered = await api(`/api/jobs/preparation-batches/${state.batchId}/questions/${group.id}/answers`, answer);
    assert.equal(answered.result.filter(r => r.status === 'saved').length, 1); assert.equal(answered.result.find(r => r.job_id === staleId).status, 'conflict');
    assert.deepEqual((await api(`/api/jobs/preparation-batches/${state.batchId}/questions/${group.id}/answers`, answer)).result, answered.result);
    await page.reload(); await expect(page.getByRole('heading', { name: 'Was the release tooling deployed for users?' })).toBeVisible();
    await page.getByLabel('Your factual answer', { exact: true }).fill('I need to verify deployment.');
    await expect(page.getByLabel('Your factual answer', { exact: true })).toHaveValue('I need to verify deployment.');
    let releaseQuestions;
    const questionGate = new Promise(resolve => { releaseQuestions = resolve; });
    await page.route('**/preparation-batches/*/questions', async route => { const response = await route.fetch(); await questionGate; await route.fulfill({ response }); });
    await page.getByRole('button', { name: 'Answer later', exact: true }).first().click();
    await page.getByLabel('Your factual answer', { exact: true }).fill('Next answer stays editable while checks refresh.');
    await expect(page.getByLabel('Your factual answer', { exact: true })).toBeEnabled();
    await shot('desktop-next-answer-during-refresh');
    releaseQuestions(); await page.unrouteAll({ behavior: 'wait' });
    await page.getByRole('button', { name: 'Answer later', exact: true }).last().click();
    await page.setViewportSize({ width: 375, height: 850 }); await shot('narrow-questions-and-material-decision');
    await page.getByRole('button', { name: 'Use narrower wording', exact: true }).click();
    await batchReady(progress => progress.counts.ready >= 4);
    journal.push({ action: 'narrower-decision', explanation: 'Selected the exact displayed captured prototype wording without attesting production deployment.' });
    await page.goto(origin + `/jobs/preparation-batches/${state.batchId}/review`); await expect(page.getByAltText('Resume page 1')).toBeVisible(); await shot('narrow-ready-pdf');
    const detailsButton = page.getByRole('button', { name: 'Details', exact: true }); await detailsButton.focus(); await page.keyboard.press('Enter'); await shot('narrow-details-menu');
    await page.getByRole('menuitem', { name: 'Version history', exact: true }).click();
    await page.getByText('Automatic repair history', { exact: true }).click();
    await shot('narrow-mechanical-history'); await otherViewportShot('desktop-mechanical-history');
    await page.getByRole('button', { name: 'Back to resume', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Details', exact: true })).toBeFocused();
    // Server rejection must leave the exact current queue item visible.
    await page.route('**/artifacts/*/approve', route => route.fulfill({ status: 409, contentType: 'application/json', body: JSON.stringify({ code: 'revision_conflict', error: 'Fixture stale approval response. Reload this PDF.' }) }));
    await page.getByRole('button', { name: 'Approve & next', exact: true }).click(); await expect(page.getByRole('alert')).toContainText('Fixture stale approval'); await shot('narrow-approval-failure'); await otherViewportShot('desktop-approval-failure');
    await page.unroute('**/artifacts/*/approve');
    await page.getByRole('button', { name: 'Reload review', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Approve & next', exact: true })).toBeEnabled();
    const approvalResponse = page.waitForResponse(response => /\/artifacts\/[^/]+\/approve$/.test(response.url()) && response.status() === 200);
    await page.getByRole('button', { name: 'Approve & next', exact: true }).click(); const approvedResponse = await approvalResponse;
    await api(new URL(approvedResponse.url()).pathname, approvedResponse.request().postDataJSON());
    await expect(page.getByAltText('Resume page 1')).toBeVisible();
    await expect(page.getByRole('heading', { name: /^Harbor opportunity \d — Engineer \d$/ })).not.toHaveText(pinned);
    await shot('narrow-approval-success'); await otherViewportShot('desktop-approval-success');
    for (let i = 0; i < 5; i++) {
      const button = page.getByRole('button', { name: 'Review later', exact: true });
      const complete = page.getByRole('heading', { name: 'All remaining resumes reviewed later', exact: true });
      await expect.poll(async () => await complete.isVisible() || await button.isVisible()).toBe(true);
      if (await complete.isVisible()) break;
      const previous = await page.getByRole('heading', { name: /^Harbor opportunity \d — Engineer \d$/ }).innerText();
      await button.click();
      await expect(page.getByRole('heading', { name: previous, exact: true })).not.toBeVisible();
    }
    await expect(page.getByRole('heading', { name: 'All remaining resumes reviewed later' })).toBeVisible(); await shot('narrow-all-deferred');
    await page.setViewportSize({ width: 1440, height: 1000 }); await shot('desktop-all-deferred');
    const download = page.waitForEvent('download');
    await page.getByRole('link', { name: 'Download unapproved PDF', exact: true }).first().click();
    await (await download).saveAs(path.join(out, 'separate-unapproved-download.pdf'));
    await page.getByRole('button', { name: 'Review Harbor opportunity 2', exact: true }).click();
    await expect(page.getByAltText('Resume page 1')).toBeVisible();
    const undoVersion = (await api(`/api/jobs/${state.jobs[1].id}`)).artifacts.at(-1);
    const regressionDir = path.join(out, 'identity-regression'); fs.mkdirSync(regressionDir);
    const baseline = await observed(), baselineIdentity = currentIdentity(await assets(), baseline);
    const baselineState = { ...state, required: requiredOutcomes(baseline) };
    fs.writeFileSync(path.join(regressionDir, 'fixture.json'), JSON.stringify(baselineState, null, 2));
    const regressionManifest = path.join(regressionDir, 'manifest.json');
    fs.writeFileSync(regressionManifest, JSON.stringify({ ...baselineIdentity, identity_method: 'Original running host and current outcomes', observation: 'Before checked Undo invalidates a current approval', scenario_ids: ['batch', 'review'], artifacts: [{ path: 'fixture.json', kind: 'state' }] }, null, 2));
    const identityProbe = () => {
      const started = Date.now();
      const result = spawnSync(process.execPath, ['scripts/capture-automatic-resume-delivery.mjs', '--identity', '--manifest', regressionManifest], { encoding: 'utf8', timeout: 180000 });
      journal.push({ action: 'identity-process', started, ended: Date.now(), status: result.status, stdout: result.stdout, stderr: result.stderr, error: result.error?.message });
      return result;
    };
    const beforeRegression = identityProbe(); assert.equal(beforeRegression.status, 0, beforeRegression.stderr);
    await page.getByText('Change details and Undo', { exact: true }).click();
    await page.getByRole('button', { name: 'Undo wording change', exact: true }).click();
    await batchReady(progress => progress.members.find(m => m.job_id === state.jobs[1].id).state === 'question');
    await queueAction('Refresh progress');
    await expect(page.getByRole('button', { name: 'Approve & next', exact: true })).toBeDisabled();
    await shot('desktop-undo-checked-edit-refreshing'); await otherViewportShot('narrow-undo-checked-edit-refreshing');
    const immutableBefore = fs.readdirSync(regressionDir).map(name => [name, sha(fs.readFileSync(path.join(regressionDir, name)))]);
    const afterRegression = identityProbe(); assert.notEqual(afterRegression.status, 0, 'Identity must reject loss of a required current approval');
    assert.match(afterRegression.stderr, /Current approval outcome regressed|Current verified PDF\/approval outcome regressed/);
    assert.deepEqual(fs.readdirSync(regressionDir).map(name => [name, sha(fs.readFileSync(path.join(regressionDir, name)))]), immutableBefore);
    // Exercise the failed boundary under an intentional pause longer than the host's
    // default five-second HTTP idle timeout. No HTTP request is replayed afterward.
    const idleBoundaryStarted = Date.now();
    const idlePause = spawnSync(process.execPath, ['-e', 'setTimeout(() => {}, 7000)'], { encoding: 'utf8', timeout: 15000 });
    assert.equal(idlePause.status, 0, idlePause.stderr);
    journal.push({ action: 'idle-connection-boundary', duration_ms: Date.now() - idleBoundaryStarted, connection_policy: 'close-after-response', retries: 0 });
    const serverAfterRegression = await api('/__automatic-resume/identity'); assertCapturedServer(serverAfterRegression, state.host);
    fs.writeFileSync(path.join(out, 'identity-regression.json'), JSON.stringify({ capturedServer: state.host, observedServerAfter: serverAfterRegression, before: { exit: beforeRegression.status, stdout: beforeRegression.stdout }, after: { exit: afterRegression.status, stderr: afterRegression.stderr }, savedEvidenceUnchanged: true, action: 'Real checked Undo invalidated the current approved artifact; no replacement host was started.' }, null, 2));
    await queueAction('Answer preparation questions');
    await expect(page.getByRole('heading', { name: 'Did you lead the caching implementation?' })).toBeVisible();
    await page.getByLabel('Your factual answer', { exact: true }).fill('I led this caching implementation; this is a job-local confirmation after Undo.');
    await page.getByRole('checkbox', { name: 'I confirm this answer for this work and the visibly selected jobs.', exact: true }).check();
    await page.getByRole('button', { name: 'Save answer', exact: true }).click();
    await batchReady(progress => progress.queue.some(q => q.job_id === state.jobs[1].id && q.artifact_id !== undoVersion.id));
    await page.getByRole('button', { name: 'Review prepared PDFs', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Approve & next', exact: true })).toBeEnabled();
    await shot('desktop-undo-new-pdf');
    await page.getByRole('button', { name: 'Approve & next', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'All remaining resumes reviewed later' })).toBeVisible();
    await page.getByRole('button', { name: 'Review Harbor opportunity 1', exact: true }).click();
    await expect(page.getByAltText('Resume page 1')).toBeVisible();
    const beforeEdit = (await api(`/api/jobs/${first}`)).artifacts.at(-1);
    await hostControl({ checkerOffline: true });
    await page.getByRole('button', { name: 'Edit resume', exact: true }).click();
    await page.getByRole('button', { name: 'Candidate Profile', exact: true }).click();
    await page.locator('[data-resume-path="profile.title"]').fill('Software Engineer — reviewed draft');
    await expect(page.getByText('Checks unavailable', { exact: true })).toBeVisible({ timeout: 30000 });
    await expect(page.getByRole('button', { name: 'Save draft', exact: true })).toBeEnabled();
    await page.getByRole('button', { name: 'Save draft', exact: true }).click();
    await expect(page.getByText('Draft saved', { exact: true })).toBeVisible(); await shot('desktop-save-during-checker-outage'); await otherViewportShot('narrow-save-during-checker-outage');
    await page.getByRole('button', { name: 'Back to resume', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Review prepared resumes', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Approve & next', exact: true })).toBeDisabled();
    const changed = await api(`/api/jobs/${first}`);
    await api(`/api/jobs/${first}/artifacts/${beforeEdit.id}/approve`, { expected_job_revision: changed.job.revision, artifact_fingerprint: beforeEdit.version_fingerprint,
      input_snapshot_id: beforeEdit.input_snapshot_id, input_fingerprint: beforeEdit.input_fingerprint, idempotency_key: 'reject-stale-after-edit' }, 'POST', 409);
    await shot('desktop-stale-pdf-during-outage'); await otherViewportShot('narrow-stale-pdf-during-outage');
    await hostControl({ checkerOffline: false });
    await batchReady(progress => progress.members.find(m => m.job_id === first).state === 'technical');
    await queueAction('Refresh progress');
    await page.getByText(/Other jobs: .* need recovery — review actions/).click();
    await page.getByRole('region', { name: 'Preparation recovery for Harbor opportunity 1', exact: true }).getByRole('button', { name: 'Retry checks', exact: true }).click();
    await page.getByText(/Other jobs: .* need recovery — review actions/).click();
    await batchReady(progress => progress.queue.some(q => q.job_id === first && q.artifact_id !== beforeEdit.id));
    await queueAction('Refresh progress');
    await expect(page.getByRole('button', { name: 'Approve & next', exact: true })).toBeEnabled();
    await shot('desktop-edit-new-verified-pdf'); await otherViewportShot('narrow-edit-new-verified-pdf');
    await page.getByRole('button', { name: 'Approve & next', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'All remaining resumes reviewed later' })).toBeVisible();
    await page.setViewportSize({ width: 375, height: 850 }); await shot('narrow-completion'); await otherViewportShot('desktop-completion');
    // The material omission was left unanswered while other jobs completed; now explicitly decide it.
    await queueAction('Answer preparation questions');
    await page.getByRole('button', { name: 'Omit this accomplishment', exact: true }).click();
    await batchReady(progress => progress.queue.some(item => item.job_id === state.jobs[4].id && !item.approved));
    await page.getByRole('button', { name: 'Review prepared PDFs', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Omission you approved during preparation', exact: true })).toBeVisible();
    await shot('narrow-approved-omission-awaiting-pdf-approval');
    await page.setViewportSize({ width: 1440, height: 1000 }); await shot('desktop-approved-omission-awaiting-pdf-approval');
    await page.getByRole('button', { name: 'Review later', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'All remaining resumes reviewed later' })).toBeVisible();
    const now = await api(`/api/jobs/preparation-batches/${state.batchId}`);
    assert.equal(now.counts.technical, 2); assert.ok(now.counts.ready >= 2); assert.equal(now.counts.approved, 2);
    const repairedLayout = now.repairs.find(r => r.reason.includes('page overflow'));
    assert.ok(repairedLayout, 'A real overflowing PDF must have a repetition-only checked repair');
    assert.ok(repairedLayout.failed_render);
    const freshFirst = await api(`/api/jobs/${first}`);
    assert.ok(freshFirst.events.some(e => e.payload.kind === 'resume_review' && e.payload.artifact_version_id === state.priorArtifactId), 'Historical approval must remain historical');
    // An explicitly prepared, unselected supplemental job isolates destructive guard probes from the seven-job review pass.
    const guardPreview = await api('/api/jobs/preview', { mode: 'text', input: 'AUTOMATIC_CASE_8: publication guard probes', details: { company: 'Guard probes', role: 'Engineer' } });
    state.guardJobId = (await api('/api/jobs', { preview_id: guardPreview.preview_id, idempotency_key: 'guard-intake' })).items[0].job_id;
    let guard = await api(`/api/jobs/${state.guardJobId}`);
    await api(`/api/jobs/${state.guardJobId}`, { expected_revision: guard.job.revision, changes: { base_resume_id: 'template-automatic-1' } }, 'PUT');
    guard = await api(`/api/jobs/${state.guardJobId}`);
    assert.equal(guard.job.preparation_state, 'saved');
    const guardInput = await api(`/api/jobs/${state.guardJobId}/inputs`, { expected_revision: guard.job.revision }, 'POST', 201);
    await api(`/api/jobs/${state.guardJobId}/prepare`, { expected_revision: guard.job.revision, input_snapshot_id: guardInput.input_snapshot.id, idempotency_key: 'explicit-guard-prepare' }, 'POST', 202);
    await expect.poll(async () => (await api(`/api/jobs/${state.guardJobId}`)).job.preparation_state, { timeout: 60000 }).toBe('resume_ready');
    guard = await api(`/api/jobs/${state.guardJobId}`);
    const probeArtifact = guard.artifacts.at(-1);
    let probeDraft = (await api(`/api/jobs/${guard.job.id}/artifacts/${probeArtifact.id}/continue-editing`, { expected_job_revision: guard.job.revision,
      artifact_fingerprint: probeArtifact.version_fingerprint, idempotency_key: 'guard-edit' })).draft;
    const originalProbe = structuredClone(probeDraft.candidate), publicationGuards = [];
    const probes = [
      ['metric_unverified', candidate => { candidate.experiences[0].bullets[0].text += ' Improved throughput 99%.'; }],
      ['unsupported_citation', candidate => { candidate.experiences[0].bullets[0].citations = ['missing-captured-source']; }],
      ['privacy', candidate => { candidate.profile.title = 'FIXTURE_PRIVATE'; }],
      ['duplicate_bullet', candidate => { candidate.experiences[0].bullets.push(structuredClone(candidate.experiences[0].bullets[0])); }],
      ['unsupported_skill', candidate => { candidate.skills[0].skills.push('Invented capability'); }],
    ];
    for (const [code, mutate] of probes) {
      const candidate = structuredClone(originalProbe); mutate(candidate);
      probeDraft = (await api(`/api/jobs/${guard.job.id}/drafts/${probeDraft.id}`, { candidate, expected_revision: probeDraft.revision }, 'PUT')).draft;
      const checked = await api(`/api/jobs/${guard.job.id}/drafts/${probeDraft.id}/check`, { candidate });
      assert.equal(checked.status, 'blocked');
      assert.ok(checked.issues.some(issue => issue.code === code && issue.severity === 'block'), `${code} must block checked publication`);
      const rejected = await api(`/api/jobs/${guard.job.id}/drafts/${probeDraft.id}/finalize`, { expected_job_revision: checked.job_revision,
        expected_draft_revision: probeDraft.revision, binding: checked.binding, idempotency_key: `reject-publication-${code}` }, 'POST', 409);
      assert.match(rejected.error, /Resolve.*checks/i, 'Publication must reject the actual checks, not an unrelated request error');
      const after = await api(`/api/jobs/${guard.job.id}`);
      assert.deepEqual(after.artifacts.map(item => item.id), [probeArtifact.id]);
      publicationGuards.push({ code, checked, finalizeStatus: 409, rejection: rejected, savedDraftRevision: probeDraft.revision, artifactIdsAfter: after.artifacts.map(item => item.id) });
    }
    fs.writeFileSync(path.join(out, 'publication-guards.json'), JSON.stringify(publicationGuards, null, 2));
    const os = await import('node:os'), probeTemp = fs.mkdtempSync(path.join(os.tmpdir(), 'automatic-text-guard-'));
    try {
      const pdf = path.join(probeTemp, 'resume.pdf'); fs.writeFileSync(pdf, Buffer.from(await (await fetchCapturedResource(origin, `/api/jobs/${guard.job.id}/artifacts/${probeArtifact.id}/pdf`)).arrayBuffer()));
      const negative = await verifier.verify(pdf, { expectedText: ['Maintained "gateway" request handlers.', 'A missing unique word must never pass.'], pageBudget: 1 });
      assert.equal(negative.report.passed, false); assert.ok(negative.report.missingFragments.includes('A missing unique word must never pass.'));
      fs.writeFileSync(path.join(out, 'text-guard-probe.json'), JSON.stringify(negative.report, null, 2));
    } finally { fs.rmSync(probeTemp, { recursive: true, force: true }); }
    const configuration = path.join(state.workspace, '.featherduster/config.yaml'), previousConfig = fs.readFileSync(configuration, 'utf8');
    try {
      const configured = yaml.load(previousConfig); configured.automatic_preparation = { max_model_calls: 1, max_repair_attempts: 0 };
      fs.writeFileSync(configuration, yaml.dump(configured));
      const preview = await api('/api/jobs/preview', { mode: 'text', input: 'AUTOMATIC_CASE_9: configured budget exhaustion', details: { company: 'Budget probe', role: 'Engineer' } });
      state.budgetJobId = (await api('/api/jobs', { preview_id: preview.preview_id, idempotency_key: 'budget-intake' })).items[0].job_id;
      let budgetJob = (await api(`/api/jobs/${state.budgetJobId}`)).job;
      await api(`/api/jobs/${budgetJob.id}`, { expected_revision: budgetJob.revision, changes: { base_resume_id: 'template-automatic-1' } }, 'PUT');
      budgetJob = (await api(`/api/jobs/${budgetJob.id}`)).job;
      const request = { members: [{ job_id: budgetJob.id, expected_revision: budgetJob.revision }], idempotency_key: 'budget-selection' };
      const selected = await api('/api/jobs/preparation-batches', request, 'POST', 202); state.budgetBatchId = selected.result.id;
      await expect.poll(async () => (await api(`/api/jobs/preparation-batches/${state.budgetBatchId}`)).counts.technical, { timeout: 30000 }).toBe(1);
      const budget = await api(`/api/jobs/preparation-batches/${state.budgetBatchId}`), observedBudget = await hostSnapshot();
      const policy = observedBudget.durable.input_snapshots.map(row => JSON.parse(row.payload)).find(input => input.id === budget.members[0].input_snapshot_id).policy;
      const calls = observedBudget.dispatches.filter(call => call.caseId === 9), cycle = observedBudget.durable.preparation_cycles.map(row => JSON.parse(row.payload)).find(cycle => cycle.id === budget.members[0].cycle_id);
      assert.equal(policy.max_model_calls, 1); assert.equal(policy.max_repair_attempts, 0); assert.equal(cycle.usage.calls, 1);
      assert.equal(calls.length, 1); assert.equal(calls[0].operation, 'analysis');
      assert.match(budget.members[0].diagnostic, /budget exhausted/i);
      assert.equal((await api(`/api/jobs/${budgetJob.id}`)).artifacts.length, 0);
      assert.equal((await api(`/api/jobs/preparation-batches/${state.budgetBatchId}/questions`)).groups.length, 0);
      await api('/api/jobs/preparation-batches', request, 'POST', 202);
      assert.equal((await hostSnapshot()).dispatches.filter(call => call.caseId === 9).length, 1);
      fs.writeFileSync(path.join(out, 'configured-budget-exhaustion.json'), JSON.stringify({ configuration: configured.automatic_preparation, policy, cycle, calls, progress: budget, noPublication: true, noFactualQuestion: true }, null, 2));
      await page.goto(origin + `/jobs/preparation-batches/${state.budgetBatchId}/review`);
      await page.getByText(/Other jobs: .* need recovery/).click();
      await expect(page.getByRole('button', { name: 'Retry checks', exact: true })).toBeVisible();
      await shot('desktop-configured-budget-exhaustion'); await otherViewportShot('narrow-configured-budget-exhaustion');
    } finally { fs.writeFileSync(configuration, previousConfig); }
    await page.goto(origin + `/jobs/preparation-batches/${state.batchId}/review`);
    const hostState = await hostSnapshot();
    const cycles = hostState.durable.preparation_cycles.map(row => JSON.parse(row.payload));
    for (const cycle of cycles) { assert.ok(cycle.usage.repairs <= 2); assert.ok(cycle.usage.retries <= 1); assert.ok(cycle.usage.calls <= 12); }
    const staleClarifications = hostState.durable.semantic_clarifications.filter(row => row.job_id === staleId).map(row => JSON.parse(row.payload));
    assert.equal(staleClarifications.length, 1); assert.equal(staleClarifications[0].fact.predicate, 'feature-identity');
    assert.ok(!staleClarifications.some(c => c.fact.predicate === 'production-deployment'), 'The stale scoped question must not receive a new confirmation');
    const remainingQuestions = (await api(`/api/jobs/preparation-batches/${state.batchId}/questions`)).groups;
    fs.writeFileSync(path.join(out, 'delivery-metrics.json'), JSON.stringify({ readyWithoutIntervention: 3, equivalentDuplicatesAvoided: equivalent.members.length - 1, staleGroupedMembersRejected: 1, retriesExhausted: 1,
      repairsUndone: now.repairs.filter(r => r.undone).length, cycles, questionsPerJob: state.jobs.map(job => ({ case: job.case, asked: questions.groups.flatMap(group => group.members).filter(member => member.job_id === job.id).length + questions.materials.filter(member => member.job_id === job.id).length, stillUnresolved: remainingQuestions.flatMap(group => group.members).filter(member => member.job_id === job.id).length })) }, null, 2));
    for (const job of state.jobs) assert.equal((await api(`/api/jobs/${job.id}`)).job.application_lifecycle, 'not_started');
    assert.deepEqual(sharedHashes(), state.sharedHashes);
    assert.equal(hostState.corpus_revision, 0, 'Job-local answers and edits must not update shared corpus knowledge');
    const snapshot = await observed(); state.required = requiredOutcomes(snapshot);
    fs.writeFileSync(statePath, JSON.stringify(state, null, 2)); fs.writeFileSync(path.join(out, 'observed-outcomes.json'), JSON.stringify(snapshot, null, 2));
    fs.writeFileSync(path.join(out, 'model-dispatches.json'), JSON.stringify(dispatches, null, 2));
    fs.writeFileSync(path.join(out, 'interaction-journal.json'), JSON.stringify(journal, null, 2));
    fs.writeFileSync(path.join(out, 'preview-render-readiness.json'), JSON.stringify(journal.filter(entry => entry.action === 'preview-render-readiness'), null, 2));
    const hostLog = fs.readFileSync(path.join(state.workspace, 'automatic-host.log'), 'utf8');
    fs.writeFileSync(path.join(out, 'host-connections.jsonl'), hostLog.slice(0, hostLog.lastIndexOf('\n') + 1));
    await context.tracing.stop({ path: path.join(out, 'trace.zip') });
    await extractReadableTrace(path.join(out, 'trace.zip'), out);
    const identity = currentIdentity(await assets(), snapshot);
    const files = [];
    const collect = (relative = '') => { for (const entry of fs.readdirSync(path.join(out, relative), { withFileTypes: true })) {
      const file = relative ? `${relative}/${entry.name}` : entry.name;
      if (entry.isDirectory()) collect(file); else if (file !== path.basename(manifestPath) && fs.statSync(path.join(out, file)).size) files.push(file);
    } }; collect();
    const manifest = { ...identity, identity_method: 'Query the original captured running host at its bound origin, PID and random instance ID; never start a replacement. Recheck required current queue/approval and supplemental rejection outcomes, fresh served HTML/JS/CSS hashes, persisted bindings and independently verified PDF bytes/page/text coverage. Reject regressed outcomes or changed identities without writing evidence.',
      observation: 'Disposable seven-job batch, real LaTeX/Poppler PDFs, conservative qualifier and skills repairs, grouped scoped questions with stale partial rejection, material-decision pause, transient recovery/exhaustion, reload deduplication, selection ordering, desktop/narrow PDF/Details queue, approval rejection/success/replay and deferral exhaustion. Fixture-only model responses are recorded. Independent review remains required; see verification document for outcomes not yet demonstrated.',
      scenario_ids: ['batch', 'review'], artifacts: files.map(file => ({ path: file, kind: file.endsWith('.png') ? 'screenshot' : file === 'trace.zip' ? 'trace' : 'state' })) };
    fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2)); successful = true; console.log(JSON.stringify({ manifest: manifestPath, workspace: state.workspace, ...identity }));
  }
} catch (error) {
  if (!identityOnly) { fs.writeFileSync(path.join(out, 'failure.json'), JSON.stringify({ error: error.stack, cause: { message: error.cause?.message, code: error.cause?.code ?? error.cause?.cause?.code }, state, dispatches, journal }, null, 2)); if (page) await page.screenshot({ path: path.join(out, 'failure.png'), fullPage: true }).catch(() => {}); if (context) await context.tracing.stop({ path: path.join(out, 'failure-trace.zip') }).catch(() => {}); }
  throw error;
} finally {
  releasePreview?.(); await previewDelivery?.catch(() => {});
  await browser?.close();
  if (ownedHost && !successful) { try { await hostControl({ shutdown: true }); } catch { ownedHost.kill('SIGTERM'); } }
}
