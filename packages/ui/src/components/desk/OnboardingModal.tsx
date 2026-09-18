import React, { useRef } from 'react';
import { ShieldCheck, GitBranch, FileText, Compass, X } from 'lucide-react';
import { useModalA11y } from '../../hooks/useModalA11y';

interface OnboardingModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSelectPath?: (path: 'sources' | 'import' | 'interview') => void;
}

export const OnboardingModal: React.FC<OnboardingModalProps> = ({
  isOpen,
  onClose,
  onSelectPath,
}) => {
  const modalRef = useRef<HTMLDivElement>(null);
  useModalA11y({ isOpen, onClose, containerRef: modalRef });

  if (!isOpen) return null;

  const handleChoose = (path: 'sources' | 'import' | 'interview') => {
    try {
      localStorage.setItem('featherduster_onboarding_dismissed', 'true');
    } catch {
      // Storage unavailable
    }
    if (onSelectPath) onSelectPath(path);
    onClose();
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 backdrop-blur-sm p-4 animate-in fade-in duration-150"
      onClick={onClose}
    >
      <div
        ref={modalRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="onboarding-title"
        onClick={(e) => e.stopPropagation()}
        tabIndex={-1}
        className="w-full max-w-xl bg-white dark:bg-[#121622] rounded-desk border border-slate-200 dark:border-slate-800 shadow-2xl overflow-hidden focus:outline-none"
      >
        {/* Header */}
        <div className="flex items-start justify-between p-6 border-b border-slate-100 dark:border-slate-800/80">
          <div>
            <span className="text-[11px] font-mono uppercase tracking-widest text-vermilion-600 dark:text-vermilion-400 font-semibold">
              Career foundations
            </span>
            <h2
              id="onboarding-title"
              className="text-xl font-bold tracking-tight text-slate-900 dark:text-white mt-1"
            >
              Career Intelligence Desk
            </h2>
          </div>
          <button
            onClick={onClose}
            aria-label="Close"
            className="p-1.5 rounded-lg text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 focus-visible:ring-2 focus-visible:ring-vermilion-500 focus-visible:outline-none transition-colors"
          >
            <X className="w-5 h-5" aria-hidden="true" />
          </button>
        </div>

        {/* Content */}
        <div className="p-6 space-y-6">
          {/* Privacy Foundation Box */}
          <div className="p-4 rounded-desk bg-slate-50 dark:bg-slate-900/80 border border-slate-200 dark:border-slate-800 flex gap-3.5">
            <ShieldCheck className="w-5 h-5 text-emerald-600 dark:text-emerald-400 flex-shrink-0 mt-0.5" />
            <div>
              <h3 className="text-xs font-semibold text-slate-900 dark:text-slate-100">
                Local-first privacy foundation
              </h3>
              <p className="mt-1 text-xs text-slate-600 dark:text-slate-400 leading-relaxed">
                All evidence cards, rubrics, and story threads live strictly on your local disk in
                plain text Markdown and YAML (127.0.0.1). No external telemetry. No hidden database lock-in.
              </p>
            </div>
          </div>

          {/* Choose Starting Path */}
          <div>
            <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-600 dark:text-slate-400 mb-3">
              Choose your starting point
            </h3>
            <div className="grid grid-cols-1 gap-2.5">
              <button
                onClick={() => handleChoose('interview')}
                className="flex items-start gap-3.5 p-3.5 rounded-desk border border-slate-200 dark:border-slate-800 hover:border-vermilion-500/50 dark:hover:border-vermilion-500/50 hover:bg-vermilion-50/20 dark:hover:bg-vermilion-950/10 text-left transition-all group focus-visible:ring-2 focus-visible:ring-vermilion-500 focus-visible:outline-none"
              >
                <div className="p-2 rounded-lg bg-vermilion-50 dark:bg-vermilion-950/40 text-vermilion-600 dark:text-vermilion-400 group-hover:scale-105 transition-transform">
                  <Compass className="w-4 h-4" />
                </div>
                <div>
                  <span className="text-sm font-semibold text-slate-900 dark:text-white">
                    Describe your current role
                  </span>
                  <p className="text-xs text-slate-600 dark:text-slate-400 mt-0.5">
                    Walk through a focused 5-minute conversation with The Editor to extract fresh evidence.
                  </p>
                </div>
              </button>

              <button
                onClick={() => handleChoose('sources')}
                className="flex items-start gap-3.5 p-3.5 rounded-desk border border-slate-200 dark:border-slate-800 hover:border-slate-300 dark:hover:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-900/50 text-left transition-all group focus-visible:ring-2 focus-visible:ring-vermilion-500 focus-visible:outline-none"
              >
                <div className="p-2 rounded-lg bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 group-hover:scale-105 transition-transform">
                  <GitBranch className="w-4 h-4" />
                </div>
                <div>
                  <span className="text-sm font-semibold text-slate-900 dark:text-white">
                    Connect work sources
                  </span>
                  <p className="text-xs text-slate-600 dark:text-slate-400 mt-0.5">
                    Link local git repositories, pull requests, and notes to feed The Editor's signal inbox.
                  </p>
                </div>
              </button>

              <button
                onClick={() => handleChoose('import')}
                className="flex items-start gap-3.5 p-3.5 rounded-desk border border-slate-200 dark:border-slate-800 hover:border-slate-300 dark:hover:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-900/50 text-left transition-all group focus-visible:ring-2 focus-visible:ring-vermilion-500 focus-visible:outline-none"
              >
                <div className="p-2 rounded-lg bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 group-hover:scale-105 transition-transform">
                  <FileText className="w-4 h-4" />
                </div>
                <div>
                  <span className="text-sm font-semibold text-slate-900 dark:text-white">
                    Import existing career history
                  </span>
                  <p className="text-xs text-slate-600 dark:text-slate-400 mt-0.5">
                    Import existing resumes, Markdown brag docs, or company IC leveling rubrics.
                  </p>
                </div>
              </button>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="p-4 bg-slate-50 dark:bg-slate-900/60 border-t border-slate-100 dark:border-slate-800/80 flex justify-end">
          <button
            onClick={() => handleChoose('interview')}
            className="px-4 py-2 rounded-desk bg-vermilion-500 hover:bg-vermilion-600 text-white text-xs font-semibold shadow-sm transition-colors focus-visible:ring-2 focus-visible:ring-vermilion-500 focus-visible:outline-none"
          >
            Enter Career Desk
          </button>
        </div>
      </div>
    </div>
  );
};
