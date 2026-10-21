import assert from 'node:assert/strict';

/** Wait for decoded pixels of the bound artifact, not merely an img element's border box. */
export async function renderedResumePages(page, required = false) {
  const images = page.locator('img[alt^="Resume page "]');
  if (required) await images.first().waitFor({ state: 'attached', timeout: 15000 });
  if (!await images.count()) return [];
  await page.waitForFunction(() => {
    const pages = [...document.querySelectorAll('img[alt^="Resume page "]')];
    return pages.length > 0 && pages.every(image => image.dataset.previewState === 'failed'
      || (image.dataset.previewState === 'ready' && image.complete && image.naturalWidth > 0 && image.naturalHeight > 0));
  }, undefined, { timeout: 15000 });
  const result = await images.evaluateAll(async pages => {
    const stats = [];
    for (const image of pages) {
      const src = image.currentSrc || image.src;
      await image.decode();
      await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      if (!image.isConnected || src !== (image.currentSrc || image.src)) throw Error('Displayed preview changed while capturing pixels');
      const canvas = document.createElement('canvas'); canvas.width = 256;
      canvas.height = Math.min(1024, Math.max(1, Math.round(image.naturalHeight * 256 / image.naturalWidth)));
      const context = canvas.getContext('2d'); context.fillStyle = 'white'; context.fillRect(0, 0, canvas.width, canvas.height);
      context.drawImage(image, 0, 0, canvas.width, canvas.height);
      const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
      let ink = 0, paper = 0;
      for (let offset = 0; offset < pixels.length; offset += 4) {
        const sum = pixels[offset] + pixels[offset + 1] + pixels[offset + 2];
        if (sum < 600) ink++; if (sum > 735) paper++;
      }
      const box = image.getBoundingClientRect();
      stats.push({ artifact_id: image.dataset.artifactId, src, complete: image.complete, state: image.dataset.previewState,
        natural_width: image.naturalWidth, natural_height: image.naturalHeight, rendered_width: box.width, rendered_height: box.height,
        x: box.x + scrollX, y: box.y + scrollY,
        sampled_pixels: pixels.length / 4, ink_pixels: ink, paper_pixels: paper });
    }
    return stats;
  });
  for (const image of result) {
    assert.ok(image.complete && image.state === 'ready' && image.natural_width > 200 && image.natural_height > 300, 'Current PDF page did not decode');
    assert.ok(image.artifact_id && image.src.includes(`/artifacts/${image.artifact_id}/previews/`), 'Preview does not match its displayed artifact');
    assert.ok(image.ink_pixels >= 100 && image.paper_pixels > image.sampled_pixels / 2, `Preview has no visible resume content: ${JSON.stringify(image)}`);
    assert.ok(image.rendered_height > 100, 'Decoded preview is collapsed');
  }
  return result;
}

/** Check the actual desktop screenshot's image region as well as the decoded source. */
export async function screenshotResumeInk(page, png, pages) {
  if (!pages.length || page.viewportSize().width < 1000 || await page.getByRole('menu').isVisible()) return [];
  const result = await page.evaluate(async ({ base64, regions }) => {
    const screenshot = new Image(); screenshot.src = `data:image/png;base64,${base64}`; await screenshot.decode();
    const scale = screenshot.naturalWidth / document.documentElement.scrollWidth, results = [];
    for (const region of regions) {
      const canvas = document.createElement('canvas'); canvas.width = 256;
      canvas.height = Math.round((region.rendered_height - 8) * 256 / (region.rendered_width - 8));
      const context = canvas.getContext('2d');
      context.drawImage(screenshot, (region.x + 4) * scale, (region.y + 4) * scale,
        (region.rendered_width - 8) * scale, (region.rendered_height - 8) * scale, 0, 0, canvas.width, canvas.height);
      const data = context.getImageData(0, 0, canvas.width, canvas.height).data; let ink = 0, paper = 0;
      for (let offset = 0; offset < data.length; offset += 4) {
        const sum = data[offset] + data[offset + 1] + data[offset + 2]; if (sum < 600) ink++; if (sum > 735) paper++;
      }
      results.push({ artifact_id: region.artifact_id, ink_pixels: ink, paper_pixels: paper, sampled_pixels: data.length / 4 });
    }
    return results;
  }, { base64: png.toString('base64'), regions: pages });
  for (const region of result) assert.ok(region.ink_pixels >= 100 && region.paper_pixels > region.sampled_pixels / 2,
    `Desktop screenshot did not paint the PDF page: ${JSON.stringify(region)}`);
  return result;
}
