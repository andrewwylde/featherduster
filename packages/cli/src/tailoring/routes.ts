import type { Context, Hono } from 'hono';
import { RunStoreError } from './store.js';
import { TailoringError, type TailoringOrchestrator } from './orchestrator.js';

function handleError(c: Context, err: unknown) {
  if (err instanceof TailoringError) {
    return c.json({ error: err.message, code: err.code, detail: err.detail }, err.status as any);
  }
  if (err instanceof RunStoreError) {
    return c.json({ error: err.message, code: 'store' }, err.status as any);
  }
  return c.json({ error: err instanceof Error ? err.message : 'Unexpected error', code: 'internal' }, 500);
}

async function readJson(c: Context): Promise<any> {
  try {
    return await c.req.json();
  } catch {
    return {};
  }
}

/** Mounts /api/runners and /api/tailoring/* on the app. */
export function mountTailoringRoutes(app: Hono, orchestrator: TailoringOrchestrator): void {
  app.get('/api/runners', async (c) => {
    try {
      return c.json(await orchestrator.runners());
    } catch (err) {
      return handleError(c, err);
    }
  });

  app.post('/api/runners/consent', async (c) => {
    try {
      const body = await readJson(c);
      orchestrator.recordConsent(body.runner);
      return c.json({ success: true });
    } catch (err) {
      return handleError(c, err);
    }
  });

  app.get('/api/tailoring', (c) => {
    try {
      return c.json({ runs: orchestrator.listRuns() });
    } catch (err) {
      return handleError(c, err);
    }
  });

  app.post('/api/tailoring', async (c) => {
    try {
      const body = await readJson(c);
      const manifest = orchestrator.createRun(body);
      return c.json({ slug: manifest.slug, manifest }, 201);
    } catch (err) {
      return handleError(c, err);
    }
  });

  app.get('/api/tailoring/:slug', (c) => {
    try {
      return c.json(orchestrator.getRun(c.req.param('slug')));
    } catch (err) {
      return handleError(c, err);
    }
  });

  app.post('/api/tailoring/:slug/steps/:step/run', async (c) => {
    try {
      const result = await orchestrator.startStep(c.req.param('slug'), c.req.param('step'));
      return c.json(result, 202);
    } catch (err) {
      return handleError(c, err);
    }
  });

  app.get('/api/tailoring/:slug/steps/:step/preview', (c) => {
    try {
      return c.json(orchestrator.previewInput(c.req.param('slug'), c.req.param('step')));
    } catch (err) {
      return handleError(c, err);
    }
  });

  app.put('/api/tailoring/:slug/steps/:step', async (c) => {
    try {
      const body = await readJson(c);
      return c.json(orchestrator.saveStep(c.req.param('slug'), c.req.param('step'), body));
    } catch (err) {
      return handleError(c, err);
    }
  });

  app.post('/api/tailoring/:slug/steps/:step/approve', (c) => {
    try {
      return c.json(orchestrator.approveStep(c.req.param('slug'), c.req.param('step')));
    } catch (err) {
      return handleError(c, err);
    }
  });

  app.post('/api/tailoring/:slug/cancel', (c) => {
    try {
      return c.json(orchestrator.cancel(c.req.param('slug')));
    } catch (err) {
      return handleError(c, err);
    }
  });

  app.post('/api/tailoring/:slug/finalize', (c) => {
    try {
      return c.json(orchestrator.finalize(c.req.param('slug')));
    } catch (err) {
      return handleError(c, err);
    }
  });
}
