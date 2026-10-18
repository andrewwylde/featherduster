/** @vitest-environment jsdom */
import '@testing-library/jest-dom/vitest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { EvidenceStore, type CorpusView, type Job, type SkillSupport } from '@featherduster/core';
import { apiClient } from '../src/api/client.js';
import { appliesTo, sameRelationship, scopeDescription, withdrawEffect, supportDescription, uniqueLabels, withdrawLabel } from '../src/components/corpus-labels.js';
import { CorpusKnowledgePanel } from '../src/components/CorpusKnowledgePanel.js';
import { JobRememberedSupport } from '../src/views/jobs/JobRememberedSupport.js';
import { JobEvidenceChooser } from '../src/views/jobs/JobEvidenceChooser.js';
import { formatDateTime } from '../src/views/jobs/job-utils.js';

vi.mock('../src/hooks/useLiveSync.js', () => ({ useLiveSync: vi.fn() }));
afterEach(() => { cleanup(); vi.restoreAllMocks(); });
/** Withdrawal is global, so it takes a second, inline confirmation. */
const withdrawThrough = (name: string, within_: { getByRole: typeof screen.getByRole } = screen) => {
  fireEvent.click(within_.getByRole('button', { name }));
  fireEvent.click(within_.getByRole('button', { name: `Confirm ${name[0].toLowerCase()}${name.slice(1)}` }));
};

const hash = '4da69137209d0e89c429ea6ef2ee49735269cdfbbe6677f8c799e2980d1846b0';
const support: SkillSupport = { skill: 'backend', facet: 'applications', permitted_terms: ['backend'], support: 'direct', scope: { kind: 'role', key: 'Platform Engineer' }, explanation: 'API work is backend work', sources: [{ evidence_id: 'synthetic-0', evidence_fingerprint: hash, quote: 'Built TypeScript APIs.' }] };
const titleOf = (id: string) => (id === 'synthetic-0' ? 'API delivery' : 'Missing source');
const job = { id: '09a37b4a-c118-4162-ac1f-a49e83445a54', workspace_id: 'w', revision: 1, company: 'Synthetic Example', role: 'Platform Engineer' } as Job;
const view = (state = 'active', extra: Partial<SkillSupport> = {}) => ({
  workspace_id: 'w', snapshot: { revision: 7 }, issues: [], support: [], evidence: [],
  records: [{ source: { id: 'synthetic-0', title: 'API delivery', narrative: 'Built TypeScript APIs.' }, fingerprint: hash, storage_kind: 'consolidated' }],
  history: [{ state, withdraw_url: '', update: { id: '459ec778-7578-4215-a2c1-aaf7d9bf3d47', feedback_id: 'f', recorded_at: '2026-10-17T20:27:57.547Z', change: { kind: 'skill_support', value: { ...support, ...extra } } } }],
  feedback: [{ update_id: '459ec778-7578-4215-a2c1-aaf7d9bf3d47', feedback: { id: 'f', recorded_by: 'local-human', recorded_at: '2026-10-17T20:27:57.547Z', job_id: job.id, explanation: 'Inspected relationship' } }],
}) as unknown as CorpusView;

describe('plain-language corpus labels', () => {
  it('describes scopes without JSON or ids', () => {
    expect(scopeDescription({ kind: 'workspace' })).toBe('all jobs');
    expect(scopeDescription({ kind: 'role', key: 'Platform Engineer' })).toBe('Platform Engineer roles');
    expect(scopeDescription({ kind: 'employer', key: 'Synthetic Example' })).toBe('jobs at Synthetic Example');
    expect(scopeDescription({ kind: 'project', key: 'Atlas' })).toBe('the Atlas project');
    expect(scopeDescription({ kind: 'job', key: 'j1' }, { currentJobId: 'j1' })).toBe('this job only');
    expect(scopeDescription({ kind: 'job', key: 'j1' })).toBe('only the job where it was remembered');
    expect(withdrawEffect({ kind: 'role', key: 'Platform Engineer' })).toBe('Withdrawing stops it being offered for all Platform Engineer roles.');
    expect(withdrawEffect({ kind: 'workspace' })).toBe('Withdrawing stops it being offered for every job.');
    expect(withdrawEffect({ kind: 'employer', key: 'Acme' })).toBe('Withdrawing stops it being offered for all jobs at Acme.');
    expect(withdrawEffect({ kind: 'job', key: 'j1' }, { currentJobId: 'j1' })).toBe('Withdrawing stops it being offered for this job only.');
    expect(appliesTo({ kind: 'employer', key: 'Synthetic Example' })).toBe('Applies to: jobs at Synthetic Example');
  });
  it('describes what is remembered and names withdrawals uniquely', () => {
    expect(supportDescription(support, titleOf)).toBe("'backend' is supported by: API delivery");
    expect(supportDescription({ ...support, support: 'transferable' }, titleOf)).toBe("'backend' is supported as transferable experience by: API delivery");
    expect(withdrawLabel(support)).toBe("Withdraw 'backend' for Platform Engineer roles");
    expect(uniqueLabels([{ label: 'a', detail: 'API delivery' }, { label: 'b' }, { label: 'a', detail: 'Migration' }])).toEqual(['a (from API delivery)', 'b', 'a (from Migration)']);
    // Same wording and same source: fall back to an ordinal so names stay unique.
    expect(uniqueLabels([{ label: 'a', detail: 'X' }, { label: 'a', detail: 'X' }])).toEqual(['a (from X)', 'a (from X) (2)']);
  });
  it('treats different permitted terms or support levels as different relationships', () => {
    expect(sameRelationship(support, { ...support, permitted_terms: ['backend'] })).toBe(true);
    expect(sameRelationship({ ...support, permitted_terms: ['APIs', 'backend'] }, { ...support, permitted_terms: ['backend', 'APIs'] })).toBe(true);
    expect(sameRelationship(support, { ...support, permitted_terms: ['backend', 'APIs'] })).toBe(false);
    expect(sameRelationship(support, { ...support, support: 'transferable' })).toBe(false);
  });
});

