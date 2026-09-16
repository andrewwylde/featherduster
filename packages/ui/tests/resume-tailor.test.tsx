/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { ResumeTailor } from '../src/views/ResumeTailor';
import { PreFlightModal } from '../src/components/PreFlightModal';
import { apiClient, type ResumeRecord, type PreflightResult } from '../src/api/client';
import type { EvidenceRecord } from '@featherduster/core';

describe('Resume Tailor & Pre-Flight Gate Tests', () => {
  const sampleResumeRecord: ResumeRecord = {
    id: 'template-starter',
    name: 'Starter Template',
    type: 'template',
    filePath: 'resumes/templates/starter.yaml',
    spec: {
      profile: {
        name: 'Alex Mercer',
        title: 'Staff Software Engineer / Distributed Systems',
        email: 'alex.mercer@example.com',
        phone: '+1 (555) 019-2834',
        location: 'San Francisco, CA',
        links: {
          github: 'github.com/alexmercer',
          linkedin: 'linkedin.com/in/alexmercer',
          website: 'alexmercer.dev',
        },
      },
      summary: 'Staff Software Engineer specializing in distributed consensus and high-throughput edge proxies.',
      experiences: [
        {
          company: 'CloudMatrix Technologies',
          role: 'Staff Software Engineer',
          location: 'San Francisco, CA',
          startDate: '2023-01',
          endDate: 'Present',
          bullets: [
            {
              text: 'Architected distributed token issuance mesh maintaining p99 under 8ms globally (ev-001).',
              citations: ['ev-001'],
            },
            {
              text: 'Engineered dynamic sharding controller eliminating hot-spot partition stalls across 12M tenant accounts.',
            },
          ],
        },
      ],
      education: [
        {
          institution: 'University of California, Berkeley',
          degree: 'B.S. in Electrical Engineering and Computer Science',
          year: '2016',
          details: 'Systems focus',
        },
      ],
      skills: [
        {
          category: 'Languages',
          skills: ['TypeScript', 'Go', 'Rust'],
        },
        {
          category: 'Infrastructure',
          skills: ['Kubernetes', 'PostgreSQL', 'AWS'],
        },
      ],
    },
  };

  const sampleEvidenceList: EvidenceRecord[] = [
    {
      id: 'ev-001',
      date: '2026-03-01',
      company: 'CloudMatrix Technologies',
      title: 'Global Auth Mesh Architecture',
      summary: 'Architected distributed token issuance mesh maintaining p99 under 8ms globally.',
      impact: 'Eliminated auth latency spikes, maintaining p99 under 8ms globally.',
      themes: ['distributed-systems', 'auth'],
      confidence: 'verified',
      in_flight: false,
      metrics: [{ name: 'p99 latency', value: '8ms', status: 'verified' }],
      internal_references: [],
      entry: {
        id: 'ev-001',
        date: '2026-03-01',
        company: 'CloudMatrix Technologies',
        title: 'Global Auth Mesh Architecture',
        summary: 'Architected distributed token issuance mesh maintaining p99 under 8ms globally.',
        impact: 'Eliminated auth latency spikes, maintaining p99 under 8ms globally.',
        themes: ['distributed-systems', 'auth'],
        confidence: 'verified',
        in_flight: false,
        metrics: [{ name: 'p99 latency', value: '8ms', status: 'verified' }],
        internal_references: [],
      },
      narrative: 'Detailed architectural notes.',
    },
    {
      id: 'ev-002',
      date: '2026-05-10',
      company: 'CloudMatrix Technologies',
      title: 'Dynamic Sharding Controller',
      summary: 'Engineered dynamic shard rebalancing controller for 12M tenant accounts.',
      impact: 'Zero partition stalls',
      themes: ['database', 'reliability'],
      confidence: 'verified',
      in_flight: false,
      metrics: [],
      internal_references: [],
      entry: {
        id: 'ev-002',
        date: '2026-05-10',
        company: 'CloudMatrix Technologies',
        title: 'Dynamic Sharding Controller',
        summary: 'Engineered dynamic shard rebalancing controller for 12M tenant accounts.',
        impact: 'Zero partition stalls',
        themes: ['database', 'reliability'],
        confidence: 'verified',
        in_flight: false,
        metrics: [],
        internal_references: [],
      },
      narrative: 'Shard controller implementation details.',
    },
  ];

  const samplePreflightClean: PreflightResult = {
    isClean: true,
    validCitations: ['ev-001'],
    danglingCitations: [],
    metricIssues: [],
    violations: [],
    redactedText: '# Alex Mercer\nStaff Software Engineer\n\n- Architected distributed token issuance mesh maintaining p99 under 8ms globally.',
  };

  beforeEach(() => {
    vi.restoreAllMocks();
    vi.spyOn(apiClient, 'getResumes').mockResolvedValue([sampleResumeRecord]);
    vi.spyOn(apiClient, 'getEvidence').mockResolvedValue(sampleEvidenceList);
    vi.spyOn(apiClient, 'compileResume').mockImplementation(async (spec, format) => {
      const bulletCount = (spec as any)?.experiences?.[0]?.bullets?.length ?? 0;
      return {
        output: `# Compiled [${format}] Resume\nBullets count: ${bulletCount}`,
        violations: [],
        isClean: true,
      };
    });
    vi.spyOn(apiClient, 'runPreflight').mockResolvedValue(samplePreflightClean);

    // Mock URL.createObjectURL and URL.revokeObjectURL for downloads
    global.URL.createObjectURL = vi.fn(() => 'blob:mock-url');
    global.URL.revokeObjectURL = vi.fn();
    HTMLAnchorElement.prototype.click = vi.fn();
  });

  afterEach(() => {
    cleanup();
  });

  describe('3-Pane Resume Tailoring Canvas Rendering', () => {
    it('renders Left Pane (Job Matcher), Middle Pane (Modular Bullets), and Right Pane (Live Preview)', async () => {
      render(<ResumeTailor />);

      await waitFor(() => {
        expect(screen.getByText('Resume Tailoring Canvas')).toBeInTheDocument();
      });

      // Left pane items
      expect(screen.getByText('Target Job Description')).toBeInTheDocument();
      expect(screen.getByText('Candidate Profile')).toBeInTheDocument();

      // Middle pane items
      expect(screen.getByText('Modular Experiences & Bullets')).toBeInTheDocument();
      expect(screen.getByDisplayValue('CloudMatrix Technologies')).toBeInTheDocument();

      // Right pane items
      expect(screen.getByText('ATS Markdown')).toBeInTheDocument();
      expect(screen.getByText('Web Print (HTML)')).toBeInTheDocument();
      expect(screen.getByText('Typst')).toBeInTheDocument();
      expect(screen.getByText('LaTeX')).toBeInTheDocument();
    });

    it('highlights matched keywords when a target job description is pasted', async () => {
      render(<ResumeTailor />);

      await waitFor(() => {
        expect(screen.getByText('Target Job Description')).toBeInTheDocument();
      });

      const jdTextarea = screen.getByPlaceholderText(/Paste target job specification/i);
      fireEvent.change(jdTextarea, {
        target: {
          value: 'Looking for a Staff Engineer with deep expertise in TypeScript and Kubernetes.',
        },
      });

      await waitFor(() => {
        expect(screen.getByText(/Requirement Matcher/i)).toBeInTheDocument();
        expect(screen.getByText('✓ TypeScript')).toBeInTheDocument();
        expect(screen.getByText('✓ Kubernetes')).toBeInTheDocument();
      });
    });
  });

  describe('Modular bullet toggle & re-compilation', () => {
    it('toggles bullet inclusion checkbox and immediately re-compiles resume with active bullets', async () => {
      const compileSpy = vi.spyOn(apiClient, 'compileResume');

      render(<ResumeTailor />);

      await waitFor(() => {
        expect(screen.getByDisplayValue('CloudMatrix Technologies')).toBeInTheDocument();
      });

      // Initially, 2 bullets exist
      const checkboxes = screen.getAllByRole('checkbox');
      expect(checkboxes.length).toBe(2);
      expect(checkboxes[0]).toBeChecked();
      expect(checkboxes[1]).toBeChecked();

      // Uncheck the first bullet
      fireEvent.click(checkboxes[0]);
      expect(checkboxes[0]).not.toBeChecked();

      // Verify compileResume was called with a spec having only 1 bullet
      await waitFor(() => {
        const lastCall = compileSpy.mock.calls[compileSpy.mock.calls.length - 1];
        const sentSpec = lastCall[0] as any;
        expect(sentSpec.experiences[0].bullets.length).toBe(1);
      });

      // Re-check the first bullet
      fireEvent.click(checkboxes[0]);
      expect(checkboxes[0]).toBeChecked();

      // Verify compileResume was called with 2 bullets restored
      await waitFor(() => {
        const lastCall = compileSpy.mock.calls[compileSpy.mock.calls.length - 1];
        const sentSpec = lastCall[0] as any;
        expect(sentSpec.experiences[0].bullets.length).toBe(2);
      });
    });
  });

  describe('Adding a bullet from evidence store into an experience', () => {
    it('opens evidence picker modal and inserts chosen accomplishment as a bullet with citation attached', async () => {
      const compileSpy = vi.spyOn(apiClient, 'compileResume');

      render(<ResumeTailor />);

      await waitFor(() => {
        expect(screen.getByDisplayValue('CloudMatrix Technologies')).toBeInTheDocument();
      });

      // Click '+ Add Bullet from Evidence'
      const addFromEvidenceBtn = screen.getByRole('button', { name: /Add Bullet from Evidence/i });
      fireEvent.click(addFromEvidenceBtn);

      // Verify modal opened
      await waitFor(() => {
        expect(screen.getByText('Insert Accomplishment from Evidence Store')).toBeInTheDocument();
      });

      // Find the second evidence item (ev-002: Dynamic Sharding Controller)
      expect(screen.getByText('Dynamic Sharding Controller')).toBeInTheDocument();

      // Click insert button on second evidence item
      const insertButtons = screen.getAllByRole('button', { name: /Insert Bullet/i });
      fireEvent.click(insertButtons[1]); // Second item

      // Verify modal closed and new bullet is present
      await waitFor(() => {
        expect(screen.queryByText('Insert Accomplishment from Evidence Store')).not.toBeInTheDocument();
      });

      // Total bullets should now be 3
      const checkboxes = screen.getAllByRole('checkbox');
      expect(checkboxes.length).toBe(3);

      // Verify compile was triggered with 3 bullets including ev-002
      await waitFor(() => {
        const lastCall = compileSpy.mock.calls[compileSpy.mock.calls.length - 1];
        const sentSpec = lastCall[0] as any;
        expect(sentSpec.experiences[0].bullets.length).toBe(3);
        const addedBullet = sentSpec.experiences[0].bullets[2];
        expect(addedBullet.citations).toContain('ev-002');
      });
    });
  });

  describe('Format switcher (Markdown, HTML, Typst, LaTeX)', () => {
    it('switches target compiler formats and re-renders corresponding output views', async () => {
      const compileSpy = vi.spyOn(apiClient, 'compileResume');

      render(<ResumeTailor />);

      await waitFor(() => {
        expect(screen.getByText('ATS Markdown')).toBeInTheDocument();
      });

      // 1. Switch to Web Print (HTML)
      const htmlTab = screen.getByRole('button', { name: /Web Print \(HTML\)/i });
      fireEvent.click(htmlTab);

      await waitFor(() => {
        expect(compileSpy).toHaveBeenCalledWith(expect.anything(), 'html');
        expect(screen.getByTitle('Sandboxed Resume Print Preview')).toBeInTheDocument();
        expect(screen.getByRole('button', { name: /Print \/ Save as PDF/i })).toBeInTheDocument();
      });

      // 2. Switch to Typst
      const typstTab = screen.getByRole('button', { name: /Typst/i });
      fireEvent.click(typstTab);

      await waitFor(() => {
        expect(compileSpy).toHaveBeenCalledWith(expect.anything(), 'typst');
        expect(screen.getByText(/Compiled \[typst\] Resume/)).toBeInTheDocument();
      });

      // 3. Switch to LaTeX
      const latexTab = screen.getByRole('button', { name: /LaTeX/i });
      fireEvent.click(latexTab);

      await waitFor(() => {
        expect(compileSpy).toHaveBeenCalledWith(expect.anything(), 'latex');
        expect(screen.getByText(/Compiled \[latex\] Resume/)).toBeInTheDocument();
      });

      // 4. Switch back to ATS Markdown
      const markdownTab = screen.getByRole('button', { name: /ATS Markdown/i });
      fireEvent.click(markdownTab);

      await waitFor(() => {
        expect(compileSpy).toHaveBeenCalledWith(expect.anything(), 'markdown');
        expect(screen.getByText(/Compiled \[markdown\] Resume/)).toBeInTheDocument();
      });
    });
  });

  describe('Pre-Flight Gate Modal & Redact and Download', () => {
    it('opens preflight audit modal, displays checklist, and executes clean redaction download', async () => {
      const preflightSpy = vi.spyOn(apiClient, 'runPreflight').mockResolvedValue(samplePreflightClean);

      render(<ResumeTailor />);

      // Wait for initial load and preflight badge
      await waitFor(() => {
        expect(screen.getByRole('button', { name: /Pre-Flight: Passed/i })).toBeInTheDocument();
        expect(preflightSpy).toHaveBeenCalled();
      });

      // Click Pre-Flight button to open modal
      const preflightBtn = screen.getByRole('button', { name: /Pre-Flight: Passed/i });
      fireEvent.click(preflightBtn);

      // Verify modal is displayed
      await waitFor(() => {
        expect(screen.getByText('Pre-Flight Export Gate')).toBeInTheDocument();
        expect(screen.getByText('READY FOR EXPORT')).toBeInTheDocument();
        expect(screen.getByText('ev-001')).toBeInTheDocument();
        expect(screen.getByText('Anti-Slop Audit')).toBeInTheDocument();
        expect(
          screen.getByText(/Anti-Slop: Clean \(0 buzzwords or empty hedging detected\)/i)
        ).toBeInTheDocument();
      });

      // Verify Redact & Download button executes
      const downloadBtn = screen.getByRole('button', { name: /Redact & Download/i });
      expect(downloadBtn).not.toBeDisabled();

      // Click Redact & Download
      fireEvent.click(downloadBtn);

      // Verify URL.createObjectURL was called to generate the clean download
      expect(global.URL.createObjectURL).toHaveBeenCalled();
    });

    it('displays warning verdict and lists issues when preflight detects violations', async () => {
      const flawedResult: PreflightResult = {
        isClean: false,
        validCitations: [],
        danglingCitations: ['ev-999'],
        metricIssues: [
          { type: 'missing_metric', message: 'Explicit [METRIC NEEDED] detected', line: 12 },
        ],
        violations: ['CLASSIFIED_KEYWORD'],
        redactedText: '# Cleaned',
      };

      vi.spyOn(apiClient, 'runPreflight').mockResolvedValue(flawedResult);

      render(
        <PreFlightModal
          isOpen={true}
          onClose={vi.fn()}
          spec={sampleResumeRecord.spec}
          text="Sample resume text"
        />
      );

      await waitFor(() => {
        expect(screen.getByText('ISSUES DETECTED')).toBeInTheDocument();
        expect(screen.getByText('ev-999')).toBeInTheDocument();
        expect(screen.getByText(/Explicit \[METRIC NEEDED\] detected/i)).toBeInTheDocument();
        expect(screen.getByText('CLASSIFIED_KEYWORD')).toBeInTheDocument();
      });
    });
  });
});
