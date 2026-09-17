/**
 * @vitest-environment jsdom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { ApiError, apiClient } from '../src/api/client';
import { EvidenceStrengthener } from '../src/views/desk/EvidenceStrengthener';
import { strengthenPrompts } from '../src/views/desk/strengthenPrompts';
import { makeRecord } from './fixtures/deskRecords';

const gappy = makeRecord({
  id: 'ev-010',
  title: 'Latency work',
  impact: 'Cut p99 by [METRIC NEEDED].',
  confidence: 'provisional',
  metrics: [{ name: 'p99 reduction', value: '[METRIC NEEDED]', status: 'METRIC NEEDED' }],
});

describe('strengthenPrompts', () => {
  it('asks only about real gaps', () => {
    const ids = strengthenPrompts(gappy.entry, '').map((p) => p.id);
    expect(ids).toEqual(['metric', 'verify-metrics', 'references', 'confidence', 'narrative']);
    const complete = makeRecord({ internal_references: [{ type: 'pr', ref: '#1' }] }, 'x'.repeat(120));
    expect(strengthenPrompts(complete.entry, complete.narrative)).toEqual([]);
  });
});

describe('EvidenceStrengthener', () => {
  beforeEach(() => vi.restoreAllMocks());
  afterEach(cleanup);

  it('shows prompts for the selected entry and saves edits via updateEvidence', async () => {
    const update = vi.spyOn(apiClient, 'updateEvidence').mockResolvedValue({ success: true, entry: gappy.entry, filePath: 'evidence/acme/ev-010.md' });
    const onSaved = vi.fn();
    render(<EvidenceStrengthener record={gappy} onBack={vi.fn()} onSaved={onSaved} />);

    expect(screen.getByRole('heading', { name: /Strengthen evidence/i })).toBeInTheDocument();
    expect(screen.getByText('What number shows the change?')).toBeInTheDocument();
    expect(screen.queryByText(/The Editor/)).not.toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('Impact'), { target: { value: 'Cut p99 by 40%.' } });
    fireEvent.change(screen.getByLabelText('Metric 1 value'), { target: { value: '40%' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save to ledger file' }));

    await waitFor(() => expect(update).toHaveBeenCalled());
    const [id, entry] = update.mock.calls[0];
    expect(id).toBe('ev-010');
    expect(entry.impact).toBe('Cut p99 by 40%.');
    expect(entry.metrics[0].value).toBe('40%');
    expect(entry.confidence).toBe('provisional');
    expect(onSaved).toHaveBeenCalled();
  });

  it('warns when a metric is marked verified without any reference', () => {
    render(<EvidenceStrengthener record={gappy} onBack={vi.fn()} onSaved={vi.fn()} />);
    fireEvent.change(screen.getByLabelText('Metric 1 status'), { target: { value: 'verified' } });
    expect(screen.getByText(/marked verified but the entry has no references/i)).toBeInTheDocument();
  });

  it('explains ledger-backed entries instead of overwriting them', async () => {
    vi.spyOn(apiClient, 'updateEvidence').mockRejectedValue(
      new ApiError('ev-010 lives in the consolidated ledger companies/acme/evidence/evidence-ledger.md.', 409, 'ledger_entry')
    );
    render(<EvidenceStrengthener record={gappy} onBack={vi.fn()} onSaved={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Save to ledger file' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('companies/acme/evidence/evidence-ledger.md');
  });
  it('tells the user up front when an entry lives in a consolidated ledger', () => {
    const ledgerBacked = { ...gappy, filePath: String.raw`C:\career\companies\acme\evidence\evidence-ledger.md` };
    render(<EvidenceStrengthener record={ledgerBacked} onBack={vi.fn()} onSaved={vi.fn()} />);
    expect(screen.getByRole('note')).toHaveTextContent(/consolidated ledger/);
    expect(screen.getByRole('button', { name: 'Save to ledger file' })).toBeDisabled();
  });
});
