import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { EvidenceStore, SYNTHESIS_POLICY, isBlocked, type ResumeSpec } from '@featherduster/core';
import { FakeRunner } from '../src/runners/fake.js';
import { createDemoResponder } from '../src/runners/demo-responder.js';
import { TailoringOrchestrator } from '../src/tailoring/orchestrator.js';
import { RunStore } from '../src/tailoring/store.js';
import { createApp } from '../src/server.js';

const before = ['GitHub Actions', 'Docker', 'Cypress'];
const base: ResumeSpec = { profile: { name: 'Person', title: 'Engineer', email: 'person@example.com' }, summary: '', experiences: [], education: [], skills: [{ category: 'Delivery', skills: before }] };
const analysis = { company: 'Acme', role: 'Engineer', seniority: 'Senior', mission: '', requirements: [], boilerplate: [] };
const alignment = { rows: [] };
const proposal = () => ({ id: 'prune', type: 'skills.prune', target: { experience_index: -1, bullet_index: -1, skill_group_index: 0 }, before: '', after: 'GitHub Actions, Cypress', skills: ['Docker'], order: [], citations: [], requirement_ids: [], rationale: 'Remove Docker.', before_skills: before, result_skills: ['GitHub Actions', 'Cypress'], allow_empty_group: false, source_bullets: [], claim_bindings: [] });

