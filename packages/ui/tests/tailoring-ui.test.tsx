/**
 * @vitest-environment jsdom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { RunManifest } from '@featherduster/core';
import { ApiError, apiClient, type TailoringRunDetail } from '../src/api/client';
import { TailoringRunList } from '../src/views/tailoring/TailoringRunList';
import { TailoringRun } from '../src/views/tailoring/TailoringRun';
import { App } from '../src/App';

const step = (status: string) => ({ status, completed_at: null, input_hash: null, error: null, raw_output: null }) as any;

function manifest(overrides: Partial<RunManifest> = {}): RunManifest {
  return {
    slug: 'acme-staff',
    title: 'Acme — Staff Engineer',
    created: '2026-09-16T10:00:00.000Z',
    updated: '2026-09-16T10:05:00.000Z',
    runner: 'claude-code',
    model: '',
    base_resume: 'template-master',
    state: 'alignment_review',
    error: null,
    finalized_path: null,
    steps: { analysis: step('approved'), alignment: step('done'), proposals: step('pending'), brief: step('pending') },
    ...overrides,
  } as RunManifest;
}

const analysis = {
  company: 'Acme',
  role: 'Staff Engineer',
  seniority: 'Staff',
  mission: '',
  requirements: [
    { id: 'r1', tier: 'must', text: 'Go experience', quote: 'strong Go', terms: ['Go'] },
    { id: 'r2', tier: 'must', text: 'Kafka at scale', quote: 'Kafka at scale', terms: ['Kafka'] },
  ],
  boilerplate: [],
} as any;

const baseDetail = (): TailoringRunDetail => ({
  manifest: manifest(),
  posting: 'Staff Engineer at Acme\nWe need strong Go and Kafka at scale.',
  base_resume: {
    profile: { name: 'Sam', title: 'Engineer', email: 's@x.dev' },
    summary: 'Backend engineer.',
    experiences: [{ company: 'SampleCorp', role: 'Senior', startDate: '2022', endDate: 'Present', bullets: [{ text: 'Rewrote gateway in Go.' }] }],
    education: [],
    skills: [{ category: 'Languages', skills: ['Go', 'TypeScript'] }],
  },
  analysis,
  alignment: {
    rows: [
      { requirement_id: 'r1', classification: 'backed', citations: ['ev-002'], rationale: 'Gateway in Go.', adjacent_tool: '', candidate_confirmed: false, issues: [] },
      { requirement_id: 'r2', classification: 'gap', citations: [], rationale: 'None.', adjacent_tool: '', candidate_confirmed: false, issues: [] },
    ],
  },
  alignment_summary: { backed: 1, transferable: 0, gap: 1 },
  proposals: null,
  page_budget: null,
  resume: null,
  brief_markdown: null,
});

describe('Tailoring run list', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.spyOn(apiClient, 'listTailoringRuns').mockResolvedValue([{ ...manifest(), needs_review: true }]);
    vi.spyOn(apiClient, 'getRunners').mockResolvedValue({
      runners: [
        { id: 'claude-code', label: 'Claude Code', locality: 'cloud', model: '', isDefault: true, available: true, detail: '2.1.274 (Claude Code)' },
        { id: 'ollama', label: 'Ollama', locality: 'local', model: '', isDefault: false, available: false, detail: 'Ollama is not running' },
      ],
      consent: {},
    });
    vi.spyOn(apiClient, 'getResumes').mockResolvedValue([
      { id: 'template-master', name: 'master', type: 'template', filePath: 'resumes/templates/master.yaml', spec: baseDetail().base_resume! },
    ]);
  });
  afterEach(cleanup);

  it('lists runs with a needs-review badge and opens them', async () => {
    const onOpenRun = vi.fn();
    render(<TailoringRunList onOpenRun={onOpenRun} />);
    const card = await screen.findByRole('button', { name: /Acme — Staff Engineer/ });
    expect(within(card).getByText('Needs review')).toBeInTheDocument();
    expect(screen.getByText('1 need review')).toBeInTheDocument();
    fireEvent.click(card);
    expect(onOpenRun).toHaveBeenCalledWith('acme-staff');
  });

  it('creates a run from a handed-off posting with the default available runner', async () => {
    const create = vi.spyOn(apiClient, 'createTailoringRun').mockResolvedValue({ slug: 'new-run', manifest: manifest({ slug: 'new-run' }) });
    const onOpenRun = vi.fn();
    const consumed = vi.fn();
    const posting = 'Senior Platform Engineer at Globex. Must know Go and Kubernetes.';
    render(<TailoringRunList onOpenRun={onOpenRun} initialPosting={posting} onInitialPostingConsumed={consumed} />);

    const textarea = await screen.findByLabelText('Job posting');
    expect(textarea).toHaveValue(posting);
    expect(consumed).toHaveBeenCalled();
    await waitFor(() => expect(screen.getByLabelText('Model runner')).toHaveValue('claude-code'));
    expect(screen.getByText(/evidence is redacted with your privacy rules/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /Create run/ }));
    await waitFor(() =>
      expect(create).toHaveBeenCalledWith({ posting, base_resume: 'template-master', runner: 'claude-code', label: undefined })
    );
    expect(onOpenRun).toHaveBeenCalledWith('new-run');
  });
});

describe('Tailoring run workspace', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.spyOn(apiClient, 'getEvidence').mockResolvedValue([
      { id: 'ev-002', title: 'Gateway rewrite', company: 'SampleCorp', date: '2025-01-01', summary: 'Rewrote gateway.', impact: 'Cut CPU 30%.', themes: [], entry: { confidence: 'verified', metrics: [] } } as any,
      { id: 'ev-001', title: 'Async ingestion', company: 'SampleCorp', date: '2025-01-01', summary: 'RabbitMQ.', impact: '50k msgs/s.', themes: [], entry: { confidence: 'verified', metrics: [] } } as any,
    ]);
  });
  afterEach(cleanup);

  it('edits the alignment matrix and requires saving before approval', async () => {
    const detail = baseDetail();
    vi.spyOn(apiClient, 'getTailoringRun').mockResolvedValue(detail);
    const save = vi.spyOn(apiClient, 'saveTailoringStep').mockResolvedValue(detail);
    render(<TailoringRun slug="acme-staff" onBack={vi.fn()} onOpenInCanvas={vi.fn()} />);

    expect(await screen.findByRole('heading', { name: 'Match your evidence' })).toBeInTheDocument();
    const approve = screen.getByRole('button', { name: 'Approve & draft edits' });
    expect(approve).toBeEnabled();

    fireEvent.change(screen.getByLabelText('Classification for r2'), { target: { value: 'transferable' } });
    fireEvent.change(screen.getByLabelText('Add evidence to r2'), { target: { value: 'ev-001' } });
    expect(screen.getByRole('button', { name: 'Approve & draft edits' })).toBeDisabled();
    expect(screen.getByText('Save your edits first')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Save alignment edits' }));
    await waitFor(() => expect(save).toHaveBeenCalled());
    const [, stepName, payload] = save.mock.calls[0] as [string, string, any];
    expect(stepName).toBe('alignment');
    expect(payload.rows[1]).toMatchObject({ classification: 'transferable', citations: ['ev-001'] });
  });

  it('shows evidence detail when a citation chip is clicked', async () => {
    vi.spyOn(apiClient, 'getTailoringRun').mockResolvedValue(baseDetail());
    render(<TailoringRun slug="acme-staff" onBack={vi.fn()} onOpenInCanvas={vi.fn()} />);
    fireEvent.click(await screen.findByRole('button', { name: 'ev-002' }));
    const context = screen.getByRole('complementary', { name: 'Context' });
    expect(within(context).getByText('Gateway rewrite')).toBeInTheDocument();
  });

  it('disables accepting blocked proposals and saves decisions', async () => {
    const detail = baseDetail();
    detail.manifest = manifest({ state: 'proposal_review', steps: { analysis: step('approved'), alignment: step('approved'), proposals: step('done'), brief: step('pending') } as any });
    detail.proposals = [
      {
        id: 'p1', type: 'bullet.rewrite', target: { experience_index: 0, bullet_index: 0, skill_group_index: -1 },
        before: 'Rewrote gateway in Go.', after: 'Rewrote the API gateway in Go, cutting CPU 30%.', order: [], skills: [],
        citations: ['ev-002'], requirement_ids: ['r1'], rationale: 'Go first.', decision: 'pending', checks: [],
      },
      {
        id: 'p2', type: 'bullet.add', target: { experience_index: 0, bullet_index: 0, skill_group_index: -1 },
        before: '', after: 'Ran Kafka clusters.', order: [], skills: [], citations: ['ev-001'], requirement_ids: ['r2'], rationale: '',
        decision: 'pending', checks: [{ severity: 'block', kind: 'ledger_ceiling', message: 'Introduces terms not backed by cited evidence: Kafka.' }],
      },
    ] as any;
    vi.spyOn(apiClient, 'getTailoringRun').mockResolvedValue(detail);
    const save = vi.spyOn(apiClient, 'saveTailoringStep').mockResolvedValue(detail);
    render(<TailoringRun slug="acme-staff" onBack={vi.fn()} onOpenInCanvas={vi.fn()} />);

    const blocked = await screen.findByRole('listitem', { name: /Proposal p2/ });
    expect(within(blocked).getByRole('button', { name: /Accept/ })).toBeDisabled();
    expect(within(blocked).getByText(/not backed by cited evidence: Kafka/)).toBeInTheDocument();
    expect(screen.getByText('Decide on 2 pending edit(s)')).toBeInTheDocument();

    const ok = screen.getByRole('listitem', { name: /Proposal p1/ });
    expect(within(ok).getByText('the API')).toBeInTheDocument(); // inserted words highlighted in the diff
    fireEvent.click(within(ok).getByRole('button', { name: /Accept/ }));
    await waitFor(() => expect(save).toHaveBeenCalled());
    const payload = save.mock.calls[0][2] as any;
    expect(payload.proposals.find((p: any) => p.id === 'p1').decision).toBe('accepted');
  });

  it('asks for consent with a redacted preview before the first cloud call', async () => {
    const detail = baseDetail();
    detail.manifest = manifest({ state: 'draft', steps: { analysis: step('pending'), alignment: step('pending'), proposals: step('pending'), brief: step('pending') } as any });
    detail.analysis = null;
    detail.alignment = null;
    vi.spyOn(apiClient, 'getTailoringRun').mockResolvedValue(detail);
    const run = vi
      .spyOn(apiClient, 'runTailoringStep')
      .mockRejectedValueOnce(new ApiError('Consent is required', 403, 'consent_required'))
      .mockResolvedValueOnce({ started: true });
    vi.spyOn(apiClient, 'previewTailoringStep').mockResolvedValue({
      runner: 'Claude Code', locality: 'cloud', system: 'sys', prompt: '## Job Posting\nWe need strong Go (Enterprise Client)',
    });
    const grant = vi.spyOn(apiClient, 'grantRunnerConsent').mockResolvedValue({ success: true });

    render(<TailoringRun slug="acme-staff" onBack={vi.fn()} onOpenInCanvas={vi.fn()} />);
    fireEvent.click(await screen.findByRole('button', { name: /Run break down the posting/ }));

    const dialog = await screen.findByRole('dialog', { name: /Send redacted evidence to Claude Code/ });
    expect(within(dialog).getByText(/Enterprise Client/)).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Allow & run' }));
    await waitFor(() => expect(grant).toHaveBeenCalledWith('claude-code'));
    await waitFor(() => expect(run).toHaveBeenCalledTimes(2));
  });

  it('renders mobile sticky pane switcher and mobile-optimized action ledge', async () => {
    vi.spyOn(apiClient, 'getTailoringRun').mockResolvedValue(baseDetail());
    render(<TailoringRun slug="acme-staff" onBack={vi.fn()} onOpenInCanvas={vi.fn()} />);

    // Pane tabs for mobile
    const tablist = await screen.findByRole('tablist', { name: 'Run panes' });
    expect(tablist).toHaveClass('sticky');
    const tabs = within(tablist).getAllByRole('tab');
    expect(tabs).toHaveLength(3);

    // Classification dropdown has touch-friendly class
    const select = screen.getByLabelText('Classification for r1');
    expect(select).toHaveClass('min-h-[36px]');

    // Step action bar has sticky bottom styling
    const approveBtn = screen.getByRole('button', { name: 'Approve & draft edits' });
    expect(approveBtn.parentElement).toHaveClass('sticky');
    expect(approveBtn.parentElement).toHaveClass('bottom-0');
  });
});

describe('Tailor routes', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.spyOn(apiClient, 'getHealth').mockResolvedValue({ status: 'ok', workspaceDir: 'C:/workspace' });
    vi.spyOn(apiClient, 'getIntegrityCheck').mockResolvedValue({ isClean: true, issues: [] });
    vi.spyOn(apiClient, 'getRubrics').mockResolvedValue([]);
    vi.spyOn(apiClient, 'getEvidence').mockResolvedValue([]);
    vi.spyOn(apiClient, 'getResumes').mockResolvedValue([]);
    vi.spyOn(apiClient, 'listTailoringRuns').mockResolvedValue([]);
    vi.spyOn(apiClient, 'getRunners').mockResolvedValue({ runners: [], consent: {} });
    vi.spyOn(apiClient, 'getTailoringRun').mockResolvedValue(baseDetail());
  });
  afterEach(() => {
    cleanup();
    window.history.replaceState({}, '', '/');
  });

  it('renders the Tailor list at /tailor as a first-class nav item', async () => {
    window.history.replaceState({}, '', '/tailor');
    render(<App />);
    expect(await screen.findByRole('link', { name: 'Tailor' })).toHaveAttribute('aria-current', 'page');
    expect(await screen.findByRole('heading', { name: 'Tailor your resume to a job' })).toBeInTheDocument();
  });

  it('deep-links to a run at /tailor/:slug', async () => {
    window.history.replaceState({}, '', '/tailor/acme-staff');
    render(<App />);
    expect(await screen.findByRole('heading', { name: 'Acme — Staff Engineer' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /All runs/ }));
    expect(window.location.pathname).toBe('/tailor');
  });
});
