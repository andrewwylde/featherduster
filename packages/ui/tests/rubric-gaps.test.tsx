/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { RubricGapMatrix } from '../src/views/RubricGapMatrix';
import { RubricImporterModal } from '../src/components/RubricImporterModal';
import { BragDocModal } from '../src/components/BragDocModal';
import { apiClient } from '../src/api/client';
import type {
  EvidenceRecord,
  LevelingRubric,
  RubricGapAnalysis,
} from '@featherduster/core';

describe('Rubric Gap Matrix & Brag Doc Generator Tests', () => {
  const sampleRubric: LevelingRubric = {
    id: 'engineering-ic',
    title: 'Software Engineering IC Rubric',
    target_level: 'L5',
    levels: [
      { id: 'L4', name: 'Senior Software Engineer' },
      { id: 'L5', name: 'Staff Software Engineer' },
      { id: 'L6', name: 'Principal Software Engineer' },
    ],
    competencies: [
      {
        id: 'architecture-scope',
        name: 'System Architecture & Scope',
        levels: {
          L4: 'Designs single-service subsystems with minimal supervision.',
          L5: 'Architects multi-service platforms and distributed systems.',
          L6: 'Defines org-wide technical vision and architectural governance.',
        },
        evidence_mapped: [
          { ev_id: 'ev-101', relevance: 'primary' },
        ],
      },
      {
        id: 'execution-delivery',
        name: 'Execution & Delivery',
        levels: {
          L4: 'Drives multi-week project milestones.',
          L5: 'Orchestrates cross-team initiatives with sustainable velocity.',
          L6: 'Directs strategic multi-quarter company programs.',
        },
        evidence_mapped: [
          { ev_id: 'ev-102', relevance: 'primary' },
        ],
      },
      {
        id: 'mentorship-multipliers',
        name: 'Mentorship & Multipliers',
        levels: {
          L4: 'Mentors junior engineers on the team.',
          L5: 'Sponsors senior engineers and leads engineering guilds.',
          L6: 'Sets engineering culture and hiring bars org-wide.',
        },
        evidence_mapped: [], // 0 evidence mapped = Gap
      },
    ],
  };

  const sampleEvidenceList: EvidenceRecord[] = [
    {
      id: 'ev-101',
      date: '2026-02-15',
      company: 'cloudmatrix',
      title: 'Global Auth Mesh Architecture',
      summary: 'Architected distributed token issuance mesh across 4 edge clusters.',
      impact: 'Eliminated auth latency spikes, maintaining p99 under 8ms globally.',
      themes: ['distributed-systems', 'architecture'],
      confidence: 'verified',
      in_flight: false,
      metrics: [{ name: 'p99 latency', value: '8ms', status: 'verified' }],
      internal_references: [],
      entry: {
        id: 'ev-101',
        date: '2026-02-15',
        company: 'cloudmatrix',
        title: 'Global Auth Mesh Architecture',
        summary: 'Architected distributed token issuance mesh across 4 edge clusters.',
        impact: 'Eliminated auth latency spikes, maintaining p99 under 8ms globally.',
        themes: ['distributed-systems', 'architecture'],
        confidence: 'verified',
        in_flight: false,
        metrics: [{ name: 'p99 latency', value: '8ms', status: 'verified' }],
        internal_references: [],
      },
      narrative: 'Detailed mesh implementation notes.',
    },
    {
      id: 'ev-102',
      date: '2026-05-10',
      company: 'cloudmatrix',
      title: 'Database Sharding Automation',
      summary: 'Engineered dynamic shard rebalancing controller.',
      impact: 'Prevented hot-spot partition stalls across 12M tenant accounts.',
      themes: ['database', 'reliability'],
      confidence: 'provisional', // Provisional = partial status
      in_flight: false,
      metrics: [{ name: 'rebalance time', value: '4min', status: 'missing' }], // Missing metric
      internal_references: [],
      entry: {
        id: 'ev-102',
        date: '2026-05-10',
        company: 'cloudmatrix',
        title: 'Database Sharding Automation',
        summary: 'Engineered dynamic shard rebalancing controller.',
        impact: 'Prevented hot-spot partition stalls across 12M tenant accounts.',
        themes: ['database', 'reliability'],
        confidence: 'provisional',
        in_flight: false,
        metrics: [{ name: 'rebalance time', value: '4min', status: 'missing' }],
        internal_references: [],
      },
      narrative: 'Migration runbook and shard key layout.',
    },
  ];

  const sampleGapAnalysisL5: RubricGapAnalysis = {
    targetLevel: 'L5',
    totalCompetencies: 3,
    coveredCompetencies: 1, // 1 met out of 3 = 33%
    gapPercentage: 67,
    competencies: [
      {
        id: 'architecture-scope',
        name: 'System Architecture & Scope',
        status: 'met',
        verifiedCount: 1,
        provisionalCount: 0,
        issues: [],
      },
      {
        id: 'execution-delivery',
        name: 'Execution & Delivery',
        status: 'partial',
        verifiedCount: 0,
        provisionalCount: 1,
        issues: ['Evidence ev-102 has unverified or missing metrics', 'Evidence ev-102 has provisional confidence'],
      },
      {
        id: 'mentorship-multipliers',
        name: 'Mentorship & Multipliers',
        status: 'gap',
        verifiedCount: 0,
        provisionalCount: 0,
        issues: ['No evidence mapped for competency'],
      },
    ],
  };

  const sampleGapAnalysisL4: RubricGapAnalysis = {
    targetLevel: 'L4',
    totalCompetencies: 3,
    coveredCompetencies: 1,
    gapPercentage: 67,
    competencies: [
      {
        id: 'architecture-scope',
        name: 'System Architecture & Scope',
        status: 'met',
        verifiedCount: 1,
        provisionalCount: 0,
        issues: [],
      },
      {
        id: 'execution-delivery',
        name: 'Execution & Delivery',
        status: 'partial',
        verifiedCount: 0,
        provisionalCount: 1,
        issues: ['Evidence ev-102 has unverified or missing metrics'],
      },
      {
        id: 'mentorship-multipliers',
        name: 'Mentorship & Multipliers',
        status: 'gap',
        verifiedCount: 0,
        provisionalCount: 0,
        issues: ['No evidence mapped for competency'],
      },
    ],
  };

  beforeEach(() => {
    vi.restoreAllMocks();
    (global as any).EventSource = vi.fn().mockImplementation(() => ({
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      close: vi.fn(),
    }));

    // Mock clipboard
    Object.assign(navigator, {
      clipboard: {
        writeText: vi.fn().mockResolvedValue(undefined),
      },
    });
  });

  afterEach(() => {
    cleanup();
  });

  describe('Visual Competency Gap Matrix (RubricGapMatrix)', () => {
    it('renders rubric selector, target level, and summary metrics correctly', async () => {
      vi.spyOn(apiClient, 'getRubrics').mockResolvedValue([sampleRubric]);
      vi.spyOn(apiClient, 'getEvidence').mockResolvedValue(sampleEvidenceList);
      vi.spyOn(apiClient, 'getGapAnalysis').mockResolvedValue(sampleGapAnalysisL5);

      render(<RubricGapMatrix />);

      // Wait for rubric title and level indicators to render
      await waitFor(() => {
        expect(screen.getByText('Competency Gap Matrix')).toBeInTheDocument();
        expect(screen.getByText(/Software Engineering IC Rubric/)).toBeInTheDocument();
      });

      // Check summary counters:
      // Total: 3, Met: 1, Partial: 1, Gaps: 1, Coverage: 33%
      await waitFor(() => {
        expect(screen.getByTestId('metric-total')).toHaveTextContent('3');
        expect(screen.getByTestId('metric-met')).toHaveTextContent('1');
        expect(screen.getByTestId('metric-partial')).toHaveTextContent('1');
        expect(screen.getByTestId('metric-gap')).toHaveTextContent('1');
        expect(screen.getByTestId('metric-coverage')).toHaveTextContent('33%');
      });

      // Check competency expectations are displayed for L5
      expect(
        screen.getByText('Architects multi-service platforms and distributed systems.')
      ).toBeInTheDocument();

      // Check mapped evidence chips
      expect(screen.getByText('ev-101')).toBeInTheDocument();
      expect(screen.getByText('Global Auth Mesh Architecture')).toBeInTheDocument();
      expect(screen.getByText('verified')).toBeInTheDocument();

      // Check missing metric warning on ev-102
      expect(screen.getByText('Metric Needed')).toBeInTheDocument();

      // Check recommendations / action items
      expect(screen.getByText(/Promotion Readiness Action Items/)).toBeInTheDocument();
      expect(screen.getByText(/No verified evidence mapped/)).toBeInTheDocument();
    });

    it('handles switching target level and queries gap analysis for new level', async () => {
      vi.spyOn(apiClient, 'getRubrics').mockResolvedValue([sampleRubric]);
      vi.spyOn(apiClient, 'getEvidence').mockResolvedValue(sampleEvidenceList);
      const gapSpy = vi.spyOn(apiClient, 'getGapAnalysis').mockImplementation(async (_rubricId, level) => {
        if (level === 'L4') return sampleGapAnalysisL4;
        return sampleGapAnalysisL5;
      });

      render(<RubricGapMatrix />);

      await waitFor(() => {
        expect(screen.getByText('L4')).toBeInTheDocument();
      });

      // Switch to L4 by clicking level pill
      const l4Button = screen.getByRole('button', { name: 'L4' });
      fireEvent.click(l4Button);

      await waitFor(() => {
        expect(gapSpy).toHaveBeenCalledWith('engineering-ic', 'L4');
        // L4 expectation should now appear
        expect(
          screen.getByText('Designs single-service subsystems with minimal supervision.')
        ).toBeInTheDocument();
      });
    });

    it('opens evidence detail modal when clicking an evidence card', async () => {
      vi.spyOn(apiClient, 'getRubrics').mockResolvedValue([sampleRubric]);
      vi.spyOn(apiClient, 'getEvidence').mockResolvedValue(sampleEvidenceList);
      vi.spyOn(apiClient, 'getGapAnalysis').mockResolvedValue(sampleGapAnalysisL5);

      render(<RubricGapMatrix />);

      await waitFor(() => {
        expect(screen.getByText('Global Auth Mesh Architecture')).toBeInTheDocument();
      });

      // Click on the evidence card
      const evCard = screen.getByText('Global Auth Mesh Architecture').closest('div');
      fireEvent.click(evCard!);

      // Detail modal should open showing title and narrative
      await waitFor(() => {
        expect(screen.getByText('Detailed mesh implementation notes.')).toBeInTheDocument();
      });
    });
  });

  describe('Rubric Importer Modal (RubricImporterModal)', () => {
    it('parses raw table in real time and submits imported rubric to backend', async () => {
      const onImportSuccess = vi.fn();
      const onClose = vi.fn();

      const importSpy = vi.spyOn(apiClient, 'importRubric').mockResolvedValue({
        success: true,
        rubric: {
          id: 'staff-ladder',
          title: 'Staff Engineering Ladder',
          target_level: 'L5',
          levels: [
            { id: 'L4', name: 'Senior' },
            { id: 'L5', name: 'Staff' },
          ],
          competencies: [
            {
              id: 'architecture-scope',
              name: 'Architecture & Scope',
              levels: { L4: 'Senior design', L5: 'Staff design' },
            },
          ],
        },
      });

      render(
        <RubricImporterModal
          isOpen={true}
          onClose={onClose}
          onImportSuccess={onImportSuccess}
        />
      );

      expect(screen.getByText('Import Leveling Rubric')).toBeInTheDocument();

      // Click load sample markdown
      const loadSampleBtn = screen.getByRole('button', { name: /Load Sample Markdown/ });
      fireEvent.click(loadSampleBtn);

      // Verify live parse preview shows valid status
      await waitFor(() => {
        expect(screen.getByText('Valid Rubric Format')).toBeInTheDocument();
        expect(screen.getByText(/Detected Levels \(3\):/)).toBeInTheDocument();
      });

      // Click Import & Save button
      const importBtn = screen.getByRole('button', { name: /Import & Save/ });
      fireEvent.click(importBtn);

      await waitFor(() => {
        expect(importSpy).toHaveBeenCalled();
        expect(onImportSuccess).toHaveBeenCalled();
        expect(onClose).toHaveBeenCalled();
      });
    });

    it('displays error feedback when invalid table data is entered', async () => {
      render(
        <RubricImporterModal
          isOpen={true}
          onClose={vi.fn()}
          onImportSuccess={vi.fn()}
        />
      );

      const textarea = screen.getByPlaceholderText(/Paste Markdown table/);
      fireEvent.change(textarea, { target: { value: 'invalid single column without pipes' } });

      await waitFor(() => {
        expect(screen.getByText(/Invalid rubric table/)).toBeInTheDocument();
      });

      const importBtn = screen.getByRole('button', { name: /Import & Save/ });
      expect(importBtn).toBeDisabled();
    });
  });

  describe('Brag Doc Generator Modal (BragDocModal)', () => {
    const sampleCompiledMarkdown = `# Performance Brag Document: Alex Mercer

**Period**: H2 2026
**Rubric**: Software Engineering IC Rubric (Target Level: L5)

## System Architecture & Scope
> Architects multi-service platforms and distributed systems.

### Global Auth Mesh Architecture [VERIFIED]
- **Evidence ID**: ev-101 (2026-02-15) | **Organization**: cloudmatrix
- **Accomplishment**: Architected distributed token issuance mesh across 4 edge clusters.
- **Impact & Outcome**: Eliminated auth latency spikes, maintaining p99 under 8ms globally.
- **Key Metrics**:
  - p99 latency: 8ms (verified)

## Execution & Delivery
> Orchestrates cross-team initiatives with sustainable velocity.

### Database Sharding Automation [PROVISIONAL] [MISSING METRICS]
- **Evidence ID**: ev-102 (2026-05-10) | **Organization**: cloudmatrix
- **Accomplishment**: Engineered dynamic shard rebalancing controller.
- **Impact & Outcome**: Prevented hot-spot partition stalls across 12M tenant accounts.
`;

    it('compiles and displays brag doc preview and audit warnings', async () => {
      const compileSpy = vi.spyOn(apiClient, 'compileResume').mockResolvedValue({
        output: sampleCompiledMarkdown,
        violations: [],
        isClean: true,
      });

      render(
        <BragDocModal
          isOpen={true}
          onClose={vi.fn()}
          rubrics={[sampleRubric]}
          initialRubricId="engineering-ic"
          initialTargetLevel="L5"
        />
      );

      expect(screen.getByText('Generate Performance Brag Document')).toBeInTheDocument();

      await waitFor(() => {
        expect(compileSpy).toHaveBeenCalled();
        expect(screen.getByText(/Global Auth Mesh Architecture \[VERIFIED\]/)).toBeInTheDocument();
      });

      // Integrity notice should be shown because [PROVISIONAL] and [MISSING METRICS] are present
      expect(screen.getByText(/Integrity Notice:/)).toBeInTheDocument();
    });

    it('copies markdown output to clipboard and updates button state', async () => {
      vi.spyOn(apiClient, 'compileResume').mockResolvedValue({
        output: sampleCompiledMarkdown,
        violations: [],
        isClean: true,
      });

      render(
        <BragDocModal
          isOpen={true}
          onClose={vi.fn()}
          rubrics={[sampleRubric]}
          initialRubricId="engineering-ic"
          initialTargetLevel="L5"
        />
      );

      await waitFor(() => {
        expect(screen.getByText(/Global Auth Mesh Architecture/)).toBeInTheDocument();
      });

      const copyBtn = screen.getByRole('button', { name: /Copy Markdown/ });
      fireEvent.click(copyBtn);

      expect(navigator.clipboard.writeText).toHaveBeenCalledWith(sampleCompiledMarkdown);

      await waitFor(() => {
        expect(screen.getByText('Copied to Clipboard!')).toBeInTheDocument();
      });
    });

    it('supports downloading markdown file with formatted name', async () => {
      vi.spyOn(apiClient, 'compileResume').mockResolvedValue({
        output: sampleCompiledMarkdown,
        violations: [],
        isClean: true,
      });

      // Mock URL.createObjectURL and click
      const originalCreateObjectURL = window.URL.createObjectURL;
      const originalRevokeObjectURL = window.URL.revokeObjectURL;
      window.URL.createObjectURL = vi.fn().mockReturnValue('blob:mock-url');
      window.URL.revokeObjectURL = vi.fn();

      const linkClickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});

      render(
        <BragDocModal
          isOpen={true}
          onClose={vi.fn()}
          rubrics={[sampleRubric]}
          initialRubricId="engineering-ic"
          initialTargetLevel="L5"
        />
      );

      await waitFor(() => {
        expect(screen.getByText(/Global Auth Mesh Architecture/)).toBeInTheDocument();
      });

      const downloadBtn = screen.getByRole('button', { name: /Download \.md/ });
      fireEvent.click(downloadBtn);

      expect(window.URL.createObjectURL).toHaveBeenCalled();
      expect(linkClickSpy).toHaveBeenCalled();

      window.URL.createObjectURL = originalCreateObjectURL;
      window.URL.revokeObjectURL = originalRevokeObjectURL;
    });
  });
});
