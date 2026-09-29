import React, { useRef } from 'react';
import {
  X,
  Settings,
  ShieldCheck,
  AlertTriangle,
  Folder,
  Compass,
} from 'lucide-react';
import type { DeskTab } from './DeskSidebar';
import type { IntegrityCheckResponse } from '../../api/client';
import { useModalA11y } from '../../hooks/useModalA11y';

interface MobileMoreDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  onSelectTab: (tab: DeskTab) => void;
  onOpenOnboarding: () => void;
  onOpenIntegrityModal: () => void;
  integrityReport: IntegrityCheckResponse | null;
  workspaceDir?: string;
}

export const MobileMoreDrawer: React.FC<MobileMoreDrawerProps> = ({
  isOpen,
  onClose,
  onSelectTab,
  onOpenOnboarding,
  onOpenIntegrityModal,
  integrityReport,
  workspaceDir,
}) => {
  const drawerRef = useRef<HTMLDivElement | null>(null);

  useModalA11y({
    isOpen,
    onClose,
    containerRef: drawerRef,
  });

  if (!isOpen) return null;

  const compactWorkspace = workspaceDir
    ? workspaceDir.split(/[/\\]/).slice(-2).join('/')
    : null;

  return (
    <div
      className="fixed inset-0 z-50 flex flex-col justify-end bg-black/60 backdrop-blur-sm animate-fadeIn"
      onClick={onClose}
    >
      <div
        ref={drawerRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="mobile-more-title"
        className="w-full bg-white dark:bg-[#121622] rounded-t-2xl border-t border-slate-200 dark:border-slate-800 p-5 pb-safe space-y-4 shadow-2xl animate-slideUp"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Drag handle bar */}
        <div className="w-10 h-1 bg-slate-300 dark:bg-slate-700 rounded-full mx-auto" />

        {/* Header */}
        <div className="flex items-center justify-between pb-2 border-b border-slate-100 dark:border-slate-800">
          <div>
            <h2 id="mobile-more-title" className="text-base font-bold text-slate-900 dark:text-white">
              Quick Navigation & Utilities
            </h2>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Workspace actions and local preferences
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close drawer"
            className="p-2 rounded-lg text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Action Items List */}
        <div className="space-y-2">
          {/* Settings Tab */}
          <button
            type="button"
            onClick={() => {
              onSelectTab('settings');
              onClose();
            }}
            className="w-full flex items-center justify-between p-3 rounded-desk border border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-900/50 hover:bg-slate-100 dark:hover:bg-slate-800/80 transition-colors text-left"
          >
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-slate-200/60 dark:bg-slate-800 text-slate-700 dark:text-slate-300">
                <Settings className="w-4 h-4" />
              </div>
              <div>
                <span className="text-sm font-semibold text-slate-900 dark:text-white block">
                  Settings
                </span>
                <span className="text-xs text-slate-500 dark:text-slate-400">
                  Model runners, API keys, and timeouts
                </span>
              </div>
            </div>
          </button>

          {/* Integrity Pre-Flight Audit */}
          <button
            type="button"
            onClick={() => {
              onOpenIntegrityModal();
              onClose();
            }}
            className="w-full flex items-center justify-between p-3 rounded-desk border border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-900/50 hover:bg-slate-100 dark:hover:bg-slate-800/80 transition-colors text-left"
          >
            <div className="flex items-center gap-3">
              <div className={`p-2 rounded-lg ${
                integrityReport?.isClean
                  ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400'
                  : 'bg-rose-500/10 text-rose-600 dark:text-rose-400'
              }`}>
                {integrityReport?.isClean ? (
                  <ShieldCheck className="w-4 h-4" />
                ) : (
                  <AlertTriangle className="w-4 h-4" />
                )}
              </div>
              <div>
                <span className="text-sm font-semibold text-slate-900 dark:text-white block">
                  Integrity Pre-Flight Audit
                </span>
                <span className="text-xs text-slate-500 dark:text-slate-400">
                  {integrityReport?.isClean
                    ? 'All citations and privacy checks clean'
                    : `${integrityReport?.issues.length ?? 0} issues require review`}
                </span>
              </div>
            </div>
          </button>

          {/* Foundation Onboarding */}
          <button
            type="button"
            onClick={() => {
              onOpenOnboarding();
              onClose();
            }}
            className="w-full flex items-center justify-between p-3 rounded-desk border border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-900/50 hover:bg-slate-100 dark:hover:bg-slate-800/80 transition-colors text-left"
          >
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-vermilion-500/10 text-vermilion-600 dark:text-vermilion-400">
                <Compass className="w-4 h-4" />
              </div>
              <div>
                <span className="text-sm font-semibold text-slate-900 dark:text-white block">
                  Foundation Onboarding
                </span>
                <span className="text-xs text-slate-500 dark:text-slate-400">
                  Privacy architecture, git safety, and starter guides
                </span>
              </div>
            </div>
          </button>
        </div>

        {/* Workspace directory chip */}
        {compactWorkspace && (
          <div className="pt-2 flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400 font-mono">
            <Folder className="w-3.5 h-3.5 text-slate-400 shrink-0" />
            <span className="truncate">{compactWorkspace}</span>
          </div>
        )}
      </div>
    </div>
  );
};
