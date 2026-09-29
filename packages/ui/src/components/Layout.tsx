import React, { useState, useEffect } from 'react';
import { apiClient, type IntegrityCheckResponse } from '../api/client';
import { useLiveSync } from '../hooks/useLiveSync';
import { IntegrityModal } from './IntegrityModal';
import { DeskSidebar, type DeskTab } from './desk/DeskSidebar';
import { DeskHeader } from './desk/DeskHeader';
import { OnboardingModal } from './desk/OnboardingModal';
import { MobileBottomNav } from './desk/MobileBottomNav';
import { MobileMoreDrawer } from './desk/MobileMoreDrawer';

export type NavTab = 'briefing' | 'threads' | 'evidence' | 'skills' | 'tailor' | 'settings';

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
  const [isOnboardingModalOpen, setIsOnboardingModalOpen] = useState(false);
  const [isMoreDrawerOpen, setIsMoreDrawerOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');

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

  useLiveSync(() => {
    fetchWorkspaceAndIntegrity();
  });

  useEffect(() => {
    fetchWorkspaceAndIntegrity();
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
          onOpenIntegrityModal={() => setIsIntegrityModalOpen(true)}
          workspaceDir={workspaceDir}
        />

        {/* Content Area */}
        <main className="flex-1 overflow-y-auto px-4 py-4 sm:px-6 sm:py-8 pb-20 md:pb-8">
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
        workspaceDir={workspaceDir}
      />

      {/* Integrity Audit Modal */}
      <IntegrityModal
        isOpen={isIntegrityModalOpen}
        onClose={() => setIsIntegrityModalOpen(false)}
        report={integrityReport}
        loading={integrityLoading}
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
