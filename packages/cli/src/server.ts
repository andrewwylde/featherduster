import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Hono } from 'hono';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export function getMimeType(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  switch (ext) {
    case '.html':
    case '.htm':
      return 'text/html; charset=utf-8';
    case '.js':
    case '.mjs':
      return 'application/javascript; charset=utf-8';
    case '.css':
      return 'text/css; charset=utf-8';
    case '.json':
      return 'application/json; charset=utf-8';
    case '.svg':
      return 'image/svg+xml';
    case '.png':
      return 'image/png';
    case '.jpg':
    case '.jpeg':
      return 'image/jpeg';
    case '.gif':
      return 'image/gif';
    case '.webp':
      return 'image/webp';
    case '.ico':
      return 'image/x-icon';
    case '.woff':
      return 'font/woff';
    case '.woff2':
      return 'font/woff2';
    case '.ttf':
      return 'font/ttf';
    case '.map':
      return 'application/json';
    default:
      return 'application/octet-stream';
  }
}
import { streamSSE } from 'hono/streaming';
import { serve } from '@hono/node-server';
import yaml from 'js-yaml';
import open from 'open';
import {
  EvidenceEntrySchema,
  EvidenceStore,
  LevelingRubric,
  LevelingRubricSchema,
  PrivacyRulesConfig,
  PrivacyRulesConfigSchema,
  analyzeCompetencyGaps,
  compileBragDoc,
  compileHtmlPrintResume,
  compileLatexResume,
  compileMarkdownResume,
  compileTypstResume,
  lintCitations,
  parseEvidenceMarkdown,
  parseRubricTable,
  redactText,
  serializeEvidenceMarkdown,
  validateMetrics,
} from '@featherduster/core';
import { WorkspaceWatcher } from './watcher.js';

export interface CreateAppOptions {
  watcher?: WorkspaceWatcher;
  uiDir?: string;
}

export function findFiles(dir: string, extensions: string[]): string[] {
  if (!fs.existsSync(dir)) return [];
  const results: string[] = [];
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name !== 'node_modules' && entry.name !== '.git') {
        results.push(...findFiles(fullPath, extensions));
      }
    } else if (entry.isFile()) {
      const ext = path.extname(entry.name).toLowerCase();
      if (extensions.includes(ext)) {
        results.push(fullPath);
      }
    }
  }
  return results;
}

export function loadEvidenceStore(workspaceDir: string): EvidenceStore {
  const store = new EvidenceStore();
  const evidenceDir = path.join(workspaceDir, 'evidence');
  const files = findFiles(evidenceDir, ['.md', '.markdown']);

  for (const file of files) {
    try {
      const content = fs.readFileSync(file, 'utf-8');
      const parsed = parseEvidenceMarkdown(content, file);
      store.add({ entry: parsed.entry, narrative: parsed.narrative, filePath: file });
    } catch {
      // Skip files that do not conform to evidence schema
    }
  }
  return store;
}

export function loadPrivacyRules(workspaceDir: string): PrivacyRulesConfig {
  const possiblePaths = [
    path.join(workspaceDir, '.featherduster', 'privacy-rules.yaml'),
    path.join(workspaceDir, '.featherduster', 'privacy-rules.yml'),
    path.join(workspaceDir, '.featherduster', 'privacy-rules.json'),
    path.join(workspaceDir, '.featherduster', 'privacy.yaml'),
  ];

  for (const p of possiblePaths) {
    if (fs.existsSync(p)) {
      try {
        const raw = fs.readFileSync(p, 'utf-8');
        let parsed: any;
        if (p.endsWith('.json')) {
          parsed = JSON.parse(raw);
        } else {
          parsed = yaml.load(raw);
        }
        const data = parsed?.rules ?? parsed;
        const validated = PrivacyRulesConfigSchema.safeParse(data);
        if (validated.success) {
          return validated.data;
        }
      } catch {
        // continue
      }
    }
  }

  return {
    strip_patterns: [],
    replacements: [],
    banned_keywords: [],
  };
}

