import { useState } from 'react';
import { Layout, type NavTab } from './components/Layout';
import { EvidenceExplorer } from './views/EvidenceExplorer';
import { RubricGapMatrix } from './views/RubricGapMatrix';
import { ResumeTailor } from './views/ResumeTailor';

export function App() {
  const [currentTab, setCurrentTab] = useState<NavTab>('evidence');

  return (
    <Layout currentTab={currentTab} onSelectTab={setCurrentTab}>
      <div className={currentTab === 'evidence' ? 'block' : 'hidden'}>
        <EvidenceExplorer />
      </div>
      <div className={currentTab === 'rubrics' ? 'block' : 'hidden'}>
        <RubricGapMatrix />
      </div>
      <div className={currentTab === 'tailor' ? 'block' : 'hidden'}>
        <ResumeTailor />
      </div>
    </Layout>
  );
}

export default App;
