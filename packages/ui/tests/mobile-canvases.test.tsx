/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { StoryThreadsNodeMap } from '../src/views/desk/StoryThreadsNodeMap';
import { buildDeskModel } from '../src/data/deskModel';
import { testRecords } from './fixtures/deskRecords';

const model = buildDeskModel(testRecords);

describe('Mobile Canvases & Multi-Pane Workflows', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  it('renders mobile stage switcher for Story Threads on narrow screens', () => {
    render(
      <StoryThreadsNodeMap
        sources={model.sources}
        evidence={model.evidence}
        threads={model.threads}
      />
    );

    // Segmented tab list for stages exists on mobile
    const stageTablist = screen.getByRole('tablist', { name: /Story Threads Stages/i });
    expect(stageTablist).toBeInTheDocument();

    const sourcesTab = screen.getByRole('tab', { name: /1\. Sources/i });
    const evidenceTab = screen.getByRole('tab', { name: /2\. Evidence/i });
    const threadsTab = screen.getByRole('tab', { name: /3\. Story Threads/i });

    expect(sourcesTab).toBeInTheDocument();
    expect(evidenceTab).toBeInTheDocument();
    expect(threadsTab).toBeInTheDocument();

    // Clicking Sources tab switches stage
    fireEvent.click(sourcesTab);
    expect(sourcesTab).toHaveAttribute('aria-selected', 'true');
  });
});
