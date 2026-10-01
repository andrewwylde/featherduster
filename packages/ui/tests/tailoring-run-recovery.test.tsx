/** @vitest-environment jsdom */
import { StrictMode } from 'react';
import { DraftCoordinator } from '../src/tailoring-drafts/coordinator';
import { BrowserRecovery } from '../src/tailoring-drafts/recovery';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { ApiError, apiClient, type TailoringRunDetail } from '../src/api/client';
import { TailoringRun } from '../src/views/tailoring/TailoringRun';
import { sseClient } from '../src/api/events';
import type { DraftEnvelope } from '@featherduster/core';

let server: DraftEnvelope;
let detail: TailoringRunDetail;
let event: (e: any) => void;
let file: (e: any) => void;
let draftEvent: ((e: any) => void) | undefined;
const analysis = { company: 'Acme', role: 'Engineer', seniority: '', mission: '', requirements: [{ id: 'r1', text: 'Go', tier: 'must', quote: 'Go', terms: [] }], boilerplate: [] };
const alignment = { rows: [{ requirement_id: 'r1', classification: 'backed', rationale: 'Go experience', adjacent_tool: '', candidate_confirmed: false, citations: [], issues: [] }] };
const proposal = { id: 'p1', type: 'summary.rewrite', target: { experience_index: -1, bullet_index: -1, skill_group_index: -1 }, before: 'Engineer', after: 'Go engineer', order: [], skills: [], citations: [], requirement_ids: ['r1'], rationale: '', decision: 'accepted', checks: [] };
const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v));
function mount(selectedStep?: any) { return render(<TailoringRun slug="acme" selectedStep={selectedStep} onBack={() => {}} onOpenInCanvas={() => {}} />); }
beforeEach(() => {
  vi.restoreAllMocks(); localStorage.clear();
  const now = '2026-09-30T10:00:00.000Z';
  const appliedContent = { analysis: clone(analysis), alignment: clone(alignment), proposals: { proposals: [clone(proposal)] } };
  server = { record: { schemaVersion: 1, id: '11111111-1111-4111-8111-111111111111', kind: 'run', lifecycle: 'draft', runSlug: 'acme', revision: 1, createdAt: now, editedAt: now, savedAt: now, context: {}, appliedContent, base: { resumeId: 'base', fingerprint: 'base', spec: { profile: { name: 'Sam', title: 'Engineer', email: 's@x.dev' }, summary: 'Engineer', experiences: [], skills: [], education: [] } }, payload: { ...clone(appliedContent), proposalTextById: {}, artifactTokens: { analysis: { revision: 1, fingerprint: 'analysis' }, alignment: { revision: 1, fingerprint: 'alignment' }, proposals: { revision: 1, fingerprint: 'proposals' } } } }, token: { revision: 1, fingerprint: 'draft' } } as DraftEnvelope;
  const step = { status: 'done', completed_at: now, input_hash: '', error: null, raw_output: null };
  detail = { manifest: { slug: 'acme', title: 'Acme', runner: 'claude-code', state: 'analysis_review', steps: { analysis: { ...step }, alignment: { ...step }, proposals: { ...step }, brief: { ...step, status: 'pending' } } }, posting: 'Go', analysis: clone(analysis), alignment: clone(alignment), proposals: [clone(proposal)], base_resume: server.record.base!.spec, draft: server, alignment_summary: null, page_budget: null, resume: null, brief_markdown: null } as unknown as TailoringRunDetail;
  vi.spyOn(apiClient, 'getHealth').mockResolvedValue({ status: 'ok', workspaceId: 'workspace', workspaceDir: '/workspace' });
  vi.spyOn(apiClient, 'getEvidence').mockResolvedValue([]);
  vi.spyOn(apiClient, 'getTailoringRun').mockImplementation(async () => clone({ ...detail, draft: server }));
  vi.spyOn(apiClient, 'getTailoringDraft').mockImplementation(async () => clone(server));
  vi.spyOn(apiClient, 'saveTailoringDraft').mockImplementation(async (_, input) => {
    server = { record: { ...server.record, ...(input.payload ? { payload: clone(input.payload) } : {}), ...(input.context ? { context: clone(input.context) } : {}) } as any, token: { revision: server.token.revision + 1, fingerprint: `saved-${server.token.revision + 1}` } };
    return { ...clone(server), mutationId: input.mutationId };
  });
  vi.spyOn(sseClient, 'onTailoring').mockImplementation(fn => { event = fn; return () => {}; });
  const fileListeners = new Set<(event: any) => void>();
  file = event => fileListeners.forEach(listener => listener(event));
  vi.spyOn(sseClient, 'onChange').mockImplementation(fn => { fileListeners.add(fn); return () => { fileListeners.delete(fn); }; });
  draftEvent = undefined;
  vi.spyOn(sseClient, 'onDraftChange').mockImplementation(fn => { draftEvent = fn; return () => {}; });
  vi.spyOn(sseClient, 'onStatus').mockImplementation(() => () => {});
});
afterEach(cleanup);
it('offers conflict choices and opens a fresh run recovery with all preserved steps available for review', async () => {
  const openDraft = vi.fn();
  const view = render(<TailoringRun slug="acme" selectedStep="analysis" onBack={() => {}} onOpenInCanvas={() => {}} onOpenDraft={openDraft} />);
  fireEvent.change(await screen.findByLabelText('Requirement r1'), { target: { value: 'My recovery text' } });
  await act(async () => { server.token = { revision: 7, fingerprint: 'remote' }; if (server.record.kind === 'run') server.record.payload.artifactTokens = {}; file({ relativePath: 'tailoring/acme/analysis.json' }); });
  expect(await screen.findByRole('dialog', { name: 'Resolve draft conflict' })).toBeInTheDocument();
  vi.spyOn(apiClient, 'forkTailoringDraft').mockImplementation(async (_, input) => {
    server = { record: { ...input.sourceSnapshot, id: '22222222-2222-4222-8222-222222222222', runSlug: 'recovered', appliedContent: {}, payload: { ...input.sourceSnapshot.payload, artifactTokens: {} } } as any, token: { revision: 0, fingerprint: 'forked' } };
    return clone(server);
  });
  fireEvent.click(screen.getByRole('button', { name: 'Keep mine as a separate draft' }));
  await waitFor(() => expect(openDraft).toHaveBeenCalledWith(server.record.id));
  view.unmount();
  for (const step of Object.values(detail.manifest.steps)) step.status = 'pending';
  detail.analysis = null; detail.alignment = null; detail.proposals = null;
  render(<TailoringRun slug="recovered" selectedStep="analysis" onBack={() => {}} onOpenInCanvas={() => {}} />);
  expect(await screen.findByLabelText('Requirement r1')).toHaveValue('My recovery text');
  expect(screen.getByRole('button', { name: 'Apply requirement edits' })).toBeEnabled();
  fireEvent.click(screen.getByRole('button', { name: /Match your evidence/ }));
  expect(await screen.findByLabelText('Rationale for r1')).toHaveValue('Go experience');
  fireEvent.click(screen.getByRole('button', { name: /Review cited edits/ }));
  expect(await screen.findByRole('button', { name: 'Edit' })).toBeEnabled();
});
it('recovers a blank requirement through step changes, file refresh and remount', async () => {
  const view = mount('analysis');
  fireEvent.change(await screen.findByLabelText('Requirement r1'), { target: { value: '' } });
  fireEvent.click(screen.getByRole('button', { name: /Match your evidence/ }));
  fireEvent.click(screen.getByRole('button', { name: /Break down the posting/ }));
  expect(screen.getByLabelText('Requirement r1')).toHaveValue('');
  await act(async () => { file({ relativePath: 'tailoring/acme/analysis.json' }); });
  expect(screen.getByLabelText('Requirement r1')).toHaveValue('');
  view.unmount(); mount();
  expect(await screen.findByLabelText('Requirement r1')).toHaveValue('');
  expect(screen.getByText(/Unapplied edits/)).toBeInTheDocument();
});
it('recovers alignment rationale and unfinished proposal text with work context', async () => {
  const view = mount('alignment');
  fireEvent.change(await screen.findByLabelText('Rationale for r1'), { target: { value: '' } });
  fireEvent.click(screen.getByRole('button', { name: /Review cited edits/ }));
  fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
  fireEvent.change(screen.getByLabelText('Edit proposal p1'), { target: { value: 'unfinished ' } });
  fireEvent.click(screen.getByRole('tab', { name: 'Unified Diff' }));
  fireEvent.click(screen.getByRole('tab', { name: 'context' }));
  view.unmount(); mount();
  expect(await screen.findByLabelText('Edit proposal p1')).toHaveValue('unfinished ');
  expect(screen.getByRole('tab', { name: 'Unified Diff' })).toHaveAttribute('aria-selected', 'true');
  expect(screen.getByRole('tab', { name: 'context' })).toHaveAttribute('aria-selected', 'true');
  fireEvent.click(screen.getByRole('button', { name: /Match your evidence/ }));
  expect(screen.getByLabelText('Rationale for r1')).toHaveValue('');
});
it('awaits Apply before approval and stops on Apply failure', async () => {
  const apply = vi.spyOn(apiClient, 'applyTailoringDraft').mockRejectedValue(new Error('Invalid proposal'));
  const approve = vi.spyOn(apiClient, 'approveTailoringStep');
  const run = vi.spyOn(apiClient, 'runTailoringStep');
  mount('proposals');
  fireEvent.click(await screen.findByRole('button', { name: 'Edit' }));
  fireEvent.change(screen.getByLabelText('Edit proposal p1'), { target: { value: 'unfinished' } });
  fireEvent.click(screen.getByRole('button', { name: /Approve edits/ }));
  await waitFor(() => expect(apply).toHaveBeenCalled());
  expect(await screen.findByRole('alert')).toHaveTextContent('Invalid proposal');
  expect(screen.getByLabelText('Edit proposal p1')).toHaveValue('unfinished');
  expect(approve).not.toHaveBeenCalled(); expect(run).not.toHaveBeenCalled();
});
it('reconnects to interrupted runs without starting generation', async () => {
  detail.manifest.steps.analysis.status = 'error'; detail.manifest.steps.analysis.error = 'Interrupted';
  const run = vi.spyOn(apiClient, 'runTailoringStep');
  mount('analysis');
  expect(await screen.findByText('Interrupted')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: /Retry/ })).toBeInTheDocument();
  await act(async () => { event({ slug: 'acme', kind: 'state' }); });
  expect(run).not.toHaveBeenCalled();
});

