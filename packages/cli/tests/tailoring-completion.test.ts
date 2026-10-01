import { beforeEach, afterEach, describe, it, expect, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
import { createApp } from '../src/server.js';
import { RunStore } from '../src/tailoring/store.js';
import yaml from 'js-yaml';
import { DraftOperationRunner } from '../src/tailoring/drafts/operations.js';
import type { TailoringOrchestrator } from '../src/tailoring/orchestrator.js';
import { manualFromSpec } from '../../ui/src/tailoring-drafts/manual-model.js';
const body = (value: unknown, method = 'POST') => ({ method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(value) });
describe('immutable tailoring completion', () => {
  let root: string, app: ReturnType<typeof createApp>, orchestrator: TailoringOrchestrator;
  beforeEach(() => { root = fs.mkdtempSync(path.join(os.tmpdir(), 'completion-')); app = createApp(root, { onOrchestrator: value => { orchestrator = value; } }); });
  afterEach(() => { vi.restoreAllMocks(); fs.rmSync(root, { recursive: true, force: true }); });
  async function manual() {
    const resumes = await (await app.request('/api/resumes')).json();
    const payload = manualFromSpec(resumes[0].spec, resumes[0].id, randomUUID);
    payload.experiences[0].bullets[0].included = false;
    return (await app.request('/api/tailoring-drafts', body({ record: { id: randomUUID(), kind: 'manual', payload }, mutationId: randomUUID() }))).json();
  }
  const complete = (draft: any, operationId = randomUUID()) => app.request(`/api/tailoring-drafts/${draft.record.id}/complete`, body({ expected: draft.token, operationId, name: 'My version', type: 'tailored' }));
  it('does not mark complete on failed output persistence and retries the same output', async () => {
    const draft = await manual(), operationId = randomUUID();
    const broken = new DraftOperationRunner(root, orchestrator.drafts.repository, { checkpoint: point => { if (point === 'after-write:0') throw Error('disk failure'); } });
    const spy = vi.spyOn(orchestrator.drafts.operations, 'execute').mockImplementationOnce(operation => broken.execute(operation));
    expect((await complete(draft, operationId)).status).toBe(500); spy.mockRestore();
    expect(orchestrator.drafts.get(draft.record.id).record.lifecycle).toBe('draft');
    const response = await complete(draft, operationId); expect(response.status, await response.clone().text()).toBe(200);
    const done = await response.json(); expect(done.record.lifecycle).toBe('completed');
    expect(await (await complete(draft, operationId)).json()).toEqual(done);
    expect(fs.existsSync(path.join(root, done.completion.path))).toBe(true);
  });
  it('continues full manual content independently and never rewrites completed snapshot/output', async () => {
    const draft = await manual(); const response = await complete(draft); expect(response.status, await response.clone().text()).toBe(200);
    const done = await response.json();
    const snapshotPath = `tailoring-drafts/completions/${done.completion.outputId}.json`;
    const hash = (file: string) => createHash('sha256').update(fs.readFileSync(path.join(root, file))).digest('hex');
    const before = [hash(snapshotPath), hash(done.completion.path)];
    const request = { expected: done.token, operationId: randomUUID() };
    const continuation = await app.request(`/api/tailoring-drafts/${draft.record.id}/continue`, body(request)); expect(continuation.status).toBe(200);
    const next = await continuation.json(); expect(next.record.payload).toEqual(draft.record.payload);
    expect(next.record.parentCompletionId).toBe(done.completion.outputId); expect(next.record.id).not.toBe(draft.record.id);
    expect(await (await app.request(`/api/tailoring-drafts/${draft.record.id}/continue`, body(request))).json()).toEqual(next);
    const saved = await (await app.request(`/api/tailoring-drafts/${next.record.id}`, body({ expected: next.token, mutationId: randomUUID(), change: 'content', payload: { ...next.record.payload, summary: 'Independent changes' } }, 'PUT'))).json();
    const second = await (await complete(saved)).json(); expect(second.completion.path).not.toBe(done.completion.path);
    expect([hash(snapshotPath), hash(done.completion.path)]).toEqual(before);
    const overwrite = await app.request('/api/resumes', body({ name: path.basename(done.completion.path, '.yaml'), type: 'tailored', spec: second.completion.spec })); expect(overwrite.status).toBe(409);
    expect((await app.request('/api/resumes', body({ name: 'Ordinary resume', spec: second.completion.spec }))).status).toBe(200);
  });
  async function run(finalized = false, missing = false) {
    const resumes = await (await app.request('/api/resumes')).json();
    const store = new RunStore(root), now = new Date().toISOString();
    const step = { status: 'approved' as const, completed_at: now, input_hash: null, error: null, raw_output: null };
    store.create('legacy'); store.writeText('legacy', 'job-posting.md', 'Build systems');
    store.writeJson('legacy', 'analysis.json', { company: 'Test', role: 'Engineer', seniority: 'Senior', mission: 'Build', requirements: [], boilerplate: [] });
    store.writeJson('legacy', 'alignment.json', { rows: [] });
    store.writeJson('legacy', 'proposals.json', { proposals: [] });
    store.writeText('legacy', 'resume.yaml', yaml.dump(resumes[0].spec));
    store.writeText('legacy', 'brief.md', 'Historical brief bytes');
    store.writeManifest({ slug: 'legacy', title: 'Old', created: now, updated: now, runner: 'fake', model: 'fake', base_resume: resumes[0].id, state: 'draft', error: null, finalized_path: finalized ? 'resumes/tailored/historical.yaml' : null, steps: { analysis: step, alignment: step, proposals: step, brief: { ...step, status: 'pending' } } });
    if (finalized && !missing) { fs.mkdirSync(path.join(root, 'resumes/tailored'), { recursive: true }); fs.writeFileSync(path.join(root, 'resumes/tailored/historical.yaml'), yaml.dump(resumes[0].spec)); }
    return { store, spec: resumes[0].spec };
  }
  it('finalizes through existing gates, continues copied approvals under a new slug and protects old bytes', async () => {
    const { store } = await run(); let draft = orchestrator.getRun('legacy').draft!;
    expect(draft.record.lifecycle).toBe('draft');
    expect(() => orchestrator.finalize('legacy')).toThrow(/approve/i);
    orchestrator.saveStep('legacy', 'proposals', { proposals: [] });
    orchestrator.approveStep('legacy', 'proposals'); draft = orchestrator.drafts.get(draft.record.id);
    const result = await complete(draft); expect(result.status, await result.clone().text()).toBe(200);
    const done = await result.json(); expect(done.completion.runArtifacts.manifest.steps.proposals.status).toBe('approved');
    const bytes = fs.readFileSync(path.join(root, done.completion.path));
    const next = orchestrator.drafts.continue(done.record.id, done.token, randomUUID());
    expect(next.record.runSlug).not.toBe('legacy');
    expect(store.readText(next.record.runSlug!, 'brief.md')).toBe('Historical brief bytes');
    expect(store.readManifest(next.record.runSlug!).steps.proposals.status).toBe('approved');
    expect(orchestrator.finalize('legacy').filePath).toBe(done.completion.path);
    orchestrator.saveStep(next.record.runSlug!, 'proposals', { proposals: [] });
    expect(store.readManifest(next.record.runSlug!).steps.proposals.status).not.toBe('approved');
    orchestrator.approveStep(next.record.runSlug!, 'proposals'); orchestrator.finalize(next.record.runSlug!);
    expect(fs.readFileSync(path.join(root, done.completion.path))).toEqual(bytes);
  });
  it('establishes legacy completion from finalized_path and reports missing output', async () => {
    await run(true);
    const done = orchestrator.getRun('legacy').draft!; expect(done.record.lifecycle).toBe('completed');
    expect(done.record.completion!.path).toBe('resumes/tailored/historical.yaml');
    expect(orchestrator.drafts.continue(done.record.id, done.token, randomUUID()).record.parentCompletionId).toBe(done.record.completion!.outputId);
  });
  it('never fabricates a missing finalized output from run resume.yaml', async () => {
    await run(true, true);
    expect(() => orchestrator.getRun('legacy')).toThrow(/missing.*output|output.*missing/i);
  });

  it('keeps display names and template type independently of collision-resistant output filenames', async () => {
    const draft = await manual();
    const result = await app.request(`/api/tailoring-drafts/${draft.record.id}/complete`, body({ expected: draft.token, operationId: randomUUID(), name: 'My Template Display Name', type: 'template' }));
    expect(result.status).toBe(200); const done = await result.json();
    expect(done.completion.type).toBe('template');
    const resumes = await (await app.request('/api/resumes')).json();
    expect(resumes.find((resume: any) => resume.filePath === done.completion.path)).toMatchObject({ name: 'My Template Display Name', type: 'template' });
  });
  it('returns exact complete and continue receipts after snapshot and output deletion', async () => {
    const draft = await manual(), operationId = randomUUID(); const done = await (await complete(draft, operationId)).json();
    const continueId = randomUUID(); const next = orchestrator.drafts.continue(done.record.id, done.token, continueId);
    fs.unlinkSync(path.join(root, done.completion.path)); fs.unlinkSync(path.join(root, `tailoring-drafts/completions/${done.completion.outputId}.json`));
    expect(await (await complete(draft, operationId)).json()).toEqual(done);
    expect(orchestrator.drafts.continue(done.record.id, done.token, continueId)).toEqual(next);
  });
  it('blocks inherited finalization after changed analysis is saved and applied', async () => {
    await run(true); const done = orchestrator.getRun('legacy').draft!;
    const next = orchestrator.drafts.continue(done.record.id, done.token, randomUUID());
    if (next.record.kind !== 'run') throw Error('Expected run');
    const saved = orchestrator.drafts.save(next.record.id, { expected: next.token, mutationId: randomUUID(), change: 'content', payload: { ...next.record.payload, analysis: { ...next.record.payload.analysis!, role: 'Changed role' } } });
    expect(() => orchestrator.finalize(next.record.runSlug!)).toThrow(/unapplied/i);
    orchestrator.applyDraft(next.record.id, { expected: saved.token, operationId: randomUUID(), step: 'analysis', artifactToken: next.record.payload.artifactTokens.analysis! });
    expect(new RunStore(root).readManifest(next.record.runSlug!).steps.proposals.status).toBe('stale');
    expect(() => orchestrator.finalize(next.record.runSlug!)).toThrow(/approve/i);
  });
  it('rejects artifact changes during completion preparation instead of publishing stale output', async () => {
    const { store } = await run(); orchestrator.getRun('legacy'); orchestrator.saveStep('legacy', 'proposals', { proposals: [] }); orchestrator.approveStep('legacy', 'proposals');
    const draft = orchestrator.getRun('legacy').draft!;
    const original = orchestrator.drafts.prepareCompletion!;
    orchestrator.drafts.prepareCompletion = slug => { const result = original(slug); store.writeText(slug, 'resume.yaml', yaml.dump({ ...result.spec, summary: 'External replacement' })); return result; };
    expect(() => orchestrator.drafts.complete(draft.record.id, draft.token, randomUUID())).toThrow(/changed|conflict/i);
    expect(orchestrator.drafts.get(draft.record.id).record.lifecycle).toBe('draft');
  });

  it('rejects direct mutation of completed run artifacts', async () => {
    await run(true); orchestrator.getRun('legacy');
    expect(() => orchestrator.store.writeText('legacy', 'resume.yaml', 'replacement')).toThrow(/completed|inactive/i);
  });
  it('validates completion snapshot ownership before journaling writes', async () => {
    const draft = await manual();
    expect(() => orchestrator.drafts.operations.execute({ operationId: randomUUID(), draftId: draft.record.id, command: 'sync', expected: draft.token, next: draft.record,
      writes: [{ path: `tailoring-drafts/completions/${randomUUID()}.json`, expectedHash: null, content: '{}' }], result: {} })).toThrow(/snapshot|completion/i);
  });

});