export function loadRubrics(workspaceDir: string): LevelingRubric[] {
  const rubricsDir = path.join(workspaceDir, 'rubrics');
  const files = findFiles(rubricsDir, [
    '.yaml',
    '.yml',
    '.json',
    '.md',
    '.markdown',
    '.tsv',
    '.csv',
  ]);
  const rubrics: LevelingRubric[] = [];
  const seenIds = new Set<string>();

  for (const file of files) {
    try {
      const content = fs.readFileSync(file, 'utf-8');
      const ext = path.extname(file).toLowerCase();
      if (ext === '.yaml' || ext === '.yml') {
        const parsed = yaml.load(content);
        const result = LevelingRubricSchema.safeParse(parsed);
        if (result.success && !seenIds.has(result.data.id)) {
          seenIds.add(result.data.id);
          rubrics.push(result.data);
        }
      } else if (ext === '.json') {
        const parsed = JSON.parse(content);
        const result = LevelingRubricSchema.safeParse(parsed);
        if (result.success && !seenIds.has(result.data.id)) {
          seenIds.add(result.data.id);
          rubrics.push(result.data);
        }
      } else {
        const rubric = parseRubricTable(content, {
          id: path.basename(file, ext),
          title: path.basename(file, ext),
        });
        if (rubric && !seenIds.has(rubric.id)) {
          seenIds.add(rubric.id);
          rubrics.push(rubric);
        }
      }
    } catch {
      // ignore invalid rubric file
    }
  }

  return rubrics;
}

/**
 * Creates and configures the Hono local application instance for a workspace directory.
 */
