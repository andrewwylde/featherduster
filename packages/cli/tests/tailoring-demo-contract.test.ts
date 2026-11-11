import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { EvidenceStore, LEGACY_PROPOSALS_JSON_SCHEMA, STEP_JSON_SCHEMAS, isBlocked, validateProposalClaimCoverage, type ResumeSpec } from '@featherduster/core';
import { createDemoResponder } from '../src/runners/demo-responder.js';
import { FakeRunner } from '../src/runners/fake.js';
import { defaultRunnerFactory } from '../src/runners/registry.js';
import { TailoringOrchestrator } from '../src/tailoring/orchestrator.js';
import { RunStore } from '../src/tailoring/store.js';

const base: ResumeSpec = { profile: { name: 'Person', title: 'Engineer', email: 'person@example.com' }, summary: 'Engineer.', experiences: [{ company: 'Acme', role: 'Engineer', startDate: '2022', endDate: 'Present', bullets: [{ text: 'Built services.', citations: ['ev-1'] }] }], education: [], skills: [{ category: 'Delivery', skills: ['Docker', 'Cypress'] }] };
const analysis = { company: 'Acme', role: 'Engineer', seniority: 'Senior', mission: '', requirements: [{ id: 'services', tier: 'must', text: 'Build services', quote: 'Build services.', terms: [] }], boilerplate: [] };
const alignment = { rows: [{ requirement_id: 'services', classification: 'backed', citations: ['ev-1'], rationale: 'Documented services.', adjacent_tool: '' }] };

