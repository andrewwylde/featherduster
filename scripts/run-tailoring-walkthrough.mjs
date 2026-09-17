// End-to-end walkthrough of the skill-driven tailoring flow against a throwaway
// sample workspace, using the deterministic demo runner (no real LLM, no user data).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

process.env.FEATHERDUSTER_RUNNER = 'fake';

const { startServer } = await import('../packages/cli/dist/server.js');
const { initWorkspace } = await import('../packages/cli/dist/commands/init.js');

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SCREENSHOTS_DIR = path.resolve(rootDir, 'walkthrough-output', 'tailoring');
const PORT = 4179;

const POSTING = `Staff Platform Engineer at Globex
Globex is building the next generation of its payments platform.
You will lead distributed systems work in Go, own OpenTelemetry observability, and run services on Kubernetes.
Experience with Kafka is a plus. We move in a fast-paced environment.`;

async function main() {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'featherduster-tailoring-walkthrough-'));
  await initWorkspace({ workspace });
  fs.mkdirSync(SCREENSHOTS_DIR, { recursive: true });
  console.log(`Sample workspace: ${workspace}`);

  const server = await startServer({
    workspaceDir: workspace,
    port: PORT,
    openBrowser: false,
    uiDir: path.resolve(rootDir, 'packages/cli/dist/ui'),
  });
  const browser = await chromium.launch({ headless: true });
  const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 })).newPage();
  const errors = [];
  page.on('console', (msg) => msg.type() === 'error' && errors.push(msg.text()));
  page.on('pageerror', (err) => errors.push(err.message));

  const shot = async (name) => {
    await page.waitForTimeout(300);
    await page.screenshot({ path: path.join(SCREENSHOTS_DIR, name), fullPage: true });
    console.log(`  -> ${name}`);
  };

  try {
    await page.goto(`http://127.0.0.1:${PORT}/tailor`, { waitUntil: 'networkidle' });
    await page.getByRole('heading', { name: 'Tailor your resume to a job' }).waitFor();
    await shot('01-run-list.png');

    await page.getByRole('button', { name: 'New tailoring run' }).click();
    await page.getByLabel('Job posting').fill(POSTING);
    await page.getByLabel('Run name').fill('globex-staff-platform');
    await shot('02-new-run-form.png');
    await page.getByRole('button', { name: 'Create run' }).click();

    await page.getByRole('button', { name: /Run break down the posting/ }).click();
    await page.getByRole('button', { name: 'Approve & match evidence' }).waitFor({ timeout: 15000 });
    await shot('03-analysis.png');

    await page.getByRole('button', { name: 'Approve & match evidence' }).click();
    await page.getByRole('button', { name: 'Approve & draft edits' }).waitFor({ timeout: 15000 });
    await page.getByRole('button', { name: /^ev-001$/ }).first().click();
    await shot('04-alignment.png');

    await page.getByRole('button', { name: 'Approve & draft edits' }).click();
    await page.getByRole('button', { name: 'Accept all unblocked' }).waitFor({ timeout: 15000 });
    await shot('05-proposals.png');

    await page.getByRole('button', { name: 'Accept all unblocked' }).click();
    await page.waitForTimeout(800);
    // Reject anything that stayed pending (blocked by a check).
    for (const item of await page.getByRole('listitem', { name: /^Proposal / }).all()) {
      const reject = item.getByRole('button', { name: 'Reject' });
      const accept = item.getByRole('button', { name: 'Accept' });
      if ((await accept.getAttribute('aria-pressed')) !== 'true' && (await reject.getAttribute('aria-pressed')) !== 'true') {
        await reject.click();
        await page.waitForTimeout(400);
      }
    }
    await page.locator('details summary', { hasText: 'Preview resume with accepted edits' }).click();
    await shot('06-proposals-decided.png');

    await page.getByRole('button', { name: 'Approve edits & write brief' }).click();
    await page.getByRole('button', { name: 'Save resume' }).waitFor({ timeout: 15000 });
    await shot('07-brief.png');

    await page.getByRole('button', { name: 'Save resume' }).click();
    await page.getByText(/Saved to resumes\/tailored\/globex-staff-platform\.yaml/).waitFor({ timeout: 10000 });
    await shot('08-saved.png');

    await page.getByRole('button', { name: 'Open in canvas' }).click();
    await page.getByText('Resume Tailoring Canvas').waitFor({ timeout: 10000 });
    await shot('09-canvas.png');

    const runDir = path.join(workspace, 'tailoring', 'globex-staff-platform');
    console.log(`Run files: ${fs.readdirSync(runDir).join(', ')}`);
    if (errors.length) {
      console.log('Browser errors:');
      errors.forEach((e) => console.log(`  ${e}`));
    }
    console.log('Tailoring walkthrough completed.');
  } catch (err) {
    await page.screenshot({ path: path.join(SCREENSHOTS_DIR, 'failure.png'), fullPage: true }).catch(() => undefined);
    errors.forEach((e) => console.log(`  [browser] ${e}`));
    throw err;
  } finally {
    await browser.close();
    await server.close();
    fs.rmSync(workspace, { recursive: true, force: true });
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
