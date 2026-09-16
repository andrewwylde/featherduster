import React, { useState, useEffect, useCallback } from 'react';
import {
  ShieldCheck,
  AlertTriangle,
  X,
  RefreshCw,
  CheckCircle2,
  AlertCircle,
  Download,
  Copy,
  Check,
  Tag,
  Hash,
  EyeOff,
  Sparkles,
} from 'lucide-react';
import { apiClient, type PreflightResult } from '../api/client';
import { useModalA11y } from '../hooks/useModalA11y';
import type { ResumeSpec } from '@featherduster/core';

export interface PreFlightModalProps {
  isOpen: boolean;
  onClose: () => void;
  spec?: ResumeSpec;
  text?: string;
  onRedactAndDownload?: (redactedText: string) => void;
  onTextCleaned?: (cleanedText: string) => void;
}

export const PreFlightModal: React.FC<PreFlightModalProps> = ({
  isOpen,
  onClose,
  spec,
  text,
  onRedactAndDownload,
  onTextCleaned,
}) => {
  useModalA11y({ isOpen, onClose });
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<PreflightResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [deslopping, setDeslopping] = useState(false);
  const [fixesApplied, setFixesApplied] = useState<string[]>([]);
  const [cleanedPreviewText, setCleanedPreviewText] = useState<string | null>(null);

  const runCheck = useCallback(async () => {
    if (!isOpen) return;
    setLoading(true);
    setError(null);
    try {
      const res = await apiClient.runPreflight({ spec, text });
      setResult(res);
    } catch (err: any) {
      setError(err.message || 'Failed to run preflight check');
    } finally {
      setLoading(false);
    }
  }, [isOpen, spec, text]);

  useEffect(() => {
    if (isOpen) {
      runCheck();
    } else {
      setResult(null);
      setError(null);
      setCopied(false);
      setDeslopping(false);
      setFixesApplied([]);
      setCleanedPreviewText(null);
    }
  }, [isOpen, runCheck]);

  const handleCleanSlop = async () => {
    const rawToClean = cleanedPreviewText || text || result?.redactedText || '';
    if (!rawToClean) return;

    setDeslopping(true);
    setError(null);
    try {
      const deslopRes = await apiClient.deslopText(rawToClean);
      setCleanedPreviewText(deslopRes.cleanedText);
      setFixesApplied(deslopRes.fixesApplied);

      if (onTextCleaned) {
        onTextCleaned(deslopRes.cleanedText);
      }

      // Re-trigger preflight with cleaned text
      const newResult = await apiClient.runPreflight({ text: deslopRes.cleanedText });
      setResult(newResult);
    } catch (err: any) {
      setError(err.message || 'Failed to clean AI slop');
    } finally {
      setDeslopping(false);
    }
  };

  if (!isOpen) return null;

  const isSlopClean =
    result?.slop !== undefined
      ? result.slop.isClean
      : (result?.slopIssues?.length ?? 0) === 0;

  const slopMatches = result?.slop?.matches ?? result?.slopIssues ?? [];

  const slopIssuesCount = isSlopClean ? 0 : slopMatches.length;

  const totalIssues =
    (result?.danglingCitations.length ?? 0) +
    (result?.metricIssues.length ?? 0) +
    (result?.violations.length ?? 0) +
    slopIssuesCount;

  const previewText = result?.redactedText || cleanedPreviewText || '';

  const handleCopy = async () => {
    if (!previewText) return;
    try {
      await navigator.clipboard.writeText(previewText);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Fallback
    }
  };

  const handleDownload = () => {
    if (!previewText) return;
    const blob = new Blob([previewText], { type: 'text/markdown;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'resume-redacted-clean.md';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    if (onRedactAndDownload) {
      onRedactAndDownload(previewText);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-sm animate-fadeIn"
      role="dialog"
      aria-modal="true"
      onClick={onClose}
    >
      <div
        className="relative w-full max-w-2xl bg-slate-900 border border-slate-800 rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Modal Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-800 bg-slate-950/70">
          <div className="flex items-center space-x-3">
            <div
              className={`p-2 rounded-xl border ${
                result?.isClean
                  ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20'
                  : 'bg-amber-500/10 text-amber-400 border-amber-500/20'
              }`}
            >
              {result?.isClean ? (
                <ShieldCheck className="w-5 h-5" />
              ) : (
                <AlertTriangle className="w-5 h-5" />
              )}
            </div>
            <div>
              <h2 className="text-lg font-bold text-white flex items-center gap-2">
                Pre-Flight Export Gate
                {result && (
                  <span
                    className={`text-xs px-2.5 py-0.5 rounded-full font-semibold border ${
                      result.isClean
                        ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30'
                        : 'bg-amber-500/10 text-amber-400 border-amber-500/30'
                    }`}
                  >
                    {result.isClean
                      ? 'GATE: PASSED'
                      : `${totalIssues} ISSUE${totalIssues === 1 ? '' : 'S'} TO RESOLVE`}
                  </span>
                )}
              </h2>
              <p className="text-xs text-slate-400">
                Verifies citations, metric completeness, and privacy redaction before external export.
              </p>
            </div>
          </div>
          <div className="flex items-center space-x-2">
            <button
              onClick={runCheck}
              disabled={loading}
              title="Re-run preflight check"
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
        <div className="p-6 overflow-y-auto flex-1 space-y-5">
          {loading ? (
            <div className="flex flex-col items-center justify-center py-16 text-slate-400 space-y-3">
              <RefreshCw className="w-8 h-8 animate-spin text-purple-400" />
              <p className="text-sm font-medium">Running pre-flight integrity audit...</p>
              <p className="text-xs text-slate-500">Cross-referencing evidence store and privacy rules.</p>
            </div>
          ) : error ? (
            <div className="p-4 rounded-xl bg-rose-950/30 border border-rose-500/30 text-rose-300 text-sm flex items-center gap-3">
              <AlertCircle className="w-5 h-5 text-rose-400 shrink-0" />
              <div>
                <p className="font-semibold">Audit Error</p>
                <p className="text-xs text-rose-300/80">{error}</p>
              </div>
            </div>
          ) : result ? (
            <>
              {/* Verdict Banner */}
              {result.isClean ? (
                <div className="p-5 rounded-2xl bg-emerald-950/25 border border-emerald-500/30 flex items-center space-x-4">
                  <div className="p-3 rounded-full bg-emerald-500/20 text-emerald-400 shrink-0">
                    <CheckCircle2 className="w-7 h-7" />
                  </div>
                  <div>
                    <h3 className="text-base font-bold text-emerald-300 tracking-tight">
                      READY FOR EXPORT
                    </h3>
                    <p className="text-xs text-slate-300 leading-relaxed mt-0.5">
                      All citations map to verified evidence cards, metrics are complete, and no proprietary tokens or banned keywords were detected.
                    </p>
                  </div>
                </div>
              ) : (
                <div className="p-5 rounded-2xl bg-amber-950/25 border border-amber-500/30 flex items-center space-x-4">
                  <div className="p-3 rounded-full bg-amber-500/20 text-amber-400 shrink-0">
                    <AlertTriangle className="w-7 h-7" />
                  </div>
                  <div>
                    <h3 className="text-base font-bold text-amber-300 tracking-tight">
                      ISSUES DETECTED
                    </h3>
                    <p className="text-xs text-slate-300 leading-relaxed mt-0.5">
                      {totalIssues} potential integrity or privacy concern{totalIssues === 1 ? '' : 's'} identified. Review items below before external sharing.
                    </p>
                  </div>
                </div>
              )}

              {/* Audit Checklist Sections */}
              <div className="space-y-3">
                {/* 1. Citations */}
                <div className="p-4 rounded-xl bg-slate-950/40 border border-slate-800 space-y-2.5">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center space-x-2 text-sm font-semibold text-white">
                      <Tag className="w-4 h-4 text-purple-400" />
                      <span>Evidence Citations</span>
                    </div>
                    {result.danglingCitations.length === 0 ? (
                      <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 flex items-center gap-1">
                        <CheckCircle2 className="w-3 h-3" />
                        {result.validCitations.length} Verified
                      </span>
                    ) : (
                      <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-rose-500/10 text-rose-400 border border-rose-500/20 flex items-center gap-1">
                        <AlertCircle className="w-3 h-3" />
                        {result.danglingCitations.length} Dangling
                      </span>
                    )}
                  </div>

                  {result.validCitations.length > 0 && (
                    <div className="flex flex-wrap gap-1.5 pt-1">
                      {result.validCitations.map((cit) => (
                        <span
                          key={cit}
                          className="font-mono text-xs px-2 py-0.5 rounded bg-slate-800 text-emerald-300 border border-emerald-500/20"
                        >
                          {cit}
                        </span>
                      ))}
                    </div>
                  )}

                  {result.danglingCitations.length > 0 && (
                    <div className="space-y-1.5 pt-1 border-t border-slate-800/80">
                      <p className="text-xs text-rose-400 font-medium">
                        Unresolved citations (not found in evidence store):
                      </p>
                      <div className="flex flex-wrap gap-1.5">
                        {result.danglingCitations.map((cit) => (
                          <span
                            key={cit}
                            className="font-mono text-xs px-2 py-0.5 rounded bg-rose-950/40 text-rose-300 border border-rose-500/30"
                          >
                            {cit}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}
                </div>

                {/* 2. Metrics */}
                <div className="p-4 rounded-xl bg-slate-950/40 border border-slate-800 space-y-2.5">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center space-x-2 text-sm font-semibold text-white">
                      <Hash className="w-4 h-4 text-cyan-400" />
                      <span>Metric Validation</span>
                    </div>
                    {result.metricIssues.length === 0 ? (
                      <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 flex items-center gap-1">
                        <CheckCircle2 className="w-3 h-3" />
                        Verified
                      </span>
                    ) : (
                      <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-amber-500/10 text-amber-400 border border-amber-500/20 flex items-center gap-1">
                        <AlertTriangle className="w-3 h-3" />
                        {result.metricIssues.length} Incomplete
                      </span>
                    )}
                  </div>

                  {result.metricIssues.length === 0 ? (
                    <p className="text-xs text-slate-400">
                      No explicit [METRIC NEEDED] placeholders or unverified metric claims detected.
                    </p>
                  ) : (
                    <div className="space-y-1.5 pt-1">
                      {result.metricIssues.map((issue, idx) => (
                        <div
                          key={idx}
                          className="text-xs p-2 rounded-lg bg-amber-950/20 border border-amber-500/20 text-amber-300 flex items-start gap-2"
                        >
                          <AlertCircle className="w-3.5 h-3.5 text-amber-400 shrink-0 mt-0.5" />
                          <div>
                            <span className="font-semibold uppercase text-[10px] tracking-wider px-1 py-0.5 rounded bg-amber-900/40 mr-1.5">
                              {issue.type.replace(/_/g, ' ')}
                            </span>
                            <span>{issue.message}</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {/* 3. Privacy & Redaction */}
                <div className="p-4 rounded-xl bg-slate-950/40 border border-slate-800 space-y-2.5">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center space-x-2 text-sm font-semibold text-white">
                      <EyeOff className="w-4 h-4 text-rose-400" />
                      <span>Confidentiality & Privacy Rules</span>
                    </div>
                    {result.violations.length === 0 ? (
                      <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 flex items-center gap-1">
                        <CheckCircle2 className="w-3 h-3" />
                        Clean
                      </span>
                    ) : (
                      <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-rose-500/10 text-rose-400 border border-rose-500/20 flex items-center gap-1">
                        <AlertCircle className="w-3 h-3" />
                        {result.violations.length} Leak{result.violations.length === 1 ? '' : 's'}
                      </span>
                    )}
                  </div>

                  {result.violations.length === 0 ? (
                    <p className="text-xs text-slate-400">
                      Citations tags like <code className="text-slate-300 font-mono">(ev-###)</code> and internal ticket numbers will be cleanly stripped during export.
                    </p>
                  ) : (
                    <div className="space-y-1.5 pt-1">
                      <p className="text-xs text-rose-400 font-medium">
                        Banned keywords detected in text:
                      </p>
                      <div className="flex flex-wrap gap-1.5">
                        {result.violations.map((keyword, idx) => (
                          <span
                            key={idx}
                            className="font-mono text-xs px-2 py-0.5 rounded bg-rose-950/40 text-rose-300 border border-rose-500/30"
                          >
                            {keyword}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}
                </div>

                {/* 4. Anti-Slop Audit */}
                <div className="p-4 rounded-xl bg-slate-950/40 border border-slate-800 space-y-2.5">
                  <div className="flex items-center justify-between flex-wrap gap-2">
                    <div className="flex items-center space-x-2 text-sm font-semibold text-white">
                      <Sparkles className="w-4 h-4 text-purple-400" />
                      <span>Anti-Slop Audit</span>
                    </div>
                    <div className="flex items-center gap-2 flex-wrap">
                      {isSlopClean ? (
                        <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 flex items-center gap-1">
                          <CheckCircle2 className="w-3 h-3" />
                          Anti-Slop: Clean (0 buzzwords or empty hedging detected)
                        </span>
                      ) : (
                        <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-amber-500/10 text-amber-400 border border-amber-500/20 flex items-center gap-1">
                          <AlertTriangle className="w-3 h-3" />
                          Anti-Slop: Issues Detected (score: {result.slop?.score ?? slopMatches.length * 2}, band: {result.slop?.slopBand ?? 'moderate'})
                        </span>
                      )}

                      <button
                        onClick={handleCleanSlop}
                        disabled={deslopping}
                        className={`px-3 py-1 text-xs font-semibold rounded-lg transition-all inline-flex items-center gap-1.5 shadow-md ${
                          !isSlopClean
                            ? 'text-white bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-500 hover:to-indigo-500 shadow-purple-900/30'
                            : 'text-purple-200 bg-purple-950/60 hover:bg-purple-900/60 border border-purple-500/30'
                        } disabled:opacity-50`}
                        title="Automatically clean buzzwords, empty hedging stems, and passive throat-clearing"
                      >
                        <Sparkles className={`w-3.5 h-3.5 ${deslopping ? 'animate-spin' : ''}`} />
                        <span>{deslopping ? 'Cleaning Slop...' : 'Clean AI Slop'}</span>
                      </button>
                    </div>
                  </div>

                  {/* Fixes applied notification */}
                  {fixesApplied.length > 0 && (
                    <div className="p-2.5 rounded-lg bg-purple-950/30 border border-purple-500/30 text-xs text-purple-200 space-y-1 animate-fadeIn">
                      <div className="flex items-center gap-1.5 font-semibold text-purple-300 text-[11px]">
                        <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
                        <span>De-Slop Applied ({fixesApplied.length} fix{fixesApplied.length === 1 ? '' : 'es'}):</span>
                      </div>
                      <div className="flex flex-wrap gap-1">
                        {fixesApplied.map((fix, idx) => (
                          <span
                            key={idx}
                            className="text-[10px] px-2 py-0.5 rounded bg-purple-900/40 text-purple-200 font-mono"
                          >
                            {fix}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}

                  {isSlopClean ? (
                    <p className="text-xs text-slate-400">
                      0 buzzwords or empty hedging detected. Writing is concise, active, and metric-grounded.
                    </p>
                  ) : (
                    <div className="space-y-1.5 pt-1">
                      <p className="text-xs text-amber-400 font-medium">
                        Flagged buzzword patterns &amp; empty hedging stems:
                      </p>
                      <div className="space-y-1.5">
                        {slopMatches.map((match, idx) => (
                          <div
                            key={idx}
                            className="text-xs p-2 rounded-lg bg-amber-950/20 border border-amber-500/20 text-amber-300 flex items-start justify-between gap-2"
                          >
                            <div className="flex items-start gap-2">
                              <AlertCircle className="w-3.5 h-3.5 text-amber-400 shrink-0 mt-0.5" />
                              <div>
                                <span className="font-semibold uppercase text-[10px] tracking-wider px-1 py-0.5 rounded bg-amber-900/40 mr-1.5">
                                  [{match.type}]
                                </span>
                                <span className="font-mono text-slate-200">
                                  &ldquo;{match.matchedText}&rdquo;
                                </span>
                                <span className="text-slate-400 ml-1.5 text-[11px]">
                                  ({match.patternName})
                                </span>
                              </div>
                            </div>
                            {match.line !== undefined && (
                              <span className="text-[10px] font-mono text-slate-400 shrink-0">
                                Line {match.line}
                              </span>
                            )}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              </div>

              {/* Redacted Preview Snippet */}
              {previewText && (
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between text-xs text-slate-400">
                    <span className="font-semibold uppercase tracking-wider text-slate-300">
                      Redacted Clean Document Preview
                    </span>
                    <button
                      onClick={handleCopy}
                      className="inline-flex items-center gap-1 text-slate-300 hover:text-white transition-colors"
                    >
                      {copied ? (
                        <>
                          <Check className="w-3 h-3 text-emerald-400" />
                          <span className="text-emerald-400">Copied</span>
                        </>
                      ) : (
                        <>
                          <Copy className="w-3 h-3" />
                          <span>Copy Clean Text</span>
                        </>
                      )}
                    </button>
                  </div>
                  <pre className="p-3 bg-slate-950 rounded-xl border border-slate-800 text-[11px] font-mono text-slate-300 max-h-36 overflow-y-auto whitespace-pre-wrap">
                    {previewText}
                  </pre>
                </div>
              )}
            </>
          ) : null}
        </div>

        {/* Modal Footer */}
        <div className="flex items-center justify-between px-6 py-4 border-t border-slate-800 bg-slate-950/60">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm font-medium text-slate-300 hover:text-white hover:bg-slate-800 rounded-xl transition-colors"
          >
            Close
          </button>

          <div className="flex items-center space-x-3">
            <button
              onClick={handleCopy}
              disabled={!previewText}
              className="px-4 py-2 text-sm font-medium text-slate-200 bg-slate-800 hover:bg-slate-700 disabled:opacity-40 rounded-xl transition-colors inline-flex items-center gap-2"
            >
              {copied ? (
                <>
                  <Check className="w-4 h-4 text-emerald-400" />
                  <span>Copied</span>
                </>
              ) : (
                <>
                  <Copy className="w-4 h-4" />
                  <span>Copy Clean</span>
                </>
              )}
            </button>

            <button
              onClick={handleDownload}
              disabled={!previewText}
              className="px-5 py-2 text-sm font-semibold text-white bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 disabled:opacity-40 rounded-xl shadow-lg shadow-emerald-900/30 transition-all inline-flex items-center gap-2"
            >
              <Download className="w-4 h-4" />
              <span>Redact & Download</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
