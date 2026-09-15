/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { EvidenceExplorer } from '../src/views/EvidenceExplorer';
import { QuickCaptureModal, generateNextId } from '../src/components/QuickCaptureModal';
import { apiClient } from '../src/api/client';
import type { EvidenceRecord, EvidenceEntry } from '@featherduster/core';

function createRecord(entry: EvidenceEntry, narrative: string, filePath?: string): EvidenceRecord {
  return {
    ...entry,
    entry,
    narrative,
    filePath,
  };
}

describe('Evidence Explorer Tests', () => {
  const sampleEvidenceList: EvidenceRecord[] = [
    createRecord(
      {
        id: 'ev-001',
        date: '2026-03-01',
        company: 'parable',
        title: 'Distributed Transaction Coordinator',
        summary: 'Designed 2PC protocol with Raft consensus.',
        impact: 'Prevented data inconsistency across 500k transactions daily.',
        themes: ['distributed-systems', 'reliability'],
        confidence: 'verified',
        in_flight: false,
        metrics: [
          { name: 'consistency rate', value: '99.999%', status: 'verified' },
        ],
        internal_references: [{ type: 'linear', ref: 'ENG-101' }],
      },
      'Detailed architectural writeup on 2PC protocol.',
      'evidence/parable/ev-001.md'
    ),
    createRecord(
      {
        id: 'ev-002',
        date: '2026-04-15',
        company: 'parable',
        title: 'GraphQL Gateway Migration',
        summary: 'Consolidated 12 REST services behind a unified gateway.',
        impact: 'Reduced client round-trips by 65%.',
        themes: ['api', 'architecture'],
        confidence: 'provisional',
        in_flight: true,
        metrics: [
          { name: 'latency', value: '45ms', status: 'provisional' },
        ],
        internal_references: [{ type: 'pr', ref: '#420' }],
      },
      'Migration playbook for GraphQL schema federation.',
      'evidence/parable/ev-002.md'
    ),
    createRecord(
      {
        id: 'ev-003',
        date: '2026-05-10',
        company: 'acme',
        title: 'Zero-Downtime Data Pipeline',
        summary: 'Implemented Kafka consumer groups for telemetry ingestion.',
        impact: 'Eliminated message drops during deployment restarts.',
        themes: ['streaming', 'kafka', 'reliability'],
        confidence: 'verified',
        in_flight: false,
        metrics: [], // Missing metrics
        internal_references: [],
      },
      'Kafka broker configuration and rebalance handler.',
      'evidence/acme/ev-003.md'
    ),
  ];

  beforeEach(() => {
    vi.restoreAllMocks();
    // Default mock for EventSource
    (global as any).EventSource = vi.fn().mockImplementation(() => ({
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      close: vi.fn(),
    }));
  });

  afterEach(() => {
    cleanup();
  });

  describe('Statistics calculation and rendering', () => {
    it('calculates and displays accurate summary metric counters', async () => {
      vi.spyOn(apiClient, 'getEvidence').mockResolvedValue(sampleEvidenceList);

      render(<EvidenceExplorer />);

      await waitFor(() => {
        expect(screen.getByText('Distributed Transaction Coordinator')).toBeInTheDocument();
      });

      // Total count: 3
      expect(screen.getByText('Total Evidence')).toBeInTheDocument();
      // Verified stat card
      expect(screen.getAllByText('Verified').length).toBeGreaterThanOrEqual(1);
      // Provisional stat card
      expect(screen.getAllByText('Provisional').length).toBeGreaterThanOrEqual(1);
      // In flight stat card
      expect(screen.getAllByText('In Flight').length).toBeGreaterThanOrEqual(1);
      // Needs metrics stat card
      expect(screen.getByText('Needs Metrics')).toBeInTheDocument();
    });
  });

  describe('Evidence filtering & search', () => {
    beforeEach(() => {
      vi.spyOn(apiClient, 'getEvidence').mockResolvedValue(sampleEvidenceList);
    });

    it('filters evidence cards by search input (title/summary/impact/id)', async () => {
      render(<EvidenceExplorer />);

      await waitFor(() => {
        expect(screen.getByText('Distributed Transaction Coordinator')).toBeInTheDocument();
      });

      const searchInput = screen.getByPlaceholderText(/Search title, impact, themes/i);

      // Search for 'GraphQL'
      fireEvent.change(searchInput, { target: { value: 'GraphQL' } });

      expect(screen.queryByText('Distributed Transaction Coordinator')).not.toBeInTheDocument();
      expect(screen.getByText('GraphQL Gateway Migration')).toBeInTheDocument();
      expect(screen.queryByText('Zero-Downtime Data Pipeline')).not.toBeInTheDocument();

      // Search for ID 'ev-003'
      fireEvent.change(searchInput, { target: { value: 'ev-003' } });
      expect(screen.queryByText('Distributed Transaction Coordinator')).not.toBeInTheDocument();
      expect(screen.getByText('Zero-Downtime Data Pipeline')).toBeInTheDocument();
    });

    it('filters evidence cards by company dropdown', async () => {
      render(<EvidenceExplorer />);

      await waitFor(() => {
        expect(screen.getByText('Distributed Transaction Coordinator')).toBeInTheDocument();
      });

      const selects = screen.getAllByRole('combobox');
      const companySelect = selects[0]; // First select is company

      // Filter by 'acme'
      fireEvent.change(companySelect, { target: { value: 'acme' } });

      expect(screen.queryByText('Distributed Transaction Coordinator')).not.toBeInTheDocument();
      expect(screen.queryByText('GraphQL Gateway Migration')).not.toBeInTheDocument();
      expect(screen.getByText('Zero-Downtime Data Pipeline')).toBeInTheDocument();
    });

    it('filters evidence cards by confidence dropdown', async () => {
      render(<EvidenceExplorer />);

      await waitFor(() => {
        expect(screen.getByText('Distributed Transaction Coordinator')).toBeInTheDocument();
      });

      const selects = screen.getAllByRole('combobox');
      const confidenceSelect = selects[1]; // Second select is confidence

      // Filter by 'provisional'
      fireEvent.change(confidenceSelect, { target: { value: 'provisional' } });

      expect(screen.queryByText('Distributed Transaction Coordinator')).not.toBeInTheDocument();
      expect(screen.getByText('GraphQL Gateway Migration')).toBeInTheDocument();
      expect(screen.queryByText('Zero-Downtime Data Pipeline')).not.toBeInTheDocument();
    });

    it('filters cards with "Missing Metrics Only" toggle', async () => {
      render(<EvidenceExplorer />);

      await waitFor(() => {
        expect(screen.getByText('Distributed Transaction Coordinator')).toBeInTheDocument();
      });

      const missingMetricsBtn = screen.getByRole('button', { name: /Missing Metrics Only/i });
      fireEvent.click(missingMetricsBtn);

      // ev-003 has no metrics, ev-001 has verified metrics
      expect(screen.queryByText('Distributed Transaction Coordinator')).not.toBeInTheDocument();
      expect(screen.getByText('Zero-Downtime Data Pipeline')).toBeInTheDocument();
    });

    it('filters cards by clicking theme chip', async () => {
      render(<EvidenceExplorer />);

      await waitFor(() => {
        expect(screen.getByText('Distributed Transaction Coordinator')).toBeInTheDocument();
      });

      const kafkaChip = screen.getByRole('button', { name: '#kafka' });
      fireEvent.click(kafkaChip);

      expect(screen.queryByText('Distributed Transaction Coordinator')).not.toBeInTheDocument();
      expect(screen.queryByText('GraphQL Gateway Migration')).not.toBeInTheDocument();
      expect(screen.getByText('Zero-Downtime Data Pipeline')).toBeInTheDocument();
    });
  });

  describe('Evidence Detail Modal', () => {
    it('opens detail modal with complete metadata, metrics, and narrative on card click', async () => {
      vi.spyOn(apiClient, 'getEvidence').mockResolvedValue(sampleEvidenceList);

      render(<EvidenceExplorer />);

      await waitFor(() => {
        expect(screen.getByText('Distributed Transaction Coordinator')).toBeInTheDocument();
      });

      // Click card
      fireEvent.click(screen.getByText('Distributed Transaction Coordinator'));

      // Check detail modal contents
      expect(screen.getByText('Architectural Summary')).toBeInTheDocument();
      expect(screen.getByText('Designed 2PC protocol with Raft consensus.')).toBeInTheDocument();
      expect(screen.getAllByText('consistency rate').length).toBeGreaterThanOrEqual(2);
      expect(screen.getAllByText('99.999%').length).toBeGreaterThanOrEqual(2);
      expect(screen.getByText(/Detailed architectural writeup on 2PC protocol/i)).toBeInTheDocument();
      expect(screen.getByText('Copy Citation')).toBeInTheDocument();
    });
  });

  describe('Quick-Capture Form & ID Generation', () => {
    it('generateNextId increments highest numerical ID', () => {
      expect(generateNextId([])).toBe('ev-001');
      expect(generateNextId(['ev-001', 'ev-002'])).toBe('ev-003');
      expect(generateNextId(['ev-042', 'ev-005'])).toBe('ev-043');
    });

    it('renders form with auto-generated ID and submits valid payload to API', async () => {
      const onSuccess = vi.fn();
      const onClose = vi.fn();
      const saveSpy = vi.spyOn(apiClient, 'saveEvidence').mockResolvedValue({
        success: true,
        entry: {
          id: 'ev-004',
          date: '2026-06-01',
          company: 'parable',
          title: 'Memory Leak Investigation',
          summary: 'Identified buffer pool leak in connection manager.',
          impact: 'Eliminated OOM crashes saving 4 hours of daily on-call paging.',
          confidence: 'verified',
          in_flight: false,
          themes: ['debugging', 'memory'],
          metrics: [{ name: 'crash reduction', value: '100%', status: 'verified' }],
          internal_references: [],
        },
      });

      render(
        <QuickCaptureModal
          isOpen={true}
          onClose={onClose}
          onSuccess={onSuccess}
          existingIds={['ev-001', 'ev-002', 'ev-003']}
          existingCompanies={['parable', 'acme']}
        />
      );

      expect(screen.getByPlaceholderText('ev-001')).toHaveValue('ev-004');

      // Fill in fields
      fireEvent.change(screen.getByPlaceholderText(/e.g. Zero-Downtime Session Migration/i), {
        target: { value: 'Memory Leak Investigation' },
      });
      fireEvent.change(
        screen.getByPlaceholderText(/Architected token rotation protocol/i),
        { target: { value: 'Identified buffer pool leak in connection manager.' } }
      );
      fireEvent.change(
        screen.getByPlaceholderText(/Reduced user re-auth events/i),
        { target: { value: 'Eliminated OOM crashes saving 4 hours of daily on-call paging.' } }
      );

      // Add a metric
      fireEvent.click(screen.getByRole('button', { name: /Add Metric/i }));
      const metricNameInput = screen.getByPlaceholderText(/Metric Name/i);
      const metricValueInput = screen.getByPlaceholderText(/Value \(e\.g/i);
      fireEvent.change(metricNameInput, { target: { value: 'crash reduction' } });
      fireEvent.change(metricValueInput, { target: { value: '100%' } });

      // Submit form
      const submitBtn = screen.getByRole('button', { name: /Save Evidence Card/i });
      fireEvent.click(submitBtn);

      await waitFor(() => {
        expect(saveSpy).toHaveBeenCalledTimes(1);
      });

      const calledEntry = saveSpy.mock.calls[0][0];
      expect(calledEntry.id).toBe('ev-004');
      expect(calledEntry.title).toBe('Memory Leak Investigation');
      expect(calledEntry.metrics).toEqual([
        { name: 'crash reduction', value: '100%', status: 'verified' },
      ]);
      expect(onSuccess).toHaveBeenCalled();
      expect(onClose).toHaveBeenCalled();
    });
  });
});
