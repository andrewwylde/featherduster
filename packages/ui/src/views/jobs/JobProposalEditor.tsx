import { useCallback, useState } from 'react';
import type { EvidenceRecord, Proposal, ProposalIssue, ProposalPatch, SkillSupport } from '@featherduster/core';
import { cardClass, CitationChip, inputClass, IssueList, primaryButton, secondaryButton } from '../tailoring/ui.js';
import { wordDiff } from '../tailoring/wordDiff.js';
import { JobEvidenceChooser } from './JobEvidenceChooser.js';

export interface GroundingDraft { proposal_id: string; term: string; evidence_id: string; quote: string; explanation: string }
const issueGroupNames: Record<string, string> = { grounding: 'Evidence grounding', wording: 'Wording', citation: 'Citations', fact: 'Facts', unsupported: 'Unsupported claims', relevance: 'Relevance', conflict: 'Conflicting edits' };
/** Validation groups are internal identifiers; show a readable, capitalised name. */
export function issueGroupLabel(group: string) {
  if (issueGroupNames[group]) return issueGroupNames[group];
  const words = group.replace(/[_-]+/g, ' ').trim();
  return words ? words.charAt(0).toUpperCase() + words.slice(1) : 'Review findings';
}
/** Source IDs are internal; show the captured source's title. */
export function evidenceTitle(evidence: EvidenceRecord[], id: string) {
  return evidence.find(r => r.id === id)?.title || 'Missing captured source';
}
export function JobProposalEditor({ proposal, issues, evidence, support, requirements, grounding, onGrounding, onPatch, disabled, onSave, saveDisabled, position }: {
  /** Only needed when one passage shows several changes; keeps accessible names unique. */
  position?: { index: number; total: number };
  proposal: Proposal; issues: ProposalIssue[]; evidence: EvidenceRecord[]; support: SkillSupport[]; requirements: string[];
  onSave?: () => void; saveDisabled?: boolean;
  grounding?: GroundingDraft; onGrounding: (value?: GroundingDraft) => void; onPatch: (patch: ProposalPatch) => void; disabled: boolean;
}) {
  const [choosing, setChoosing] = useState(false);
  const close = useCallback(() => setChoosing(false), []);
  const p = proposal;
  const n = position && position.total > 1 ? ` (change ${position.index} of ${position.total})` : '';
  const title = (id: string) => evidenceTitle(evidence, id);
  const update = (value: Partial<GroundingDraft>) => onGrounding({ proposal_id: p.id, term: '', evidence_id: '', quote: '', explanation: '', ...grounding, ...value });
  return <fieldset disabled={disabled} className={`${cardClass} p-3 space-y-2 min-w-0 break-words`}>
    <legend className="font-semibold text-sm">Correct this wording</legend>
    <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs">
      <span>{p.rationale}</span>
      {requirements.map((r, i) => <span key={i}>Requirement: {r}</span>)}
      <details><summary className="cursor-pointer">Original wording</summary><p>{p.before || '(new content)'}</p></details>
      <details><summary className="cursor-pointer">Generated wording</summary><p>{p.after}</p></details>
    </div>
    <div id={`issues-${p.id}`}>{issues.map(issue => <details open key={issue.id}><summary className="text-xs font-medium">{issueGroupLabel(issue.group)}</summary><IssueList issues={issue.details} /></details>)}</div>
    <label className="block text-sm">Proposed wording{n}<textarea aria-label={`Proposed wording${n}`} rows={1} data-proposal-field={p.id} aria-describedby={`issues-${p.id}`} className={inputClass} value={p.edited_after ?? p.after} onChange={e => onPatch({ proposal_id: p.id, edited_after: e.target.value })} /></label>
    <div className="flex flex-wrap items-center gap-2 text-xs">
      {onSave && <button className={primaryButton} disabled={disabled || saveDisabled} onClick={onSave}>Save for this job</button>}
      <label className="inline-flex items-center gap-1"><input type="checkbox" checked={p.decision !== 'rejected'} onChange={e => onPatch({ proposal_id: p.id, decision: e.target.checked ? 'pending' : 'rejected' })} /> Include this change{n}</label>
      {p.decision === 'rejected' && <span>Rejected — original content retained.</span>}
      {p.citations.map(id => <CitationChip key={id} id={id} label={title(id)} onRemove={() => onPatch({ proposal_id: p.id, citations: p.citations.filter(v => v !== id) })} />)}
      <button className={secondaryButton} onClick={() => setChoosing(true)}>Choose supporting evidence{n}</button>
    </div>
    <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs">
      <details><summary className="cursor-pointer">Compare wording</summary><div aria-label={`Wording comparison${n}`}>{wordDiff(p.before, p.edited_after ?? p.after).map((part, i) => part.type === 'added' ? <ins key={i}>{part.text}</ins> : part.type === 'removed' ? <del key={i}>{part.text}</del> : <span key={i}>{part.text}</span>)}</div></details>
      {p.citations.map(id => <details key={id}><summary className="cursor-pointer">{title(id)} · captured passage</summary><p className="whitespace-pre-wrap">{evidence.find(r => r.id === id)?.narrative ?? 'Missing captured source'}</p></details>)}
    </div>
    <details><summary>Ground a specific term</summary><p className="text-xs">A terminology decision is not permission to add a technology, metric or ownership claim. Select a cited passage and explain the relationship.</p>
      <label className="block">Term to ground{n}<input className={inputClass} value={grounding?.term ?? ''} onChange={e => update({ term: e.target.value })} /></label>
      <label className="block">Supporting source{n}<select aria-label={`Supporting source${n}`} className={inputClass} value={grounding?.evidence_id ?? ''} onChange={e => update({ evidence_id: e.target.value, quote: '' })}><option value="">Select cited source</option>{p.citations.map(id => <option key={id} value={id}>{title(id)}</option>)}</select></label>
      <label className="block">Exact passage{n}<textarea className={inputClass} value={grounding?.quote ?? ''} onChange={e => update({ quote: e.target.value })} /></label>
      <label className="block">Why this passage supports the term{n}<textarea className={inputClass} value={grounding?.explanation ?? ''} onChange={e => update({ explanation: e.target.value })} /></label>
      <button className={secondaryButton} onClick={() => onGrounding(undefined)}>Remove term grounding{n}</button>
    </details>
    {choosing && <JobEvidenceChooser evidence={evidence} support={support} selected={p.citations} onChange={citations => onPatch({ proposal_id: p.id, citations })} onClose={close} />}
  </fieldset>;
}
