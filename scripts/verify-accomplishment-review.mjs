// Disposable synthetic workspace: real HTTP, UI, persistence, renderer and approval binding.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import assert from 'node:assert/strict';
import { chromium, expect } from 'playwright/test';
import { createApp } from '../packages/cli/dist/server.js';
import { createJobsRuntime } from '../packages/cli/dist/jobs/runtime.js';
import { initWorkspace } from '../packages/cli/dist/commands/init.js';
import { LatexRenderer } from '../packages/cli/dist/render/latex-renderer.js';
import { PdfVerifier } from '../packages/cli/dist/render/pdf-verifier.js';
const require = createRequire(new URL('../packages/cli/package.json', import.meta.url));
const yaml = require('js-yaml'), { serve } = require('@hono/node-server');
const layoutOnly = process.argv.includes('--many-questions');
const omissionPdf = process.argv.includes('--omit-before-pdf');
const output = path.resolve(layoutOnly ? 'walkthrough-output/accomplishment-ui-many-questions' : omissionPdf ? 'walkthrough-output/accomplishment-ui-omission-pdf' : 'walkthrough-output/accomplishment-ui'); fs.mkdirSync(output, { recursive: true });
const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'fd-accomplishment-review-'));
await initWorkspace({ workspace, silent: true });
const bullets = ['Implemented connector APIs.', 'Built connector configuration UI.', 'Maintained migration tooling.'];
if (layoutOnly) bullets.push(...['one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve'].map(name => `Delivered feature ${name}.`));
const after = 'Built connector setup across APIs and configuration UI, validating input to reject malformed configurations.';
const spec = { profile: { name: 'Jordan Example', title: 'Software Engineer', email: 'jordan@example.com' },
  summary: 'Led the connector program.', experiences: [{ company: 'Acme', role: 'Engineer', startDate: '2022', endDate: 'Present', bullets: bullets.map((text, i) => ({ text, citations: [i === 2 ? 'migration' : 'connector'] })) }], education: [], skills: [] };
fs.writeFileSync(path.join(workspace, 'resumes/templates/calibration.yaml'), yaml.dump(spec));
const entries = [['connector', 'Connector setup', `${bullets[0]} ${bullets[1]} Added write-time validation to reject malformed configurations. Leadership is not recorded.`], ['migration', 'Migration tooling', bullets[2]]]
  .map(([id, title, summary]) => ({ id, title, summary, company: 'Acme', date: '2026-01-01', confidence: 'verified', impact: '', themes: [], in_flight: false }));