describe('tailoring runner skills admission and persisted policy', () => {
  let root: string;
  let runner: FakeRunner;
  let orchestrator: TailoringOrchestrator;
  let app: ReturnType<typeof createApp> | undefined;
  const open = () => new TailoringOrchestrator({ workspaceDir: root, runnerFactory: () => runner, loadEvidence: () => new EvidenceStore(), loadPrivacyRules: () => ({}), loadResumes: () => [{ id: 'base', name: 'Base', spec: base }], emit: () => {} });
  beforeEach(() => { root = fs.mkdtempSync(path.join(os.tmpdir(), 'fd-tailoring-skills-')); runner = new FakeRunner([]); orchestrator = open(); });
  afterEach(async () => {
    await app?.disposeJobs(); app = undefined;
    // Only the disposable directory returned by mkdtemp is removed.
    expect(path.dirname(root)).toBe(os.tmpdir());
    expect(path.basename(root)).toMatch(/^fd-tailoring-skills-/);
    fs.rmSync(root, { recursive: true, force: true });
  });
  async function run(slug: string, step: string) {
    await orchestrator.startStep(slug, step);
    for (let i = 0; i < 200; i++) {
      const current = orchestrator.getRun(slug);
      if (current.manifest.steps[step as 'proposals'].status !== 'running') return current;
      await new Promise(resolve => setTimeout(resolve, 10));
    }
    throw new Error('Runner did not settle');
  }
  async function ready() {
    const { slug } = orchestrator.createRun({ posting: 'Senior engineer needed for product delivery.', base_resume: 'base', runner: 'fake', label: 'Skills' });
    runner.enqueue(analysis, alignment);
    await run(slug, 'analysis'); orchestrator.approveStep(slug, 'analysis');
    await run(slug, 'alignment'); orchestrator.approveStep(slug, 'alignment');
    return slug;
  }
  it('admits and applies the shipped demo fallback through the actual tailoring runner', async () => {
    runner = new FakeRunner([], { fallback: createDemoResponder() });
    const slug = await ready();
    const result = await run(slug, 'proposals');
    expect(result.manifest.steps.proposals.status, result.manifest.steps.proposals.error ?? '').toBe('done');
    expect(result.proposals).toHaveLength(1);
    expect(result.proposals![0]).toMatchObject({ type: 'skills.reorder', before_skills: before, result_skills: before, skills: before, allow_empty_group: false, checks: [] });
    orchestrator.saveStep(slug, 'proposals', { proposals: result.proposals!.map(p => ({ ...p, decision: 'accepted' })) });
    expect(orchestrator.approveStep(slug, 'proposals').resume!.skills![0].skills).toEqual(before);
    expect(runner.requests).toHaveLength(3);
  });
  async function reloadApi() {
    await app?.disposeJobs();
    app = createApp(root, { runnerFactory: () => runner, onOrchestrator: value => { orchestrator = value; } });
  }
  async function post(url: string, value: unknown) {
    const response = await app!.request(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(value) });
    expect(response.status, await response.clone().text()).toBe(200);
    return response.json() as Promise<any>;
  }
  async function recover(source: any, token: any) {
    return post(`/api/tailoring-drafts/${source.id}/fork`, { expected: token, operationId: randomUUID(), sourceSnapshot: source });
  }
  async function applyRecovered(draft: any) {
    for (const step of ['analysis', 'alignment', 'proposals']) {
      draft = await post(`/api/tailoring-drafts/${draft.record.id}/apply/${step}`, { expected: draft.token, artifactToken: draft.record.payload.artifactTokens[step] ?? null, operationId: randomUUID() });
    }
    return orchestrator.getRun(draft.record.runSlug);
  }
  it('captures current policy before generation so recovery cannot inject legacy proposals into a new pending run', async () => {
    const { slug } = orchestrator.createRun({ posting: 'Senior engineer needed for product delivery.', base_resume: 'base', runner: 'fake', label: 'Pending' });
    const original = orchestrator.getRun(slug);
    expect(original.manifest.steps.proposals.generation_policy).toBe(SYNTHESIS_POLICY);
    const source: any = structuredClone(original.draft!.record);
    const inverse: any = { ...proposal(), decision: 'accepted', override: true, skills: ['GitHub Actions', 'Cypress'] };
    delete inverse.before_skills; delete inverse.result_skills; delete inverse.allow_empty_group;
    source.payload.analysis = analysis; source.payload.alignment = alignment; source.payload.proposals = { proposals: [inverse] };
    await reloadApi();
    const recovered = await recover(source, original.draft!.token);
    await reloadApi();
    const applied = await applyRecovered(orchestrator.drafts.get(recovered.record.id));
    expect(applied.manifest.steps.proposals.generation_policy).toBe(SYNTHESIS_POLICY);
    expect(isBlocked(applied.proposals![0])).toBe(true);
    expect(() => orchestrator.approveStep(applied.manifest.slug, 'proposals')).toThrow(/blocking/);
    expect(runner.requests).toHaveLength(0);
  });
  it.each(['valid', 'missing intent', 'inverse result', 'repeated recovery', 'missing parent', 'missing manifest', 'unassociated manifest', 'unknown policy', 'corrupt manifest'])(
    'retains current contract through public recovery, reload, and Apply: %s', async scenario => {
      const slug = await ready();
      runner.enqueue({ proposals: [proposal()] });
      const generated = await run(slug, 'proposals');
      const source: any = structuredClone(generated.draft!.record);
      source.payload.proposals.proposals[0].decision = 'accepted';
      if (scenario !== 'valid') {
        source.payload.proposals.proposals[0].skills = ['GitHub Actions', 'Cypress'];
        source.payload.proposals.proposals[0].override = true;
      }
      if (['missing intent', 'repeated recovery', 'missing parent'].includes(scenario)) {
        delete source.payload.proposals.proposals[0].before_skills;
        delete source.payload.proposals.proposals[0].result_skills;
        delete source.payload.proposals.proposals[0].allow_empty_group;
      }
      const store = new RunStore(root);
      if (scenario === 'missing parent') source.id = randomUUID();
      if (scenario === 'missing manifest') fs.unlinkSync(path.join(store.runDir(slug), 'run.yaml'));
      if (scenario === 'corrupt manifest') fs.writeFileSync(path.join(store.runDir(slug), 'run.yaml'), 'steps: [');
      if (['unassociated manifest', 'unknown policy'].includes(scenario)) {
        const manifest = store.readManifest(slug);
        if (scenario === 'unassociated manifest') { manifest.draft_id = randomUUID(); delete manifest.steps.proposals.generation_policy; }
        else manifest.steps.proposals.generation_policy = 'unknown-policy';
        if (scenario === 'unassociated manifest') fs.writeFileSync(path.join(store.runDir(slug), 'run.yaml'), JSON.stringify(manifest));
        else store.writeManifest(manifest);
      }
      // The client-provided run pointer never selects the trusted policy source.
      source.runSlug = 'client-selected-legacy';
      await reloadApi();
      let recovered = await recover(source, generated.draft!.token);
      if (scenario === 'repeated recovery') recovered = await recover(recovered.record, recovered.token);
      const recoveredSlug = recovered.record.runSlug;
      expect(new RunStore(root).readManifest(recoveredSlug).steps.proposals.generation_policy).toBe(SYNTHESIS_POLICY);
      await reloadApi();
      recovered = orchestrator.drafts.get(recovered.record.id);
      const applied = await applyRecovered(recovered);
      expect(applied.manifest.steps.proposals.generation_policy).toBe(SYNTHESIS_POLICY);
      await reloadApi();
      expect(orchestrator.getRun(recoveredSlug).manifest.steps.proposals.generation_policy).toBe(SYNTHESIS_POLICY);
      if (scenario === 'valid') {
        expect(isBlocked(applied.proposals![0])).toBe(false);
        expect(orchestrator.approveStep(recoveredSlug, 'proposals').resume!.skills![0].skills).toEqual(['GitHub Actions', 'Cypress']);
      } else {
        expect(isBlocked(applied.proposals![0])).toBe(true);
        expect(applied.proposals![0].override).toBeUndefined();
        expect(() => orchestrator.approveStep(recoveredSlug, 'proposals')).toThrow(/blocking/);
        expect(orchestrator.getRun(recoveredSlug).resume).toBeNull();
      }
      expect(runner.requests).toHaveLength(3);
    }
  );
  it.each(['missing intent', 'machine override'])('rejects %s on the actual runner path, including retry', async reason => {
    const slug = await ready();
    const p: any = proposal();
    if (reason === 'missing intent') { delete p.before_skills; delete p.result_skills; delete p.allow_empty_group; }
    else { p.override = true; p.skills = ['GitHub Actions', 'Cypress']; }
    runner.enqueue({ proposals: [p] }, { proposals: [p] });
    const result = await run(slug, 'proposals');
    expect(result.manifest.steps.proposals.status).toBe('error');
    expect(result.proposals).toBeNull();
    expect(result.manifest.steps.proposals.error).toMatch(reason === 'missing intent' ? /before_skills/ : /override/);
    expect(runner.requests).toHaveLength(4);
    expect((runner.requests[2].schema as any).properties.proposals.items.required).toEqual(expect.arrayContaining(['before_skills', 'result_skills', 'allow_empty_group']));
  });
  it('captures current policy, resets machine decisions, and preserves validation through reload and both edit paths', async () => {
    const slug = await ready();
    runner.enqueue({ generation_policy: 'accomplishments-1', proposals: [{ ...proposal(), decision: 'accepted', edited_after: 'machine edit', checks: [{ severity: 'block', kind: 'fake', message: 'fake' }] }] });
    const generated = await run(slug, 'proposals');
    expect(generated.manifest.steps.proposals.status, generated.manifest.steps.proposals.error ?? '').toBe('done');
    expect(generated.manifest.steps.proposals.generation_policy).toBe(SYNTHESIS_POLICY);
    expect(generated.proposals![0]).toMatchObject({ decision: 'pending', checks: [] });
    expect(generated.proposals![0].edited_after).toBeUndefined();
    orchestrator = open();
    const malformed: any = { ...generated.proposals![0], decision: 'accepted', override: true, skills: ['GitHub Actions', 'Cypress'] };
    delete malformed.before_skills; delete malformed.result_skills; delete malformed.allow_empty_group;
    let saved = orchestrator.saveStep(slug, 'proposals', { generation_policy: 'accomplishments-1', proposals: [malformed] });
    expect(saved.manifest.steps.proposals.generation_policy).toBe(SYNTHESIS_POLICY);
    expect(isBlocked(saved.proposals![0])).toBe(true);
    expect(() => orchestrator.approveStep(slug, 'proposals')).toThrow(/blocking/);
    // The current draft editor autosaves first, then explicitly applies its payload.
    const draft = saved.draft!;
    if (draft.record.kind !== 'run') throw new Error('Expected run draft');
    const payload = structuredClone(draft.record.payload);
    payload.proposals = { proposals: [{ ...generated.proposals![0], decision: 'accepted', override: true, skills: ['GitHub Actions', 'Cypress'] }] };
    const edited = orchestrator.drafts.save(draft.record.id, { expected: draft.token, mutationId: randomUUID(), change: 'content', payload });
    orchestrator = open();
    const applied = orchestrator.applyDraft(draft.record.id, { expected: edited.token, artifactToken: payload.artifactTokens.proposals ?? null, operationId: randomUUID(), step: 'proposals' });
    expect(applied.run.manifest.steps.proposals.generation_policy).toBe(SYNTHESIS_POLICY);
    expect(isBlocked(applied.run.proposals![0])).toBe(true);
    expect(() => orchestrator.approveStep(slug, 'proposals')).toThrow(/blocking/);
    saved = orchestrator.saveStep(slug, 'proposals', { proposals: [{ ...proposal(), decision: 'accepted' }] });
    expect(isBlocked(saved.proposals![0])).toBe(false);
    expect(orchestrator.approveStep(slug, 'proposals').resume!.skills![0].skills).toEqual(['GitHub Actions', 'Cypress']);
    expect(runner.requests).toHaveLength(3);
  });
  it.each([undefined, 'accomplishments-1'])('keeps trusted legacy policy %s through reload/recovery, then upgrades only explicit generation', async legacyPolicy => {
    const store = new RunStore(root);
    store.create('legacy'); store.writeText('legacy', 'job-posting.md', 'Engineer needed.');
    const step = { status: 'approved' as const, completed_at: null, input_hash: null, error: null, raw_output: null };
    store.writeManifest({ slug: 'legacy', title: 'Old', created: '2025-01-01T00:00:00Z', updated: '2025-01-01T00:00:00Z', runner: 'fake', model: '', base_resume: 'base', state: 'proposal_review', error: null, finalized_path: null, steps: { analysis: step, alignment: step, proposals: { ...step, status: 'done', ...(legacyPolicy ? { generation_policy: legacyPolicy } : {}) }, brief: { ...step, status: 'pending' } } });
    store.writeJson('legacy', 'analysis.json', analysis); store.writeJson('legacy', 'alignment.json', alignment);
    const old: any = { ...proposal(), skills: ['Docker'], decision: 'accepted', override: true };
    delete old.before_skills; delete old.result_skills; delete old.allow_empty_group;
    store.writeJson('legacy', 'proposals.json', { proposals: [old] });
    orchestrator = open();
    expect(orchestrator.getRun('legacy').proposals![0]).toMatchObject({ override: true, skills: ['Docker'] });
    const saved = orchestrator.saveStep('legacy', 'proposals', { proposals: [old] });
    expect(saved.manifest.steps.proposals.generation_policy).toBe(legacyPolicy);
    expect(saved.proposals![0].checks).toEqual([]);
    expect(orchestrator.approveStep('legacy', 'proposals').resume!.skills![0].skills).toEqual(['GitHub Actions', 'Cypress']);
    orchestrator = open();
    expect(orchestrator.getRun('legacy').proposals![0].override).toBe(true);
    expect(runner.requests).toHaveLength(0);
    const legacy = orchestrator.getRun('legacy').draft!;
    await reloadApi();
    const recovered = await recover(legacy.record, legacy.token);
    await reloadApi();
    const applied = await applyRecovered(orchestrator.drafts.get(recovered.record.id));
    expect(applied.manifest.steps.proposals.generation_policy).toBe(legacyPolicy);
    expect(applied.proposals![0]).toMatchObject({ override: true, skills: ['Docker'], checks: [] });
    expect(orchestrator.approveStep(applied.manifest.slug, 'proposals').resume!.skills![0].skills).toEqual(['GitHub Actions', 'Cypress']);
    expect(runner.requests).toHaveLength(0);
    runner.enqueue({ proposals: [proposal()] });
    const regenerated = await run('legacy', 'proposals');
    expect(regenerated.manifest.steps.proposals.generation_policy).toBe(SYNTHESIS_POLICY);
    expect(regenerated.proposals![0].override).toBeUndefined();
    expect(runner.requests).toHaveLength(1);
  });
});