it('preserves autosaved pending edits and surfaces conflict when artifacts change', async () => {
  mount('analysis');
  fireEvent.change(await screen.findByLabelText('Requirement r1'), { target: { value: 'My requirement' } });
  await waitFor(() => expect(apiClient.saveTailoringDraft).toHaveBeenCalled());
  server = clone(server);
  if (server.record.kind !== 'run') throw Error('fixture');
  server.token = { revision: server.token.revision + 1, fingerprint: 'external' };
  server.record.payload.artifactTokens.analysis = { revision: 2, fingerprint: 'new-analysis' };
  server.record.payload.analysis!.requirements[0].text = 'External requirement';
  await act(async () => { file({ relativePath: 'tailoring/acme/analysis.json' }); });
  expect(screen.getByLabelText('Requirement r1')).toHaveValue('My requirement');
  expect(screen.getAllByText('Resolve the recovery conflict first.').length).toBeGreaterThan(0);
  expect(screen.getByRole('button', { name: /Approve & match/ })).toBeDisabled();
});
it('awaits Apply acknowledgement before approval and generation', async () => {
  let finish!: (value: any) => void;
  const apply = vi.spyOn(apiClient, 'applyTailoringDraft').mockImplementation(() => new Promise(resolve => { finish = resolve; }));
  const approve = vi.spyOn(apiClient, 'approveTailoringStep').mockImplementation(async () => clone({ ...detail, draft: server }));
  const run = vi.spyOn(apiClient, 'runTailoringStep').mockResolvedValue({ started: true });
  mount('proposals');
  fireEvent.click(await screen.findByRole('button', { name: 'Edit' }));
  fireEvent.change(screen.getByLabelText('Edit proposal p1'), { target: { value: 'New text' } });
  fireEvent.click(screen.getByRole('button', { name: /Approve edits/ }));
  await waitFor(() => expect(apply).toHaveBeenCalled());
  expect(screen.getByLabelText('Edit proposal p1')).toHaveAttribute('readonly');
  expect(approve).not.toHaveBeenCalled(); expect(run).not.toHaveBeenCalled();
  await act(async () => {
    if (server.record.kind !== 'run') throw Error('fixture');
    server.record.payload.proposals!.proposals[0].edited_after = 'New text';
    server.record.payload.proposalTextById = {};
    server.record.appliedContent.proposals = clone(server.record.payload.proposals);
    server.token = { revision: server.token.revision + 1, fingerprint: 'applied' };
    finish({ ...clone(server), mutationId: 'apply', run: clone({ ...detail, draft: server }) });
  });
  await waitFor(() => expect(run).toHaveBeenCalledWith('acme', 'brief'));
  expect(approve).toHaveBeenCalledWith('acme', 'proposals');
});
it('validates stale proposal context but retains orphan recovery text', async () => {
  server.record.context = { activeStep: 'proposals', selectedProposalId: 'missing', editingProposalId: 'missing' };
  if (server.record.kind !== 'run') throw Error('fixture');
  server.record.payload.proposalTextById.missing = 'Keep this orphaned text';
  mount();
  await screen.findByRole('listitem', { name: /Proposal p1/ });
  expect(screen.queryByLabelText('Edit proposal missing')).not.toBeInTheDocument();
  await waitFor(() => expect(apiClient.saveTailoringDraft).toHaveBeenCalled());
  expect(server.record.context.editingProposalId).toBeUndefined();
  expect(server.record.kind === 'run' && server.record.payload.proposalTextById.missing).toBe('Keep this orphaned text');
  expect(screen.getByText(/text for a proposal that is no longer available/)).toBeInTheDocument();
});
it('does not treat its own Apply file event before HTTP acknowledgement as a conflict', async () => {
  let finish!: (value: any) => void;
  const apply = vi.spyOn(apiClient, 'applyTailoringDraft').mockImplementation(() => new Promise(resolve => { finish = resolve; }));
  mount('analysis');
  fireEvent.change(await screen.findByLabelText('Requirement r1'), { target: { value: 'Updated Go' } });
  fireEvent.click(screen.getByRole('button', { name: 'Apply requirement edits' }));
  await waitFor(() => expect(apply).toHaveBeenCalled());
  if (server.record.kind !== 'run') throw Error('fixture');
  server.record.appliedContent.analysis = clone(server.record.payload.analysis);
  server.record.payload.artifactTokens.analysis = { revision: 2, fingerprint: 'applied-analysis' };
  server.token = { revision: server.token.revision + 1, fingerprint: 'applied-draft' };
  await act(async () => { file({ relativePath: 'tailoring/acme/analysis.json' }); });
  await act(async () => { finish({ ...clone(server), mutationId: 'apply', run: clone({ ...detail, draft: server }) }); });
  await waitFor(() => expect(screen.queryByText(/Unapplied edits/)).not.toBeInTheDocument());
  expect(screen.queryByText(/Conflicting draft/)).not.toBeInTheDocument();
  expect(screen.getByLabelText('Requirement r1')).toHaveValue('Updated Go');
});
it('ignores a late older refresh after the latest artifact response', async () => {
  mount('analysis'); await screen.findByLabelText('Requirement r1');
  const old = clone({ ...detail, draft: server });
  let finish!: (value: any) => void;
  vi.mocked(apiClient.getTailoringRun).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  act(() => { event({ slug: 'acme', kind: 'state' }); });
  if (server.record.kind !== 'run') throw Error('fixture');
  server.record.payload.analysis!.requirements[0].text = 'Latest';
  server.record.appliedContent.analysis = clone(server.record.payload.analysis);
  server.token = { revision: 2, fingerprint: 'latest' };
  await act(async () => { file({ relativePath: 'tailoring/acme/analysis.json' }); });
  expect(screen.getByLabelText('Requirement r1')).toHaveValue('Latest');
  await act(async () => finish(old));
  expect(screen.getByLabelText('Requirement r1')).toHaveValue('Latest');
});
it('changes only context when choosing a step and replaces the existing URL query', async () => {
  window.history.replaceState({}, '', '/tailor/acme?step=analysis&view=review');
  const editedAt = server.record.editedAt;
  mount('analysis'); await screen.findByLabelText('Requirement r1');
  fireEvent.click(screen.getByRole('button', { name: /Match your evidence/ }));
  expect(window.location.pathname).toBe('/tailor/acme');
  expect(new URLSearchParams(window.location.search).get('step')).toBe('alignment');
  expect(new URLSearchParams(window.location.search).get('view')).toBe('review');
  await waitFor(() => expect(apiClient.saveTailoringDraft).toHaveBeenCalled());
  expect(vi.mocked(apiClient.saveTailoringDraft).mock.calls[0][1]).toMatchObject({ change: 'context', context: { activeStep: 'alignment' } });
  expect(server.record.editedAt).toBe(editedAt);
});
it.each([false, true])('navigation protects memory-only edits when storage fails: %s', async unavailable => {
  let canLeave = () => true;
  render(<TailoringRun slug="acme" selectedStep="analysis" registerGuard={guard => { canLeave = guard; }} onBack={() => {}} onOpenInCanvas={() => {}} />);
  await screen.findByLabelText('Requirement r1');
  if (unavailable) vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw Error('Storage unavailable'); });
  fireEvent.change(screen.getByLabelText('Requirement r1'), { target: { value: 'In progress' } });
  expect(canLeave()).toBe(!unavailable);
});
it('stops generation when approval fails after a successful Apply', async () => {
  vi.spyOn(apiClient, 'approveTailoringStep').mockRejectedValue(new Error('Approval rejected'));
  const run = vi.spyOn(apiClient, 'runTailoringStep');
  mount('analysis'); await screen.findByLabelText('Requirement r1');
  fireEvent.click(screen.getByRole('button', { name: /Approve & match/ }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Approval rejected');
  expect(run).not.toHaveBeenCalled();
});
it('does not continue approval after leaving during Apply', async () => {
  let finish!: (value: any) => void;
  const apply = vi.spyOn(apiClient, 'applyTailoringDraft').mockImplementation(() => new Promise(resolve => { finish = resolve; }));
  const approve = vi.spyOn(apiClient, 'approveTailoringStep');
  const view = mount('analysis');
  fireEvent.change(await screen.findByLabelText('Requirement r1'), { target: { value: 'Updated' } });
  fireEvent.click(screen.getByRole('button', { name: /Approve & match/ }));
  await waitFor(() => expect(apply).toHaveBeenCalled());
  view.unmount();
  await act(async () => finish({ ...server, mutationId: 'apply', run: detail }));
  expect(approve).not.toHaveBeenCalled();
});
it.each(['running', 'error'] as const)('keeps existing recovered editors available when the current generation is %s', async status => {
  detail.manifest.steps.analysis.status = status;
  detail.manifest.steps.analysis.error = status === 'error' ? 'Interrupted' : null;
  mount('analysis');
  fireEvent.change(await screen.findByLabelText('Requirement r1'), { target: { value: 'Recovered during generation' } });
  expect(screen.getByLabelText('Requirement r1')).toHaveValue('Recovered during generation');
  const apply = screen.getByRole('button', { name: 'Apply requirement edits' });
  if (status === 'running') {
    expect(apply).toBeDisabled();
    expect(screen.getByText('Wait for generation to finish before applying edits.')).toBeInTheDocument();
  } else expect(apply).toBeEnabled();
});

it('borrows the route coordinator through StrictMode without disposing its writer on child unmount', async () => {
  const recovery = new BrowserRecovery();
  const writer = new DraftCoordinator({ workspaceId: 'workspace', draftId: server.record.id, api: apiClient, recovery });
  await writer.hydrate(server);
  const dispose = vi.spyOn(writer, 'dispose');
  const view = render(<StrictMode><TailoringRun coordinator={writer} slug="acme" selectedStep="analysis" onBack={() => {}} onOpenInCanvas={() => {}} /></StrictMode>);
  fireEvent.change(await screen.findByLabelText('Requirement r1'), { target: { value: 'Shared writer' } });
  view.unmount();
  expect(dispose).not.toHaveBeenCalled();
  const saved = await writer.awaitSaved();
  expect(saved.record.kind === 'run' && saved.record.payload.analysis!.requirements[0].text).toBe('Shared writer');
  expect(writer.canLeave()).toBe(true);
  writer.dispose(); recovery.dispose();
});
it('previews the next generation step when approval succeeds but that runner needs consent', async () => {
  vi.spyOn(apiClient, 'approveTailoringStep').mockResolvedValue(clone({ ...detail, draft: server }));
  vi.spyOn(apiClient, 'runTailoringStep').mockRejectedValue(new ApiError('Consent required', 403, 'consent_required'));
  const preview = vi.spyOn(apiClient, 'previewTailoringStep').mockResolvedValue({ runner: 'Claude Code', locality: 'cloud', system: '', prompt: 'Redacted alignment input' });
  mount('analysis'); await screen.findByLabelText('Requirement r1');
  fireEvent.click(screen.getByRole('button', { name: /Approve & match/ }));
  await screen.findByRole('dialog');
  expect(preview).toHaveBeenCalledWith('acme', 'alignment');
});

it('refreshes matching draft events without losing typed text', async () => {
  mount('analysis');
  fireEvent.change(await screen.findByLabelText('Requirement r1'), { target: { value: 'Typed text' } });
  expect(draftEvent).toBeTypeOf('function');
  const reads = vi.mocked(apiClient.getTailoringRun).mock.calls.length;
  await act(async () => draftEvent!({ draftId: server.record.id, token: server.token }));
  expect(apiClient.getTailoringRun).toHaveBeenCalledTimes(reads + 1);
  expect(screen.getByLabelText('Requirement r1')).toHaveValue('Typed text');
  await act(async () => draftEvent!({ draftId: 'another-draft' }));
  expect(apiClient.getTailoringRun).toHaveBeenCalledTimes(reads + 1);
});
it('confirms workspace identity before requesting the first run detail', async () => {
  let confirm!: (value: any) => void;
  vi.mocked(apiClient.getHealth).mockImplementationOnce(() => new Promise(resolve => { confirm = resolve; }));
  mount('analysis');
  await waitFor(() => expect(apiClient.getHealth).toHaveBeenCalled());
  expect(apiClient.getTailoringRun).not.toHaveBeenCalled();
  await act(async () => confirm({ status: 'ok', workspaceId: 'workspace', workspaceDir: '/workspace' }));
  expect(await screen.findByLabelText('Requirement r1')).toHaveValue('Go');
});
it('rejects a workspace switch during initial detail loading before creating recovery', async () => {
  vi.mocked(apiClient.getTailoringRun).mockImplementationOnce(async () => {
    vi.mocked(apiClient.getHealth).mockResolvedValue({ status: 'ok', workspaceId: 'other', workspaceDir: '/other' });
    return clone({ ...detail, draft: server });
  });
  mount('analysis');
  expect(await screen.findByText(/Workspace identity changed/)).toBeInTheDocument();
  expect(screen.queryByLabelText('Requirement r1')).not.toBeInTheDocument();
  expect(localStorage.length).toBe(0);
});
it('pauses on a different draft for the same slug and preserves the prior display and memory-only guard', async () => {
  let canLeave = () => true;
  render(<TailoringRun slug="acme" selectedStep="analysis" registerGuard={guard => { canLeave = guard; }} onBack={() => {}} onOpenInCanvas={() => {}} />);
  await screen.findByLabelText('Requirement r1');
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw Error('Storage unavailable'); });
  fireEvent.change(screen.getByLabelText('Requirement r1'), { target: { value: 'Keep A in memory' } });
  server = clone(server); server.record.id = '22222222-2222-4222-8222-222222222222';
  detail.manifest.title = 'Other workspace run';
  await act(async () => file({ relativePath: 'tailoring/acme/manifest.json' }));
  expect(screen.queryByRole('heading', { name: 'Other workspace run' })).not.toBeInTheDocument();
  expect(screen.getByLabelText('Requirement r1')).toHaveValue('Keep A in memory');
  expect(screen.getByLabelText('Requirement r1')).toHaveAttribute('readonly');
  expect(screen.getByText(/Run draft identity changed/)).toBeInTheDocument();
  expect(canLeave()).toBe(false);
  const unload = new Event('beforeunload', { cancelable: true });
  window.dispatchEvent(unload); expect(unload.defaultPrevented).toBe(true);
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 550)); });
  expect(apiClient.saveTailoringDraft).not.toHaveBeenCalled();
});
it('rechecks workspace identity before commands even when the current draft is already saved', async () => {
  const approve = vi.spyOn(apiClient, 'approveTailoringStep').mockResolvedValue(detail);
  const run = vi.spyOn(apiClient, 'runTailoringStep').mockResolvedValue({ started: true });
  mount('analysis'); await screen.findByLabelText('Requirement r1');
  vi.mocked(apiClient.getHealth).mockResolvedValue({ status: 'ok', workspaceId: 'other', workspaceDir: '/other' });
  fireEvent.click(screen.getByRole('button', { name: /Approve & match/ }));
  expect(await screen.findByText(/Workspace identity changed/)).toBeInTheDocument();
  expect(approve).not.toHaveBeenCalled(); expect(run).not.toHaveBeenCalled();
  expect(apiClient.saveTailoringDraft).not.toHaveBeenCalled();
});

