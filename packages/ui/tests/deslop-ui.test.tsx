/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { PreFlightModal } from '../src/components/PreFlightModal';
import { ResumeTailor } from '../src/views/ResumeTailor';
import { BragDocModal } from '../src/components/BragDocModal';
import { apiClient, type PreflightResult, type ResumeRecord } from '../src/api/client';
import type { LevelingRubric } from '@featherduster/core';

describe('Subagent C: UI Anti-Slop Integration Tests', () => {
  const sampleCleanPreflight: PreflightResult = {
    isClean: true,
    validCitations: ['ev-001'],
    danglingCitations: [],
    metricIssues: [],
    violations: [],
    redactedText: '# Clean Resume\n- Architected distributed token issuance mesh maintaining p99 under 8ms globally.',
    slop: {
      isClean: true,
      score: 0,
      slopBand: 'clean',
      matches: [],
      summary: 'Clean: 0 slop patterns detected.',
    },
    slopIssues: [],
  };

  const sampleSlopPreflight: PreflightResult = {
    isClean: false,
    validCitations: ['ev-001'],
    danglingCitations: [],
    metricIssues: [],
    violations: [],
    redactedText: '# Slop Resume\n- Spearheaded efforts to delve into game-changing paradigms to optimize performance.',
    slop: {
      isClean: false,
      score: 14,
      slopBand: 'moderate',
      matches: [
        {
          type: 'hedge',
          patternName: 'empty_hedging_stem',
          matchedText: 'spearheaded efforts to',
          line: 2,
        },
        {
          type: 'delve',
          patternName: 'delve_filler',
          matchedText: 'delve into',
          line: 2,
        },
        {
          type: 'corporate_uplift',
          patternName: 'cliche_transformation',
          matchedText: 'game-changing paradigms',
          line: 2,
        },
      ],
      summary: 'Moderate AI slop detected (score: 14).',
    },
    slopIssues: [
      {
        type: 'hedge',
        patternName: 'empty_hedging_stem',
        matchedText: 'spearheaded efforts to',
        line: 2,
      },
      {
        type: 'delve',
        patternName: 'delve_filler',
        matchedText: 'delve into',
        line: 2,
      },
      {
        type: 'corporate_uplift',
        patternName: 'cliche_transformation',
        matchedText: 'game-changing paradigms',
        line: 2,
      },
    ],
  };

  const sampleResumeWithHedging: ResumeRecord = {
    id: 'tailored-sample',
    name: 'Sample Tailored',
    type: 'tailored',
    filePath: 'resumes/tailored/sample.yaml',
    spec: {
      profile: {
        name: 'Jordan Lee',
        title: 'Staff Engineer',
        email: 'jordan@example.com',
      },
      summary: 'Staff distributed systems engineer.',
      experiences: [
        {
          company: 'Acme Cloud',
          role: 'Staff Engineer',
          startDate: '2023',
          endDate: 'Present',
          bullets: [
            {
              text: 'Needless to say, architected distributed token issuance mesh maintaining p99 under 8ms globally (ev-001).',
              citations: ['ev-001'],
            },
            {
              text: "It's worth noting that dynamic sharding controller eliminated stalls across 12M tenant accounts.",
            },
          ],
        },
      ],
      education: [],
      skills: [],
    },
  };

  const sampleRubric: LevelingRubric = {
    id: 'swe-ic',
    title: 'Software Engineering IC Track',
    target_level: 'IC6',
    levels: [
      { id: 'IC5', name: 'Senior Engineer' },
      { id: 'IC6', name: 'Staff Engineer' },
    ],
    competencies: [
      {
        id: 'system-design',
        name: 'System Design & Architecture',
        levels: {
          IC6: 'Architects fault-tolerant multi-region systems.',
        },
      },
    ],
  };

  beforeEach(() => {
    vi.restoreAllMocks();
    global.URL.createObjectURL = vi.fn(() => 'blob:mock-url');
    global.URL.revokeObjectURL = vi.fn();
    HTMLAnchorElement.prototype.click = vi.fn();
  });

  afterEach(() => {
    cleanup();
  });

  describe('PreFlightModal Anti-Slop Audit Section', () => {
    it('renders clean Anti-Slop badge when no buzzwords or hedging are detected', async () => {
      vi.spyOn(apiClient, 'runPreflight').mockResolvedValue(sampleCleanPreflight);

      render(
        <PreFlightModal
          isOpen={true}
          onClose={vi.fn()}
          text="Sample clean text"
        />
      );

      await waitFor(() => {
        expect(screen.getByText('Anti-Slop Audit')).toBeInTheDocument();
      });

      expect(
        screen.getByText('Anti-Slop: Clean (0 buzzwords or empty hedging detected)')
      ).toBeInTheDocument();
    });

    it('renders warning badge and flagged slop items when slop is detected', async () => {
      vi.spyOn(apiClient, 'runPreflight').mockResolvedValue(sampleSlopPreflight);

      render(
        <PreFlightModal
          isOpen={true}
          onClose={vi.fn()}
          text="Sample slop text"
        />
      );

      await waitFor(() => {
        expect(screen.getByText('Anti-Slop Audit')).toBeInTheDocument();
      });

      // Warning badge with score and band
      expect(
        screen.getByText('Anti-Slop: Issues Detected (score: 14, band: moderate)')
      ).toBeInTheDocument();

      // Flagged tells
      expect(screen.getByText('[hedge]')).toBeInTheDocument();
      expect(screen.getByText('“spearheaded efforts to”')).toBeInTheDocument();
      expect(screen.getByText('[delve]')).toBeInTheDocument();
      expect(screen.getByText('“delve into”')).toBeInTheDocument();
      expect(screen.getByText('[corporate_uplift]')).toBeInTheDocument();
      expect(screen.getByText('“game-changing paradigms”')).toBeInTheDocument();

      // Clean AI Slop button is rendered
      expect(screen.getByRole('button', { name: /Clean AI Slop/i })).toBeInTheDocument();
    });

    it('invokes deslopText, updates preview, and re-triggers preflight when Clean AI Slop is clicked', async () => {
      const preflightSpy = vi
        .spyOn(apiClient, 'runPreflight')
        .mockResolvedValueOnce(sampleSlopPreflight)
        .mockResolvedValueOnce(sampleCleanPreflight);

      const deslopSpy = vi.spyOn(apiClient, 'deslopText').mockResolvedValue({
        success: true,
        cleanedText: '# Clean Resume\n- Architected distributed token issuance mesh maintaining p99 under 8ms globally.',
        fixesApplied: [
          'Stripped empty hedge: "spearheaded efforts to"',
          'Replaced delve filler: "delve into"',
        ],
      });

      render(
        <PreFlightModal
          isOpen={true}
          onClose={vi.fn()}
          text="Spearheaded efforts to delve into game-changing paradigms."
        />
      );

      await waitFor(() => {
        expect(screen.getByRole('button', { name: /Clean AI Slop/i })).toBeInTheDocument();
      });

      // Click Clean AI Slop
      const cleanBtn = screen.getByRole('button', { name: /Clean AI Slop/i });
      fireEvent.click(cleanBtn);

      await waitFor(() => {
        expect(deslopSpy).toHaveBeenCalledWith(
          expect.stringContaining('Spearheaded efforts to delve into game-changing paradigms')
        );
        // Preflight was re-triggered with cleaned text
        expect(preflightSpy).toHaveBeenCalledTimes(2);
      });

      // Shows what fixes were applied
      await waitFor(() => {
        expect(screen.getByText(/De-Slop Applied \(2 fixes\):/i)).toBeInTheDocument();
        expect(
          screen.getByText('Stripped empty hedge: "spearheaded efforts to"')
        ).toBeInTheDocument();
      });

      // Now reflects clean audit state
      expect(
        screen.getByText('Anti-Slop: Clean (0 buzzwords or empty hedging detected)')
      ).toBeInTheDocument();
    });
  });

  describe('ResumeTailor De-Slop Integration', () => {
    it('renders De-Slop button and strips empty hedging stems while preserving metrics and citations', async () => {
      vi.spyOn(apiClient, 'getResumes').mockResolvedValue([sampleResumeWithHedging]);
      vi.spyOn(apiClient, 'getEvidence').mockResolvedValue([]);
      vi.spyOn(apiClient, 'compileResume').mockResolvedValue({
        output: '# Compiled Resume',
        violations: [],
        isClean: true,
      });
      vi.spyOn(apiClient, 'runPreflight').mockResolvedValue(sampleCleanPreflight);

      render(<ResumeTailor />);

      await waitFor(() => {
        expect(screen.getByText('Resume Tailoring Canvas')).toBeInTheDocument();
      });

      // De-Slop button is present in toolbar beside Pre-Flight
      const deSlopBtn = screen.getByRole('button', { name: /De-Slop/i });
      expect(deSlopBtn).toBeInTheDocument();

      // Verify bullet initially contains hedging
      const bulletTextarea = screen.getByDisplayValue(/Needless to say, architected distributed/i);
      expect(bulletTextarea).toBeInTheDocument();

      // Click De-Slop
      fireEvent.click(deSlopBtn);

      // Verify bullet text is de-slopped: empty hedging stripped, metric "8ms" and citation "(ev-001)" preserved
      await waitFor(() => {
        expect(
          screen.getByDisplayValue(
            /Architected distributed token issuance mesh maintaining p99 under 8ms globally \(ev-001\)/i
          )
        ).toBeInTheDocument();
        expect(
          screen.getByDisplayValue(
            /Dynamic sharding controller eliminated stalls across 12M tenant accounts/i
          )
        ).toBeInTheDocument();
      });

      // Verify feedback banner
      expect(
        screen.getByText(/De-slopped: Removed 2 empty hedges, preserved all metrics/i)
      ).toBeInTheDocument();
    });

    it('shows feedback banner when resume has 0 empty hedges', async () => {
      const alreadyCleanResume: ResumeRecord = {
        id: 'clean-variant',
        name: 'Clean Variant',
        type: 'tailored',
        filePath: 'resumes/tailored/clean.yaml',
        spec: {
          profile: {
            name: 'Clean Dev',
            title: 'Senior Staff Engineer',
            email: 'clean@example.com',
          },
          summary: 'High performance engineer.',
          experiences: [
            {
              company: 'Parable',
              role: 'Engineer',
              startDate: '2024',
              endDate: 'Present',
              bullets: [
                {
                  text: 'Optimized p99 latency to 4ms globally across 10 clusters.',
                },
              ],
            },
          ],
          education: [],
          skills: [],
        },
      };

      vi.spyOn(apiClient, 'getResumes').mockResolvedValue([alreadyCleanResume]);
      vi.spyOn(apiClient, 'getEvidence').mockResolvedValue([]);
      vi.spyOn(apiClient, 'compileResume').mockResolvedValue({
        output: '# Clean Resume',
        violations: [],
        isClean: true,
      });
      vi.spyOn(apiClient, 'runPreflight').mockResolvedValue(sampleCleanPreflight);

      render(<ResumeTailor />);

      await waitFor(() => {
        expect(screen.getByText('Resume Tailoring Canvas')).toBeInTheDocument();
      });

      const deSlopBtn = screen.getByRole('button', { name: /De-Slop/i });
      fireEvent.click(deSlopBtn);

      await waitFor(() => {
        expect(
          screen.getByText('De-slopped: Removed 0 empty hedges, preserved all metrics')
        ).toBeInTheDocument();
      });
    });
  });

  describe('BragDocModal De-Slop Integration', () => {
    it('renders De-Slop Brag Doc button and cleans AI buzzwords from generated packet', async () => {
      vi.spyOn(apiClient, 'compileResume').mockResolvedValue({
        output: '# Staff Engineer Packet\nNeedless to say, spearheaded efforts to delve into paradigm shifts.',
        violations: [],
        isClean: true,
      });

      const deslopSpy = vi.spyOn(apiClient, 'deslopText').mockResolvedValue({
        success: true,
        cleanedText: '# Staff Engineer Packet\nEngineered paradigm shifts.',
        fixesApplied: [
          'Stripped empty hedge: "Needless to say,"',
          'Replaced delve filler: "delve into"',
        ],
      });

      render(
        <BragDocModal
          isOpen={true}
          onClose={vi.fn()}
          rubrics={[sampleRubric]}
          initialRubricId="swe-ic"
        />
      );

      // Wait for initial compilation to populate brag doc text
      await waitFor(() => {
        expect(
          screen.getByText(/Needless to say, spearheaded efforts to delve into paradigm shifts/)
        ).toBeInTheDocument();
      });

      // Click De-Slop Brag Doc
      const deSlopBtn = screen.getByRole('button', { name: /De-Slop Brag Doc/i });
      expect(deSlopBtn).not.toBeDisabled();
      fireEvent.click(deSlopBtn);

      await waitFor(() => {
        expect(deslopSpy).toHaveBeenCalledWith(
          expect.stringContaining('Needless to say, spearheaded efforts to delve into paradigm shifts')
        );
        expect(screen.getByText(/De-slopped: Removed 2 buzzword\/hedging patterns/i)).toBeInTheDocument();
        expect(screen.getByText(/Engineered paradigm shifts\./)).toBeInTheDocument();
      });
    });
  });
});
