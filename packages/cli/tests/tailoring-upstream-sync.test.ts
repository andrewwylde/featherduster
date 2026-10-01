import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { createApp } from '../src/server.js';
import { FakeRunner } from '../src/runners/fake.js';
import { applyProposals, compileLatexResume } from '@featherduster/core';
import type { TailoringOrchestrator } from '../src/tailoring/orchestrator.js';

const base = { profile: { name: 'Person', title: 'Engineer', email: 'a@b.com' }, summary: 'Original', experiences: [{ company: 'Company', role: 'Engineer', startDate: '2020', endDate: 'Now', bullets: [{ text: 'Original bullet' }] }], education: [], skills: [] };
const body = (data: unknown) => ({ method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(data) });
describe('upstream draft sync', () => {
  let root: string, source: string, app: ReturnType<typeof createApp>, orchestrator: TailoringOrchestrator, runner: FakeRunner;
  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'upstream-sync-')); source = path.join(root, 'resumes/templates/base.json');
    fs.mkdirSync(path.dirname(source), { recursive: true }); fs.writeFileSync(source, JSON.stringify(base));
    runner = new FakeRunner([]);
    app = createApp(root, { runnerFactory: () => runner, onOrchestrator: value => { orchestrator = value; } });
  });
  afterEach(() => fs.rmSync(root, { recursive: true, force: true }));
  async function manual(selectedResumeId = 'template-base') {
    const payload = { ...base, experiences: base.experiences.map(e => ({ ...e, id: 'experience-local', bullets: e.bullets.map(b => ({ ...b, id: 'bullet-local', included: false })) })), summary: 'Tailored', jobDescription: 'Posting', selectedResumeId, squeezeMode: true };
    return (await app.request('/api/tailoring-drafts', body({ record: { id: randomUUID(), kind: 'manual', payload }, mutationId: randomUUID() }))).json();
  }
  async function preview(draft: any) { return app.request(`/api/tailoring-drafts/${draft.record.id}/sync-preview`, body({ expected: draft.token })); }
  async function sync(draft: any, fingerprint: string, operationId = randomUUID(), resolutions = {}) { return app.request(`/api/tailoring-drafts/${draft.record.id}/sync`, body({ expected: draft.token, upstreamFingerprint: fingerprint, operationId, resolutions })); }
  const changed = () => fs.writeFileSync(source, JSON.stringify({ ...base, profile: { ...base.profile, title: 'Upstream title' } }));
  it.each(['md', 'tex'])('syncs a real %s resume import from a nested folder with a spaced filename', async extension => {
    const imported = path.join(root, 'resumes/templates/Nested folder/My Base Resume.' + extension);
    fs.mkdirSync(path.dirname(imported), { recursive: true });
    const encode = (spec: typeof base) => extension === 'tex' ? compileLatexResume(spec) : JSON.stringify(spec);
    fs.writeFileSync(imported, encode(base));
    const draft = await manual('template-My Base Resume'); expect(draft.record.kind).toBe('manual');
    const content = encode({ ...base, summary: 'Updated imported summary' }); fs.writeFileSync(imported, content);
    const response = await preview(draft); expect(response.status, await response.clone().text()).toBe(200); const p = await response.json();
    const choices = Object.fromEntries(p.conflicts.map((conflict: any) => [conflict.id, 'upstream']));
    const synced = await sync(draft, p.upstreamFingerprint, randomUUID(), choices); expect(synced.status, await synced.clone().text()).toBe(200);
    expect((await synced.json()).record.base.spec.summary).toBe('Updated imported summary');
    expect(fs.readFileSync(imported, 'utf8')).toBe(content);
  });
  it('previews without writes; cancel preserves draft; sync keeps excluded bullets and local metadata', async () => {
    const draft = await manual(); changed();
    const response = await preview(draft); expect(response.status, await response.clone().text()).toBe(200); const p = await response.json();
    expect(orchestrator.drafts.get(draft.record.id)).toEqual({ record: draft.record, token: draft.token });
    const committed = await sync(draft, p.upstreamFingerprint); expect(committed.status).toBe(200); const result = await committed.json();
    expect(result.record.payload.summary).toBe('Tailored'); expect(result.record.payload.profile.title).toBe('Upstream title');
    expect(result.record.payload.experiences[0].bullets[0]).toEqual({ id: 'bullet-local', text: 'Original bullet', included: false });
    expect(result.record.payload.jobDescription).toBe('Posting'); expect(result.record.payload.squeezeMode).toBe(true);
    expect(result.record.base.spec.summary).toBe('Original');
  });
  it('rejects changed upstream after preview and retries a committed sync after deletion', async () => {
    const draft = await manual(); changed(); const p = await (await preview(draft)).json();
    fs.writeFileSync(source, JSON.stringify({ ...base, summary: 'New source' }));
    expect((await sync(draft, p.upstreamFingerprint)).status).toBe(409);
    changed(); const operation = randomUUID(); const result = await (await sync(draft, p.upstreamFingerprint, operation)).json(); fs.unlinkSync(source);
    expect(await (await sync(draft, p.upstreamFingerprint, operation)).json()).toEqual(result);
    const status = await (await app.request(`/api/tailoring-drafts/${draft.record.id}/upstream`)).json(); expect(status.missing).toBe(true);
    expect((await preview(result)).status).toBe(409);
  });
  async function run() {
    const setup = await (await app.request('/api/tailoring-drafts', body({ record: { id: randomUUID(), kind: 'setup', payload: { posting: 'Build reliable distributed systems', label: 'Run', baseResumeId: 'template-base', runner: 'fake' } }, mutationId: randomUUID() }))).json();
    return (await app.request(`/api/tailoring-drafts/${setup.record.id}/create-run`, body({ expected: setup.token, operationId: randomUUID() }))).json();
  }
  async function save(draft: any, payload: any) { return (await app.request(`/api/tailoring-drafts/${draft.record.id}`, { ...body({ expected: draft.token, mutationId: randomUUID(), change: 'content', payload }), method: 'PUT' })).json(); }
  const proposal = (id: string, type: string, after: string) => ({ id, type, after, before: type === 'bullet.rewrite' ? 'Original bullet' : '', target: { experience_index: 0, bullet_index: type === 'bullet.add' ? -1 : 0, skill_group_index: -1 }, order: [], skills: [], citations: [], requirement_ids: [], rationale: 'Reason', decision: 'accepted', checks: [] });
  it('pins actual upstream and rebases rewrite/add operations exactly once', async () => {
    let draft = await run(); draft = await save(draft, { ...draft.record.payload, proposals: { proposals: [proposal('rewrite', 'bullet.rewrite', 'Tailored bullet'), proposal('add', 'bullet.add', 'Added bullet')] } });
    changed(); const p = await (await preview(draft)).json(); const response = await sync(draft, p.upstreamFingerprint); expect(response.status).toBe(200); const result = await response.json();
    expect(result.record.base.spec.experiences[0].bullets).toEqual(base.experiences[0].bullets);
    expect(applyProposals(result.record.base.spec, result.record.payload.proposals.proposals).experiences[0].bullets.map(b => b.text)).toEqual(['Tailored bullet', 'Added bullet']);
    expect(result.record.upstreamSync.candidate.experiences[0].bullets.map((b: any) => b.text)).toEqual(['Tailored bullet', 'Added bullet']);
    expect(orchestrator.getRun(result.record.runSlug).manifest.steps.proposals.status).toBe('stale');
    expect(() => orchestrator.approveStep(result.record.runSlug, 'proposals')).toThrow();
  });
  it('blocks unfinished buffers, invalid targets and running generation without discarding edits', async () => {
    let draft = await run(); draft = await save(draft, { ...draft.record.payload, proposalTextById: { unfinished: '' } }); changed();
    const blocked = await preview(draft); expect(blocked.status).toBe(422); expect((await blocked.json()).detail).toMatch(/unfinished/i);
    draft = await save(draft, { ...draft.record.payload, proposalTextById: {}, proposals: { proposals: [{ ...proposal('bad', 'bullet.rewrite', 'Edited'), target: { experience_index: 8, bullet_index: 0, skill_group_index: -1 } }] } });
    expect((await preview(draft)).status).toBe(422);
    draft = await save(draft, { ...draft.record.payload, proposals: { proposals: [] } });
    const manifest = orchestrator.store.readManifest(draft.record.runSlug); manifest.steps.analysis.status = 'running'; orchestrator.store.writeManifest(manifest);
    expect((await preview(draft)).status).toBe(409);
  });
  it('retains ambiguous proposal text for review with unusable targets', async () => {
    let draft = await run(); draft = await save(draft, { ...draft.record.payload, proposals: { proposals: [proposal('rewrite', 'bullet.rewrite', 'Tailored bullet')] } });
    fs.writeFileSync(source, JSON.stringify({ ...base, experiences: [{ ...base.experiences[0], bullets: [{ text: 'Upstream bullet' }] }] }));
    const p = await (await preview(draft)).json(); expect(p.conflicts).toHaveLength(1);
    const result = await (await sync(draft, p.upstreamFingerprint, randomUUID(), { [p.conflicts[0].id]: 'upstream' })).json();
    expect(result.record.upstreamSync.reviewProposalIds).toEqual(['rewrite']);
    expect(result.record.payload.proposals.proposals[0]).toMatchObject({ after: 'Tailored bullet', decision: 'pending', target: { experience_index: -1 } });
  });
  it('requires fresh review even when manifest flags are edited back to approved', async () => {
    let draft = await run(); changed(); const p = await (await preview(draft)).json(); draft = await (await sync(draft, p.upstreamFingerprint)).json();
    const manifest = orchestrator.store.readManifest(draft.record.runSlug); manifest.steps.proposals.status = 'done'; orchestrator.store.writeManifest(manifest);
    expect(() => orchestrator.approveStep(draft.record.runSlug, 'proposals')).toThrow(/upstream|stale/i);
  });
  it('drops accepted operations when upstream already satisfies the complete candidate', async () => {
    let draft = await run(); draft = await save(draft, { ...draft.record.payload, proposals: { proposals: [proposal('rewrite', 'bullet.rewrite', 'Tailored bullet'), proposal('add', 'bullet.add', 'Added bullet')] } });
    fs.writeFileSync(source, JSON.stringify(applyProposals(base, draft.record.payload.proposals.proposals)));
    const p = await (await preview(draft)).json(); const result = await (await sync(draft, p.upstreamFingerprint)).json();
    expect(result.record.payload.proposals.proposals).toEqual([]);
  });
  it('rejects source byte changes after preview even when parsed content is identical', async () => {
    const draft = await manual(); changed(); const p = await (await preview(draft)).json();
    fs.appendFileSync(source, '\n'); expect((await sync(draft, p.upstreamFingerprint)).status).toBe(409);
  });
  it('keeps local IDs and excluded bullets verbatim for duplicate manual experiences', async () => {
    let draft = await manual(); draft = await save(draft, { ...draft.record.payload, experiences: [...draft.record.payload.experiences, { ...draft.record.payload.experiences[0], id: 'duplicate-local' }] });
    changed(); const p = await (await preview(draft)).json();
    const choices = Object.fromEntries(p.conflicts.map((c: any) => [c.id, 'local']));
    const response = await sync(draft, p.upstreamFingerprint, randomUUID(), choices); expect(response.status).toBe(200);
    const result = await response.json(); expect(result.record.payload.experiences).toEqual(draft.record.payload.experiences);
  });
  it('can explicitly Apply reviewed outputs and regenerate the brief to clear sync review gates', async () => {
    let draft = await run(); const slug = draft.record.runSlug;
    const apply = (step: 'analysis' | 'alignment' | 'proposals') => {
      const current = orchestrator.drafts.get(draft.record.id); if (current.record.kind !== 'run') throw Error('Expected run');
      return orchestrator.applyDraft(current.record.id, { expected: current.token, operationId: randomUUID(), artifactToken: current.record.payload.artifactTokens[step] ?? null, step });
    };
    draft = await save(draft, { ...draft.record.payload, analysis: { company: 'Company', role: 'Engineer', seniority: '', mission: '', requirements: [], boilerplate: [] }, alignment: { rows: [] }, proposals: { proposals: [] } });
    apply('analysis'); apply('alignment'); apply('proposals');
    orchestrator.approveStep(slug, 'analysis'); orchestrator.approveStep(slug, 'alignment'); orchestrator.approveStep(slug, 'proposals');
    draft = orchestrator.drafts.get(draft.record.id); changed(); const p = await (await preview(draft)).json(); draft = await (await sync(draft, p.upstreamFingerprint)).json();
    apply('alignment'); orchestrator.approveStep(slug, 'alignment');
    apply('proposals'); orchestrator.approveStep(slug, 'proposals');
    expect(() => orchestrator.finalize(slug)).toThrow(/upstream|stale/i);
    runner.enqueue({ anchor_stories: [], bridges: [], gaps: [] }); await orchestrator.startStep(slug, 'brief');
    await vi.waitFor(() => expect(orchestrator.store.readManifest(slug).steps.brief.status).toBe('done'));
    const current = orchestrator.drafts.get(draft.record.id).record; if (current.kind !== 'run') throw Error('Expected run');
    expect(current.upstreamSync?.staleSteps).toEqual([]); expect(current.upstreamSync?.reviewProposalIds).toEqual([]);
    expect(orchestrator.finalize(slug).filePath).toContain(slug);
  });
  it('discard after sync cannot restore stale numeric proposal targets', async () => {
    const original = { ...base, experiences: [...base.experiences, { ...base.experiences[0], company: 'Other', bullets: [{ text: 'Other bullet' }] }] };
    fs.writeFileSync(source, JSON.stringify(original)); let draft = await run();
    orchestrator.store.writeJson(draft.record.runSlug, 'proposals.json', { proposals: [{ ...proposal('rewrite', 'bullet.rewrite', 'Tailored bullet'), decision: 'pending' }] });
    draft = orchestrator.getRun(draft.record.runSlug).draft;
    fs.writeFileSync(source, JSON.stringify({ ...original, experiences: [...original.experiences].reverse() }));
    const p = await (await preview(draft)).json(); draft = await (await sync(draft, p.upstreamFingerprint, randomUUID(), Object.fromEntries(p.conflicts.map((c: any) => [c.id, 'local'])))).json();
    const discarded = orchestrator.drafts.discard(draft.record.id, draft.token, randomUUID());
    if (discarded.record.kind !== 'run') throw Error('Expected run');
    expect(discarded.record.payload.proposals?.proposals[0].target.experience_index).toBe(1);
    expect(applyProposals(discarded.record.base.spec, discarded.record.payload.proposals!.proposals).experiences[0].bullets[0].text).toBe('Other bullet');
  });
  it('rejects a resolved local experience order that rebased proposals cannot express before writing anything', async () => {
    const original = { ...base, experiences: [...base.experiences, { ...base.experiences[0], company: 'Other', bullets: [{ text: 'Other bullet' }] }] };
    fs.writeFileSync(source, JSON.stringify(original)); let draft = await run();
    draft = await save(draft, { ...draft.record.payload, proposals: { proposals: [proposal('rewrite', 'bullet.rewrite', 'Tailored bullet')] } });
    const upstream = { ...original, experiences: [...original.experiences].reverse() };
    fs.writeFileSync(source, JSON.stringify(upstream));
    const previewResponse = await preview(draft); expect(previewResponse.status).toBe(200); const p = await previewResponse.json();
    expect(p.conflicts.map((conflict: any) => conflict.id)).toEqual(['/experiences']);
    expect(p.candidate.experiences.map((experience: any) => experience.company)).toEqual(['Company', 'Other']);
    expect(p.candidate.experiences[0].bullets[0].text).toBe('Tailored bullet');
    const snapshot = (directory = root): Record<string, string> => Object.fromEntries(fs.readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
      const file = path.join(directory, entry.name);
      return entry.isDirectory() ? Object.entries(snapshot(file)) : [[path.relative(root, file), fs.readFileSync(file).toString('base64')]];
    }));
    const before = snapshot();
    const rejected = await sync(draft, p.upstreamFingerprint, randomUUID(), { '/experiences': 'local' });
    expect(rejected.status).toBe(422); expect(await rejected.json()).toMatchObject({ code: 'unrepresentable_merge', detail: expect.stringMatching(/cannot.*candidate.*upstream/i) });
    expect(snapshot()).toEqual(before);
    expect(orchestrator.drafts.get(draft.record.id)).toEqual({ record: draft.record, token: draft.token });
    const accepted = await sync(draft, p.upstreamFingerprint, randomUUID(), { '/experiences': 'upstream' });
    expect(accepted.status).toBe(200); const result = await accepted.json();
    expect(result.record.upstreamSync.candidate).toEqual(upstream);
    expect(result.record.upstreamSync.reviewProposalIds).toEqual([]);
    expect(applyProposals(result.record.base.spec, result.record.payload.proposals.proposals)).toEqual(result.record.upstreamSync.candidate);
  });
  it('drops rewrite and add already adopted by upstream even with independent source edits', async () => {
    let draft = await run(); draft = await save(draft, { ...draft.record.payload, proposals: { proposals: [proposal('rewrite', 'bullet.rewrite', 'Tailored bullet'), proposal('add', 'bullet.add', 'Added bullet')] } });
    const adopted = applyProposals(base, draft.record.payload.proposals.proposals); adopted.profile.title = 'Upstream title'; fs.writeFileSync(source, JSON.stringify(adopted));
    const p = await (await preview(draft)).json(); const result = await (await sync(draft, p.upstreamFingerprint)).json();
    expect(result.record.payload.proposals.proposals).toEqual([]);
    expect(result.record.upstreamSync.reviewProposalIds).toEqual([]);
  });
  it('does not let an ambiguous target hide an incompatible local order and retains its text on compatible upstream selection', async () => {
    const original = { ...base, experiences: [...base.experiences, { ...base.experiences[0], company: 'Other', bullets: [{ text: 'Other bullet' }] }] };
    fs.writeFileSync(source, JSON.stringify(original)); let draft = await run();
    const second = { ...proposal('rewrite-b', 'bullet.rewrite', 'Tailored other bullet'), before: 'Other bullet', target: { experience_index: 1, bullet_index: 0, skill_group_index: -1 } };
    draft = await save(draft, { ...draft.record.payload, proposals: { proposals: [proposal('rewrite-a', 'bullet.rewrite', 'Tailored bullet'), second] } });
    const upstream = { ...original, experiences: [{ ...original.experiences[1], bullets: [{ text: 'Upstream other bullet' }] }, original.experiences[0]] };
    fs.writeFileSync(source, JSON.stringify(upstream));
    const p = await (await preview(draft)).json();
    expect(p.candidate.experiences.map((experience: any) => experience.company)).toEqual(['Company', 'Other']);
    const snapshot = (directory = root): Record<string, string> => Object.fromEntries(fs.readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
      const file = path.join(directory, entry.name);
      return entry.isDirectory() ? Object.entries(snapshot(file)) : [[path.relative(root, file), fs.readFileSync(file).toString('base64')]];
    }));
    const before = snapshot();
    const rejected = await sync(draft, p.upstreamFingerprint, randomUUID(), { '/experiences': 'local' });
    expect(rejected.status).toBe(422); expect((await rejected.json()).code).toBe('unrepresentable_merge');
    expect(snapshot()).toEqual(before); expect(orchestrator.drafts.get(draft.record.id)).toEqual({ record: draft.record, token: draft.token });
    const accepted = await sync(draft, p.upstreamFingerprint, randomUUID(), { '/experiences': 'upstream' });
    expect(accepted.status).toBe(200); const result = await accepted.json();
    expect(result.record.upstreamSync.reviewProposalIds).toEqual(['rewrite-b']);
    expect(result.record.payload.proposals.proposals).toEqual([expect.objectContaining({ id: 'rewrite-b', after: 'Tailored other bullet', decision: 'pending', target: { experience_index: -1, bullet_index: -1, skill_group_index: -1 } })]);
    expect(applyProposals(result.record.base.spec, result.record.payload.proposals.proposals)).toEqual(result.record.upstreamSync.candidate);
    expect(result.record.upstreamSync.candidate).toEqual(upstream);
  });
});
