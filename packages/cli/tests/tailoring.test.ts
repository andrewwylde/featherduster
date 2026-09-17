import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import yaml from 'js-yaml';
import { createApp } from '../src/server.js';
import { FakeRunner, type FakeResponse } from '../src/runners/fake.js';
import type { ModelRunner, RunnerId } from '../src/runners/types.js';
import type { TailoringOrchestrator } from '../src/tailoring/orchestrator.js';
import { WorkspaceWatcher } from '../src/watcher.js';
import { serializeEvidenceMarkdown, type ResumeSpec } from '@featherduster/core';

const POSTING = `Staff Platform Engineer at Acme
We need strong Go experience and Kafka at scale. Kubernetes a plus.`;

const BASE_RESUME: ResumeSpec = {
  profile: { name: 'Sam Doe', title: 'Engineer', email: 'sam@example.com' },
  summary: 'Backend engineer focused on reliability.',
  experiences: [
    {
      company: 'SampleCorp',
      role: 'Senior Engineer',
      startDate: '2022',
      endDate: 'Present',
      bullets: [
        { text: 'Rewrote gateway in Go.', citations: ['ev-002'] },
        { text: 'Mentored interns.' },
      ],
    },
  ],
  education: [],
  skills: [{ category: 'Languages', skills: ['TypeScript', 'Go'] }],
};

const ANALYSIS = {
  company: 'Acme',
  role: 'Staff Platform Engineer',
  seniority: 'Staff',
  mission: 'Platform',
  requirements: [
    { id: 'r1', tier: 'must', text: 'Go experience', quote: 'strong Go experience', terms: ['Go'] },
    { id: 'r2', tier: 'must', text: 'Kafka at scale', quote: 'Kafka at scale', terms: ['Kafka'] },
  ],
  boilerplate: [],
};

const ALIGNMENT = {
  rows: [
    { requirement_id: 'r1', classification: 'backed', citations: ['ev-002'], rationale: 'Gateway rewrite in Go.', adjacent_tool: '' },
    { requirement_id: 'r2', classification: 'transferable', citations: ['ev-001'], rationale: 'RabbitMQ ingestion.', adjacent_tool: 'RabbitMQ' },
  ],
};

const blankTarget = { experience_index: -1, bullet_index: -1, skill_group_index: -1 };
const PROPOSALS = {
  proposals: [
    {
      id: 'p1', type: 'bullet.rewrite', target: { experience_index: 0, bullet_index: 0, skill_group_index: -1 },
      before: '', after: 'Rewrote the API gateway in Go, cutting CPU by 30%.', order: [], skills: [],
      citations: ['ev-002'], requirement_ids: ['r1'], rationale: 'Leads with Go.',
    },
    {
      id: 'p2', type: 'bullet.add', target: { experience_index: 0, bullet_index: 1, skill_group_index: -1 },
      before: '', after: 'Ran Kafka clusters.', order: [], skills: [],
      citations: ['ev-001'], requirement_ids: ['r2'], rationale: 'Claims Kafka.',
    },
    {
      id: 'p3', type: 'bullet.drop', target: { experience_index: 0, bullet_index: 1, skill_group_index: -1 },
      before: '', after: '', order: [], skills: [], citations: [], requirement_ids: [], rationale: 'Space.',
    },
    {
      id: 'p4', type: 'skills.reorder', target: { ...blankTarget, skill_group_index: 0 },
      before: '', after: '', order: [], skills: ['Go', 'TypeScript'], citations: [], requirement_ids: [], rationale: 'Go first.',
    },
  ],
};

const BRIEF = {
  anchor_stories: [{ title: 'Gateway', problem: 'CPU', ownership: 'Led', proof: '30%', citations: ['ev-002'] }],
  bridges: [{ requirement_id: 'r2', adjacent_tool: 'RabbitMQ', framing: 'Same patterns.' }],
  gaps: [],
};

async function waitFor<T>(fn: () => Promise<T>, predicate: (v: T) => boolean, timeoutMs = 5000): Promise<T> {
  const start = Date.now();
  for (;;) {
    const value = await fn();
    if (predicate(value)) return value;
    if (Date.now() - start > timeoutMs) throw new Error(`waitFor timed out; last value: ${JSON.stringify(value).slice(0, 500)}`);
    await new Promise((r) => setTimeout(r, 25));
  }
}

