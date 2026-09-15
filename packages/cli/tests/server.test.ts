import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import yaml from 'js-yaml';
import { createApp } from '../src/server.js';
import {
  EvidenceEntry,
  LevelingRubric,
  PrivacyRulesConfig,
  ResumeSpec,
  serializeEvidenceMarkdown,
} from '@featherduster/core';

describe('Local Hono Server Integration Tests', () => {
  let tmpWorkspace: string;

  const sampleEvidence: EvidenceEntry = {
    id: 'ev-042',
    date: '2026-04-12',
    company: 'parable',
    title: 'Zero-Downtime Session Migration',
    summary: 'Architected token rotation protocol eliminating session invalidations during DB switch.',
    impact: 'Reduced user re-auth events by 99.4% across 140k active daily sessions.',
    themes: ['distributed-systems', 'reliability', 'auth'],
    confidence: 'verified',
    in_flight: false,
    metrics: [
      {
        name: 're-auth reduction',
        value: '99.4%',
        status: 'verified',
      },
    ],
    internal_references: [
      {
        type: 'linear',
        ref: 'AUTH-892',
      },
    ],
  };

  const sampleRubric: LevelingRubric = {
    id: 'eng-ic-ladder',
    title: 'Engineering IC Competency Framework',
    target_level: 'L5',
    levels: [
      { id: 'L4', name: 'Senior Software Engineer' },
      { id: 'L5', name: 'Staff / Tech Lead' },
      { id: 'L6', name: 'Principal Engineer' },
    ],
    competencies: [
      {
        id: 'architecture-scope',
        name: 'System Architecture & Scope',
        levels: {
          L4: 'Designs single-service modules with minimal guidance.',
          L5: 'Leads multi-service system designs; resolves ambiguous trade-offs.',
          L6: 'Defines cross-organization architectural strategy and standards.',
        },
        evidence_mapped: [
          {
            ev_id: 'ev-042',
            relevance: 'primary',
            narrative: 'Cross-system token protocol spanning auth-service and web-app.',
          },
        ],
      },
      {
        id: 'mentorship',
        name: 'Mentorship & Sponsorship',
        levels: {
          L4: 'Mentors interns and new hires.',
          L5: 'Sponsors L4s toward promotion and leads guilds.',
          L6: 'Sets engineering culture and multipliers.',
        },
        evidence_mapped: [], // Intentionally empty to test gaps
      },
    ],
  };

  const samplePrivacyRules: PrivacyRulesConfig = {
    strip_patterns: ['AUTH-\\d+'],
    replacements: [
      { search: 'parable', replace: 'Acme Health Systems' },
      { search: 'ApolloSecret', replace: 'RedactedProject' },
    ],
    banned_keywords: ['ApolloSecret', 'CLASSIFIED_PROJECT'],
  };

  const sampleResumeSpec: ResumeSpec = {
    profile: {
      name: 'Alex Mercer',
      title: 'Staff Software Engineer',
      email: 'alex@example.com',
      location: 'San Francisco, CA',
    },
    summary: 'Distributed systems architect specialized in zero-downtime migrations.',
    experiences: [
      {
        company: 'parable',
        role: 'Staff Engineer',
        startDate: '2023-01',
        endDate: 'Present',
        bullets: [
          {
            text: 'Architected token rotation protocol eliminating session invalidations (ev-042).',
            citations: ['ev-042'],
          },
        ],
      },
    ],
    education: [
      {
        institution: 'UC Berkeley',
        degree: 'B.S. EECS',
        year: '2016',
      },
    ],
    skills: [
      {
        category: 'Backend',
        skills: ['TypeScript', 'Go', 'Distributed Systems'],
      },
    ],
  };

  beforeEach(() => {
    tmpWorkspace = fs.mkdtempSync(path.join(os.tmpdir(), 'fd-cli-test-'));

    // Create directories
    fs.mkdirSync(path.join(tmpWorkspace, 'evidence', 'parable'), { recursive: true });
    fs.mkdirSync(path.join(tmpWorkspace, 'rubrics'), { recursive: true });
    fs.mkdirSync(path.join(tmpWorkspace, '.featherduster'), { recursive: true });
    fs.mkdirSync(path.join(tmpWorkspace, 'resumes', 'tailored'), { recursive: true });

    // Seed sample evidence
    const mdContent = serializeEvidenceMarkdown(
      sampleEvidence,
      'During the tenant database migration, auth tokens were being invalidated.'
    );
    fs.writeFileSync(
      path.join(tmpWorkspace, 'evidence', 'parable', 'ev-042-auth.md'),
      mdContent,
      'utf-8'
    );

    // Seed sample rubric
    fs.writeFileSync(
      path.join(tmpWorkspace, 'rubrics', 'eng-ic-ladder.yaml'),
      yaml.dump(sampleRubric),
      'utf-8'
    );

    // Seed sample privacy rules
    fs.writeFileSync(
      path.join(tmpWorkspace, '.featherduster', 'privacy-rules.yaml'),
      yaml.dump({ rules: samplePrivacyRules }),
      'utf-8'
    );

    // Seed sample resume file in resumes/
    fs.writeFileSync(
      path.join(tmpWorkspace, 'resumes', 'tailored', 'staff-resume.md'),
      '## Accomplishments\n- Led session rotation protocol (ev-042).\n',
      'utf-8'
    );
  });

  afterEach(() => {
    try {
      fs.rmSync(tmpWorkspace, { recursive: true, force: true });
    } catch {
      // ignore
    }
  });

  describe('createApp factory', () => {
    it('returns a Hono app configured for the workspace directory', () => {
      const app = createApp(tmpWorkspace);
      expect(app).toBeDefined();
      expect(typeof app.request).toBe('function');
    });
  });

  describe('GET /api/health', () => {
    it('returns status ok and the workspace directory', async () => {
      const app = createApp(tmpWorkspace);
      const res = await app.request('/api/health');
      expect(res.status).toBe(200);

      const body = await res.json();
      expect(body).toEqual({
        status: 'ok',
        workspaceDir: tmpWorkspace,
      });
    });
  });

  describe('GET /api/evidence', () => {
    it('returns list of all evidence entries loaded from workspaceDir/evidence/ via EvidenceStore', async () => {
      const app = createApp(tmpWorkspace);
      const res = await app.request('/api/evidence');
      expect(res.status).toBe(200);

      const entries = await res.json();
      expect(Array.isArray(entries)).toBe(true);
      expect(entries.length).toBe(1);

      const first = entries[0];
      expect(first.id).toBe('ev-042');
      expect(first.company).toBe('parable');
      expect(first.title).toBe('Zero-Downtime Session Migration');
      expect(first.narrative).toContain('During the tenant database migration');
    });

    it('filters evidence entries by query parameters', async () => {
      const app = createApp(tmpWorkspace);

      const resMatched = await app.request('/api/evidence?company=parable');
      expect(resMatched.status).toBe(200);
      const matched = await resMatched.json();
      expect(matched.length).toBe(1);

      const resUnmatched = await app.request('/api/evidence?company=othercorp');
      expect(resUnmatched.status).toBe(200);
      const unmatched = await resUnmatched.json();
      expect(unmatched.length).toBe(0);
    });
  });

  describe('POST /api/evidence', () => {
    it('creates a new evidence markdown file on disk with valid frontmatter and returns success', async () => {
      const app = createApp(tmpWorkspace);

      const newEntry: EvidenceEntry = {
        id: 'ev-043',
        date: '2026-05-01',
        company: 'parable',
        title: 'Cache Layer Optimization',
        summary: 'Introduced Redis read-through caching for high-frequency user metadata.',
        impact: 'Reduced p99 query latency from 180ms to 12ms across 2M daily read requests.',
        themes: ['performance', 'caching'],
        confidence: 'verified',
        in_flight: false,
        metrics: [
          {
            name: 'p99 latency',
            value: '12ms',
            status: 'verified',
          },
        ],
        internal_references: [],
      };

      const res = await app.request('/api/evidence', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          entry: newEntry,
          narrative: 'Deployed Redis cluster with cluster-mode enabled.',
        }),
      });

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.success).toBe(true);
      expect(body.entry.id).toBe('ev-043');

      // Check file was created on disk
      const targetFile = path.join(tmpWorkspace, 'evidence', 'parable', 'ev-043.md');
      expect(fs.existsSync(targetFile)).toBe(true);

      const content = fs.readFileSync(targetFile, 'utf-8');
      expect(content).toContain('id: ev-043');
      expect(content).toContain('Cache Layer Optimization');
      expect(content).toContain('Deployed Redis cluster with cluster-mode enabled.');

      // Check it is immediately reflected in GET /api/evidence
      const listRes = await app.request('/api/evidence');
      const entries = await listRes.json();
      expect(entries.length).toBe(2);
      expect(entries.some((e: any) => e.id === 'ev-043')).toBe(true);
    });

    it('returns 400 when evidence payload is invalid', async () => {
      const app = createApp(tmpWorkspace);
      const res = await app.request('/api/evidence', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          entry: {
            id: 'invalid-id',
            // Missing required fields like date, company, title, summary, etc.
          },
        }),
      });

      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.success).toBe(false);
      expect(body.error).toBeDefined();
    });
  });

  describe('GET /api/rubrics', () => {
    it('returns rubrics loaded from workspaceDir/rubrics/', async () => {
      const app = createApp(tmpWorkspace);
      const res = await app.request('/api/rubrics');
      expect(res.status).toBe(200);

      const rubrics = await res.json();
      expect(Array.isArray(rubrics)).toBe(true);
      expect(rubrics.length).toBe(1);
      expect(rubrics[0].id).toBe('eng-ic-ladder');
      expect(rubrics[0].title).toBe('Engineering IC Competency Framework');
      expect(rubrics[0].competencies.length).toBe(2);
    });
  });

  describe('POST /api/rubrics', () => {
    it('parses markdown rawTable, validates with schema, writes to disk, and returns rubric', async () => {
      const app = createApp(tmpWorkspace);

      const rawTable = `
| Competency | L3 (Junior) | L4 (Senior) | L5 (Staff) |
|---|---|---|---|
| Architecture & Scope | Works within single service | Designs services end-to-end | Sets multi-system architecture |
| Execution & Speed | Delivers small PRs | Drives multi-week milestones | Leads multi-quarter programs |
`;

      const res = await app.request('/api/rubrics', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          rawTable,
          id: 'staff-ladder',
          title: 'Staff Engineering Ladder',
          target_level: 'L5',
        }),
      });

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.success).toBe(true);
      expect(body.rubric).toBeDefined();
      expect(body.rubric.id).toBe('staff-ladder');
      expect(body.rubric.title).toBe('Staff Engineering Ladder');
      expect(body.rubric.target_level).toBe('L5');
      expect(body.rubric.levels).toHaveLength(3);
      expect(body.rubric.competencies).toHaveLength(2);

      // Verify file written to disk
      const targetFile = path.join(tmpWorkspace, 'rubrics', 'staff-ladder.yaml');
      expect(fs.existsSync(targetFile)).toBe(true);

      const fileContent = fs.readFileSync(targetFile, 'utf-8');
      const loaded = yaml.load(fileContent) as any;
      expect(loaded.id).toBe('staff-ladder');
      expect(loaded.competencies[0].name).toBe('Architecture & Scope');

      // Verify it appears in GET /api/rubrics
      const listRes = await app.request('/api/rubrics');
      const rubrics = await listRes.json();
      expect(rubrics.some((r: any) => r.id === 'staff-ladder')).toBe(true);
    });

    it('saves rubric directly from rubric object payload', async () => {
      const app = createApp(tmpWorkspace);

      const customRubric: LevelingRubric = {
        id: 'principal-ladder',
        title: 'Principal Engineer Rubric',
        target_level: 'L6',
        levels: [
          { id: 'L5', name: 'Staff' },
          { id: 'L6', name: 'Principal' },
        ],
        competencies: [
          {
            id: 'strategy',
            name: 'Org Strategy',
            levels: {
              L5: 'Influences team strategy',
              L6: 'Defines org-wide tech direction',
            },
          },
        ],
      };

      const res = await app.request('/api/rubrics', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          rubric: customRubric,
        }),
      });

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.success).toBe(true);
      expect(body.rubric.id).toBe('principal-ladder');

      const targetFile = path.join(tmpWorkspace, 'rubrics', 'principal-ladder.yaml');
      expect(fs.existsSync(targetFile)).toBe(true);
    });

    it('returns 400 when rawTable is invalid or cannot be parsed', async () => {
      const app = createApp(tmpWorkspace);
      const res = await app.request('/api/rubrics', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          rawTable: 'not a valid table without columns',
          id: 'bad-rubric',
        }),
      });

      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.success).toBe(false);
      expect(body.error).toBeDefined();
    });

    it('returns 400 when neither rubric nor rawTable is provided', async () => {
      const app = createApp(tmpWorkspace);
      const res = await app.request('/api/rubrics', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });

      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.success).toBe(false);
      expect(body.error).toContain('Missing rubric or rawTable');
    });
  });

  describe('GET /api/rubrics/gap-analysis', () => {
    it('computes and returns gap analysis metrics for a rubric and target level', async () => {
      const app = createApp(tmpWorkspace);
      const res = await app.request(
        '/api/rubrics/gap-analysis?rubricId=eng-ic-ladder&targetLevel=L5'
      );
      expect(res.status).toBe(200);

      const analysis = await res.json();
      expect(analysis.targetLevel).toBe('L5');
      expect(analysis.totalCompetencies).toBe(2);
      // 'architecture-scope' is met (ev-042 is verified), 'mentorship' has no evidence (gap)
      expect(analysis.coveredCompetencies).toBe(1);
      expect(analysis.gapPercentage).toBe(50);
      expect(analysis.competencies).toHaveLength(2);

      const archComp = analysis.competencies.find((c: any) => c.id === 'architecture-scope');
      expect(archComp?.status).toBe('met');

      const mentorComp = analysis.competencies.find((c: any) => c.id === 'mentorship');
      expect(mentorComp?.status).toBe('gap');
    });

    it('returns 404 when rubricId is not found', async () => {
      const app = createApp(tmpWorkspace);
      const res = await app.request(
        '/api/rubrics/gap-analysis?rubricId=non-existent&targetLevel=L5'
      );
      expect(res.status).toBe(404);
      const body = await res.json();
      expect(body.error).toBeDefined();
    });
  });

  describe('POST /api/resumes/compile', () => {
    it('compiles clean ATS markdown with privacy rules applied', async () => {
      const app = createApp(tmpWorkspace);
      const res = await app.request('/api/resumes/compile', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          spec: sampleResumeSpec,
          format: 'markdown',
        }),
      });

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.output).toBeDefined();
      expect(body.output).toContain('Alex Mercer');
      // Redaction engine should replace 'parable' with 'Acme Health Systems'
      expect(body.output).toContain('Acme Health Systems');
      expect(body.output).not.toContain('parable');
      // Should strip citation (ev-042)
      expect(body.output).not.toContain('ev-042');
      expect(body.isClean).toBe(true);
      expect(body.violations).toEqual([]);
    });

    it('compiles HTML print format', async () => {
      const app = createApp(tmpWorkspace);
      const res = await app.request('/api/resumes/compile', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          spec: sampleResumeSpec,
          format: 'html',
        }),
      });

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.output).toContain('<!DOCTYPE html>');
      expect(body.output).toContain('Alex Mercer');
      expect(body.isClean).toBe(true);
    });

    it('compiles Typst and LaTeX formats', async () => {
      const app = createApp(tmpWorkspace);

      const resTypst = await app.request('/api/resumes/compile', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          spec: sampleResumeSpec,
          format: 'typst',
        }),
      });
      expect(resTypst.status).toBe(200);
      const typstBody = await resTypst.json();
      expect(typstBody.output).toContain('#set page');

      const resLatex = await app.request('/api/resumes/compile', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          spec: sampleResumeSpec,
          format: 'latex',
        }),
      });
      expect(resLatex.status).toBe(200);
      const latexBody = await resLatex.json();
      expect(latexBody.output).toContain('\\documentclass');
    });

    it('compiles Brag Doc format with evidence grouped by rubric', async () => {
      const app = createApp(tmpWorkspace);
      const res = await app.request('/api/resumes/compile', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          spec: {
            rubric: sampleRubric,
            candidateName: 'Alex Mercer',
            period: '2026-H1',
          },
          format: 'brag',
        }),
      });

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.output).toContain('# Performance Brag Document: Alex Mercer');
      expect(body.output).toContain('Engineering IC Competency Framework');
      expect(body.output).toContain('System Architecture & Scope');
      expect(body.isClean).toBe(true);
    });

    it('flags violations and sets isClean=false when banned keywords appear in compiled output', async () => {
      const app = createApp(tmpWorkspace);

      const specWithBanned: ResumeSpec = {
        ...sampleResumeSpec,
        summary: 'Architected ApolloSecret core distributed infrastructure for CLASSIFIED_PROJECT.',
      };

      const res = await app.request('/api/resumes/compile', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          spec: specWithBanned,
          format: 'markdown',
        }),
      });

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.isClean).toBe(false);
      expect(body.violations).toContain('CLASSIFIED_PROJECT');
    });
  });

  describe('GET /api/integrity/check', () => {
    it('returns clean report when workspace citations and metrics are valid', async () => {
      const app = createApp(tmpWorkspace);
      const res = await app.request('/api/integrity/check');
      expect(res.status).toBe(200);

      const body = await res.json();
      expect(body.isClean).toBe(true);
      expect(body.issues).toEqual([]);
    });

    it('flags dangling citations and missing metrics across workspace files', async () => {
      // Add a file citing non-existent evidence
      fs.writeFileSync(
        path.join(tmpWorkspace, 'resumes', 'tailored', 'bad-resume.md'),
        '## Experience\n- Delivered breakthrough AI compiler (ev-999).\n- Boosted throughput by [METRIC NEEDED].\n',
        'utf-8'
      );

      const app = createApp(tmpWorkspace);
      const res = await app.request('/api/integrity/check');
      expect(res.status).toBe(200);

      const body = await res.json();
      expect(body.isClean).toBe(false);
      expect(body.issues.length).toBeGreaterThanOrEqual(2);

      const dangling = body.issues.find(
        (i: any) => i.type === 'dangling_citation' || i.message.includes('ev-999')
      );
      expect(dangling).toBeDefined();

      const missingMetric = body.issues.find(
        (i: any) => i.type === 'missing_metric' || i.message.includes('METRIC NEEDED')
      );
      expect(missingMetric).toBeDefined();
    });
  });

  describe('GET /api/events', () => {
    it('returns an SSE stream with proper text/event-stream headers', async () => {
      const app = createApp(tmpWorkspace);
      const res = await app.request('/api/events');
      expect(res.status).toBe(200);
      expect(res.headers.get('content-type')).toContain('text/event-stream');
      expect(res.body).toBeDefined();
    });
  });

  describe('Static File & SPA Fallback Serving', () => {
    let tmpUiDir: string;

    beforeEach(() => {
      tmpUiDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fd-ui-test-'));
      fs.mkdirSync(path.join(tmpUiDir, 'assets'), { recursive: true });
      fs.writeFileSync(
        path.join(tmpUiDir, 'index.html'),
        '<!DOCTYPE html><html><head><title>Featherduster</title></head><body><div id="root"></div></body></html>',
        'utf-8'
      );
      fs.writeFileSync(
        path.join(tmpUiDir, 'assets', 'index.js'),
        'console.log("Featherduster UI bundle");',
        'utf-8'
      );
      fs.writeFileSync(
        path.join(tmpUiDir, 'assets', 'style.css'),
        'body { background: #000; }',
        'utf-8'
      );
    });

    afterEach(() => {
      try {
        fs.rmSync(tmpUiDir, { recursive: true, force: true });
      } catch {
        // ignore
      }
    });

    it('serves index.html at root route / with text/html', async () => {
      const app = createApp(tmpWorkspace, { uiDir: tmpUiDir });
      const res = await app.request('/');
      expect(res.status).toBe(200);
      expect(res.headers.get('content-type')).toContain('text/html');
      const html = await res.text();
      expect(html).toContain('<title>Featherduster</title>');
    });

    it('serves static assets with appropriate content-type headers', async () => {
      const app = createApp(tmpWorkspace, { uiDir: tmpUiDir });

      const resJs = await app.request('/assets/index.js');
      expect(resJs.status).toBe(200);
      expect(resJs.headers.get('content-type')).toContain('application/javascript');
      const js = await resJs.text();
      expect(js).toContain('Featherduster UI bundle');

      const resCss = await app.request('/assets/style.css');
      expect(resCss.status).toBe(200);
      expect(resCss.headers.get('content-type')).toContain('text/css');
      const css = await resCss.text();
      expect(css).toContain('background: #000');
    });

    it('falls back to index.html for non-API client-side SPA navigation routes', async () => {
      const app = createApp(tmpWorkspace, { uiDir: tmpUiDir });
      const res = await app.request('/rubrics/engineer-ic');
      expect(res.status).toBe(200);
      expect(res.headers.get('content-type')).toContain('text/html');
      const html = await res.text();
      expect(html).toContain('<title>Featherduster</title>');
    });

    it('returns 404 for unknown /api routes without falling back to index.html', async () => {
      const app = createApp(tmpWorkspace, { uiDir: tmpUiDir });
      const res = await app.request('/api/unknown-endpoint');
      expect(res.status).toBe(404);
      expect(res.headers.get('content-type')).toContain('application/json');
      const json = await res.json();
      expect(json.error).toBeDefined();
    });

    it('returns 404 with helpful message when UI directory is not built', async () => {
      const nonExistentDir = path.join(tmpWorkspace, 'does-not-exist-ui');
      const app = createApp(tmpWorkspace, { uiDir: nonExistentDir });
      const res = await app.request('/');
      expect(res.status).toBe(404);
      const text = await res.text();
      expect(text).toContain('Featherduster Web UI is not built');
    });
  });

  describe('Resume Specs & Pre-Flight Gate Endpoints', () => {
    it('GET /api/resumes returns default starter template when no templates exist in workspace', async () => {
      const app = createApp(tmpWorkspace);
      const res = await app.request('/api/resumes');
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(Array.isArray(data)).toBe(true);
      expect(data.length).toBe(1);
      expect(data[0].type).toBe('template');
      expect(data[0].spec.profile.name).toBe('Andrew Wylde');
      expect(data[0].spec.experiences.length).toBeGreaterThan(0);
    });

    it('POST /api/resumes saves a tailored resume spec to resumes/tailored/ as YAML', async () => {
      const app = createApp(tmpWorkspace);
      const res = await app.request('/api/resumes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'netflix-agent-platform',
          spec: sampleResumeSpec,
        }),
      });

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.success).toBe(true);
      expect(data.name).toBe('netflix-agent-platform');
      expect(data.filePath).toContain('tailored');

      const expectedFile = path.join(
        tmpWorkspace,
        'resumes',
        'tailored',
        'netflix-agent-platform.yaml'
      );
      expect(fs.existsSync(expectedFile)).toBe(true);
      const content = yaml.load(fs.readFileSync(expectedFile, 'utf-8')) as any;
      expect(content.profile.name).toBe('Alex Mercer');
    });

    it('POST /api/resumes saves a template resume when type is template', async () => {
      const app = createApp(tmpWorkspace);
      const res = await app.request('/api/resumes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'master-systems-template',
          type: 'template',
          spec: sampleResumeSpec,
        }),
      });

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.success).toBe(true);
      expect(data.filePath).toContain('templates');

      const expectedFile = path.join(
        tmpWorkspace,
        'resumes',
        'templates',
        'master-systems-template.yaml'
      );
      expect(fs.existsSync(expectedFile)).toBe(true);

      // Now GET /api/resumes should list this template
      const listRes = await app.request('/api/resumes');
      const list = await listRes.json();
      const found = list.find((r: any) => r.name === 'master-systems-template');
      expect(found).toBeDefined();
      expect(found.type).toBe('template');
    });

    it('POST /api/resumes returns 400 when name is missing or spec is invalid', async () => {
      const app = createApp(tmpWorkspace);
      const resMissingName = await app.request('/api/resumes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ spec: sampleResumeSpec }),
      });
      expect(resMissingName.status).toBe(400);

      const resInvalidSpec = await app.request('/api/resumes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'bad-resume',
          spec: { profile: { name: '' } }, // missing title, email
        }),
      });
      expect(resInvalidSpec.status).toBe(400);
    });

    it('POST /api/integrity/preflight passes clean when citations and metrics are valid', async () => {
      const app = createApp(tmpWorkspace);
      const res = await app.request('/api/integrity/preflight', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          spec: sampleResumeSpec,
        }),
      });

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.isClean).toBe(true);
      expect(data.validCitations).toContain('ev-042');
      expect(data.danglingCitations).toHaveLength(0);
      expect(data.metricIssues).toHaveLength(0);
      expect(data.violations).toHaveLength(0);
      expect(data.slop).toBeDefined();
      expect(data.slop.isClean).toBe(true);
      expect(data.slopIssues).toHaveLength(0);
      // Redacted text should have stripped citation (ev-042) and ticket AUTH-892
      expect(data.redactedText).not.toContain('(ev-042)');
      expect(data.redactedText).not.toContain('AUTH-892');
    });

    it('POST /api/integrity/preflight returns slop audit information and detects AI slop', async () => {
      const app = createApp(tmpWorkspace);
      const slopText =
        "It is worth noting that we spearheaded cross-functional synergies in today's fast-paced digital world (ev-042).";

      const res = await app.request('/api/integrity/preflight', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text: slopText,
        }),
      });

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.isClean).toBe(false);
      expect(data.slop).toBeDefined();
      expect(data.slop.isClean).toBe(false);
      expect(data.slop.matches.length).toBeGreaterThan(0);
      expect(data.slop.slopBand).toBe('high');
      expect(data.slopIssues.length).toBeGreaterThan(0);
      expect(data.validCitations).toContain('ev-042');
    });

    it('POST /api/integrity/deslop strips empty hedges and returns cleaned text', async () => {
      const app = createApp(tmpWorkspace);
      const res = await app.request('/api/integrity/deslop', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text: 'It is worth noting that we reduced API latency by 45%.',
        }),
      });

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.success).toBe(true);
      expect(data.cleanedText).toBe('We reduced API latency by 45%.');
      expect(data.fixesApplied.length).toBeGreaterThan(0);
      expect(data.fixesApplied[0]).toContain('Stripped empty hedge');
    });

    it('POST /api/integrity/deslop returns 400 when text is missing', async () => {
      const app = createApp(tmpWorkspace);
      const res = await app.request('/api/integrity/deslop', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });

      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.success).toBe(false);
      expect(data.error).toBe('Missing text in request body');
    });

    it('POST /api/integrity/preflight detects dangling citations and missing metric tokens', async () => {
      const app = createApp(tmpWorkspace);
      const flawedSpec: ResumeSpec = {
        ...sampleResumeSpec,
        experiences: [
          {
            company: 'Test Corp',
            role: 'Senior Engineer',
            startDate: '2025',
            endDate: '2026',
            bullets: [
              {
                text: 'Designed cache layer achieving [METRIC NEEDED] latency (ev-999).',
                citations: ['ev-999'],
              },
            ],
          },
        ],
      };

      const res = await app.request('/api/integrity/preflight', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          spec: flawedSpec,
        }),
      });

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.isClean).toBe(false);
      expect(data.danglingCitations).toContain('ev-999');
      expect(data.metricIssues.length).toBeGreaterThan(0);
      expect(data.metricIssues[0].type).toBe('missing_metric');
    });

    it('POST /api/integrity/preflight detects banned keyword privacy violations', async () => {
      const app = createApp(tmpWorkspace);
      const confidentialSpec: ResumeSpec = {
        ...sampleResumeSpec,
        summary: 'Lead engineer on CLASSIFIED_PROJECT initiative.',
      };

      const res = await app.request('/api/integrity/preflight', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          spec: confidentialSpec,
        }),
      });

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.isClean).toBe(false);
      expect(data.violations).toContain('CLASSIFIED_PROJECT');
    });
  });
});
