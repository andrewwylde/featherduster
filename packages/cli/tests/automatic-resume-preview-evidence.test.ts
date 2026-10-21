import { expect, it } from 'vitest';
import http from 'node:http';
import { chromium } from 'playwright';
import { renderedResumePages, screenshotResumeInk } from '../../../scripts/automatic-resume-preview.mjs';

it('waits for actual image pixels and rejects decoded but blank pages', async () => {
  let release!: () => void; const gate = new Promise<void>(resolve => { release = resolve; });
  const server = http.createServer(async (request, response) => {
    if (request.url?.startsWith('/api/')) {
      await gate;
      response.setHeader('Content-Type', 'image/svg+xml');
      response.end(`<svg xmlns="http://www.w3.org/2000/svg" width="850" height="1100"><rect width="850" height="1100" fill="white"/>${request.url.includes('white') ? '' : '<text x="70" y="100" font-size="55">Verified resume</text><rect x="70" y="180" width="650" height="30" fill="black"/>'}</svg>`);
    } else {
      response.setHeader('Content-Type', 'text/html'); response.end(`<img alt="Resume page 1" data-artifact-id="artifact-unit" data-preview-state="loading" onload="this.dataset.previewState='ready'" style="width:600px;border:1px solid" src="/api/jobs/job/artifacts/artifact-unit/previews/1${request.url === '/white' ? '?white=1' : ''}">`);
    }
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const browser = await chromium.launch(), page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  try {
    const origin = `http://127.0.0.1:${(server.address() as import('node:net').AddressInfo).port}`;
    await page.goto(origin, { waitUntil: 'domcontentloaded' });
    await page.getByAltText('Resume page 1').waitFor({ state: 'visible' });
    let completed = false;
    const waiting = renderedResumePages(page, true).then(value => { completed = true; return value; });
    await new Promise(resolve => setTimeout(resolve, 50)); expect(completed).toBe(false);
    release();
    const pixels = await waiting; expect(pixels[0].natural_width).toBe(850); expect(pixels[0].ink_pixels).toBeGreaterThan(100);
    const painted = await screenshotResumeInk(page, await page.screenshot({ fullPage: true }), pixels);
    expect(painted[0].ink_pixels).toBeGreaterThan(100);
    const blank = await page.evaluate(() => { const canvas = document.createElement('canvas'); canvas.width = innerWidth; canvas.height = document.documentElement.scrollHeight;
      const context = canvas.getContext('2d')!; context.fillStyle = 'white'; context.fillRect(0, 0, canvas.width, canvas.height); return canvas.toDataURL().split(',')[1]; });
    await expect(screenshotResumeInk(page, Buffer.from(blank, 'base64'), pixels)).rejects.toThrow(/did not paint/);
    await page.goto(origin + '/white');
    await expect(renderedResumePages(page, true)).rejects.toThrow(/no visible resume content/);
  } finally { release(); await browser.close(); await new Promise<void>(resolve => server.close(() => resolve())); }
}, 15000);
