/** @vitest-environment node */
import { expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { createServer } from 'vite';
import { ProposalSchema } from '@featherduster/core';
import { JobProposalEditor } from '../src/views/jobs/JobProposalEditor.js';

// Use the actual Tailwind stylesheet and a browser layout engine: jsdom cannot
// detect viewport breakpoints squeezing the editor inside the review sidebar.
it('contains prune badges and reorder controls at sidebar/mobile widths while preserving wide comparisons', async () => {
  const root = fileURLToPath(new URL('../', import.meta.url));
  const server = await createServer({ root, configFile: `${root}/vite.config.ts`, server: { host: '127.0.0.1', port: 0, hmr: false } });
  const browser = await chromium.launch();
  try {
    await server.listen();
    const css = await fetch(`${server.resolvedUrls!.local[0]}src/index.css?direct`).then(response => response.text());
    const page = await browser.newPage();
    const skills = ['Docker', 'Kubernetes/Helm', 'OpenTelemetry', 'ContinuousIntegrationAndDeliveryAutomationWithLongUnbrokenName'];
    for (const type of ['skills.prune', 'skills.reorder'] as const) {
      const proposal = ProposalSchema.parse({ id: 'skills', type, target: { skill_group_index: 0 }, before: skills.join(', '), before_skills: skills, skills: type === 'skills.prune' ? ['Docker'] : [...skills].reverse(),
        after: '', citations: [], requirement_ids: [], rationale: 'Prioritize relevant delivery tools.', checks: [], decision: 'pending' });
      const markup = renderToStaticMarkup(<JobProposalEditor proposal={proposal} issues={[]} evidence={[]} support={[]}
        requirements={['Kubernetes/Helm, OpenTelemetry and ContinuousIntegrationAndDeliveryAutomationWithLongUnbrokenName']}
        onGrounding={() => {}} onPatch={() => {}} disabled={false} />);
      for (const dimensions of [{ viewport: 1434, container: 320 }, { viewport: 390, container: 326 }, { viewport: 1434, container: 960 }]) {
        await page.setViewportSize({ width: dimensions.viewport, height: 1000 });
        await page.setContent(`<style>${css}</style><main style="width:${dimensions.container}px;margin:16px">${markup}</main>`);
        const measured = await page.locator('fieldset').evaluate(editor => {
          const boundary = editor.getBoundingClientRect();
          const outside: string[] = [];
          const check = (rect: DOMRect, name: string) => {
            if (rect.width > 0 && (rect.left < boundary.left - 1 || rect.right > boundary.right + 1)) outside.push(name);
          };
          for (const element of editor.querySelectorAll('*')) {
            if (element.getClientRects().length) check(element.getBoundingClientRect(), element.outerHTML.slice(0, 150));
          }
          // Check painted text as well as boxes: overflow can extend beyond a
          // correctly sized flex item when the skill label cannot wrap.
          const text = document.createTreeWalker(editor, NodeFilter.SHOW_TEXT);
          while (text.nextNode()) {
            const range = document.createRange(); range.selectNodeContents(text.currentNode);
            for (const rect of range.getClientRects()) check(rect, text.currentNode.textContent ?? '');
          }
          const panels = editor.querySelector('[style*="grid-template-columns"]')!.children;
          return { outside, stacked: Math.abs(panels[0].getBoundingClientRect().top - panels[1].getBoundingClientRect().top) > 1,
            pageOverflow: document.documentElement.scrollWidth > innerWidth };
        });
        expect(measured.outside, `${type} at ${dimensions.viewport}/${dimensions.container}`).toEqual([]);
        expect(measured.pageOverflow).toBe(false);
        expect(measured.stacked).toBe(dimensions.container < 600);
        if (type === 'skills.prune') {
          await expect(page.getByRole('checkbox', { name: 'Retain Kubernetes/Helm' }).isVisible()).resolves.toBe(true);
          expect(await page.getByRole('group', { name: 'Skills in this group' }).innerText()).toContain('Retained');
        } else {
          await expect(page.getByRole('button', { name: 'Move OpenTelemetry down' }).isVisible()).resolves.toBe(true);
        }
      }
    }
  } finally { await browser.close(); await server.close(); }
}, 30000);
