import { useEffect, useRef, useState } from 'react';
import { Layout, type NavTab } from './components/Layout';
import { ThemeProvider } from './theme/ThemeContext';
import { PrivateBriefing } from './views/desk/PrivateBriefing';
import { StoryThreadsNodeMap } from './views/desk/StoryThreadsNodeMap';
import { EvidenceExplorer } from './views/EvidenceExplorer';
import { RubricGapMatrix } from './views/RubricGapMatrix';
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
import { TailoringDraftRoute } from './views/tailoring/TailoringDraftRoute';
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
  const [currentTab, setCurrentTab] = useState<NavTab>(() => tabForPath(canonicalPath(window.location.pathname + window.location.search)));
  const [tailorView, setTailorView] = useState<TailorView>(() => tailorViewForPath(window.location.pathname + window.location.search));
  const [canvasResumeId, setCanvasResumeId] = useState<string | undefined>(undefined);
  const desk = useDeskData();
  const [strengthenId, setStrengthenId] = useState<string | null>(null);

  const [tailorListVisit, setTailorListVisit] = useState(0);
  const navigationGuard = useRef<() => boolean>(() => true);
  const [navigationError, setNavigationError] = useState<string | null>(null);
  const currentPath = useRef(window.location.pathname + window.location.search);
  const navigatePath = (path: string, replace = false) => {
    if (!replace && !navigationGuard.current()) { setNavigationError('Changes are not saved yet. Retry saving before leaving this draft.'); return; }
    setNavigationError(null);
    if (window.location.pathname + window.location.search !== path) {
      window.history[replace ? 'replaceState' : 'pushState']({}, '', path);
    }
    if (path === '/tailor') setTailorListVisit(visit => visit + 1);
    currentPath.current = path;
    setCurrentTab(tabForPath(path));
    setTailorView(tailorViewForPath(path));
  };

  const navigateTo = (tab: NavTab) => navigatePath(pathForTab(tab));

  useEffect(() => {
    const handlePopState = () => {
      if (!navigationGuard.current()) { window.history.pushState({}, '', currentPath.current); setNavigationError('Changes are not saved yet. Retry saving before leaving this draft.'); return; }
      setNavigationError(null);
      const path = canonicalPath(window.location.pathname + window.location.search);
      if (path === '/tailor') setTailorListVisit(visit => visit + 1);
      currentPath.current = path;
      setCurrentTab(tabForPath(path));
      setTailorView(tailorViewForPath(path));
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
        {navigationError && <p role="alert">{navigationError}</p>}
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
            registerGuard={(guard) => { navigationGuard.current = guard; }}
            slug={tailorView.slug}
            selectedStep={tailorView.step}
            onBack={() => navigatePath('/tailor')}
            onOpenDraft={id => navigatePath(`/tailor/drafts/${id}`)}
            onOpenInCanvas={(resumeId) => {
              setCanvasResumeId(resumeId);
              navigatePath(CANVAS_PATH);
            }}
          />
        )}

        {currentTab === 'tailor' && (tailorView.mode === 'list' || tailorView.mode === 'draft' || tailorView.mode === 'canvas') && (
          <TailoringDraftRoute
            key={tailorListVisit}
            canvas={tailorView.mode === 'canvas'}
            preferredResumeId={canvasResumeId}
            draftId={tailorView.mode === 'draft' ? tailorView.draftId : undefined}
            navigate={navigatePath}
            registerGuard={(guard) => { navigationGuard.current = guard; }}
            onOpenSettings={() => navigateTo('settings')}
            onOpenCanvas={() => navigatePath(CANVAS_PATH)}
          />
        )}

        {currentTab === 'tailor' && tailorView.mode === 'unavailable' && <div><h1>Draft unavailable</h1><button onClick={() => navigatePath('/tailor')}>Back to tailoring</button></div>}

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

      </Layout>
    </ThemeProvider>
  );
}

export default App;
