import { useCallback, useEffect, useMemo, useState } from 'react';
import type { EvidenceRecord } from '@featherduster/core';
import { apiClient, type TailoringCitations, type TailoringRunSummary } from '../api/client';
import { buildBriefing, buildDeskModel } from '../data/deskModel';
import { useLiveSync } from './useLiveSync';

/** Real ledger + tailoring data for the desk views. Refreshes on workspace file changes. */
export function useDeskData() {
  const [records, setRecords] = useState<EvidenceRecord[]>([]);
  const [runs, setRuns] = useState<TailoringRunSummary[]>([]);
  const [citations, setCitations] = useState<TailoringCitations>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const [evidence, runList, citationIndex] = await Promise.allSettled([
      apiClient.getEvidence(),
      apiClient.listTailoringRuns(),
      apiClient.getTailoringCitations(),
    ]);
    if (evidence.status === 'fulfilled') {
      setRecords(evidence.value);
      setError(null);
    } else {
      setError(evidence.reason instanceof Error ? evidence.reason.message : 'Failed to load evidence');
    }
    setRuns(runList.status === 'fulfilled' ? runList.value : []);
    setCitations(citationIndex.status === 'fulfilled' ? citationIndex.value : {});
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  useLiveSync(() => {
    load();
  });

  const model = useMemo(() => buildDeskModel(records), [records]);
  const briefing = useMemo(() => buildBriefing(model), [model]);

  return { records, model, briefing, runs, citations, loading, error, refresh: load };
}
