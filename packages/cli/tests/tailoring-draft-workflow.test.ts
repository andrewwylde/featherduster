import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { createApp } from '../src/server.js';
import { FakeRunner } from '../src/runners/fake.js';
import { DraftOperationRunner } from '../src/tailoring/drafts/operations.js';
import { DraftRepository } from '../src/tailoring/drafts/repository.js';
import { RunStore } from '../src/tailoring/store.js';
import type { TailoringOrchestrator } from '../src/tailoring/orchestrator.js';

const base = { profile: { name: 'Pinned Person', title: 'Engineer', email: 'person@example.com' }, summary: 'Original snapshot summary', experiences: [], education: [], skills: [] };
const posting = 'We need an engineer to build reliable distributed systems.';
const body = (value: unknown) => ({ method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(value) });
describe('draft run workflow', () => {
  let root: string; let app: ReturnType<typeof createApp>; let orchestrator: TailoringOrchestrator; let runner: FakeRunner;
  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'draft-workflow-'));
    fs.mkdirSync(path.join(root, 'resumes/templates'), { recursive: true });
    fs.writeFileSync(path.join(root, 'resumes/templates/base.json'), JSON.stringify(base));
    runner = new FakeRunner([]);
    app = createApp(root, { runnerFactory: () => runner, onOrchestrator: (value) => { orchestrator = value; } });
  });
  afterEach(() => fs.rmSync(root, { recursive: true, force: true }));
  async function setup() {
    const id = randomUUID();
    const payload = { posting, label: 'Same label', baseResumeId: 'template-base', runner: 'fake' };
    const response = await app.request('/api/tailoring-drafts', body({ record: { id, kind: 'setup', payload }, mutationId: randomUUID() }));
    expect(response.status).toBe(200);
    return await response.json();
  }
  it('creates one run and same draft identity, replaying after source deletion and later edits', async () => {
    const draft = await setup();
    fs.unlinkSync(path.join(root, 'resumes/templates/base.json'));
    const request = body({ expected: draft.token, operationId: randomUUID() });
    const url = `/api/tailoring-drafts/${draft.record.id}/create-run`;
    const first = await app.request(url, request); expect(first.status).toBe(200);
    const created = await first.json();
    expect(created.record.id).toBe(draft.record.id); expect(created.record.kind).toBe('run');
    expect(created.record.originSetup).toEqual(draft.record.payload);
    const retry = await app.request(url, request); expect(await retry.json()).toEqual(created);
    const run = orchestrator.getRun(created.slug);
    expect(run.base_resume).toEqual(base); expect(run.manifest.draft_id).toBe(draft.record.id);
    expect((await (await app.request('/api/tailoring-drafts')).json()).records).toHaveLength(1);
    expect(new RunStore(root).list()).toHaveLength(1);
  });
  it('creates independent drafts sharing the same source', async () => {
    const a = await setup(); const b = await setup();
    const create = async (draft: any) => (await (await app.request(`/api/tailoring-drafts/${draft.record.id}/create-run`, body({ expected: draft.token, operationId: randomUUID() }))).json());
    const ra = await create(a); const rb = await create(b);
    expect(ra.slug).not.toBe(rb.slug); expect(new RunStore(root).list()).toHaveLength(2);
  });
  function legacy(missing = false) {
    const store = new RunStore(root); const step = { status: 'pending' as const, completed_at: null, input_hash: null, error: null, raw_output: null };
    store.create('legacy'); store.writeText('legacy', 'job-posting.md', posting);
    store.writeManifest({ slug: 'legacy', title: 'Old', created: new Date().toISOString(), updated: new Date().toISOString(), runner: 'fake', model: 'fake', base_resume: missing ? 'missing' : 'template-base', state: 'draft', error: null, finalized_path: null, steps: { analysis: step, alignment: step, proposals: step, brief: step } });
    return store;
  }
  const analysis = { company: 'Company', role: 'Engineer', seniority: 'Senior', mission: 'Build systems', requirements: [{ id: 'r1', tier: 'must', text: 'Build systems', quote: 'build reliable distributed systems', terms: [] }], boilerplate: [] };
  function editable() {
    const store = legacy(); store.writeJson('legacy', 'analysis.json', analysis);
    const manifest = store.readManifest('legacy'); manifest.steps.analysis.status = 'done'; store.writeManifest(manifest);
    return { store, draft: orchestrator.getRun('legacy').draft! };
  }
  async function autosave(draft: any, payload: any) {
    const response = await app.request(`/api/tailoring-drafts/${draft.record.id}`, { ...body({ expected: draft.token, mutationId: randomUUID(), change: 'content', payload }), method: 'PUT' });
    expect(response.status).toBe(200); return response.json();
  }
  function apply(draft: any, operationId = randomUUID()) {
    return app.request(`/api/tailoring-drafts/${draft.record.id}/apply/analysis`, body({ expected: draft.token, artifactToken: draft.record.payload.artifactTokens.analysis ?? null, operationId }));
  }
  it('autosaves unfinished requirements without altering workflow and rejects invalid Apply', async () => {
    const { store, draft } = editable(); const before = store.readText('legacy', 'run.yaml');
    const payload = structuredClone(draft.record.payload); payload.analysis.requirements[0].text = '';
    const saved = await autosave(draft, payload);
    expect(store.readText('legacy', 'run.yaml')).toBe(before);
    expect(store.readJson('legacy', 'analysis.json', (raw) => raw)).toEqual(analysis);
    expect((await apply(saved)).status).toBe(422);
    expect(orchestrator.drafts.get(draft.record.id).record.appliedContent).toEqual(draft.record.appliedContent);
  });
  it('gates approval, generation, legacy save, and finalization on unapplied edits', async () => {
    const { draft } = editable(); const payload = structuredClone(draft.record.payload); payload.analysis.role = 'Edited';
    await autosave(draft, payload);
    expect(() => orchestrator.approveStep('legacy', 'analysis')).toThrow(/unapplied/i);
    await expect(orchestrator.startStep('legacy', 'analysis')).rejects.toThrow(/unapplied/i);
    expect(() => orchestrator.saveStep('legacy', 'analysis', analysis)).toThrow(/unapplied/i);
    expect(() => orchestrator.finalize('legacy')).toThrow(/unapplied/i);
  });
  it('applies atomically, advances artifact baseline, and replays the original acknowledgement', async () => {
    const { draft, store } = editable(); const payload = structuredClone(draft.record.payload); payload.analysis.role = 'Edited';
    expect(payload.artifactTokens.analysis.fingerprint).toBe(createHash('sha256').update(store.readText('legacy', 'analysis.json')!).digest('hex'));
    const saved = await autosave(draft, payload); const operationId = randomUUID();
    const response = await apply(saved, operationId); expect(response.status).toBe(200); const applied = await response.json();
    expect(applied.record.appliedContent.analysis.role).toBe('Edited');
    expect(applied.record.payload.analysis).toEqual(applied.record.appliedContent.analysis);
    expect((await (await apply(saved, operationId)).json())).toEqual(applied);
    expect(orchestrator.approveStep('legacy', 'analysis').manifest.steps.analysis.status).toBe('approved');
  });
  it('rejects Apply after an external artifact edit', async () => {
    const { draft, store } = editable(); const payload = structuredClone(draft.record.payload); payload.analysis.role = 'Edited';
    const saved = await autosave(draft, payload); store.writeJson('legacy', 'analysis.json', { ...analysis, role: 'External' });
    expect((await apply(saved)).status).toBe(409);
    expect(store.readJson('legacy', 'analysis.json', (raw: any) => raw.role)).toBe('External');
  });
  it('rejects workflow commands after a tracked artifact is edited externally', async () => {
    const { draft, store } = editable();
    const manifest = store.readManifest('legacy'); manifest.steps.proposals.status = 'approved'; store.writeManifest(manifest);
    store.writeText('legacy', 'resume.yaml', JSON.stringify(base));
    store.writeJson('legacy', 'analysis.json', { ...analysis, role: 'External role' });
    const before = store.readText('legacy', 'run.yaml');
    expect(() => orchestrator.approveStep('legacy', 'analysis')).toThrow(/artifact/i);
    await expect(orchestrator.startStep('legacy', 'analysis')).rejects.toMatchObject({ status: 409, code: 'artifact_conflict' });
    expect(() => orchestrator.saveStep('legacy', 'analysis', analysis)).toThrow(/artifact/i);
    expect(() => orchestrator.finalize('legacy')).toThrow(/artifact/i);
    expect(store.readText('legacy', 'run.yaml')).toBe(before);
    expect(orchestrator.drafts.get(draft.record.id)).toEqual(draft);
    expect(fs.existsSync(path.join(root, 'resumes/tailored/legacy.yaml'))).toBe(false);
  });
  it('rejects downstream Apply when an upstream artifact changed outside its tracked baseline', async () => {
    const store = legacy(); store.writeJson('legacy', 'analysis.json', analysis); store.writeJson('legacy', 'alignment.json', { rows: [] });
    const draft = orchestrator.getRun('legacy').draft!;
    if (draft.record.kind !== 'run') throw new Error('Expected run');
    store.writeJson('legacy', 'analysis.json', { ...analysis, role: 'External role' });
    const response = await app.request(`/api/tailoring-drafts/${draft.record.id}/apply/alignment`, body({ expected: draft.token, artifactToken: draft.record.payload.artifactTokens.alignment, operationId: randomUUID() }));
    expect(response.status).toBe(409); expect((await response.json()).code).toBe('artifact_conflict');
    expect(orchestrator.drafts.get(draft.record.id)).toEqual(draft);
  });
  it('rechecks tracked artifacts under ownership before approval publishes', () => {
    const { store, draft } = editable(); const before = store.readText('legacy', 'run.yaml');
    const write = orchestrator.store.writeManifest.bind(orchestrator.store);
    const spy = vi.spyOn(orchestrator.store, 'writeManifest').mockImplementationOnce((manifest) => {
      store.writeJson('legacy', 'analysis.json', { ...analysis, role: 'External role' });
      return write(manifest);
    });
    try { expect(() => orchestrator.approveStep('legacy', 'analysis')).toThrow(/artifact/i); }
    finally { spy.mockRestore(); }
    expect(store.readText('legacy', 'run.yaml')).toBe(before);
    expect(orchestrator.drafts.get(draft.record.id)).toEqual(draft);
  });
  it('does not publish generated output against an upstream artifact changed during generation', async () => {
    const { store, draft } = editable(); orchestrator.approveStep('legacy', 'analysis');
    let finish!: (value: unknown) => void; runner.enqueue(() => new Promise((resolve) => { finish = resolve; }));
    await orchestrator.startStep('legacy', 'alignment');
    store.writeJson('legacy', 'analysis.json', { ...analysis, role: 'External role' });
    finish({ rows: [] });
    await vi.waitFor(() => expect(store.readManifest('legacy').steps.alignment.status).toBe('error'));
    expect(store.readText('legacy', 'alignment.json')).toBeNull();
    expect(orchestrator.drafts.get(draft.record.id)).toEqual(draft);
  });
  it('does not overwrite a manifest changed after Apply reads it', async () => {
    const { draft, store } = editable(); const payload = structuredClone(draft.record.payload);
    if (!('analysis' in payload) || !payload.analysis) throw new Error('Expected analysis');
    payload.analysis.role = 'Edited'; const saved = await autosave(draft, payload);
    const read = orchestrator.store.readManifest.bind(orchestrator.store);
    const spy = vi.spyOn(orchestrator.store, 'readManifest').mockImplementationOnce((slug) => {
      const stale = read(slug); store.writeManifest({ ...stale, title: 'External title' }); return stale;
    });
    try { expect((await apply(saved)).status).toBe(409); }
    finally { spy.mockRestore(); }
    expect(store.readManifest('legacy').title).toBe('External title');
  });
  it('allows autosave during generation, blocks Apply, and publishes without resetting typing', async () => {
    const { draft } = editable(); let finish!: (value: unknown) => void;
    runner.enqueue(() => new Promise((resolve) => { finish = resolve; }));
    await orchestrator.startStep('legacy', 'analysis');
    const payload = structuredClone(draft.record.payload); payload.analysis.role = 'Still typing';
    payload.proposalTextById = { unfinished: '' };
    const saved = await autosave(draft, payload);
    expect((await apply(saved)).status).toBe(409);
    finish({ ...analysis, company: 'Generated company', role: 'Generated role' });
    await vi.waitFor(() => expect(orchestrator.getRun('legacy').manifest.steps.analysis.status).toBe('done'));
    const record = orchestrator.drafts.get(draft.record.id).record;
    expect(record.appliedContent.analysis?.role).toBe('Generated role');
    if (record.kind !== 'run') throw new Error('Expected run');
    expect(record.payload.analysis?.role).toBe('Still typing');
    expect(record.payload.analysis?.company).toBe('Generated company');
    expect(record.payload.proposalTextById).toEqual({ unfinished: '' });
  });
  it('legacy saves advance the matching applied baseline and tokens', () => {
    const { draft } = editable();
    orchestrator.saveStep('legacy', 'analysis', { ...analysis, role: 'Explicit edit' });
    const record = orchestrator.drafts.get(draft.record.id).record;
    expect(record.appliedContent.analysis?.role).toBe('Explicit edit');
    if (record.kind !== 'run') throw new Error('Expected run');
    expect(record.payload.analysis).toEqual(record.appliedContent.analysis);
    expect(record.payload.artifactTokens.analysis?.revision).toBe(1);
  });
  it('blocks legacy mutation while another server has marked a step running', () => {
    const { store } = editable(); const manifest = store.readManifest('legacy'); manifest.steps.alignment.status = 'running'; store.writeManifest(manifest);
    expect(() => orchestrator.saveStep('legacy', 'analysis', analysis)).toThrow(/running/i);
    expect(() => orchestrator.approveStep('legacy', 'analysis')).toThrow(/running/i);
  });
  it('blocks legacy explicit edits when no base can be captured', () => {
    const store = legacy(true); store.writeJson('legacy', 'analysis.json', analysis);
    const manifest = store.readManifest('legacy'); manifest.steps.analysis.status = 'done'; store.writeManifest(manifest);
    expect(() => orchestrator.saveStep('legacy', 'analysis', analysis)).toThrow(/base/i);
  });
  it('does not accept artifact token spoofing through recovery PUT', async () => {
    const { draft } = editable(); const payload = structuredClone(draft.record.payload);
    payload.artifactTokens.analysis = { revision: 999, fingerprint: 'spoof' };
    const saved = await autosave(draft, payload);
    expect(saved.record.payload.artifactTokens).toEqual(draft.record.kind === 'run' && draft.record.payload.artifactTokens);
  });
  it('rejects legacy save if recovery changes during validation', () => {
    const { draft, store } = editable(); const before = store.readText('legacy', 'analysis.json');
    const read = orchestrator.store.readText.bind(orchestrator.store); let raced = false;
    const spy = vi.spyOn(orchestrator.store, 'readText').mockImplementation((slug, file) => {
      if (!raced && file === 'job-posting.md') {
        raced = true;
        const current = orchestrator.drafts.get(draft.record.id);
        if (current.record.kind !== 'run') throw new Error('Expected run');
        orchestrator.drafts.save(draft.record.id, { expected: current.token, mutationId: randomUUID(), change: 'content', payload: { ...current.record.payload, analysis: { ...analysis, role: 'Other writer' } } });
      }
      return read(slug, file);
    });
    try { expect(() => orchestrator.saveStep('legacy', 'analysis', { ...analysis, role: 'Legacy writer' })).toThrow(); }
    finally { spy.mockRestore(); }
    expect(store.readText('legacy', 'analysis.json')).toBe(before);
  });
  it('checks approval again under artifact ownership if recovery changed after initial checks', () => {
    const { draft, store } = editable(); const before = store.readText('legacy', 'run.yaml');
    const read = orchestrator.store.writeManifest.bind(orchestrator.store);
    const spy = vi.spyOn(orchestrator.store, 'writeManifest').mockImplementationOnce((manifest) => {
      const current = orchestrator.drafts.get(draft.record.id);
      if (current.record.kind !== 'run') throw new Error('Expected run');
      orchestrator.drafts.save(draft.record.id, { expected: current.token, mutationId: randomUUID(), change: 'content', payload: { ...current.record.payload, analysis: { ...analysis, role: 'Other writer' } } });
      return read(manifest);
    });
    try { expect(() => orchestrator.approveStep('legacy', 'analysis')).toThrow(/unapplied/i); }
    finally { spy.mockRestore(); }
    expect(store.readText('legacy', 'run.yaml')).toBe(before);
  });
  it('adopts tokens for existing brief data as well as editable artifacts', () => {
    const store = legacy(); store.writeJson('legacy', 'brief.json', { sections: [] });
    const draft = orchestrator.getRun('legacy').draft!;
    if (draft.record.kind !== 'run') throw new Error('Expected run');
    expect(draft.record.payload.artifactTokens.brief?.fingerprint).toBe(createHash('sha256').update(store.readText('legacy', 'brief.json')!).digest('hex'));
  });
  it('publishes brief data, markdown, manifest, and token in one recoverable operation', async () => {
    const store = legacy(); store.writeJson('legacy', 'analysis.json', analysis); store.writeJson('legacy', 'alignment.json', { rows: [] }); store.writeJson('legacy', 'proposals.json', { proposals: [] });
    const draft = orchestrator.getRun('legacy').draft!;
    const manifest = store.readManifest('legacy'); manifest.steps.proposals.status = 'approved'; store.writeManifest(manifest);
    runner.enqueue({}); await orchestrator.startStep('legacy', 'brief');
    await vi.waitFor(() => expect(store.readManifest('legacy').steps.brief.status).toBe('done'));
    const record = orchestrator.drafts.get(draft.record.id).record;
    if (record.kind !== 'run') throw new Error('Expected run');
    expect(record.payload.artifactTokens.brief?.fingerprint).toBe(createHash('sha256').update(store.readText('legacy', 'brief.json')!).digest('hex'));
    const operations = fs.readdirSync(path.join(root, 'tailoring-drafts/operations', record.id)).map((file) => JSON.parse(fs.readFileSync(path.join(root, 'tailoring-drafts/operations', record.id, file), 'utf8')));
    expect(operations.some((intent) => intent.operation.writes.some((write: any) => write.path.endsWith('/brief.md')) && intent.operation.writes.some((write: any) => write.path.endsWith('/run.yaml')))).toBe(true);
  });
  it('initializes missing tokens on already associated runs without erasing recovery fields', async () => {
    const setupDraft = await setup();
    const created = await (await app.request(`/api/tailoring-drafts/${setupDraft.record.id}/create-run`, body({ expected: setupDraft.token, operationId: randomUUID() }))).json();
    const store = new RunStore(root); store.writeJson(created.slug, 'analysis.json', analysis);
    const payload = { ...created.record.payload, analysis: { ...analysis, role: 'Recovered typing' } };
    await autosave(created, payload);
    const draft = orchestrator.getRun(created.slug).draft!;
    expect(draft.record.appliedContent.analysis?.role).toBe('Engineer');
    if (draft.record.kind !== 'run') throw new Error('Expected run');
    expect(draft.record.payload.analysis?.role).toBe('Recovered typing');
    expect(draft.record.payload.artifactTokens.analysis).toBeDefined();
  });
  it('rejects generation if draft changes while runner availability is awaited', async () => {
    const { draft, store } = editable();
    const detect = vi.spyOn(runner, 'detect').mockImplementation(async () => {
      const current = orchestrator.drafts.get(draft.record.id);
      if (current.record.kind !== 'run') throw new Error('Expected run');
      orchestrator.drafts.save(draft.record.id, { expected: current.token, mutationId: randomUUID(), change: 'content', payload: { ...current.record.payload, analysis: { ...analysis, role: 'Raced' } } });
      return { available: true, detail: 'Fake runner' };
    });
    try { await expect(orchestrator.startStep('legacy', 'analysis')).rejects.toThrow(/unapplied/i); }
    finally { detect.mockRestore(); }
    expect(store.readManifest('legacy').steps.analysis.status).toBe('done');
    expect(runner.requests).toHaveLength(0);
  });
  it('rejects generation if an applied input changes while runner availability is awaited', async () => {
    const { store } = editable(); orchestrator.approveStep('legacy', 'analysis');
    const detect = vi.spyOn(runner, 'detect').mockImplementation(async () => {
      orchestrator.saveStep('legacy', 'analysis', { ...analysis, role: 'Different applied input' });
      return { available: true, detail: 'Fake runner' };
    });
    try { await expect(orchestrator.startStep('legacy', 'alignment')).rejects.toMatchObject({ status: 409 }); }
    finally { detect.mockRestore(); }
    expect(store.readManifest('legacy').steps.alignment.status).toBe('pending');
    expect(runner.requests).toHaveLength(0);
  });
  function proposalDraft() {
    const store = legacy(); store.writeJson('legacy', 'analysis.json', analysis); store.writeJson('legacy', 'alignment.json', { rows: [] });
    store.writeJson('legacy', 'proposals.json', { proposals: [{ id: 'p1', type: 'summary.rewrite', target: {}, after: 'Generated summary', decision: 'accepted', override: true }] });
    return { store, draft: orchestrator.getRun('legacy').draft! };
  }
  async function applyProposalsDraft(draft: any, operationId = randomUUID()) {
    return app.request(`/api/tailoring-drafts/${draft.record.id}/apply/proposals`, body({ expected: draft.token, artifactToken: draft.record.payload.artifactTokens.proposals, operationId }));
  }
  it('consumes valid inline proposal text explicitly while retaining candidate override semantics', async () => {
    const { draft } = proposalDraft();
    if (draft.record.kind !== 'run') throw new Error('Expected run');
    const saved = await autosave(draft, { ...draft.record.payload, proposalTextById: { p1: 'My rewritten summary' } });
    const response = await applyProposalsDraft(saved); expect(response.status).toBe(200);
    const applied = await response.json();
    expect(applied.record.payload.proposalTextById).toEqual({});
    expect(applied.record.appliedContent.proposals.proposals[0]).toMatchObject({ edited_after: 'My rewritten summary', override: true });
    expect(orchestrator.approveStep('legacy', 'proposals').resume?.summary).toBe('My rewritten summary');
  });
  it('preserves unfinished inline text when Apply is invalid', async () => {
    const { draft, store } = proposalDraft(); if (draft.record.kind !== 'run') throw new Error('Expected run');
    const original = store.readText('legacy', 'proposals.json');
    const saved = await autosave(draft, { ...draft.record.payload, proposalTextById: { p1: '' } });
    expect((await applyProposalsDraft(saved)).status).toBe(422);
    expect(store.readText('legacy', 'proposals.json')).toBe(original);
    expect(orchestrator.drafts.get(draft.record.id).record).toEqual(saved.record);
  });
  it('updates applied baseline only after durable publication and retries an interrupted Apply', async () => {
    const { draft } = proposalDraft(); if (draft.record.kind !== 'run') throw new Error('Expected run');
    const saved = await autosave(draft, { ...draft.record.payload, proposalTextById: { p1: 'Recover this edit' } });
    const operationId = randomUUID();
    const broken = new DraftOperationRunner(root, orchestrator.drafts.repository, { checkpoint: (point) => { if (point === 'after-write:0') throw new Error('simulated crash'); } });
    const spy = vi.spyOn(orchestrator.drafts.operations, 'execute').mockImplementationOnce((operation) => broken.execute(operation));
    try { expect((await applyProposalsDraft(saved, operationId)).status).toBe(500); }
    finally { spy.mockRestore(); }
    expect(orchestrator.drafts.get(draft.record.id).record).toEqual(saved.record);
    const retry = await applyProposalsDraft(saved, operationId); expect(retry.status).toBe(200);
    const applied = await retry.json(); expect(applied.record.payload.proposalTextById).toEqual({});
    expect(applied.record.appliedContent.proposals.proposals[0].edited_after).toBe('Recover this edit');
    expect(await (await applyProposalsDraft(saved, operationId)).json()).toEqual(applied);
  });
  it('leaves interrupted generation publication recoverable without a rejected background task', async () => {
    const { draft, store } = editable(); let rejection: unknown; let settled = false;
    const execute = (orchestrator as any).execute.bind(orchestrator);
    const background = vi.spyOn(orchestrator as any, 'execute').mockImplementation(async (...args: unknown[]) => {
      try { await execute(...args); } catch (error) { rejection = error; } finally { settled = true; }
    });
    const broken = new DraftOperationRunner(root, orchestrator.drafts.repository, { checkpoint: (point) => { if (point === 'after-write:0') throw new Error('simulated crash'); } });
    const publication = vi.spyOn(orchestrator.drafts.operations, 'execute').mockImplementationOnce((operation) => broken.execute(operation));
    runner.enqueue({ ...analysis, role: 'Generated output' });
    try {
      await orchestrator.startStep('legacy', 'analysis');
      await vi.waitFor(() => expect(settled).toBe(true));
      expect(rejection).toBeUndefined();
    } finally { background.mockRestore(); publication.mockRestore(); }
    expect(orchestrator.drafts.get(draft.record.id).record.appliedContent).toEqual(draft.record.appliedContent);
    orchestrator.drafts.recover();
    expect(store.readManifest('legacy').steps.analysis.status).toBe('done');
    expect(orchestrator.drafts.get(draft.record.id).record.appliedContent.analysis?.role).toBe('Generated output');
  });
  it('lazily adopts legacy artifacts once and exposes the historical base notice', () => {
    const store = legacy(); const original = store.readText('legacy', 'job-posting.md');
    store.writeJson('legacy', 'proposals.json', { proposals: [] });
    const manifest = store.readManifest('legacy'); manifest.steps.proposals.status = 'done'; store.writeManifest(manifest);
    const first = orchestrator.getRun('legacy'); const second = orchestrator.getRun('legacy');
    expect(first.draft?.record.id).toBeTruthy(); expect(second.draft?.record.id).toBe(first.draft?.record.id);
    expect(first.draft?.record.appliedContent.proposals).toEqual({ proposals: [] });
    expect(first.manifest.steps.proposals.status).toBe('stale');
    expect(first.base_notice).toMatch(/historical/i); expect(first.base_resume).toEqual(base);
    expect(store.readText('legacy', 'job-posting.md')).toBe(original);
  });
  it('keeps missing legacy bases readable and blocks dependent commands', () => {
    legacy(true); const result = orchestrator.getRun('legacy');
    expect(result.base_resume).toBeNull(); expect(result.base_notice).toMatch(/missing/i);
    expect(result.draft).toBeUndefined();
    expect(() => orchestrator.previewInput('legacy', 'analysis')).toThrow(/base/i);
  });
  it('uses the captured base for prompts and applying proposals after source replacement', async () => {
    const draft = await setup();
    const created = await (await app.request(`/api/tailoring-drafts/${draft.record.id}/create-run`, body({ expected: draft.token, operationId: randomUUID() }))).json();
    fs.writeFileSync(path.join(root, 'resumes/templates/base.json'), JSON.stringify({ ...base, summary: 'Changed live summary', profile: { ...base.profile, name: 'Different person' } }));
    const store = new RunStore(root); const manifest = store.readManifest(created.slug);
    store.writeJson(created.slug, 'analysis.json', { company: 'Company', role: 'Engineer', seniority: 'Senior', mission: 'Build systems', requirements: [], boilerplate: [] });
    manifest.steps.analysis.status = 'approved'; store.writeManifest(manifest);
    store.writeJson(created.slug, 'alignment.json', { rows: [] });
    manifest.steps.alignment.status = 'approved'; store.writeManifest(manifest);
    expect(orchestrator.previewInput(created.slug, 'proposals').prompt).toContain(base.summary);
    expect(orchestrator.previewInput(created.slug, 'proposals').prompt).not.toContain('Changed live summary');
    store.writeJson(created.slug, 'proposals.json', { proposals: [] });
    manifest.steps.proposals.status = 'done'; store.writeManifest(manifest);
    const result = orchestrator.approveStep(created.slug, 'proposals');
    expect(result.resume).toEqual(base);
  });
  it('does not repair a declared missing draft association', () => {
    const store = legacy(); const manifest = store.readManifest('legacy'); manifest.draft_id = randomUUID(); store.writeManifest(manifest);
    expect(() => orchestrator.getRun('legacy')).toThrow();
    expect(store.readManifest('legacy').draft_id).toBe(manifest.draft_id);
  });
  it('does not mutate a run under an unresolved draft intent during recovery or commands', async () => {
    const draft = await setup();
    const created = await (await app.request(`/api/tailoring-drafts/${draft.record.id}/create-run`, body({ expected: draft.token, operationId: randomUUID() }))).json();
    const store = new RunStore(root); const manifest = store.readManifest(created.slug); manifest.steps.analysis.status = 'running'; manifest.steps.proposals.status = 'approved'; store.writeManifest(manifest);
    store.writeText(created.slug, 'resume.yaml', JSON.stringify(base));
    const before = store.readText(created.slug, 'run.yaml');
    const directory = path.join(root, 'tailoring-drafts/operations', draft.record.id);
    fs.writeFileSync(path.join(directory, `${randomUUID()}.json`), '{');
    createApp(root, { runnerFactory: () => new FakeRunner([]) });
    expect(store.readText(created.slug, 'run.yaml')).toBe(before);
    expect(() => orchestrator.store.writeText(created.slug, 'job-posting.md', 'destructive replacement')).toThrow(/operation|intent/i);
    expect(store.readText(created.slug, 'job-posting.md')).toContain(posting);
    await expect(orchestrator.startStep(created.slug, 'analysis')).rejects.toMatchObject({ code: 'pending_operation' });
    await expect(orchestrator.startStep(created.slug, 'analysis')).rejects.toMatchObject({ code: 'pending_operation' });
    expect(() => orchestrator.finalize(created.slug)).toThrow(/operation|intent/i);
    expect(fs.existsSync(path.join(root, 'resumes/tailored', `${created.slug}.yaml`))).toBe(false);
  });

  it('reserves legacy slugs held by an interrupted prepared intent without a run directory', async () => {
    const draft = await setup(); const operationId = randomUUID();
    const runner = new DraftOperationRunner(root, new DraftRepository(root), { checkpoint: (point) => { if (point === 'after-prepare') throw new Error('crash'); } });
    expect(() => runner.execute({ operationId, draftId: draft.record.id, command: 'create-run', expected: draft.token, next: { ...draft.record, kind: 'run', runSlug: 'same-label', originSetup: draft.record.payload, payload: { proposalTextById: {}, artifactTokens: {} } }, writes: [{ path: 'tailoring/same-label/run.yaml', expectedHash: null, content: '{}' }], result: { slug: 'same-label' } })).toThrow('crash');
    expect(fs.existsSync(path.join(root, 'tailoring/same-label/run.yaml'))).toBe(false);
    // Artifact locking may create an empty directory; remove only that empty directory to emulate a pre-write crash.
    // The journal remains the authoritative reservation even when a directory is absent.
    const reserved = path.join(root, 'tailoring/same-label');
    if (fs.existsSync(reserved)) fs.renameSync(reserved, path.join(root, 'reserved-lock-fixture'));
    const created = orchestrator.createRun({ posting, base_resume: 'template-base', runner: 'fake', label: 'Same label' });
    expect(created.slug).toBe('same-label-2');
  });

  it('preserves old artifact bytes when atomic replacement fails', () => {
    const store = legacy(); const original = store.readText('legacy', 'job-posting.md');
    const replace = vi.spyOn(fs, 'renameSync').mockImplementation(() => { throw new Error('replacement denied'); });
    try { expect(() => store.writeText('legacy', 'job-posting.md', 'replacement')).toThrow('replacement denied'); }
    finally { replace.mockRestore(); }
    expect(store.readText('legacy', 'job-posting.md')).toBe(original);
  });

  it('protects unassociated legacy manifests reserved by conflicted adoption while healthy runs recover', async () => {
    const store = legacy(); const manifest = store.readManifest('legacy');
    manifest.steps.analysis.status = 'running'; store.writeManifest(manifest);
    store.create('healthy'); store.writeManifest({ ...manifest, slug: 'healthy' });
    const draft = await setup(); const operationId = randomUUID();
    const original = store.readText('legacy', 'run.yaml')!;
    const runner = new DraftOperationRunner(root, new DraftRepository(root), { checkpoint: (point) => { if (point === 'after-prepare') throw new Error('crash'); } });
    expect(() => runner.execute({ operationId, draftId: draft.record.id, command: 'create-run', expected: draft.token,
      next: { ...draft.record, kind: 'run', runSlug: 'legacy', originSetup: draft.record.payload, payload: { proposalTextById: {}, artifactTokens: {} } },
      request: 'legacy-adoption', writes: [{ path: 'tailoring/legacy/run.yaml', expectedHash: createHash('sha256').update(original).digest('hex'), content: JSON.stringify({ ...manifest, draft_id: draft.record.id }) }], result: { slug: 'legacy' },
    })).toThrow('crash');
    store.writeManifest({ ...manifest, title: 'External edit after prepared adoption' });
    const before = store.readText('legacy', 'run.yaml');
    const restarted = createApp(root, { runnerFactory: () => new FakeRunner([]), onOrchestrator: (value) => { orchestrator = value; } });
    expect(store.readText('legacy', 'run.yaml')).toBe(before);
    expect(store.readManifest('healthy').steps.analysis.error).toMatch(/Interrupted/);
    expect(() => orchestrator.store.writeText('legacy', 'job-posting.md', 'replacement')).toThrow(/operation|intent/i);
    const recovery = await (await restarted.request('/api/tailoring-drafts')).json();
    expect(recovery.recoveryErrors.some((item: { id: string }) => item.id === operationId)).toBe(true);
  });

  it.each(['prepared', 'committed'] as const)('rejects a stale writer when adoption becomes %s after the pre-lock guard', async (phase) => {
    const store = legacy(); const manifest = store.readManifest('legacy'); const original = store.readText('legacy', 'run.yaml')!;
    const draft = await setup(); const operationId = randomUUID();
    const associated = JSON.stringify({ ...manifest, draft_id: draft.record.id });
    const runner = new DraftOperationRunner(root, new DraftRepository(root), { checkpoint: (point) => { if (phase === 'prepared' && point === 'after-prepare') throw new Error('crash'); } });
    const read = orchestrator.store.readManifest.bind(orchestrator.store);
    const spy = vi.spyOn(orchestrator.store, 'readManifest').mockImplementationOnce((slug) => {
      const observed = read(slug);
      try { runner.execute({ operationId, draftId: draft.record.id, command: 'create-run', expected: draft.token,
        next: { ...draft.record, kind: 'run', runSlug: 'legacy', originSetup: draft.record.payload, payload: { proposalTextById: {}, artifactTokens: {} } },
        request: 'legacy-adoption', writes: [{ path: 'tailoring/legacy/run.yaml', expectedHash: createHash('sha256').update(original).digest('hex'), content: associated }], result: { slug: 'legacy' },
      }); } catch (error) { if ((error as Error).message !== 'crash') throw error; }
      return observed;
    });
    try { expect(() => orchestrator.store.writeManifest({ ...manifest, title: 'Stale writer' })).toThrow(/operation|association/i); }
    finally { spy.mockRestore(); }
    expect(store.readText('legacy', 'run.yaml')).toBe(phase === 'prepared' ? original : associated);
  });
  it('rejects an old manifest after completed adoption is already visible to the guard', async () => {
    const store = legacy(); const stale = store.readManifest('legacy');
    const adopted = orchestrator.getRun('legacy'); const before = store.readText('legacy', 'run.yaml');
    expect(adopted.manifest.draft_id).toBeTruthy();
    expect(() => orchestrator.store.writeManifest(stale)).toThrow(/association/i);
    expect(store.readText('legacy', 'run.yaml')).toBe(before);
  });

});
