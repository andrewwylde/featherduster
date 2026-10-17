import { buildIdentity } from './build-identity.js';
import { loadEffectiveCorpus } from './corpus/load.js';
import { mountCorpusRoutes } from './corpus/routes.js';
import { applicableSkillSupport, queryCorpus } from '@featherduster/core';
import { createJobsRuntime, type JobsRuntime, type JobsRuntimeDependencies } from './jobs/runtime.js';
import { mountJobsRoutes } from './jobs/routes.js';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Hono } from 'hono';
import { cors } from 'hono/cors';

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

export function getFormatFromFilename(filename: string): string {
  const ext = path.extname(filename).toLowerCase();
  switch (ext) {
    case '.md':
    case '.markdown':
      return 'markdown';
    case '.html':
    case '.htm':
      return 'html';
    case '.typ':
      return 'typst';
    case '.tex':
      return 'latex';
    case '.pdf':
      return 'pdf';
    default:
      return 'other';
  }
}
import { streamSSE } from 'hono/streaming';
import { serve } from '@hono/node-server';
import yaml from 'js-yaml';
import open from 'open';
import {
  DEFAULT_STARTER_RESUME,
  EvidenceEntrySchema,
  EvidenceStore,
  LevelingRubric,
  LevelingRubricSchema,
  PrivacyRulesConfig,
  PrivacyRulesConfigSchema,
  ResumeSpec,
  ResumeSpecSchema,
  analyzeCompetencyGaps,
  compileBragDoc,
  compileHtmlPrintResume,
  compileLatexResume,
  compileMarkdownResume,
  compileTypstResume,
  compileDefenseBrief,
  compileHtmlDefenseBrief,
  calculatePageBudget,
  lintCitations,
  parseEvidenceLedger,
  parseEvidenceMarkdown,
  parseLatexResume,
  parseRubricTable,
  redactText,
  serializeEvidenceMarkdown,
  validateMetrics,
  auditSlop,
  cleanSlop,
  scanConfidentiality,
  SlopAuditResult,
  SLOP_WEIGHTS,
} from '@featherduster/core';
import { WorkspaceWatcher } from './watcher.js';
import { isConsolidatedLedgerFile, isInsideWorkspace, toWorkspaceRelative } from './evidence-files.js';
import { defaultRunnerFactory, type RunnerFactory } from './runners/registry.js';
import { TailoringOrchestrator, type TailoringEvent } from './tailoring/orchestrator.js';
import { DraftService } from './tailoring/drafts/service.js';
import { mountDraftRoutes } from './tailoring/drafts/routes.js';
import { mountTailoringRoutes } from './tailoring/routes.js';
import { mountSettingsRoutes } from './settings/routes.js';
import { ClaudeAuthManager } from './settings/claude-auth.js';
import { CodexAuthManager } from './settings/codex-auth.js';
import { getCredentialStore, type CredentialStore } from './settings/credentials.js';
import { TypstRenderer } from './render/typst-renderer.js';
import { LatexRenderer } from './render/legacy-latex-renderer.js';
import { checkWorkspace } from './commands/check.js';

export interface CreateAppOptions {
  jobsDependencies?: Partial<JobsRuntimeDependencies>;
  jobsRuntimeFactory?: typeof createJobsRuntime;
  watcher?: WorkspaceWatcher;
  uiDir?: string;
  /** Override model runner construction (tests). */
  runnerFactory?: RunnerFactory;
  /** Receives the orchestrator instance (tests). */
  onOrchestrator?: (orchestrator: TailoringOrchestrator) => void;
  /** Override secret storage (tests). */
  credentialStore?: CredentialStore;
  /** Override the Claude Code auth wrapper (tests). */
  claudeAuth?: ClaudeAuthManager;
  /** Override the Codex auth wrapper (tests). */
  codexAuth?: CodexAuthManager;
  /** Override the Typst binary wrapper (tests). */
  typstRenderer?: TypstRenderer;
  /** Override the LaTeX binary wrapper (tests). */
  latexRenderer?: LatexRenderer;
  /** Override environment used for credential resolution (tests). */
  env?: NodeJS.ProcessEnv;
}

export function findFiles(
  dir: string,
  extensions: string[],
  visited: Set<string> = new Set()
): string[] {
  if (!fs.existsSync(dir)) return [];
  try {
    const realDir = fs.realpathSync(dir);
    if (visited.has(realDir)) return [];
    visited.add(realDir);
  } catch {
    return [];
  }

  const results: string[] = [];
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name !== 'node_modules' && entry.name !== '.git') {
        results.push(...findFiles(fullPath, extensions, visited));
      }
    } else if (entry.isFile() || entry.isSymbolicLink()) {
      const ext = path.extname(entry.name).toLowerCase();
      if (extensions.includes(ext)) {
        try {
          if (fs.statSync(fullPath).isFile()) {
            results.push(fullPath);
          }
        } catch {
          // Skip broken symlinks
        }
      }
    }
  }
  return results;
}