it('keeps browser recovery editable after a transient identity-check outage while commands fail safely', async () => {
  const approve = vi.spyOn(apiClient, 'approveTailoringStep').mockResolvedValue(detail);
  mount('analysis'); await screen.findByLabelText('Requirement r1');
  vi.mocked(apiClient.getHealth).mockRejectedValue(new Error('Connection unavailable'));
  await act(async () => file({ relativePath: 'tailoring/acme/manifest.json' }));
  fireEvent.click(screen.getByRole('button', { name: /Approve & match/ }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Connection unavailable');
  expect(approve).not.toHaveBeenCalled();
  expect(screen.getByLabelText('Requirement r1')).not.toHaveAttribute('readonly');
  fireEvent.change(screen.getByLabelText('Requirement r1'), { target: { value: 'Offline recovery' } });
  expect(screen.getByLabelText('Requirement r1')).toHaveValue('Offline recovery');
  expect(screen.queryByText(/Workspace identity changed/)).not.toBeInTheDocument();
});
it('rejects another workspace when borrowing an already confirmed route coordinator', async () => {
  const recovery = new BrowserRecovery();
  const writer = new DraftCoordinator({ workspaceId: 'original', draftId: server.record.id, api: apiClient, recovery });
  await writer.hydrate(server);
  render(<TailoringRun coordinator={writer} slug="acme" onBack={() => {}} onOpenInCanvas={() => {}} />);
  expect(await screen.findByText(/Workspace identity changed/)).toBeInTheDocument();
  expect(apiClient.getTailoringRun).not.toHaveBeenCalled();
  expect(writer.getSnapshot().record?.id).toBe(server.record.id);
  await expect(writer.awaitSaved()).rejects.toThrow('disposed');
  recovery.dispose();
});
it('checks the current run draft target before commands even when workspace identity is unchanged', async () => {
  const approve = vi.spyOn(apiClient, 'approveTailoringStep').mockResolvedValue(detail);
  mount('analysis'); await screen.findByLabelText('Requirement r1');
  server = clone(server); server.record.id = '22222222-2222-4222-8222-222222222222';
  fireEvent.click(screen.getByRole('button', { name: /Approve & match/ }));
  expect(await screen.findByText(/Run draft identity changed/)).toBeInTheDocument();
  expect(approve).not.toHaveBeenCalled();
});
it('rechecks identity after draining pending autosaves before issuing a command', async () => {
  const apply = vi.spyOn(apiClient, 'applyTailoringDraft');
  const save = vi.mocked(apiClient.saveTailoringDraft).getMockImplementation()!;
  vi.mocked(apiClient.saveTailoringDraft).mockImplementation(async (id, input) => {
    const ack = await save(id, input);
    vi.mocked(apiClient.getHealth).mockResolvedValue({ status: 'ok', workspaceId: 'other', workspaceDir: '/other' });
    return ack;
  });
  mount('analysis');
  fireEvent.change(await screen.findByLabelText('Requirement r1'), { target: { value: 'Pending edit' } });
  fireEvent.click(screen.getByRole('button', { name: 'Apply requirement edits' }));
  expect(await screen.findByText(/Workspace identity changed/)).toBeInTheDocument();
  expect(apply).not.toHaveBeenCalled();
});
it('applies cleaned text after an inline edit is undone back to its applied value', async () => {
  if (server.record.kind !== 'run') throw Error('fixture');
  const checks = [{ severity: 'warn' as const, kind: 'deslop_filler', message: 'Remove filler' }];
  server.record.payload.proposals!.proposals[0].checks = checks;
  server.record.appliedContent.proposals!.proposals[0].checks = checks;
  vi.spyOn(apiClient, 'deslopText').mockResolvedValue({ success: true, cleanedText: 'Clean Go engineer', fixesApplied: [] });
  let appliedText: string | undefined;
  const apply = vi.spyOn(apiClient, 'applyTailoringDraft').mockImplementation(async () => {
    if (server.record.kind !== 'run') throw Error('fixture');
    const p = server.record.payload.proposals!.proposals[0];
    // Apply consumes recovery buffers before validating the edited proposal.
    appliedText = server.record.payload.proposalTextById[p.id] ?? p.edited_after ?? p.after;
    return { ...clone(server), mutationId: 'apply', run: clone({ ...detail, draft: server }) };
  });
  mount('proposals');
  fireEvent.click(await screen.findByRole('button', { name: 'Edit' }));
  fireEvent.change(screen.getByLabelText('Edit proposal p1'), { target: { value: 'Temporary typing' } });
  fireEvent.change(screen.getByLabelText('Edit proposal p1'), { target: { value: proposal.after } });
  fireEvent.click(screen.getByRole('button', { name: 'Close editor' }));
  expect(screen.queryByText(/Unapplied edits/)).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Clean filler' }));
  const applyButton = await screen.findByRole('button', { name: 'Apply proposal edits' });
  fireEvent.click(applyButton);
  await waitFor(() => expect(apply).toHaveBeenCalled());
  expect(appliedText).toBe('Clean Go engineer');
});

it('saves selected-step context before starting generation', async () => {
  let contextAtGeneration: unknown;
  const run = vi.spyOn(apiClient, 'runTailoringStep').mockImplementation(async () => {
    contextAtGeneration = clone(server.record.context);
    return { started: true };
  });
  mount('analysis');
  fireEvent.click(await screen.findByRole('button', { name: 'Re-run' }));
  await waitFor(() => expect(run).toHaveBeenCalledOnce());
  expect(contextAtGeneration).toMatchObject({ activeStep: 'analysis' });
  expect(apiClient.saveTailoringDraft).toHaveBeenCalled();
});
