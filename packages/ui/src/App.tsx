import { useState } from 'react';
import { Layout, type NavTab } from './components/Layout';
import { EvidenceExplorer } from './views/EvidenceExplorer';
import { RubricGapsPlaceholder } from './views/RubricGapsPlaceholder';
import { ResumeTailorPlaceholder } from './views/ResumeTailorPlaceholder';

export function App() {
  const [currentTab, setCurrentTab] = useState<NavTab>('evidence');

  return (
    <Layout currentTab={currentTab} onSelectTab={setCurrentTab}>
      {currentTab === 'evidence' && <EvidenceExplorer />}
      {currentTab === 'rubrics' && <RubricGapsPlaceholder />}
      {currentTab === 'tailor' && <ResumeTailorPlaceholder />}
    </Layout>
  );
}

export default App;
