import React, { useState, useEffect } from 'react';
import { apiClient, type IntegrityCheckResponse } from '../api/client';
import { useLiveSync } from '../hooks/useLiveSync';
import { IntegrityModal } from './IntegrityModal';
import { DeskSidebar, type DeskTab } from './desk/DeskSidebar';
import { DeskHeader } from './desk/DeskHeader';
import { OnboardingModal } from './desk/OnboardingModal';

export type NavTab = 'briefing' | 'threads' | 'evidence' | 'skills' | 'exports' | 'rubrics' | 'tailor';

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

  // Map legacy tabs to desk tabs for sidebar selection
  const mappedDeskTab: DeskTab = currentTab === 'rubrics' ? 'skills' : (currentTab as DeskTab);

  const handleSelectDeskTab = (tab: DeskTab) => {
    onSelectTab(tab);
  };

  return (
    <div className="min-h-screen bg-[#fbfbfb] dark:bg-[#0c0f17] flex text-slate-900 dark:text-slate-100 transition-colors duration-150">
      {/* Left Desk Navigation Column */}
      <DeskSidebar
        currentTab={mappedDeskTab}
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
        <main className="flex-1 overflow-y-auto px-6 py-8">
          <div className="max-w-7xl mx-auto w-full">{children}</div>
        </main>
      </div>

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
