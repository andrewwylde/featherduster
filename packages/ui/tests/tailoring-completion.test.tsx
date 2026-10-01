/** @vitest-environment jsdom */
import { beforeEach, afterEach, it, expect, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { render, screen, cleanup, fireEvent, waitFor, within, act } from '@testing-library/react';
import { apiClient } from '../src/api/client';
import { DraftCoordinator } from '../src/tailoring-drafts/coordinator';
import { BrowserRecovery } from '../src/tailoring-drafts/recovery';
import { TailoringRun } from '../src/views/tailoring/TailoringRun';
vi.mock('../src/hooks/useTailoringEvents', () => ({ useTailoringEvents: () => {} }));
import { TailoringDraftRoute } from '../src/views/tailoring/TailoringDraftRoute';
import { manualFromSpec } from '../src/tailoring-drafts/manual-model';
const spec = { profile: { name: 'Completed Person', title: 'Engineer', email: 'a@example.com' }, summary: 'Preserved summary', experiences: [], education: [], skills: [] };
const now = new Date().toISOString();
const done: any = { record: { schemaVersion: 1, id: 'e35a160a-82c1-48f0-a635-9200e7140962', kind: 'manual', lifecycle: 'completed', revision: 2, createdAt: now, savedAt: now, editedAt: now, base: { resumeId: 'base', spec, fingerprint: 'base' }, context: {}, appliedContent: {}, payload: manualFromSpec(spec, 'base'), completion: { outputId: 'completed-id', path: 'resumes/tailored/completed.yaml', completedAt: now, name: 'My completed version', type: 'tailored', spec } }, token: { revision: 2, fingerprint: 'completed' } };
beforeEach(() => {
  vi.restoreAllMocks(); localStorage.clear();
  vi.spyOn(apiClient, 'getHealth').mockResolvedValue({ status: 'ok', workspaceDir: '/workspace', workspaceId: 'workspace' });
  vi.spyOn(apiClient, 'getResumes').mockResolvedValue([]);
  vi.spyOn(apiClient, 'getEvidence').mockResolvedValue([]);
  vi.spyOn(apiClient, 'compileResume').mockResolvedValue({ output: 'Resume', format: 'markdown' } as any);
  vi.spyOn(apiClient, 'runPreflight').mockResolvedValue({ isClean: true } as any);
  vi.spyOn(apiClient, 'getRunners').mockResolvedValue({ runners: [] } as any);
  vi.spyOn(apiClient, 'listTailoringDrafts').mockResolvedValue({ workspaceId: 'workspace', records: [done], recoveryErrors: [] });
  vi.spyOn(apiClient, 'getTailoringDraft').mockResolvedValue(done);
  vi.spyOn(apiClient, 'saveTailoringDraft').mockRejectedValue(Error('Must not save'));
});
afterEach(cleanup);
function open(navigate = vi.fn()) { render(<TailoringDraftRoute draftId={done.record.id} navigate={navigate} onOpenCanvas={() => {}} onOpenSettings={() => {}} registerGuard={() => {}} />); return navigate; }
it('opens completed direct routes read-only without a writer and shows export actions', async () => {
  open();
  expect(await screen.findByRole('heading', { name: 'My completed version' })).toBeInTheDocument();
  expect(screen.getByText('Preserved summary')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Continue editing' })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: /Deliverables & Exports/ })).toBeInTheDocument();
  expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
  expect(apiClient.saveTailoringDraft).not.toHaveBeenCalled(); expect(localStorage.length).toBe(0);
});
it('reuses the continuation operation after uncertain response and navigates the acknowledged child', async () => {
  const child = { ...done, record: { ...done.record, id: 'child', lifecycle: 'draft', completion: undefined, parentCompletionId: done.record.completion.outputId } };
  const proceed = vi.spyOn(apiClient, 'continueTailoringDraft').mockRejectedValueOnce(Error('Connection lost')).mockResolvedValue(child);
  const navigate = open(); fireEvent.click(await screen.findByRole('button', { name: 'Continue editing' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Connection lost');
  fireEvent.click(screen.getByRole('button', { name: 'Continue editing' }));
  await waitFor(() => expect(navigate).toHaveBeenCalledWith('/tailor/drafts/child'));
  expect(proceed.mock.calls[0][1]).toEqual(proceed.mock.calls[1][1]);
});

async function editable() {
  const { completion: _, ...record } = done.record;
  const draft = { ...done, record: { ...record, lifecycle: 'draft' } };
  vi.mocked(apiClient.getTailoringDraft).mockResolvedValue(draft);
  vi.mocked(apiClient.getResumes).mockResolvedValue([{ id: 'base', name: 'Base', type: 'template', spec }] as any);
  const navigate = open();
  await screen.findByRole('button', { name: 'Save Variant' });
  return { draft, navigate };
}
function saveVariant() {
  fireEvent.click(screen.getByRole('button', { name: 'Save Variant' }));
  fireEvent.change(screen.getByPlaceholderText('e.g. netflix-agent-platform'), { target: { value: 'My completed version' } });
  fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Save Variant' }));
}
it('completes the latest manual draft and opens the completed view instead of generic save', async () => {
  const saveResume = vi.spyOn(apiClient, 'saveResume');
  const complete = vi.spyOn(apiClient, 'completeTailoringDraft').mockResolvedValue({ ...done, completion: done.record.completion });
  const { draft, navigate } = await editable();
  vi.mocked(apiClient.saveTailoringDraft).mockImplementation(async (_id, input) => ({ ...draft, record: { ...draft.record, payload: input.payload, revision: 3 }, token: { revision: 3, fingerprint: 'latest' }, mutationId: input.mutationId } as any));
  fireEvent.change(screen.getByPlaceholderText(/Paste target job specification/), { target: { value: 'Latest posting' } });
  saveVariant();
  expect(await screen.findByRole('heading', { name: 'My completed version' })).toBeInTheDocument();
  expect(complete.mock.calls[0][1].expected).toEqual({ revision: 3, fingerprint: 'latest' });
  expect(saveResume).not.toHaveBeenCalled(); expect(navigate).toHaveBeenCalledWith(`/tailor/drafts/${done.record.id}`, true);
});
it('retains new manual edits across an uncertain completion retry', async () => {
  let reject!: (error: Error) => void;
  const complete = vi.spyOn(apiClient, 'completeTailoringDraft').mockImplementationOnce(() => new Promise((_resolve, fail) => { reject = fail; })).mockResolvedValue({ ...done, completion: done.record.completion });
  const alert = vi.spyOn(window, 'alert').mockImplementation(() => {});
  const { navigate } = await editable(); saveVariant();
  await waitFor(() => expect(complete).toHaveBeenCalledTimes(1));
  fireEvent.change(screen.getByPlaceholderText(/Paste target job specification/), { target: { value: 'Typing during completion' } });
  await act(async () => reject(Error('Connection lost')));
  await waitFor(() => expect(alert).toHaveBeenCalledTimes(1));
  fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Save Variant' }));
  await waitFor(() => expect(complete).toHaveBeenCalledTimes(2));
  expect(complete.mock.calls[0]).toEqual(complete.mock.calls[1]);
  expect(screen.getByDisplayValue('Typing during completion')).toBeInTheDocument();
  expect(navigate).not.toHaveBeenCalled();
  expect(Object.values(localStorage).join(' ')).toContain('Typing during completion');
  await waitFor(() => expect(screen.getByRole('button', { name: 'Keep mine as a separate draft' })).toBeEnabled());
  vi.mocked(apiClient.getTailoringDraft).mockResolvedValue(done);
  fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
  fireEvent.click(screen.getByRole('button', { name: 'Load newer version' }));
  expect(await screen.findByRole('heading', { name: 'My completed version' })).toBeInTheDocument();

});

it('shows named parent linkage and the complete human-readable profile', async () => {
  const parent = { ...done, record: { ...done.record, id: 'parent-draft' } };
  const child = { ...done, record: { ...done.record, parentCompletionId: done.record.completion.outputId, completion: { ...done.record.completion, outputId: 'child-output', spec: { ...spec, profile: { ...spec.profile, links: { website: 'https://example.com' } }, experiences: [{ company: 'Company', role: 'Engineer', location: 'Denver', startDate: '2020', endDate: 'Now', bullets: [] }], education: [{ institution: 'School', degree: 'BS', year: '2020', details: 'With honors' }] } } } };
  vi.mocked(apiClient.getTailoringDraft).mockResolvedValue(child);
  vi.mocked(apiClient.listTailoringDrafts).mockResolvedValue({ workspaceId: 'workspace', records: [parent, child], recoveryErrors: [] });
  const navigate = open();
  fireEvent.click(await screen.findByRole('button', { name: /Continued from My completed version/ }));
  expect(navigate).toHaveBeenCalledWith('/tailor/drafts/parent-draft');
  expect(screen.getByRole('link', { name: 'website' })).toHaveAttribute('href', 'https://example.com');
  expect(screen.getByText('Denver')).toBeInTheDocument(); expect(screen.getByText('With honors')).toBeInTheDocument();
});

it('shows existing preflight warnings on the completed version', async () => {
  vi.mocked(apiClient.runPreflight).mockResolvedValue({ isClean: false, danglingCitations: ['ev-missing'], metricIssues: [], violations: [] } as any);
  open(); expect(await screen.findByText('Pre-flight found issues to review.')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'View pre-flight report' })).toBeInTheDocument();
});

function runDetail(completed: boolean) {
  const step = { status: 'approved', completed_at: now, input_hash: null, error: null, raw_output: null };
  const record = { ...done.record, kind: 'run', runSlug: 'run', lifecycle: completed ? 'completed' : 'draft', payload: { proposalTextById: {}, artifactTokens: {} }, context: { selectedProposalId: 'missing' }, ...(completed ? {} : { completion: undefined }) };
  return { manifest: { slug: 'run', draft_id: record.id, title: 'Run', state: 'complete', runner: 'fake', model: 'fake', created: now, updated: now, finalized_path: completed ? done.record.completion.path : null, base_resume: 'base', steps: { analysis: step, alignment: step, proposals: step, brief: { ...step, status: 'done' } } }, draft: { record, token: done.token }, base_resume: spec, resume: spec, posting: 'Posting', brief_markdown: 'Brief', analysis: null, alignment: null, proposals: null } as any;
}
it('refreshes a completed run slug read-only without context autosave', async () => {
  vi.spyOn(apiClient, 'getTailoringRun').mockResolvedValue(runDetail(true));
  render(<TailoringRun slug="run" onBack={() => {}} onOpenDraft={() => {}} onOpenInCanvas={() => {}} />);
  expect(await screen.findByRole('heading', { name: 'My completed version' })).toBeInTheDocument();
  expect(apiClient.saveTailoringDraft).not.toHaveBeenCalled(); expect(localStorage.length).toBe(0);
});
it('finalizes the saved run through completion and navigates to its completed draft', async () => {
  const detail = runDetail(false); detail.draft.record.context = {};
  vi.spyOn(apiClient, 'getTailoringRun').mockResolvedValue(detail);
  const complete = vi.spyOn(apiClient, 'completeTailoringDraft').mockResolvedValue({ ...runDetail(true).draft, completion: done.record.completion });
  const finalize = vi.spyOn(apiClient, 'finalizeTailoringRun');
  const openDraft = vi.fn();
  render(<TailoringRun slug="run" selectedStep="brief" onBack={() => {}} onOpenDraft={openDraft} onOpenInCanvas={() => {}} />);
  fireEvent.click(await screen.findByRole('button', { name: 'Save resume' }));
  await waitFor(() => expect(openDraft).toHaveBeenCalledWith(done.record.id));
  expect(complete).toHaveBeenCalledTimes(1); expect(finalize).not.toHaveBeenCalled();
});

it('finishes a run at its existing draft URL without requiring navigation or reload', async () => {
  const detail = runDetail(false); detail.draft.record.context = { activeStep: 'brief' };
  vi.mocked(apiClient.getTailoringDraft).mockResolvedValue(detail.draft);
  vi.spyOn(apiClient, 'getTailoringRun').mockResolvedValue(detail);
  vi.spyOn(apiClient, 'completeTailoringDraft').mockResolvedValue({ ...runDetail(true).draft, completion: done.record.completion });
  const navigate = open();
  fireEvent.click(await screen.findByRole('button', { name: 'Save resume' }));
  expect(await screen.findByRole('button', { name: 'Continue editing' })).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: /Match your evidence/ })).not.toBeInTheDocument();
  expect(screen.getByRole('heading', { name: 'My completed version' })).toBeInTheDocument();
  expect(navigate).toHaveBeenCalledWith(`/tailor/drafts/${done.record.id}`);
  expect(apiClient.saveTailoringDraft).not.toHaveBeenCalled();
});
it('checks workspace identity after a delayed manual completion response before accepting it', async () => {
  let finish!: (result: any) => void;
  const complete = vi.spyOn(apiClient, 'completeTailoringDraft').mockImplementation(() => new Promise(resolve => { finish = resolve; }));
  vi.spyOn(window, 'alert').mockImplementation(() => {});
  const { navigate } = await editable(); saveVariant();
  await waitFor(() => expect(complete).toHaveBeenCalledTimes(1));
  fireEvent.change(screen.getByPlaceholderText(/Paste target job specification/), { target: { value: 'Retain this workspace content' } });
  const recovery = Object.values(localStorage).join(' ');
  vi.mocked(apiClient.getHealth).mockResolvedValue({ status: 'ok', workspaceDir: '/other', workspaceId: 'other-workspace' });
  await act(async () => finish({ ...done, completion: done.record.completion }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Workspace identity changed');
  expect(navigate).not.toHaveBeenCalled();
  expect(Object.values(localStorage).join(' ')).toBe(recovery);
  expect(screen.queryByRole('button', { name: 'Continue editing' })).not.toBeInTheDocument();
});
it('checks run identity after a delayed completion response before accepting it', async () => {
  const detail = runDetail(false); detail.draft.record.context = {};
  vi.spyOn(apiClient, 'getTailoringRun').mockResolvedValue(detail);
  const browser = new BrowserRecovery();
  const writer = new DraftCoordinator({ workspaceId: 'workspace', draftId: done.record.id, api: apiClient, recovery: browser });
  await writer.hydrate(detail.draft);
  let finish!: (result: any) => void;
  const complete = vi.spyOn(apiClient, 'completeTailoringDraft').mockImplementation(() => new Promise(resolve => { finish = resolve; }));
  const openDraft = vi.fn();
  render(<TailoringRun coordinator={writer} slug="run" selectedStep="brief" onBack={() => {}} onOpenDraft={openDraft} onOpenInCanvas={() => {}} />);
  fireEvent.click(await screen.findByRole('button', { name: 'Save resume' }));
  await waitFor(() => expect(complete).toHaveBeenCalledTimes(1));
  act(() => writer.updateContext({ mobilePane: 'context' }));
  const recovery = Object.values(localStorage).join(' ');
  vi.mocked(apiClient.getHealth).mockResolvedValue({ status: 'ok', workspaceDir: '/other', workspaceId: 'other-workspace' });
  await act(async () => finish({ ...runDetail(true).draft, completion: done.record.completion }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Workspace identity changed');
  expect(openDraft).not.toHaveBeenCalled();
  expect(writer.getSnapshot().record!.lifecycle).toBe('draft');
  expect(Object.values(localStorage).join(' ')).toBe(recovery);
  writer.dispose(); browser.dispose();
});

it.each(['manual draft', 'run slug'] as const)('exposes persisted newer recovery after reopening a completed %s without saving it', async route => {
  const detail = runDetail(true);
  const completed = route === 'manual draft' ? done : detail.draft;
  const { completion: _completion, ...original } = completed.record;
  const latest = { ...original, lifecycle: 'draft', payload: route === 'manual draft' ? { ...original.payload, jobDescription: 'Newest browser-only posting' } : { ...original.payload, proposalTextById: { orphan: 'Newest orphan proposal text' } } };
  const browser = new BrowserRecovery({ writerId: 'prior-tab' });
  const stored = browser.write({ workspaceId: 'workspace', draftId: done.record.id, writerId: browser.writerId, base: { revision: 1, fingerprint: 'before-completion' }, mutationId: 'newer-unacknowledged', localSequence: 3, savedAt: now, record: latest });
  expect(stored.ok).toBe(true); browser.dispose();
  const fork = vi.spyOn(apiClient, 'forkTailoringDraft').mockResolvedValue({ record: { ...latest, id: 'new-child' }, token: { revision: 1, fingerprint: 'child' } });
  let navigate;
  if (route === 'manual draft') navigate = open();
  else {
    vi.spyOn(apiClient, 'getTailoringRun').mockResolvedValue(detail);
    navigate = vi.fn();
    render(<TailoringRun slug="run" onBack={() => {}} onOpenDraft={navigate} onOpenInCanvas={() => {}} />);
  }
  const preview = await screen.findByLabelText('Selected recovery content');
  expect((preview as HTMLTextAreaElement).value).toContain(route === 'manual draft' ? 'Newest browser-only posting' : 'Newest orphan proposal text');
  const snapshots = Object.values(localStorage).join(' ');
  await new Promise(resolve => setTimeout(resolve, 650));
  expect(apiClient.saveTailoringDraft).not.toHaveBeenCalled();
  expect(Object.values(localStorage).join(' ')).toBe(snapshots);
  fireEvent.click(screen.getByRole('button', { name: 'Keep mine as a separate draft' }));
  await waitFor(() => expect(fork).toHaveBeenCalled());
  expect(fork.mock.calls[0][1].sourceSnapshot.payload).toEqual(latest.payload);
  expect(navigate).toHaveBeenCalledWith(route === 'manual draft' ? '/tailor/drafts/new-child' : 'new-child');
});
it('allows explicitly loading the completed version while retaining other unselected browser copies', async () => {
  const { completion: _completion, ...original } = done.record;
  const browser = new BrowserRecovery({ writerId: 'prior-tab' });
  for (const writerId of ['prior-tab', 'other-tab']) expect(browser.write({ workspaceId: 'workspace', draftId: done.record.id, writerId, base: done.token, mutationId: writerId, localSequence: 3, savedAt: now, record: { ...original, lifecycle: 'draft', payload: { ...original.payload, jobDescription: `Recovery from ${writerId}` } } }).ok).toBe(true);
  browser.dispose(); open();
  fireEvent.click(await screen.findByLabelText(/Browser version 1/));
  expect((screen.getByLabelText('Selected recovery content') as HTMLTextAreaElement).value).toContain('Recovery from prior-tab');
  fireEvent.click(screen.getByRole('button', { name: 'Load newer version' }));
  await waitFor(() => expect(screen.queryByLabelText('Selected recovery content')).not.toBeInTheDocument());
  expect(screen.getByRole('button', { name: 'Continue editing' })).toBeInTheDocument();
  expect(Object.values(localStorage).join(' ')).toContain('Recovery from other-tab');
  expect(apiClient.saveTailoringDraft).not.toHaveBeenCalled();
});

it('conditionally clears an acknowledged matching browser copy without creating a recovery conflict', async () => {
  const { completion: _completion, ...original } = done.record;
  const browser = new BrowserRecovery({ writerId: 'acknowledged-tab' });
  expect(browser.write({ workspaceId: 'workspace', draftId: done.record.id, writerId: browser.writerId, base: { revision: 1, fingerprint: 'prior' }, mutationId: 'acknowledged-copy', localSequence: 1, savedAt: now, record: { ...original, lifecycle: 'draft' } }).ok).toBe(true);
  browser.dispose(); open();
  expect(await screen.findByRole('button', { name: 'Continue editing' })).toBeInTheDocument();
  await waitFor(() => expect(localStorage.length).toBe(0));
  expect(screen.queryByLabelText('Selected recovery content')).not.toBeInTheDocument();
  expect(apiClient.saveTailoringDraft).not.toHaveBeenCalled();
});
