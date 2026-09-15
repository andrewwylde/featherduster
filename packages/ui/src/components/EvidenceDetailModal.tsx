import React, { useState } from 'react';
import {
  X,
  Calendar,
  Building2,
  Tag,
  CheckCircle2,
  FileCode,
  Copy,
  Check,
  Layers,
  Sparkles,
} from 'lucide-react';
import type { EvidenceRecord } from '@featherduster/core';

interface EvidenceDetailModalProps {
  evidence: EvidenceRecord | null;
  isOpen: boolean;
  onClose: () => void;
}

export const EvidenceDetailModal: React.FC<EvidenceDetailModalProps> = ({
  evidence,
  isOpen,
  onClose,
}) => {
  const [copiedCitation, setCopiedCitation] = useState(false);

  if (!isOpen || !evidence) return null;

  const copyCitation = () => {
    navigator.clipboard.writeText(`(${evidence.id})`);
    setCopiedCitation(true);
    setTimeout(() => setCopiedCitation(false), 2000);
  };

  const getConfidenceBadge = (confidence: string) => {
    switch (confidence) {
      case 'verified':
        return (
          <span className="px-2.5 py-1 text-xs font-semibold rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
            Verified
          </span>
        );
      case 'provisional':
        return (
          <span className="px-2.5 py-1 text-xs font-semibold rounded-full bg-amber-500/10 text-amber-400 border border-amber-500/20">
            Provisional
          </span>
        );
      case 'retracted':
        return (
          <span className="px-2.5 py-1 text-xs font-semibold rounded-full bg-rose-500/10 text-rose-400 border border-rose-500/20">
            Retracted
          </span>
        );
      default:
        return (
          <span className="px-2.5 py-1 text-xs font-semibold rounded-full bg-slate-800 text-slate-300">
            {confidence}
          </span>
        );
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-sm animate-fadeIn">
      <div className="relative w-full max-w-4xl bg-slate-900 border border-slate-800 rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[92vh]">
        {/* Header */}
        <div className="flex items-start justify-between px-6 py-5 border-b border-slate-800 bg-slate-950/70">
          <div className="space-y-1.5 max-w-2xl">
            <div className="flex items-center space-x-3">
              <span className="text-xs font-mono font-bold px-2.5 py-1 rounded bg-slate-800 text-emerald-400 border border-slate-700">
                {evidence.id}
              </span>
              {getConfidenceBadge(evidence.confidence)}
              {evidence.in_flight && (
                <span className="px-2.5 py-1 text-xs font-semibold rounded-full bg-blue-500/10 text-blue-400 border border-blue-500/20">
                  In Flight
                </span>
              )}
            </div>
            <h2 className="text-xl font-bold text-white tracking-tight">{evidence.title}</h2>
            <div className="flex items-center space-x-4 text-xs text-slate-400">
              <span className="flex items-center gap-1.5">
                <Building2 className="w-3.5 h-3.5 text-slate-500" />
                <span className="capitalize font-medium text-slate-300">{evidence.company}</span>
              </span>
              <span className="flex items-center gap-1.5">
                <Calendar className="w-3.5 h-3.5 text-slate-500" />
                <span>{evidence.date}</span>
              </span>
              {evidence.filePath && (
                <span className="flex items-center gap-1.5 font-mono text-slate-500 truncate max-w-xs">
                  <FileCode className="w-3.5 h-3.5" />
                  <span>{evidence.filePath.split(/[/\\]/).slice(-2).join('/')}</span>
                </span>
              )}
            </div>
          </div>

          <div className="flex items-center space-x-2">
            <button
              onClick={copyCitation}
              title="Copy citation token e.g. (ev-001)"
              className="flex items-center space-x-1 px-3 py-1.5 bg-slate-800 hover:bg-slate-700 border border-slate-700 rounded-lg text-xs font-medium text-slate-200 transition-colors"
            >
              {copiedCitation ? (
                <>
                  <Check className="w-3.5 h-3.5 text-emerald-400" />
                  <span className="text-emerald-400">Copied!</span>
                </>
              ) : (
                <>
                  <Copy className="w-3.5 h-3.5 text-slate-400" />
                  <span>Copy Citation</span>
                </>
              )}
            </button>
            <button
              onClick={onClose}
              className="p-2 text-slate-400 hover:text-white hover:bg-slate-800 rounded-lg transition-colors"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Content Body */}
        <div className="p-6 overflow-y-auto flex-1 space-y-6">
          {/* Key Impact Highlight Banner */}
          <div className="rounded-xl border border-emerald-500/20 bg-emerald-950/20 p-4 space-y-1.5">
            <div className="flex items-center space-x-2 text-xs font-semibold text-emerald-400 uppercase tracking-wider">
              <Sparkles className="w-3.5 h-3.5" />
              <span>Measurable Business Impact</span>
            </div>
            <p className="text-base font-semibold text-white leading-relaxed">{evidence.impact}</p>
          </div>

          {/* Summary */}
          <div className="space-y-1.5">
            <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wider">
              Architectural Summary
            </h3>
            <p className="text-sm text-slate-200 leading-relaxed bg-slate-950/50 p-3.5 rounded-xl border border-slate-800/80">
              {evidence.summary}
            </p>
          </div>

          {/* Metrics Section */}
          <div className="space-y-2">
            <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wider flex items-center gap-1.5">
              <CheckCircle2 className="w-4 h-4 text-emerald-400" />
              <span>Verified Metrics ({evidence.metrics?.length ?? 0})</span>
            </h3>
            {evidence.metrics && evidence.metrics.length > 0 ? (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                {evidence.metrics.map((m, idx) => (
                  <div
                    key={idx}
                    className="p-3 bg-slate-950 rounded-xl border border-slate-800/80 flex flex-col justify-between space-y-1"
                  >
                    <span className="text-xs text-slate-400 font-medium">{m.name}</span>
                    <div className="flex items-baseline justify-between">
                      <span className="text-lg font-bold font-mono text-emerald-400">{m.value}</span>
                      <span
                        className={`text-[10px] font-semibold uppercase px-2 py-0.5 rounded-full ${
                          m.status === 'verified'
                            ? 'bg-emerald-500/10 text-emerald-300'
                            : m.status === 'provisional'
                            ? 'bg-amber-500/10 text-amber-300'
                            : 'bg-rose-500/10 text-rose-300'
                        }`}
                      >
                        {m.status}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-xs text-slate-500 italic">No quantitative metrics registered.</p>
            )}
          </div>

          {/* Themes Chips */}
          {evidence.themes && evidence.themes.length > 0 && (
            <div className="space-y-1.5">
              <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wider flex items-center gap-1.5">
                <Tag className="w-3.5 h-3.5 text-slate-400" />
                <span>Tagged Competencies & Themes</span>
              </h3>
              <div className="flex flex-wrap gap-2">
                {evidence.themes.map((t) => (
                  <span
                    key={t}
                    className="px-2.5 py-1 rounded-lg text-xs font-medium bg-slate-800 text-slate-300 border border-slate-700/60"
                  >
                    #{t}
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Internal References */}
          {evidence.internal_references && evidence.internal_references.length > 0 && (
            <div className="space-y-1.5">
              <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wider flex items-center gap-1.5">
                <Layers className="w-3.5 h-3.5 text-slate-400" />
                <span>Internal Ticket & PR References</span>
              </h3>
              <div className="flex flex-wrap gap-2">
                {evidence.internal_references.map((r, idx) => (
                  <span
                    key={idx}
                    className="inline-flex items-center space-x-1.5 px-2.5 py-1 rounded-lg text-xs font-mono bg-slate-950 text-slate-300 border border-slate-800"
                  >
                    <span className="uppercase text-slate-500 font-sans text-[10px]">{r.type}:</span>
                    <span className="text-emerald-400 font-semibold">{r.ref}</span>
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Full Narrative Markdown Section */}
          <div className="space-y-2 pt-2 border-t border-slate-800/80">
            <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wider">
              Technical Narrative & Context
            </h3>
            <div className="p-4 rounded-xl bg-slate-950/70 border border-slate-800 text-sm font-mono whitespace-pre-wrap text-slate-300 leading-relaxed">
              {evidence.narrative?.trim() || '(No technical narrative documented yet)'}
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-6 py-4 border-t border-slate-800 bg-slate-950/80">
          <div className="text-xs text-slate-500">
            Citation syntax for resume & brag docs:{' '}
            <code className="text-emerald-400 font-mono">({evidence.id})</code>
          </div>
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm font-medium text-slate-300 hover:text-white bg-slate-800 hover:bg-slate-700 rounded-lg transition-colors"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
};
