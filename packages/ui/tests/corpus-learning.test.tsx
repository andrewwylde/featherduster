/** @vitest-environment jsdom */
import '@testing-library/jest-dom/vitest';
import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { CorpusView } from '@featherduster/core';
import { apiClient } from '../src/api/client.js';
import { CorpusKnowledgePanel } from '../src/components/CorpusKnowledgePanel.js';
vi.mock('../src/hooks/useLiveSync.js', () => ({ useLiveSync: vi.fn() }));
afterEach(() => { cleanup(); vi.restoreAllMocks(); });
it('shows exact support and provenance and withdraws with revision binding', async () => {
  const view = { workspace_id: 'w', snapshot: { revision: 3 }, issues: [], records: [], history: [{ state: 'active', update: { id: 'u', feedback_id: 'f', recorded_at: '2026-01-01', change: { kind: 'skill_support', value: { skill: 'Backend', facet: 'APIs', permitted_terms: ['backend'], support: 'direct', scope: { kind: 'workspace' }, explanation: 'API work supports the term', sources: [{ evidence_id: 'ev-1', quote: 'Built APIs.', evidence_fingerprint: 'hash' }] } } } }], feedback: [{ update_id: 'u', feedback: { id: 'f', recorded_by: 'local-human', recorded_at: '2026-01-01', job_id: 'job-A', explanation: 'Reviewed correction' } }] } as unknown as CorpusView;
  vi.spyOn(apiClient, 'getCorpus').mockResolvedValue(view);
  const withdraw = vi.spyOn(apiClient, 'withdrawCorpusChange').mockResolvedValue({ result: {} as never, replayed: false });
  render(<CorpusKnowledgePanel evidenceId="ev-1" />);
  expect(await screen.findByText(/Backend/)).toBeInTheDocument();
  expect(screen.getAllByText(/Built APIs/).length).toBeGreaterThan(0);
  expect(screen.getByText(/local-human/)).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Withdraw u' }));
  await waitFor(() => expect(withdraw).toHaveBeenCalledWith('u', expect.objectContaining({ expected_revision: 3, explanation: 'Withdrawn by user', change: { kind: 'withdrawal', update_id: 'u', reason: 'Withdrawn by user' } })));
});

it('keeps amendment preview separate from save and marks new facts provisional', async () => {
  const { EvidenceCorrection } = await import('../src/components/EvidenceAmendmentEditor.js');
  const entry = { id: 'ev-1', date: '2026-01-01', company: 'Acme', title: 'APIs', summary: 'Built APIs', impact: 'Reliability', confidence: 'verified' as const, in_flight: false, themes: [], metrics: [], internal_references: [] };
  vi.spyOn(apiClient, 'getCorpus').mockResolvedValue({ workspace_id: 'w', snapshot: { revision: 4 }, records: [{ source: { ...entry, entry, narrative: 'Original' }, fingerprint: 'hash', storage_kind: 'consolidated' }] } as unknown as CorpusView);
  const preview = vi.spyOn(apiClient, 'previewCorpusChange').mockResolvedValue({ conflicts: [], confidence_changes: [] } as never);
  const save = vi.spyOn(apiClient, 'rememberCorpusChange').mockResolvedValue({ result: {} as never, replayed: false });
  render(<EvidenceCorrection entry={entry} narrative="Original" onSaved={() => {}} />);
  fireEvent.click(screen.getByText('Correct evidence with a companion amendment'));
  fireEvent.change(screen.getByLabelText('Corrected narrative'), { target: { value: 'Corrected API work' } });
  fireEvent.change(screen.getByLabelText('Amendment explanation'), { target: { value: 'Reviewed correction' } });
  fireEvent.click(screen.getByRole('button', { name: 'Preview companion amendment' }));
  await screen.findByRole('button', { name: 'Save companion amendment' });
  expect(save).not.toHaveBeenCalled();
  expect(preview.mock.calls[0][0]).toMatchObject({ expected_revision: 4, change: { kind: 'evidence_amendment', value: { base_fingerprint: 'hash', narrative: 'Corrected API work', entry: { confidence: 'provisional' } } } });
  fireEvent.click(screen.getByRole('button', { name: 'Save companion amendment' }));
  await waitFor(() => expect(save).toHaveBeenCalledWith(preview.mock.calls[0][0]));
});