describe('demo textual bindings and persisted diagnostics', () => {
  let root: string, scripted: FakeRunner, evidence: EvidenceStore, orchestrator: TailoringOrchestrator, useDefaultDemo: boolean;
  const priorRunner = process.env.FEATHERDUSTER_RUNNER;
  const open = () => new TailoringOrchestrator({ workspaceDir: root, runnerFactory: (id, config) => useDefaultDemo ? defaultRunnerFactory(id, config) : scripted, loadEvidence: () => evidence, loadPrivacyRules: () => ({}), loadResumes: () => [{ id: 'base', name: 'Base', spec: base }], emit: () => {} });
  beforeEach(() => {
    process.env.FEATHERDUSTER_RUNNER = 'fake';
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'fd-demo-contract-'));
    evidence = new EvidenceStore();
    evidence.add({ id: 'ev-1', date: '2026-01-01', company: 'Acme', title: 'Delivery', summary: 'Built services.', impact: 'Built services.', themes: [], confidence: 'verified', in_flight: false, metrics: [], internal_references: [] }, 'Built services.');
    scripted = new FakeRunner([analysis, alignment]); useDefaultDemo = false; orchestrator = open();
  });
  afterEach(() => {
    if (priorRunner === undefined) delete process.env.FEATHERDUSTER_RUNNER; else process.env.FEATHERDUSTER_RUNNER = priorRunner;
    expect(path.dirname(root)).toBe(os.tmpdir()); expect(path.basename(root)).toMatch(/^fd-demo-contract-/);
    fs.rmSync(root, { recursive: true, force: true });
  });
  async function run(slug: string, step: 'analysis' | 'alignment' | 'proposals') {
    await orchestrator.startStep(slug, step);
    for (let i = 0; i < 200; i++) {
      const result = orchestrator.getRun(slug);
      if (result.manifest.steps[step].status !== 'running') return result;
      await new Promise(resolve => setTimeout(resolve, 10));
    }
    throw Error('Runner did not settle');
  }
  async function ready() {
    const { slug } = orchestrator.createRun({ posting: 'Build services. Senior Engineer at Acme.', base_resume: 'base', runner: 'fake', label: 'Demo' });
    await run(slug, 'analysis'); orchestrator.approveStep(slug, 'analysis');
    await run(slug, 'alignment'); orchestrator.approveStep(slug, 'alignment');
    return slug;
  }
  function response(slug: string, schema = STEP_JSON_SCHEMAS.proposals): any {
    const input = orchestrator.previewInput(slug, 'proposals');
    return createDemoResponder()({ ...input, schema, signal: new AbortController().signal, onProgress: () => {} });
  }
  function assertTextCoverage(proposals: any[]) {
    const textual = proposals.filter(p => ['summary.rewrite', 'bullet.add'].includes(p.type));
    expect(textual).toHaveLength(2);
    for (const p of textual) {
      expect(p.claim_bindings).toEqual([{ text: p.after, citations: p.citations }]);
      expect(validateProposalClaimCoverage(p.after, p.claim_bindings).valid).toBe(true);
      expect(p.checks?.some((c: any) => c.kind === 'claim_binding') ?? false).toBe(false);
    }
  }
  it('runs the default demo with backed text evidence and preserves current and legacy bindings through approval/reload', async () => {
    const slug = await ready();
    const legacy = response(slug, LEGACY_PROPOSALS_JSON_SCHEMA);
    assertTextCoverage(legacy.proposals);
    useDefaultDemo = true;
    const generated = await run(slug, 'proposals');
    expect(generated.manifest.steps.proposals.status, generated.manifest.steps.proposals.error ?? '').toBe('done');
    assertTextCoverage(generated.proposals!);
    expect(generated.proposals!.filter(isBlocked)).toEqual([]);
    const decided = generated.proposals!.map(p => ({ ...p, decision: 'accepted' }));
    orchestrator.saveStep(slug, 'proposals', { proposals: decided });
    expect(orchestrator.approveStep(slug, 'proposals').resume!.experiences[0].bullets.map(b => b.text)).toContain('Delivery: Built services.');
    orchestrator = open();
    assertTextCoverage(orchestrator.getRun(slug).proposals!);
    // This explicit historical fixture retains old policy and wire shape.
    const store = new RunStore(root), manifest = structuredClone(generated.manifest);
    delete manifest.draft_id; manifest.slug = 'legacy-demo'; manifest.steps.proposals.generation_policy = 'accomplishments-1';
    store.create(manifest.slug); store.writeManifest(manifest); store.writeText(manifest.slug, 'job-posting.md', 'Build services. Senior Engineer at Acme.');
    store.writeJson(manifest.slug, 'analysis.json', analysis); store.writeJson(manifest.slug, 'alignment.json', alignment); store.writeJson(manifest.slug, 'proposals.json', legacy);
    orchestrator = open(); orchestrator.getRun(manifest.slug);
    const saved = orchestrator.saveStep(manifest.slug, 'proposals', { proposals: legacy.proposals.map((p: any) => ({ ...p, decision: 'accepted' })) });
    assertTextCoverage(saved.proposals!); expect(saved.proposals!.filter(isBlocked)).toEqual([]);
    orchestrator.approveStep(manifest.slug, 'proposals'); orchestrator = open();
    const historical = orchestrator.getRun(manifest.slug);
    expect(historical.manifest.steps.proposals.generation_policy).toBe('accomplishments-1');
    expect(historical.proposals!.find(p => p.type === 'skills.reorder')).not.toHaveProperty('before_skills');
    assertTextCoverage(historical.proposals!);
  });
  it.each(['empty', 'partial', 'stale'])('persists %s textual binding blocks through generation, save, and reload', async kind => {
    const slug = await ready(), output = response(slug);
    for (const p of output.proposals.filter((p: any) => ['summary.rewrite', 'bullet.add'].includes(p.type))) {
      p.claim_bindings = kind === 'empty' ? [] : [{ text: kind === 'partial' ? p.after.slice(0, 4) : 'Absent wording', citations: p.citations }];
    }
    scripted.enqueue(output);
    const generated = await run(slug, 'proposals');
    expect(generated.manifest.steps.proposals.status, generated.manifest.steps.proposals.error ?? '').toBe('done');
    const text = generated.proposals!.filter(p => ['summary.rewrite', 'bullet.add'].includes(p.type));
    for (const p of text) expect(p.checks).toEqual(expect.arrayContaining([expect.objectContaining({ severity: 'block', kind: 'claim_binding', gaps: expect.arrayContaining([expect.objectContaining({ text: expect.any(String), span: expect.any(Array) })]) })]));
    const saved = orchestrator.saveStep(slug, 'proposals', { proposals: generated.proposals!.map(p => ({ ...p, decision: 'accepted' })) });
    orchestrator = open();
    expect(orchestrator.getRun(slug).proposals).toEqual(saved.proposals);
    expect(orchestrator.getRun(slug).draft!.record.appliedContent.proposals!.proposals).toEqual(saved.proposals);
    expect(() => orchestrator.approveStep(slug, 'proposals')).toThrow(/blocking/);
    expect(orchestrator.getRun(slug).resume).toBeNull();
    expect(scripted.requests).toHaveLength(3);
  });
});
