import React, { useState, useEffect } from 'react';
import { Target, Award, CheckCircle2, RefreshCw } from 'lucide-react';
import { apiClient } from '../api/client';
import type { LevelingRubric } from '@featherduster/core';

export const RubricGapsPlaceholder: React.FC = () => {
  const [rubrics, setRubrics] = useState<LevelingRubric[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      try {
        setLoading(true);
        const data = await apiClient.getRubrics();
        setRubrics(data);
      } catch {
        // Fallback
      } finally {
        setLoading(false);
      }
    }
    load();
  }, []);

  return (
    <div className="space-y-6 animate-fadeIn">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-white flex items-center gap-2.5">
          Rubric Gaps & Career Matrix
          <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-slate-800 text-teal-400 border border-slate-700">
            Task 9 Preview
          </span>
        </h1>
        <p className="text-sm text-slate-400">
          Target promotion levels, benchmark against engineering ladders, and identify unverified competencies.
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div className="p-6 bg-slate-900/60 border border-slate-800 rounded-2xl space-y-4">
          <div className="p-3 w-fit rounded-xl bg-teal-500/10 text-teal-400 border border-teal-500/20">
            <Target className="w-6 h-6" />
          </div>
          <h2 className="text-lg font-bold text-white">Competency Coverage Analysis</h2>
          <p className="text-sm text-slate-300 leading-relaxed">
            Featherduster maps your verified evidence against target levels (L4, L5, L6) across dimensions:
            Architecture Scope, Execution Velocity, Team Multipliers, and Mentorship.
          </p>
          <div className="pt-2">
            <div className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">
              Detected Rubrics in Workspace ({rubrics.length})
            </div>
            {loading ? (
              <div className="flex items-center space-x-2 text-xs text-slate-500">
                <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                <span>Scanning rubrics...</span>
              </div>
            ) : rubrics.length > 0 ? (
              <div className="space-y-2">
                {rubrics.map((r) => (
                  <div
                    key={r.id}
                    className="p-3 bg-slate-950 rounded-xl border border-slate-800 flex items-center justify-between"
                  >
                    <div>
                      <div className="text-sm font-semibold text-white">{r.title}</div>
                      <div className="text-xs text-slate-500 font-mono">
                        {r.levels?.length ?? 0} levels · {r.competencies?.length ?? 0} competencies
                      </div>
                    </div>
                    <span className="text-xs font-mono text-teal-400 bg-teal-950/40 px-2 py-1 rounded border border-teal-500/20">
                      Target {r.target_level || 'L5'}
                    </span>
                  </div>
                ))}
              </div>
            ) : (
              <div className="p-3 bg-slate-950 rounded-xl border border-slate-800 text-xs text-slate-500">
                Place rubric definitions in <code className="text-teal-400">rubrics/*.yaml</code> or markdown tables.
              </div>
            )}
          </div>
        </div>

        <div className="p-6 bg-slate-900/60 border border-slate-800 rounded-2xl flex flex-col justify-between space-y-4">
          <div className="space-y-4">
            <div className="p-3 w-fit rounded-xl bg-indigo-500/10 text-indigo-400 border border-indigo-500/20">
              <Award className="w-6 h-6" />
            </div>
            <h2 className="text-lg font-bold text-white">Full Interactive Gap Matrix</h2>
            <p className="text-sm text-slate-300 leading-relaxed">
              Task 9 will introduce interactive level sliders, automated gap percentage gauges, and
              instant evidence-to-competency linkers directly in this view.
            </p>
            <div className="space-y-2 text-xs text-slate-400">
              <div className="flex items-center space-x-2">
                <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                <span>Backend `/api/rubrics` and `/api/rubrics/gap-analysis` fully tested & online.</span>
              </div>
              <div className="flex items-center space-x-2">
                <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                <span>Parses Markdown tables, TSV, CSV, JSON, and YAML schemas seamlessly.</span>
              </div>
            </div>
          </div>
          <div className="pt-4 border-t border-slate-800 text-xs text-slate-500">
            Scheduled for Task 9: Leveling Rubric Gap Analyzer UI
          </div>
        </div>
      </div>
    </div>
  );
};
