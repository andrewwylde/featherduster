import { expect, it } from 'vitest';
import { DEFAULT_STARTER_RESUME } from '@featherduster/core';
import { checkedRender } from '../src/jobs/checked-render.js';
it('does not accept a renderer pass with an incorrect page budget', async () => {
  const renderPdf = async () => ({ status: 'passed' as const, source: 'tex', pdf: Buffer.from('pdf'),
    previews: [{ page: 1, mimeType: 'image/png' as const, bytes: Buffer.from('png') }], diagnostics: [],
    report: { passed: true, pageCount: 2, pageBudget: 1, coverage: 1, missingFragments: [], diagnostics: [] } });
  const result = await checkedRender({ renderPdf }, { templateId: 'default', spec: DEFAULT_STARTER_RESUME }, 1);
  expect(result.status).toBe('blocked');
});
it('reports tool failure separately from invalid content', async () => {
  const result = await checkedRender({ renderPdf: async () => { throw Error('Compiler unavailable'); } },
    { templateId: 'default', spec: DEFAULT_STARTER_RESUME }, 1);
  expect(result).toMatchObject({ status: 'unavailable', issues: [expect.objectContaining({ code: 'renderer_unavailable' })] });
});

