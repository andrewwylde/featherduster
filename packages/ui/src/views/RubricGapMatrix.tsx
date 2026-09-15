import React, { useState, useEffect, useMemo, useCallback } from 'react';
import {
  Target,
  CheckCircle2,
  AlertTriangle,
  AlertCircle,
  Upload,
  FileText,
  Layers,
  Sparkles,
  RefreshCw,
  Building2,
} from 'lucide-react';
import type {
  LevelingRubric,
  RubricGapAnalysis,
  EvidenceRecord,
} from '@featherduster/core';
import { apiClient } from '../api/client';
import { useLiveSync } from '../hooks/useLiveSync';
import { RubricImporterModal } from '../components/RubricImporterModal';
import { BragDocModal } from '../components/BragDocModal';
import { EvidenceDetailModal } from '../components/EvidenceDetailModal';

function formatCategory(id: string, name: string): string {
  const lower = (id + ' ' + name).toLowerCase();
  if (lower.includes('arch') || lower.includes('scope') || lower.includes('system')) {
    return 'Architecture & System Design';
  }
  if (lower.includes('exec') || lower.includes('deliv') || lower.includes('speed') || lower.includes('velocity')) {
    return 'Execution & Delivery';
  }
  if (lower.includes('lead') || lower.includes('mentor') || lower.includes('sponsor') || lower.includes('culture')) {
    return 'Leadership & Multipliers';
  }
  if (lower.includes('ops') || lower.includes('reliab') || lower.includes('prod') || lower.includes('quality')) {
    return 'Reliability & Operations';
  }
  return 'Core Engineering Dimension';
}

