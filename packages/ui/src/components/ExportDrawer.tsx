import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import {
  X,
  Copy,
  Check,
  Printer,
  Download,
  ShieldCheck,
  AlertTriangle,
  RefreshCw,
  Sparkles,
  Package,
  FileText,
  Clock,
  HardDrive,
  Eye,
  Code2,
  FileDown,
} from 'lucide-react';
import {
  calculatePageBudget,
  type ResumeSpec,
} from '@featherduster/core';
import {
  apiClient,
  type PreflightResult,
  type ExportArtifact,
  type TypstRenderResponse,
} from '../api/client';
import { useModalA11y } from '../hooks/useModalA11y';

export type DrawerFormat = 'markdown' | 'html' | 'typst' | 'latex' | 'brief';

export interface ExportDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  spec: ResumeSpec;
  variantName: string;
  jobDescription?: string;
  matchedKeywords?: string[];
  missingKeywords?: string[];
  targetCompany?: string;
  targetRole?: string;
  preflightStatus: PreflightResult | null;
  preflightLoading: boolean;
  onOpenPreflightModal: () => void;
  onDeSlop: () => void;
  deslopping: boolean;
  squeezeMode: boolean;
  onToggleSqueeze: () => void;
}

function svgToDataUri(svg: string): string {
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

export const ExportDrawer: React.FC<ExportDrawerProps> = ({
  isOpen,
  onClose,
  spec,
  variantName,
  jobDescription = '',
  matchedKeywords = [],
  missingKeywords = [],
  targetCompany = '',
  targetRole = '',
  preflightStatus,
  preflightLoading,
  onOpenPreflightModal,
  onDeSlop,
  deslopping,
  squeezeMode,
  onToggleSqueeze,
}) => {
  const drawerRef = useRef<HTMLDivElement | null>(null);
  const printIframeRef = useRef<HTMLIFrameElement | null>(null);

  useModalA11y({
    isOpen,
    onClose,
    containerRef: drawerRef,
  });

  // Active view tab inside drawer
  const [drawerTab, setDrawerTab] = useState<'preview' | 'shelf'>('preview');

  // Format and compiler state
  const [activeFormat, setActiveFormat] = useState<DrawerFormat>('markdown');
  const [compiledOutput, setCompiledOutput] = useState('');
  const [compiling, setCompiling] = useState(false);
  const [copied, setCopied] = useState(false);
  const [atsCopied, setAtsCopied] = useState(false);

  // Bundle compilation state
  const [bundleLoading, setBundleLoading] = useState(false);
  const [bundleMessage, setBundleMessage] = useState<string | null>(null);

  // Typst live rendering state
  const [typstView, setTypstView] = useState<'preview' | 'source'>('preview');
  const [typstRender, setTypstRender] = useState<TypstRenderResponse | null>(null);
  const [typstRendering, setTypstRendering] = useState(false);
  const [pdfExporting, setPdfExporting] = useState(false);
  const [pdfError, setPdfError] = useState<string | null>(null);

  // Artifacts shelf state
  const [artifacts, setArtifacts] = useState<ExportArtifact[]>([]);
  const [artifactsLoading, setArtifactsLoading] = useState(false);

  // Page budget calculation
  const pageBudget = useMemo(() => {
    return calculatePageBudget(spec, { squeeze: squeezeMode });
  }, [spec, squeezeMode]);

  // Load compiled format preview
  const compileFormat = useCallback(async (format: DrawerFormat) => {
    if (!spec.profile?.name && (spec.experiences || []).length === 0) return;
    try {
      setCompiling(true);
      const res = await apiClient.compileResume(
        {
          ...spec,
          targetCompany,
          targetRole,
          jobDescription,
          matchedKeywords,
          missingKeywords,
        },
        format
      );
      setCompiledOutput(res.output || '');
    } catch (err: any) {
      setCompiledOutput(`// Compilation Error:\n${err.message || err}`);
    } finally {
      setCompiling(false);
    }
  }, [spec, targetCompany, targetRole, jobDescription, matchedKeywords, missingKeywords]);

  // Typst rendering effect
  const shouldRenderTypst = isOpen && activeFormat === 'typst' && typstView === 'preview';

  useEffect(() => {
    if (!shouldRenderTypst) {
      setTypstRendering(false);
      return;
    }
    if (!spec.profile?.name && (spec.experiences || []).length === 0) return;

    let cancelled = false;
    setTypstRendering(true);
    const timer = setTimeout(() => {
      apiClient
        .renderTypst(spec)
        .then((res) => {
          if (!cancelled) setTypstRender(res);
        })
        .catch((err: any) => {
          if (!cancelled) {
            setTypstRender({
              available: true,
              detail: '',
              pages: [],
              error: err?.message || String(err),
              source: '',
            });
          }
        })
        .finally(() => {
          if (!cancelled) setTypstRendering(false);
        });
    }, 400);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [shouldRenderTypst, spec]);

  // Export Typst PDF directly via local typst binary
  const handleExportTypstPdf = async () => {
    setPdfExporting(true);
    setPdfError(null);
    try {
      const blob = await apiClient.exportTypstPdf(spec);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `resume_${(variantName || 'master').replace(/[^a-zA-Z0-9_-]/g, '_')}.pdf`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (err: any) {
      setPdfError(err?.message || 'Failed to export PDF');
    } finally {
      setPdfExporting(false);
    }
  };

  // Fetch exports shelf files
  const loadArtifacts = useCallback(async () => {
    try {
      setArtifactsLoading(true);
      const items = await apiClient.getExports();
      setArtifacts(items);
    } catch {
      // Ignore load error
    } finally {
      setArtifactsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (isOpen) {
      compileFormat(activeFormat);
      loadArtifacts();
    }
  }, [isOpen, activeFormat, compileFormat, loadArtifacts]);

  if (!isOpen) return null;

  // 1-Click Copy ATS Markdown
  const handleCopyAts = async () => {
    try {
      let textToCopy = compiledOutput;
      if (activeFormat !== 'markdown') {
        const res = await apiClient.compileResume(spec, 'markdown');
        textToCopy = res.output;
      }
      await navigator.clipboard.writeText(textToCopy);
      setAtsCopied(true);
      setTimeout(() => setAtsCopied(false), 2500);
    } catch {
      // Fallback
    }
  };

  // Copy current active format
  const handleCopyActive = async () => {
    if (!compiledOutput) return;
    try {
      await navigator.clipboard.writeText(compiledOutput);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Fallback
    }
  };

  // Download active compiled file
  const handleDownloadActive = () => {
    if (!compiledOutput) return;
    const extMap: Record<DrawerFormat, string> = {
      markdown: 'md',
      html: 'html',
      typst: 'typ',
      latex: 'tex',
      brief: 'md',
    };
    const ext = extMap[activeFormat] || 'txt';
    const mimeMap: Record<DrawerFormat, string> = {
      markdown: 'text/markdown;charset=utf-8',
      html: 'text/html;charset=utf-8',
      typst: 'text/plain;charset=utf-8',
      latex: 'application/x-latex;charset=utf-8',
      brief: 'text/markdown;charset=utf-8',
    };
    const mime = mimeMap[activeFormat] || 'text/plain';

    const blob = new Blob([compiledOutput], { type: mime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    const safeSlug = (variantName || 'resume').replace(/[^a-zA-Z0-9_-]/g, '_');
    a.download =
      activeFormat === 'brief'
        ? `${safeSlug}-defense-brief.md`
        : `resume_${safeSlug}.${ext}`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  // Browser Print for HTML preview
  const handlePrintHtml = () => {
    if (activeFormat !== 'html') {
      setActiveFormat('html');
    }
    setTimeout(() => {
      if (printIframeRef.current?.contentWindow) {
        try {
          printIframeRef.current.contentWindow.focus();
          printIframeRef.current.contentWindow.print();
          return;
        } catch {
          // Fallback
        }
      }
      const printWindow = window.open('', '_blank');
      if (printWindow) {
        printWindow.document.write(compiledOutput);
        printWindow.document.close();
        printWindow.focus();
        printWindow.print();
      }
    }, 150);
  };

  // One-Click Application Release Bundle
  const handleCreateBundle = async () => {
    try {
      setBundleLoading(true);
      setBundleMessage(null);
      const res = await apiClient.createBundle({
        name: variantName || 'resume-application',
        spec,
        formats: ['markdown', 'html'],
        includeBrief: true,
        targetCompany,
        targetRole,
        jobDescription,
        matchedKeywords,
        missingKeywords,
        squeeze: squeezeMode,
      });

      if (res.success) {
        setBundleMessage(`Release bundle generated (${res.files.length} artifacts saved to disk)`);
        await loadArtifacts();
        setTimeout(() => setBundleMessage(null), 5000);
      }
    } catch (err: any) {
      alert(`Failed to compile bundle: ${err.message}`);
    } finally {
      setBundleLoading(false);
    }
  };

  const getFormatBadge = (fmt: string) => {
    switch (fmt) {
      case 'markdown':
        return 'bg-blue-500/10 text-blue-400 border-blue-500/20';
      case 'html':
        return 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20';
      case 'typst':
        return 'bg-orange-500/10 text-orange-400 border-orange-500/20';
      case 'latex':
        return 'bg-purple-500/10 text-purple-400 border-purple-500/20';
      case 'pdf':
        return 'bg-rose-500/10 text-rose-400 border-rose-500/20';
      default:
        return 'bg-slate-800 text-slate-400 border-slate-700';
    }
  };

  return (
    <div className="fixed inset-0 z-50 overflow-hidden">
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black/70 backdrop-blur-sm transition-opacity animate-fadeIn"
        onClick={onClose}
        aria-hidden="true"
      />

      {/* Flyout Panel */}
      <div className="fixed inset-y-0 right-0 max-w-2xl w-full flex pl-0 sm:pl-10">
        <div
          ref={drawerRef}
          role="dialog"
          aria-modal="true"
          aria-labelledby="drawer-title"
          className="w-full bg-slate-900 border-l border-slate-800 shadow-2xl flex flex-col h-full animate-slideInRight"
          onClick={(e) => e.stopPropagation()}
        >
          {/* Top Header */}
          <div className="px-5 sm:px-6 py-4 border-b border-slate-800 bg-slate-950/80 flex items-center justify-between">
            <div className="flex items-center space-x-3">
              <div className="p-2 rounded-xl bg-purple-500/10 text-purple-400 border border-purple-500/20">
                <Package className="w-5 h-5" />
              </div>
              <div>
                <h2 id="drawer-title" className="text-base font-bold text-white flex items-center gap-2">
                  Deliverables & Exports
                  <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-purple-950 text-purple-300 border border-purple-500/30">
                    {variantName || 'master'}
                  </span>
                </h2>
                <p className="text-xs text-slate-400">
                  Generate ATS copy, 1-page PDF, and interview defense briefing
                </p>
              </div>
            </div>

            <button
              onClick={onClose}
              className="p-2 min-h-[44px] min-w-[44px] flex items-center justify-center rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
              aria-label="Close export drawer"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          {/* Quick Application Pack Actions */}
          <div className="px-5 sm:px-6 py-3.5 bg-slate-950/40 border-b border-slate-800 space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">
                Application Release Actions
              </span>
              {bundleMessage && (
                <span className="text-xs font-medium text-emerald-400 flex items-center gap-1 animate-fadeIn">
                  <Check className="w-3.5 h-3.5" />
                  {bundleMessage}
                </span>
              )}
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 sm:gap-2.5">
              {/* 1-Click Copy ATS Markdown */}
              <button
                onClick={handleCopyAts}
                className="px-3 py-2 bg-slate-800 hover:bg-slate-700 border border-slate-700 rounded-xl text-xs font-semibold text-slate-200 transition-all flex items-center justify-center gap-1.5 shadow-sm min-h-[44px]"
                title="Copy clean, citation-stripped ATS Markdown for Greenhouse / Lever pasteboards"
              >
                {atsCopied ? (
                  <>
                    <Check className="w-3.5 h-3.5 text-emerald-400" />
                    <span className="text-emerald-400">Copied ATS!</span>
                  </>
                ) : (
                  <>
                    <Copy className="w-3.5 h-3.5 text-blue-400" />
                    <span>Copy ATS Text</span>
                  </>
                )}
              </button>

              {/* Print / Save 1-Page PDF */}
              <button
                onClick={handlePrintHtml}
                className="px-3 py-2 bg-purple-600 hover:bg-purple-500 text-white rounded-xl text-xs font-semibold transition-all flex items-center justify-center gap-1.5 shadow-sm shadow-purple-900/30 min-h-[44px]"
                title="Print or Save 1-Page PDF using native zero-dependency web print layout"
              >
                <Printer className="w-3.5 h-3.5" />
                <span>Print to PDF</span>
              </button>

              {/* Compile Complete Release Bundle */}
              <button
                onClick={handleCreateBundle}
                disabled={bundleLoading}
                className="px-3 py-2 bg-slate-800 hover:bg-slate-700 border border-purple-500/40 text-purple-300 rounded-xl text-xs font-semibold transition-all flex items-center justify-center gap-1.5 shadow-sm disabled:opacity-50 min-h-[44px]"
                title="Compile clean ATS Markdown, HTML, and Defense Brief directly to disk in resumes/compiled/"
              >
                <FileDown className={`w-3.5 h-3.5 ${bundleLoading ? 'animate-bounce' : ''}`} />
                <span>{bundleLoading ? 'Building...' : 'Save Bundle'}</span>
              </button>
            </div>
          </div>

          {/* Telemetry Bar: 1-Page Budget & Pre-Flight Status */}
          <div className="px-6 py-2.5 bg-slate-950/60 border-b border-slate-800 flex flex-wrap items-center justify-between gap-3 text-xs">
            {/* Page Budget Meter */}
            <div className="flex items-center gap-2">
              <span className="text-slate-400 text-[11px] font-mono">1-Page Budget:</span>
              <div className="w-24 h-2 bg-slate-800 rounded-full overflow-hidden">
                <div
                  className={`h-full transition-all duration-300 ${
                    pageBudget.status === 'optimal'
                      ? 'bg-emerald-500'
                      : pageBudget.status === 'warning'
                      ? 'bg-amber-400'
                      : 'bg-rose-500'
                  }`}
                  style={{ width: `${Math.min(100, pageBudget.percentage)}%` }}
                />
              </div>
              <span
                className={`font-mono text-[11px] font-semibold ${
                  pageBudget.status === 'optimal'
                    ? 'text-emerald-400'
                    : pageBudget.status === 'warning'
                    ? 'text-amber-400'
                    : 'text-rose-400'
                }`}
              >
                {pageBudget.totalLines}/{pageBudget.maxBudget} lines ({pageBudget.percentage}%)
              </span>

              {/* Squeeze Toggle */}
              <button
                onClick={onToggleSqueeze}
                className={`px-2 py-0.5 rounded text-[10px] font-mono border transition-all ${
                  squeezeMode
                    ? 'bg-purple-950 text-purple-300 border-purple-500/50'
                    : 'bg-slate-800/80 text-slate-400 border-slate-700 hover:text-slate-200'
                }`}
                title="Compact vertical padding and margins to force 1-page fit"
              >
                {squeezeMode ? 'Squeeze: ON' : 'Squeeze: OFF'}
              </button>
            </div>

            {/* Pre-Flight Status Pill */}
            <div className="flex items-center gap-2">
              <button
                onClick={onDeSlop}
                disabled={deslopping}
                className="px-2 py-1 rounded text-[11px] font-semibold bg-purple-600/20 hover:bg-purple-600/30 text-purple-300 border border-purple-500/30 transition-all flex items-center gap-1"
                title="De-slop active resume bullets"
              >
                <Sparkles className={`w-3 h-3 ${deslopping ? 'animate-spin' : ''}`} />
                <span>De-Slop</span>
              </button>

              <button
                onClick={onOpenPreflightModal}
                className={`px-2.5 py-1 rounded-lg text-[11px] font-semibold border transition-all flex items-center gap-1.5 ${
                  preflightStatus?.isClean
                    ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30'
                    : 'bg-amber-500/10 text-amber-400 border-amber-500/30'
                }`}
                title="View full pre-flight audit report"
              >
                {preflightLoading ? (
                  <RefreshCw className="w-3 h-3 animate-spin text-purple-400" />
                ) : preflightStatus?.isClean ? (
                  <ShieldCheck className="w-3 h-3 text-emerald-400" />
                ) : (
                  <AlertTriangle className="w-3 h-3 text-amber-400" />
                )}
                <span>
                  {preflightStatus?.isClean ? 'Pre-Flight: Pass' : 'Pre-Flight: Review'}
                </span>
              </button>
            </div>
          </div>

          {/* Drawer Tabs: Compiler Preview vs Artifacts Shelf */}
          <div className="px-6 pt-3 bg-slate-900 border-b border-slate-800 flex items-center justify-between">
            <div className="flex space-x-1">
              <button
                onClick={() => setDrawerTab('preview')}
                className={`px-3 py-1.5 text-xs font-semibold rounded-t-lg border-b-2 transition-all ${
                  drawerTab === 'preview'
                    ? 'border-purple-500 text-purple-300 bg-slate-800/60'
                    : 'border-transparent text-slate-400 hover:text-white'
                }`}
              >
                Live Compiler Preview
              </button>
              <button
                onClick={() => {
                  setDrawerTab('shelf');
                  loadArtifacts();
                }}
                className={`px-3 py-1.5 text-xs font-semibold rounded-t-lg border-b-2 transition-all flex items-center gap-1.5 ${
                  drawerTab === 'shelf'
                    ? 'border-purple-500 text-purple-300 bg-slate-800/60'
                    : 'border-transparent text-slate-400 hover:text-white'
                }`}
              >
                <HardDrive className="w-3.5 h-3.5" />
                <span>On-Disk Shelf ({artifacts.length})</span>
              </button>
            </div>

            {drawerTab === 'preview' && (
              <div className="flex items-center gap-1">
                <button
                  onClick={handleCopyActive}
                  className="p-1 rounded text-slate-400 hover:text-white hover:bg-slate-800 text-xs"
                  title="Copy current format output"
                >
                  {copied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                </button>
                <button
                  onClick={handleDownloadActive}
                  className="p-1 rounded text-slate-400 hover:text-white hover:bg-slate-800 text-xs"
                  title="Download current format"
                >
                  <Download className="w-3.5 h-3.5" />
                </button>
              </div>
            )}
          </div>

          {/* Tab Content */}
          <div className="flex-1 overflow-hidden flex flex-col p-4 bg-slate-950/50">
            {drawerTab === 'preview' ? (
              <div className="flex-1 flex flex-col overflow-hidden space-y-3">
                {/* Format Switcher Pills */}
                <div className="flex flex-wrap items-center gap-1.5 bg-slate-950 p-1 rounded-xl border border-slate-800 text-xs">
                  <button
                    onClick={() => setActiveFormat('markdown')}
                    className={`px-2.5 py-1 rounded-lg font-medium transition-all ${
                      activeFormat === 'markdown'
                        ? 'bg-purple-600 text-white shadow-sm'
                        : 'text-slate-400 hover:text-white'
                    }`}
                  >
                    ATS Markdown
                  </button>
                  <button
                    onClick={() => setActiveFormat('html')}
                    className={`px-2.5 py-1 rounded-lg font-medium transition-all ${
                      activeFormat === 'html'
                        ? 'bg-purple-600 text-white shadow-sm'
                        : 'text-slate-400 hover:text-white'
                    }`}
                  >
                    Web Print (HTML)
                  </button>
                  <button
                    onClick={() => setActiveFormat('typst')}
                    className={`px-2.5 py-1 rounded-lg font-medium transition-all ${
                      activeFormat === 'typst'
                        ? 'bg-purple-600 text-white shadow-sm'
                        : 'text-slate-400 hover:text-white'
                    }`}
                  >
                    Typst
                  </button>
                  <button
                    onClick={() => setActiveFormat('latex')}
                    className={`px-2.5 py-1 rounded-lg font-medium transition-all ${
                      activeFormat === 'latex'
                        ? 'bg-purple-600 text-white shadow-sm'
                        : 'text-slate-400 hover:text-white'
                    }`}
                  >
                    LaTeX
                  </button>
                  <button
                    onClick={() => setActiveFormat('brief')}
                    className={`px-2.5 py-1 rounded-lg font-medium transition-all flex items-center gap-1 ${
                      activeFormat === 'brief'
                        ? 'bg-teal-600 text-white shadow-sm'
                        : 'text-teal-400/80 hover:text-teal-300'
                    }`}
                    title="Confidential Interview Defense Brief mapping bullets to raw evidence"
                  >
                    <FileText className="w-3 h-3" />
                    <span>Defense Brief</span>
                  </button>
                </div>

                {activeFormat === 'typst' && (
                  <div className="flex items-center justify-between gap-2 px-1">
                    <div className="flex items-center bg-slate-900 p-0.5 rounded-lg border border-slate-800">
                      <button
                        onClick={() => setTypstView('preview')}
                        aria-pressed={typstView === 'preview'}
                        className={`px-2 py-0.5 text-xs font-medium rounded-md transition-colors inline-flex items-center gap-1 ${
                          typstView === 'preview' ? 'bg-slate-700 text-white' : 'text-slate-400 hover:text-white'
                        }`}
                      >
                        <Eye className="w-3 h-3" />
                        <span>Preview</span>
                      </button>
                      <button
                        onClick={() => setTypstView('source')}
                        aria-pressed={typstView === 'source'}
                        className={`px-2 py-0.5 text-xs font-medium rounded-md transition-colors inline-flex items-center gap-1 ${
                          typstView === 'source' ? 'bg-slate-700 text-white' : 'text-slate-400 hover:text-white'
                        }`}
                      >
                        <Code2 className="w-3 h-3" />
                        <span>Source</span>
                      </button>
                    </div>

                    <button
                      onClick={handleExportTypstPdf}
                      disabled={pdfExporting}
                      className="px-2.5 py-1 bg-purple-600 hover:bg-purple-500 text-white rounded-lg text-xs font-semibold transition-all inline-flex items-center gap-1.5 shadow-sm shadow-purple-900/30 disabled:opacity-50"
                      title="Typeset a PDF with the local typst binary"
                    >
                      {pdfExporting ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <FileDown className="w-3.5 h-3.5" />}
                      <span>Export PDF</span>
                    </button>
                  </div>
                )}

                {/* Preview Box */}
                <div className="flex-1 overflow-hidden bg-slate-950 border border-slate-800 rounded-xl relative flex flex-col">
                  {activeFormat === 'typst' && pdfError && (
                    <div className="m-2 px-3 py-2 rounded-xl bg-red-500/10 border border-red-500/30 text-red-300 text-xs">
                      {pdfError}
                    </div>
                  )}
                  {compiling ? (
                    <div className="flex-1 flex flex-col items-center justify-center text-slate-500 space-y-2">
                      <RefreshCw className="w-6 h-6 animate-spin text-purple-400" />
                      <span className="text-xs font-mono">Compiling {activeFormat.toUpperCase()}...</span>
                    </div>
                  ) : activeFormat === 'html' ? (
                    <iframe
                      ref={printIframeRef}
                      srcDoc={compiledOutput}
                      title="Resume Print Preview"
                      className="w-full flex-1 bg-white rounded-lg shadow-inner border-0"
                    />
                  ) : activeFormat === 'typst' && typstView === 'preview' ? (
                    <div className="flex-1 flex flex-col overflow-hidden p-2 gap-2">
                      {typstRender && !typstRender.available && (
                        <div className="px-3 py-2 rounded-xl bg-amber-500/10 border border-amber-500/30 text-amber-300 text-xs flex items-start gap-2">
                          <AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
                          <div>
                            <p className="font-semibold">Typst is not installed — showing source instead.</p>
                            <p className="text-amber-200/80 mt-0.5">{typstRender.detail}</p>
                          </div>
                        </div>
                      )}
                      {typstRender?.error && (
                        <div className="px-3 py-2 rounded-xl bg-red-500/10 border border-red-500/30 text-red-300 text-xs">
                          <p className="font-semibold inline-flex items-center gap-1.5">
                            <AlertTriangle className="w-3.5 h-3.5" /> Typst failed to compile this resume
                          </p>
                          <pre className="mt-1 font-mono text-[11px] whitespace-pre-wrap text-red-200/90 max-h-32 overflow-auto">
                            {typstRender.error}
                          </pre>
                        </div>
                      )}
                      {typstRender && typstRender.available && !typstRender.error && typstRender.pages.length > 0 ? (
                        <div className="flex-1 overflow-auto rounded-xl bg-slate-950 border border-slate-800/80 p-4 space-y-4">
                          {typstRender.pages.map((svg, index) => (
                            <img
                              key={index}
                              src={svgToDataUri(svg)}
                              alt={`Rendered resume page ${index + 1}`}
                              className="w-full block bg-white rounded-lg shadow-lg"
                            />
                          ))}
                        </div>
                      ) : !typstRender && typstRendering ? (
                        <div className="flex-1 flex items-center justify-center gap-2 text-xs text-slate-500 rounded-xl bg-slate-950 border border-slate-800/80">
                          <RefreshCw className="w-4 h-4 animate-spin text-purple-400" />
                          <span>Rendering with typst...</span>
                        </div>
                      ) : (
                        <pre className="p-4 flex-1 overflow-auto font-mono text-xs text-slate-200 whitespace-pre-wrap leading-relaxed selection:bg-purple-900/50">
                          {compiledOutput || '// No output generated'}
                        </pre>
                      )}
                    </div>
                  ) : (
                    <pre className="p-4 flex-1 overflow-auto font-mono text-xs text-slate-200 whitespace-pre-wrap leading-relaxed selection:bg-purple-900/50">
                      {compiledOutput || '// No output generated'}
                    </pre>
                  )}
                </div>
              </div>
            ) : (
              /* Artifacts Shelf View */
              <div className="flex-1 overflow-y-auto space-y-3">
                <div className="flex items-center justify-between text-xs text-slate-400 px-1">
                  <span>
                    Saved Artifacts in <code className="text-slate-300 font-mono">resumes/exports/</code> & <code className="text-slate-300 font-mono">briefs/</code>
                  </span>
                  <button
                    onClick={loadArtifacts}
                    className="hover:text-white transition-colors flex items-center gap-1"
                  >
                    <RefreshCw className={`w-3 h-3 ${artifactsLoading ? 'animate-spin' : ''}`} />
                    <span>Refresh</span>
                  </button>
                </div>

                {artifactsLoading && artifacts.length === 0 ? (
                  <div className="py-16 text-center text-slate-500 text-xs">
                    <RefreshCw className="w-6 h-6 animate-spin mx-auto text-purple-400 mb-2" />
                    Scanning workspace deliverables...
                  </div>
                ) : artifacts.length === 0 ? (
                  <div className="py-16 text-center text-slate-500 text-xs space-y-2">
                    <Package className="w-8 h-8 mx-auto text-slate-600" />
                    <p>No compiled artifacts found yet.</p>
                    <p className="text-[11px] text-slate-600">
                      Click <strong>"Save Bundle"</strong> above to generate your first release package.
                    </p>
                  </div>
                ) : (
                  <div className="space-y-2">
                    {artifacts.map((art) => (
                      <div
                        key={art.relativePath}
                        className="p-3 bg-slate-900/90 border border-slate-800 hover:border-slate-700 rounded-xl flex items-center justify-between transition-colors text-xs"
                      >
                        <div className="space-y-1 min-w-0 pr-2">
                          <div className="flex items-center gap-2">
                            <span
                              className={`px-1.5 py-0.2 rounded text-[10px] uppercase font-mono border ${getFormatBadge(
                                art.format
                              )}`}
                            >
                              {art.format}
                            </span>
                            {art.category === 'brief' && (
                              <span className="px-1.5 py-0.2 rounded text-[10px] font-medium bg-teal-950 text-teal-300 border border-teal-500/30">
                                Confidential Brief
                              </span>
                            )}
                            <span className="font-medium text-slate-200 truncate font-mono">
                              {art.name}
                            </span>
                          </div>
                          <div className="flex items-center gap-3 text-[11px] text-slate-500 font-mono">
                            <span className="flex items-center gap-1">
                              <Clock className="w-3 h-3" />
                              {new Date(art.updatedAt).toLocaleDateString()}{' '}
                              {new Date(art.updatedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                            </span>
                            <span>{(art.sizeBytes / 1024).toFixed(1)} KB</span>
                            <span className="truncate max-w-[200px]" title={art.relativePath}>
                              {art.relativePath}
                            </span>
                          </div>
                        </div>

                        <div className="flex items-center gap-1.5 shrink-0">
                          <button
                            onClick={() => {
                              navigator.clipboard.writeText(art.relativePath);
                              alert(`Copied relative path: ${art.relativePath}`);
                            }}
                            className="p-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white transition-colors text-xs"
                            title="Copy relative file path"
                          >
                            <Copy className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Footer Info */}
          <div className="px-6 py-3 border-t border-slate-800 bg-slate-950/80 flex items-center justify-between text-xs text-slate-500">
            <span>
              Quarantined Briefs: <code className="text-teal-400 font-mono">resumes/tailored/briefs/</code>
            </span>
            <button
              onClick={onClose}
              className="px-4 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-lg text-xs font-semibold transition-colors"
            >
              Close Drawer
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