export function loadEvidenceStore(workspaceDir: string): EvidenceStore {
  return loadEffectiveCorpus(workspaceDir, loadSourceEvidenceStore(workspaceDir)).evidence;
}
export function loadSourceEvidenceStore(workspaceDir: string): EvidenceStore {
  const store = new EvidenceStore();
  const candidateDirs = [
    path.join(workspaceDir, 'evidence'),
    path.join(workspaceDir, 'companies'),
  ];

  const files: string[] = [];
  for (const dir of candidateDirs) {
    files.push(...findFiles(dir, ['.md', '.markdown', '.yaml', '.yml']));
  }

  for (const file of files) {
    try {
      const content = fs.readFileSync(file, 'utf-8');
      const baseName = path.basename(file).toLowerCase();

      // Check if file is an evidence ledger (e.g. evidence-ledger.md, evidence-ledger.yaml or embeds entries:)
      if (
        baseName.startsWith('evidence-ledger') ||
        content.includes('entries:')
      ) {
        const ledgerEntries = parseEvidenceLedger(content, file);
        for (const item of ledgerEntries) {
          store.add({ entry: item.entry, narrative: item.narrative, filePath: file });
        }
        if (ledgerEntries.length > 0) {
          continue;
        }
      }

      // Fallback: parse as single-entry evidence markdown with frontmatter
      if (content.trim().startsWith('---')) {
        const parsed = parseEvidenceMarkdown(content, file);
        store.add({ entry: parsed.entry, narrative: parsed.narrative, filePath: file });
      }
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

export interface ResumeRecord {
  id: string;
  name: string;
  type: 'template' | 'tailored';
  filePath: string;
  spec: ResumeSpec;
}

export function loadResumeSpecs(workspaceDir: string, includeStarter = true): ResumeRecord[] {
  const records: ResumeRecord[] = [];
  const directories: Array<{ dir: string; type: 'template' | 'tailored' }> = [
    { dir: path.join(workspaceDir, 'resumes', 'templates'), type: 'template' },
    { dir: path.join(workspaceDir, 'resumes', 'tailored'), type: 'tailored' },
  ];

  for (const { dir, type } of directories) {
    if (!fs.existsSync(dir)) continue;
    const files = findFiles(dir, ['.yaml', '.yml', '.json', '.md', '.tex']);
    for (const file of files) {
      try {
        const raw = fs.readFileSync(file, 'utf-8');
        const ext = path.extname(file).toLowerCase();
        let parsed: any;
        if (ext === '.json') {
          parsed = JSON.parse(raw);
        } else if (ext === '.yaml' || ext === '.yml') {
          parsed = yaml.load(raw);
        } else if (ext === '.tex') {
          parsed = parseLatexResume(raw);
        } else if (ext === '.md') {
          const match = raw.match(/^---\r?\n([\s\S]*?)\r?\n---/);
          if (match) {
            parsed = yaml.load(match[1]);
          } else {
            parsed = yaml.load(raw);
          }
        }
        if (parsed && typeof parsed === 'object') {
          if (!parsed.profile && parsed.candidate) {
            parsed.profile = parsed.candidate;
          }
        }
        const validated = ResumeSpecSchema.safeParse(parsed);
        if (validated.success) {
          const baseName = path.basename(file, ext);
          const rel = path.relative(workspaceDir, file).replace(/\\/g, '/');
          records.push({
            id: `${type}-${baseName}`,
            name: baseName,
            type,
            filePath: rel,
            spec: validated.data,
          });
        }
      } catch {
        // Skip files that fail to parse
      }
    }
  }

  // If no templates exist, provide a default starter template conforming to ResumeSpec
  if (includeStarter && records.filter((r) => r.type === 'template').length === 0) {
    records.unshift({
      id: 'template-starter',
      name: 'Starter Template',
      type: 'template',
      filePath: 'resumes/templates/starter.yaml',
      spec: DEFAULT_STARTER_RESUME,
    });
  }

  // Sort: templates first (with master priority 1, main priority 2), then tailored
  records.sort((a, b) => {
    if (a.type !== b.type) return a.type === 'template' ? -1 : 1;
    const aPriority = a.name.toLowerCase() === 'master' ? 1 : a.name.toLowerCase() === 'main' ? 2 : 3;
    const bPriority = b.name.toLowerCase() === 'master' ? 1 : b.name.toLowerCase() === 'main' ? 2 : 3;
    if (aPriority !== bPriority) return aPriority - bPriority;
    return a.name.localeCompare(b.name);
  });

  return records;
}

/**
 * Validates whether the given Host header is permitted.
 * Allows localhost, 127.0.0.1, Tailscale MagicDNS (*.ts.net), and Tailscale CGNAT IPs (100.64.0.0/10).
 */
export function isAllowedHost(host: string): boolean {
  if (!host) return true;
  const hostname = host.replace(/:\d+$/, '').toLowerCase();
  if (hostname === '127.0.0.1' || hostname === 'localhost') return true;
  if (hostname === 'ts.net' || hostname.endsWith('.ts.net')) return true;
  if (/^100\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(hostname)) return true;
  return false;
}

/**
 * Validates whether the given Origin header is permitted.
 * Allows localhost, 127.0.0.1, Tailscale MagicDNS (*.ts.net), and Tailscale CGNAT IPs (100.64.0.0/10).
 */
export function isAllowedOrigin(origin: string): boolean {
  if (!origin) return false;
  try {
    const originUrl = new URL(origin);
    const hostname = originUrl.hostname.toLowerCase();
    if (['127.0.0.1', 'localhost'].includes(hostname)) return true;
    if (hostname === 'ts.net' || hostname.endsWith('.ts.net')) return true;
    if (/^100\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(hostname)) return true;
    return false;
  } catch {
    return false;
  }
}

/**
 * Creates and configures the Hono local application instance for a workspace directory.
 */
export function createApp(workspaceDir: string, options?: CreateAppOptions): Hono & { initializeJobs(): void; disposeJobs(): Promise<void> } {
  const resolvedWorkspaceDir = path.resolve(workspaceDir);
  const app = new Hono();
  let jobs: JobsRuntime | undefined;
  const jobsStreams = new Set<() => void>();
  const getJobs = () => jobs ??= (options?.jobsRuntimeFactory ?? createJobsRuntime)(resolvedWorkspaceDir, {
    loadResumes: () => loadResumeSpecs(resolvedWorkspaceDir, false),
    loadEvidence: () => loadSourceEvidenceStore(resolvedWorkspaceDir),
    loadPrivacyRules: () => loadPrivacyRules(resolvedWorkspaceDir),
    runnerFactory: options?.runnerFactory,
    ...options?.jobsDependencies,
  });
  const watcher = options?.watcher ?? new WorkspaceWatcher(resolvedWorkspaceDir);
  const typstRenderer = options?.typstRenderer ?? new TypstRenderer();
  const latexRenderer = options?.latexRenderer ?? new LatexRenderer();

  // Tailoring run events fan out to every SSE subscriber. Token events are coalesced (~10/s).
  const tailoringListeners = new Set<(evt: TailoringEvent) => void>();
  const pendingTokens = new Map<string, TailoringEvent>();
  let tokenFlushTimer: ReturnType<typeof setTimeout> | null = null;
  const broadcast = (evt: TailoringEvent) => {
    for (const listener of tailoringListeners) listener(evt);
  };
  const emitTailoring = (evt: TailoringEvent) => {
    if (evt.kind !== 'token') {
      broadcast(evt);
      return;
    }
    const key = `${evt.slug}:${evt.step}`;
    const existing = pendingTokens.get(key);
    pendingTokens.set(key, existing ? { ...existing, text: (existing.text ?? '') + (evt.text ?? '') } : { ...evt });
    if (!tokenFlushTimer) {
      tokenFlushTimer = setTimeout(() => {
        tokenFlushTimer = null;
        const batch = Array.from(pendingTokens.values());
        pendingTokens.clear();
        batch.forEach(broadcast);
      }, 100);
    }
  };

  const draftService = new DraftService({ workspaceDir: resolvedWorkspaceDir, runnerFactory: options?.runnerFactory ?? defaultRunnerFactory, loadResumes: () => loadResumeSpecs(resolvedWorkspaceDir) });
  draftService.recover();
  const orchestrator = new TailoringOrchestrator({
    drafts: draftService,
    workspaceDir: resolvedWorkspaceDir,
    runnerFactory: options?.runnerFactory ?? defaultRunnerFactory,
    loadEvidence: () => loadEvidenceStore(resolvedWorkspaceDir),
    loadEffectiveCorpus: context => {
      const corpus = loadEffectiveCorpus(resolvedWorkspaceDir, loadSourceEvidenceStore(resolvedWorkspaceDir));
      return { ...corpus, support: applicableSkillSupport(corpus.support, context) };
    },
    loadPrivacyRules: () => loadPrivacyRules(resolvedWorkspaceDir),
    loadResumes: () => loadResumeSpecs(resolvedWorkspaceDir),
    emit: emitTailoring,
  });
  options?.onOrchestrator?.(orchestrator);

  // 1. Host and Origin protection for localhost security
  app.use('*', async (c, next) => {
    c.header('X-Content-Type-Options', 'nosniff');
    c.header('X-Frame-Options', 'DENY');
    c.header('Referrer-Policy', 'same-origin');

    const secFetchSite = c.req.header('sec-fetch-site');
    if (secFetchSite === 'cross-site') {
      return c.text('Forbidden: Cross-Site Request Blocked', 403);
    }

    const host = c.req.header('host');
    if (host && !isAllowedHost(host)) {
      return c.text('Forbidden: Invalid Host Header', 403);
    }
    const origin = c.req.header('origin');
    if (origin) {
      try {
        new URL(origin);
      } catch {
        return c.text('Forbidden: Malformed Origin Header', 403);
      }
      if (!isAllowedOrigin(origin)) {
        return c.text('Forbidden: Cross-Origin Request Blocked', 403);
      }
    }
    await next();
  });

  // 1a. CORS support for localhost, 127.0.0.1, and Tailscale (.ts.net) origins
  app.use('*', cors({
    origin: (origin) => {
      if (!origin) return '*';
      if (isAllowedOrigin(origin)) {
        return origin;
      }
      return null;
    },
    allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowHeaders: ['Content-Type', 'Accept', 'Authorization', 'X-Requested-With'],
    credentials: true,
  }));

  mountDraftRoutes(app, draftService, orchestrator);

  // Capture once: subsequent disk edits must not relabel an already running app.
  const servedBuild = buildIdentity({ cli: __dirname, core: path.resolve(__dirname, '../../core/dist') });
  app.get('/api/build-identity', (c) => { c.header('Cache-Control', 'no-store'); return c.json(servedBuild); });

  // 1b. Health check
  app.get('/api/health', (c) => {
    return c.json({
      status: 'ok',
      workspaceDir: resolvedWorkspaceDir,
      workspaceId: draftService.workspaceId,
    });
  });

  mountCorpusRoutes(app, () => getJobs().corpus);

  // 2. Evidence list & query
  app.get('/api/evidence', (c) => {
    const corpus = loadEffectiveCorpus(resolvedWorkspaceDir, loadSourceEvidenceStore(resolvedWorkspaceDir));
    const store = corpus.evidence;
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
      ? queryCorpus(corpus, { company, theme, search, confidence, in_flight, hasMissingMetrics }, { employer: url.searchParams.get('employer') ?? undefined, project: url.searchParams.get('project') ?? undefined, role: url.searchParams.get('role') ?? undefined, job_id: url.searchParams.get('job_id') ?? undefined }).map(match => match.record)
      : store.getAll();

    return c.json(records);
  });

  // 2b. Air-gapped local vector search across evidence ledger
  app.post('/api/evidence/semantic-search', async (c) => {
    try {
      const body = await c.req.json();
      const query = typeof body.query === 'string' ? body.query : '';
      if (!query.trim()) {
        return c.json([]);
      }
      const store = loadEvidenceStore(resolvedWorkspaceDir);
      const results = store.semanticSearch(query, {
        limit: typeof body.limit === 'number' ? body.limit : 10,
        minScore: typeof body.minScore === 'number' ? body.minScore : 0.05,
        filters: body.filters,
      });
      return c.json(results);
    } catch (err: any) {
      return c.json({ error: err.message || 'Failed to execute semantic vector search' }, 400);
    }
  });

  app.get('/api/evidence/semantic-search', (c) => {
    const store = loadEvidenceStore(resolvedWorkspaceDir);
    const url = new URL(c.req.url);
    const query = url.searchParams.get('q') ?? url.searchParams.get('query') ?? '';
    if (!query.trim()) {
      return c.json([]);
    }
    const limit = url.searchParams.get('limit') ? Number(url.searchParams.get('limit')) : 10;
    const minScore = url.searchParams.get('minScore') ? Number(url.searchParams.get('minScore')) : 0.05;
    const company = url.searchParams.get('company') ?? undefined;
    const theme = url.searchParams.get('theme') ?? undefined;
    const confidence = url.searchParams.get('confidence') ?? undefined;

    const results = store.semanticSearch(query, {
      limit,
      minScore,
      filters: { company, theme, confidence },
    });
    return c.json(results);
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

      if (!body.filePath) {
        const existing = loadSourceEvidenceStore(resolvedWorkspaceDir).get(validatedEntry.id);
        if (existing) {
          return c.json(
            {
              success: false,
              code: 'duplicate_id',
              error: `Evidence ${validatedEntry.id} already exists${
                existing.filePath ? ` in ${toWorkspaceRelative(resolvedWorkspaceDir, existing.filePath)}` : ''
              }. Use a new ID or edit the existing entry.`,
            },
            409
          );
        }
      }

      const companySlug = (validatedEntry.company || 'general').replace(/[^a-zA-Z0-9_-]/g, '_');
      const safeId = validatedEntry.id.replace(/[^a-zA-Z0-9_-]/g, '_');
      const evidenceRootDir = path.resolve(resolvedWorkspaceDir, 'evidence');

      let targetFile: string;
      if (body.filePath) {
        if (path.isAbsolute(body.filePath)) {
          return c.json({ success: false, error: 'Absolute file paths are not allowed' }, 400);
        }
        targetFile = path.resolve(resolvedWorkspaceDir, body.filePath);
      } else {
        targetFile = path.resolve(evidenceRootDir, companySlug, `${safeId}.md`);
      }

      // Assert path containment strictly within evidence directory
      const relToEvidence = path.relative(evidenceRootDir, targetFile);
      if (relToEvidence.startsWith('..') || path.isAbsolute(relToEvidence)) {
        return c.json({ success: false, error: 'Path traversal detected: Evidence files must reside within evidence directory' }, 403);
      }

      const ext = path.extname(targetFile).toLowerCase();
      if (ext !== '.md' && ext !== '.markdown') {
        return c.json({ success: false, error: 'Evidence files must have .md or .markdown extension' }, 400);
      }

      // Reject symlink overwrites
      if (fs.existsSync(targetFile) && fs.lstatSync(targetFile).isSymbolicLink()) {
        return c.json({ success: false, error: 'Cannot overwrite symbolic links' }, 403);
      }
      if (isConsolidatedLedgerFile(targetFile)) {
        return c.json(
          {
            success: false,
            code: 'ledger_file',
            error: 'Refusing to overwrite a consolidated evidence ledger with a single entry.',
          },
          409
        );
      }
      if (!body.filePath && fs.existsSync(targetFile)) {
        return c.json(
          { success: false, code: 'duplicate_file', error: `${toWorkspaceRelative(resolvedWorkspaceDir, targetFile)} already exists.` },
          409
        );
      }

      fs.mkdirSync(path.dirname(targetFile), { recursive: true });
      fs.writeFileSync(targetFile, serialized, 'utf-8');

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


  // 3b. Evidence update (single-entry files only)
  app.put('/api/evidence/:id', async (c) => {
    try {
      const id = c.req.param('id');
      const body = await c.req.json();
      const record = loadSourceEvidenceStore(resolvedWorkspaceDir).get(id);
      if (!record || !record.filePath) {
        return c.json({ success: false, code: 'not_found', error: `Evidence ${id} not found` }, 404);
      }
      const validatedEntry = EvidenceEntrySchema.parse(body.entry);
      if (validatedEntry.id !== id) {
        return c.json({ success: false, code: 'id_mismatch', error: 'Entry ID cannot change on update' }, 400);
      }
      const file = path.resolve(record.filePath);
      const rel = toWorkspaceRelative(resolvedWorkspaceDir, file);
      if (!isInsideWorkspace(resolvedWorkspaceDir, file)) {
        return c.json({ success: false, code: 'outside_workspace', error: 'Evidence file is outside the workspace' }, 403);
      }
      if (fs.existsSync(file) && fs.lstatSync(file).isSymbolicLink()) {
        return c.json({ success: false, code: 'symlink', error: 'Cannot overwrite symbolic links' }, 403);
      }
      if (isConsolidatedLedgerFile(file)) {
        return c.json(
          {
            success: false,
            code: 'ledger_entry',
            filePath: rel,
            error: `${id} lives in the consolidated ledger ${rel}. Edit it in that file; Featherduster does not rewrite ledgers.`,
          },
          409
        );
      }
      const narrative = typeof body.narrative === 'string' ? body.narrative : record.narrative;
      fs.writeFileSync(file, serializeEvidenceMarkdown(validatedEntry, narrative), 'utf-8');
      return c.json({ success: true, entry: validatedEntry, filePath: rel });
    } catch (err: any) {
      return c.json({ success: false, code: 'invalid', error: err.message || 'Failed to update evidence', issues: err.issues }, 400);
    }
  });

  // 4. Rubrics list
  app.get('/api/rubrics', (c) => {
    const rubrics = loadRubrics(resolvedWorkspaceDir);
    return c.json(rubrics);
  });

  // 4b. Rubric import / save
  app.post('/api/rubrics', async (c) => {
    try {
      const body = await c.req.json();
      let rubricData: any;

      if (body && typeof body.rawTable === 'string') {
        const { rawTable, id, title, target_level } = body;
        rubricData = parseRubricTable(rawTable, { id, title, target_level });
      } else if (body && body.rubric) {
        rubricData = body.rubric;
      } else if (body && body.id && body.levels && body.competencies) {
        rubricData = body;
      } else {
        return c.json(
          {
            success: false,
            error: 'Missing rubric or rawTable in request body',
          },
          400
        );
      }

      const validatedRubric = LevelingRubricSchema.parse(rubricData);
      const rubricsDir = path.resolve(resolvedWorkspaceDir, 'rubrics');
      const safeId = validatedRubric.id.replace(/[^a-zA-Z0-9_-]/g, '_');
      if (!safeId) {
        return c.json({ success: false, error: 'Invalid rubric ID' }, 400);
      }
      const targetFile = path.resolve(rubricsDir, `${safeId}.yaml`);
      const relToRubrics = path.relative(rubricsDir, targetFile);
      if (relToRubrics.startsWith('..') || path.isAbsolute(relToRubrics)) {
        return c.json({ success: false, error: 'Path traversal detected: Rubric must reside in rubrics directory' }, 403);
      }
      if (fs.existsSync(targetFile) && fs.lstatSync(targetFile).isSymbolicLink()) {
        return c.json({ success: false, error: 'Cannot overwrite symbolic links' }, 403);
      }
      fs.mkdirSync(rubricsDir, { recursive: true });
      fs.writeFileSync(targetFile, yaml.dump(validatedRubric), 'utf-8');

      return c.json({
        success: true,
        rubric: validatedRubric,
      });
    } catch (err: any) {
      return c.json(
        {
          success: false,
          error: err.message || 'Failed to parse or save rubric',
          issues: err.issues,
        },
        400
      );
    }
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

      const shouldRedact = spec.redact !== false;
      const privacyRules = loadPrivacyRules(resolvedWorkspaceDir);
      const activeRules = shouldRedact ? privacyRules : undefined;
      let output = '';

      switch (format) {
        case 'markdown':
          output = compileMarkdownResume(spec, activeRules);
          break;
        case 'html':
          output = compileHtmlPrintResume(spec, activeRules);
          break;
        case 'typst':
          output = compileTypstResume(spec, activeRules);
          break;
        case 'latex':
          output = compileLatexResume(spec, activeRules);
          break;
        case 'brag': {
          const rubric = spec.rubric ?? spec;
          const store = loadEvidenceStore(resolvedWorkspaceDir);
          output = compileBragDoc(rubric, store, {
            candidateName: spec.candidateName,
            period: spec.period,
            rules: activeRules,
            ...spec.options,
          });
          break;
        }
        case 'brief': {
          const store = loadEvidenceStore(resolvedWorkspaceDir);
          output = compileDefenseBrief(spec, store, {
            candidateName: spec.candidateName || spec.profile?.name,
            targetCompany: spec.targetCompany,
            targetRole: spec.targetRole,
            jobDescription: spec.jobDescription,
            matchedKeywords: spec.matchedKeywords,
            missingKeywords: spec.missingKeywords,
          });
          break;
        }
        case 'brief-html': {
          const store = loadEvidenceStore(resolvedWorkspaceDir);
          output = compileHtmlDefenseBrief(spec, store, {
            candidateName: spec.candidateName || spec.profile?.name,
            targetCompany: spec.targetCompany,
            targetRole: spec.targetRole,
            jobDescription: spec.jobDescription,
            matchedKeywords: spec.matchedKeywords,
            missingKeywords: spec.missingKeywords,
          });
          break;
        }
        default:
          return c.json({ error: `Unsupported format: ${format}` }, 400);
      }

      const check = shouldRedact
        ? redactText(output, privacyRules)
        : { violations: [], isClean: true, redactedText: output };
      return c.json({
        output,
        violations: check.violations,
        isClean: check.isClean,
      });
    } catch (err: any) {
      return c.json({ error: err.message || 'Failed to compile resume' }, 400);
    }
  });

  // 6a. Typst rendering — rendered preview and PDF export via the local typst binary.
  // The binary is optional: a missing one is reported, not thrown, so the UI can
  // fall back to showing the .typ source.
  const typstSourceFor = (spec: any): string => {
    const shouldRedact = spec.redact !== false;
    const privacyRules = loadPrivacyRules(resolvedWorkspaceDir);
    return compileTypstResume(spec, shouldRedact ? privacyRules : undefined);
  };

  app.post('/api/resumes/render', async (c) => {
    try {
      const { spec } = await c.req.json();
      if (!spec) {
        return c.json({ error: 'Missing spec in request body' }, 400);
      }
      const source = typstSourceFor(spec);
      const render = await typstRenderer.renderSvg(source);
      return c.json({
        available: render.available,
        detail: render.detail,
        pages: render.pages,
        error: render.error,
        source,
      });
    } catch (err: any) {
      return c.json({ error: err.message || 'Failed to render resume' }, 400);
    }
  });

  app.post('/api/resumes/render/pdf', async (c) => {
    try {
      const { spec } = await c.req.json();
      if (!spec) {
        return c.json({ error: 'Missing spec in request body' }, 400);
      }
      const render = await typstRenderer.renderPdf(typstSourceFor(spec));
      if (!render.available) {
        return c.json({ error: render.detail, code: 'typst_not_installed' }, 503);
      }
      if (render.error || !render.pdf) {
        return c.json({ error: render.error || 'Typst produced no PDF', code: 'typst_compile_failed' }, 422);
      }
      return new Response(new Uint8Array(render.pdf), {
        status: 200,
        headers: {
          'Content-Type': 'application/pdf',
          'Content-Disposition': 'attachment; filename="resume.pdf"',
          'Content-Length': String(render.pdf.byteLength),
        },
      });
    } catch (err: any) {
      return c.json({ error: err.message || 'Failed to export PDF' }, 400);
    }
  });

  app.post('/api/resumes/render/latex/pdf', async (c) => {
    try {
      const { spec } = await c.req.json();
      if (!spec) return c.json({ error: 'Missing spec in request body' }, 400);
      const shouldRedact = spec.redact !== false;
      const privacyRules = loadPrivacyRules(resolvedWorkspaceDir);
      const source = compileLatexResume(spec, shouldRedact ? privacyRules : undefined);
      const render = await latexRenderer.renderPdf(source);
      if (!render.available) return c.json({ error: render.detail, code: 'latex_not_installed' }, 503);
      if (render.error || !render.pdf) return c.json({ error: render.error || 'LaTeX produced no PDF', code: 'latex_compile_failed' }, 422);
      return new Response(new Uint8Array(render.pdf), {
        status: 200,
        headers: {
          'Content-Type': 'application/pdf',
          'Content-Disposition': 'attachment; filename="resume.pdf"',
          'Content-Length': String(render.pdf.byteLength),
        },
      });
    } catch (err: any) {
      return c.json({ error: err.message || 'Failed to export LaTeX PDF' }, 400);
    }
  });

  // 6b. Integrity Pre-Flight Gate
  app.post('/api/integrity/preflight', async (c) => {
    try {
      const body = await c.req.json();
      const store = loadEvidenceStore(resolvedWorkspaceDir);
      const privacyRules = loadPrivacyRules(resolvedWorkspaceDir);

      let text = '';
      if (body.spec) {
        const validatedSpec = ResumeSpecSchema.parse(body.spec);
        // Compile to markdown text without privacy rules so linters audit raw content
        text = compileMarkdownResume(validatedSpec);
        // Ensure any bullet citations are evaluated even if not in bullet text
        for (const exp of validatedSpec.experiences || []) {
          for (const b of exp.bullets || []) {
            if (b.citations) {
              for (const cit of b.citations) {
                if (!text.includes(cit)) {
                  text += `\n(${cit})`;
                }
              }
            }
          }
        }
      } else if (typeof body.text === 'string') {
        text = body.text;
      } else {
        return c.json({ error: 'Missing spec or text in request body' }, 400);
      }

      const citationResult = lintCitations(text, store);
      const metricResult = validateMetrics(text, store);
      const redactResult = redactText(text, privacyRules);
      const slopResult: SlopAuditResult = auditSlop(text);
      const confidentialityResult = scanConfidentiality(redactResult.redactedText, privacyRules);

      const hasSlop = slopResult.matches.length > 0 && slopResult.slopBand !== 'clean';

      const isClean =
        citationResult.isClean &&
        metricResult.isClean &&
        redactResult.isClean &&
        confidentialityResult.isClean &&
        !hasSlop;

      return c.json({
        isClean,
        validCitations: citationResult.validCitations,
        danglingCitations: citationResult.danglingCitations,
        metricIssues: metricResult.issues,
        violations: redactResult.violations,
        redactedText: redactResult.redactedText,
        slop: slopResult,
        slopIssues: slopResult.matches,
        confidentiality: confidentialityResult,
        confidentialityLeaks: confidentialityResult.leaks,
      });
    } catch (err: any) {
      return c.json(
        {
          isClean: false,
          error: err.message || 'Preflight check failed',
          issues: err.issues,
        },
        400
      );
    }
  });

  // 6b2. Integrity De-Slop endpoint
  app.post('/api/integrity/deslop', async (c) => {
    try {
      const body = await c.req.json();
      if (!body || typeof body.text !== 'string') {
        return c.json(
          {
            success: false,
            error: 'Missing text in request body',
          },
          400
        );
      }

      const result = cleanSlop(body.text);
      return c.json({
        success: true,
        cleanedText: result.cleanedText,
        fixesApplied: result.fixesApplied,
      });
    } catch (err: any) {
      return c.json(
        {
          success: false,
          error: err.message || 'Failed to deslop text',
        },
        400
      );
    }
  });

  // 6c. Resume Specs list
  app.get('/api/resumes', (c) => {
    const resumes = loadResumeSpecs(resolvedWorkspaceDir);
    const completed = orchestrator.drafts.list().records.flatMap(({ record }) => record.completion ? [record.completion] : []);
    for (const resume of resumes) { const completion = completed.find(item => item.path === resume.filePath); if (completion?.name) resume.name = completion.name; }
    return c.json(resumes);
  });

  // 6d. Save resume spec
  app.post('/api/resumes', async (c) => {
    try {
      const body = await c.req.json();
      let rawName = typeof body.name === 'string' ? body.name.trim() : '';
      if (!rawName) {
        return c.json({ success: false, error: 'Resume name is required' }, 400);
      }
      rawName = rawName.replace(/\.(ya?ml|json|md)$/i, '');
      const safeName = rawName.replace(/[^a-zA-Z0-9_-]/g, '_');
      const type: 'template' | 'tailored' = body.type === 'template' ? 'template' : 'tailored';
      const validatedSpec = ResumeSpecSchema.parse(body.spec);

      const targetDir = path.join(
        resolvedWorkspaceDir,
        'resumes',
        type === 'template' ? 'templates' : 'tailored'
      );
      const targetFile = path.join(targetDir, `${safeName}.yaml`);
      const relToTargetDir = path.relative(targetDir, targetFile);
      if (relToTargetDir.startsWith('..') || path.isAbsolute(relToTargetDir)) {
        return c.json({ success: false, error: 'Path traversal detected' }, 403);
      }
      if (fs.existsSync(targetFile) && fs.lstatSync(targetFile).isSymbolicLink()) {
        return c.json({ success: false, error: 'Cannot overwrite symbolic links' }, 403);
      }
      fs.mkdirSync(targetDir, { recursive: true });
      if (orchestrator.drafts.ownsCompletedOutput(targetFile)) return c.json({ success: false, error: 'Completed versions are immutable; continue editing as a new draft' }, 409);
      fs.writeFileSync(targetFile, yaml.dump(validatedSpec), 'utf-8');

      const relativePath = path
        .relative(resolvedWorkspaceDir, targetFile)
        .replace(/\\/g, '/');

      return c.json({
        success: true,
        name: safeName,
        filePath: relativePath,
      });
    } catch (err: any) {
      return c.json(
        {
          success: false,
          error: err.message || 'Failed to save resume spec',
          issues: err.issues,
        },
        400
      );
    }
  });

  // 6e. LLM tailoring runs
  mountTailoringRoutes(app, orchestrator);

  // 6f. Runner settings (credentials, Claude Code account, preferences)
  mountSettingsRoutes(app, {
    workspaceDir: resolvedWorkspaceDir,
    store: () => options?.credentialStore ?? getCredentialStore(),
    claudeAuth: options?.claudeAuth ?? new ClaudeAuthManager({ command: orchestrator.config().runner['claude-code'].command }),
    codexAuth: options?.codexAuth ?? new CodexAuthManager({ command: orchestrator.config().runner.codex.command }),
    runnerFactory: options?.runnerFactory ?? defaultRunnerFactory,
    env: options?.env,
  });

  // 6g. List compiled exports and interview defense briefs
  app.get('/api/exports', (c) => {
    const exportsDir = path.join(resolvedWorkspaceDir, 'resumes', 'exports');
    const briefsDir = path.join(resolvedWorkspaceDir, 'resumes', 'tailored', 'briefs');
    const items: Array<{
      name: string;
      relativePath: string;
      category: 'export' | 'brief';
      format: string;
      sizeBytes: number;
      updatedAt: string;
    }> = [];

    const dirs: Array<{ dir: string; category: 'export' | 'brief' }> = [
      { dir: exportsDir, category: 'export' },
      { dir: briefsDir, category: 'brief' },
    ];

    for (const { dir, category } of dirs) {
      if (!fs.existsSync(dir)) continue;
      const files = findFiles(dir, ['.md', '.markdown', '.html', '.htm', '.typ', '.tex', '.pdf', '.txt']);
      for (const file of files) {
        try {
          const stat = fs.statSync(file);
          const rel = path.relative(resolvedWorkspaceDir, file).replace(/\\/g, '/');
          const format = getFormatFromFilename(file);
          items.push({
            name: path.basename(file),
            relativePath: rel,
            category,
            format,
            sizeBytes: stat.size,
            updatedAt: stat.mtime.toISOString(),
          });
        } catch {
          // Skip unreadable files
        }
      }
    }

    items.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
    return c.json(items);
  });

  // 6h. Compile and save multi-target application release bundle
  app.post('/api/exports/bundle', async (c) => {
    try {
      const body = await c.req.json();
      let rawName = typeof body.name === 'string' ? body.name.trim() : '';
      if (!rawName) {
        return c.json({ success: false, error: 'Bundle name / slug is required' }, 400);
      }
      rawName = rawName.replace(/\.(ya?ml|json|md)$/i, '');
      const safeName = rawName.replace(/[^a-zA-Z0-9_-]/g, '_');
      const validatedSpec = ResumeSpecSchema.parse(body.spec);
      const privacyRules = loadPrivacyRules(resolvedWorkspaceDir);
      const store = loadEvidenceStore(resolvedWorkspaceDir);

      const requestedFormats: string[] =
        Array.isArray(body.formats) && body.formats.length > 0
          ? body.formats
          : ['markdown', 'html'];
      const includeBrief = body.includeBrief !== false;

      const exportsDir = path.join(resolvedWorkspaceDir, 'resumes', 'exports');
      const briefsDir = path.join(resolvedWorkspaceDir, 'resumes', 'tailored', 'briefs');
      fs.mkdirSync(exportsDir, { recursive: true });
      if (includeBrief) {
        fs.mkdirSync(briefsDir, { recursive: true });
      }

      const generatedFiles: Array<{
        name: string;
        relativePath: string;
        category: 'export' | 'brief';
        format: string;
      }> = [];

      // 1. Compile requested resume formats
      for (const fmt of requestedFormats) {
        let content = '';
        let fileName = '';
        switch (fmt) {
          case 'markdown':
            content = compileMarkdownResume(validatedSpec, privacyRules);
            fileName = `resume_${safeName}_ats.md`;
            break;
          case 'html':
            content = compileHtmlPrintResume(validatedSpec, privacyRules);
            fileName = `resume_${safeName}.html`;
            break;
          case 'typst':
            content = compileTypstResume(validatedSpec, privacyRules);
            fileName = `resume_${safeName}.typ`;
            break;
          case 'latex':
            content = compileLatexResume(validatedSpec, privacyRules);
            fileName = `resume_${safeName}.tex`;
            break;
        }

        if (content && fileName) {
          const filePath = path.join(exportsDir, fileName);
          fs.writeFileSync(filePath, content, 'utf-8');
          generatedFiles.push({
            name: fileName,
            relativePath: path.relative(resolvedWorkspaceDir, filePath).replace(/\\/g, '/'),
            category: 'export',
            format: fmt,
          });
        }
      }

      // 2. Compile Interview Defense Dossier (strictly quarantined in briefs/)
      if (includeBrief) {
        const briefContent = compileDefenseBrief(validatedSpec, store, {
          targetCompany: body.targetCompany,
          targetRole: body.targetRole,
          jobDescription: body.jobDescription,
          matchedKeywords: body.matchedKeywords,
          missingKeywords: body.missingKeywords,
        });
        const briefFileName = `${safeName}-defense-brief.md`;
        const briefFilePath = path.join(briefsDir, briefFileName);
        fs.writeFileSync(briefFilePath, briefContent, 'utf-8');
        generatedFiles.push({
          name: briefFileName,
          relativePath: path.relative(resolvedWorkspaceDir, briefFilePath).replace(/\\/g, '/'),
          category: 'brief',
          format: 'markdown',
        });
      }

      return c.json({
        success: true,
        name: safeName,
        files: generatedFiles,
      });
    } catch (err: any) {
      return c.json(
        {
          success: false,
          error: err.message || 'Failed to compile and save application bundle',
          issues: err.issues,
        },
        400
      );
    }
  });

  // 6i. Compile and save standalone interview defensibility brief (Markdown and/or HTML)
  app.post('/api/exports/brief', async (c) => {
    try {
      const body = await c.req.json();
      let rawName = typeof body.name === 'string' ? body.name.trim() : '';
      if (!rawName) {
        return c.json({ success: false, error: 'Brief name / slug is required' }, 400);
      }
      rawName = rawName.replace(/\.(ya?ml|json|md|html)$/i, '');
      const safeName = rawName.replace(/[^a-zA-Z0-9_-]/g, '_');
      const validatedSpec = ResumeSpecSchema.parse(body.spec);
      const store = loadEvidenceStore(resolvedWorkspaceDir);

      const requestedFormat = body.format || 'markdown'; // 'markdown' | 'html' | 'all'
      const briefsDir = path.join(resolvedWorkspaceDir, 'resumes', 'tailored', 'briefs');
      fs.mkdirSync(briefsDir, { recursive: true });

      const generatedFiles: Array<{
        name: string;
        relativePath: string;
        category: 'brief';
        format: string;
      }> = [];

      const briefOptions = {
        candidateName: body.candidateName || validatedSpec.profile?.name,
        targetCompany: body.targetCompany,
        targetRole: body.targetRole,
        jobDescription: body.jobDescription,
        matchedKeywords: body.matchedKeywords,
        missingKeywords: body.missingKeywords,
      };

      if (requestedFormat === 'markdown' || requestedFormat === 'all') {
        const mdContent = compileDefenseBrief(validatedSpec, store, briefOptions);
        const mdFileName = `${safeName}-defense-brief.md`;
        const mdFilePath = path.join(briefsDir, mdFileName);
        fs.writeFileSync(mdFilePath, mdContent, 'utf-8');
        generatedFiles.push({
          name: mdFileName,
          relativePath: path.relative(resolvedWorkspaceDir, mdFilePath).replace(/\\/g, '/'),
          category: 'brief',
          format: 'markdown',
        });
      }

      if (requestedFormat === 'html' || requestedFormat === 'all') {
        const htmlContent = compileHtmlDefenseBrief(validatedSpec, store, briefOptions);
        const htmlFileName = `${safeName}-defense-brief.html`;
        const htmlFilePath = path.join(briefsDir, htmlFileName);
        fs.writeFileSync(htmlFilePath, htmlContent, 'utf-8');
        generatedFiles.push({
          name: htmlFileName,
          relativePath: path.relative(resolvedWorkspaceDir, htmlFilePath).replace(/\\/g, '/'),
          category: 'brief',
          format: 'html',
        });
      }

      return c.json({
        success: true,
        name: safeName,
        files: generatedFiles,
      });
    } catch (err: any) {
      return c.json(
        {
          success: false,
          error: err.message || 'Failed to export defensibility brief',
          issues: err.issues,
        },
        400
      );
    }
  });

  // Open the generated bundle's containing folder in the user's file manager.
  app.post('/api/exports/open', async (c) => {
    try {
      const body = await c.req.json();
      if (typeof body.relativePath !== 'string' || !body.relativePath.trim()) {
        return c.json({ success: false, error: 'A bundle file path is required' }, 400);
      }
      const filePath = path.resolve(resolvedWorkspaceDir, body.relativePath);
      if (!isInsideWorkspace(resolvedWorkspaceDir, filePath) || !fs.existsSync(filePath)) {
        return c.json({ success: false, error: 'Bundle file is outside the workspace or no longer exists' }, 404);
      }
      await open(path.dirname(filePath));
      return c.json({ success: true });
    } catch (err: any) {
      return c.json({ success: false, error: err.message || 'Could not open the bundle folder' }, 500);
    }
  });

  // 7. Integrity check
  app.get('/api/integrity/check', (c) => {
    const isStrict = c.req.query('strict') === 'true';
    const result = checkWorkspace(resolvedWorkspaceDir, { strict: isStrict });
    return c.json(result);
  });

  // 8. Server-Sent Events (SSE) stream endpoint
  mountJobsRoutes(app, getJobs);

  app.get('/api/events', (c) => {
    return streamSSE(c, async (stream) => {
      let isCleanedUp = false;
      let unsubscribe: (() => void) | null = null;

      const closeStream = () => { cleanup(); stream.abort(); };
      jobsStreams.add(closeStream);
      const cleanup = () => {
        if (!isCleanedUp) {
          isCleanedUp = true;
          jobsStreams.delete(closeStream);
          if (unsubscribe) {
            unsubscribe();
            unsubscribe = null;
          }
        }
      };

      try {
        await stream.writeSSE({
          event: 'connected',
          data: JSON.stringify({ status: 'connected' }),
        });

        const tailoringListener = (evt: TailoringEvent) => {
          stream
            .writeSSE({ event: 'tailoring', data: JSON.stringify(evt) })
            .catch(() => cleanup());
        };
        tailoringListeners.add(tailoringListener);
        const unsubscribeWatcher = watcher.subscribe(async (evt) => {
          try {
            const draftMatch = /^tailoring-drafts\/([0-9a-f-]{36})\.json$/i.exec(evt.relativePath);
            if (draftMatch) {
              let token;
              try { token = draftService.repository.read(draftMatch[1]).token; } catch { /* Deleted/corrupt records still invalidate caches. */ }
              await stream.writeSSE({ event: 'tailoring-draft', data: JSON.stringify({ draftId: draftMatch[1], token }) });
              return;
            }
            await stream.writeSSE({
              event: 'change',
              data: JSON.stringify({
                type: evt.type,
                relativePath: evt.relativePath,
                timestamp: evt.timestamp,
              }),
            });
          } catch {
            cleanup();
          }
        });
        const unsubscribeJobs = getJobs().subscribe(evt => {
          void stream.writeSSE({ event: 'jobs', id: evt.id, data: JSON.stringify(evt) }).catch(() => cleanup());
        });
        const unsubscribeCorpus = getJobs().subscribeCorpus(evt => {
          void stream.writeSSE({ event: 'corpus', data: JSON.stringify(evt) }).catch(() => cleanup());
        });
        unsubscribe = () => {
          unsubscribeCorpus();
          unsubscribeJobs();
          unsubscribeWatcher();
          tailoringListeners.delete(tailoringListener);
        };

        stream.onAbort(() => {
          cleanup();
        });

        // Keep stream alive
        while (!stream.aborted && !isCleanedUp) {
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
      } finally {
        cleanup();
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
    // Do not serve index.html for missing source maps
    if (c.req.path.endsWith('.map')) {
      return c.body(null, 404);
    }

    if (!fs.existsSync(uiDir)) {
      return c.text('Featherduster Web UI is not built. Run "npm run build" in packages/ui.', 404);
    }

    // Try finding requested static file
    const relPath = c.req.path === '/' ? 'index.html' : c.req.path.replace(/^\/+/, '');
    const resolvedUiDir = path.resolve(uiDir);
    const resolvedPath = path.resolve(resolvedUiDir, relPath);

    // Prevent directory traversal & symlink escapes (CWE-23 / CWE-59)
    const relToUi = path.relative(resolvedUiDir, resolvedPath);
    const isInsideUi = !relToUi.startsWith('..') && !path.isAbsolute(relToUi);

    if (
      isInsideUi &&
      fs.existsSync(resolvedPath)
    ) {
      try {
        const realTarget = fs.realpathSync(resolvedPath);
        const realUiDir = fs.realpathSync(resolvedUiDir);
        const relReal = path.relative(realUiDir, realTarget);
        if (!relReal.startsWith('..') && !path.isAbsolute(relReal) && fs.statSync(realTarget).isFile()) {
          const mime = getMimeType(realTarget);
          c.header('Content-Type', mime);
          const content = fs.readFileSync(realTarget);
          return c.body(content);
        }
      } catch {
        // Fallback
      }
    }

    // Fallback to index.html for SPA client-side routes
    const indexPath = path.resolve(resolvedUiDir, 'index.html');
    if (fs.existsSync(indexPath)) {
      c.header('Content-Type', 'text/html; charset=utf-8');
      const indexContent = fs.readFileSync(indexPath, 'utf-8');
      return c.html(indexContent);
    }

    return c.text('Featherduster Web UI is not built. Run "npm run build" in packages/ui.', 404);
  });

  return Object.assign(app, {
    initializeJobs() { getJobs().initialize(); },
    async disposeJobs() { for (const close of jobsStreams) close(); await jobs?.dispose(); },
  });
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

  let server: ReturnType<typeof serve>;
  try {
    app.initializeJobs();
    server = serve({ fetch: app.fetch, port, hostname: '127.0.0.1' });
    await new Promise<void>((resolve, reject) => {
      const onError = (error: Error) => { server.removeListener('listening', onListening); reject(error); };
      const onListening = () => { server.removeListener('error', onError); resolve(); };
      server.once('error', onError);
      server.once('listening', onListening);
    });
  } catch (error) {
    try { await app.disposeJobs(); } finally { await watcher.close(); }
    throw error;
  }

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
      try { await app.disposeJobs(); } finally {
        try { await watcher.close(); } finally {
          if (typeof (server as any).closeAllConnections === 'function') {
            (server as any).closeAllConnections();
          }
          await new Promise<void>((resolve, reject) => {
            server.close((err) => {
              if (err) reject(err);
              else resolve();
            });
          });
        }
      }
    },
  };
}
