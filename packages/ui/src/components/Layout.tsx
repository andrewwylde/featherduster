import React, { useState, useEffect } from 'react';
import {
  FileText,
  Target,
  FileCheck,
  ShieldCheck,
  AlertTriangle,
  Folder,
  Sparkles,
} from 'lucide-react';
import { apiClient, type IntegrityCheckResponse } from '../api/client';
import { useLiveSync } from '../hooks/useLiveSync';
import { IntegrityModal } from './IntegrityModal';

export type NavTab = 'evidence' | 'rubrics' | 'tailor';

interface LayoutProps {
  currentTab: NavTab;
  onSelectTab: (tab: NavTab) => void;
  children: React.ReactNode;
}

export const Layout: React.FC<LayoutProps> = ({ currentTab, onSelectTab, children }) => {
  const [workspaceDir, setWorkspaceDir] = useState<string>('');
  const [integrityReport, setIntegrityReport] = useState<IntegrityCheckResponse | null>(null);
  const [integrityLoading, setIntegrityLoading] = useState(false);
  const [isIntegrityModalOpen, setIsIntegrityModalOpen] = useState(false);

  const fetchWorkspaceAndIntegrity = async () => {
    try {
      const health = await apiClient.getHealth();
      setWorkspaceDir(health.workspaceDir);
    } catch {
      // Ignore health fetch error
    }

    try {
      setIntegrityLoading(true);
      const integrity = await apiClient.getIntegrityCheck();
      setIntegrityReport(integrity);
    } catch {
      // Ignore integrity fetch error
    } finally {
      setIntegrityLoading(false);
    }
  };

  const { isConnected } = useLiveSync(() => {
    // Re-check integrity on disk changes
    fetchWorkspaceAndIntegrity();
  });

  useEffect(() => {
    fetchWorkspaceAndIntegrity();
  }, []);

  const navItems = [
    { id: 'evidence' as NavTab, label: 'Evidence Explorer', icon: FileText },
    { id: 'rubrics' as NavTab, label: 'Rubric Gaps', icon: Target },
    { id: 'tailor' as NavTab, label: 'Resume Tailor', icon: Sparkles },
  ];

  const compactWorkspace = workspaceDir
    ? workspaceDir.split(/[/\\]/).slice(-2).join('/')
    : 'Local Workspace';

  return (
    <div className="min-h-screen bg-slate-950 flex flex-col text-slate-100">
      {/* Top Navbar */}
      <header className="sticky top-0 z-40 bg-slate-950/80 backdrop-blur-md border-b border-slate-800/80">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between h-16">
            {/* Left: Brand & Badges */}
            <div className="flex items-center space-x-4">
              <div className="flex items-center space-x-2.5">
                <div className="w-9 h-9 rounded-xl bg-gradient-to-tr from-emerald-600 to-teal-400 p-0.5 shadow-lg shadow-emerald-950/50 flex items-center justify-center">
                  <div className="w-full h-full bg-slate-950 rounded-[10px] flex items-center justify-center">
                    <FileCheck className="w-5 h-5 text-emerald-400" />
                  </div>
                </div>
                <div>
                  <span className="text-base font-bold tracking-tight text-white flex items-center gap-1.5">
                    Featherduster
                    <span className="text-[10px] uppercase font-mono px-1.5 py-0.5 rounded bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                      v0.1
                    </span>
                  </span>
                  <span className="text-xs text-slate-400 hidden sm:block">
                    Local-First Career Intelligence
                  </span>
                </div>
              </div>

              {/* Local & Private Badge */}
              <div
                className="hidden md:flex items-center space-x-2 px-2.5 py-1 rounded-full bg-slate-900 border border-slate-800 text-xs font-medium text-slate-300"
                title="Strictly bound to 127.0.0.1. No external cloud calls."
              >
                <span className="relative flex h-2 w-2">
                  <span className={`animate-ping absolute inline-flex h-full w-full rounded-full opacity-75 ${isConnected ? 'bg-emerald-400' : 'bg-amber-400'}`}></span>
                  <span className={`relative inline-flex rounded-full h-2 w-2 ${isConnected ? 'bg-emerald-500' : 'bg-amber-500'}`}></span>
                </span>
                <span className="font-mono text-[11px]">Local & Private (127.0.0.1)</span>
              </div>

              {/* Workspace Indicator */}
              {workspaceDir && (
                <div
                  className="hidden lg:flex items-center space-x-1.5 px-2.5 py-1 rounded-full bg-slate-900/60 border border-slate-800 text-xs text-slate-400"
                  title={workspaceDir}
                >
                  <Folder className="w-3.5 h-3.5 text-slate-500" />
                  <span className="font-mono truncate max-w-[200px]">{compactWorkspace}</span>
                </div>
              )}
            </div>

            {/* Right: Navigation tabs & Integrity Button */}
            <div className="flex items-center space-x-1 sm:space-x-3">
              {/* Navigation Tabs */}
              <nav className="flex space-x-1 bg-slate-900/70 p-1 rounded-xl border border-slate-800/80">
                {navItems.map((item) => {
                  const Icon = item.icon;
                  const isActive = currentTab === item.id;
                  return (
                    <button
                      key={item.id}
                      onClick={() => onSelectTab(item.id)}
                      className={`flex items-center space-x-2 px-3 py-1.5 rounded-lg text-xs sm:text-sm font-medium transition-all ${
                        isActive
                          ? 'bg-emerald-500 text-slate-950 shadow-md shadow-emerald-500/20 font-semibold'
                          : 'text-slate-300 hover:text-white hover:bg-slate-800/60'
                      }`}
                    >
                      <Icon className={`w-4 h-4 ${isActive ? 'text-slate-950' : 'text-slate-400'}`} />
                      <span>{item.label}</span>
                    </button>
                  );
                })}
              </nav>

              {/* Integrity Audit Pill */}
              <button
                onClick={() => setIsIntegrityModalOpen(true)}
                className={`flex items-center space-x-1.5 px-3 py-1.5 rounded-xl border text-xs font-medium transition-colors ${
                  integrityReport?.isClean
                    ? 'border-emerald-500/30 bg-emerald-950/20 text-emerald-300 hover:bg-emerald-950/40'
                    : integrityReport
                    ? 'border-rose-500/30 bg-rose-950/20 text-rose-300 hover:bg-rose-950/40'
                    : 'border-slate-800 bg-slate-900 text-slate-400 hover:bg-slate-800'
                }`}
                title="Integrity & Privacy Audit"
              >
                {integrityReport?.isClean ? (
                  <ShieldCheck className="w-4 h-4 text-emerald-400" />
                ) : (
                  <AlertTriangle className="w-4 h-4 text-rose-400" />
                )}
                <span className="hidden sm:inline">Integrity Audit:</span>
                <span className="font-semibold">
                  {integrityLoading
                    ? 'Checking...'
                    : integrityReport?.isClean
                    ? 'Pass'
                    : `${integrityReport?.issues.length ?? 0} Fail`}
                </span>
              </button>
            </div>
          </div>
        </div>
      </header>

      {/* Main Content Area */}
      <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-6">
        {children}
      </main>

      {/* Integrity Audit Modal */}
      <IntegrityModal
        isOpen={isIntegrityModalOpen}
        onClose={() => setIsIntegrityModalOpen(false)}
        report={integrityReport}
        loading={integrityLoading}
        onRefresh={fetchWorkspaceAndIntegrity}
      />
    </div>
  );
};
