import { retainedFactAnswer } from './fact-answer-state.js';
import { forwardRef, useEffect, useImperativeHandle, useRef, useState, type ReactNode } from 'react';
import { proposalForPassage, isFindingStaleForPreview, type EvidenceRecord, type JobFacts, type Proposal, type ProposalPatch, type ProposalIssue, type ResumeSpec } from '@featherduster/core';
import { apiClient } from '../../api/client.js';
import { cardClass, inputClass, secondaryButton } from '../tailoring/ui.js';
import { isSkillsProposal, skillsReviewChange } from './skills-review.js';

export function passageCheckState(facts: JobFacts | null, text: string, blocked: boolean, path?: string): 'Needs your answer' | 'Checking' | 'Needs retry' | 'Needs changes' | 'Needs saving' | 'Resolved' {
  if (facts?.execution === 'checking') return 'Checking';
  const matching = facts?.facts.filter(f => f.passage.text === text && (!path || f.passage.subject.path === path)) ?? [];
  if (matching.length && matching.every(f => f.resolution) && !blocked) return 'Resolved';
  if (matching.some(f => !f.resolution && ['needs_clarification', 'contradicted'].includes(f.state))) return 'Needs your answer';
  if (blocked) return 'Needs changes';
  if (matching.some(f => !f.resolution && f.state === 'unavailable')) return 'Needs retry';
  if (facts?.execution === 'unchecked') return 'Checking';
  return 'Needs retry';
}

export function resumeReviewRows(resume: ResumeSpec, proposals: Proposal[], facts: JobFacts | null, issues: ProposalIssue[], startingResume?: ResumeSpec) {
  const passages = [{ path: 'summary', text: resume.summary ?? '' }, ...resume.experiences.flatMap((e, ei) => e.bullets.map((b, bi) => ({ path: `experiences.${ei}.bullets.${bi}.text`, text: b.text })))].filter(p => p.text);
  const wording = passages.map(p => {
    const proposal = proposalForPassage(proposals, p.path, p.text);
    const findings = issues.filter(i => i.subject.kind === 'candidate' ? i.subject.path === p.path : i.subject.proposal_id === proposal?.id);
    const hasActiveBlockers = findings.some(i => i.details.some(d => {
      if (d.severity !== 'block') return false;
      const target = d.target ?? i.target;
      if (target && isFindingStaleForPreview(target, p.text)) return false;
      return true;
    }));
    let status = passageCheckState(facts, p.text, hasActiveBlockers, p.path);
    if (status === 'Needs your answer' && facts?.facts.some(f => !f.resolution && f.passage.text === p.text && f.passage.subject.path === p.path && retainedFactAnswer(facts, f).assertion.trim())) status = 'Needs saving';
    const parts = /^experiences\.(\d+)\.bullets\.(\d+)\.text$/.exec(p.path);
    const label = parts ? `${resume.experiences[Number(parts[1])].company} · bullet ${Number(parts[2]) + 1}` : 'Resume summary';
    const question = facts?.facts.find(f => f.passage.subject.path === p.path && f.passage.text === p.text && !f.resolution)?.question
      || findings.flatMap(i => i.details.map(d => ({ d, target: d.target ?? i.target })))
          .find(({ d, target }) => d.severity === 'block' && (!target || !isFindingStaleForPreview(target, p.text)))?.d.message;
    return { ...p, id: proposal?.id ?? `base:${p.path}`, status, findings, label, question };
  });
  const skills = proposals.filter(isSkillsProposal).map(proposal => {
    const diff = skillsReviewChange(proposal, startingResume, resume);
    const path = `skills.${proposal.target.skill_group_index}`;
    const findings = issues.filter(issue => issue.subject.kind === 'proposal' ? issue.subject.proposal_id === proposal.id : issue.subject.path === path);
    const blocked = proposal.decision !== 'rejected' && (diff.missing || diff.ambiguous || findings.some(issue => issue.details.some(detail => detail.severity === 'block')));
    return { id: proposal.id, path, text: diff.after.join(', '), label: `${diff.category} · skills`, findings,
      status: blocked ? 'Needs changes' as const : 'Resolved' as const,
      question: blocked ? 'Correct this list change against the captured skills group.' : undefined };
  });
  return [...wording, ...skills];
}
export interface ResumeReviewNavigation { reviewNext(): void }
export interface ResolutionNavigation { focusRequest: number; action: ReturnType<typeof passageCheckState> }

