import React, { useState } from 'react';
import {
  GitPullRequest,
  FileText,
  Users,
  BarChart2,
  Maximize2,
  CheckCircle2,
  ArrowRight,
  AlertCircle,
  Cpu,
  Network,
  TrendingUp,
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
  const [viewMode, setViewMode] = useState<'columns' | 'dag'>('columns');
  const [isFitView, setIsFitView] = useState(false);
  const [activeMobileStage, setActiveMobileStage] = useState<'sources' | 'evidence' | 'threads'>('threads');

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

  const allThemes = Array.from(new Set(evidence.flatMap((e) => e.themes || [])));
  const skillClusters = allThemes.length > 0 ? allThemes : ['Distributed Systems', 'Platform Architecture', 'Telemetry'];

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
        <div className="flex flex-wrap items-center gap-2">
          {/* View Mode Switcher */}
          <div
            role="tablist"
            aria-label="View Mode"
            className="flex items-center gap-1 p-1 bg-slate-100 dark:bg-slate-900 rounded-desk border border-slate-200 dark:border-slate-800 text-xs"
          >
            <button
              role="tab"
              type="button"
              aria-selected={viewMode === 'columns'}
              onClick={() => setViewMode('columns')}
              className={`px-2.5 py-1 rounded text-[11px] font-medium transition-colors focus-visible:ring-2 focus-visible:ring-vermilion-500 focus-visible:outline-none ${
                viewMode === 'columns'
                  ? 'bg-white dark:bg-slate-800 text-slate-900 dark:text-white shadow-xs font-semibold'
                  : 'text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white'
              }`}
            >
              Columns View
            </button>
            <button
              role="tab"
              type="button"
              aria-selected={viewMode === 'dag'}
              onClick={() => setViewMode('dag')}
              className={`px-2.5 py-1 rounded text-[11px] font-medium transition-colors flex items-center gap-1 focus-visible:ring-2 focus-visible:ring-vermilion-500 focus-visible:outline-none ${
                viewMode === 'dag'
                  ? 'bg-white dark:bg-slate-800 text-slate-900 dark:text-white shadow-xs font-semibold'
                  : 'text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white'
              }`}
            >
              <Network className="w-3 h-3 text-vermilion-500" aria-hidden="true" />
              <span>Impact DAG</span>
            </button>
          </div>

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
        {/* The 3-Column Node Map or Impact DAG */}
        <div
          className={`${
            isFitView ? 'lg:col-span-12' : 'lg:col-span-8'
          } rounded-desk border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#121622] p-4 sm:p-6 shadow-sm overflow-x-auto`}
        >
          {viewMode === 'dag' ? (
            <div className="space-y-6" data-testid="impact-dag-container">
              {/* Skill Clusters & Leveling Badges Summary Bar */}
              <div className="flex flex-wrap items-center justify-between gap-3 p-3.5 bg-slate-50 dark:bg-slate-900/60 rounded-desk border border-slate-200 dark:border-slate-800 text-xs">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-semibold text-slate-700 dark:text-slate-300">Skill Clusters:</span>
                  <div className="flex flex-wrap gap-1.5">
                    {skillClusters.map((cluster) => (
                      <span
                        key={cluster}
                        className="rounded px-2 py-0.5 text-[11px] bg-sky-50 text-sky-800 dark:bg-sky-950/60 dark:text-sky-300 font-medium"
                      >
                        {cluster}
                      </span>
                    ))}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <span className="font-semibold text-slate-700 dark:text-slate-300">Leveling Breadth:</span>
                  <span className="rounded px-2 py-0.5 text-[11px] bg-emerald-50 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300 font-medium">
                    L5/L6 Architecture & Scope
                  </span>
                </div>
              </div>

              {/* 3-Lane Causal Directed Acyclic Graph */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-5 relative">
                {/* Column 1: Technical Challenges */}
                <div className="space-y-3">
                  <div className="border-b border-rose-200 dark:border-rose-900/50 pb-2 flex items-center gap-2">
                    <AlertCircle className="w-4 h-4 text-rose-500" aria-hidden="true" />
                    <span className="text-[11px] font-mono uppercase tracking-wider text-rose-600 dark:text-rose-400 font-bold">
                      1. Technical Challenges
                    </span>
                  </div>
                  <div className="space-y-3">
                    {filteredEvidence.map((ev) => {
                      const isSelected = selectedEntity?.type === 'evidence' && selectedEntity.data.id === ev.id;
                      return (
                        <div
                          key={`challenge-${ev.id}`}
                          role="button"
                          tabIndex={0}
                          aria-label={`Challenge node for ${ev.title}`}
                          aria-pressed={isSelected}
                          onClick={() => setSelectedEntity({ type: 'evidence', data: ev })}
                          onKeyDown={(e) => handleKeyDownSelect(e, { type: 'evidence', data: ev })}
                          className={`p-3.5 rounded-desk border transition-all cursor-pointer text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-vermilion-500 ${
                            isSelected
                              ? 'border-rose-500 ring-2 ring-rose-500/30 bg-rose-50/40 dark:bg-rose-950/20 shadow-sm'
                              : 'border-slate-200 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-900/40 hover:border-slate-300 dark:hover:border-slate-700'
                          }`}
                        >
                          <div className="flex items-center justify-between text-[10px] font-mono text-slate-500 mb-1">
                            <span>{ev.id}</span>
                            <span className="text-rose-600 dark:text-rose-400 font-semibold">Problem Context</span>
                          </div>
                          <h4 className="text-xs font-semibold text-slate-900 dark:text-white leading-snug">
                            {ev.challenge || ev.title}
                          </h4>
                        </div>
                      );
                    })}
                  </div>
                </div>

                {/* Column 2: Architectural Interventions */}
                <div className="space-y-3">
                  <div className="border-b border-sky-200 dark:border-sky-900/50 pb-2 flex items-center gap-2">
                    <Cpu className="w-4 h-4 text-sky-500" aria-hidden="true" />
                    <span className="text-[11px] font-mono uppercase tracking-wider text-sky-600 dark:text-sky-400 font-bold">
                      2. Architectural Interventions
                    </span>
                  </div>
                  <div className="space-y-3">
                    {filteredEvidence.map((ev) => {
                      const isSelected = selectedEntity?.type === 'evidence' && selectedEntity.data.id === ev.id;
                      return (
                        <div
                          key={`intervention-${ev.id}`}
                          role="button"
                          tabIndex={0}
                          aria-label={`Intervention node for ${ev.title}`}
                          aria-pressed={isSelected}
                          onClick={() => setSelectedEntity({ type: 'evidence', data: ev })}
                          onKeyDown={(e) => handleKeyDownSelect(e, { type: 'evidence', data: ev })}
                          className={`p-3.5 rounded-desk border transition-all cursor-pointer text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-vermilion-500 ${
                            isSelected
                              ? 'border-sky-500 ring-2 ring-sky-500/30 bg-sky-50/40 dark:bg-sky-950/20 shadow-sm'
                              : 'border-slate-200 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-900/40 hover:border-slate-300 dark:hover:border-slate-700'
                          }`}
                        >
                          <div className="flex items-center justify-between text-[10px] font-mono text-slate-500 mb-1">
                            <span>{ev.id}</span>
                            <span className="text-sky-600 dark:text-sky-400 font-semibold">Architecture</span>
                          </div>
                          <h4 className="text-xs font-semibold text-slate-900 dark:text-white leading-snug">
                            {ev.intervention || ev.title}
                          </h4>
                        </div>
                      );
                    })}
                  </div>
                </div>

                {/* Column 3: Measurable Outcomes */}
                <div className="space-y-3">
                  <div className="border-b border-emerald-200 dark:border-emerald-900/50 pb-2 flex items-center gap-2">
                    <TrendingUp className="w-4 h-4 text-emerald-500" aria-hidden="true" />
                    <span className="text-[11px] font-mono uppercase tracking-wider text-emerald-600 dark:text-emerald-400 font-bold">
                      3. Measurable Outcomes
                    </span>
                  </div>
                  <div className="space-y-3">
                    {filteredEvidence.map((ev) => {
                      const isSelected = selectedEntity?.type === 'evidence' && selectedEntity.data.id === ev.id;
                      return (
                        <div
                          key={`outcome-${ev.id}`}
                          role="button"
                          tabIndex={0}
                          aria-label={`Outcome node for ${ev.title}`}
                          aria-pressed={isSelected}
                          onClick={() => setSelectedEntity({ type: 'evidence', data: ev })}
                          onKeyDown={(e) => handleKeyDownSelect(e, { type: 'evidence', data: ev })}
                          className={`p-3.5 rounded-desk border transition-all cursor-pointer text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-vermilion-500 ${
                            isSelected
                              ? 'border-emerald-500 ring-2 ring-emerald-500/30 bg-emerald-50/40 dark:bg-emerald-950/20 shadow-sm'
                              : 'border-slate-200 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-900/40 hover:border-slate-300 dark:hover:border-slate-700'
                          }`}
                        >
                          <div className="flex items-center justify-between text-[10px] font-mono text-slate-500 mb-1">
                            <span>{ev.id}</span>
                            <span className="text-emerald-600 dark:text-emerald-400 font-semibold">Production Metric</span>
                          </div>
                          <h4 className="text-xs font-semibold text-slate-900 dark:text-white leading-snug">
                            {ev.metric || 'Production outcome'}
                          </h4>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>
            </div>
          ) : (
            <>
              {/* Mobile stage selector tablist (< lg) */}
              <div
                role="tablist"
                aria-label="Story Threads Stages"
                className="flex lg:hidden rounded-desk bg-slate-100 dark:bg-slate-900 p-1 mb-5"
              >
            <button
              role="tab"
              type="button"
              aria-selected={activeMobileStage === 'sources'}
              onClick={() => setActiveMobileStage('sources')}
              className={`flex-1 py-1.5 px-2 rounded text-xs font-semibold transition-colors min-h-[40px] ${
                activeMobileStage === 'sources'
                  ? 'bg-white dark:bg-slate-800 text-slate-900 dark:text-white shadow-xs font-bold'
                  : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
              }`}
            >
              1. Sources ({filteredSources.length})
            </button>
            <button
              role="tab"
              type="button"
              aria-selected={activeMobileStage === 'evidence'}
              onClick={() => setActiveMobileStage('evidence')}
              className={`flex-1 py-1.5 px-2 rounded text-xs font-semibold transition-colors min-h-[40px] ${
                activeMobileStage === 'evidence'
                  ? 'bg-white dark:bg-slate-800 text-slate-900 dark:text-white shadow-xs font-bold'
                  : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
              }`}
            >
              2. Evidence ({filteredEvidence.length})
            </button>
            <button
              role="tab"
              type="button"
              aria-selected={activeMobileStage === 'threads'}
              onClick={() => setActiveMobileStage('threads')}
              className={`flex-1 py-1.5 px-2 rounded text-xs font-semibold transition-colors min-h-[40px] ${
                activeMobileStage === 'threads'
                  ? 'bg-white dark:bg-slate-800 text-slate-900 dark:text-white shadow-xs font-bold'
                  : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
              }`}
            >
              3. Story Threads ({threads.length})
            </button>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 w-full lg:min-w-[560px]">
            {/* Column 1: Sources */}
            <div className={`space-y-3 ${activeMobileStage === 'sources' ? 'block' : 'hidden lg:block'}`}>
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
            <div className={`space-y-3 ${activeMobileStage === 'evidence' ? 'block' : 'hidden lg:block'}`}>
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
            <div className={`space-y-3 ${activeMobileStage === 'threads' ? 'block' : 'hidden lg:block'}`}>
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
            </>
          )}
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

              <div className="p-3 rounded-desk bg-slate-50 dark:bg-slate-900/60 border border-slate-200 dark:border-slate-800 space-y-2">
                <span className="text-xs font-semibold text-slate-700 dark:text-slate-300 block border-b border-slate-200/60 dark:border-slate-800/60 pb-1">
                  Causal Proof Chain:
                </span>
                <div className="space-y-1.5 text-xs">
                  <div>
                    <span className="font-semibold text-rose-600 dark:text-rose-400 text-[11px] block">Challenge:</span>
                    <p className="text-slate-600 dark:text-slate-300 mt-0.5">{selectedEntity.data.challenge || selectedEntity.data.title}</p>
                  </div>
                  <div>
                    <span className="font-semibold text-sky-600 dark:text-sky-400 text-[11px] block">Architecture:</span>
                    <p className="text-slate-600 dark:text-slate-300 mt-0.5">{selectedEntity.data.intervention || selectedEntity.data.title}</p>
                  </div>
                  <div>
                    <span className="font-semibold text-emerald-600 dark:text-emerald-400 text-[11px] block">Quantified Outcome:</span>
                    <p className="text-slate-600 dark:text-slate-300 mt-0.5">{selectedEntity.data.metric || 'Verified outcome'}</p>
                  </div>
                </div>
              </div>

              {selectedEntity.data.themes && selectedEntity.data.themes.length > 0 && (
                <div className="flex flex-wrap gap-1">
                  {selectedEntity.data.themes.map((th) => (
                    <span key={th} className="px-2 py-0.5 text-[10px] rounded bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 font-mono">
                      #{th}
                    </span>
                  ))}
                </div>
              )}

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
