import React, { useState, useEffect } from 'react';
import {
  X,
  Plus,
  Trash2,
  CheckCircle2,
  AlertCircle,
  Sparkles,
  Layers,
} from 'lucide-react';
import type { EvidenceEntry } from '@featherduster/core';
import { apiClient } from '../api/client';

interface QuickCaptureModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: (entry: EvidenceEntry) => void;
  existingIds: string[];
  existingCompanies: string[];
}

export function generateNextId(existingIds: string[]): string {
  let maxNum = 0;
  for (const id of existingIds) {
    const match = id.match(/^ev-(\d+)$/i);
    if (match) {
      const num = parseInt(match[1], 10);
      if (num > maxNum) maxNum = num;
    }
  }
  const nextNum = maxNum + 1;
  return `ev-${String(nextNum).padStart(3, '0')}`;
}

export const QuickCaptureModal: React.FC<QuickCaptureModalProps> = ({
  isOpen,
  onClose,
  onSuccess,
  existingIds,
  existingCompanies,
}) => {
  const [id, setId] = useState('');
  const [title, setTitle] = useState('');
  const [company, setCompany] = useState('');
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [confidence, setConfidence] = useState<'verified' | 'provisional' | 'retracted'>('verified');
  const [inFlight, setInFlight] = useState(false);
  const [summary, setSummary] = useState('');
  const [impact, setImpact] = useState('');
  const [themesInput, setThemesInput] = useState('');
  const [metrics, setMetrics] = useState<
    Array<{ name: string; value: string; status: 'verified' | 'provisional' | 'missing' }>
  >([]);
  const [internalRefs, setInternalRefs] = useState<
    Array<{ type: string; ref: string }>
  >([]);
  const [narrative, setNarrative] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Initialize or reset form when modal opens
  useEffect(() => {
    if (isOpen) {
      setId(generateNextId(existingIds));
      setTitle('');
      setCompany(existingCompanies[0] || '');
      setDate(new Date().toISOString().slice(0, 10));
      setConfidence('verified');
      setInFlight(false);
      setSummary('');
      setImpact('');
      setThemesInput('');
      setMetrics([]);
      setInternalRefs([]);
      setNarrative('## Context\n\n## Action & Decisions\n\n## Quantitative Results\n');
      setError(null);
    }
  }, [isOpen, existingIds, existingCompanies]);

  if (!isOpen) return null;

  const handleAddMetric = () => {
    setMetrics([...metrics, { name: '', value: '', status: 'verified' }]);
  };

  const handleRemoveMetric = (index: number) => {
    setMetrics(metrics.filter((_, i) => i !== index));
  };

  const handleUpdateMetric = (
    index: number,
    field: 'name' | 'value' | 'status',
    val: string
  ) => {
    const next = [...metrics];
    next[index] = { ...next[index], [field]: val };
    setMetrics(next);
  };

  const handleAddRef = () => {
    setInternalRefs([...internalRefs, { type: 'linear', ref: '' }]);
  };

  const handleRemoveRef = (index: number) => {
    setInternalRefs(internalRefs.filter((_, i) => i !== index));
  };

  const handleUpdateRef = (index: number, field: 'type' | 'ref', val: string) => {
    const next = [...internalRefs];
    next[index] = { ...next[index], [field]: val };
    setInternalRefs(next);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    // Validation
    if (!id.trim()) {
      setError('Evidence ID is required (e.g. ev-001)');
      return;
    }
    if (!title.trim()) {
      setError('Title is required');
      return;
    }
    if (!company.trim()) {
      setError('Company name is required');
      return;
    }
    if (!date.trim()) {
      setError('Date is required');
      return;
    }
    if (!summary.trim()) {
      setError('Summary statement is required');
      return;
    }
    if (!impact.trim()) {
      setError('Key impact statement is required');
      return;
    }

    const themes = themesInput
      .split(/[, ]+/)
      .map((t) => t.trim().toLowerCase())
      .filter(Boolean);

    // Filter valid metrics
    const validMetrics = metrics
      .filter((m) => m.name.trim() && m.value.trim())
      .map((m) => ({
        name: m.name.trim(),
        value: m.value.trim(),
        status: m.status,
      }));

    // Filter valid internal references
    const validRefs = internalRefs
      .filter((r) => r.type.trim() && r.ref.trim())
      .map((r) => ({
        type: r.type.trim().toLowerCase(),
        ref: r.ref.trim(),
      }));

    const entry: EvidenceEntry = {
      id: id.trim(),
      title: title.trim(),
      company: company.trim().toLowerCase(),
      date: date.trim(),
      confidence,
      in_flight: inFlight,
      summary: summary.trim(),
      impact: impact.trim(),
      themes,
      metrics: validMetrics,
      internal_references: validRefs,
    };

    setIsSubmitting(true);
    try {
      const res = await apiClient.saveEvidence(entry, narrative);
      if (res.success) {
        onSuccess(entry);
        onClose();
      } else {
        setError(res.error || 'Failed to save evidence');
      }
    } catch (err: any) {
      setError(err.message || 'An unexpected error occurred while saving.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-sm animate-fadeIn">
      <div className="relative w-full max-w-3xl bg-slate-900 border border-slate-800 rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[92vh]">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-800 bg-slate-950/70">
          <div className="flex items-center space-x-3">
            <div className="p-2 bg-emerald-500/10 text-emerald-400 rounded-xl border border-emerald-500/20">
              <Sparkles className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-lg font-bold text-white flex items-center gap-2">
                Capture Evidence Card
                <span className="text-xs font-mono px-2 py-0.5 rounded bg-slate-800 text-emerald-400 border border-slate-700">
                  {id}
                </span>
              </h2>
              <p className="text-xs text-slate-400">
                Log a concrete accomplishment with metrics, confidence, and context.
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-2 text-slate-400 hover:text-white hover:bg-slate-800 rounded-lg transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Form Body */}
        <form id="quick-capture-form" onSubmit={handleSubmit} className="p-6 overflow-y-auto flex-1 space-y-5">
          {error && (
            <div className="flex items-start space-x-2.5 p-3 rounded-xl bg-rose-950/40 border border-rose-500/30 text-rose-300 text-sm">
              <AlertCircle className="w-5 h-5 text-rose-400 shrink-0 mt-0.5" />
              <span>{error}</span>
            </div>
          )}

          {/* Row 1: ID, Title, Company */}
          <div className="grid grid-cols-1 md:grid-cols-6 gap-4">
            <div className="md:col-span-1">
              <label className="block text-xs font-medium text-slate-300 mb-1">ID</label>
              <input
                type="text"
                value={id}
                onChange={(e) => setId(e.target.value)}
                className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-lg text-sm text-emerald-400 font-mono focus:border-emerald-500 focus:outline-none"
                placeholder="ev-001"
                required
              />
            </div>
            <div className="md:col-span-3">
              <label className="block text-xs font-medium text-slate-300 mb-1">Title *</label>
              <input
                type="text"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-lg text-sm text-white placeholder-slate-500 focus:border-emerald-500 focus:outline-none"
                placeholder="e.g. Zero-Downtime Session Migration"
                required
              />
            </div>
            <div className="md:col-span-2">
              <label className="block text-xs font-medium text-slate-300 mb-1">Company *</label>
              <input
                type="text"
                list="company-list"
                value={company}
                onChange={(e) => setCompany(e.target.value)}
                className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-lg text-sm text-white placeholder-slate-500 focus:border-emerald-500 focus:outline-none"
                placeholder="e.g. acme"
                required
              />
              <datalist id="company-list">
                {existingCompanies.map((c) => (
                  <option key={c} value={c} />
                ))}
              </datalist>
            </div>
          </div>

          {/* Row 2: Date, Confidence, In-Flight */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <label className="block text-xs font-medium text-slate-300 mb-1">Date *</label>
              <input
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
                className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-lg text-sm text-white focus:border-emerald-500 focus:outline-none"
                required
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-300 mb-1">Confidence</label>
              <select
                value={confidence}
                onChange={(e) =>
                  setConfidence(e.target.value as 'verified' | 'provisional' | 'retracted')
                }
                className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-lg text-sm text-white focus:border-emerald-500 focus:outline-none"
              >
                <option value="verified">Verified (backed by concrete metrics)</option>
                <option value="provisional">Provisional (work completed, pending final metrics)</option>
                <option value="retracted">Retracted</option>
              </select>
            </div>
            <div className="flex items-center space-x-3 pt-6">
              <input
                type="checkbox"
                id="in-flight"
                checked={inFlight}
                onChange={(e) => setInFlight(e.target.checked)}
                className="w-4 h-4 rounded bg-slate-950 border-slate-800 text-emerald-500 focus:ring-emerald-500"
              />
              <label htmlFor="in-flight" className="text-sm font-medium text-slate-300 cursor-pointer">
                In-Flight Project
              </label>
            </div>
          </div>

          {/* Row 3: Summary */}
          <div>
            <label className="block text-xs font-medium text-slate-300 mb-1">
              Summary Statement * <span className="text-slate-500">(Architecture / What was done)</span>
            </label>
            <textarea
              value={summary}
              onChange={(e) => setSummary(e.target.value)}
              rows={2}
              className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-lg text-sm text-white placeholder-slate-500 focus:border-emerald-500 focus:outline-none"
              placeholder="Architected token rotation protocol eliminating session invalidations during DB switch..."
              required
            />
          </div>

          {/* Row 4: Impact */}
          <div>
            <label className="block text-xs font-medium text-slate-300 mb-1">
              Key Impact Statement * <span className="text-slate-500">(Measurable business outcome)</span>
            </label>
            <textarea
              value={impact}
              onChange={(e) => setImpact(e.target.value)}
              rows={2}
              className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-lg text-sm text-white placeholder-slate-500 focus:border-emerald-500 focus:outline-none"
              placeholder="Reduced user re-auth events by 99.4% across 140k active daily sessions..."
              required
            />
          </div>

          {/* Row 5: Themes */}
          <div>
            <label className="block text-xs font-medium text-slate-300 mb-1">
              Themes / Skills <span className="text-slate-500">(comma or space separated)</span>
            </label>
            <input
              type="text"
              value={themesInput}
              onChange={(e) => setThemesInput(e.target.value)}
              className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-lg text-sm text-white placeholder-slate-500 focus:border-emerald-500 focus:outline-none"
              placeholder="e.g. distributed-systems, reliability, auth, rust"
            />
          </div>

          {/* Row 6: Metrics Builder */}
          <div className="space-y-2 border-t border-slate-800/80 pt-4">
            <div className="flex items-center justify-between">
              <label className="text-xs font-semibold text-slate-300 flex items-center gap-1.5">
                <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                Metrics & Quantitative Proof
              </label>
              <button
                type="button"
                onClick={handleAddMetric}
                className="text-xs font-medium text-emerald-400 hover:text-emerald-300 flex items-center gap-1 px-2 py-1 rounded bg-emerald-500/10 hover:bg-emerald-500/20 border border-emerald-500/20"
              >
                <Plus className="w-3.5 h-3.5" />
                Add Metric
              </button>
            </div>

            {metrics.length === 0 ? (
              <p className="text-xs text-slate-500 italic">No quantitative metrics specified yet.</p>
            ) : (
              <div className="space-y-2">
                {metrics.map((m, idx) => (
                  <div key={idx} className="flex items-center gap-2">
                    <input
                      type="text"
                      placeholder="Metric Name (e.g. p99 latency)"
                      value={m.name}
                      onChange={(e) => handleUpdateMetric(idx, 'name', e.target.value)}
                      className="flex-1 px-2.5 py-1.5 bg-slate-950 border border-slate-800 rounded-lg text-xs text-white placeholder-slate-500 focus:border-emerald-500 focus:outline-none"
                    />
                    <input
                      type="text"
                      placeholder="Value (e.g. 12ms or -85%)"
                      value={m.value}
                      onChange={(e) => handleUpdateMetric(idx, 'value', e.target.value)}
                      className="w-36 px-2.5 py-1.5 bg-slate-950 border border-slate-800 rounded-lg text-xs font-mono text-emerald-400 placeholder-slate-500 focus:border-emerald-500 focus:outline-none"
                    />
                    <select
                      value={m.status}
                      onChange={(e) =>
                        handleUpdateMetric(
                          idx,
                          'status',
                          e.target.value as 'verified' | 'provisional' | 'missing'
                        )
                      }
                      className="px-2 py-1.5 bg-slate-950 border border-slate-800 rounded-lg text-xs text-white focus:border-emerald-500 focus:outline-none"
                    >
                      <option value="verified">Verified</option>
                      <option value="provisional">Provisional</option>
                      <option value="missing">Missing</option>
                    </select>
                    <button
                      type="button"
                      onClick={() => handleRemoveMetric(idx)}
                      className="p-1.5 text-slate-500 hover:text-rose-400 hover:bg-slate-800 rounded"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Row 7: Internal References (Linear / Jira / PR) */}
          <div className="space-y-2 border-t border-slate-800/80 pt-4">
            <div className="flex items-center justify-between">
              <label className="text-xs font-semibold text-slate-300 flex items-center gap-1.5">
                <Layers className="w-4 h-4 text-slate-400" />
                Internal Ticket / PR References
              </label>
              <button
                type="button"
                onClick={handleAddRef}
                className="text-xs font-medium text-slate-400 hover:text-slate-200 flex items-center gap-1 px-2 py-1 rounded bg-slate-800 hover:bg-slate-700"
              >
                <Plus className="w-3.5 h-3.5" />
                Add Reference
              </button>
            </div>

            {internalRefs.length > 0 && (
              <div className="space-y-2">
                {internalRefs.map((r, idx) => (
                  <div key={idx} className="flex items-center gap-2">
                    <select
                      value={r.type}
                      onChange={(e) => handleUpdateRef(idx, 'type', e.target.value)}
                      className="px-2.5 py-1.5 bg-slate-950 border border-slate-800 rounded-lg text-xs text-white focus:border-emerald-500 focus:outline-none"
                    >
                      <option value="linear">Linear</option>
                      <option value="jira">Jira</option>
                      <option value="pr">PR</option>
                      <option value="doc">Doc</option>
                    </select>
                    <input
                      type="text"
                      placeholder="Ticket or Ref (e.g. AUTH-892)"
                      value={r.ref}
                      onChange={(e) => handleUpdateRef(idx, 'ref', e.target.value)}
                      className="flex-1 px-2.5 py-1.5 bg-slate-950 border border-slate-800 rounded-lg text-xs font-mono text-slate-200 placeholder-slate-500 focus:border-emerald-500 focus:outline-none"
                    />
                    <button
                      type="button"
                      onClick={() => handleRemoveRef(idx)}
                      className="p-1.5 text-slate-500 hover:text-rose-400 hover:bg-slate-800 rounded"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Row 8: Narrative Markdown */}
          <div className="border-t border-slate-800/80 pt-4">
            <label className="block text-xs font-semibold text-slate-300 mb-1">
              Detailed Narrative (Markdown)
            </label>
            <textarea
              value={narrative}
              onChange={(e) => setNarrative(e.target.value)}
              rows={5}
              className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-lg text-xs font-mono text-slate-300 placeholder-slate-600 focus:border-emerald-500 focus:outline-none"
              placeholder="In-depth explanation, architecture trade-offs, and technical notes..."
            />
          </div>
        </form>

        {/* Footer */}
        <div className="flex items-center justify-between px-6 py-4 border-t border-slate-800 bg-slate-950/80">
          <div className="text-xs text-slate-500">
            Files are saved to disk under <span className="font-mono text-slate-400">evidence/{company || 'general'}/{id}.md</span>
          </div>
          <div className="flex items-center space-x-3">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-sm font-medium text-slate-300 hover:text-white bg-slate-800 hover:bg-slate-700 rounded-lg transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              form="quick-capture-form"
              disabled={isSubmitting}
              className="px-5 py-2 text-sm font-semibold text-slate-950 bg-emerald-500 hover:bg-emerald-400 rounded-lg shadow-md shadow-emerald-500/20 transition-all disabled:opacity-50"
            >
              {isSubmitting ? 'Saving to Disk...' : 'Save Evidence Card'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
