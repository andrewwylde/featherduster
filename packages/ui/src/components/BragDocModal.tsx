import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  X,
  FileText,
  Copy,
  Check,
  Download,
  ShieldCheck,
  ShieldAlert,
  AlertTriangle,
  RefreshCw,
  Sparkles,
} from 'lucide-react';
import { cleanSlop, type LevelingRubric } from '@featherduster/core';
import { apiClient } from '../api/client';
import { useModalA11y } from '../hooks/useModalA11y';

export interface BragDocModalProps {
  isOpen: boolean;
  onClose: () => void;
  rubrics: LevelingRubric[];
  initialRubricId?: string;
  initialTargetLevel?: string;
}

export const BragDocModal: React.FC<BragDocModalProps> = ({
  isOpen,
  onClose,
  rubrics,
  initialRubricId,
  initialTargetLevel,
}) => {
  const modalRef = useRef<HTMLDivElement>(null);
  useModalA11y({ isOpen, onClose, containerRef: modalRef });
  const [selectedRubricId, setSelectedRubricId] = useState<string>(
    initialRubricId || rubrics[0]?.id || ''
  );
  const [selectedTargetLevel, setSelectedTargetLevel] = useState<string>(
    initialTargetLevel || ''
  );
  const [candidateName, setCandidateName] = useState('');
  const [period, setPeriod] = useState('H2 2026');
  const [redactConfidential, setRedactConfidential] = useState(true);

  const [markdownOutput, setMarkdownOutput] = useState('');
  const [isCompiling, setIsCompiling] = useState(false);
  const [compileError, setCompileError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [isDeslopping, setIsDeslopping] = useState(false);
  const [deslopMessage, setDeslopMessage] = useState<string | null>(null);

  const handleDeSlop = async () => {
    if (!markdownOutput) return;
    try {
      setIsDeslopping(true);
      const res = await apiClient.deslopText(markdownOutput);
      if (res.cleanedText) {
        setMarkdownOutput(res.cleanedText);
        const count = res.fixesApplied?.length ?? 0;
        setDeslopMessage(
          count > 0
            ? `De-slopped: Removed ${count} buzzword/hedging pattern${count === 1 ? '' : 's'}`
            : 'De-slop: 0 buzzwords or empty hedging detected'
        );
        setTimeout(() => setDeslopMessage(null), 4000);
      }
    } catch {
      // Fallback
      const fallback = cleanSlop(markdownOutput);
      setMarkdownOutput(fallback.cleanedText);
      const count = fallback.fixesApplied?.length ?? 0;
      setDeslopMessage(
        count > 0
          ? `De-slopped: Removed ${count} buzzword/hedging pattern${count === 1 ? '' : 's'}`
          : 'De-slop: 0 buzzwords or empty hedging detected'
      );
      setTimeout(() => setDeslopMessage(null), 4000);
    } finally {
      setIsDeslopping(false);
    }
  };

  // Synchronize initial selections when modal opens or rubrics change
  useEffect(() => {
    if (isOpen) {
      const activeRubric =
        rubrics.find((r) => r.id === (initialRubricId || selectedRubricId)) || rubrics[0];
      if (activeRubric) {
        setSelectedRubricId(activeRubric.id);
        setSelectedTargetLevel(
          initialTargetLevel || activeRubric.target_level || activeRubric.levels[0]?.id || ''
        );
      }
    }
  }, [isOpen, initialRubricId, initialTargetLevel, rubrics]);

  const currentRubric = rubrics.find((r) => r.id === selectedRubricId) || rubrics[0];

  // Update target level if rubric changes and current level is not in new rubric
  const handleRubricChange = (rubricId: string) => {
    setSelectedRubricId(rubricId);
    const rub = rubrics.find((r) => r.id === rubricId);
    if (rub) {
      const exists = rub.levels.some((l) => l.id === selectedTargetLevel);
      if (!exists) {
        setSelectedTargetLevel(rub.target_level || rub.levels[0]?.id || '');
      }
    }
  };

  // Compile brag doc
  const handleCompile = useCallback(async () => {
    if (!currentRubric) return;

    try {
      setIsCompiling(true);
      setCompileError(null);

      const effectiveRubric: LevelingRubric = {
        ...currentRubric,
        target_level: selectedTargetLevel || currentRubric.target_level,
      };

      const response = await apiClient.compileResume(
        {
          rubric: effectiveRubric,
          candidateName: candidateName.trim() || undefined,
          period: period.trim() || undefined,
          redact: redactConfidential,
        },
        'brag'
      );

      setMarkdownOutput(response.output || '');
    } catch (err: any) {
      setCompileError(err.message || 'Failed to compile brag document');
    } finally {
      setIsCompiling(false);
    }
  }, [currentRubric, selectedTargetLevel, candidateName, period, redactConfidential]);

  useEffect(() => {
    if (isOpen && currentRubric) {
      handleCompile();
    }
  }, [isOpen, handleCompile, currentRubric]);

  if (!isOpen) return null;

  // Detect audit warnings in compiled output
  const hasWarnings =
    markdownOutput.includes('[PROVISIONAL]') ||
    markdownOutput.includes('[MISSING METRICS]') ||
    markdownOutput.includes('[METRIC NEEDED]') ||
    markdownOutput.includes('[RETRACTED]');

  const handleCopy = async () => {
    if (!markdownOutput) return;
    try {
      await navigator.clipboard.writeText(markdownOutput);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Fallback
    }
  };

  const handleDownload = () => {
    if (!markdownOutput) return;
    const blob = new Blob([markdownOutput], { type: 'text/markdown;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    const filename = `brag-doc-${selectedRubricId || 'packet'}-${selectedTargetLevel || 'review'}.md`;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  return (
    <div
      className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        ref={modalRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="brag-doc-title"
        className="bg-slate-900 border border-slate-800 rounded-2xl w-full max-w-5xl max-h-[92vh] flex flex-col shadow-2xl overflow-hidden animate-scaleIn"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-6 py-4 border-b border-slate-800 flex items-center justify-between bg-slate-950/50">
          <div className="flex items-center space-x-3">
            <div className="p-2 rounded-xl bg-teal-500/10 text-teal-400 border border-teal-500/20">
              <FileText className="w-5 h-5" />
            </div>
            <div>
              <h2 id="brag-doc-title" className="text-lg font-bold text-white">Generate Performance Brag Document</h2>
              <p className="text-xs text-slate-400">
                Compile your verified accomplishments and metrics into a promotion-ready packet
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
            aria-label="Close modal"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Configuration Bar */}
        <div className="px-6 py-3.5 bg-slate-950/80 border-b border-slate-800 grid grid-cols-1 md:grid-cols-4 gap-4 items-end">
          {/* Rubric Selector */}
          <div>
            <label className="block text-[11px] font-semibold text-slate-400 uppercase tracking-wider mb-1">
              Rubric
            </label>
            <select
              value={selectedRubricId}
              onChange={(e) => handleRubricChange(e.target.value)}
              className="w-full px-2.5 py-1.5 bg-slate-900 border border-slate-700 rounded-lg text-xs text-white focus:outline-none focus:border-teal-500"
            >
              {rubrics.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.title}
                </option>
              ))}
            </select>
          </div>

          {/* Target Level */}
          <div>
            <label className="block text-[11px] font-semibold text-slate-400 uppercase tracking-wider mb-1">
              Target Level
            </label>
            <select
              value={selectedTargetLevel}
              onChange={(e) => setSelectedTargetLevel(e.target.value)}
              className="w-full px-2.5 py-1.5 bg-slate-900 border border-slate-700 rounded-lg text-xs text-white focus:outline-none focus:border-teal-500 font-mono"
            >
              {currentRubric?.levels.map((lvl) => (
                <option key={lvl.id} value={lvl.id}>
                  {lvl.id} - {lvl.name}
                </option>
              ))}
            </select>
          </div>

          {/* Candidate Name */}
          <div>
            <label className="block text-[11px] font-semibold text-slate-400 uppercase tracking-wider mb-1">
              Candidate Name
            </label>
            <input
              type="text"
              value={candidateName}
              onChange={(e) => setCandidateName(e.target.value)}
              placeholder="e.g. Alex Mercer"
              className="w-full px-2.5 py-1.5 bg-slate-900 border border-slate-700 rounded-lg text-xs text-white placeholder-slate-500 focus:outline-none focus:border-teal-500"
            />
          </div>

          {/* Review Period */}
          <div>
            <label className="block text-[11px] font-semibold text-slate-400 uppercase tracking-wider mb-1">
              Review Period
            </label>
            <input
              type="text"
              value={period}
              onChange={(e) => setPeriod(e.target.value)}
              placeholder="e.g. H2 2026"
              className="w-full px-2.5 py-1.5 bg-slate-900 border border-slate-700 rounded-lg text-xs text-white placeholder-slate-500 focus:outline-none focus:border-teal-500"
            />
          </div>
        </div>

        {/* Options Bar */}
        <div className="px-6 py-2.5 bg-slate-950/40 border-b border-slate-800/80 flex flex-wrap items-center justify-between gap-3 text-xs">
          <label className="flex items-center space-x-2.5 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={redactConfidential}
              onChange={(e) => setRedactConfidential(e.target.checked)}
              className="w-4 h-4 rounded text-teal-500 bg-slate-900 border-slate-700 focus:ring-teal-500 focus:ring-offset-0"
            />
            <span className="flex items-center space-x-1.5 text-slate-300 font-medium">
              {redactConfidential ? (
                <ShieldCheck className="w-3.5 h-3.5 text-emerald-400" />
              ) : (
                <ShieldAlert className="w-3.5 h-3.5 text-amber-400" />
              )}
              <span>Redact Confidential Details & Privacy Rules</span>
            </span>
          </label>

          <div className="flex items-center space-x-2">
            <button
              type="button"
              onClick={handleDeSlop}
              disabled={isDeslopping || !markdownOutput}
              className="px-3 py-1 bg-purple-600/20 hover:bg-purple-600/30 text-purple-300 border border-purple-500/30 rounded-lg text-xs font-semibold transition-all inline-flex items-center gap-1.5 disabled:opacity-40 shadow-sm"
              title="Clean AI buzzwords and empty hedging from brag document"
            >
              <Sparkles className={`w-3.5 h-3.5 ${isDeslopping ? 'animate-spin text-purple-400' : 'text-purple-400'}`} />
              <span>{isDeslopping ? 'De-Slopping...' : 'De-Slop Brag Doc'}</span>
            </button>

            <button
              type="button"
              onClick={handleCompile}
              disabled={isCompiling}
              className="text-slate-400 hover:text-teal-400 flex items-center space-x-1 transition-colors px-2 py-1"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${isCompiling ? 'animate-spin text-teal-400' : ''}`} />
              <span>Re-compile</span>
            </button>
          </div>
        </div>

        {/* De-Slop Feedback Banner */}
        {deslopMessage && (
          <div className="px-6 py-2 bg-purple-950/40 border-b border-purple-500/30 text-xs text-purple-300 flex items-center space-x-2 animate-fadeIn">
            <Sparkles className="w-3.5 h-3.5 text-purple-400" />
            <span>{deslopMessage}</span>
          </div>
        )}

        {/* Audit Warning Banner if applicable */}
        {hasWarnings && (
          <div className="px-6 py-2.5 bg-amber-500/10 border-b border-amber-500/20 text-xs text-amber-400 flex items-center space-x-2">
            <AlertTriangle className="w-4 h-4 flex-shrink-0" />
            <span>
              <strong>Integrity Notice:</strong> This brag document contains [PROVISIONAL] accomplishments
              or [MISSING METRICS] tags. Review before sharing with promotion committees.
            </span>
          </div>
        )}

        {/* Main Preview Area */}
        <div className="flex-1 overflow-y-auto p-6 bg-slate-950/30">
          {compileError && (
            <div className="p-4 bg-rose-500/10 border border-rose-500/20 rounded-xl text-xs text-rose-400 mb-4">
              {compileError}
            </div>
          )}

          {isCompiling ? (
            <div className="h-72 flex flex-col items-center justify-center space-y-3 text-slate-500">
              <RefreshCw className="w-6 h-6 animate-spin text-teal-400" />
              <span className="text-xs font-medium">Compiling Brag Document from Evidence Store...</span>
            </div>
          ) : (
            <div className="relative">
              <pre className="p-5 bg-slate-950 border border-slate-800 rounded-xl text-xs font-mono text-slate-200 leading-relaxed overflow-x-auto whitespace-pre-wrap selection:bg-teal-500/30">
                {markdownOutput || 'No output generated.'}
              </pre>
            </div>
          )}
        </div>

        {/* Footer Actions */}
        <div className="px-6 py-4 border-t border-slate-800 bg-slate-950/50 flex items-center justify-between">
          <div className="text-xs text-slate-500">
            {markdownOutput ? `${markdownOutput.split('\n').length} lines · Markdown format` : ''}
          </div>
          <div className="flex items-center space-x-3">
            <button
              type="button"
              onClick={handleCopy}
              disabled={!markdownOutput}
              className="px-4 py-2 text-xs font-semibold text-slate-200 bg-slate-800 hover:bg-slate-700 disabled:opacity-50 disabled:cursor-not-allowed rounded-xl transition-colors flex items-center space-x-1.5"
            >
              {copied ? (
                <>
                  <Check className="w-3.5 h-3.5 text-emerald-400" />
                  <span className="text-emerald-400">Copied to Clipboard!</span>
                </>
              ) : (
                <>
                  <Copy className="w-3.5 h-3.5" />
                  <span>Copy Markdown</span>
                </>
              )}
            </button>
            <button
              type="button"
              onClick={handleDownload}
              disabled={!markdownOutput}
              className="px-5 py-2 text-xs font-semibold text-slate-950 bg-teal-400 hover:bg-teal-300 disabled:opacity-50 disabled:cursor-not-allowed rounded-xl transition-colors flex items-center space-x-1.5 shadow-lg shadow-teal-500/10"
            >
              <Download className="w-3.5 h-3.5" />
              <span>Download .md</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
