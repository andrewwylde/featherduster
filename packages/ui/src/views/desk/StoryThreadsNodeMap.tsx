import React, { useState } from 'react';
import {
  GitPullRequest,
  FileText,
  Users,
  BarChart2,
  Maximize2,
  CheckCircle2,
  ArrowRight,
} from 'lucide-react';
import type { SignalSource, NodeMapEvidence, StoryThread } from '../../types/desk';
import { EvidenceBadge } from '../../components/desk/EvidenceBadge';
import type { EvidenceStatus } from '../../theme/tokens';

interface StoryThreadsNodeMapProps {
  sources: SignalSource[];
  evidence: NodeMapEvidence[];
  threads: StoryThread[];
  onSelectLead?: () => void;
}

type SelectedEntity =
  | { type: 'source'; data: SignalSource }
  | { type: 'evidence'; data: NodeMapEvidence }
  | { type: 'thread'; data: StoryThread }
  | null;

export const StoryThreadsNodeMap: React.FC<StoryThreadsNodeMapProps> = ({
  sources,
  evidence,
  threads,
  onSelectLead,
}) => {
  const [selectedEntity, setSelectedEntity] = useState<SelectedEntity>(
    threads[0] ? { type: 'thread', data: threads[0] } : null
  );
  const [filterStatus, setFilterStatus] = useState<EvidenceStatus | 'all'>('all');
  const [isFitView, setIsFitView] = useState(false);

  const getSourceIcon = (type: SignalSource['type']) => {
    switch (type) {
      case 'pull_request':
        return GitPullRequest;
      case 'colleague_feedback':
        return Users;
      case 'project_note':
      default:
        return FileText;
    }
  };

  const filteredSources = sources.filter(
    (s) => filterStatus === 'all' || s.status === filterStatus
  );
  const filteredEvidence = evidence.filter(
    (e) => filterStatus === 'all' || e.status === filterStatus
  );

  // Cross-column relational illumination sets
  const relatedSourceIds = new Set<string>();
  const relatedEvidenceIds = new Set<string>();
  const relatedThreadIds = new Set<string>();

  if (selectedEntity?.type === 'thread') {
    relatedThreadIds.add(selectedEntity.data.id);
    for (const evId of selectedEntity.data.evidenceIds) {
      relatedEvidenceIds.add(evId);
      const evItem = evidence.find((e) => e.id === evId);
      if (evItem) {
        evItem.sourceIds.forEach((sId) => relatedSourceIds.add(sId));
      }
    }
  } else if (selectedEntity?.type === 'evidence') {
    relatedEvidenceIds.add(selectedEntity.data.id);
    selectedEntity.data.sourceIds.forEach((sId) => relatedSourceIds.add(sId));
    threads.forEach((t) => {
      if (t.evidenceIds.includes(selectedEntity.data.id)) {
        relatedThreadIds.add(t.id);
      }
    });
  } else if (selectedEntity?.type === 'source') {
    relatedSourceIds.add(selectedEntity.data.id);
    evidence.forEach((ev) => {
      if (ev.sourceIds.includes(selectedEntity.data.id)) {
        relatedEvidenceIds.add(ev.id);
        threads.forEach((t) => {
          if (t.evidenceIds.includes(ev.id)) {
            relatedThreadIds.add(t.id);
          }
        });
      }
    });
  }

  const handleKeyDownSelect = (e: React.KeyboardEvent, entity: SelectedEntity) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      setSelectedEntity(entity);
    }
  };

  return (
    <div className="space-y-6 animate-in fade-in duration-150">
      {/* Top Header & Map Controls */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 border-b border-slate-200 dark:border-slate-800 pb-5">
        <div>
          <span className="text-xs font-mono uppercase tracking-widest text-vermilion-600 dark:text-vermilion-400 font-semibold">
            Career Story Threads
          </span>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-white mt-1">
            Story Threads & Node Map
          </h1>
          <p className="text-xs text-slate-600 dark:text-slate-400 mt-1">
            Built from your evidence ledger: references roll up into entries, and entries group into threads by theme.
          </p>
        </div>

        {/* Filter Controls & Fit View */}
        <div className="flex items-center gap-2">
          <div
            role="group"
            aria-label="Filter evidence by status"
            className="flex items-center gap-1 p-1 bg-slate-100 dark:bg-slate-900 rounded-desk border border-slate-200 dark:border-slate-800 text-xs"
          >
            <button
              onClick={() => setFilterStatus('all')}
              aria-pressed={filterStatus === 'all'}
              className={`px-2.5 py-1 rounded text-[11px] font-medium transition-colors focus-visible:ring-2 focus-visible:ring-vermilion-500 focus-visible:outline-none ${
                filterStatus === 'all'
                  ? 'bg-white dark:bg-slate-800 text-slate-900 dark:text-white shadow-xs font-semibold'
                  : 'text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white'
              }`}
            >
              All
            </button>
            <button
              onClick={() => setFilterStatus('verified')}
              aria-pressed={filterStatus === 'verified'}
              className={`px-2.5 py-1 rounded text-[11px] font-medium transition-colors focus-visible:ring-2 focus-visible:ring-vermilion-500 focus-visible:outline-none ${
                filterStatus === 'verified'
                  ? 'bg-emerald-50 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300 font-semibold'
                  : 'text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white'
              }`}
            >
              Verified
            </button>
            <button
              onClick={() => setFilterStatus('missing_proof')}
              aria-pressed={filterStatus === 'missing_proof'}
              className={`px-2.5 py-1 rounded text-[11px] font-medium transition-colors focus-visible:ring-2 focus-visible:ring-vermilion-500 focus-visible:outline-none ${
                filterStatus === 'missing_proof'
                  ? 'bg-vermilion-50 text-vermilion-700 dark:bg-vermilion-950/60 dark:text-vermilion-300 font-semibold'
                  : 'text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white'
              }`}
            >
              Missing proof
            </button>
          </div>

          <button
            onClick={() => setIsFitView((prev) => !prev)}
            aria-pressed={isFitView}
            aria-label="Fit view toggle"
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-desk border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 text-xs font-medium text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 focus-visible:ring-2 focus-visible:ring-vermilion-500 focus-visible:outline-none transition-colors"
          >
            <Maximize2 className="w-3.5 h-3.5" aria-hidden="true" />
            <span>Fit view</span>
          </button>
        </div>
      </div>

      {evidence.length === 0 && (
        <div className="rounded-desk border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#121622] p-8 text-center">
          <p className="text-sm font-semibold text-slate-900 dark:text-white">No evidence yet</p>
          <p className="mt-1 text-xs text-slate-600 dark:text-slate-400">
            Threads appear here once your ledger has entries with themes. Capture one under Evidence.
          </p>
        </div>
      )}

      {/* Main Working Area: 3-Column Node Map + Traceable Inspector */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* The 3-Column Node Map */}
        <div
          className={`${
            isFitView ? 'lg:col-span-12' : 'lg:col-span-8'
          } rounded-desk border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#121622] p-6 shadow-sm overflow-x-auto`}
        >
          <div className="grid grid-cols-3 gap-6 min-w-[560px]">
            {/* Column 1: Sources */}
            <div className="space-y-3">
              <div className="border-b border-slate-100 dark:border-slate-800 pb-2">
                <span className="text-[11px] font-mono uppercase tracking-wider text-slate-600 dark:text-slate-400 font-semibold">
                  1. Sources
                </span>
              </div>
              <div className="space-y-3">
                {filteredSources.map((src) => {
                  const Icon = getSourceIcon(src.type);
                  const isSelected =
                    selectedEntity?.type === 'source' && selectedEntity.data.id === src.id;
                  const isRelated = relatedSourceIds.has(src.id);
                  return (
                    <div
                      key={src.id}
                      role="button"
                      tabIndex={0}
                      aria-label={`Source node: ${src.title}`}
                      aria-pressed={isSelected}
                      aria-controls="traceable-inspector"
                      onClick={() => setSelectedEntity({ type: 'source', data: src })}
                      onKeyDown={(e) =>
                        handleKeyDownSelect(e, { type: 'source', data: src })
                      }
                      className={`p-3.5 rounded-desk border transition-all cursor-pointer text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-vermilion-500 focus-visible:ring-offset-2 dark:focus-visible:ring-offset-slate-900 ${
                        isSelected
                          ? 'border-vermilion-500 ring-2 ring-vermilion-500/30 bg-vermilion-50/20 dark:bg-vermilion-950/20 shadow-sm'
                          : isRelated
                          ? 'border-vermilion-300 dark:border-vermilion-800/80 bg-vermilion-50/15 dark:bg-vermilion-950/10'
                          : 'border-slate-200 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-900/40 hover:border-slate-300 dark:hover:border-slate-700'
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2 mb-1.5">
                        <div className="flex items-center gap-1.5">
                          <Icon className="w-3.5 h-3.5 text-slate-500" />
                          <span className="text-[11px] text-slate-600 dark:text-slate-400 font-mono truncate max-w-[120px]">
                            {src.tag}
                          </span>
                        </div>
                        <EvidenceBadge status={src.status} />
                      </div>
                      <h3 className="text-xs font-semibold text-slate-900 dark:text-white line-clamp-2">
                        {src.title}
                      </h3>
                      <span className="text-[10px] text-slate-600 dark:text-slate-400 font-mono mt-1 block">
                        {src.date}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Column 2: Evidence */}
            <div className="space-y-3">
              <div className="border-b border-slate-100 dark:border-slate-800 pb-2">
                <span className="text-[11px] font-mono uppercase tracking-wider text-slate-600 dark:text-slate-400 font-semibold">
                  2. Evidence
                </span>
              </div>
              <div className="space-y-3">
                {filteredEvidence.map((ev) => {
                  const isSelected =
                    selectedEntity?.type === 'evidence' && selectedEntity.data.id === ev.id;
                  const isRelated = relatedEvidenceIds.has(ev.id);
                  return (
                    <div
                      key={ev.id}
                      role="button"
                      tabIndex={0}
                      aria-label={`Evidence node: ${ev.title}`}
                      aria-pressed={isSelected}
                      aria-controls="traceable-inspector"
                      onClick={() => setSelectedEntity({ type: 'evidence', data: ev })}
                      onKeyDown={(e) =>
                        handleKeyDownSelect(e, { type: 'evidence', data: ev })
                      }
                      className={`p-3.5 rounded-desk border transition-all cursor-pointer text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-vermilion-500 focus-visible:ring-offset-2 dark:focus-visible:ring-offset-slate-900 ${
                        isSelected
                          ? 'border-vermilion-500 ring-2 ring-vermilion-500/30 bg-vermilion-50/20 dark:bg-vermilion-950/20 shadow-sm'
                          : isRelated
                          ? 'border-vermilion-300 dark:border-vermilion-800/80 bg-vermilion-50/15 dark:bg-vermilion-950/10'
                          : 'border-slate-200 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-900/40 hover:border-slate-300 dark:hover:border-slate-700'
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2 mb-1.5">
                        <FileText className="w-3.5 h-3.5 text-slate-500" />
                        <EvidenceBadge status={ev.status} />
                      </div>
                      <h3 className="text-xs font-semibold text-slate-900 dark:text-white line-clamp-2">
                        {ev.title}
                      </h3>
                      <span className="text-[10px] text-slate-600 dark:text-slate-400 font-mono mt-1 block">
                        {ev.sourceIds.length} connected source(s)
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Column 3: Story Threads */}
            <div className="space-y-3">
              <div className="border-b border-slate-100 dark:border-slate-800 pb-2">
                <span className="text-[11px] font-mono uppercase tracking-wider text-slate-600 dark:text-slate-400 font-semibold">
                  3. Story Threads
                </span>
              </div>
              <div className="space-y-3">
                {threads.map((thread) => {
                  const isSelected =
                    selectedEntity?.type === 'thread' && selectedEntity.data.id === thread.id;
                  const isRelated = relatedThreadIds.has(thread.id);
                  return (
                    <div
                      key={thread.id}
                      role="button"
                      tabIndex={0}
                      aria-label={`Story Thread node: ${thread.title}`}
                      aria-pressed={isSelected}
                      aria-controls="traceable-inspector"
                      onClick={() => setSelectedEntity({ type: 'thread', data: thread })}
                      onKeyDown={(e) =>
                        handleKeyDownSelect(e, { type: 'thread', data: thread })
                      }
                      className={`p-4 rounded-desk border transition-all cursor-pointer text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-vermilion-500 focus-visible:ring-offset-2 dark:focus-visible:ring-offset-slate-900 ${
                        isSelected
                          ? 'border-vermilion-500 ring-2 ring-vermilion-500/30 bg-vermilion-50/30 dark:bg-vermilion-950/20 shadow-sm'
                          : isRelated
                          ? 'border-vermilion-300 dark:border-vermilion-800/80 bg-vermilion-50/15 dark:bg-vermilion-950/10'
                          : 'border-slate-200 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-900/40 hover:border-slate-300 dark:hover:border-slate-700'
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2 mb-2">
                        <BarChart2
                          className="w-4 h-4 text-vermilion-600 dark:text-vermilion-400"
                          aria-hidden="true"
                        />
                        <span className="text-[10px] font-mono uppercase tracking-wider px-2 py-0.5 rounded-full bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 font-semibold">
                          {thread.status}
                        </span>
                      </div>
                      <h3 className="text-sm font-bold leading-tight text-slate-900 dark:text-white">
                        {thread.title}
                      </h3>
                      <p className="text-xs mt-1.5 line-clamp-2 text-slate-600 dark:text-slate-300">
                        {thread.summary}
                      </p>
                      <span className="text-[10px] font-mono mt-2 block text-slate-600 dark:text-slate-400">
                        {thread.evidenceIds.length} evidence point(s)
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        </div>

        {/* Traceable Inspector Side Panel (4 cols) */}
        <div
          id="traceable-inspector"
          role="region"
          aria-live="polite"
          aria-label="Traceable Inspector"
          className="lg:col-span-4 rounded-desk border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#121622] p-6 shadow-sm space-y-5"
        >
          <div className="border-b border-slate-100 dark:border-slate-800/80 pb-3 flex items-center justify-between">
            <h2 className="text-sm font-bold tracking-tight text-slate-900 dark:text-white">
              Traceable Inspector
            </h2>
            <span className="text-[10px] font-mono uppercase px-2 py-0.5 rounded bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400">
              {selectedEntity?.type || 'Empty'}
            </span>
          </div>

          {selectedEntity?.type === 'thread' && (
            <div className="space-y-4">
              <div>
                <span className="text-[11px] font-mono text-slate-600 dark:text-slate-400 uppercase tracking-wider">
                  Selected Thread: {selectedEntity.data.title}
                </span>
                <h3 className="text-base font-bold text-slate-900 dark:text-white mt-1">
                  {selectedEntity.data.title}
                </h3>
                <p className="text-xs text-slate-600 dark:text-slate-300 mt-1 leading-relaxed">
                  {selectedEntity.data.summary}
                </p>
              </div>

              <div className="p-3 rounded-desk bg-slate-50 dark:bg-slate-900/60 border border-slate-200 dark:border-slate-800 space-y-2">
                <span className="text-xs font-semibold text-slate-700 dark:text-slate-300 block">
                  Contributing Evidence ({selectedEntity.data.evidenceIds.length})
                </span>
                <ul className="text-xs text-slate-600 dark:text-slate-400 space-y-1.5">
                  {selectedEntity.data.evidenceIds.map((id) => (
                    <li key={id} className="flex items-center gap-2">
                      <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500" />
                      <span className="capitalize">{id.replace('ev-', '').replace('-', ' ')}</span>
                    </li>
                  ))}
                </ul>
              </div>

              <div className="pt-2">
                <button
                  onClick={onSelectLead}
                  className="w-full py-2.5 rounded-desk bg-vermilion-500 hover:bg-vermilion-600 text-white text-xs font-bold shadow-sm transition-all flex items-center justify-center gap-2 focus-visible:ring-2 focus-visible:ring-vermilion-500 focus-visible:outline-none"
                >
                  <span>Open lead in focused interview</span>
                  <ArrowRight className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          )}

          {selectedEntity?.type === 'source' && (
            <div className="space-y-4">
              <div>
                <span className="text-[11px] font-mono text-slate-600 dark:text-slate-400 uppercase tracking-wider">
                  Selected Source: {selectedEntity.data.title}
                </span>
                <div className="flex items-center gap-2 mt-1">
                  <h3 className="text-base font-bold text-slate-900 dark:text-white">
                    {selectedEntity.data.title}
                  </h3>
                </div>
                <div className="mt-1 flex items-center gap-2">
                  <EvidenceBadge status={selectedEntity.data.status} />
                  <span className="text-xs text-slate-600 dark:text-slate-400 font-mono">{selectedEntity.data.date}</span>
                </div>
              </div>

              <p className="text-xs text-slate-600 dark:text-slate-400 leading-relaxed">
                {selectedEntity.data.description}
              </p>

              {selectedEntity.data.quote && (
                <div className="p-3 rounded-desk bg-vermilion-50/40 dark:bg-vermilion-950/20 border-l-2 border-vermilion-500 text-xs italic text-slate-700 dark:text-slate-300">
                  &ldquo;{selectedEntity.data.quote.text}&rdquo;{' '}
                  <span className="not-italic text-slate-600 dark:text-slate-400 block mt-1">
                    ({selectedEntity.data.quote.author})
                  </span>
                </div>
              )}

              <div className="pt-2">
                <button
                  onClick={onSelectLead}
                  className="w-full py-2.5 rounded-desk border border-vermilion-500 text-vermilion-600 dark:text-vermilion-400 hover:bg-vermilion-50/50 dark:hover:bg-vermilion-950/30 text-xs font-bold transition-all flex items-center justify-center gap-2 focus-visible:ring-2 focus-visible:ring-vermilion-500 focus-visible:outline-none"
                >
                  <span>Reconstruct with The Editor</span>
                  <ArrowRight className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          )}

          {selectedEntity?.type === 'evidence' && (
            <div className="space-y-4">
              <div>
                <span className="text-[11px] font-mono text-slate-600 dark:text-slate-400 uppercase tracking-wider">
                  Selected Evidence
                </span>
                <h3 className="text-base font-bold text-slate-900 dark:text-white mt-1">
                  {selectedEntity.data.title}
                </h3>
                <div className="mt-1">
                  <EvidenceBadge status={selectedEntity.data.status} />
                </div>
              </div>

              <div className="p-3 rounded-desk bg-slate-50 dark:bg-slate-900/60 border border-slate-200 dark:border-slate-800 space-y-1.5">
                <span className="text-xs font-semibold text-slate-700 dark:text-slate-300">
                  Connected Source IDs:
                </span>
                <ul className="text-xs font-mono text-slate-600 dark:text-slate-400 space-y-1">
                  {selectedEntity.data.sourceIds.map((id) => (
                    <li key={id}>• {id}</li>
                  ))}
                </ul>
              </div>

              <div className="pt-2">
                <button
                  onClick={onSelectLead}
                  className="w-full py-2.5 rounded-desk bg-vermilion-500 hover:bg-vermilion-600 text-white text-xs font-bold transition-all flex items-center justify-center gap-2 focus-visible:ring-2 focus-visible:ring-vermilion-500 focus-visible:outline-none"
                >
                  <span>Strengthen in Interview</span>
                  <ArrowRight className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
