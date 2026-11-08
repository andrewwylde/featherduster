import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { EvidenceRecord } from '@featherduster/core';
import { apiClient, type TailoringCitations, type TailoringRunSummary } from '../api/client';
import { buildBriefing, buildDeskModel } from '../data/deskModel';
import { useLiveSync } from './useLiveSync';

/** Real ledger + tailoring data for the desk views. Refreshes on scoped workspace changes. */
export function useDeskData(topic: string = 'workspace_integrity') {
  const [records, setRecords] = useState<EvidenceRecord[]>([]);
  const [runs, setRuns] = useState<TailoringRunSummary[]>([]);
  const [citations, setCitations] = useState<TailoringCitations>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const inFlightRef = useRef<AbortController | null>(null);
  const isFetchingRef = useRef(false);
  const pendingRefreshRef = useRef(false);

  const load = useCallback(async () => {
    if (isFetchingRef.current) {
      pendingRefreshRef.current = true;
      return;
    }

    isFetchingRef.current = true;
    pendingRefreshRef.current = false;

    if (inFlightRef.current) {
      inFlightRef.current.abort();
    }
    const controller = new AbortController();
    inFlightRef.current = controller;

    try {
      const [evidence, runList, citationIndex] = await Promise.allSettled([
        apiClient.getEvidence(),
        apiClient.listTailoringRuns(),
        apiClient.getTailoringCitations(),
      ]);

      if (controller.signal.aborted) {
        return;
      }

      if (evidence.status === 'fulfilled') {
        setRecords(evidence.value);
        setError(null);
      } else {
        setError(evidence.reason instanceof Error ? evidence.reason.message : 'Failed to load evidence');
      }
      setRuns(runList.status === 'fulfilled' ? runList.value : []);
      setCitations(citationIndex.status === 'fulfilled' ? citationIndex.value : {});
    } catch (err: any) {
      if (controller.signal.aborted || err?.name === 'AbortError') return;
      setError(err instanceof Error ? err.message : 'Failed to load ledger data');
    } finally {
      if (inFlightRef.current === controller) {
        inFlightRef.current = null;
      }
      isFetchingRef.current = false;

      if (pendingRefreshRef.current) {
        pendingRefreshRef.current = false;
        void load();
      } else {
        setLoading(false);
      }
    }
  }, []);

  useEffect(() => {
    load();
    return () => {
      if (inFlightRef.current) {
        inFlightRef.current.abort();
      }
    };
  }, [load]);

  useLiveSync(() => {
    void load();
  }, topic);

  const model = useMemo(() => buildDeskModel(records), [records]);
  const briefing = useMemo(() => buildBriefing(model), [model]);

  return { records, model, briefing, runs, citations, loading, error, refresh: load };
}
