import React, { useState, useMemo, useRef } from 'react';
import { X, Search, Plus, ShieldCheck, Clock, Tag } from 'lucide-react';
import type { EvidenceRecord } from '@featherduster/core';
import { useModalA11y } from '../hooks/useModalA11y';

export interface EvidencePickerModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSelectEvidence: (evidence: EvidenceRecord) => void;
  evidenceList: EvidenceRecord[];
}

export const EvidencePickerModal: React.FC<EvidencePickerModalProps> = ({
  isOpen,
  onClose,
  onSelectEvidence,
  evidenceList,
}) => {
  const modalRef = useRef<HTMLDivElement>(null);
  useModalA11y({ isOpen, onClose, containerRef: modalRef });
  const [search, setSearch] = useState('');
  const [selectedCompany, setSelectedCompany] = useState<string>('all');

  const companies = useMemo(() => {
    const set = new Set<string>();
    evidenceList.forEach((e) => {
      if (e.company) set.add(e.company);
    });
    return Array.from(set).sort();
  }, [evidenceList]);

  const filtered = useMemo(() => {
    return evidenceList.filter((e) => {
      if (selectedCompany !== 'all' && e.company !== selectedCompany) {
        return false;
      }
      if (!search.trim()) return true;
      const q = search.toLowerCase();
      const matchId = e.id.toLowerCase().includes(q);
      const matchTitle = e.title.toLowerCase().includes(q);
      const matchSummary = e.summary?.toLowerCase().includes(q);
      const matchCompany = e.company?.toLowerCase().includes(q);
      const matchThemes = (e.themes || []).some((t) => t.toLowerCase().includes(q));
      return matchId || matchTitle || matchSummary || matchCompany || matchThemes;
    });
  }, [evidenceList, search, selectedCompany]);

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-sm animate-fadeIn"
      onClick={onClose}
    >
      <div
        ref={modalRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="evidence-picker-title"
        className="relative w-full max-w-2xl bg-slate-900 border border-slate-800 rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[85vh]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-800 bg-slate-950/70">
          <div>
            <h2 id="evidence-picker-title" className="text-lg font-bold text-white flex items-center gap-2">
              Insert Accomplishment from Evidence Store
            </h2>
            <p className="text-xs text-slate-400">
              Select verified evidence to generate an ATS bullet with linked citation tags.
            </p>
          </div>
          <button
            onClick={onClose}
            className="p-2 text-slate-400 hover:text-white hover:bg-slate-800 rounded-lg transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Filters */}
        <div className="p-4 border-b border-slate-800 bg-slate-900/50 flex flex-col sm:flex-row gap-3">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-2.5 w-4 h-4 text-slate-400" />
            <input
              type="text"
              placeholder="Search evidence by title, summary, or ID..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full pl-9 pr-4 py-2 bg-slate-950 border border-slate-800 rounded-xl text-xs text-white placeholder-slate-500 focus:outline-none focus:border-purple-500"
            />
          </div>
          {companies.length > 0 && (
            <select
              value={selectedCompany}
              onChange={(e) => setSelectedCompany(e.target.value)}
              aria-label="Filter by organization"
              className="px-3 py-2 bg-slate-950 border border-slate-800 rounded-xl text-xs text-slate-300 focus:outline-none focus:border-purple-500"
            >
              <option value="all">All Organizations</option>
              {companies.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          )}
        </div>

        {/* Evidence List */}
        <div className="p-4 overflow-y-auto flex-1 space-y-3">
          {filtered.length === 0 ? (
            <div className="text-center py-12 text-slate-500 text-xs">
              No evidence cards match your search filter.
            </div>
          ) : (
            filtered.map((ev) => (
              <div
                key={ev.id}
                className="p-4 rounded-xl bg-slate-950/60 border border-slate-800 hover:border-slate-700 transition-all space-y-2 group"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="space-y-1 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-mono text-xs font-semibold px-2 py-0.5 rounded bg-purple-950/40 text-purple-300 border border-purple-500/30">
                        {ev.id}
                      </span>
                      <span className="text-xs font-semibold text-white">{ev.title}</span>
                      {ev.confidence === 'verified' ? (
                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 flex items-center gap-1 font-medium">
                          <ShieldCheck className="w-2.5 h-2.5" /> Verified
                        </span>
                      ) : (
                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-500/10 text-amber-400 border border-amber-500/20 flex items-center gap-1 font-medium">
                          <Clock className="w-2.5 h-2.5" /> Provisional
                        </span>
                      )}
                    </div>
                    {ev.company && (
                      <p className="text-[11px] text-slate-400 font-medium">
                        {ev.company} {ev.date ? `• ${ev.date}` : ''}
                      </p>
                    )}
                  </div>

                  <button
                    onClick={() => onSelectEvidence(ev)}
                    className="shrink-0 px-3 py-1.5 bg-purple-600 hover:bg-purple-500 text-white rounded-lg text-xs font-semibold transition-all inline-flex items-center gap-1.5 shadow-sm shadow-purple-900/30"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    <span>Insert Bullet</span>
                  </button>
                </div>

                <p className="text-xs text-slate-300 leading-relaxed">
                  {ev.summary || ev.impact}
                </p>

                {ev.themes && ev.themes.length > 0 && (
                  <div className="flex items-center gap-1.5 flex-wrap pt-1">
                    {ev.themes.map((theme) => (
                      <span
                        key={theme}
                        className="text-[10px] px-1.5 py-0.5 rounded bg-slate-900 text-slate-400 border border-slate-800 flex items-center gap-1"
                      >
                        <Tag className="w-2.5 h-2.5 text-slate-500" />
                        {theme}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            ))
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-3 border-t border-slate-800 bg-slate-950/60 flex items-center justify-between text-xs text-slate-400">
          <span>Showing {filtered.length} of {evidenceList.length} evidence records</span>
          <button
            onClick={onClose}
            className="px-3 py-1.5 text-slate-300 hover:text-white hover:bg-slate-800 rounded-lg transition-colors"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
};