export function createApp(workspaceDir: string, options?: CreateAppOptions): Hono {
  const resolvedWorkspaceDir = path.resolve(workspaceDir);
  const app = new Hono();
  const watcher = options?.watcher ?? new WorkspaceWatcher(resolvedWorkspaceDir);

  // 1. Health check
  app.get('/api/health', (c) => {
    return c.json({
      status: 'ok',
      workspaceDir: resolvedWorkspaceDir,
    });
  });

  // 2. Evidence list & query
  app.get('/api/evidence', (c) => {
    const store = loadEvidenceStore(resolvedWorkspaceDir);
    const url = new URL(c.req.url);
    const company = url.searchParams.get('company') ?? undefined;
    const theme = url.searchParams.get('theme') ?? undefined;
    const search = url.searchParams.get('search') ?? url.searchParams.get('query') ?? undefined;
    const confidence = url.searchParams.get('confidence') ?? undefined;
    const inFlightParam = url.searchParams.get('in_flight') ?? url.searchParams.get('inFlight');
    const in_flight = inFlightParam !== null ? inFlightParam === 'true' : undefined;
    const hasMissingMetricsParam = url.searchParams.get('hasMissingMetrics');
    const hasMissingMetrics =
      hasMissingMetricsParam !== null ? hasMissingMetricsParam === 'true' : undefined;

    const hasFilters =
      company || theme || search || confidence || in_flight !== undefined || hasMissingMetrics !== undefined;

    const records = hasFilters
      ? store.query({ company, theme, search, confidence, in_flight, hasMissingMetrics })
      : store.getAll();

    return c.json(records);
  });

  // 3. Evidence create & update
  app.post('/api/evidence', async (c) => {
    try {
      const body = await c.req.json();
      let entryData = body.entry ?? body;
      let narrative = body.narrative ?? '';

      if (body.content && typeof body.content === 'string') {
        const parsed = parseEvidenceMarkdown(body.content);
        entryData = parsed.entry;
        narrative = parsed.narrative;
      }

      const validatedEntry = EvidenceEntrySchema.parse(entryData);
      const serialized = serializeEvidenceMarkdown(validatedEntry, narrative);

      const companySlug = validatedEntry.company || 'general';
      const relativeTarget = body.filePath
        ? body.filePath
        : path.join('evidence', companySlug, `${validatedEntry.id}.md`);

      const fullTarget = path.isAbsolute(relativeTarget)
        ? relativeTarget
        : path.join(resolvedWorkspaceDir, relativeTarget);

      fs.mkdirSync(path.dirname(fullTarget), { recursive: true });
      fs.writeFileSync(fullTarget, serialized, 'utf-8');

      return c.json({
        success: true,
        entry: validatedEntry,
      });
    } catch (err: any) {
      return c.json(
        {
          success: false,
          error: err.message || 'Failed to save evidence entry',
          issues: err.issues,
        },
        400
      );
    }
  });

  // 4. Rubrics list
  app.get('/api/rubrics', (c) => {
    const rubrics = loadRubrics(resolvedWorkspaceDir);
    return c.json(rubrics);
  });

  // 5. Rubric gap analysis
  app.get('/api/rubrics/gap-analysis', (c) => {
    const rubricId = c.req.query('rubricId');
    const targetLevel = c.req.query('targetLevel');

    if (!rubricId) {
      return c.json({ error: 'Missing rubricId query parameter' }, 400);
    }

    const rubrics = loadRubrics(resolvedWorkspaceDir);
    const rubric = rubrics.find((r) => r.id === rubricId);

    if (!rubric) {
      return c.json({ error: `Rubric with id '${rubricId}' not found` }, 404);
    }

    const store = loadEvidenceStore(resolvedWorkspaceDir);
    const analysis = analyzeCompetencyGaps(rubric, store, targetLevel);
    return c.json(analysis);
  });

  // 6. Resume & brag doc compiler
  app.post('/api/resumes/compile', async (c) => {
    try {
      const body = await c.req.json();
      const { spec, format } = body;

      if (!spec || !format) {
        return c.json({ error: 'Missing spec or format in request body' }, 400);
      }

      const privacyRules = loadPrivacyRules(resolvedWorkspaceDir);
      let output = '';

      switch (format) {
        case 'markdown':
          output = compileMarkdownResume(spec, privacyRules);
          break;
        case 'html':
          output = compileHtmlPrintResume(spec, privacyRules);
          break;
        case 'typst':
          output = compileTypstResume(spec, privacyRules);
          break;
        case 'latex':
          output = compileLatexResume(spec, privacyRules);
          break;
        case 'brag': {
          const rubric = spec.rubric ?? spec;
          const store = loadEvidenceStore(resolvedWorkspaceDir);
          output = compileBragDoc(rubric, store, {
            candidateName: spec.candidateName,
            period: spec.period,
            rules: privacyRules,
            ...spec.options,
          });
          break;
        }
        default:
          return c.json({ error: `Unsupported format: ${format}` }, 400);
      }

      const check = redactText(output, privacyRules);
      return c.json({
        output,
        violations: check.violations,
        isClean: check.isClean,
      });
    } catch (err: any) {
      return c.json({ error: err.message || 'Failed to compile resume' }, 400);
    }
  });

  // 7. Integrity check
  app.get('/api/integrity/check', (c) => {
    const store = loadEvidenceStore(resolvedWorkspaceDir);
    const privacyRules = loadPrivacyRules(resolvedWorkspaceDir);
    const issues: any[] = [];

    const candidateDirs = [
      path.join(resolvedWorkspaceDir, 'resumes'),
      path.join(resolvedWorkspaceDir, 'evidence'),
    ];

    const filesToCheck: string[] = [];
    for (const dir of candidateDirs) {
      filesToCheck.push(...findFiles(dir, ['.md', '.markdown', '.txt', '.tex', '.typ']));
    }

    for (const file of filesToCheck) {
      const relativePath = path.relative(resolvedWorkspaceDir, file).replace(/\\/g, '/');
      try {
        const content = fs.readFileSync(file, 'utf-8');

        // Citation verification
        const citationResult = lintCitations(content, store);
        for (const dangling of citationResult.danglingCitations) {
          issues.push({
            file: relativePath,
            type: 'dangling_citation',
            message: `Dangling citation '${dangling}' in ${relativePath}`,
            citation: dangling,
          });
        }

        // Metric verification
        const metricResult = validateMetrics(content, store);
        for (const issue of metricResult.issues) {
          issues.push({
            file: relativePath,
            type: issue.type,
            message: `${issue.message} in ${relativePath}`,
            line: issue.line,
          });
        }

        // Privacy rules scan
        if (privacyRules.banned_keywords && privacyRules.banned_keywords.length > 0) {
          const redactResult = redactText(content, privacyRules);
          for (const violation of redactResult.violations) {
            issues.push({
              file: relativePath,
              type: 'banned_keyword',
              message: `Banned keyword '${violation}' in ${relativePath}`,
              keyword: violation,
            });
          }
        }
      } catch {
        // Skip file if unreadable
      }
    }

    return c.json({
      isClean: issues.length === 0,
      issues,
    });
  });

  // 8. Server-Sent Events (SSE) stream endpoint
  app.get('/api/events', (c) => {
    return streamSSE(c, async (stream) => {
      await stream.writeSSE({
        event: 'connected',
        data: JSON.stringify({ status: 'connected' }),
      });

      const unsubscribe = watcher.subscribe(async (evt) => {
        try {
          await stream.writeSSE({
            event: 'change',
            data: JSON.stringify(evt),
          });
        } catch {
          // Stream might be closed
        }
      });

      stream.onAbort(() => {
        unsubscribe();
      });

      // Keep stream alive
      while (!stream.aborted) {
        await stream.sleep(30000);
        try {
          await stream.writeSSE({
            event: 'ping',
            data: 'keepalive',
          });
        } catch {
          break;
        }
      }
    });
  });

  // 9. Static assets & SPA fallback
  const defaultUiDir = fs.existsSync(path.resolve(__dirname, 'ui'))
    ? path.resolve(__dirname, 'ui')
    : fs.existsSync(path.resolve(__dirname, '../dist/ui'))
    ? path.resolve(__dirname, '../dist/ui')
    : path.resolve(__dirname, 'ui');

  const uiDir = options?.uiDir ?? defaultUiDir;

  app.get('*', async (c) => {
    // If request is under /api, do not fallback to index.html
    if (c.req.path.startsWith('/api')) {
      return c.json({ error: 'Endpoint not found' }, 404);
    }

    if (!fs.existsSync(uiDir)) {
      return c.text('Featherduster Web UI is not built. Run "npm run build" in packages/ui.', 404);
    }

    // Try finding requested static file
    const relPath = c.req.path === '/' ? 'index.html' : c.req.path.replace(/^\/+/, '');
    const resolvedPath = path.resolve(uiDir, relPath);

    // Prevent directory traversal
    if (
      resolvedPath.startsWith(path.resolve(uiDir)) &&
      fs.existsSync(resolvedPath) &&
      fs.statSync(resolvedPath).isFile()
    ) {
      const mime = getMimeType(resolvedPath);
      c.header('Content-Type', mime);
      const content = fs.readFileSync(resolvedPath);
      return c.body(content);
    }

    // Fallback to index.html for SPA client-side routes
    const indexPath = path.resolve(uiDir, 'index.html');
    if (fs.existsSync(indexPath)) {
      c.header('Content-Type', 'text/html; charset=utf-8');
      const indexContent = fs.readFileSync(indexPath, 'utf-8');
      return c.html(indexContent);
    }

    return c.text('Featherduster Web UI is not built. Run "npm run build" in packages/ui.', 404);
  });

  return app;
}

export interface StartServerOptions {
  workspaceDir?: string;
  port?: number;
  openBrowser?: boolean;
  uiDir?: string;
}

export interface ServerInstance {
  port: number;
  workspaceDir: string;
  close: () => Promise<void>;
}

/**
 * Starts the Hono server strictly bound to 127.0.0.1.
 */
export async function startServer(options?: StartServerOptions): Promise<ServerInstance> {
  const workspaceDir = path.resolve(options?.workspaceDir || process.cwd());
  const port = options?.port ?? 4173;

  const watcher = new WorkspaceWatcher(workspaceDir);
  watcher.start();

  const app = createApp(workspaceDir, { watcher, uiDir: options?.uiDir });

  const server = serve({
    fetch: app.fetch,
    port,
    hostname: '127.0.0.1',
  });

  if (options?.openBrowser) {
    try {
      await open(`http://127.0.0.1:${port}`);
    } catch {
      // Ignore open browser error
    }
  }

  return {
    port,
    workspaceDir,
    close: async () => {
      await watcher.close();
      await new Promise<void>((resolve, reject) => {
        server.close((err) => {
          if (err) reject(err);
          else resolve();
        });
      });
    },
  };
}
