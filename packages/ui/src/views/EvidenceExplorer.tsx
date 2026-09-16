import React, { useState, useEffect, useMemo, useCallback } from 'react';
import {
  Search,
  Plus,
  CheckCircle2,
  Clock,
  AlertCircle,
  Building2,
  Layers,
  Sparkles,
  RefreshCw,
  FolderOpen,
  Tag,
} from 'lucide-react';
import type { EvidenceRecord } from '@featherduster/core';
import { apiClient } from '../api/client';
import { useLiveSync } from '../hooks/useLiveSync';
import { QuickCaptureModal } from '../components/QuickCaptureModal';
import { EvidenceDetailModal } from '../components/EvidenceDetailModal';

export const EvidenceExplorer: React.FC = () => {
  const [evidenceList, setEvidenceList] = useState<EvidenceRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Filters state
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCompany, setSelectedCompany] = useState<string>('all');
  const [selectedConfidence, setSelectedConfidence] = useState<string>('all');
  const [missingMetricsOnly, setMissingMetricsOnly] = useState<boolean>(false);
  const [selectedTheme, setSelectedTheme] = useState<string | null>(null);

  // Modal states
  const [isCaptureModalOpen, setIsCaptureModalOpen] = useState(false);
  const [selectedEvidence, setSelectedEvidence] = useState<EvidenceRecord | null>(null);

  const fetchEvidence = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const data = await apiClient.getEvidence();
      setEvidenceList(data);
    } catch (err: any) {
      setError(err.message || 'Failed to load evidence entries');
    } finally {
      setLoading(false);
    }
  }, []);

  // Hook up SSE live sync
  useLiveSync(() => {
    fetchEvidence();
  });

  useEffect(() => {
    fetchEvidence();
  }, [fetchEvidence]);

  // Distinct metadata
  const distinctCompanies = useMemo(() => {
    const set = new Set<string>();
    evidenceList.forEach((e) => {
      if (e.company) set.add(e.company.toLowerCase());
    });
    return Array.from(set).sort();
  }, [evidenceList]);

  const distinctThemes = useMemo(() => {
    const counts = new Map<string, number>();
    evidenceList.forEach((e) => {
      e.themes?.forEach((t) => {
        const lower = t.toLowerCase();
        counts.set(lower, (counts.get(lower) || 0) + 1);
      });
    });
    return Array.from(counts.entries())
      .sort((a, b) => b[1] - a[1])
      .map(([theme]) => theme);
  }, [evidenceList]);

  const existingIds = useMemo(() => {
    return evidenceList.map((e) => e.id);
  }, [evidenceList]);

  // Filtered evidence items
  const filteredEvidence = useMemo(() => {
    return evidenceList.filter((entry) => {
      // 1. Company filter
      if (selectedCompany !== 'all' && entry.company?.toLowerCase() !== selectedCompany.toLowerCase()) {
        return false;
      }

      // 2. Confidence filter
      if (selectedConfidence !== 'all' && entry.confidence !== selectedConfidence) {
        return false;
      }

      // 3. Missing metrics filter
      if (missingMetricsOnly) {
        const hasMissing =
          !entry.metrics ||
          entry.metrics.length === 0 ||
          entry.metrics.some((m) => m.status === 'missing');
        if (!hasMissing) return false;
      }

      // 4. Theme filter
      if (selectedTheme) {
        const hasTheme = entry.themes?.some((t) => t.toLowerCase() === selectedTheme.toLowerCase());
        if (!hasTheme) return false;
      }

      // 5. Search query (matches id, title, summary, impact, themes, metrics)
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase().trim();
        const matchesId = entry.id?.toLowerCase().includes(q);
        const matchesTitle = entry.title?.toLowerCase().includes(q);
        const matchesSummary = entry.summary?.toLowerCase().includes(q);
        const matchesImpact = entry.impact?.toLowerCase().includes(q);
        const matchesCompany = entry.company?.toLowerCase().includes(q);
        const matchesTheme = entry.themes?.some((t) => t.toLowerCase().includes(q));
        const matchesMetric = entry.metrics?.some(
          (m) => m.name.toLowerCase().includes(q) || m.value.toLowerCase().includes(q)
        );

        if (
          !matchesId &&
          !matchesTitle &&
          !matchesSummary &&
          !matchesImpact &&
          !matchesCompany &&
          !matchesTheme &&
          !matchesMetric
        ) {
          return false;
        }
      }

      return true;
    });
  }, [
    evidenceList,
    selectedCompany,
    selectedConfidence,
    missingMetricsOnly,
    selectedTheme,
    searchQuery,
  ]);

  // Statistics calculation
  const stats = useMemo(() => {
    const total = evidenceList.length;
    let verified = 0;
    let provisional = 0;
    let inFlight = 0;
    let metricsAttention = 0;

    evidenceList.forEach((e) => {
      if (e.confidence === 'verified') verified++;
      if (e.confidence === 'provisional') provisional++;
      if (e.in_flight) inFlight++;

      const hasMissingOrProvisionalMetric =
        !e.metrics ||
        e.metrics.length === 0 ||
        e.metrics.some((m) => m.status === 'missing' || m.status === 'provisional');
      if (hasMissingOrProvisionalMetric) {
        metricsAttention++;
      }
    });

    return { total, verified, provisional, inFlight, metricsAttention };
  }, [evidenceList]);

  return (
    <div className="space-y-6 animate-fadeIn">
      {/* Top Header & Capture Action */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-white flex items-center gap-2.5">
            Evidence Explorer
            <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-slate-800 text-emerald-400 border border-slate-700 font-mono">
              {filteredEvidence.length} of {evidenceList.length}
            </span>
          </h1>
          <p className="text-sm text-slate-400">
            Search, filter, and inspect verified engineering accomplishments backed by markdown.
          </p>
        </div>

        <div className="flex items-center space-x-3">
          <button
            onClick={fetchEvidence}
            disabled={loading}
            className="p-2.5 bg-slate-900 hover:bg-slate-800 border border-slate-800 text-slate-400 hover:text-white rounded-xl transition-colors disabled:opacity-50"
            title="Refresh evidence list"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          </button>
          <button
            onClick={() => setIsCaptureModalOpen(true)}
            className="flex items-center space-x-2 px-4 py-2.5 bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-semibold rounded-xl shadow-lg shadow-emerald-500/20 transition-all cursor-pointer"
          >
            <Plus className="w-4 h-4 stroke-[2.5]" />
            <span>Capture Evidence</span>
          </button>
        </div>
      </div>

      {/* Summary Metric Counters */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3 sm:gap-4">
        {/* Total Cards */}
        <div className="p-4 bg-slate-900/70 border border-slate-800/80 rounded-2xl flex flex-col justify-between">
          <div className="flex items-center justify-between text-slate-400 mb-2">
            <span className="text-xs font-medium uppercase tracking-wider">Total Evidence</span>
            <Layers className="w-4 h-4 text-slate-500" />
          </div>
          <span className="text-2xl font-bold text-white font-mono">{stats.total}</span>
        </div>

        {/* Verified Count */}
        <div className="p-4 bg-slate-900/70 border border-slate-800/80 rounded-2xl flex flex-col justify-between">
          <div className="flex items-center justify-between text-emerald-400 mb-2">
            <span className="text-xs font-medium uppercase tracking-wider">Verified</span>
            <CheckCircle2 className="w-4 h-4" />
          </div>
          <span className="text-2xl font-bold text-emerald-400 font-mono">{stats.verified}</span>
        </div>

        {/* Provisional Count */}
        <div className="p-4 bg-slate-900/70 border border-slate-800/80 rounded-2xl flex flex-col justify-between">
          <div className="flex items-center justify-between text-amber-400 mb-2">
            <span className="text-xs font-medium uppercase tracking-wider">Provisional</span>
            <Clock className="w-4 h-4" />
          </div>
          <span className="text-2xl font-bold text-amber-400 font-mono">{stats.provisional}</span>
        </div>

        {/* In-Flight Count */}
        <div className="p-4 bg-slate-900/70 border border-slate-800/80 rounded-2xl flex flex-col justify-between">
          <div className="flex items-center justify-between text-blue-400 mb-2">
            <span className="text-xs font-medium uppercase tracking-wider">In Flight</span>
            <Sparkles className="w-4 h-4" />
          </div>
          <span className="text-2xl font-bold text-blue-400 font-mono">{stats.inFlight}</span>
        </div>

        {/* Metrics Attention Count */}
        <div className="p-4 bg-slate-900/70 border border-slate-800/80 rounded-2xl flex flex-col justify-between col-span-2 sm:col-span-1">
          <div className="flex items-center justify-between text-rose-400 mb-2">
            <span className="text-xs font-medium uppercase tracking-wider">Needs Metrics</span>
            <AlertCircle className="w-4 h-4" />
          </div>
          <span className="text-2xl font-bold text-rose-400 font-mono">{stats.metricsAttention}</span>
        </div>
      </div>

      {/* Filter & Search Bar */}
      <div className="p-4 bg-slate-900/50 border border-slate-800/80 rounded-2xl space-y-3">
        <div className="flex flex-col md:flex-row items-stretch md:items-center gap-3">
          {/* Instant Search Input */}
          <div className="relative flex-1">
            <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search title, impact, themes, metrics, or ID..."
              className="w-full pl-10 pr-4 py-2 bg-slate-950 border border-slate-800 rounded-xl text-sm text-white placeholder-slate-500 focus:outline-none focus:border-emerald-500 transition-colors"
            />
            {searchQuery && (
              <button
                onClick={() => setSearchQuery('')}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-slate-400 hover:text-white"
              >
                Clear
              </button>
            )}
          </div>

          {/* Filter Dropdowns & Pills */}
          <div className="flex flex-wrap items-center gap-2">
            {/* Company Dropdown */}
            <select
              value={selectedCompany}
              onChange={(e) => setSelectedCompany(e.target.value)}
              className="px-3 py-2 bg-slate-950 border border-slate-800 rounded-xl text-xs sm:text-sm text-slate-200 focus:outline-none focus:border-emerald-500"
            >
              <option value="all">All Companies</option>
              {distinctCompanies.map((c) => (
                <option key={c} value={c}>
                  {c.toUpperCase()}
                </option>
              ))}
            </select>

            {/* Confidence Dropdown */}
            <select
              value={selectedConfidence}
              onChange={(e) => setSelectedConfidence(e.target.value)}
              className="px-3 py-2 bg-slate-950 border border-slate-800 rounded-xl text-xs sm:text-sm text-slate-200 focus:outline-none focus:border-emerald-500"
            >
              <option value="all">All Confidence</option>
              <option value="verified">Verified</option>
              <option value="provisional">Provisional</option>
              <option value="retracted">Retracted</option>
            </select>

            {/* Missing Metrics Pill */}
            <button
              onClick={() => setMissingMetricsOnly(!missingMetricsOnly)}
              className={`px-3 py-2 rounded-xl text-xs font-medium transition-colors border ${
                missingMetricsOnly
                  ? 'bg-rose-950/40 border-rose-500/40 text-rose-300'
                  : 'bg-slate-950 border-slate-800 text-slate-400 hover:text-slate-200'
              }`}
            >
              Missing Metrics Only
            </button>
          </div>
        </div>

        {/* Theme Filter Chips */}
        {distinctThemes.length > 0 && (
          <div className="flex items-center gap-1.5 overflow-x-auto pb-1 pt-1 text-xs">
            <span className="text-slate-500 flex items-center gap-1 pr-1 shrink-0 font-medium">
              <Tag className="w-3 h-3" /> Themes:
            </span>
            {selectedTheme && (
              <button
                onClick={() => setSelectedTheme(null)}
                className="px-2 py-0.5 rounded-full bg-slate-800 text-slate-300 hover:bg-slate-700 shrink-0"
              >
                All Themes ✕
              </button>
            )}
            {distinctThemes.map((theme) => {
              const isSelected = selectedTheme === theme;
              return (
                <button
                  key={theme}
                  onClick={() => setSelectedTheme(isSelected ? null : theme)}
                  className={`px-2.5 py-1 rounded-lg shrink-0 transition-colors font-medium ${
                    isSelected
                      ? 'bg-emerald-500 text-slate-950 font-semibold'
                      : 'bg-slate-950 text-slate-400 hover:text-white border border-slate-800 hover:border-slate-700'
                  }`}
                >
                  #{theme}
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* Content Area: Grid of Evidence Cards */}
      {error && evidenceList.length > 0 && (
        <div className="p-4 bg-rose-950/30 border border-rose-500/30 rounded-2xl text-rose-300 text-sm flex items-center gap-3">
          <AlertCircle className="w-5 h-5 text-rose-400 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {error && evidenceList.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 bg-rose-950/20 border border-dashed border-rose-800/60 rounded-2xl text-center p-6 space-y-4">
          <div className="p-3 bg-rose-900/40 rounded-2xl text-rose-400">
            <AlertCircle className="w-8 h-8" />
          </div>
          <div className="space-y-1">
            <h3 className="text-base font-semibold text-white">Cannot reach local Featherduster server</h3>
            <p className="text-sm text-rose-300/80 max-w-sm">
              {error}. Ensure the local server is running on{' '}
              <code className="font-mono text-xs bg-slate-900 px-1.5 py-0.5 rounded text-rose-300 border border-rose-900/50">
                127.0.0.1:4173
              </code>
            </p>
          </div>
          <button
            onClick={() => fetchEvidence()}
            className="px-4 py-2 bg-rose-600 hover:bg-rose-500 text-white text-sm font-semibold rounded-xl transition-colors inline-flex items-center gap-2"
          >
            <RefreshCw className="w-4 h-4" />
            <span>Retry Connection</span>
          </button>
        </div>
      ) : loading && evidenceList.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 text-slate-500 space-y-3">
          <RefreshCw className="w-8 h-8 animate-spin text-emerald-500" />
          <p className="text-sm">Loading evidence from disk...</p>
        </div>
      ) : filteredEvidence.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 bg-slate-900/30 border border-dashed border-slate-800 rounded-2xl text-center p-6 space-y-4">
          <div className="p-3 bg-slate-800/80 rounded-2xl text-slate-400">
            <FolderOpen className="w-8 h-8" />
          </div>
          <div className="space-y-1">
            <h3 className="text-base font-semibold text-white">No evidence entries found</h3>
            <p className="text-sm text-slate-400 max-w-sm">
              {evidenceList.length === 0
                ? 'Your evidence folder is empty. Capture your first concrete achievement to get started.'
                : 'No evidence matches your active search and filter criteria.'}
            </p>
          </div>
          {evidenceList.length === 0 ? (
            <button
              onClick={() => setIsCaptureModalOpen(true)}
              className="px-4 py-2 bg-emerald-500 hover:bg-emerald-400 text-slate-950 text-sm font-semibold rounded-xl transition-colors"
            >
              + Capture First Evidence Card
            </button>
          ) : (
            <button
              onClick={() => {
                setSearchQuery('');
                setSelectedCompany('all');
                setSelectedConfidence('all');
                setMissingMetricsOnly(false);
                setSelectedTheme(null);
              }}
              className="text-xs text-emerald-400 hover:underline"
            >
              Reset all filters
            </button>
          )}
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 sm:gap-5">
          {filteredEvidence.map((item) => (
            <div
              key={item.id}
              onClick={() => setSelectedEvidence(item)}
                className="group relative bg-slate-900/60 hover:bg-slate-900 border border-slate-800 hover:border-slate-700 rounded-2xl p-5 flex flex-col justify-between transition-all duration-200 hover:shadow-xl hover:shadow-emerald-950/20 cursor-pointer"
              >
                {/* Top Card Row: ID, Company, Confidence Badge */}
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center space-x-2">
                      <span className="text-xs font-mono font-bold px-2 py-0.5 rounded bg-slate-950 text-emerald-400 border border-slate-800">
                        {item.id}
                      </span>
                      <span className="text-xs font-medium text-slate-400 uppercase tracking-wider flex items-center gap-1">
                        <Building2 className="w-3 h-3 text-slate-500" />
                        {item.company}
                      </span>
                    </div>

                    <div className="flex items-center space-x-1.5">
                      {item.confidence === 'verified' && (
                        <span className="px-2 py-0.5 text-[10px] font-semibold rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                          Verified
                        </span>
                      )}
                      {item.confidence === 'provisional' && (
                        <span className="px-2 py-0.5 text-[10px] font-semibold rounded-full bg-amber-500/10 text-amber-400 border border-amber-500/20">
                          Provisional
                        </span>
                      )}
                      {item.confidence === 'retracted' && (
                        <span className="px-2 py-0.5 text-[10px] font-semibold rounded-full bg-rose-500/10 text-rose-400 border border-rose-500/20">
                          Retracted
                        </span>
                      )}
                      {item.in_flight && (
                        <span className="px-2 py-0.5 text-[10px] font-semibold rounded-full bg-blue-500/10 text-blue-400 border border-blue-500/20">
                          In Flight
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Title */}
                  <h3 className="text-base font-bold text-white group-hover:text-emerald-300 transition-colors line-clamp-2">
                    {item.title}
                  </h3>

                  {/* Key Impact Snippet */}
                  <div className="p-3 bg-slate-950/60 rounded-xl border border-slate-800/60 text-xs text-slate-300 line-clamp-3">
                    <span className="font-semibold text-emerald-400">Impact: </span>
                    {item.impact}
                  </div>
                </div>

                {/* Bottom Section: Metrics & Themes */}
                <div className="pt-4 mt-4 border-t border-slate-800/60 space-y-3">
                  {/* Metrics Badges */}
                  {item.metrics && item.metrics.length > 0 ? (
                    <div className="flex flex-wrap gap-1.5">
                      {item.metrics.slice(0, 2).map((m, idx) => (
                        <span
                          key={idx}
                          className="inline-flex items-center space-x-1 px-2 py-0.5 rounded-md bg-slate-950 border border-slate-800 text-[11px] font-mono text-slate-300"
                        >
                          <span className="text-emerald-400 font-bold">{m.value}</span>
                          <span className="text-slate-500 truncate max-w-[100px]">{m.name}</span>
                        </span>
                      ))}
                      {item.metrics.length > 2 && (
                        <span className="text-[11px] font-mono text-slate-500 self-center">
                          +{item.metrics.length - 2} more
                        </span>
                      )}
                    </div>
                  ) : (
                    <div className="text-[11px] text-amber-400/90 flex items-center gap-1 font-medium">
                      <AlertCircle className="w-3.5 h-3.5" />
                      <span>Metric attention required</span>
                    </div>
                  )}

                  {/* Themes & Date */}
                  <div className="flex items-center justify-between text-xs text-slate-500 pt-1">
                    <div className="flex flex-wrap gap-1 truncate max-w-[200px]">
                      {item.themes?.slice(0, 2).map((t) => (
                        <span key={t} className="text-[11px] text-slate-400">
                          #{t}
                        </span>
                      ))}
                      {item.themes && item.themes.length > 2 && (
                        <span className="text-[11px] text-slate-600">+{item.themes.length - 2}</span>
                      )}
                    </div>
                    <span className="text-[11px] font-mono shrink-0">{item.date}</span>
                  </div>
                </div>
              </div>
            ))}
        </div>
      )}

      {/* Quick Capture Modal */}
      <QuickCaptureModal
        isOpen={isCaptureModalOpen}
        onClose={() => setIsCaptureModalOpen(false)}
        onSuccess={() => fetchEvidence()}
        existingIds={existingIds}
        existingCompanies={distinctCompanies}
      />

      {/* Evidence Detail Modal */}
      <EvidenceDetailModal
        isOpen={!!selectedEvidence}
        evidence={selectedEvidence}
        onClose={() => setSelectedEvidence(null)}
      />
    </div>
  );
};
