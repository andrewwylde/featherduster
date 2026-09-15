import { useState } from 'react';
import { Layout, type NavTab } from './components/Layout';
import { EvidenceExplorer } from './views/EvidenceExplorer';
import { RubricGapMatrix } from './views/RubricGapMatrix';
import { ResumeTailorPlaceholder } from './views/ResumeTailorPlaceholder';

export function App() {
  const [currentTab, setCurrentTab] = useState<NavTab>('evidence');

  return (
    <Layout currentTab={currentTab} onSelectTab={setCurrentTab}>
      {currentTab === 'evidence' && <EvidenceExplorer />}
      {currentTab === 'rubrics' && <RubricGapMatrix />}
      {currentTab === 'tailor' && <ResumeTailorPlaceholder />}
    </Layout>
  );
}

export default App;
