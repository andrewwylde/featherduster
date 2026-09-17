import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { startServer } from '../packages/cli/dist/server.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

const SCREENSHOTS_DIR = path.resolve(rootDir, 'walkthrough-output', 'screenshots');
const VIDEOS_DIR = path.resolve(rootDir, 'walkthrough-output', 'videos');
const WORKSPACE_DIR = 'C:/Users/drewk/career';
const PORT = 4178;

async function runWalkthrough() {
  console.log('============================================================');
  console.log('Featherduster: Career Intelligence Desk Playwright Runner');
  console.log('============================================================');
  console.log(`Corpus directory:  ${WORKSPACE_DIR}`);
  console.log(`Screenshots dir:   ${SCREENSHOTS_DIR}`);
  console.log(`Videos dir:        ${VIDEOS_DIR}`);
  console.log(`Target port:       ${PORT}`);

  fs.mkdirSync(SCREENSHOTS_DIR, { recursive: true });
  fs.mkdirSync(VIDEOS_DIR, { recursive: true });

  console.log('\n[1/6] Launching Featherduster CLI server against corpus...');
  const server = await startServer({
    workspaceDir: WORKSPACE_DIR,
    port: PORT,
    openBrowser: false,
    uiDir: path.resolve(rootDir, 'packages/cli/dist/ui'),
  });
  console.log(`Server running at http://127.0.0.1:${PORT}`);

  console.log('\n[2/6] Launching Playwright Chromium instance with video capture...');
  const browser = await chromium.launch({
    headless: true,
  });

  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 2, // 2x Retina crisp rendering
    recordVideo: {
      dir: VIDEOS_DIR,
      size: { width: 1440, height: 900 },
    },
  });

  const page = await context.newPage();

  // Log browser console errors if any
  page.on('console', (msg) => {
    if (msg.type() === 'error') {
      console.error(`  [Browser Error]: ${msg.text()}`);
    }
  });

  try {
    console.log('\n[3/6] Navigating to Career Desk and executing vertical slice walkthrough...');
    await page.goto(`http://127.0.0.1:${PORT}`, { waitUntil: 'networkidle' });
    await page.waitForSelector('text=The Editor');
    await page.waitForTimeout(600);

    // Step 1: Private Briefing
    console.log('  -> [Step 1] Capturing 01-private-briefing.png');
    await page.screenshot({
      path: path.join(SCREENSHOTS_DIR, '01-private-briefing.png'),
    });

    // Step 2: Onboarding & Privacy Foundation Modal
    console.log('  -> [Step 2] Opening Desk Foundation & Privacy modal...');
    const onboardingBtn = page.locator('button:has-text("Desk Foundation & Privacy")');
    await onboardingBtn.click();
    await page.waitForSelector('text=The Desk Foundation');
    await page.waitForTimeout(500);

    console.log('  -> Capturing 02-onboarding-modal.png');
    await page.screenshot({
      path: path.join(SCREENSHOTS_DIR, '02-onboarding-modal.png'),
    });

    console.log('  -> Closing onboarding modal...');
    await page.locator('button[aria-label="Close"]').first().click();
    await page.waitForTimeout(400);

    // Step 3: Story threads (read-only; this walkthrough runs against a real corpus and must never write)
    console.log('  -> [Step 3] Opening Story Threads (read-only)...');
    await page.locator('a:has-text("Threads")').click();
    await page.waitForSelector('text=Story Threads & Node Map');
    await page.waitForTimeout(600);
    await page.screenshot({ path: path.join(SCREENSHOTS_DIR, '03-story-threads-node-map.png') });

    // Step 9: Theme Toggle (Editorial Light Mode)
    console.log('  -> [Step 9] Switching to Editorial Light Mode...');
    const themeBtn = page.locator('button[aria-label="Toggle theme"]');
    await themeBtn.click();
    await page.waitForTimeout(600);

    console.log('  -> Capturing 04-light-mode-node-map.png');
    await page.screenshot({
      path: path.join(SCREENSHOTS_DIR, '04-light-mode-node-map.png'),
    });

    // Step 10: Integrity Pre-Flight Audit Modal
    console.log('  -> [Step 10] Opening Integrity & Privacy Pre-Flight Audit modal...');
    const integrityBtn = page.locator('button[title="Integrity & Privacy Pre-Flight Audit"]');
    await integrityBtn.click();
    await page.waitForSelector('text=Integrity & Privacy Audit');
    await page.waitForTimeout(600);

    console.log('  -> Capturing 05-integrity-audit-modal.png');
    await page.screenshot({
      path: path.join(SCREENSHOTS_DIR, '05-integrity-audit-modal.png'),
    });

    console.log('  -> Closing integrity modal...');
    await page.locator('button[aria-label="Close integrity audit modal"]').click();
    await page.waitForTimeout(400);

    console.log('\n[4/6] Completed all walkthrough steps without errors.');
  } catch (err) {
    console.error('Walkthrough step error:', err);
    throw err;
  } finally {
    console.log('\n[5/6] Finalizing video recording and closing browser...');
    const video = page.video();
    await page.close();
    await context.close();

    if (video) {
      const originalPath = await video.path();
      const finalVideoPath = path.join(VIDEOS_DIR, 'featherduster-walkthrough.webm');
      try {
        if (fs.existsSync(finalVideoPath)) {
          fs.unlinkSync(finalVideoPath);
        }
        fs.renameSync(originalPath, finalVideoPath);
        console.log(`Video saved to: ${finalVideoPath}`);
      } catch {
        console.log(`Video available at: ${originalPath}`);
      }
    }

    await browser.close();

    console.log('\n[6/6] Shutting down backend server...');
    try {
      await server.close();
    } catch {
      // Ignore server shutdown errors
    }
  }

  console.log('============================================================');
  console.log('SUCCESS: All walkthrough artifacts captured!');
  console.log('============================================================');
  process.exit(0);
}

runWalkthrough().catch((err) => {
  console.error('Walkthrough script failed:', err);
  process.exit(1);
});
