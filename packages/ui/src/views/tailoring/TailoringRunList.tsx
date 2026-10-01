import { useCallback, useEffect, useRef, useState } from 'react';
import type { DraftRecord } from '@featherduster/core';
import { apiClient, type TailoringRunSummary } from '../../api/client';
import { useTailoringEvents } from '../../hooks/useTailoringEvents';
import { sseClient } from '../../api/events';
import { BrowserRecovery } from '../../tailoring-drafts/recovery';
import { cardClass, primaryButton, secondaryButton, stateLabel, StatusPill } from './ui';

export interface TailoringRunListProps {
  onOpenRun: (slug: string) => void;
  onOpenDraft?: (id: string) => void;
  onNew?: () => void;
  onOpenSettings?: () => void;
  onOpenCanvas?: () => void;
  initialPosting?: string;
  onInitialPostingConsumed?: () => void;
  recovery?: BrowserRecovery;
  workspaceId?: string;
}
export function TailoringRunList({ onOpenRun, onOpenDraft, onNew, onOpenCanvas, recovery, workspaceId }: TailoringRunListProps) {
  const [runs, setRuns] = useState<TailoringRunSummary[]>([]);
  const [drafts, setDrafts] = useState<DraftRecord[]>([]);
  const [errors, setErrors] = useState<Record<string, string[]>>({});
  const [browserIds, setBrowserIds] = useState<Set<string>>(new Set());
  const [browserVersions, setBrowserVersions] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);
  const server = useRef<{ workspaceId?: string; records: DraftRecord[] }>({ records: [] });
  const request = useRef(0);
  const refreshBrowser = useCallback(() => {
    const confirmed = server.current.workspaceId || workspaceId;
    const records = new Map(server.current.records.map(record => [record.id, record]));
    const local = confirmed && recovery ? recovery.list(confirmed) : { snapshots: [], errors: [] };
    const counts: Record<string, number> = {};
    local.snapshots.forEach(snapshot => {
      counts[snapshot.draftId] = (counts[snapshot.draftId] ?? 0) + 1;
      if (!records.has(snapshot.draftId)) records.set(snapshot.draftId, snapshot.record);
    });
    setBrowserVersions(counts);
    setBrowserIds(new Set(local.snapshots.map(snapshot => snapshot.draftId)));
    setDrafts([...records.values()].filter(record => record.lifecycle !== 'discarded'));
    setErrors(previous => ({ ...previous, browser: local.errors.map(error => error.message) }));
  }, [workspaceId, recovery]);
  const load = useCallback(async () => {
    const current = ++request.current;
    // Each resource publishes independently; a hanging endpoint cannot hide the others.
    await Promise.allSettled([
      apiClient.listTailoringRuns().then(list => {
        if (current !== request.current) return;
        setRuns(list); setErrors(previous => ({ ...previous, runs: [] }));
      }).catch(error => { if (current === request.current) setErrors(previous => ({ ...previous, runs: [String(error?.message || error)] })); }).finally(() => { if (current === request.current) setLoading(false); }),
      apiClient.listTailoringDrafts().then(list => {
        if (current !== request.current) return;
        server.current = { workspaceId: list.workspaceId, records: list.records.map(envelope => envelope.record) };
        setErrors(previous => ({ ...previous, drafts: list.recoveryErrors.map(error => error.message) }));
        refreshBrowser();
      }).catch(error => {
        if (current !== request.current) return;
        setErrors(previous => ({ ...previous, drafts: [String(error?.message || error)] }));
        refreshBrowser();
      }).finally(() => { if (current === request.current) setLoading(false); }),
    ]);
  }, [refreshBrowser]);
  useEffect(() => {
    if (workspaceId && server.current.workspaceId && workspaceId !== server.current.workspaceId) server.current = { workspaceId, records: [] };
    refreshBrowser(); void load();
    const unsubscribe = recovery?.subscribe(refreshBrowser);
    return () => { request.current++; unsubscribe?.(); };
  }, [load, recovery, refreshBrowser, workspaceId]);
  useTailoringEvents({ onEvent: event => { if (event.kind === 'state') void load(); }, onFileChange: () => { void load(); } });
  useEffect(() => sseClient.onDraftChange(() => { void load(); }), [load]);
  const reviewCount = runs.filter(r => r.needs_review).length;
  const associated = new Set(drafts.map(d => d.runSlug).filter(Boolean));
  const rows = [
    ...drafts.map(d => ({ id: d.id, title: d.kind === 'setup' ? d.payload.label || d.payload.posting.slice(0, 80) || 'Untitled setup' : d.runSlug || (d.kind === 'manual' ? 'Manual resume' : 'Tailoring draft'), kind: d.kind, browserOnly: browserIds.has(d.id), needsReview: false, stage: d.lifecycle === 'completed' ? 'Completed' : d.context.activeStep || (d.kind === 'setup' ? 'Setup' : 'Draft'), edited: d.editedAt, open: () => onOpenDraft?.(d.id) })),
    ...runs.filter(r => !associated.has(r.slug)).map(r => ({ id: r.slug, title: r.title || r.slug, kind: 'run', browserOnly: false, needsReview: r.needs_review, stage: r.finalized_path ? 'Completed' : stateLabel(r.state), edited: r.updated, open: () => onOpenRun(r.slug) })),
  ].sort((a, b) => b.edited.localeCompare(a.edited));
  return <div className="space-y-6">
    <header className="flex flex-wrap items-end justify-between gap-4">
      <div><h1 className="text-2xl font-bold">Tailor your resume to a job</h1><p className="mt-2 text-sm text-slate-600">Your drafts and tailoring runs, ready when you are.</p></div>
      <div className="flex gap-3">{onOpenCanvas && <button className={secondaryButton} onClick={onOpenCanvas}>Open canvas</button>}<button className={primaryButton} onClick={onNew}>New tailoring run</button></div>
    </header>
    {Object.values(errors).flat().map((error, i) => <p role="alert" key={i}>{error}</p>)}
    <section aria-label="Tailoring work"><div className="flex justify-between"><h2>Drafts and runs {reviewCount > 0 && <span>{reviewCount} need review</span>}</h2><button onClick={() => void load()}>Refresh</button></div>
      {loading && rows.length === 0 ? <p>Loading runs…</p> : rows.length === 0 ? <p>No tailoring runs yet.</p> : <ul className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">{rows.map(row => <li key={row.id}><button className={`${cardClass} w-full p-4 text-left`} onClick={row.open}><strong>{row.title}</strong>{row.needsReview && <StatusPill status="needs_review" />}<p>{row.kind} · {row.stage}</p>{row.browserOnly && <p>{browserVersions[row.id] > 1 ? `${browserVersions[row.id]} browser recovery versions — choose when opening` : 'Saved in this browser'}</p>}<time dateTime={row.edited}>{new Date(row.edited).toLocaleString()}</time></button></li>)}</ul>}
    </section>
  </div>;
}
