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
  SlopAuditResult,
  SLOP_WEIGHTS,
} from '@featherduster/core';
import { WorkspaceWatcher } from './watcher.js';
import { isConsolidatedLedgerFile, isInsideWorkspace, toWorkspaceRelative } from './evidence-files.js';
import { defaultRunnerFactory, type RunnerFactory } from './runners/registry.js';
import { TailoringOrchestrator, type TailoringEvent } from './tailoring/orchestrator.js';
import { mountTailoringRoutes } from './tailoring/routes.js';
import { mountSettingsRoutes } from './settings/routes.js';
import { ClaudeAuthManager } from './settings/claude-auth.js';
import { CodexAuthManager } from './settings/codex-auth.js';
import { getCredentialStore, type CredentialStore } from './settings/credentials.js';
import { TypstRenderer } from './render/typst-renderer.js';
import { checkWorkspace } from './commands/check.js';

export interface CreateAppOptions {
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

export function loadResumeSpecs(workspaceDir: string): ResumeRecord[] {
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
  if (records.filter((r) => r.type === 'template').length === 0) {
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
 * Creates and configures the Hono local application instance for a workspace directory.
 */
export function createApp(workspaceDir: string, options?: CreateAppOptions): Hono {
  const resolvedWorkspaceDir = path.resolve(workspaceDir);
  const app = new Hono();
  const watcher = options?.watcher ?? new WorkspaceWatcher(resolvedWorkspaceDir);
  const typstRenderer = options?.typstRenderer ?? new TypstRenderer();

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

  const orchestrator = new TailoringOrchestrator({
    workspaceDir: resolvedWorkspaceDir,
    runnerFactory: options?.runnerFactory ?? defaultRunnerFactory,
    loadEvidence: () => loadEvidenceStore(resolvedWorkspaceDir),
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
    if (host && !/^(127\.0\.0\.1|localhost)(:\d+)?$/i.test(host)) {
      return c.text('Forbidden: Invalid Host Header', 403);
    }
    const origin = c.req.header('origin');
    if (origin) {
      try {
        const originUrl = new URL(origin);
        if (!['127.0.0.1', 'localhost'].includes(originUrl.hostname)) {
          return c.text('Forbidden: Cross-Origin Request Blocked', 403);
        }
      } catch {
        return c.text('Forbidden: Malformed Origin Header', 403);
      }
    }
    await next();
  });

  // 1b. Health check
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

      if (!body.filePath) {
        const existing = loadEvidenceStore(resolvedWorkspaceDir).get(validatedEntry.id);
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
      const record = loadEvidenceStore(resolvedWorkspaceDir).get(id);
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

      const hasSlop = slopResult.matches.length > 0 && slopResult.slopBand !== 'clean';

      const isClean =
        citationResult.isClean &&
        metricResult.isClean &&
        redactResult.isClean &&
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

  // 7. Integrity check
  app.get('/api/integrity/check', (c) => {
    const isStrict = c.req.query('strict') === 'true';
    const result = checkWorkspace(resolvedWorkspaceDir, { strict: isStrict });
    return c.json(result);
  });

  // 8. Server-Sent Events (SSE) stream endpoint
  app.get('/api/events', (c) => {
    return streamSSE(c, async (stream) => {
      let isCleanedUp = false;
      let unsubscribe: (() => void) | null = null;

      const cleanup = () => {
        if (!isCleanedUp) {
          isCleanedUp = true;
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
        unsubscribe = () => {
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
      if (typeof (server as any).closeAllConnections === 'function') {
        (server as any).closeAllConnections();
      }
      await new Promise<void>((resolve, reject) => {
        server.close((err) => {
          if (err) reject(err);
          else resolve();
        });
      });
    },
  };
}