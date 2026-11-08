import React, { useState, useEffect } from 'react';
import { apiClient, type IntegrityCheckResponse } from '../api/client';
import { useLiveSync } from '../hooks/useLiveSync';
import { IntegrityModal } from './IntegrityModal';
import { DeskSidebar, type DeskTab } from './desk/DeskSidebar';
import { DeskHeader, type WorkspaceAuditState } from './desk/DeskHeader';
import { OnboardingModal } from './desk/OnboardingModal';
import { MobileBottomNav } from './desk/MobileBottomNav';
import { MobileMoreDrawer } from './desk/MobileMoreDrawer';

export type NavTab = 'briefing' | 'threads' | 'evidence' | 'skills' | 'tailor' | 'settings' | 'jobs';

interface LayoutProps {
  currentTab: NavTab;
  onSelectTab: (tab: NavTab) => void;
  children: React.ReactNode;
}

export const Layout: React.FC<LayoutProps> = ({ currentTab, onSelectTab, children }) => {
  const [workspaceDir, setWorkspaceDir] = useState<string>('');
  const [integrityReport, setIntegrityReport] = useState<IntegrityCheckResponse | null>(null);
  const [integrityLoading, setIntegrityLoading] = useState(false);
  const [auditState, setAuditState] = useState<WorkspaceAuditState>({
    status: 'checking',
  });
  const [isIntegrityModalOpen, setIsIntegrityModalOpen] = useState(false);
  const [isOnboardingModalOpen, setIsOnboardingModalOpen] = useState(false);
  const [isMoreDrawerOpen, setIsMoreDrawerOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');

  const inFlightRef = React.useRef<AbortController | null>(null);
  const isFetchingRef = React.useRef(false);
  const pendingRefreshRef = React.useRef(false);

  const fetchWorkspaceAndIntegrity = async () => {
    if (isFetchingRef.current) {
      pendingRefreshRef.current = true;
      return;
    }
    isFetchingRef.current = true;
    pendingRefreshRef.current = false;

    if (inFlightRef.current) {
      inFlightRef.current.abort();
    }
    const controller = new AbortController();
    inFlightRef.current = controller;

    try {
      try {
        const health = await apiClient.getHealth();
        if (!controller.signal.aborted) {
          setWorkspaceDir(health.workspaceDir);
        }
      } catch {
        // Ignore health fetch error
      }

      try {
        setIntegrityLoading(true);
        setAuditState((prev) => ({
          ...prev,
          status: 'checking',
          error: undefined,
        }));
        const integrity = await apiClient.getIntegrityCheck();
        if (!controller.signal.aborted) {
          setIntegrityReport(integrity);
          setAuditState({
            status: 'ready',
            issuesCount: integrity?.issues?.length ?? 0,
            lastChecked: new Date().toISOString(),
          });
        }
      } catch (err: unknown) {
        if (!controller.signal.aborted) {
          const message = err instanceof Error ? err.message : 'Integrity check timed out';
          setAuditState((prev) => ({
            status: 'error',
            error: message,
            issuesCount: prev.issuesCount,
            lastChecked: prev.lastChecked,
          }));
        }
      } finally {
        if (!controller.signal.aborted) {
          setIntegrityLoading(false);
        }
      }
    } finally {
      if (inFlightRef.current === controller) {
        inFlightRef.current = null;
      }
      isFetchingRef.current = false;
      if (pendingRefreshRef.current) {
        pendingRefreshRef.current = false;
        void fetchWorkspaceAndIntegrity();
      }
    }
  };

  useLiveSync(() => {
    fetchWorkspaceAndIntegrity();
  }, 'workspace_integrity');

  useEffect(() => {
    fetchWorkspaceAndIntegrity();
    return () => {
      if (inFlightRef.current) {
        inFlightRef.current.abort();
      }
    };
  }, []);

  const handleSelectDeskTab = (tab: DeskTab) => {
    onSelectTab(tab);
  };

  return (
    <div className="min-h-screen min-h-[100dvh] bg-[#fbfbfb] dark:bg-[#0c0f17] flex flex-col md:flex-row text-slate-900 dark:text-slate-100 transition-colors duration-150">
      {/* Left Desk Navigation Column (desktop) */}
      <DeskSidebar
        currentTab={currentTab}
        onSelectTab={handleSelectDeskTab}
        onOpenOnboarding={() => setIsOnboardingModalOpen(true)}
      />

      {/* Main Workspace Column */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Desk Header */}
        <DeskHeader
          searchQuery={searchQuery}
          onSearchChange={setSearchQuery}
          integrityReport={integrityReport}
          integrityLoading={integrityLoading}
          workspaceAudit={auditState}
          auditState={auditState}
          onRetryAudit={fetchWorkspaceAndIntegrity}
          onOpenIntegrityModal={() => setIsIntegrityModalOpen(true)}
          workspaceDir={workspaceDir}
        />

        {/* Content Area */}
        <main className="flex-1 overflow-y-auto px-4 py-4 sm:px-6 sm:py-8 pb-[calc(6rem+env(safe-area-inset-bottom,0px))] md:pb-8">
          <div className="max-w-7xl mx-auto w-full">{children}</div>
        </main>
      </div>

      {/* Mobile Bottom Navigation Bar */}
      <MobileBottomNav
        currentTab={currentTab}
        onSelectTab={handleSelectDeskTab}
        onOpenMore={() => setIsMoreDrawerOpen(true)}
        isMoreOpen={isMoreDrawerOpen}
      />

      {/* Mobile More Actions Bottom Sheet Drawer */}
      <MobileMoreDrawer
        isOpen={isMoreDrawerOpen}
        onClose={() => setIsMoreDrawerOpen(false)}
        onSelectTab={handleSelectDeskTab}
        onOpenOnboarding={() => setIsOnboardingModalOpen(true)}
        onOpenIntegrityModal={() => setIsIntegrityModalOpen(true)}
        integrityReport={integrityReport}
        auditState={auditState}
        workspaceDir={workspaceDir}
      />

      {/* Integrity Audit Modal */}
      <IntegrityModal
        isOpen={isIntegrityModalOpen}
        onClose={() => setIsIntegrityModalOpen(false)}
        report={integrityReport}
        loading={integrityLoading}
        auditState={auditState}
        onRefresh={fetchWorkspaceAndIntegrity}
      />

      {/* Onboarding Foundation Modal */}
      <OnboardingModal
        isOpen={isOnboardingModalOpen}
        onClose={() => setIsOnboardingModalOpen(false)}
        onSelectPath={(path) => {
          if (path === 'interview') {
            onSelectTab('briefing');
          } else if (path === 'sources') {
            onSelectTab('threads');
          } else if (path === 'import') {
            onSelectTab('evidence');
          }
        }}
      />
    </div>
  );
};
