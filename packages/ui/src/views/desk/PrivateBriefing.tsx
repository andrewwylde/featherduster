import React from 'react';
import {
  GitPullRequest,
  FileText,
  Users,
  ArrowRight,
  Maximize2,
  BarChart2,
} from 'lucide-react';
import type { RecommendedLead, SignalSource } from '../../types/desk';
import { EvidenceBadge } from '../../components/desk/EvidenceBadge';

interface PrivateBriefingProps {
  lead: RecommendedLead;
  onOpenInterview: () => void;
  onViewThread?: (threadId: string) => void;
}

export const PrivateBriefing: React.FC<PrivateBriefingProps> = ({
  lead,
  onOpenInterview,
  onViewThread,
}) => {
  const getSourceIcon = (type: SignalSource['type']) => {
    switch (type) {
      case 'pull_request':
        return GitPullRequest;
      case 'colleague_feedback':
        return Users;
      case 'project_note':
      default:
        return FileText;
    }
  };

  return (
    <div className="space-y-6 animate-in fade-in duration-150">
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Left Column: The Editor lead & Signal cards (7 cols) */}
        <div className="lg:col-span-7 flex flex-col space-y-6">
          <div className="rounded-desk border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#121622] p-6 lg:p-7 shadow-sm">
            {/* Focal Point Header */}
            <div className="border-b border-slate-100 dark:border-slate-800/80 pb-6 mb-6">
              <span className="text-xs font-mono uppercase tracking-widest text-vermilion-600 dark:text-vermilion-400 font-semibold">
                The Editor
              </span>
              <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-slate-900 dark:text-white mt-1.5 leading-tight">
                {lead.title}
              </h1>
              <p className="mt-2.5 text-sm text-slate-600 dark:text-slate-300 leading-relaxed max-w-2xl">
                {lead.leadParagraph}
              </p>
            </div>

            {/* Signal Sources List */}
            <div className="space-y-4">
              {lead.sources.map((src) => {
                const Icon = getSourceIcon(src.type);
                return (
                  <div
                    key={src.id}
                    className="p-4 rounded-desk border border-slate-200/90 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-900/40 hover:bg-slate-50 dark:hover:bg-slate-900/70 transition-colors"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex items-center gap-2.5">
                        <div className="p-1.5 rounded-lg bg-slate-200/70 dark:bg-slate-800 text-slate-700 dark:text-slate-300">
                          <Icon className="w-4 h-4" />
                        </div>
                        <div>
                          <span className="text-xs font-medium text-slate-600 dark:text-slate-400">
                            {src.tag}
                          </span>
                        </div>
                      </div>
                      <span className="text-xs text-slate-600 dark:text-slate-400 font-mono">{src.date}</span>
                    </div>

                    <h3 className="text-sm font-semibold text-slate-900 dark:text-white mt-2.5">
                      {src.title}
                    </h3>
                    <p className="text-xs text-slate-600 dark:text-slate-400 mt-1 leading-relaxed">
                      {src.description}
                    </p>

                    {src.quote && (
                      <div className="mt-3 pl-3 border-l-2 border-vermilion-500 text-xs italic text-slate-700 dark:text-slate-300 leading-normal">
                        &ldquo;{src.quote.text}&rdquo;{' '}
                        <span className="text-slate-600 dark:text-slate-400 not-italic ml-1">
                          {src.quote.author ? `(${src.quote.author})` : ''}
                        </span>
                      </div>
                    )}

                    <div className="mt-3 flex items-center justify-between pt-2 border-t border-slate-200/50 dark:border-slate-800/50">
                      <EvidenceBadge status={src.status} />
                      <button
                        type="button"
                        onClick={onOpenInterview}
                        aria-label={`View source details and start interview for ${src.title}`}
                        className="inline-flex items-center gap-1 text-xs font-medium text-vermilion-600 dark:text-vermilion-400 hover:underline focus-visible:ring-2 focus-visible:ring-vermilion-500 focus-visible:outline-none rounded"
                      >
                        <span>View source</span>
                        <ArrowRight className="w-3 h-3" aria-hidden="true" />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Action Bar */}
            <div className="mt-6 pt-5 border-t border-slate-100 dark:border-slate-800/80 flex items-center justify-between">
              <span className="text-xs text-slate-500 dark:text-slate-400">
                Ready to reconstruct and capture this story?
              </span>
              <button
                onClick={onOpenInterview}
                className="px-4 py-2.5 rounded-desk bg-vermilion-500 hover:bg-vermilion-600 text-white text-xs font-semibold shadow-sm transition-all flex items-center gap-2 hover:gap-2.5"
              >
                <span>Start focused interview</span>
                <ArrowRight className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        </div>

        {/* Right Column: Mini Node Map & Live Dossier Summary (5 cols) */}
        <div className="lg:col-span-5 flex flex-col space-y-6">
          {/* How the pieces connect: Compact Node Map */}
          <div className="rounded-desk border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#121622] p-5 lg:p-6 shadow-sm">
            <div className="flex items-start justify-between mb-4">
              <div>
                <h2 className="text-sm font-bold tracking-tight text-slate-900 dark:text-white">
                  How the pieces connect
                </h2>
                <p className="text-xs text-slate-600 dark:text-slate-400 mt-0.5">
                  Sources roll up into evidence, which build your career story.
                </p>
              </div>
              <button
                onClick={() => onViewThread?.(lead.storyThread.id)}
                className="inline-flex items-center gap-1 px-2 py-1 text-[11px] font-medium text-slate-600 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 focus-visible:ring-2 focus-visible:ring-vermilion-500 focus-visible:outline-none transition-colors"
                title="Expand full node map view"
                aria-label="Expand full node map view"
              >
                <Maximize2 className="w-3 h-3" aria-hidden="true" />
                <span>Fit view</span>
              </button>
            </div>

            {/* Node Map Visualization */}
            <div className="relative py-2 px-1">
              <div className="grid grid-cols-1 sm:grid-cols-12 gap-3 items-center">
                {/* Column 1: Sources (4 cols) */}
                <div className="sm:col-span-4 space-y-2">
                  <span className="text-[10px] font-mono uppercase tracking-wider text-slate-600 dark:text-slate-400 block mb-1">
                    Sources
                  </span>
                  <div className="p-2 rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900/60 text-xs">
                    <div className="font-semibold text-slate-800 dark:text-slate-200 truncate">
                      Pull request #4821
                    </div>
                  </div>
                  <div className="p-2 rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900/60 text-xs">
                    <div className="font-semibold text-slate-800 dark:text-slate-200 truncate">
                      Project note
                    </div>
                    <div className="text-[10px] text-slate-600 dark:text-slate-400 truncate">Reliability initiative</div>
                  </div>
                  <div className="p-2 rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900/60 text-xs">
                    <div className="font-semibold text-slate-800 dark:text-slate-200 truncate">
                      Colleague feedback
                    </div>
                    <div className="text-[10px] text-slate-600 dark:text-slate-400 truncate">From Priya Shah</div>
                  </div>
                </div>

                {/* Column 2: Evidence (4 cols) */}
                <div className="sm:col-span-4 space-y-2">
                  <span className="text-[10px] font-mono uppercase tracking-wider text-slate-600 dark:text-slate-400 block mb-1">
                    Evidence
                  </span>
                  <div className="p-2 rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900/60 text-xs flex items-center justify-between gap-1">
                    <span className="font-medium text-slate-800 dark:text-slate-200 truncate">
                      Improved system resilience
                    </span>
                  </div>
                  <div className="p-2 rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900/60 text-xs flex items-center justify-between gap-1">
                    <span className="font-medium text-slate-800 dark:text-slate-200 truncate">
                      Operational ownership
                    </span>
                  </div>
                  <div className="p-2 rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900/60 text-xs flex items-center justify-between gap-1">
                    <span className="font-medium text-slate-800 dark:text-slate-200 truncate">
                      Trusted by teammates
                    </span>
                  </div>
                </div>

                {/* Column 3: Story thread (4 cols) */}
                <div className="sm:col-span-4 flex flex-col items-center justify-center">
                  <span className="text-[10px] font-mono uppercase tracking-wider text-slate-600 dark:text-slate-400 block mb-1 w-full text-center">
                    Story thread
                  </span>
                  <button
                    type="button"
                    onClick={() => onViewThread?.(lead.storyThread.id)}
                    aria-label={`View story thread: ${lead.storyThread.title}`}
                    className="w-full p-3 rounded-desk bg-vermilion-500 text-white shadow-md shadow-vermilion-500/20 hover:bg-vermilion-600 transition-all text-center group focus-visible:ring-2 focus-visible:ring-vermilion-500 focus-visible:ring-offset-2 dark:focus-visible:ring-offset-slate-900 focus-visible:outline-none"
                  >
                    <BarChart2 className="w-5 h-5 mx-auto mb-1 group-hover:scale-110 transition-transform" aria-hidden="true" />
                    <div className="text-xs font-bold leading-tight text-white">
                      {lead.storyThread.title}
                    </div>
                  </button>
                </div>
              </div>
            </div>
          </div>

          {/* Live Dossier Summary Preview */}
          <div className="rounded-desk border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#121622] p-5 lg:p-6 shadow-sm space-y-4">
            <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800/80 pb-3">
              <h2 className="text-sm font-bold tracking-tight text-slate-900 dark:text-white">
                Live dossier
              </h2>
              <span className="text-[11px] text-slate-600 dark:text-slate-400 font-mono">
                {lead.dossierDraft.updatedAt}
              </span>
            </div>

            {/* Claim */}
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-slate-700 dark:text-slate-300">
                  Claim
                </span>
                <EvidenceBadge status={lead.dossierDraft.claim.status} />
              </div>
              <p className="text-xs text-slate-600 dark:text-slate-400 leading-relaxed">
                {lead.dossierDraft.claim.text}
              </p>
            </div>

            {/* Evidence Bullets */}
            <div className="space-y-1.5 pt-2 border-t border-slate-100 dark:border-slate-800/80">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-slate-700 dark:text-slate-300">
                  Evidence
                </span>
                <EvidenceBadge status="remembered" />
              </div>
              <ul className="text-xs text-slate-600 dark:text-slate-400 space-y-1 pl-1">
                <li className="flex items-center gap-2">
                  <span className="w-1 h-1 rounded-full bg-slate-400" />
                  <span>Automated failover for job workers (PR #4821)</span>
                </li>
                <li className="flex items-center gap-2">
                  <span className="w-1 h-1 rounded-full bg-slate-400" />
                  <span>Post-incident improvements (project note)</span>
                </li>
                <li className="flex items-center gap-2">
                  <span className="w-1 h-1 rounded-full bg-slate-400" />
                  <span>Positive colleague feedback (Priya Shah)</span>
                </li>
              </ul>
            </div>

            {/* Skills */}
            <div className="space-y-1.5 pt-2 border-t border-slate-100 dark:border-slate-800/80">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-slate-700 dark:text-slate-300">
                  Skills
                </span>
                <EvidenceBadge status={lead.dossierDraft.skills.status} />
              </div>
              <div className="flex flex-wrap gap-1.5">
                {lead.dossierDraft.skills.names.map((skill) => (
                  <span
                    key={skill}
                    className="px-2 py-0.5 rounded-full text-[11px] bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300"
                  >
                    {skill}
                  </span>
                ))}
              </div>
            </div>

            {/* Still Needed */}
            <div className="space-y-1.5 pt-2 border-t border-slate-100 dark:border-slate-800/80">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-slate-700 dark:text-slate-300">
                  Still needed
                </span>
                <EvidenceBadge status="missing_proof" />
              </div>
              <div className="space-y-1.5 pl-1">
                {lead.dossierDraft.stillNeeded.map((item) => (
                  <div key={item} className="flex items-start gap-2 text-xs text-slate-600 dark:text-slate-400">
                    <span className="w-3.5 h-3.5 rounded border border-slate-300 dark:border-slate-700 flex-shrink-0 mt-0.5" />
                    <span>{item}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
