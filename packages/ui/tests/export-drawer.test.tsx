/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { ExportDrawer } from '../src/components/ExportDrawer';
import { apiClient, type ExportArtifact } from '../src/api/client';
import type { ResumeSpec } from '@featherduster/core';

describe('ExportDrawer Component Tests', () => {
  const sampleSpec: ResumeSpec = {
    profile: {
      name: 'Alex Mercer',
      title: 'Staff Software Engineer',
      email: 'alex@example.com',
    },
    summary: 'Distributed systems architect.',
    experiences: [
      {
        company: 'CloudMatrix Technologies',
        role: 'Staff Engineer',
        startDate: '2023-01',
        endDate: 'Present',
        bullets: [
          {
            text: 'Architected distributed token mesh (ev-001).',
            citations: ['ev-001'],
          },
        ],
      },
    ],
    education: [],
    skills: [
      {
        category: 'Languages',
        skills: ['TypeScript', 'Go'],
      },
    ],
  };

  const sampleArtifacts: ExportArtifact[] = [
    {
      name: 'resume_starter.md',
      relativePath: 'resumes/exports/resume_starter.md',
      format: 'markdown',
      sizeBytes: 1200,
      updatedAt: '2026-09-17T20:00:00.000Z',
      category: 'export',
    },
    {
      name: 'resume_starter.html',
      relativePath: 'resumes/exports/resume_starter.html',
      format: 'html',
      sizeBytes: 4500,
      updatedAt: '2026-09-17T20:00:00.000Z',
      category: 'export',
    },
    {
      name: 'starter-defense-brief.md',
      relativePath: 'resumes/tailored/briefs/starter-defense-brief.md',
      format: 'markdown',
      sizeBytes: 2500,
      updatedAt: '2026-09-17T20:00:00.000Z',
      category: 'brief',
    },
  ];

  beforeEach(() => {
    vi.restoreAllMocks();
    vi.spyOn(apiClient, 'compileResume').mockImplementation(async (_spec, format) => {
      return {
        output: `# Compiled [${format}] Output`,
        violations: [],
        isClean: true,
      };
    });
    vi.spyOn(apiClient, 'getExports').mockResolvedValue(sampleArtifacts);
    vi.spyOn(apiClient, 'createBundle').mockResolvedValue({
      success: true,
      name: 'netflix-staff',
      files: [
        { name: 'resume_netflix-staff_ats.md', relativePath: 'resumes/exports/resume_netflix-staff_ats.md', category: 'export', format: 'markdown' },
        { name: 'resume_netflix-staff.html', relativePath: 'resumes/exports/resume_netflix-staff.html', category: 'export', format: 'html' },
        { name: 'netflix-staff-defense-brief.md', relativePath: 'resumes/tailored/briefs/netflix-staff-defense-brief.md', category: 'brief', format: 'markdown' },
      ],
    });

    // Mock clipboard
    Object.assign(navigator, {
      clipboard: {
        writeText: vi.fn().mockResolvedValue(undefined),
      },
    });

    // Mock URL for downloads
    global.URL.createObjectURL = vi.fn(() => 'blob:mock-url');
    global.URL.revokeObjectURL = vi.fn();
  });

  afterEach(() => {
    cleanup();
  });

  it('renders flyout drawer when isOpen is true', async () => {
    render(
      <ExportDrawer
        isOpen={true}
        onClose={vi.fn()}
        spec={sampleSpec}
        variantName="starter"
        preflightStatus={{ isClean: true, validCitations: ['ev-001'], danglingCitations: [], metricIssues: [], violations: [], redactedText: '' }}
        preflightLoading={false}
        onOpenPreflightModal={vi.fn()}
        onDeSlop={vi.fn()}
        deslopping={false}
        squeezeMode={false}
        onToggleSqueeze={vi.fn()}
      />
    );

    expect(screen.getByText('Deliverables & Exports')).toBeInTheDocument();
    expect(screen.getByText('starter')).toBeInTheDocument();
    expect(screen.getByText('Copy ATS Text')).toBeInTheDocument();
    expect(screen.getByText('Print to PDF')).toBeInTheDocument();
    expect(screen.getByText('Save Bundle')).toBeInTheDocument();

    await waitFor(() => {
      expect(screen.getByText(/# Compiled \[markdown\] Output/)).toBeInTheDocument();
    });
  });

  it('does not render anything when isOpen is false', () => {
    const { container } = render(
      <ExportDrawer
        isOpen={false}
        onClose={vi.fn()}
        spec={sampleSpec}
        variantName="starter"
        preflightStatus={null}
        preflightLoading={false}
        onOpenPreflightModal={vi.fn()}
        onDeSlop={vi.fn()}
        deslopping={false}
        squeezeMode={false}
        onToggleSqueeze={vi.fn()}
      />
    );

    expect(container).toBeEmptyDOMElement();
  });

  it('executes 1-click ATS copy to clipboard', async () => {
    render(
      <ExportDrawer
        isOpen={true}
        onClose={vi.fn()}
        spec={sampleSpec}
        variantName="starter"
        preflightStatus={null}
        preflightLoading={false}
        onOpenPreflightModal={vi.fn()}
        onDeSlop={vi.fn()}
        deslopping={false}
        squeezeMode={false}
        onToggleSqueeze={vi.fn()}
      />
    );

    await waitFor(() => {
      expect(screen.getByText('Copy ATS Text')).toBeInTheDocument();
    });

    const copyBtn = screen.getByText('Copy ATS Text');
    fireEvent.click(copyBtn);

    await waitFor(() => {
      expect(navigator.clipboard.writeText).toHaveBeenCalledWith('# Compiled [markdown] Output');
      expect(screen.getByText('Copied ATS!')).toBeInTheDocument();
    });
  });

  it('triggers application release bundle compilation via apiClient.createBundle', async () => {
    const bundleSpy = vi.spyOn(apiClient, 'createBundle');

    render(
      <ExportDrawer
        isOpen={true}
        onClose={vi.fn()}
        spec={sampleSpec}
        variantName="netflix-staff"
        jobDescription="Target Staff Role"
        matchedKeywords={['TypeScript']}
        missingKeywords={['Go']}
        preflightStatus={null}
        preflightLoading={false}
        onOpenPreflightModal={vi.fn()}
        onDeSlop={vi.fn()}
        deslopping={false}
        squeezeMode={false}
        onToggleSqueeze={vi.fn()}
      />
    );

    const bundleBtn = screen.getByRole('button', { name: /Save Bundle/i });
    fireEvent.click(bundleBtn);

    await waitFor(() => {
      expect(bundleSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          name: 'netflix-staff',
          formats: ['markdown', 'html'],
          includeBrief: true,
          jobDescription: 'Target Staff Role',
        })
      );
      expect(screen.getByText(/Release bundle generated/i)).toBeInTheDocument();
    });
  });

  it('renders artifacts shelf tab with files and confidential badge for defense brief', async () => {
    render(
      <ExportDrawer
        isOpen={true}
        onClose={vi.fn()}
        spec={sampleSpec}
        variantName="starter"
        preflightStatus={null}
        preflightLoading={false}
        onOpenPreflightModal={vi.fn()}
        onDeSlop={vi.fn()}
        deslopping={false}
        squeezeMode={false}
        onToggleSqueeze={vi.fn()}
      />
    );

    // Click On-Disk Shelf tab
    const shelfTab = screen.getByRole('button', { name: /On-Disk Shelf/i });
    fireEvent.click(shelfTab);

    await waitFor(() => {
      expect(screen.getByText('resume_starter.md')).toBeInTheDocument();
      expect(screen.getByText('resume_starter.html')).toBeInTheDocument();
      expect(screen.getByText('starter-defense-brief.md')).toBeInTheDocument();
      expect(screen.getByText('Confidential Brief')).toBeInTheDocument();
    });
  });

  it('triggers onToggleSqueeze callback when Squeeze button is clicked', () => {
    const toggleSqueezeMock = vi.fn();

    render(
      <ExportDrawer
        isOpen={true}
        onClose={vi.fn()}
        spec={sampleSpec}
        variantName="starter"
        preflightStatus={null}
        preflightLoading={false}
        onOpenPreflightModal={vi.fn()}
        onDeSlop={vi.fn()}
        deslopping={false}
        squeezeMode={false}
        onToggleSqueeze={toggleSqueezeMock}
      />
    );

    const squeezeBtn = screen.getByRole('button', { name: /Squeeze: OFF/i });
    fireEvent.click(squeezeBtn);

    expect(toggleSqueezeMock).toHaveBeenCalledTimes(1);
  });
});
