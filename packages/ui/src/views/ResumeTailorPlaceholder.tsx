import React from 'react';
import { Sparkles, ShieldCheck, Printer, Code2 } from 'lucide-react';

export const ResumeTailorPlaceholder: React.FC = () => {
  return (
    <div className="space-y-6 animate-fadeIn">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-white flex items-center gap-2.5">
          Resume Tailor & Performance Brag Docs
          <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-slate-800 text-purple-400 border border-slate-700">
            Task 10 Preview
          </span>
        </h1>
        <p className="text-sm text-slate-400">
          Target role specifications, compile ATS-optimized resumes in Markdown, HTML print, Typst, or LaTeX, and generate performance review brag sheets.
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <div className="p-6 bg-slate-900/60 border border-slate-800 rounded-2xl space-y-4">
          <div className="p-3 w-fit rounded-xl bg-purple-500/10 text-purple-400 border border-purple-500/20">
            <Sparkles className="w-6 h-6" />
          </div>
          <h2 className="text-lg font-bold text-white">Targeted Role Matching</h2>
          <p className="text-sm text-slate-300 leading-relaxed">
            Select high-impact bullets linked to your verified evidence cards. Citations like{' '}
            <code className="text-emerald-400 font-mono">(ev-042)</code> are automatically converted to clean bullet points with privacy rules applied.
          </p>
        </div>

        <div className="p-6 bg-slate-900/60 border border-slate-800 rounded-2xl space-y-4">
          <div className="p-3 w-fit rounded-xl bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
            <Printer className="w-6 h-6" />
          </div>
          <h2 className="text-lg font-bold text-white">Multi-Format Compilers</h2>
          <p className="text-sm text-slate-300 leading-relaxed">
            Compiled outputs render directly to ATS-friendly Markdown, pixel-perfect HTML print documents, Typst source files, or LaTeX templates.
          </p>
        </div>

        <div className="p-6 bg-slate-900/60 border border-slate-800 rounded-2xl space-y-4">
          <div className="p-3 w-fit rounded-xl bg-cyan-500/10 text-cyan-400 border border-cyan-500/20">
            <ShieldCheck className="w-6 h-6" />
          </div>
          <h2 className="text-lg font-bold text-white">Guaranteed Redaction Defense</h2>
          <p className="text-sm text-slate-300 leading-relaxed">
            Every compile pass runs through the privacy engine to sanitize internal hostnames, ticket codes, and banned proprietary keywords before export.
          </p>
        </div>
      </div>

      <div className="p-6 bg-slate-900/40 border border-dashed border-slate-800 rounded-2xl flex items-center justify-between">
        <div className="space-y-1">
          <h3 className="text-sm font-semibold text-white flex items-center gap-2">
            <Code2 className="w-4 h-4 text-emerald-400" />
            Backend Compiler Ready
          </h3>
          <p className="text-xs text-slate-400">
            Endpoint <code className="text-slate-300 font-mono">POST /api/resumes/compile</code> is tested and active.
          </p>
        </div>
        <span className="text-xs font-mono text-purple-400 bg-purple-950/40 px-3 py-1.5 rounded-xl border border-purple-500/30">
          Scheduled for Task 10
        </span>
      </div>
    </div>
  );
};
