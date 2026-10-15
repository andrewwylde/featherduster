import { useCallback, useState } from 'react';
import type { EvidenceRecord, Proposal, ProposalIssue, ProposalPatch, SkillSupport } from '@featherduster/core';
import { cardClass, CitationChip, inputClass, IssueList, secondaryButton } from '../tailoring/ui.js';
import { wordDiff } from '../tailoring/wordDiff.js';
import { JobEvidenceChooser } from './JobEvidenceChooser.js';

export interface GroundingDraft { proposal_id: string; term: string; evidence_id: string; quote: string; explanation: string }
export function JobProposalEditor({ proposal, issues, evidence, support, requirements, grounding, onGrounding, onPatch, disabled }: {
  proposal: Proposal; issues: ProposalIssue[]; evidence: EvidenceRecord[]; support: SkillSupport[]; requirements: string[];
  grounding?: GroundingDraft; onGrounding: (value?: GroundingDraft) => void; onPatch: (patch: ProposalPatch) => void; disabled: boolean;
}) {
  const [choosing, setChoosing] = useState(false);
  const close = useCallback(() => setChoosing(false), []);
  const p = proposal;
  const update = (value: Partial<GroundingDraft>) => onGrounding({ proposal_id: p.id, term: '', evidence_id: '', quote: '', explanation: '', ...grounding, ...value });
  return <fieldset disabled={disabled} className={`${cardClass} p-4 space-y-3 min-w-0 break-words`}>
    <legend className="font-semibold">{p.id} — {p.type}</legend>
    <p className="text-xs">Target: {JSON.stringify(p.target)}. {p.rationale}</p>
    {requirements.map((r, i) => <p key={i}>Requirement: {r}</p>)}
    <p>Original: {p.before || '(new content)'}</p>
    <details><summary>Generated wording</summary><p>{p.after}</p></details>
    <label className="block">Wording {p.id}<textarea aria-label={`Wording ${p.id}`} data-proposal-field={p.id} aria-describedby={`issues-${p.id}`} className={inputClass} value={p.edited_after ?? p.after} onChange={e => onPatch({ proposal_id: p.id, edited_after: e.target.value })} /></label>
    <div aria-label={`Wording diff ${p.id}`}>{wordDiff(p.before, p.edited_after ?? p.after).map((part, i) => part.type === 'added' ? <ins key={i}>{part.text}</ins> : part.type === 'removed' ? <del key={i}>{part.text}</del> : <span key={i}>{part.text}</span>)}</div>
    <label><input type="checkbox" checked={p.decision !== 'rejected'} onChange={e => onPatch({ proposal_id: p.id, decision: e.target.checked ? 'pending' : 'rejected' })} /> Include proposal {p.id}</label>
    {p.decision === 'rejected' && <p>Rejected — original content retained.</p>}
    <div className="flex flex-wrap gap-2">{p.citations.map(id => <CitationChip key={id} id={id} onRemove={() => onPatch({ proposal_id: p.id, citations: p.citations.filter(v => v !== id) })} />)}</div>
    <button className={secondaryButton} onClick={() => setChoosing(true)}>Choose evidence for {p.id}</button>
    {p.citations.map(id => <details key={id}><summary>{id} captured passage</summary><p className="whitespace-pre-wrap">{evidence.find(r => r.id === id)?.narrative ?? 'Missing captured source'}</p></details>)}
    <div id={`issues-${p.id}`}>{issues.map(issue => <details open key={issue.id}><summary>{issue.group}</summary><IssueList issues={issue.details} /></details>)}</div>
    <details><summary>Ground a specific term</summary><p className="text-xs">A terminology decision is not permission to add a technology, metric or ownership claim. Select a cited passage and explain the relationship.</p>
      <label className="block">Term {p.id}<input className={inputClass} value={grounding?.term ?? ''} onChange={e => update({ term: e.target.value })} /></label>
      <label className="block">Grounding source {p.id}<select aria-label={`Grounding source ${p.id}`} className={inputClass} value={grounding?.evidence_id ?? ''} onChange={e => update({ evidence_id: e.target.value, quote: '' })}><option value="">Select cited source</option>{p.citations.map(id => <option key={id}>{id}</option>)}</select></label>
      <label className="block">Exact passage {p.id}<textarea className={inputClass} value={grounding?.quote ?? ''} onChange={e => update({ quote: e.target.value })} /></label>
      <label className="block">Grounding explanation {p.id}<textarea className={inputClass} value={grounding?.explanation ?? ''} onChange={e => update({ explanation: e.target.value })} /></label>
      <button className={secondaryButton} onClick={() => onGrounding(undefined)}>Remove grounding for {p.id}</button>
    </details>
    {choosing && <JobEvidenceChooser evidence={evidence} support={support} selected={p.citations} onChange={citations => onPatch({ proposal_id: p.id, citations })} onClose={close} />}
  </fieldset>;
}
