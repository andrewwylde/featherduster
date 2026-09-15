import React, { useState, useMemo } from 'react';
import {
  X,
  Upload,
  Table as TableIcon,
  CheckCircle2,
  AlertCircle,
  FileCode,
  Layers,
  Sparkles,
} from 'lucide-react';
import { parseRubricTable, type LevelingRubric } from '@featherduster/core';
import { apiClient } from '../api/client';

export interface RubricImporterModalProps {
  isOpen: boolean;
  onClose: () => void;
  onImportSuccess: (rubric: LevelingRubric) => void;
}

const SAMPLE_MARKDOWN_TABLE = `| Competency | L3 (Junior) | L4 (Senior) | L5 (Staff) |
|---|---|---|---|
| Architecture & Scope | Works within single service | Designs services end-to-end | Sets multi-system architecture |
| Execution & Delivery | Delivers well-scoped tasks | Drives multi-week milestones | Leads cross-team programs |
| Technical Leadership | Active in code reviews | Mentors mid-level engineers | Sponsors engineers for promotion |
| Reliability & Ops | Follows on-call runbooks | Defines SLOs and runbooks | Sets systemic incident resilience |`;

export const RubricImporterModal: React.FC<RubricImporterModalProps> = ({
  isOpen,
  onClose,
  onImportSuccess,
}) => {
  const [rawTable, setRawTable] = useState('');
  const [rubricId, setRubricId] = useState('');
  const [title, setTitle] = useState('');
  const [targetLevel, setTargetLevel] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [apiError, setApiError] = useState<string | null>(null);

  // Live parsing preview using parseRubricTable from core
  const parseResult = useMemo(() => {
    if (!rawTable.trim()) {
      return { rubric: null, error: null };
    }
    try {
      const parsed = parseRubricTable(rawTable, {
        id: rubricId.trim() || undefined,
        title: title.trim() || undefined,
        target_level: targetLevel.trim() || undefined,
      });
      return { rubric: parsed, error: null };
    } catch (err: any) {
      return { rubric: null, error: err.message || 'Unable to parse table' };
    }
  }, [rawTable, rubricId, title, targetLevel]);

  if (!isOpen) return null;

  const handleLoadSample = () => {
    setRawTable(SAMPLE_MARKDOWN_TABLE);
    if (!rubricId) setRubricId('staff-ladder');
    if (!title) setTitle('Staff Engineering Ladder');
    if (!targetLevel) setTargetLevel('L5');
  };

  const handleImport = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!parseResult.rubric) return;

    try {
      setIsSubmitting(true);
      setApiError(null);

      const response = await apiClient.importRubric({
        rawTable,
        id: rubricId.trim() || parseResult.rubric.id,
        title: title.trim() || parseResult.rubric.title,
        target_level: targetLevel.trim() || parseResult.rubric.target_level,
      });

      if (response.success && response.rubric) {
        onImportSuccess(response.rubric);
        onClose();
      } else {
        setApiError(response.error || 'Failed to import rubric');
      }
    } catch (err: any) {
      setApiError(err.message || 'Failed to import rubric');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="bg-slate-900 border border-slate-800 rounded-2xl w-full max-w-4xl max-h-[92vh] flex flex-col shadow-2xl overflow-hidden animate-scaleIn">
        {/* Header */}
        <div className="px-6 py-4 border-b border-slate-800 flex items-center justify-between bg-slate-950/50">
          <div className="flex items-center space-x-3">
            <div className="p-2 rounded-xl bg-teal-500/10 text-teal-400 border border-teal-500/20">
              <TableIcon className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-lg font-bold text-white">Import Leveling Rubric</h2>
              <p className="text-xs text-slate-400">
                Paste Markdown tables, Notion tables, or TSV/CSV from Google Sheets or Excel
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

        {/* Scrollable Form Body */}
        <form onSubmit={handleImport} className="flex-1 overflow-y-auto p-6 space-y-6">
          {apiError && (
            <div className="p-3 bg-rose-500/10 border border-rose-500/20 rounded-xl flex items-start space-x-2 text-rose-400 text-xs">
              <AlertCircle className="w-4 h-4 mt-0.5 flex-shrink-0" />
              <span>{apiError}</span>
            </div>
          )}

          {/* Metadata Inputs */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <label className="block text-xs font-semibold text-slate-300 mb-1.5">
                Rubric ID <span className="text-teal-400">*</span>
              </label>
              <input
                type="text"
                value={rubricId}
                onChange={(e) => setRubricId(e.target.value)}
                placeholder="e.g. staff-ladder"
                className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-xl text-sm text-white placeholder-slate-500 focus:outline-none focus:border-teal-500 focus:ring-1 focus:ring-teal-500 font-mono"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-300 mb-1.5">
                Rubric Title <span className="text-teal-400">*</span>
              </label>
              <input
                type="text"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="e.g. Staff Engineering Ladder"
                className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-xl text-sm text-white placeholder-slate-500 focus:outline-none focus:border-teal-500 focus:ring-1 focus:ring-teal-500"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-300 mb-1.5">
                Target Level <span className="text-slate-500">(optional)</span>
              </label>
              <input
                type="text"
                value={targetLevel}
                onChange={(e) => setTargetLevel(e.target.value)}
                placeholder="e.g. L5"
                className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-xl text-sm text-white placeholder-slate-500 focus:outline-none focus:border-teal-500 focus:ring-1 focus:ring-teal-500 font-mono"
              />
            </div>
          </div>

          {/* Table Textarea */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <label className="block text-xs font-semibold text-slate-300">
                Rubric Table Content <span className="text-teal-400">*</span>
              </label>
              <button
                type="button"
                onClick={handleLoadSample}
                className="text-xs text-teal-400 hover:text-teal-300 flex items-center space-x-1"
              >
                <Sparkles className="w-3.5 h-3.5" />
                <span>Load Sample Markdown</span>
              </button>
            </div>
            <textarea
              rows={8}
              value={rawTable}
              onChange={(e) => setRawTable(e.target.value)}
              placeholder="Paste Markdown table (| Competency | L3 | L4 | L5 |), tab-separated spreadsheet data, or CSV..."
              className="w-full px-3.5 py-3 bg-slate-950 border border-slate-800 rounded-xl text-xs font-mono text-slate-200 placeholder-slate-600 focus:outline-none focus:border-teal-500 focus:ring-1 focus:ring-teal-500 leading-relaxed resize-y"
            />
          </div>

          {/* Live Parse Preview */}
          <div className="border border-slate-800 rounded-xl bg-slate-950/60 p-4 space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold uppercase tracking-wider text-slate-400 flex items-center gap-1.5">
                <FileCode className="w-3.5 h-3.5 text-teal-400" />
                Live Parse Preview
              </span>
              {parseResult.rubric ? (
                <span className="inline-flex items-center gap-1 text-xs font-medium text-emerald-400 bg-emerald-500/10 px-2 py-0.5 rounded-full border border-emerald-500/20">
                  <CheckCircle2 className="w-3 h-3" />
                  Valid Rubric Format
                </span>
              ) : rawTable.trim() ? (
                <span className="inline-flex items-center gap-1 text-xs font-medium text-amber-400 bg-amber-500/10 px-2 py-0.5 rounded-full border border-amber-500/20">
                  <AlertCircle className="w-3 h-3" />
                  Parsing Table...
                </span>
              ) : (
                <span className="text-xs text-slate-500">Awaiting input</span>
              )}
            </div>

            {parseResult.error && (
              <div className="p-3 bg-rose-500/10 border border-rose-500/20 rounded-lg text-xs text-rose-400">
                {parseResult.error}
              </div>
            )}

            {parseResult.rubric && (
              <div className="space-y-3 pt-1">
                {/* Levels list */}
                <div>
                  <div className="text-xs text-slate-400 mb-1.5 flex items-center gap-1">
                    <Layers className="w-3 h-3 text-teal-400" />
                    <span>Detected Levels ({parseResult.rubric.levels.length}):</span>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {parseResult.rubric.levels.map((lvl) => (
                      <span
                        key={lvl.id}
                        className="inline-flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-lg bg-slate-900 border border-slate-800 text-slate-200"
                      >
                        <span className="font-mono text-teal-400 font-bold">{lvl.id}</span>
                        <span className="text-slate-400 text-[11px]">{lvl.name}</span>
                      </span>
                    ))}
                  </div>
                </div>

                {/* Competencies preview list */}
                <div>
                  <div className="text-xs text-slate-400 mb-1.5">
                    Detected Competencies ({parseResult.rubric.competencies.length}):
                  </div>
                  <div className="max-h-48 overflow-y-auto space-y-1.5 pr-1">
                    {parseResult.rubric.competencies.map((comp) => (
                      <div
                        key={comp.id}
                        className="p-2.5 rounded-lg bg-slate-900/80 border border-slate-800/80 text-xs flex flex-col gap-1"
                      >
                        <div className="flex items-center justify-between">
                          <span className="font-semibold text-white">{comp.name}</span>
                          <span className="font-mono text-[10px] text-slate-500">{comp.id}</span>
                        </div>
                        {/* Sample expectation from first available level */}
                        <div className="text-[11px] text-slate-400 truncate">
                          {Object.entries(comp.levels)[0]
                            ? `${Object.entries(comp.levels)[0][0]}: ${Object.entries(comp.levels)[0][1]}`
                            : 'No level descriptions'}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )}
          </div>
        </form>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-slate-800 bg-slate-950/50 flex items-center justify-end space-x-3">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 text-xs font-semibold text-slate-400 hover:text-white bg-slate-800 hover:bg-slate-700 rounded-xl transition-colors"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleImport}
            disabled={!parseResult.rubric || isSubmitting}
            className="px-5 py-2 text-xs font-semibold text-slate-950 bg-teal-400 hover:bg-teal-300 disabled:opacity-50 disabled:cursor-not-allowed rounded-xl transition-colors flex items-center space-x-1.5 shadow-lg shadow-teal-500/10"
          >
            <Upload className="w-3.5 h-3.5" />
            <span>{isSubmitting ? 'Importing...' : 'Import & Save'}</span>
          </button>
        </div>
      </div>
    </div>
  );
};
