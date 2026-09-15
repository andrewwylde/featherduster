import React from 'react';
import { ShieldCheck, AlertTriangle, X, RefreshCw, AlertCircle, FileText } from 'lucide-react';
import type { IntegrityCheckResponse } from '../api/client';

interface IntegrityModalProps {
  isOpen: boolean;
  onClose: () => void;
  report: IntegrityCheckResponse | null;
  loading: boolean;
  onRefresh: () => void;
}

export const IntegrityModal: React.FC<IntegrityModalProps> = ({
  isOpen,
  onClose,
  report,
  loading,
  onRefresh,
}) => {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm animate-fadeIn">
      <div className="relative w-full max-w-2xl bg-slate-900 border border-slate-800 rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
        {/* Modal Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-800 bg-slate-950/60">
          <div className="flex items-center space-x-3">
            <div className={`p-2 rounded-lg ${report?.isClean ? 'bg-emerald-500/10 text-emerald-400' : 'bg-rose-500/10 text-rose-400'}`}>
              {report?.isClean ? <ShieldCheck className="w-5 h-5" /> : <AlertTriangle className="w-5 h-5" />}
            </div>
            <div>
              <h2 className="text-lg font-semibold text-slate-100 flex items-center gap-2">
                Integrity & Privacy Audit
                {report && (
                  <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                    report.isClean 
                      ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30' 
                      : 'bg-rose-500/20 text-rose-300 border border-rose-500/30'
                  }`}>
                    {report.isClean ? 'PASSED (0 Violations)' : `${report.issues.length} VIOLATION${report.issues.length === 1 ? '' : 'S'}`}
                  </span>
                )}
              </h2>
              <p className="text-xs text-slate-400">
                Audits dangling citations, unverified metric tokens, and banned privacy leaks.
              </p>
            </div>
          </div>
          <div className="flex items-center space-x-2">
            <button
              onClick={onRefresh}
              disabled={loading}
              title="Re-run audit"
              className="p-2 text-slate-400 hover:text-slate-200 hover:bg-slate-800 rounded-lg transition-colors disabled:opacity-50"
            >
              <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
            </button>
            <button
              onClick={onClose}
              className="p-2 text-slate-400 hover:text-slate-200 hover:bg-slate-800 rounded-lg transition-colors"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Modal Body */}
        <div className="p-6 overflow-y-auto flex-1 space-y-4">
          {loading && !report ? (
            <div className="flex flex-col items-center justify-center py-12 text-slate-400">
              <RefreshCw className="w-8 h-8 animate-spin text-emerald-500 mb-3" />
              <p className="text-sm">Auditing workspace integrity...</p>
            </div>
          ) : report?.isClean ? (
            <div className="rounded-xl border border-emerald-500/30 bg-emerald-950/20 p-6 text-center space-y-3">
              <div className="inline-flex p-3 rounded-full bg-emerald-500/20 text-emerald-400">
                <ShieldCheck className="w-8 h-8" />
              </div>
              <h3 className="text-base font-semibold text-emerald-300">Clean Workspace Verification</h3>
              <p className="text-sm text-slate-300 max-w-md mx-auto">
                All evidence citations map to valid entries, metric tokens are fully specified, and no prohibited company keywords or privacy leaks were detected.
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              <div className="flex items-center justify-between text-xs text-slate-400 font-mono pb-1 border-b border-slate-800">
                <span>Violations detected ({report?.issues.length ?? 0})</span>
                <span>Review and resolve before compiling</span>
              </div>
              {report?.issues.map((issue, idx) => (
                <div
                  key={idx}
                  className="rounded-xl border border-rose-500/20 bg-rose-950/20 p-4 space-y-2"
                >
                  <div className="flex items-start justify-between">
                    <div className="flex items-center space-x-2 text-xs font-semibold text-rose-300 uppercase tracking-wider">
                      <AlertCircle className="w-4 h-4 text-rose-400" />
                      <span>{issue.type.replace(/_/g, ' ')}</span>
                    </div>
                    {issue.line && (
                      <span className="text-xs font-mono text-slate-400">Line {issue.line}</span>
                    )}
                  </div>
                  <p className="text-sm text-slate-200 font-medium">{issue.message}</p>
                  <div className="flex items-center space-x-2 text-xs font-mono text-slate-400 bg-slate-950/60 px-2.5 py-1.5 rounded-lg border border-slate-800/80">
                    <FileText className="w-3.5 h-3.5 text-slate-500" />
                    <span>{issue.file}</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Modal Footer */}
        <div className="flex items-center justify-between px-6 py-4 border-t border-slate-800 bg-slate-950/80">
          <div className="text-xs text-slate-400">
            Protected by Git Push Defense and local-first offline enforcement.
          </div>
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm font-medium text-slate-300 hover:text-slate-100 bg-slate-800 hover:bg-slate-700 rounded-lg transition-colors"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
};