describe('Skills page remembered knowledge', () => {
  it('shows human descriptions, keeps provenance behind Details, and names Withdraw after the relationship', async () => {
    vi.spyOn(apiClient, 'getCorpus').mockResolvedValue(view());
    const withdraw = vi.spyOn(apiClient, 'withdrawCorpusChange').mockResolvedValue({ result: {} as never, replayed: false });
    render(<CorpusKnowledgePanel />);
    const article = (await screen.findByText("'backend' is supported by: API delivery")).closest('article')!;
    expect(article).toHaveTextContent('Applies to: Platform Engineer roles');
    expect(article).toHaveTextContent('API delivery: Built TypeScript APIs.');
    const details = within(article).getByText('Details').closest('details')!;
    // Visible text outside the disclosure has no JSON, ids or hashes.
    const outside = article.cloneNode(true) as HTMLElement; outside.querySelectorAll('details').forEach(d => d.remove());
    for (const raw of ['"kind"', hash, 'synthetic-0', '459ec778', job.id]) expect(outside.textContent).not.toContain(raw);
    expect(details).toHaveTextContent(hash);
    expect(details).toHaveTextContent('459ec778-7578-4215-a2c1-aaf7d9bf3d47');
    withdrawThrough("Withdraw 'backend' for Platform Engineer roles");
    await waitFor(() => expect(withdraw).toHaveBeenCalledWith('459ec778-7578-4215-a2c1-aaf7d9bf3d47', expect.objectContaining({ expected_revision: 7 })));
  });
  it('warns about the scope and confirms inline before withdrawing on the Skills page', async () => {
    vi.spyOn(apiClient, 'getCorpus').mockResolvedValue(view());
    const withdraw = vi.spyOn(apiClient, 'withdrawCorpusChange').mockResolvedValue({ result: {} as never, replayed: false });
    render(<CorpusKnowledgePanel />);
    expect(await screen.findByText(/Withdrawing stops it being offered for all Platform Engineer roles\./)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: "Withdraw 'backend' for Platform Engineer roles" }));
    expect(withdraw).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: "Confirm withdraw 'backend' for Platform Engineer roles" }));
    await waitFor(() => expect(withdraw).toHaveBeenCalledTimes(1));
  });
  it('tells same-reading withdrawals apart by their source', async () => {
    const v = view();
    v.records.push({ source: { id: 'synthetic-1', title: 'Migration', narrative: 'Migrated a service.' }, fingerprint: hash, storage_kind: 'consolidated' } as never);
    v.history.push({ ...v.history[0], update: { ...v.history[0].update, id: '559ec778-7578-4215-a2c1-aaf7d9bf3d47', change: { kind: 'skill_support', value: { ...support, sources: [{ ...support.sources[0], evidence_id: 'synthetic-1' }] } } } });
    vi.spyOn(apiClient, 'getCorpus').mockResolvedValue(v);
    render(<CorpusKnowledgePanel />);
    expect(await screen.findByRole('button', { name: "Withdraw 'backend' for Platform Engineer roles (from API delivery)" })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: "Withdraw 'backend' for Platform Engineer roles (from Migration)" })).toBeInTheDocument();
  });
  it('formats when a relationship was remembered with the shared locale formatter', async () => {
    vi.spyOn(apiClient, 'getCorpus').mockResolvedValue(view());
    render(<CorpusKnowledgePanel />);
    await screen.findByText("'backend' is supported by: API delivery");
    const stamp = document.querySelector('time[datetime="2026-10-17T20:27:57.547Z"]')!;
    expect(stamp).toHaveTextContent(formatDateTime('2026-10-17T20:27:57.547Z'));
  });
});

