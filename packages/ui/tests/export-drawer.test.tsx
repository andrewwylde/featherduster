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
    vi.spyOn(apiClient, 'openExport').mockResolvedValue({ success: true });
    vi.spyOn(apiClient, 'exportBrief').mockResolvedValue({
      success: true,
      name: 'starter',
      files: [
        { name: 'starter-defense-brief.md', relativePath: 'resumes/tailored/briefs/starter-defense-brief.md', category: 'brief', format: 'markdown' },
        { name: 'starter-defense-brief.html', relativePath: 'resumes/tailored/briefs/starter-defense-brief.html', category: 'brief', format: 'html' },
      ],
    });
    vi.spyOn(apiClient, 'exportLatexPdf').mockResolvedValue(new Blob(['%PDF-1.7']));
    vi.spyOn(apiClient, 'renderTypst').mockResolvedValue({
      available: true,
      detail: 'typst test',
      pages: ['<svg xmlns="http://www.w3.org/2000/svg"><text>Resume</text></svg>'],
      error: null,
      source: '# Resume',
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
    // Omitted keyword props must not change effect dependencies on internal renders.
    expect(apiClient.compileResume).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', { name: /On-Disk Shelf/i }));
    await screen.findByText('resume_starter.md');
    expect(apiClient.compileResume).toHaveBeenCalledTimes(1);
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
    fireEvent.click(screen.getByRole('button', { name: 'Open in Explorer' }));
    await waitFor(() => {
      expect(apiClient.openExport).toHaveBeenCalledWith('resumes/exports/resume_netflix-staff_ats.md');
    });
  });

  it('compiles and downloads the LaTeX PDF from Print to PDF', async () => {
    const latexSpy = vi.spyOn(apiClient, 'exportLatexPdf');

    render(
      <ExportDrawer
        isOpen={true}
        onClose={vi.fn()}
        spec={sampleSpec}
        variantName="starter"
        jobDescription="Target Staff Role"
        preflightStatus={null}
        preflightLoading={false}
        onOpenPreflightModal={vi.fn()}
        onDeSlop={vi.fn()}
        deslopping={false}
        squeezeMode={false}
        onToggleSqueeze={vi.fn()}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: 'Print to PDF' }));

    await waitFor(() => {
      expect(latexSpy).toHaveBeenCalledWith(expect.objectContaining({ targetRole: '', jobDescription: 'Target Staff Role' }));
    });
  });

  it('renders Typst once without a competing source compile loop', async () => {
    const compileSpy = vi.spyOn(apiClient, 'compileResume');
    const typstSpy = vi.spyOn(apiClient, 'renderTypst');

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

    fireEvent.click(screen.getByRole('button', { name: 'Typst' }));
    expect(typstSpy).toHaveBeenCalledTimes(1);
    expect(compileSpy).toHaveBeenCalledWith(expect.anything(), 'typst');
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

  it('compiles and previews defense brief with HTML and Markdown view toggles', async () => {
    const compileSpy = vi.spyOn(apiClient, 'compileResume');

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

    // Switch to Defense Brief format
    fireEvent.click(screen.getByRole('button', { name: /Defense Brief/i }));

    await waitFor(() => {
      // Defaults to brief for markdown view
      expect(compileSpy).toHaveBeenCalledWith(expect.anything(), 'brief');
      expect(screen.getByRole('button', { name: 'Print Preview' })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Markdown Source' })).toBeInTheDocument();
    });

    // Toggle to Print Preview
    fireEvent.click(screen.getByRole('button', { name: 'Print Preview' }));
    await waitFor(() => {
      expect(compileSpy).toHaveBeenCalledWith(expect.anything(), 'brief-html');
      expect(screen.getByTitle('Defense Brief Print Preview')).toBeInTheDocument();
    });
  });

  it('triggers standalone brief export to disk via apiClient.exportBrief', async () => {
    const exportBriefSpy = vi.spyOn(apiClient, 'exportBrief');

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

    // Switch to Defense Brief format
    fireEvent.click(screen.getByRole('button', { name: /Defense Brief/i }));

    // Click "Save to Disk" inside the Defense Brief sub-bar
    const saveToDiskBtn = screen.getByRole('button', { name: 'Save to Disk' });
    fireEvent.click(saveToDiskBtn);

    await waitFor(() => {
      expect(exportBriefSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          name: 'starter',
          format: 'all',
        })
      );
      expect(screen.getByText(/Defense brief saved/i)).toBeInTheDocument();
    });
  });
});
