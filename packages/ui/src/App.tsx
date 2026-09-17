import { useEffect, useState } from 'react';
import { Layout, type NavTab } from './components/Layout';
import { ThemeProvider } from './theme/ThemeContext';
import { PrivateBriefing } from './views/desk/PrivateBriefing';
import { StoryThreadsNodeMap } from './views/desk/StoryThreadsNodeMap';
import { EvidenceExplorer } from './views/EvidenceExplorer';
import { RubricGapMatrix } from './views/RubricGapMatrix';
import { ResumeTailor } from './views/ResumeTailor';
import { EvidenceStrengthener } from './views/desk/EvidenceStrengthener';
import { useDeskData } from './hooks/useDeskData';
import { pathForTab, tabForPath, tailoringSlugForPath } from './routing';
import { TailoringRunList } from './views/tailoring/TailoringRunList';
import { TailoringRun } from './views/tailoring/TailoringRun';
import { SettingsView } from './views/settings/SettingsView';

export function App() {
  const [currentTab, setCurrentTab] = useState<NavTab>(() => tabForPath(window.location.pathname));
  const [tailoringSlug, setTailoringSlug] = useState<string | null>(() => tailoringSlugForPath(window.location.pathname));
  const [handoffPosting, setHandoffPosting] = useState<string | undefined>(undefined);
  const [canvasResumeId, setCanvasResumeId] = useState<string | undefined>(undefined);
  const desk = useDeskData();
  const [strengthenId, setStrengthenId] = useState<string | null>(null);

  const navigatePath = (path: string) => {
    if (window.location.pathname !== path) {
      window.history.pushState({}, '', path);
    }
    setCurrentTab(tabForPath(path));
    setTailoringSlug(tailoringSlugForPath(path));
  };

  const navigateTo = (tab: NavTab) => navigatePath(pathForTab(tab));

  useEffect(() => {
    const handlePopState = () => {
      setCurrentTab(tabForPath(window.location.pathname));
      setTailoringSlug(tailoringSlugForPath(window.location.pathname));
    };
    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, []);

  return (
    <ThemeProvider>
      <Layout
        currentTab={currentTab}
        onSelectTab={navigateTo}
      >
        {/* Briefing Workspace */}
        {currentTab === 'briefing' &&
          (strengthenId && desk.model.recordsById.get(strengthenId) ? (
            <EvidenceStrengthener
              key={strengthenId}
              record={desk.model.recordsById.get(strengthenId)!}
              onBack={() => setStrengthenId(null)}
              onSaved={() => desk.refresh()}
            />
          ) : (
            <PrivateBriefing
              loading={desk.loading}
              error={desk.error}
              briefing={desk.briefing}
              runs={desk.runs}
              onStrengthen={setStrengthenId}
              onViewThreads={() => navigateTo('threads')}
              onOpenTailor={() => navigatePath('/tailor')}
              onOpenRun={(slug) => navigatePath(`/tailor/${slug}`)}
              onOpenEvidence={() => navigateTo('evidence')}
              onRetry={desk.refresh}
            />
          ))}

        {/* Skill-driven Tailoring Runs */}
        {currentTab === 'tailor' &&
          (tailoringSlug ? (
            <TailoringRun
              slug={tailoringSlug}
              onBack={() => navigatePath('/tailor')}
              onOpenInCanvas={(resumeId) => {
                setCanvasResumeId(resumeId);
                navigateTo('exports');
              }}
            />
          ) : (
            <TailoringRunList
              onOpenRun={(slug) => navigatePath(`/tailor/${slug}`)}
              onOpenSettings={() => navigateTo('settings')}
              initialPosting={handoffPosting}
              onInitialPostingConsumed={() => setHandoffPosting(undefined)}
            />
          ))}

        {/* Runner Settings */}
        {currentTab === 'settings' && <SettingsView />}

        {/* Story Threads Workspace */}
        {currentTab === 'threads' && (
          <StoryThreadsNodeMap
            sources={desk.model.sources}
            evidence={desk.model.evidence}
            threads={desk.model.threads}
            onSelectLead={() => navigateTo('briefing')}
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

        {/* Exports Workspace (manual resume canvas) */}
        <div className={currentTab === 'exports' ? 'block' : 'hidden'}>
          <ResumeTailor
            preferredResumeId={canvasResumeId}
            onStartTailoringRun={(posting) => {
              setHandoffPosting(posting);
              navigatePath('/tailor');
            }}
          />
        </div>
      </Layout>
    </ThemeProvider>
  );
}

export default App;
