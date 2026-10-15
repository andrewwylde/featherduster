import type { Hono, Context } from 'hono';
import { z } from 'zod';
import { CorpusRequestSchema, type CorpusService } from './service.js';
import { RepositoryError } from '../jobs/repository.js';

export function mountCorpusRoutes(app: Hono, service: () => CorpusService): void {
  const handle = (fn: (c: Context) => unknown | Promise<unknown>) => async (c: Context) => {
    try { return c.json(await fn(c)); }
    catch (error) {
      if (error instanceof z.ZodError || error instanceof SyntaxError) return c.json({ code: 'invalid_request', error: 'Invalid corpus request' }, 400);
      if (error instanceof RepositoryError) return c.json({ code: error.code, error: error.message }, error.code === 'not_found' ? 404 : error.code === 'invalid_relationship' ? 400 : error.code === 'corrupt_data' ? 500 : 409);
      return c.json({ code: 'internal_error', error: 'Corpus operation failed' }, 500);
    }
  };
  app.get('/api/corpus', handle(c => {
    const context = z.object({ employer: z.string().optional(), project: z.string().optional(), role: z.string().optional(), job_id: z.string().uuid().optional() }).strict().parse(c.req.query());
    const { evidence, ...view } = service().read(context);
    return { ...view, evidence: evidence.getAll() };
  }));
  app.post('/api/corpus/preview', handle(async c => service().preview(CorpusRequestSchema.parse(await c.req.json()))));
  app.post('/api/corpus/updates', handle(async c => service().remember(CorpusRequestSchema.parse(await c.req.json()))));
  app.post('/api/corpus/updates/:id/withdraw', handle(async c => {
    const id = z.string().uuid().parse(c.req.param('id'));
    const body = CorpusRequestSchema.parse(await c.req.json());
    if (body.change.kind !== 'withdrawal' || body.change.update_id !== id) throw new RepositoryError('invalid_relationship', 'Withdrawal identity mismatch');
    return service().withdraw(body);
  }));
}