describe('remembered support on a job', () => {
  it('states the offer plainly and withdraws it through the corpus API', async () => {
    vi.spyOn(apiClient, 'getCorpus').mockResolvedValue(view());
    const withdraw = vi.spyOn(apiClient, 'withdrawCorpusChange').mockResolvedValue({ result: {} as never, replayed: false });
    render(<JobRememberedSupport job={job} support={[support]} titleOf={titleOf} />);
    const region = screen.getByRole('region', { name: 'Remembered support' });
    expect(region).toHaveTextContent("Remembered support offered: 'backend' is supported by: API delivery. Applies to: Platform Engineer roles.");
    withdrawThrough("Withdraw 'backend' for Platform Engineer roles", within(region));
    await waitFor(() => expect(withdraw).toHaveBeenCalledWith('459ec778-7578-4215-a2c1-aaf7d9bf3d47', expect.objectContaining({ expected_revision: 7, change: expect.objectContaining({ kind: 'withdrawal', update_id: '459ec778-7578-4215-a2c1-aaf7d9bf3d47' }) })));
    expect(await within(region).findByText(/Withdrawn\. Future preparations will not offer it/)).toBeInTheDocument();
  });
  it('withdraws by the id in the job snapshot when the relationship was remembered on another job', async () => {
    // Remembered on job A; this job (B) only has it offered. A live look-alike with other terms must not be withdrawn.
    const elsewhere = view();
    elsewhere.feedback[0].feedback.job_id = 'aaaaaaaa-0000-4000-8000-000000000000';
    elsewhere.history.push({ state: 'active', withdraw_url: '', update: { ...elsewhere.history[0].update, id: 'decoy-update', change: { kind: 'skill_support', value: { ...support, permitted_terms: ['backend', 'Kafka'] } } } } as never);
    vi.spyOn(apiClient, 'getCorpus').mockResolvedValue(elsewhere);
    const withdraw = vi.spyOn(apiClient, 'withdrawCorpusChange').mockResolvedValue({ result: {} as never, replayed: false });
    const knowledge = { schema_version: 1, revision: 6, updates: [elsewhere.history[0].update] } as never;
    render(<JobRememberedSupport job={job} support={[support]} titleOf={titleOf} knowledge={knowledge} />);
    withdrawThrough("Withdraw 'backend' for Platform Engineer roles");
    await waitFor(() => expect(withdraw).toHaveBeenCalledTimes(1));
    expect(withdraw).toHaveBeenCalledWith('459ec778-7578-4215-a2c1-aaf7d9bf3d47', expect.objectContaining({ expected_revision: 7 }));
  });
  it('says it is already withdrawn when no active update remains', async () => {
    vi.spyOn(apiClient, 'getCorpus').mockResolvedValue(view('withdrawn'));
    const withdraw = vi.spyOn(apiClient, 'withdrawCorpusChange');
    render(<JobRememberedSupport job={job} support={[support]} titleOf={titleOf} />);
    withdrawThrough("Withdraw 'backend' for Platform Engineer roles");
    expect(await screen.findByText('Already withdrawn. Future preparations will not offer it.')).toBeInTheDocument();
    expect(withdraw).not.toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: /^Withdraw 'backend'/ })).not.toBeInTheDocument();
  });
  it('reports a partial failure across several ids and keeps the control to retry', async () => {
    const two = view();
    two.history.push({ ...two.history[0], update: { ...two.history[0].update, id: 'second-update' } });
    vi.spyOn(apiClient, 'getCorpus').mockResolvedValue(two);
    const withdraw = vi.spyOn(apiClient, 'withdrawCorpusChange').mockResolvedValueOnce({ result: { revision: 8 } as never, replayed: false }).mockRejectedValueOnce(new Error('Corpus revision changed'));
    render(<JobRememberedSupport job={job} support={[support]} titleOf={titleOf} />);
    withdrawThrough("Withdraw 'backend' for Platform Engineer roles");
    expect(await screen.findByText('Withdrew 1 of 2 matching relationships; Corpus revision changed. Try again to withdraw the rest.')).toBeInTheDocument();
    expect(withdraw.mock.calls.map(c => [c[0], c[1].expected_revision])).toEqual([['459ec778-7578-4215-a2c1-aaf7d9bf3d47', 7], ['second-update', 8]]);
    expect(screen.getByRole('button', { name: "Withdraw 'backend' for Platform Engineer roles" })).toBeEnabled();
  });
  it('leaves the job and its captured inputs untouched', async () => {
    vi.spyOn(apiClient, 'getCorpus').mockResolvedValue(view());
    vi.spyOn(apiClient, 'withdrawCorpusChange').mockResolvedValue({ result: {} as never, replayed: false });
    const untouched = (['getJob', 'getJobProposals', 'captureJobInputs', 'prepareJob', 'saveJobProposals', 'recoverJobProposals'] as const).map(name => vi.spyOn(apiClient, name));
    const captured = [structuredClone(support)];
    render(<JobRememberedSupport job={job} support={captured} titleOf={titleOf} />);
    withdrawThrough("Withdraw 'backend' for Platform Engineer roles");
    expect(await screen.findByText(/Withdrawn\. Future preparations will not offer it; this job keeps the inputs it captured\./)).toBeInTheDocument();
    for (const spy of untouched) expect(spy).not.toHaveBeenCalled();
    expect(captured).toEqual([support]);
    // The offer stays visible: this job's captured inputs still include it.
    expect(screen.getByText(/Remembered support offered: 'backend'/)).toBeInTheDocument();
  });
  it('warns that withdrawal affects the whole scope and asks for an inline confirmation', async () => {
    vi.spyOn(apiClient, 'getCorpus').mockResolvedValue(view());
    const withdraw = vi.spyOn(apiClient, 'withdrawCorpusChange').mockResolvedValue({ result: {} as never, replayed: false });
    const confirm = vi.spyOn(window, 'confirm');
    render(<JobRememberedSupport job={job} support={[support]} titleOf={titleOf} />);
    expect(screen.getByText('Withdrawing stops it being offered for all Platform Engineer roles. Jobs already prepared keep what they captured.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: "Withdraw 'backend' for Platform Engineer roles" }));
    expect(withdraw).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('button', { name: /^Confirm withdraw/ })).not.toBeInTheDocument();
    withdrawThrough("Withdraw 'backend' for Platform Engineer roles");
    await waitFor(() => expect(withdraw).toHaveBeenCalledTimes(1));
    expect(confirm).not.toHaveBeenCalled();
  });
  it('does not imply an offer when none applies', () => {
    const corpus = vi.spyOn(apiClient, 'getCorpus');
    render(<JobRememberedSupport job={job} support={[]} titleOf={titleOf} />);
    const region = screen.getByRole('region', { name: 'Remembered support' });
    expect(region).toHaveTextContent('No remembered relationships apply to this job.');
    expect(region).not.toHaveTextContent(/Remembered support offered/i);
    expect(corpus).not.toHaveBeenCalled();
  });
  it('lists and withdraws relationships remembered from this job when asked', async () => {
    vi.spyOn(apiClient, 'getCorpus').mockResolvedValue(view());
    const withdraw = vi.spyOn(apiClient, 'withdrawCorpusChange').mockResolvedValue({ result: {} as never, replayed: false });
    render(<JobRememberedSupport job={job} support={[]} titleOf={titleOf} />);
    const summary = screen.getByText('Remembered from this job');
    (summary.closest('details') as HTMLDetailsElement).open = true;
    fireEvent(summary.closest('details')!, new Event('toggle'));
    await screen.findByRole('button', { name: "Withdraw 'backend' for Platform Engineer roles" }); withdrawThrough("Withdraw 'backend' for Platform Engineer roles");
    await waitFor(() => expect(withdraw).toHaveBeenCalledWith('459ec778-7578-4215-a2c1-aaf7d9bf3d47', expect.anything()));
  });
});

it('labels remembered support in the evidence chooser as an offer', () => {
  const record = new EvidenceStore([{ entry: { id: 'synthetic-0', date: '2026-01-01', company: 'Synthetic Example', title: 'API delivery', summary: 'Built TypeScript APIs.', impact: 'x', themes: [], confidence: 'verified', in_flight: false, metrics: [], internal_references: [] }, narrative: 'Built TypeScript APIs.' }]).get('synthetic-0')!;
  render(<JobEvidenceChooser evidence={[record]} support={[{ ...support, scope: { kind: 'workspace' } }]} selected={[]} onChange={() => {}} onClose={() => {}} />);
  expect(screen.getByText(/Remembered support offered: 'backend' is supported by: API delivery/)).toBeInTheDocument();
  expect(screen.queryByText(/Human support/)).not.toBeInTheDocument();
});
