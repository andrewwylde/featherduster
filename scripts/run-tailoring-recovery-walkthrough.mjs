// Real browser acceptance using only disposable data and the deterministic runner.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fork } from 'node:child_process';
import { waitForReady, stopChild } from './walkthrough-process.mjs';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const filename = fileURLToPath(import.meta.url);
const root = path.resolve(path.dirname(filename), '..');
const port = Number(process.env.TAILORING_RECOVERY_PORT || 4181);
const origin = `http://127.0.0.1:${port}`;
const output = path.join(root, 'walkthrough-output', 'tailoring-recovery');
const posting = 'Staff Platform Engineer at Globex. Lead distributed systems in Go, Kubernetes and OpenTelemetry. Kafka experience is a plus.';
process.env.FEATHERDUSTER_RUNNER = 'fake';

if (process.argv[2] === '--server') {
  const { startServer } = await import('../packages/cli/dist/server.js');
  const server = await startServer({ workspaceDir: process.argv[3], port, openBrowser: false, uiDir: path.join(root, 'packages/cli/dist/ui') });
  process.on('message', async message => { if (message === 'close') { await server.close(); process.exit(0); } });
  process.send('ready');
} else {
  await main();
}

async function main() {
  const { initWorkspace } = await import('../packages/cli/dist/commands/init.js');
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'featherduster-recovery-'));
  await initWorkspace({ workspace });
  fs.mkdirSync(output, { recursive: true });
  let server, browser, page;
  const errors = [], expected = [];
  let offline = false, blocked = false, recoveringManual = false;
  let conflictUrl;
  const expectedMissing = new Set();
  let blockedWriteAttempts = 0;
  const start = async () => {
    server = fork(filename, ['--server', workspace], { windowsHide: true, stdio: ['ignore', 'inherit', 'inherit', 'ipc'] });
    await waitForReady(server);
  };
  const stop = (kill = false) => stopChild(server, { kill });
  const watch = p => {
    p.on('request', request => {
      if ((blocked || recoveringManual) && request.method() === 'GET' && /\/api\/tailoring-drafts\/[a-f0-9-]+(?:\/upstream)?$/.test(request.url())) expectedMissing.add(request.url());
    });
    p.on('pageerror', e => errors.push(e.stack));
    p.on('console', m => {
      if (m.type() !== 'error') return;
      const text = m.text();
      const url = m.location().url;
      const expectedOffline = offline && url.startsWith(origin) && /net::ERR_|Failed to fetch/.test(text);
      const expectedBlockedSave = blocked && /\/api\/tailoring-drafts(?:\/[a-f0-9-]+)?$/.test(url) && /net::ERR_CONNECTION_FAILED/.test(text);
      const expectedConflict = url === conflictUrl && /status of 409/.test(text);
      const expectedBrowserLookup = expectedMissing.has(url) && /status of 404/.test(text);
      if (expectedOffline || expectedBlockedSave || expectedConflict || expectedBrowserLookup) expected.push(`${text} (${url})`);
      else errors.push(`${text} (${m.location().url})`);
    });
  };
  const shot = async name => {
    for (const [size, viewport] of Object.entries({ desktop: { width: 1440, height: 1000 }, mobile: { width: 390, height: 844 } })) {
      await page.setViewportSize(viewport);
      await page.screenshot({ path: path.join(output, `${name}-${size}.png`), fullPage: true });
    }
    await page.setViewportSize({ width: 1440, height: 1000 });
  };
  const saved = () => page.getByRole('status').filter({ hasText: /^Draft saved$/ }).waitFor();
  const record = async id => { const r = await page.request.get(`${origin}/api/tailoring-drafts/${id}`); assert.equal(r.status(), 200); return r.json(); };
  const draftId = () => new URL(page.url()).pathname.split('/').pop();
  try {
    await start();
    browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
    context.setDefaultTimeout(15000);
    page = await context.newPage(); watch(page);
    // Block both initial create and updates. The first edit must already exist in browser storage.
    blocked = true;
    await page.route('**/api/tailoring-drafts{,/**}', async route => {
      if (blocked && ['POST', 'PUT'].includes(route.request().method())) { blockedWriteAttempts++; await route.abort('connectionfailed'); }
      else await route.continue();
    });
    await page.goto(`${origin}/tailor`);
    await page.getByRole('button', { name: 'New tailoring run' }).click();
    await page.getByLabel('Job posting', { exact: true }).fill(posting);
    const setupUrl = page.url();
    assert.match(setupUrl, /\/tailor\/drafts\/[\da-f-]+$/);
    assert.equal(await page.evaluate(text => Object.values(localStorage).some(v => v.includes(text)), posting), true);
    assert.equal(blockedWriteAttempts, 0, 'Refresh starts before the debounced workspace save');
    assert.equal(fs.existsSync(path.join(workspace, 'tailoring-drafts', `${setupUrl.split('/').pop()}.json`)), false);
    await page.reload();
    assert.equal(page.url(), setupUrl);
    assert.equal(await page.getByLabel('Job posting', { exact: true }).inputValue(), posting);
    await page.getByRole('status').filter({ hasText: /Saved in this browser/ }).waitFor();
    await shot('browser-only');
    blocked = false;
    await page.getByRole('button', { name: 'Retry', exact: true }).click();
    await saved(); expectedMissing.clear(); await shot('saved');
    console.log('PASS immediate refresh before debounce, browser-only recovery, workspace retry');

    // A held real PUT becomes stale after another tab explicitly loads and saves.
    let release;
    const held = page.waitForRequest(request => request.method() === 'PUT' && /\/api\/tailoring-drafts\//.test(request.url()));
    const gate = new Promise(resolve => { release = resolve; });
    await page.route('**/api/tailoring-drafts/*', async route => {
      if (route.request().method() === 'PUT') { await gate; }
      await route.continue();
    });
    await page.getByLabel('Job posting', { exact: true }).fill(`${posting}\nFirst tab retained content.`);
    await held;
    const other = await context.newPage(); watch(other); await other.goto(`${origin}/tailor`);
    // Issue the competing browser writer's request directly: cross-tab UI
    // notifications can otherwise pause editing before the stale network race.
    const competing = await other.evaluate(async ({ id, posting }) => {
      const envelope = await (await fetch(`/api/tailoring-drafts/${id}`)).json();
      const result = await fetch(`/api/tailoring-drafts/${id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ expected: envelope.token, mutationId: crypto.randomUUID(), change: 'content', payload: { ...envelope.record.payload, posting: `${posting}\nSecond tab workspace content.` } }) });
      return result.status;
    }, { id: setupUrl.split('/').pop(), posting });
    assert.equal(competing, 200);
    const conflictResponse = page.waitForResponse(r => r.request().method() === 'PUT' && r.status() === 409);
    conflictUrl = `${origin}/api/tailoring-drafts/${setupUrl.split('/').pop()}`; release(); await conflictResponse;
    await page.getByRole('dialog', { name: 'Resolve draft conflict' }).waitFor();
    await shot('conflict');
    const copies = page.getByRole('radio');
    for (let i = 0; i < await copies.count(); i++) {
      await copies.nth(i).check();
      if ((await page.getByLabel('Selected recovery content').inputValue()).includes('First tab retained content.')) break;
    }
    assert.match(await page.getByLabel('Selected recovery content').inputValue(), /First tab retained content/);
    await page.getByRole('button', { name: 'Keep mine as a separate draft' }).click();
    await page.waitForURL(url => url.href !== setupUrl);
    assert.match(await page.getByLabel('Job posting', { exact: true }).inputValue(), /First tab retained content/);
    assert.match((await record(setupUrl.split('/').pop())).record.payload.posting, /Second tab workspace content/);
    await other.close(); conflictUrl = undefined;
    console.log('PASS same-context stale write conflict and lossless fork');

    recoveringManual = true;
    await page.goto(`${origin}/tailor/canvas`);
    await page.getByLabel('Select resume variant').selectOption({ label: 'starter (tailored)' });
    const checkbox = page.getByTitle('Toggle bullet inclusion in compiled resume').first();
    await checkbox.uncheck();
    const manualUrl = page.url();
    await page.reload();
    await checkbox.waitFor(); assert.equal(await checkbox.isChecked(), false);
    await saved();
    recoveringManual = false; expectedMissing.clear();
    const manualId = draftId();
    const manual = await record(manualId);
    console.log('PASS excluded manual bullets recover');

    // Modify the real upstream file; Cancel is byte-for-byte non-mutating.
    const basePath = 'resumes/tailored/starter.yaml';
    assert.ok(basePath, 'Pinned source path');
    const absoluteBase = path.resolve(workspace, basePath);
    const baseBytes = fs.readFileSync(absoluteBase, 'utf8');
    fs.writeFileSync(absoluteBase, baseBytes.replace(/title: .*/, 'title: Upstream platform leader'));
    await page.reload(); await saved();
    await page.getByText('Base resume updated', { exact: true }).waitFor();
    const beforeSync = fs.readFileSync(path.join(workspace, 'tailoring-drafts', `${manualId}.json`));
    await page.getByRole('button', { name: 'Sync upstream', exact: true }).click();
    await page.getByRole('dialog', { name: 'Sync upstream resume' }).waitFor();
    await shot('sync-preview');
    await page.getByRole('button', { name: 'Cancel', exact: true }).click();
    assert.deepEqual(fs.readFileSync(path.join(workspace, 'tailoring-drafts', `${manualId}.json`)), beforeSync);
    await page.getByRole('button', { name: 'Sync upstream', exact: true }).click();
    await page.getByRole('button', { name: 'Apply upstream sync', exact: true }).click();
    await page.getByRole('dialog').waitFor({ state: 'hidden' });
    assert.equal((await record(manualId)).record.base.spec.profile.title, 'Upstream platform leader');
    await page.getByRole('button', { name: 'Candidate Profile', exact: true }).click();
    await page.locator('label').filter({ hasText: /^Target Title$/ }).locator('..').getByRole('textbox').fill('Local platform leader');
    await saved();
    fs.writeFileSync(absoluteBase, fs.readFileSync(absoluteBase, 'utf8').replace('Upstream platform leader', 'Upstream principal engineer'));
    await page.reload(); await saved();
    await page.getByRole('button', { name: 'Sync upstream', exact: true }).click();
    await page.getByRole('radio', { name: /keep local/ }).check();
    await shot('sync-preview');
    await page.getByRole('button', { name: 'Apply upstream sync', exact: true }).click();
    await page.getByRole('dialog').waitFor({ state: 'hidden' });
    assert.equal((await record(manualId)).record.payload.profile.title, 'Local platform leader');
    console.log('PASS upstream preview, cancel without writes, explicit apply and local conflict choice');

    const completeManual = async name => {
      await page.getByRole('button', { name: 'Save Variant', exact: true }).click();
      await page.getByPlaceholder('e.g. netflix-agent-platform').fill(name);
      await page.getByRole('dialog').getByRole('button', { name: 'Save Variant', exact: true }).click();
      await page.getByRole('article', { name: 'Completed resume' }).waitFor();
    };
    await completeManual('recovery-original'); await shot('completed');
    const completed = await record(manualId);
    const originalOutput = path.resolve(workspace, completed.record.completion.path);
    const snapshotPath = path.join(workspace, 'tailoring-drafts', 'completions', `${completed.record.completion.outputId}.json`);
    const oldOutput = fs.readFileSync(originalOutput), oldSnapshot = fs.readFileSync(snapshotPath);
    await page.getByRole('button', { name: 'Continue editing' }).click();
    await page.waitForURL(url => url.href !== manualUrl);
    await page.getByTitle('Toggle bullet inclusion in compiled resume').first().check();
    await completeManual('recovery-child');
    assert.deepEqual(fs.readFileSync(originalOutput), oldOutput);
    assert.deepEqual(fs.readFileSync(snapshotPath), oldSnapshot);
    console.log('PASS completion, continue editing, immutable original output and snapshot');

    await page.goto(`${origin}/tailor`);
    await page.getByRole('button', { name: 'New tailoring run' }).click();
    await page.getByLabel('Job posting', { exact: true }).fill(posting);
    await page.getByLabel('Run name').fill('interrupted-recovery');
    await page.getByRole('button', { name: 'Create run', exact: true }).click();
    let modelRequests = 0;
    context.on('request', r => { if (/\/steps\/[^/]+\/run$/.test(r.url()) && r.method() === 'POST') modelRequests++; });
    const running = page.waitForResponse(r => /\/steps\/analysis\/run$/.test(r.url()) && r.status() === 202);
    await page.getByRole('button', { name: /Run break down the posting/ }).click();
    await running; offline = true; await stop(true);
    assert.equal(modelRequests, 1);
    await start(); await page.reload();
    await page.getByRole('button', { name: /Retry break down the posting/ }).waitFor();
    offline = false; assert.equal(modelRequests, 1, 'Recovery must not automatically invoke the model');
    const retryRunning = page.waitForResponse(r => /\/steps\/analysis\/run$/.test(r.url()) && r.status() === 202);
    await page.getByRole('button', { name: /Retry break down the posting/ }).click();
    await retryRunning;
    // Navigate while the real fake-runner job publishes its result. Navigation
    // must survive both an SSE refresh and a context PUT racing publication.
    await page.getByRole('navigation', { name: 'Tailoring steps' }).getByRole('button', { name: /Match your evidence/ }).click();
    await page.setViewportSize({ width: 390, height: 844 });
    await page.getByRole('tab', { name: 'context', exact: true }).click();
    const runSlug = new URL(page.url()).pathname.split('/').pop();
    await page.waitForFunction(async slug => {
      const result = await (await fetch(`/api/tailoring/${encodeURIComponent(slug)}`)).json();
      return result.draft?.record.payload.artifactTokens.analysis
        && result.draft.record.context.activeStep === 'alignment'
        && result.draft.record.context.mobilePane === 'context';
    }, runSlug);
    assert.equal(await page.getByRole('dialog', { name: 'Resolve draft conflict' }).count(), 0);
    assert.match(page.url(), /step=alignment/);
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.getByRole('navigation', { name: 'Tailoring steps' }).getByRole('button', { name: /Break down the posting/ }).click();
    console.log('PASS navigation during generation preserves context and adopts generated artifact');
    await page.getByRole('button', { name: 'Approve & match evidence' }).click();
    await page.getByRole('button', { name: 'Approve & draft edits' }).click();
    await page.getByRole('button', { name: 'Accept all unblocked' }).waitFor();
    console.log('PASS actual server termination during generation and explicit retry');
    await page.getByRole('listitem', { name: /^Proposal / }).first().getByRole('button', { name: 'Edit', exact: true }).click();
    const editor = page.getByRole('textbox', { name: /^Edit proposal / });
    await editor.fill('Unfinished proposal edit retained through refresh.');
    const runUrl = page.url();
    await page.reload();
    assert.equal(await editor.inputValue(), 'Unfinished proposal edit retained through refresh.');
    assert.match(page.url(), /step=proposals/);
    await page.getByRole('link', { name: 'Tailor', exact: true }).click();
    await page.getByRole('heading', { name: 'Tailor your resume to a job' }).waitFor();
    assert.equal(new URL(page.url()).pathname, '/tailor');
    await page.goBack(); await editor.waitFor();
    assert.equal(await editor.inputValue(), 'Unfinished proposal edit retained through refresh.');
    await page.goForward();
    await page.getByRole('heading', { name: 'Tailor your resume to a job' }).waitFor();
    await page.goto(runUrl); assert.equal(await editor.inputValue(), 'Unfinished proposal edit retained through refresh.');
    console.log('PASS selected step, unfinished editor, back/forward, list-only tab and direct links');
    assert.deepEqual(errors, [], 'Unexpected browser errors');
    console.log(`Recovery walkthrough passed; ${expected.length} expected offline, browser-only lookup and conflict resource errors. Screenshots: ${output}`);
  } catch (error) {
    if (page) { await page.screenshot({ path: path.join(output, 'failure.png'), fullPage: true }).catch(() => {}); console.error(await page.locator('body').innerText().catch(() => '')); }
    console.error(errors); throw error;
  } finally {
    try { await browser?.close(); }
    finally {
      try { await stop(); }
      finally { fs.rmSync(workspace, { recursive: true, force: true }); }
    }
  }
}
