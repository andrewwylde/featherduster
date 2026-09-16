import React from 'react';
import { Search, Sun, Moon, ShieldCheck, AlertTriangle, Folder } from 'lucide-react';
import { useTheme } from '../../theme/ThemeContext';
import type { IntegrityCheckResponse } from '../../api/client';

interface DeskHeaderProps {
  searchQuery: string;
  onSearchChange: (query: string) => void;
  integrityReport: IntegrityCheckResponse | null;
  integrityLoading: boolean;
  onOpenIntegrityModal: () => void;
  workspaceDir?: string;
}

export const DeskHeader: React.FC<DeskHeaderProps> = ({
  searchQuery,
  onSearchChange,
  integrityReport,
  integrityLoading,
  onOpenIntegrityModal,
  workspaceDir,
}) => {
  const { resolvedTheme, toggleTheme } = useTheme();

  const compactWorkspace = workspaceDir
    ? workspaceDir.split(/[/\\]/).slice(-2).join('/')
    : null;

  return (
    <header className="h-16 flex items-center justify-between px-6 border-b border-slate-200 dark:border-slate-800 bg-white dark:bg-[#0c0f17] sticky top-0 z-30">
      {/* Search Bar Input */}
      <div className="flex-1 max-w-xl">
        <div className="relative">
          <Search
            className="w-4 h-4 text-slate-400 dark:text-slate-500 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none"
            aria-hidden="true"
          />
          <input
            type="text"
            aria-label="Search across your work, notes, and people"
            value={searchQuery}
            onChange={(e) => onSearchChange(e.target.value)}
            placeholder="Search across your work, notes, and people..."
            className="w-full pl-10 pr-4 py-2 text-sm rounded-desk bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 text-slate-900 dark:text-slate-100 placeholder:text-slate-500 dark:placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-vermilion-500 focus:border-vermilion-500 transition-colors"
          />
        </div>
      </div>

      {/* Right cluster: Editorial slogan, Workspace, Integrity audit, and Theme Toggle */}
      <div className="flex items-center gap-4 ml-4">
        <span className="hidden md:inline text-xs text-slate-600 dark:text-slate-400 italic">
          Your work tells a bigger story.
        </span>

        {compactWorkspace && (
          <div
            className="hidden lg:flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-slate-100 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 text-xs text-slate-600 dark:text-slate-400"
            title={workspaceDir}
          >
            <Folder className="w-3.5 h-3.5 text-slate-400" />
            <span className="font-mono text-[11px] truncate max-w-[180px]">
              {compactWorkspace}
            </span>
          </div>
        )}

        {/* Integrity status pill */}
        <button
          onClick={onOpenIntegrityModal}
          className={`hidden sm:flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium border transition-colors focus-visible:ring-2 focus-visible:ring-vermilion-500 focus-visible:outline-none ${
            integrityReport?.isClean
              ? 'border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-800/40 dark:bg-emerald-950/20 dark:text-emerald-300 hover:bg-emerald-100/60 dark:hover:bg-emerald-950/40'
              : integrityReport
              ? 'border-rose-200 bg-rose-50 text-rose-800 dark:border-rose-900/40 dark:bg-rose-950/20 dark:text-rose-300 hover:bg-rose-100/60 dark:hover:bg-rose-950/40'
              : 'border-slate-200 bg-slate-50 text-slate-600 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800'
          }`}
          title="Integrity & Privacy Pre-Flight Audit"
        >
          {integrityReport?.isClean ? (
            <ShieldCheck className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" />
          ) : (
            <AlertTriangle className="w-3.5 h-3.5 text-rose-500 dark:text-rose-400" />
          )}
          <span>
            {integrityLoading
              ? 'Auditing...'
              : integrityReport?.isClean
              ? 'Integrity: Clean'
              : `${integrityReport?.issues.length ?? 0} Issues`}
          </span>
        </button>

        {/* Theme Toggle Button */}
        <button
          onClick={toggleTheme}
          aria-label="Toggle theme"
          title={`Switch to ${resolvedTheme === 'dark' ? 'light' : 'dark'} mode`}
          className="p-2 rounded-desk border border-slate-200 dark:border-slate-800 bg-slate-50 hover:bg-slate-100 dark:bg-slate-900 dark:hover:bg-slate-800 text-slate-600 dark:text-slate-300 focus-visible:ring-2 focus-visible:ring-vermilion-500 focus-visible:outline-none transition-colors"
        >
          {resolvedTheme === 'dark' ? (
            <Sun className="w-4 h-4 text-amber-400" />
          ) : (
            <Moon className="w-4 h-4 text-slate-600" />
          )}
        </button>
      </div>
    </header>
  );
};
