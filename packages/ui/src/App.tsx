import { useState } from 'react';
import { Layout, type NavTab } from './components/Layout';
import { ThemeProvider } from './theme/ThemeContext';
import { PrivateBriefing } from './views/desk/PrivateBriefing';
import { FocusedInterview } from './views/desk/FocusedInterview';
import { StoryThreadsNodeMap } from './views/desk/StoryThreadsNodeMap';
import { EvidenceExplorer } from './views/EvidenceExplorer';
import { RubricGapMatrix } from './views/RubricGapMatrix';
import { ResumeTailor } from './views/ResumeTailor';
import {
  initialLead,
  initialSources,
  initialNodeMapEvidence,
  initialStoryThreads,
} from './data/deskFixtures';
import type { StoryThread, NodeMapEvidence } from './types/desk';

export function App() {
  const [currentTab, setCurrentTab] = useState<NavTab>('briefing');
  const [isInterviewActive, setIsInterviewActive] = useState(false);
  const [threads, setThreads] = useState<StoryThread[]>(initialStoryThreads);
  const [evidenceList, setEvidenceList] = useState<NodeMapEvidence[]>(initialNodeMapEvidence);

  const handleEvidenceCaptured = (evidenceId: string) => {
    // Add captured evidence to node map
    setEvidenceList((prev) => [
      ...prev,
      {
        id: evidenceId,
        title: 'Automated failover & alert reduction',
        status: 'verified',
        sourceIds: ['src-pr-4821', 'src-datadog-wa-au-018'],
      },
    ]);

    // Visibly strengthen the story thread
    setThreads((prev) =>
      prev.map((t) =>
        t.id === 'thread-reliability'
          ? {
              ...t,
              status: 'strengthened',
              evidenceIds: [...t.evidenceIds, evidenceId],
            }
          : t
      )
    );
  };

  const handleViewThread = (_threadId?: string) => {
    setCurrentTab('threads');
  };

  return (
    <ThemeProvider>
      <Layout
        currentTab={currentTab}
        onSelectTab={(tab) => {
          setCurrentTab(tab);
        }}
      >
        {/* Briefing Workspace (Private Briefing & Focused Interview) */}
        {currentTab === 'briefing' && (
          <div>
            {isInterviewActive ? (
              <FocusedInterview
                lead={initialLead}
                onBackToBriefing={() => setIsInterviewActive(false)}
                onViewThread={handleViewThread}
                onEvidenceCaptured={handleEvidenceCaptured}
              />
            ) : (
              <PrivateBriefing
                lead={initialLead}
                onOpenInterview={() => setIsInterviewActive(true)}
                onViewThread={handleViewThread}
              />
            )}
          </div>
        )}

        {/* Story Threads Workspace */}
        {currentTab === 'threads' && (
          <StoryThreadsNodeMap
            sources={initialSources}
            evidence={evidenceList}
            threads={threads}
            onSelectLead={() => {
              setCurrentTab('briefing');
              setIsInterviewActive(true);
            }}
          />
        )}

        {/* Evidence Explorer Workspace */}
        <div className={currentTab === 'evidence' ? 'block' : 'hidden'}>
          <EvidenceExplorer />
        </div>

        {/* Skills & Rubric Gaps Workspace */}
        <div className={currentTab === 'skills' || currentTab === 'rubrics' ? 'block' : 'hidden'}>
          <RubricGapMatrix />
        </div>

        {/* Tailor & Exports Workspace */}
        <div className={currentTab === 'exports' || currentTab === 'tailor' ? 'block' : 'hidden'}>
          <ResumeTailor />
        </div>
      </Layout>
    </ThemeProvider>
  );
}

export default App;
