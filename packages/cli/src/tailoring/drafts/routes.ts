import { Hono, type Context } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import type { ContentfulStatusCode } from 'hono/utils/http-status';
import { z, ZodError } from 'zod';
import { DraftRecordSchema, DraftRevisionTokenSchema, DraftUpdateSchema } from '@featherduster/core';
import { DraftRepositoryError } from './errors.js';
import { TailoringError, type TailoringOrchestrator } from '../orchestrator.js';
import { DraftSeedSchema, type DraftService } from './service.js';

const createSchema = z.object({ record: DraftSeedSchema, mutationId: z.string().min(1).max(512) }).strict();
const discardSchema = z.object({ expected: DraftRevisionTokenSchema, operationId: z.string().uuid() }).strict();
async function json(c: Context): Promise<unknown> {
  try { return await c.req.json(); }
  catch { throw new DraftRepositoryError(400, 'invalid_json', 'Malformed JSON body'); }
}
export function mountDraftRoutes(app: Hono, service: DraftService, orchestrator: TailoringOrchestrator): void {
  const routes = new Hono();
  routes.use('*', bodyLimit({ maxSize: 2 * 1024 * 1024, onError: (c) => c.json({ code: 'body_too_large', error: 'Draft request exceeds 2 MiB', detail: 'Draft request exceeds 2 MiB' }, 413) }));
  routes.onError((error, c) => {
    if (error instanceof DraftRepositoryError) return c.json({ code: error.code, error: error.detail, detail: error.detail }, error.status as ContentfulStatusCode);
    if (error instanceof TailoringError) return c.json({ code: error.code, error: error.message, detail: error.detail }, error.status as ContentfulStatusCode);
    if (error instanceof ZodError) return c.json({ code: 'invalid_request', error: 'Invalid draft request', detail: error.issues }, 400);
    return c.json({ code: 'storage_error', error: 'Draft storage failed', detail: 'Draft storage failed' }, 500);
  });
  routes.get('/', (c) => c.json(service.list()));
  routes.get('/:id', (c) => c.json(service.get(c.req.param('id'))));
  routes.get('/:id/upstream', (c) => c.json(service.upstream(c.req.param('id'))));
  routes.post('/:id/sync-preview', async (c) => { const input = z.object({ expected: DraftRevisionTokenSchema }).strict().parse(await json(c)); return c.json(service.previewSync(c.req.param('id'), input.expected)); });
  routes.post('/:id/sync', async (c) => { const input = discardSchema.extend({ upstreamFingerprint: z.string().min(1), resolutions: z.record(z.enum(['local', 'upstream'])) }).parse(await json(c)); return c.json(service.sync(c.req.param('id'), input)); });
  routes.post('/', async (c) => { const input = createSchema.parse(await json(c)); return c.json(service.create(input.record, input.mutationId)); });
  routes.put('/:id', async (c) => c.json(service.save(c.req.param('id'), DraftUpdateSchema.parse(await json(c)))));
  routes.post('/:id/create-run', async (c) => { const input = discardSchema.parse(await json(c)); return c.json(service.createRun(c.req.param('id'), input.expected, input.operationId)); });
  routes.post('/:id/apply/:step', async (c) => { const input = discardSchema.extend({ artifactToken: DraftRevisionTokenSchema.nullable() }).parse(await json(c)); const step = z.enum(['analysis', 'alignment', 'proposals']).parse(c.req.param('step')); return c.json(orchestrator.applyDraft(c.req.param('id'), { ...input, step })); });
  routes.post('/:id/complete', async (c) => { const input = discardSchema.extend({ name: z.string().trim().min(1).max(512).optional(), type: z.enum(['template', 'tailored']).optional() }).parse(await json(c)); return c.json(service.complete(c.req.param('id'), input.expected, input.operationId, { name: input.name, type: input.type })); });
  routes.post('/:id/continue', async (c) => { const input = discardSchema.parse(await json(c)); return c.json(service.continue(c.req.param('id'), input.expected, input.operationId)); });
  routes.post('/:id/discard', async (c) => { const input = discardSchema.parse(await json(c)); return c.json(service.discard(c.req.param('id'), input.expected, input.operationId)); });
  routes.post('/:id/fork', async (c) => { const input = discardSchema.extend({ sourceSnapshot: DraftRecordSchema }).parse(await json(c)); return c.json(service.fork(c.req.param('id'), input.expected, input.operationId, input.sourceSnapshot)); });
  app.route('/api/tailoring-drafts', routes);
}