export const ResumeDraftSurface = forwardRef<ResumeReviewNavigation, {
  resume: ResumeSpec; startingResume?: ResumeSpec; proposals: Proposal[]; omissions?: ProposalPatch[]; facts: JobFacts | null; issues: ProposalIssue[]; evidence: EvidenceRecord[]; workspaceId: string; disabled: boolean;
  onSelect(id: string): void; onToggle(id: string, rejected: boolean): void;
  renderResolution?(id: string, path: string, text: string, navigation: ResolutionNavigation): ReactNode;
}>(function ResumeDraftSurface({ resume, startingResume, proposals, omissions = [], facts, issues, evidence, workspaceId, disabled, onSelect, onToggle, renderResolution }, ref) {
  const [selected, setSelected] = useState<string>();
  const panel = useRef<HTMLElement>(null);
  const [focusRequest, setFocusRequest] = useState(0);
  const resolutionPanel = useRef<HTMLElement>(null);
  const select = (id: string) => { setSelected(id); setFocusRequest(n => n + 1); onSelect(id); };
  const [style, setStyle] = useState(''), [notice, setNotice] = useState('');
  const rows = resumeReviewRows(resume, proposals, facts, issues, startingResume);
  const hasSkills = proposals.some(isSkillsProposal);
  const current = rows.find(r => r.id === selected) ?? rows.find(r => r.status !== 'Resolved');
  const pending = rows.filter(r => r.status !== 'Resolved');
  const next = pending.length > 1 || (pending.length === 1 && pending[0].id !== current?.id)
    ? pending[(pending.findIndex(r => r.id === current?.id) + 1) % pending.length] : undefined;
  useImperativeHandle(ref, () => ({ reviewNext() {
    const row = rows.find(r => r.status === 'Needs saving') ?? rows.find(r => r.status === 'Needs your answer') ?? rows.find(r => r.status === 'Needs changes') ?? rows.find(r => r.status === 'Needs retry');
    if (row) select(row.id);
  } }));
  useEffect(() => {
    if (!focusRequest || ['Needs your answer', 'Needs saving'].includes(current?.status ?? '')) return;
    const target = resolutionPanel.current?.querySelector<HTMLElement>('[data-review-action]');
    target?.focus({ preventScroll: true }); target?.scrollIntoView?.({ block: 'start' });
  }, [focusRequest, current?.id, current?.status]);
  const omittedProposals = new Set(omissions.filter(p => p.decision !== 'rejected').map(p => p.omission?.replaces_proposal_id));
  const omissionOperations = new Set(omissions.flatMap(p => p.omission?.source_bullets.map(source => `${p.proposal_id}:${source.bullet_index}`) ?? []));
  const changes = proposals.filter(p => !omissionOperations.has(p.id) && !omittedProposals.has(p.id) && p.type !== 'bullet.reorder');
  return <div className="space-y-4">
    <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_minmax(18rem,0.55fr)] gap-5 items-start">
      <article aria-label="Complete resume draft" className={`${cardClass} p-6 min-w-0`}>
        <h2 className="text-lg font-semibold mb-4">Resume draft</h2>
        <div className="font-serif text-sm leading-relaxed space-y-4">
          <header className="text-center border-b pb-3"><h3 className="text-2xl">{resume.profile.name}</h3><p>{resume.profile.title}</p><p>{[resume.profile.email, resume.profile.phone, resume.profile.location].filter(Boolean).join(' · ')}</p><p className="break-words">{Object.values(resume.profile.links ?? {}).filter(Boolean).join(' · ')}</p></header>
          {resume.summary && <p className={current?.path === 'summary' ? 'bg-amber-50 dark:bg-amber-950/30 p-2 rounded' : ''}>{resume.summary}</p>}
          {resume.experiences.map((exp, ei) => <section key={ei} className="space-y-2"><div className="flex flex-wrap justify-between gap-x-3"><h3 className="font-semibold">{exp.role} · {exp.company}</h3><span>{exp.startDate} – {exp.endDate ?? 'Present'}</span></div>
            {exp.location && <p>{exp.location}</p>}
            <ul className="list-disc pl-5 space-y-2">{exp.bullets.map((b, bi) => <li key={bi} className={current?.path === `experiences.${ei}.bullets.${bi}.text` ? 'bg-amber-50 dark:bg-amber-950/30 rounded' : ''}>{b.text}</li>)}</ul>
          </section>)}
          {!!resume.skills.length && <section className="border-t pt-3"><h3 className="font-semibold">Skills</h3>{resume.skills.map((group, i) => <p key={i}><strong>{group.category}: </strong>{group.skills.join(', ')}</p>)}</section>}
          {!!resume.education.length && <section className="border-t pt-3"><h3 className="font-semibold">Education</h3>{resume.education.map((e, i) => <div key={i}><p>{e.institution} · {e.degree} {e.year}</p>{e.details && <p>{e.details}</p>}</div>)}</section>}
        </div>
      </article>
      <aside ref={panel} id="resume-exceptions" tabIndex={-1} aria-label="Resume exceptions" className={`${cardClass} p-4 space-y-4 xl:sticky xl:top-20 scroll-mt-20`}>
        <div className="space-y-1"><h2 className="font-semibold">Review exceptions</h2>
          <p className="text-sm">{pending.length ? `${pending.length} ${pending.length === 1 ? 'passage needs' : 'passages need'} attention. ${pending.some(r => r.status === 'Needs saving') ? 'Finish saving your retained answers to continue.' : pending.some(r => r.status === 'Needs your answer') ? 'Open a remaining question to continue.' : 'Review the checks below to continue.'}` : 'Review the saved checks for each passage.'}</p>
        </div>
        {!!rows.length && <div className="space-y-1">
          <p className="text-sm">{rows.length - pending.length} of {rows.length} passages resolved</p>
          <progress aria-label="Resume passage review progress" className="w-full h-3 accent-emerald-600" max={rows.length} value={rows.length - pending.length} />
          {!pending.length && <p className="text-xs">{hasSkills ? 'Wording and list-change review complete. Resume and PDF checks follow before final approval.' : 'Factual review complete. Resume and PDF checks follow before final approval.'}</p>}
          {hasSkills && <p className="text-xs">Skills rows check list changes only. Inherited skills are not independently verified by these checks.</p>}
        </div>}
        {current && <>
          <label className="block text-sm font-medium">Passage to review
            <select className={`${inputClass} w-full min-w-0 mt-1`} value={current.id} onChange={e => select(e.target.value)}>
              {rows.map(row => <option key={row.id} value={row.id}>{row.label} — {row.status}</option>)}
            </select>
          </label>
          <section ref={resolutionPanel} aria-label="Selected exception" className="space-y-3 border-t pt-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <strong className="text-xs rounded-full border px-2 py-1">{current.status}</strong>
              {next && <button className={secondaryButton} onClick={() => select(next.id)}>Next passage</button>}
            </div>
            {current.status === 'Resolved' && <p role="status">This passage is complete.{pending.length ? ' Other passages still need attention. Choose Next passage to continue.' : ''}</p>}
            {current.status === 'Needs changes' && <h3 data-review-action tabIndex={-1} className="font-semibold scroll-mt-24">Wording or evidence still needs changes. A saved confirmation only resolves the fact you answered.</h3>}
            {current.status === 'Needs retry' && <h3 data-review-action tabIndex={-1} className="font-semibold scroll-mt-24">No factual answer is requested here. Run or retry the evidence check below.</h3>}
            {current.findings.flatMap(i => i.details.map(d => ({ detail: d, target: d.target ?? i.target }))).map(({ detail: d, target }, i) => {
              const isRetained = target?.scope === 'retained_baseline';
              const isStale = target ? isFindingStaleForPreview(target, current.text) : false;
              if (isRetained && isStale) {
                return (
                  <p key={i} className="text-sm text-slate-500 italic">
                    <span className="font-semibold not-italic">Retained baseline finding (resolved by your pending edit):</span> {d.message}
                  </p>
                );
              }
              if (isStale) return null;
              return <p key={i} className="text-sm">{d.message}</p>;
            })}
            {renderResolution ? renderResolution(current.id, current.path, current.text, { focusRequest, action: current.status }) : <>
              <p>{current.question || (current.status === 'Needs retry' ? 'Run an evidence check for this saved wording.' : 'Review the highlighted wording and its supporting evidence.')}</p>
              <button className={secondaryButton} onClick={() => { onSelect(current.id); document.getElementById(current.id.startsWith('base:') ? 'starting-resume' : 'proposal-edits')?.scrollIntoView({ block: 'start' }); }}>Resolve this passage</button>
            </>}
          </section>
        </>}
        {!rows.length && <p>Needs retry — no checked passages are available yet.</p>}
        {rows.length > 0 && !pending.length && <p role="status">{hasSkills ? 'Resolved — displayed wording and list-change checks are complete.' : 'Resolved — all displayed passages have persisted support.'}</p>}
        <details><summary className="cursor-pointer font-medium">All passages ({rows.length})</summary>
          <div className="space-y-2 pt-2">{rows.map(row => <button key={row.id} className={`${secondaryButton} block w-full text-left whitespace-normal`} onClick={() => select(row.id)}>
            <span className="block font-semibold">{row.label} · {row.status}</span>
            <span className="block text-xs mt-1">{row.question || row.text}</span>
            <span className="block text-xs underline mt-1">{row.status === 'Resolved' ? 'Review support' : 'Open question and actions'} →</span>
          </button>)}</div>
        </details>
      </aside>
    </div>
    <details open className={`${cardClass} p-4 space-y-3`}><summary className="font-semibold">Changes</summary>
      <p className="text-xs">Supported edits are included automatically. Final approval covers the current PDF and this change summary.</p>
      {omissions.map(p => <section key={p.proposal_id} className="border-t pt-3 space-y-2">
        <h3 className="font-semibold text-sm">{p.decision === 'rejected' ? 'Restored accomplishment' : 'Omitted by you'}</h3>
        <p className="text-sm"><strong>Before: </strong>{p.omission?.text}</p>
        <p className="text-sm"><strong>After: </strong>{p.decision === 'rejected' ? 'Included in draft' : '(omitted from this job’s resume)'}</p>
        <button className={secondaryButton} disabled={disabled} onClick={() => onToggle(p.proposal_id, p.decision !== 'rejected')}>{p.decision === 'rejected' ? 'Leave out again' : 'Restore accomplishment'}</button>
      </section>)}
      {changes.map(p => <section key={p.id} className="border-t pt-3 space-y-2">
        <h3 className="text-sm font-semibold">{p.type === 'skills.prune' ? 'Remove skills' : p.type === 'skills.reorder' ? 'Reorder skills' : p.type === 'bullet.consolidate' ? 'Consolidation' : p.type === 'bullet.drop' ? 'Omission' : p.type === 'bullet.add' ? 'Addition' : 'Rewrite'} · {p.decision === 'rejected' ? 'Undone' : 'Included in draft'}</h3>
        {isSkillsProposal(p) ? (() => { const diff = skillsReviewChange(p, startingResume, resume); return <>
          <p className="text-sm"><strong>{diff.category}</strong></p>
          <p className="text-sm"><strong>Before: </strong>{diff.before.join(', ') || '(empty group)'}</p>
          <p className="text-sm"><strong>After: </strong>{diff.ambiguous ? 'The current group cannot be identified uniquely. Review the captured target before saving.' : diff.after.join(', ') || '(empty group)'}</p>
          <p className="text-xs">Removed: {diff.removed.join(', ') || 'None'}{diff.reordered ? ' · Order changed' : ''}</p>
        </>; })() : <>
          <p className="text-sm"><strong>Before: </strong>{p.source_bullets?.map(s => s.before).join(' / ') || p.before || '(new content)'}</p>
          <p className="text-sm"><strong>After: </strong>{p.type === 'bullet.drop' ? '(omitted)' : p.edited_after ?? p.after}</p>
        </>}
        <p className="text-xs">{p.rationale}</p>
        <button className={secondaryButton} disabled={disabled} onClick={() => onToggle(p.id, p.decision !== 'rejected')}>{p.decision === 'rejected' ? 'Restore change' : p.type === 'bullet.drop' ? 'Restore accomplishment' : 'Undo change'}</button>
        <button className={secondaryButton} disabled={disabled} onClick={() => { select(p.id); }}>Edit wording or evidence</button>
      </section>)}
      {!changes.length && !omissions.length && <p>No generated changes.</p>}
    </details>
    <details className={`${cardClass} p-4`}><summary className="font-semibold">Evidence</summary>
      {proposals.filter(p => p.decision !== 'rejected' && p.citations.length).map(p => <section key={p.id} className="py-3 border-b"><p>{p.edited_after ?? p.after}</p>
        {p.claim_bindings?.map((c, i) => <p key={i} className="text-sm">“{c.text}” — {c.citations.map(id => evidence.find(e => e.id === id)?.title ?? 'Missing source').join('; ')}</p>)}
        {p.citations.map(id => { const source = evidence.find(e => e.id === id); const quotes = facts?.facts.filter(f => f.passage.text === (p.edited_after ?? p.after)).flatMap(f => f.evidence.filter(e => e.evidence_id === id).map(e => e.quote)) ?? []; return <blockquote className="text-sm my-2" key={id}><strong>{source?.title ?? 'Missing source'}</strong><p>{[...new Set(quotes)].join(' … ') || source?.summary}</p></blockquote>; })}
        <button className={secondaryButton} onClick={() => { select(p.id); }}>Add or remove evidence</button>
      </section>)}
    </details>
    <details className={`${cardClass} p-4 space-y-2`}><summary>Use this style again</summary>
      <p className="text-xs">Save an explicit writing preference. This supplies no factual support; ordinary wording edits stay in this job.</p>
      <label>Writing preference<input className={inputClass} value={style} onChange={e => setStyle(e.target.value)} placeholder="Lead with the delivered capability, then technical scope" /></label>
      <button className={secondaryButton} disabled={!style.trim() || disabled} onClick={async () => { try {
        const corpus = await apiClient.getCorpus();
        await apiClient.rememberCorpusChange({ workspace_id: workspaceId, expected_revision: corpus.snapshot.revision, idempotency_key: crypto.randomUUID(), explanation: 'Explicitly saved writing preference', change: { kind: 'writing_preference', value: { scope: { kind: 'workspace' }, instruction: style, example_before: '', example_after: resume.summary || proposals.find(p => p.after)?.after || style, explanation: 'Use this style again' } } });
        setNotice('Writing preference saved separately from facts.');
      } catch (e) { setNotice(e instanceof Error ? e.message : 'Could not save preference.'); } }}>Use this style again</button><p role="status">{notice}</p>
    </details>
  </div>;
});