export const RubricGapMatrix: React.FC = () => {
  const [rubrics, setRubrics] = useState<LevelingRubric[]>([]);
  const [evidenceList, setEvidenceList] = useState<EvidenceRecord[]>([]);
  const [selectedRubricId, setSelectedRubricId] = useState<string>('');
  const [selectedLevel, setSelectedLevel] = useState<string>('');
  const [gapAnalysis, setGapAnalysis] = useState<RubricGapAnalysis | null>(null);

  const [loading, setLoading] = useState(true);
  const [analyzing, setAnalyzing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Modals
  const [isImporterOpen, setIsImporterOpen] = useState(false);
  const [isBragDocOpen, setIsBragDocOpen] = useState(false);
  const [selectedEvidence, setSelectedEvidence] = useState<EvidenceRecord | null>(null);

  // Load rubrics and evidence
  const loadData = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const [rubricsData, evidenceData] = await Promise.all([
        apiClient.getRubrics(),
        apiClient.getEvidence(),
      ]);

      setRubrics(rubricsData);
      setEvidenceList(evidenceData);

      // Default selection logic: prefer engineering-ic or swe-ic or first available
      if (rubricsData.length > 0) {
        setSelectedRubricId((prev) => {
          if (prev && rubricsData.some((r) => r.id === prev)) {
            return prev;
          }
          const preferred =
            rubricsData.find((r) => r.id === 'engineering-ic') ||
            rubricsData.find((r) => r.id.includes('ic') || r.id.includes('eng')) ||
            rubricsData[0];
          return preferred.id;
        });
      }
    } catch (err: any) {
      setError(err.message || 'Failed to load rubrics');
    } finally {
      setLoading(false);
    }
  }, []);

  // Hook up SSE live sync
  useLiveSync(() => {
    loadData();
  });

  useEffect(() => {
    loadData();
  }, [loadData]);

  // Current selected rubric
  const currentRubric = useMemo(() => {
    return rubrics.find((r) => r.id === selectedRubricId) || rubrics[0] || null;
  }, [rubrics, selectedRubricId]);

  // Update target level whenever current rubric changes
  useEffect(() => {
    if (currentRubric) {
      setSelectedLevel((prevLevel) => {
        const levelExists = currentRubric.levels.some((l) => l.id === prevLevel);
        if (levelExists) return prevLevel;
        return currentRubric.target_level || currentRubric.levels[0]?.id || '';
      });
    }
  }, [currentRubric]);

  // Fetch gap analysis whenever selected rubric or target level changes
  const fetchGapAnalysis = useCallback(async () => {
    if (!currentRubric || !selectedLevel) return;

    try {
      setAnalyzing(true);
      const analysis = await apiClient.getGapAnalysis(currentRubric.id, selectedLevel);
      setGapAnalysis(analysis);
    } catch (err: any) {
      console.error('Failed to compute gap analysis:', err);
    } finally {
      setAnalyzing(false);
    }
  }, [currentRubric, selectedLevel]);

  useEffect(() => {
    fetchGapAnalysis();
  }, [fetchGapAnalysis]);

  // Summary Metric Calculations
  const totalCompetencies = gapAnalysis?.totalCompetencies ?? currentRubric?.competencies.length ?? 0;
  const metCount = gapAnalysis?.competencies.filter((c) => c.status === 'met').length ?? 0;
  const partialCount = gapAnalysis?.competencies.filter((c) => c.status === 'partial').length ?? 0;
  const gapCount = gapAnalysis?.competencies.filter((c) => c.status === 'gap').length ?? 0;

  const coveragePercent =
    totalCompetencies > 0 ? Math.round((metCount / totalCompetencies) * 100) : 0;

  // Recommendations / Action items
  const actionItems = useMemo(() => {
    if (!gapAnalysis) return [];
    const items: Array<{
      competencyId: string;
      competencyName: string;
      status: 'met' | 'partial' | 'gap';
      action: string;
      severity: 'high' | 'medium' | 'low';
    }> = [];

    for (const compReport of gapAnalysis.competencies) {
      if (compReport.status === 'gap') {
        items.push({
          competencyId: compReport.id,
          competencyName: compReport.name,
          status: 'gap',
          action: `No verified evidence mapped. Link at least 1 verified accomplishment demonstrating ${selectedLevel} expectations.`,
          severity: 'high',
        });
      } else if (compReport.status === 'partial') {
        const hasMissingMetrics = compReport.issues.some((i) => i.includes('metrics'));
        const hasProvisional = compReport.issues.some((i) => i.includes('provisional'));
        const hasInFlight = compReport.issues.some((i) => i.includes('in-flight'));

        let actionText = 'Incomplete criteria for target level.';
        if (hasMissingMetrics) {
          actionText = 'Quantify impact with verified metrics (e.g. latency, scale, or revenue).';
        } else if (hasProvisional) {
          actionText = 'Promote provisional evidence to verified status with peer reviews or artifact links.';
        } else if (hasInFlight) {
          actionText = 'Track active project milestones to transition in-flight work to delivered impact.';
        }

        items.push({
          competencyId: compReport.id,
          competencyName: compReport.name,
          status: 'partial',
          action: actionText,
          severity: 'medium',
        });
      }
    }

    return items;
  }, [gapAnalysis, selectedLevel]);

  // Handle successful rubric import
  const handleRubricImported = (newRubric: LevelingRubric) => {
    setRubrics((prev) => {
      const existing = prev.filter((r) => r.id !== newRubric.id);
      return [newRubric, ...existing];
    });
    setSelectedRubricId(newRubric.id);
    setSelectedLevel(newRubric.target_level || newRubric.levels[0]?.id || '');
  };

  if (loading && rubrics.length === 0) {
    return (
      <div className="h-96 flex flex-col items-center justify-center space-y-3 text-slate-500 animate-fadeIn">
        <RefreshCw className="w-7 h-7 animate-spin text-teal-400" />
        <span className="text-sm font-medium">Loading Leveling Rubrics & Gap Matrix...</span>
      </div>
    );
  }

  return (
    <div className="space-y-6 animate-fadeIn">
      {/* Top Header & Main Action Controls */}
      <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-white flex items-center gap-2.5">
            Competency Gap Matrix
            <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-teal-500/10 text-teal-400 border border-teal-500/20 flex items-center gap-1.5">
              {analyzing && <RefreshCw className="w-3 h-3 animate-spin" />}
              <span>Live Evaluation</span>
            </span>
          </h1>
          <p className="text-sm text-slate-400">
            Benchmark your evidence portfolio against leveling ladders and uncover promotion gaps.
          </p>
          {error && (
            <div className="mt-2 p-2.5 bg-rose-500/10 border border-rose-500/20 rounded-xl text-xs text-rose-400 flex items-center gap-2">
              <AlertCircle className="w-4 h-4 flex-shrink-0" />
              <span>{error}</span>
            </div>
          )}
        </div>

        <div className="flex items-center space-x-3">
          <button
            onClick={() => setIsImporterOpen(true)}
            className="px-3.5 py-2 text-xs font-semibold text-slate-200 bg-slate-800 hover:bg-slate-700 rounded-xl transition-colors flex items-center space-x-1.5 border border-slate-700/60"
          >
            <Upload className="w-3.5 h-3.5 text-teal-400" />
            <span>Import Rubric</span>
          </button>
          <button
            onClick={() => setIsBragDocOpen(true)}
            disabled={!currentRubric}
            className="px-4 py-2 text-xs font-semibold text-slate-950 bg-teal-400 hover:bg-teal-300 disabled:opacity-50 disabled:cursor-not-allowed rounded-xl transition-colors flex items-center space-x-1.5 shadow-lg shadow-teal-500/10"
          >
            <FileText className="w-3.5 h-3.5" />
            <span>Generate Brag Doc</span>
          </button>
        </div>
      </div>

      {/* Rubric & Target Level Selector Bar */}
      <div className="p-4 bg-slate-900/70 border border-slate-800 rounded-2xl flex flex-col md:flex-row md:items-center justify-between gap-4">
        {/* Rubric Dropdown */}
        <div className="flex items-center space-x-3 flex-1">
          <div className="p-2 rounded-xl bg-teal-500/10 text-teal-400 border border-teal-500/20 flex-shrink-0">
            <Target className="w-4 h-4" />
          </div>
          <div className="min-w-0 flex-1 max-w-md">
            <label className="block text-[10px] font-semibold uppercase tracking-wider text-slate-400 mb-0.5">
              Active Leveling Framework
            </label>
            <select
              value={selectedRubricId}
              onChange={(e) => setSelectedRubricId(e.target.value)}
              className="w-full px-3 py-1.5 bg-slate-950 border border-slate-800 rounded-xl text-xs font-semibold text-white focus:outline-none focus:border-teal-500 transition-colors"
            >
              {rubrics.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.title} ({r.levels.length} levels)
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* Target Level Pills */}
        {currentRubric && currentRubric.levels.length > 0 && (
          <div className="flex items-center space-x-2">
            <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider mr-1">
              Target Level:
            </span>
            <div className="flex items-center space-x-1.5 bg-slate-950 p-1 rounded-xl border border-slate-800">
              {currentRubric.levels.map((lvl) => {
                const isSelected = lvl.id === selectedLevel;
                return (
                  <button
                    key={lvl.id}
                    onClick={() => setSelectedLevel(lvl.id)}
                    className={`px-3 py-1 text-xs font-mono font-bold rounded-lg transition-all ${
                      isSelected
                        ? 'bg-teal-500 text-slate-950 shadow-md shadow-teal-500/20'
                        : 'text-slate-400 hover:text-white hover:bg-slate-800'
                    }`}
                    title={lvl.name}
                  >
                    {lvl.id}
                  </button>
                );
              })}
            </div>
          </div>
        )}
      </div>

      {/* Summary Metric Counters */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3.5">
        {/* Coverage Card */}
        <div className="col-span-2 lg:col-span-1 p-4 bg-slate-900/60 border border-slate-800 rounded-2xl flex flex-col justify-between">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-slate-400">Level Coverage</span>
            <span
              data-testid="metric-coverage"
              className={`text-xs font-bold font-mono px-2 py-0.5 rounded-full ${
                coveragePercent >= 80
                  ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20'
                  : coveragePercent >= 50
                  ? 'bg-amber-500/10 text-amber-400 border border-amber-500/20'
                  : 'bg-rose-500/10 text-rose-400 border border-rose-500/20'
              }`}
            >
              {coveragePercent}%
            </span>
          </div>
          <div className="my-2">
            <div className="w-full bg-slate-950 h-2.5 rounded-full overflow-hidden border border-slate-800/80">
              <div
                className={`h-full transition-all duration-500 rounded-full ${
                  coveragePercent >= 80
                    ? 'bg-emerald-400'
                    : coveragePercent >= 50
                    ? 'bg-amber-400'
                    : 'bg-rose-400'
                }`}
                style={{ width: `${coveragePercent}%` }}
              />
            </div>
          </div>
          <div className="text-[11px] text-slate-500">
            Targeting <strong className="text-slate-300 font-mono">{selectedLevel}</strong> promotion
          </div>
        </div>

        {/* Total Competencies */}
        <div className="p-4 bg-slate-900/60 border border-slate-800 rounded-2xl flex flex-col justify-between">
          <div className="text-xs font-medium text-slate-400">Total Dimensions</div>
          <div data-testid="metric-total" className="text-2xl font-bold text-white font-mono mt-1">{totalCompetencies}</div>
          <div className="text-[11px] text-slate-500">Evaluated competencies</div>
        </div>

        {/* Met Count */}
        <div className="p-4 bg-slate-900/60 border border-slate-800 rounded-2xl flex flex-col justify-between">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-slate-400">Met</span>
            <CheckCircle2 className="w-4 h-4 text-emerald-400" />
          </div>
          <div data-testid="metric-met" className="text-2xl font-bold text-emerald-400 font-mono mt-1">{metCount}</div>
          <div className="text-[11px] text-emerald-500/80">Verified & clean metrics</div>
        </div>

        {/* Partial Count */}
        <div className="p-4 bg-slate-900/60 border border-slate-800 rounded-2xl flex flex-col justify-between">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-slate-400">Partial</span>
            <AlertTriangle className="w-4 h-4 text-amber-400" />
          </div>
          <div data-testid="metric-partial" className="text-2xl font-bold text-amber-400 font-mono mt-1">{partialCount}</div>
          <div className="text-[11px] text-amber-500/80">Provisional or unverified</div>
        </div>

        {/* Gap Count */}
        <div className="p-4 bg-slate-900/60 border border-slate-800 rounded-2xl flex flex-col justify-between">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-slate-400">Gaps</span>
            <AlertCircle className="w-4 h-4 text-rose-400" />
          </div>
          <div data-testid="metric-gap" className="text-2xl font-bold text-rose-400 font-mono mt-1">{gapCount}</div>
          <div className="text-[11px] text-rose-500/80">0 evidence mapped</div>
        </div>
      </div>

      {/* Gap Recommendations & Action Items */}
      {actionItems.length > 0 ? (
        <div className="p-5 bg-slate-900/70 border border-slate-800 rounded-2xl space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-bold text-white flex items-center gap-2">
              <Sparkles className="w-4 h-4 text-amber-400" />
              Promotion Readiness Action Items ({actionItems.length})
            </h3>
            <span className="text-[11px] text-slate-400">Auto-generated recommendations</span>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5">
            {actionItems.map((item) => (
              <div
                key={item.competencyId}
                className="p-3 bg-slate-950/70 rounded-xl border border-slate-800/80 flex items-start space-x-3 text-xs"
              >
                {item.status === 'gap' ? (
                  <AlertCircle className="w-4 h-4 text-rose-400 mt-0.5 flex-shrink-0" />
                ) : (
                  <AlertTriangle className="w-4 h-4 text-amber-400 mt-0.5 flex-shrink-0" />
                )}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between mb-0.5">
                    <span className="font-semibold text-slate-200">{item.competencyName}</span>
                    <span
                      className={`text-[10px] font-bold uppercase px-1.5 py-0.5 rounded ${
                        item.status === 'gap'
                          ? 'bg-rose-500/10 text-rose-400 border border-rose-500/20'
                          : 'bg-amber-500/10 text-amber-400 border border-amber-500/20'
                      }`}
                    >
                      {item.status}
                    </span>
                  </div>
                  <p className="text-slate-400 text-[11px] leading-relaxed">{item.action}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      ) : (
        <div className="p-4 bg-emerald-500/10 border border-emerald-500/20 rounded-2xl flex items-center justify-between text-xs text-emerald-400">
          <div className="flex items-center space-x-2.5">
            <CheckCircle2 className="w-5 h-5 flex-shrink-0" />
            <div>
              <span className="font-bold">100% Competency Coverage for Level {selectedLevel}!</span>
              <p className="text-emerald-400/80 text-[11px] mt-0.5">
                All dimensions meet or exceed verified standards. Your evidence portfolio is promotion-ready.
              </p>
            </div>
          </div>
          <button
            onClick={() => setIsBragDocOpen(true)}
            className="px-3 py-1.5 bg-emerald-500 text-slate-950 font-bold rounded-lg text-xs hover:bg-emerald-400 transition-colors shadow-sm"
          >
            Compile Packet
          </button>
        </div>
      )}

      {/* Competency Matrix Grid */}
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-base font-bold text-white flex items-center gap-2">
            <Layers className="w-4 h-4 text-teal-400" />
            Competency Evaluation Grid
          </h2>
          <span className="text-xs text-slate-500">
            Showing expectations for <strong className="text-slate-300 font-mono">{selectedLevel}</strong>
          </span>
        </div>

        {currentRubric?.competencies.map((comp) => {
          const report = gapAnalysis?.competencies.find((c) => c.id === comp.id);
          const status = report?.status || 'gap';
          const expectation =
            comp.levels[selectedLevel] || 'No specific criteria defined for this target level.';
          const category = (comp as any).category || formatCategory(comp.id, comp.name);

          // Find mapped evidence records in evidenceList
          let mappedRecords: EvidenceRecord[] = [];
          if (comp.evidence_mapped && comp.evidence_mapped.length > 0) {
            const evIds = new Set(comp.evidence_mapped.map((m) => m.ev_id));
            mappedRecords = evidenceList.filter((e) => evIds.has(e.id));
          } else {
            // Fallback match on themes
            mappedRecords = evidenceList.filter((e) =>
              e.themes?.some(
                (t) =>
                  t.toLowerCase() === comp.id.toLowerCase() ||
                  t.toLowerCase() === comp.name.toLowerCase()
              )
            );
          }

          return (
            <div
              key={comp.id}
              className="p-5 bg-slate-900/60 border border-slate-800 rounded-2xl space-y-4 hover:border-slate-700/80 transition-colors"
            >
              {/* Header row: Name, Category, Status Badge */}
              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 border-b border-slate-800/80 pb-3">
                <div className="space-y-0.5">
                  <div className="flex items-center gap-2">
                    <h3 className="text-base font-bold text-white">{comp.name}</h3>
                    <span className="text-[10px] font-mono text-slate-500 bg-slate-950 px-2 py-0.5 rounded border border-slate-800">
                      {comp.id}
                    </span>
                  </div>
                  <div className="text-xs text-teal-400/80 font-medium">{category}</div>
                </div>

                {/* Status Badge */}
                <div>
                  {status === 'met' && (
                    <span className="inline-flex items-center gap-1 text-xs font-semibold px-2.5 py-1 rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                      <CheckCircle2 className="w-3.5 h-3.5" />
                      Met
                    </span>
                  )}
                  {status === 'partial' && (
                    <span className="inline-flex items-center gap-1 text-xs font-semibold px-2.5 py-1 rounded-full bg-amber-500/10 text-amber-400 border border-amber-500/20">
                      <AlertTriangle className="w-3.5 h-3.5" />
                      Partial
                    </span>
                  )}
                  {status === 'gap' && (
                    <span className="inline-flex items-center gap-1 text-xs font-semibold px-2.5 py-1 rounded-full bg-rose-500/10 text-rose-400 border border-rose-500/20">
                      <AlertCircle className="w-3.5 h-3.5" />
                      Gap
                    </span>
                  )}
                </div>
              </div>

              {/* Expectation description for current target level */}
              <div className="p-3 bg-slate-950/70 border border-slate-800/60 rounded-xl space-y-1">
                <div className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider flex items-center gap-1.5">
                  <span className="font-mono text-teal-400">{selectedLevel}</span> Expectation:
                </div>
                <p className="text-xs text-slate-300 leading-relaxed">{expectation}</p>
              </div>

              {/* Mapped Evidence Section */}
              <div className="space-y-2">
                <div className="text-xs font-semibold text-slate-400 uppercase tracking-wider flex items-center justify-between">
                  <span>Mapped Evidence ({mappedRecords.length})</span>
                  {report?.issues && report.issues.length > 0 && (
                    <span className="text-[11px] text-amber-400 font-normal lowercase">
                      {report.issues.join(' · ')}
                    </span>
                  )}
                </div>

                {mappedRecords.length > 0 ? (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    {mappedRecords.map((ev) => {
                      const hasMissingMetric =
                        !ev.metrics ||
                        ev.metrics.length === 0 ||
                        ev.metrics.some((m) => m.status === 'missing');

                      return (
                        <div
                          key={ev.id}
                          onClick={() => setSelectedEvidence(ev)}
                          className="p-3.5 bg-slate-950 rounded-xl border border-slate-800/90 hover:border-teal-500/40 hover:bg-slate-950/80 transition-all cursor-pointer space-y-2 group"
                        >
                          <div className="flex items-center justify-between">
                            <div className="flex items-center space-x-2">
                              <span className="font-mono text-xs font-bold text-teal-400">
                                {ev.id}
                              </span>
                              <span className="text-xs font-semibold text-white group-hover:text-teal-300 transition-colors truncate max-w-[200px]">
                                {ev.title}
                              </span>
                            </div>
                            {/* Confidence Badge */}
                            <span
                              className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${
                                ev.confidence === 'verified'
                                  ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20'
                                  : ev.confidence === 'provisional'
                                  ? 'bg-amber-500/10 text-amber-400 border border-amber-500/20'
                                  : 'bg-rose-500/10 text-rose-400 border border-rose-500/20'
                              }`}
                            >
                              {ev.confidence}
                            </span>
                          </div>

                          {/* Impact Summary */}
                          <p className="text-xs text-slate-400 line-clamp-2 leading-relaxed">
                            {ev.impact || ev.summary}
                          </p>

                          {/* Footer row: Company & Warnings */}
                          <div className="flex items-center justify-between text-[11px] pt-1 border-t border-slate-900">
                            <span className="text-slate-500 flex items-center gap-1">
                              <Building2 className="w-3 h-3" />
                              {ev.company}
                            </span>

                            {hasMissingMetric && (
                              <span className="text-amber-400 font-semibold flex items-center gap-1 text-[10px]">
                                <AlertTriangle className="w-3 h-3" />
                                Metric Needed
                              </span>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <div className="p-3 bg-slate-950/40 border border-dashed border-slate-800/80 rounded-xl text-xs text-slate-500 flex items-center justify-between">
                    <span>No evidence entries mapped to this competency yet.</span>
                    <span className="text-slate-600 text-[11px]">
                      Tag evidence with &ldquo;{comp.id}&rdquo; to automatically link
                    </span>
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* Modals */}
      <RubricImporterModal
        isOpen={isImporterOpen}
        onClose={() => setIsImporterOpen(false)}
        onImportSuccess={handleRubricImported}
      />

      <BragDocModal
        isOpen={isBragDocOpen}
        onClose={() => setIsBragDocOpen(false)}
        rubrics={rubrics}
        initialRubricId={selectedRubricId}
        initialTargetLevel={selectedLevel}
      />

      <EvidenceDetailModal
        isOpen={!!selectedEvidence}
        onClose={() => setSelectedEvidence(null)}
        evidence={selectedEvidence}
      />
    </div>
  );
};
