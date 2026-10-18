import { useCallback, useMemo, useRef, useState } from 'react';
import { EvidenceStore, queryCorpus, type EvidenceRecord, type SkillSupport } from '@featherduster/core';
import { useModalA11y } from '../../hooks/useModalA11y.js';
import { inputClass, secondaryButton } from '../tailoring/ui.js';
import { supportDescription } from '../../components/corpus-labels.js';

export function JobEvidenceChooser({ evidence, support, selected, onChange, onClose }: {
  evidence: EvidenceRecord[]; support: SkillSupport[]; selected: string[];
  onChange: (ids: string[]) => void; onClose: () => void;
}) {
  const [search, setSearch] = useState('');
  const dialog = useRef<HTMLDivElement>(null);
  const close = useCallback(() => onClose(), [onClose]);
  useModalA11y({ isOpen: true, onClose: close, containerRef: dialog });
  const corpus = useMemo(() => {
    const store = new EvidenceStore();
    evidence.filter(r => r.entry.confidence !== 'retracted').forEach(r => store.add(r.entry, r.narrative, r.filePath));
    // Captured support has already been scope-filtered by the server.
    return { evidence: store, support: support.map(s => ({ ...s, scope: { kind: 'workspace' as const } })), issues: [] };
  }, [evidence, support]);
  return <div className="fixed inset-0 z-50 bg-black/50 p-3 flex items-center justify-center">
    <div ref={dialog} role="dialog" aria-modal="true" aria-labelledby="captured-evidence-title" className="bg-white dark:bg-slate-950 rounded-lg p-4 w-full max-w-2xl max-h-[90vh] overflow-y-auto space-y-3 min-w-0">
      <h3 id="captured-evidence-title">Choose captured evidence</h3>
      <p className="text-xs">Only this job's frozen sources. Missing a fact? Close and explicitly refresh inputs.</p>
      <label>Search captured evidence<input className={inputClass} value={search} onChange={e => setSearch(e.target.value)} /></label>
      <p className="break-words">Selected evidence: {selected.map(id => evidence.find(r => r.id === id)?.title || 'Missing captured source').join(', ') || 'None'}</p>
      {queryCorpus(corpus, { search }).map(({ record, literal, confidence, support: matches }) => <article key={record.id} className="border rounded p-3 space-y-2 break-words">
        <label><input type="checkbox" checked={selected.includes(record.id)} onChange={e => onChange(e.target.checked ? [...selected, record.id] : selected.filter(id => id !== record.id))} /> {record.title}{evidence.filter(r => r.title === record.title).length > 1 ? ` (${record.company}, ${record.date})` : ''}</label>
        <p className="text-xs">Confidence: {confidence}. {literal ? 'Literal match' : 'Remembered terminology match'}</p>
        <p className="whitespace-pre-wrap">{record.narrative}</p>
        {matches.map((s, i) => <p key={i} className="text-xs">Remembered support offered: {supportDescription(s, id => evidence.find(r => r.id === id)?.title || 'Missing captured source')}. Passage: {s.sources.filter(v => v.evidence_id === record.id).map(v => v.quote).join('; ')}</p>)}
      </article>)}
      <button className={secondaryButton} onClick={onClose}>Done choosing evidence</button>
    </div>
  </div>;
}
