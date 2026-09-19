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
import {
  CANVAS_PATH,
  pathForTab,
  redirectForPath,
  tabForPath,
  tailorViewForPath,
  type TailorView,
} from './routing';
import { TailoringRunList } from './views/tailoring/TailoringRunList';
import { TailoringRun } from './views/tailoring/TailoringRun';
import { SettingsView } from './views/settings/SettingsView';

/** Rewrites a legacy URL in place so the address bar matches the merged routes. */
function canonicalPath(pathname: string): string {
  const redirect = redirectForPath(pathname);
  if (redirect) {
    window.history.replaceState({}, '', redirect);
    return redirect;
  }
  return pathname;
}

export function App() {
  const [currentTab, setCurrentTab] = useState<NavTab>(() => tabForPath(canonicalPath(window.location.pathname)));
  const [tailorView, setTailorView] = useState<TailorView>(() => tailorViewForPath(window.location.pathname));
  const [handoffPosting, setHandoffPosting] = useState<string | undefined>(undefined);
  const [canvasResumeId, setCanvasResumeId] = useState<string | undefined>(undefined);
  const desk = useDeskData();
  const [strengthenId, setStrengthenId] = useState<string | null>(null);

  const navigatePath = (path: string) => {
    if (window.location.pathname !== path) {
      window.history.pushState({}, '', path);
    }
    setCurrentTab(tabForPath(path));
    setTailorView(tailorViewForPath(path));
  };

  const navigateTo = (tab: NavTab) => navigatePath(pathForTab(tab));

  useEffect(() => {
    const handlePopState = () => {
      const path = canonicalPath(window.location.pathname);
      setCurrentTab(tabForPath(path));
      setTailorView(tailorViewForPath(path));
    };
    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, []);

  // The canvas holds unsaved editor state, so it stays mounted across tab changes.
  const isCanvasVisible = currentTab === 'tailor' && tailorView.mode === 'canvas';

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

        {/* Tailor Workspace: run list, run detail, and the manual canvas */}
        {currentTab === 'tailor' && tailorView.mode === 'run' && (
          <TailoringRun
            slug={tailorView.slug}
            onBack={() => navigatePath('/tailor')}
            onOpenInCanvas={(resumeId) => {
              setCanvasResumeId(resumeId);
              navigatePath(CANVAS_PATH);
            }}
          />
        )}

        {currentTab === 'tailor' && tailorView.mode === 'list' && (
          <TailoringRunList
            onOpenRun={(slug) => navigatePath(`/tailor/${slug}`)}
            onOpenSettings={() => navigateTo('settings')}
            onOpenCanvas={() => navigatePath(CANVAS_PATH)}
            initialPosting={handoffPosting}
            onInitialPostingConsumed={() => setHandoffPosting(undefined)}
          />
        )}

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
        <div className={currentTab === 'skills' ? 'block' : 'hidden'}>
          <RubricGapMatrix />
        </div>

        {/* Manual resume canvas (a mode of the tailor tab) */}
        <div className={isCanvasVisible ? 'block' : 'hidden'}>
          <ResumeTailor
            preferredResumeId={canvasResumeId}
            onBackToRuns={() => navigatePath('/tailor')}
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
