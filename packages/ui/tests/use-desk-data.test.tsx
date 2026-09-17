/**
 * @vitest-environment jsdom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { apiClient } from '../src/api/client';
import { useDeskData } from '../src/hooks/useDeskData';
import { testRecords } from './fixtures/deskRecords';

describe('useDeskData', () => {
  beforeEach(() => vi.restoreAllMocks());
  afterEach(() => vi.restoreAllMocks());

  it('loads evidence, runs, and citations into a desk model', async () => {
    vi.spyOn(apiClient, 'getEvidence').mockResolvedValue(testRecords);
    vi.spyOn(apiClient, 'listTailoringRuns').mockResolvedValue([]);
    vi.spyOn(apiClient, 'getTailoringCitations').mockResolvedValue({ 'ev-001': [{ slug: 'a', title: 'A' }] });
    const { result } = renderHook(() => useDeskData());
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toBeNull();
    expect(result.current.model.threads[0].title).toBe('Platform');
    expect(result.current.briefing?.thread.title).toBe('Platform');
    expect(result.current.citations['ev-001']).toHaveLength(1);
  });

  it('reports evidence load errors but tolerates tailoring failures', async () => {
    vi.spyOn(apiClient, 'getEvidence').mockRejectedValue(new Error('server down'));
    vi.spyOn(apiClient, 'listTailoringRuns').mockRejectedValue(new Error('nope'));
    vi.spyOn(apiClient, 'getTailoringCitations').mockRejectedValue(new Error('nope'));
    const { result } = renderHook(() => useDeskData());
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toBe('server down');
    expect(result.current.briefing).toBeNull();
  });
});