fs.writeFileSync(path.join(workspace, 'evidence/evidence-ledger.yaml'), yaml.dump({ entries }));
const runner = { id: 'fake', model: 'accomplishment-fixture', label: 'Synthetic UI fixture', locality: 'local', detect: async () => ({ available: true, detail: 'Fixture' }), run: async request => {
  const properties = request.schema.properties;
  if (properties.passages) {
    const batch = JSON.parse(request.prompt);
    return { passages: batch.subjects.map(p => {
      const source = batch.sources.find(s => s.field === 'summary' && s.evidence_id === (p.text === bullets[2] ? 'migration' : 'connector'));
      const needsAnswer = p.text.startsWith('Led') || p.text.startsWith('Delivered feature ');
      return { subject_ref: p.ref, claims: [{ text: p.text, fact: { predicate: p.text.startsWith('Led') ? 'leadership' : 'implementation', qualifiers: [] }, qualifier_text: [],
        state: needsAnswer ? 'needs_clarification' : 'supported', evidence: source && !p.text.startsWith('Delivered feature ') ? [{ source_ref: source.ref, quote: source.text }] : [],
        explanation: p.text.startsWith('Led') ? 'The source does not establish leadership.' : 'Captured source supports this contribution.', question: p.text.startsWith('Led') ? 'Did you lead the connector program?' : needsAnswer ? `Did you deliver ${p.text.slice(10).replace(/\.$/, '')}?` : null }] };
    }) };
  }
  if (properties.proposals) return { proposals: [
    { id: 'connector', type: 'bullet.consolidate', target: { experience_index: 0, bullet_index: 0 }, source_bullets: [0, 1].map(bullet_index => ({ bullet_index, before: bullets[bullet_index] })),
      after, citations: ['connector'], claim_bindings: [{ text: after, citations: ['connector'] }], requirement_ids: [], rationale: 'One connector setup capability with its supported purpose.' },
    { id: 'omit', type: 'bullet.drop', target: { experience_index: 0, bullet_index: 2 }, before: bullets[2], citations: ['migration'], source_bullets: [], claim_bindings: [], rationale: 'Prioritize product setup for this role.' },
  ] };
  return { company: 'Acme', role: 'Product Engineer', seniority: '', mission: '', requirements: [], rows: [], anchor_stories: [], bridges: [], gaps: [] };
} };
const poppler = path.join(process.env.LOCALAPPDATA ?? '', 'Programs/poppler/Library/bin');
const verifier = new PdfVerifier({ tools: Object.fromEntries(['pdfinfo', 'pdftotext', 'pdftoppm'].map(n => [n, { command: path.join(poppler, `${n}.exe`) }])) });
let runtime;
const app = createApp(workspace, { uiDir: path.resolve('packages/cli/dist/ui'), jobsDependencies: { runnerFactory: () => runner, automaticDrain: false, renderer: new LatexRenderer({ verifier }) }, jobsRuntimeFactory: (w, deps) => runtime = createJobsRuntime(w, deps) });
app.initializeJobs();
const server = serve({ fetch: app.fetch, hostname: '127.0.0.1', port: 0 });
await new Promise(resolve => server.once('listening', resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({ headless: true }), page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
const errors = []; page.on('pageerror', e => errors.push(e.message));
try {
  const intake = await runtime.intake.preview({ mode: 'text', input: 'Acme seeks a product engineer to build connector setup across APIs and UI.' });
  const id = runtime.intake.commit(intake, randomUUID())[0].job_id, job = runtime.repository.getJob(id);
  const batch = runtime.prepareBatch({ members: [{ job_id: id, expected_revision: job.revision }], idempotency_key: randomUUID() }).result;
  await expect.poll(() => runtime.readBatch(batch.id).counts.questions, { timeout: 30000 }).toBe(1);
  await page.goto(`${origin}/jobs/${id}/resume`);
  await expect(page.getByRole('article', { name: 'Complete resume draft' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Did you lead the connector program?', exact: true })).toBeVisible();
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: path.join(output, 'desktop-draft.png'), fullPage: true });
  if (layoutOnly) {
    const panel = page.getByRole('complementary', { name: 'Resume exceptions' });
    await expect(page.getByLabel('Passage to review')).toBeVisible();
    await expect(panel.getByText('13 passages need attention. Open a remaining question to continue.')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Review the next question' })).toBeVisible();
    assert.equal(await page.getByText('No generated resume yet.', { exact: false }).count(), 0);
    await panel.evaluate(element => window.scrollTo(0, element.getBoundingClientRect().top + window.scrollY - 80));
    assert.ok(await page.getByLabel('Your factual answer').evaluate(element => element.getBoundingClientRect().bottom <= innerHeight), 'Answer field is below the viewport despite focusing the review panel');
    await page.screenshot({ path: path.join(output, 'desktop-13-questions.png'), fullPage: false });
    await page.getByLabel('Passage to review').selectOption('base:experiences.0.bullets.12.text');
    await expect(page.getByRole('heading', { name: 'Did you deliver feature twelve?' })).toBeVisible();
    await page.getByLabel('Your factual answer').fill('I delivered feature twelve in this synthetic fixture.');
    await page.getByLabel('Reuse this answer').selectOption('project');
    await expect(page.getByRole('button', { name: 'Confirm and save for this project' })).toBeDisabled();
    await expect(page.getByText(/To reuse this answer across the project/)).toBeVisible();
    await page.getByRole('button', { name: 'Confirm for this job instead' }).click();
    await expect(page.getByRole('progressbar', { name: 'Resume fact review progress' })).toHaveAttribute('value', '2');
    await expect(page.getByText(/Saved and confirmed for this job:/)).toBeVisible();
    await expect(page.getByRole('progressbar', { name: 'Resume passage review progress' })).toHaveAttribute('value', '2');
    await page.screenshot({ path: path.join(output, 'confirmed-progress.png'), fullPage: true });
    await page.getByRole('button', { name: 'Review the next question' }).click();
    const nextQuestion = page.getByRole('heading', { name: 'Did you lead the connector program?', exact: true });
    await expect(nextQuestion).toBeFocused();
    assert.ok(await nextQuestion.evaluate(element => element.getBoundingClientRect().top >= 70 && element.getBoundingClientRect().bottom < innerHeight), 'Next question was not scrolled into view');
    await expect(page.getByLabel('Passage to review')).toHaveValue('base:summary');
    await page.screenshot({ path: path.join(output, 'next-question-focused.png'), fullPage: false });
    await page.reload();
    await expect(page.getByRole('progressbar', { name: 'Resume passage review progress' })).toHaveAttribute('value', '2');
    await page.getByLabel('Passage to review').selectOption('base:experiences.0.bullets.12.text');
    await expect(page.getByLabel('Your factual answer')).toHaveCount(0);
    await expect(page.getByRole('heading', { name: 'Did you deliver feature twelve?' })).toHaveCount(0);
    await expect(page.getByText('Resolved facts and supporting sources').locator('..')).not.toHaveAttribute('open');
    await expect(page.getByRole('status', { name: 'Next required action' })).toContainText('No factual action is needed for this passage.');
    await page.getByRole('button', { name: 'Review the next question' }).click();
    await expect(page.getByRole('heading', { name: 'Did you lead the connector program?', exact: true })).toBeFocused();
    await page.getByLabel('Passage to review').selectOption('base:experiences.0.bullets.1.text');
    await expect(page.getByRole('heading', { name: 'Did you deliver feature one?' })).toBeVisible();
    await page.getByText('Edit wording or evidence instead', { exact: true }).click();
    await page.getByRole('button', { name: 'Leave out of this draft' }).click();
    await expect(page.getByRole('article', { name: 'Complete resume draft' })).not.toContainText('Delivered feature one.');
    await page.getByRole('button', { name: 'Save draft', exact: true }).click();
    await expect.poll(() => runtime.semantic.read(id).facts.some(f => f.passage.text === 'Delivered feature one.')).toBe(false);
    await page.reload();
    await expect(page.getByRole('article', { name: 'Complete resume draft' })).not.toContainText('Delivered feature one.');
    const omitted = page.getByRole('heading', { name: 'Omitted by you' }).locator('..');
    await expect(omitted).toContainText('Delivered feature one.');
    await page.screenshot({ path: path.join(output, 'user-omission.png'), fullPage: true });
    await omitted.getByRole('button', { name: 'Restore accomplishment' }).click();
    await page.getByRole('button', { name: 'Save draft', exact: true }).click();
    await expect.poll(() => runtime.semantic.read(id).facts.some(f => f.passage.text === 'Delivered feature one.' && !f.resolution)).toBe(true);
    await page.reload();
    await expect(page.getByRole('article', { name: 'Complete resume draft' })).toContainText('Delivered feature one.');
    await page.setViewportSize({ width: 390, height: 844 });
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
    await panel.evaluate(element => window.scrollTo(0, element.getBoundingClientRect().top + window.scrollY - 80));
    await page.screenshot({ path: path.join(output, 'mobile-13-questions.png'), fullPage: false });
    fs.writeFileSync(path.join(output, 'report.json'), JSON.stringify({ questions: 13, job_only_fallback_saved: true, persisted_progress: true, next_question_selected_and_focused: true, confirmed_question_hidden_after_reload: true, user_omission_persisted: true, omitted_questions_removed: true, user_omission_restored: true, selected_question_first: true, answer_visible_on_desktop: true, passage_switching: true, mobile_no_overflow: true, browser_errors: errors }, null, 2));
    assert.deepEqual(errors, []);
    console.log(`13-question review layout passed: ${output}`);
  } else {
  if (omissionPdf) {
    await page.getByLabel('Passage to review').selectOption('connector');
    await page.getByText('Edit wording or evidence instead', { exact: true }).click();
    await page.getByRole('button', { name: 'Leave out of this draft' }).click();
    await page.getByRole('button', { name: 'Save draft', exact: true }).click();
    await expect.poll(() => runtime.semantic.read(id).facts.some(f => f.passage.text === after)).toBe(false);
    await page.reload();
    await expect(page.getByRole('article', { name: 'Complete resume draft' })).not.toContainText(after);
  }
  await page.getByLabel('Your factual answer').fill('I need to check the leadership scope.');
  await page.getByRole('button', { name: 'Save answer, keep unresolved' }).click();
  await expect.poll(() => runtime.semantic.read(id).clarifications.some(c => c.assertion === 'I need to check the leadership scope.' && c.confirmed === false)).toBe(true);
  await page.reload();
  await expect(page.getByLabel('Your factual answer')).toHaveValue('I need to check the leadership scope.');
  await expect(page.getByRole('heading', { name: 'Confirm your saved answer' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Finish saving answers' })).toBeVisible();
  await expect(page.getByLabel('Your factual answer')).not.toBeVisible();
  await page.getByText('Review or edit your earlier answer', { exact: true }).click();
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByRole('complementary', { name: 'Resume exceptions' })).toBeVisible();
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: path.join(output, 'mobile-draft.png'), fullPage: true });
  await page.getByLabel('Your factual answer').fill('I led the connector program in this synthetic fixture.');
  await page.getByRole('button', { name: 'Save existing answer for this project' }).click();
  await expect.poll(() => runtime.repository.getJob(id).artifact_version_ids.length, { timeout: 90000 }).toBe(1);
  await page.reload(); await page.setViewportSize({ width: 1440, height: 1000 });
  await expect(page.getByRole('img', { name: 'Resume page 1' })).toBeVisible();
  await expect(page.getByRole('region', { name: 'PDF change summary' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Approve Resume', exact: true })).toBeEnabled();
  await expect(page.getByRole('button', { name: 'Restore accomplishment' }).first()).toBeVisible();
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: path.join(output, 'final-pdf-and-changes.png'), fullPage: true });
  if (omissionPdf) {
    const artifactId = runtime.repository.getJob(id).artifact_version_ids[0];
    const published = runtime.artifacts.review(id, artifactId);
    assert.equal(published.draft.candidate.experiences[0].bullets.length, 0, 'The PDF draft revived omitted source bullets');
    assert.equal(runtime.repository.listEvents(id).filter(e => e.payload.kind === 'resume_review').length, 0);
    await page.getByText(after, { exact: true }).locator('..').getByRole('button', { name: 'Restore accomplishment' }).click();
    await expect.poll(() => runtime.repository.getJob(id).artifact_version_ids.length, { timeout: 90000 }).toBe(2);
    const restoredId = runtime.repository.getJob(id).artifact_version_ids[1];
    const restored = runtime.artifacts.review(id, restoredId);
    assert.deepEqual(restored.draft.candidate.experiences[0].bullets.map(b => b.text), [after], 'Restoration must retain the consolidated wording as one accomplishment');
    await page.reload();
    await expect(page.getByRole('button', { name: 'Approve Resume', exact: true })).toBeEnabled();
    assert.equal(runtime.repository.listEvents(id).filter(e => e.payload.kind === 'resume_review').length, 0);
    assert.deepEqual(errors, []);
    fs.writeFileSync(path.join(output, 'report.json'), JSON.stringify({ user_omission_in_published_pdf: true, no_source_bullets_revived: true, generated_consolidation_restored_atomically: true, restored_pdf_awaits_approval: true, browser_errors: errors }, null, 2));
    console.log(`Omission PDF workflow passed: ${output}`);
  } else {
  await page.getByRole('button', { name: 'Approve Resume', exact: true }).click();
  await expect.poll(() => runtime.repository.listEvents(id).filter(e => e.payload.kind === 'resume_review').length).toBe(1);
  await page.getByRole('button', { name: 'Restore accomplishment' }).click();
  await expect.poll(() => runtime.repository.getJob(id).artifact_version_ids.length, { timeout: 90000 }).toBe(2);
  await page.reload();
  await expect(page.getByRole('button', { name: 'Approve Resume', exact: true })).toBeEnabled();
  assert.equal(runtime.repository.listEvents(id).filter(e => e.payload.kind === 'resume_review').length, 1, 'New PDF inherited approval');
  assert.deepEqual(errors, []);
  fs.writeFileSync(path.join(output, 'report.json'), JSON.stringify({ deferred_answer_survived_reload: true, mobile_no_overflow: true, automatic_pdf: true,
    final_change_summary: true, restored_new_pdf: true, fresh_approval_required: true, browser_errors: errors }, null, 2));
  console.log(`Resume review workflow passed: ${output}`);
  }
  }
} finally {
  await browser.close(); await runtime.dispose(); await new Promise(resolve => server.close(resolve));
  // Only this process-created temporary workspace is removed.
  assert.ok(path.resolve(workspace).startsWith(path.resolve(os.tmpdir()) + path.sep)); fs.rmSync(workspace, { recursive: true, force: true });
}