describe('Tailoring runs API', () => {
  let ws: string;
  let runner: FakeRunner;
  let app: ReturnType<typeof createApp>;
  let orchestrator: TailoringOrchestrator;
  let factoryRunner: () => ModelRunner | null;

  function build(responses: FakeResponse[], options: { locality?: 'local' | 'cloud'; delayMs?: number } = {}) {
    runner = new FakeRunner(responses, options);
    factoryRunner = () => runner;
    app = createApp(ws, {
      watcher: new WorkspaceWatcher(ws),
      runnerFactory: (id: RunnerId) => (id === 'fake' ? factoryRunner() : null),
      onOrchestrator: (o) => (orchestrator = o),
    });
  }

  const call = async (method: string, url: string, body?: unknown) => {
    const res = await app.request(url, {
      method,
      headers: { 'content-type': 'application/json', host: '127.0.0.1:4173' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { status: res.status, json: (await res.json()) as any };
  };

  const getRun = async (slug: string) => (await call('GET', `/api/tailoring/${slug}`)).json;
  const settled = (slug: string, step: string) =>
    waitFor(() => getRun(slug), (r) => r.manifest?.steps?.[step]?.status !== 'running');

  async function createRun(label = 'Acme Staff'): Promise<string> {
    const res = await call('POST', '/api/tailoring', { posting: POSTING, base_resume: 'template-master', runner: 'fake', label });
    expect(res.status).toBe(201);
    return res.json.slug;
  }

  async function runAndApprove(slug: string, step: string) {
    expect((await call('POST', `/api/tailoring/${slug}/steps/${step}/run`)).status).toBe(202);
    const run = await settled(slug, step);
    expect(run.manifest.steps[step].status).toBe('done');
    return run;
  }

  beforeEach(() => {
    ws = fs.mkdtempSync(path.join(os.tmpdir(), 'fd-tailoring-'));
    fs.mkdirSync(path.join(ws, '.featherduster'), { recursive: true });
    fs.mkdirSync(path.join(ws, 'evidence', 'samplecorp'), { recursive: true });
    fs.mkdirSync(path.join(ws, 'resumes', 'templates'), { recursive: true });
    fs.writeFileSync(
      path.join(ws, '.featherduster', 'privacy-rules.yaml'),
      yaml.dump({ rules: { strip_patterns: ['[A-Z]{2,10}-\\d+'], replacements: [{ search: 'SampleCorp', replace: 'Enterprise Client' }], banned_keywords: ['TOP_SECRET'] } })
    );
    fs.writeFileSync(
      path.join(ws, '.featherduster', 'config.yaml'),
      yaml.dump({ active_profile: 'default', default_export_target: 'markdown', port: 4173, runner: { default: 'fake', step_timeout_seconds: 2 } })
    );
    const ev = (id: string, title: string, summary: string, impact: string, themes: string[], metrics: any[] = []) =>
      serializeEvidenceMarkdown(
        { id, date: '2025-01-01', company: 'SampleCorp', title, summary, impact, themes, confidence: 'verified', in_flight: false, metrics, internal_references: [] },
        'Narrative for AUTH-892.'
      );
    fs.writeFileSync(path.join(ws, 'evidence', 'samplecorp', 'ev-001-ingest.md'), ev('ev-001', 'Async ingestion', 'RabbitMQ consumers.', 'Handled 50k msgs/s.', ['RabbitMQ']));
    fs.writeFileSync(
      path.join(ws, 'evidence', 'samplecorp', 'ev-002-gateway.md'),
      ev('ev-002', 'Gateway rewrite', 'Rewrote gateway in Go.', 'Cut CPU by 30%.', ['Go'], [{ name: 'cpu', value: '30%', status: 'verified' }])
    );
    fs.writeFileSync(path.join(ws, 'resumes', 'templates', 'master.yaml'), yaml.dump(BASE_RESUME));
  });

  afterEach(() => {
    fs.rmSync(ws, { recursive: true, force: true });
  });

  it('runs the full staged flow and finalizes a tailored resume', async () => {
    build([ANALYSIS, ALIGNMENT, PROPOSALS, BRIEF]);
    const slug = await createRun();
    expect(slug).toBe('acme-staff');

    let run = await runAndApprove(slug, 'analysis');
    expect(run.analysis.requirements.every((r: any) => r.ungrounded === false)).toBe(true);
    expect((await call('POST', `/api/tailoring/${slug}/steps/analysis/approve`)).status).toBe(200);

    run = await runAndApprove(slug, 'alignment');
    expect(run.alignment_summary).toEqual({ backed: 1, transferable: 1, gap: 0 });
    // Cloud runner input is redacted but keeps evidence IDs
    const alignmentPrompt = runner.requests[1].prompt;
    expect(alignmentPrompt).toContain('ev-001');
    expect(alignmentPrompt).not.toContain('SampleCorp');
    expect(runner.requests[1].system).toContain('Gate 1');
    expect((await call('POST', `/api/tailoring/${slug}/steps/alignment/approve`)).status).toBe(200);

    run = await runAndApprove(slug, 'proposals');
    const byId = Object.fromEntries(run.proposals.map((p: any) => [p.id, p]));
    expect(byId.p1.checks.some((c: any) => c.severity === 'block')).toBe(false);
    expect(byId.p2.checks.find((c: any) => c.kind === 'ledger_ceiling')?.message).toContain('Kafka');
    expect(byId.p1.before).toBe('Rewrote gateway in Go.');

    // Pending decisions block approval
    expect((await call('POST', `/api/tailoring/${slug}/steps/proposals/approve`)).status).toBe(409);

    // Accepting a blocked proposal blocks approval
    const decided = run.proposals.map((p: any) => ({ ...p, decision: 'accepted' }));
    let saved = await call('PUT', `/api/tailoring/${slug}/steps/proposals`, { proposals: decided });
    expect(saved.status).toBe(200);
    const approveBlocked = await call('POST', `/api/tailoring/${slug}/steps/proposals/approve`);
    expect(approveBlocked.status).toBe(409);
    expect(approveBlocked.json.code).toBe('blocking_issues');

    saved = await call('PUT', `/api/tailoring/${slug}/steps/proposals`, {
      proposals: decided.map((p: any) => (p.id === 'p2' ? { ...p, decision: 'rejected' } : p)),
    });
    expect(saved.status).toBe(200);
    run = (await call('POST', `/api/tailoring/${slug}/steps/proposals/approve`)).json;
    expect(run.resume.experiences[0].bullets.map((b: any) => b.text)).toEqual(['Rewrote the API gateway in Go, cutting CPU by 30%.']);
    expect(run.resume.skills[0].skills).toEqual(['Go', 'TypeScript']);

    run = await runAndApprove(slug, 'brief');
    expect(run.manifest.state).toBe('complete');
    expect(run.brief_markdown).toContain('Interview Defensibility Brief: Acme');

    const fin = await call('POST', `/api/tailoring/${slug}/finalize`);
    expect(fin.status).toBe(200);
    expect(fin.json.filePath).toBe('resumes/tailored/acme-staff.yaml');
    expect(fs.existsSync(path.join(ws, 'resumes', 'tailored', 'acme-staff.yaml'))).toBe(true);
    expect(fin.json.preflight.danglingCitations).toEqual([]);

    // Run files on disk
    for (const f of ['run.yaml', 'job-posting.md', 'analysis.json', 'alignment.json', 'proposals.json', 'resume.yaml', 'brief.md']) {
      expect(fs.existsSync(path.join(ws, 'tailoring', slug, f))).toBe(true);
    }

    const list = await call('GET', '/api/tailoring');
    expect(list.json.runs[0].title).toBe('Acme Staff');
  });

  it('enforces step order and marks downstream stale on re-run', async () => {
    build([ANALYSIS, ALIGNMENT, ANALYSIS]);
    const slug = await createRun();
    const early = await call('POST', `/api/tailoring/${slug}/steps/alignment/run`);
    expect(early.status).toBe(409);
    expect(early.json.code).toBe('previous_step_not_approved');

    await runAndApprove(slug, 'analysis');
    await call('POST', `/api/tailoring/${slug}/steps/analysis/approve`);
    await runAndApprove(slug, 'alignment');

    const rerun = await runAndApprove(slug, 'analysis');
    expect(rerun.manifest.steps.alignment.status).toBe('stale');
    expect((await call('POST', `/api/tailoring/${slug}/steps/alignment/approve`)).json.code).toBe('not_ready');
  });

  it('retries once on schema-invalid output, then errors with raw output', async () => {
    build([{ nope: true }, ANALYSIS]);
    const slug = await createRun('retry');
    const ok = await runAndApprove(slug, 'analysis');
    expect(runner.requests).toHaveLength(2);
    expect(runner.requests[1].prompt).toContain('Previous Attempt Rejected');
    expect(ok.manifest.steps.analysis.status).toBe('done');

    build([{ nope: 1 }, { nope: 2 }]);
    const slug2 = await createRun('retry-fail');
    await call('POST', `/api/tailoring/${slug2}/steps/analysis/run`);
    const failed = await settled(slug2, 'analysis');
    expect(failed.manifest.steps.analysis.status).toBe('error');
    expect(failed.manifest.state).toBe('error');
    expect(failed.manifest.steps.analysis.raw_output).toContain('nope');
  });

  it('allows only one in-flight step and supports cancel', async () => {
    build([ANALYSIS, ANALYSIS], { delayMs: 1500 });
    const a = await createRun('one');
    const b = await createRun('two');
    expect((await call('POST', `/api/tailoring/${a}/steps/analysis/run`)).status).toBe(202);
    const busy = await call('POST', `/api/tailoring/${b}/steps/analysis/run`);
    expect(busy.status).toBe(409);
    expect(busy.json.code).toBe('busy');

    expect((await call('POST', `/api/tailoring/${a}/cancel`)).json.cancelled).toBe(true);
    const cancelled = await settled(a, 'analysis');
    expect(cancelled.manifest.state).toBe('cancelled');
    expect(cancelled.manifest.steps.analysis.status).toBe('pending');
  });

  it('times out long steps', async () => {
    build([ANALYSIS], { delayMs: 5000 });
    const slug = await createRun('slow');
    await call('POST', `/api/tailoring/${slug}/steps/analysis/run`);
    const run = await waitFor(() => getRun(slug), (r) => r.manifest.steps.analysis.status !== 'running', 6000);
    expect(run.manifest.steps.analysis.error).toContain('Timed out');
  }, 10000);

  it('requires consent for cloud runners other than fake', async () => {
    runner = new FakeRunner([ANALYSIS]);
    const cloud: ModelRunner = {
      id: 'claude-code', label: 'Claude Code', locality: 'cloud', model: '',
      detect: async () => ({ available: true, detail: 'ok' }),
      run: (req) => runner.run(req),
    };
    app = createApp(ws, { watcher: new WorkspaceWatcher(ws), runnerFactory: (id) => (id === 'claude-code' ? cloud : null) });
    const created = await call('POST', '/api/tailoring', { posting: POSTING, base_resume: 'template-master', runner: 'claude-code' });
    const slug = created.json.slug;
    expect(slug).toMatch(/^run-\d{8}-\d{6}$/);
    const denied = await call('POST', `/api/tailoring/${slug}/steps/analysis/run`);
    expect(denied.status).toBe(403);
    const preview = await call('GET', `/api/tailoring/${slug}/steps/analysis/preview`);
    expect(preview.status).toBe(200);
    expect(preview.json.locality).toBe('cloud');
    expect(preview.json.prompt).toContain('Kafka at scale');
    expect(preview.json.system).toContain('Gate 0');
    expect(denied.json.code).toBe('consent_required');

    expect((await call('POST', '/api/runners/consent', { runner: 'claude-code' })).status).toBe(200);
    const cfg = yaml.load(fs.readFileSync(path.join(ws, '.featherduster', 'config.yaml'), 'utf-8')) as any;
    expect(cfg.runner_consent['claude-code']).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(cfg.active_profile).toBe('default');
    expect((await call('POST', `/api/tailoring/${slug}/steps/analysis/run`)).status).toBe(202);
  });

  it('blocks cloud calls containing banned keywords with 422', async () => {
    build([ANALYSIS]);
    const created = await call('POST', '/api/tailoring', {
      posting: `${POSTING}\nInternal: TOP_SECRET roadmap`,
      base_resume: 'template-master',
      runner: 'fake',
    });
    const res = await call('POST', `/api/tailoring/${created.json.slug}/steps/analysis/run`);
    expect(res.status).toBe(422);
    expect(res.json.code).toBe('banned_keyword');
    expect(runner.requests).toHaveLength(0);
  });

  it('recovers runs interrupted by a server restart', async () => {
    build([ANALYSIS]);
    const slug = await createRun('interrupted');
    const manifestPath = path.join(ws, 'tailoring', slug, 'run.yaml');
    const manifest = yaml.load(fs.readFileSync(manifestPath, 'utf-8')) as any;
    manifest.steps.analysis.status = 'running';
    manifest.state = 'analyzing';
    fs.writeFileSync(manifestPath, yaml.dump(manifest));

    build([]);
    const run = await getRun(slug);
    expect(run.manifest.state).toBe('error');
    expect(run.manifest.steps.analysis.error).toContain('Interrupted');
    expect(orchestrator).toBeDefined();
  });

  it('rejects unsafe slugs, bad input, and unknown steps', async () => {
    build([]);
    expect((await call('GET', '/api/tailoring/..%2F..%2Fetc')).status).toBe(400);
    expect((await call('POST', '/api/tailoring', { posting: 'short', base_resume: 'template-master', runner: 'fake' })).status).toBe(400);
    expect((await call('POST', '/api/tailoring', { posting: POSTING, base_resume: 'nope', runner: 'fake' })).status).toBe(400);
    const slug = await createRun('x');
    expect((await call('POST', `/api/tailoring/${slug}/steps/bogus/run`)).status).toBe(400);
    expect((await call('GET', '/api/tailoring/missing-run')).status).toBe(404);
  });

  it('lists runners with detection info', async () => {
    build([]);
    const res = await call('GET', '/api/runners');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.json.runners)).toBe(true);
  });
});
