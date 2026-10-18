import { JobStartingResumeCorrection } from './JobStartingResumeCorrection.js';
import { useCallback, useEffect, useRef, useState } from 'react';
import { applyProposalPatches, baseText, compileMarkdownResume, effectiveBaseResume, type CorpusScope, type Job, type ProposalPatch, type ProposalReadResponse, type ProposalReviewRevision, type ProposalSaveRequest } from '@featherduster/core';
import { apiClient } from '../../api/client.js';
import { useIntentKey, useJobsData } from '../../hooks/useJobsData.js';
import { cardClass, inputClass, IssueList, primaryButton, secondaryButton } from '../tailoring/ui.js';
import { evidenceTitle, JobProposalEditor, type GroundingDraft } from './JobProposalEditor.js';
import { pluralize, preparationActionFor, requestErrorMessage, stoppedByUser } from './job-utils.js';
import { JobRememberedSupport } from './JobRememberedSupport.js';
import { appliesTo, supportDescription } from '../../components/corpus-labels.js';

type Available = Extract<ProposalReadResponse, { availability: 'available' }>;
type Draft = { patches: ProposalPatch[]; groundings: GroundingDraft[]; explanation: string; removedGroundings?: string[] };
const empty = (): Draft => ({ patches: [], groundings: [], explanation: '' });
const candidateFieldLabel = (path: string) => {
  if (path === 'summary') return 'Resume summary';
  const match = /^experiences\.(\d+)\.bullets\.(\d+)\.text$/.exec(path);
  return match ? `Experience ${Number(match[1]) + 1}, bullet ${Number(match[2]) + 1}` : path;
};
const scopeOptions = [['workspace', 'All jobs'], ['employer', 'Jobs at an employer'], ['project', 'A project'], ['role', 'A role'], ['job', 'This job only']] as const;
const supportOptions = [['direct', 'Direct experience'], ['transferable', 'Transferable experience'], ['unsupported', 'Not supported']] as const;
async function hash(value: string) {
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))), b => b.toString(16).padStart(2, '0')).join('');
}
function Editor({ job, data, onSaved, refresh, loadError }: { job: Job; data: Available; onSaved: () => void; refresh: () => Promise<void>; loadError?: string }) {
  const [base, setBase] = useState(data);
  const [revision, setRevision] = useState(job.revision);
  const prefix = `proposal-draft:${job.workspace_id}:${job.id}:${data.generation.id}:${data.review.id}:`;
  const [restored] = useState(() => {
    try {
      const keys = Object.keys(localStorage).filter(k => k.startsWith(prefix));
      const stored = keys.map(k => ({ revision: Number(k.slice(prefix.length)), value: JSON.parse(localStorage.getItem(k)!) })).sort((a, b) => (b.value.savedAt ?? 0) - (a.value.savedAt ?? 0))[0];
      if (stored?.value.draft && Array.isArray(stored.value.draft.patches) && Array.isArray(stored.value.draft.groundings)) return stored;
    } catch { /* A malformed browser draft is not server authority. */ }
    return null;
  });
  const [draftBaseRevision, setDraftBaseRevision] = useState(restored?.revision ?? data.review.revision);
  const [draft, setDraft] = useState<Draft>(restored?.value.draft ?? empty());
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const refreshedInput = data.input_stale ? data.latest_input_snapshot_id : null;
  const action = preparationActionFor(job);
  const [memoryProposal, setMemoryProposal] = useState('');
  const [skill, setSkill] = useState('');
  const [facet, setFacet] = useState('');
  const [scopeKind, setScopeKind] = useState<CorpusScope['kind']>('workspace');
  const [scopeKey, setScopeKey] = useState('');
  const [support, setSupport] = useState<'direct' | 'transferable' | 'unsupported'>('direct');
  const pending = useRef(false);
  const focusRequested = useRef(false);
  const key = useIntentKey();
  const dirty = draft.patches.length > 0 || draft.groundings.length > 0 || !!draft.explanation || !!draft.removedGroundings?.length;
  useEffect(() => { if (!dirty && job.revision > revision) setRevision(job.revision); }, [dirty, job.revision, revision]);
  const stale = draftBaseRevision !== base.review.revision || data.review.revision > base.review.revision || job.revision > revision || data.input_stale;
  const active = job.preparation_state === 'preparing';
  const overlay = applyProposalPatches(base.generation.proposals.proposals, base.review.patches, draft.patches, base.review.groundings);
  // A mismatched stored overlay is a server-detected conflict; show captured wording instead of crashing.
  const [startingResume, overlayError] = (() => { try { return [effectiveBaseResume(base.captured.base_resume, base.review), ''] as const; } catch (e) { return [base.captured.base_resume, e instanceof Error ? e.message : 'Starting-resume correction mismatch'] as const; } })();
  const blockers = base.review.validation.issues.filter(issue => issue.details.some(detail => detail.severity === 'block'));
  const proposalBlockers = new Set(blockers.flatMap(issue => issue.subject.kind === 'proposal' ? [issue.subject.proposal_id] : []));
  const candidateBlockers = [...new Set(blockers.flatMap(issue => issue.subject.kind === 'candidate' ? [issue.subject.path] : []))];
  const [selectedProposal, setSelectedProposal] = useState(() => [...proposalBlockers][0] ?? (candidateBlockers[0] ? `base:${candidateBlockers[0]}` : ''));
  const passageKey = (p: typeof overlay.proposals[number]) => p.type === 'summary.rewrite' ? 'summary' : p.target.experience_index >= 0 ? `experience:${p.target.experience_index}:bullet:${p.target.bullet_index}` : `skills:${p.target.skill_group_index}`;
  const passages = [...new Set(overlay.proposals.map(passageKey))].map(id => {
    const proposals = overlay.proposals.filter(p => passageKey(p) === id);
    const first = proposals[0];
    const experience = startingResume.experiences[first.target.experience_index];
    const label = id === 'summary' ? 'Resume summary' : experience ? `${experience.role} at ${experience.company}, bullet ${first.target.bullet_index + 1}` : id.startsWith('skills') ? 'Skills' : `Experience ${first.target.experience_index + 1}, bullet ${first.target.bullet_index + 1}`;
    return { id, label, proposals, required: proposals.some(p => proposalBlockers.has(p.id)) };
  });
  const currentPassage = passages.find(group => group.proposals.some(p => p.id === selectedProposal));
  const requiredPassages = passages.filter(group => group.required);
  const storageKey = prefix + draftBaseRevision;
  useEffect(() => {
    try { if (dirty) localStorage.setItem(storageKey, JSON.stringify({ draft, savedAt: Date.now() })); else localStorage.removeItem(storageKey); }
    catch { setMessage('Browser draft storage unavailable. Keep this tab open until saved.'); }
  }, [draft, dirty, storageKey]);
  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ''; };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);
  const patch = (value: ProposalPatch) => setDraft(d => ({ ...d, patches: [...d.patches.filter(p => p.proposal_id !== value.proposal_id), { ...d.patches.find(p => p.proposal_id === value.proposal_id), ...value }], groundings: value.edited_after !== undefined || value.citations !== undefined ? d.groundings.filter(g => g.proposal_id !== value.proposal_id) : d.groundings }));
  const binding = { expected_job_revision: revision, expected_review_revision: base.review.revision, input_fingerprint: base.review.input_fingerprint };
  const memoryGrounding = draft.groundings.find(g => g.proposal_id === memoryProposal);
  const scope: CorpusScope = scopeKind === 'workspace' ? { kind: 'workspace' } : { kind: scopeKind, key: scopeKind === 'job' ? job.id : scopeKey };
  const memoryReady = memoryGrounding && draft.explanation.trim() && skill.trim() && facet.trim() && (scope.kind === 'workspace' || scope.key.trim());
  const run = async (action: () => Promise<void>, timeout = 'The request is taking longer than expected. Your edits are kept in this browser; try again.') => {
    if (pending.current) return;
    pending.current = true; setBusy(true); setMessage('');
    try { await action(); } catch (e) { setMessage(requestErrorMessage(e, { timeout, fallback: 'Action failed; your draft is retained.' })); }
    finally { pending.current = false; setBusy(false); }
  };
  const save = (remember: boolean) => run(async () => {
    const submitted = draft;
    const groundings: ProposalSaveRequest['groundings'] = overlay.groundings.filter(g => !draft.removedGroundings?.includes(g.id) && !draft.groundings.some(d => d.proposal_id === g.proposal_id)).map(g => ({ proposal_id: g.proposal_id, claim_fingerprint: g.claim_fingerprint, term: g.term, explanation: g.explanation, sources: g.sources.map(({ source_status: _, ...s }) => s) }));
    for (const g of draft.groundings) {
      const p = overlay.proposals.find(p => p.id === g.proposal_id)!;
      const source = base.captured.evidence.find(r => r.id === g.evidence_id);
      if (!source || !p.citations.includes(source.id) || !g.term.trim() || !g.quote.trim() || !g.explanation.trim()) throw new Error('Complete the term, cited source, exact passage and explanation.');
      groundings.push({ proposal_id: p.id, claim_fingerprint: await hash(JSON.stringify({ citations: p.citations, proposal_id: p.id, text: p.edited_after ?? p.after })), term: g.term, explanation: g.explanation, sources: [{ evidence_id: source.id, evidence_fingerprint: base.captured.source_fingerprints[source.id], quote: g.quote }] });
    }
    const selected = groundings.find(g => g.proposal_id === memoryProposal);
    const body = { ...binding, patches: draft.patches, ...(draft.removedGroundings?.length ? { removed_grounding_ids: draft.removedGroundings } : {}), groundings, feedback_kind: groundings.length ? 'grounding' as const : 'wording' as const, explanation: draft.explanation,
      ...(remember && selected && memoryReady ? { remember: { expected_corpus_revision: base.corpus_revision, change: { kind: 'skill_support' as const, value: { skill, facet, permitted_terms: [selected.term], support, scope, sources: selected.sources, explanation: selected.explanation } } } } : {}) };
    if (remember && !('remember' in body)) throw new Error('Select a complete grounding relationship to remember.');
    const response = await apiClient.saveJobProposals(job.id, base.review.id, { ...body, idempotency_key: key(body) });
    setBase(b => ({ ...b, review: response.result.review, corpus_revision: response.result.corpus_revision, input_stale: response.result.requires_refresh }));
    setRevision(response.result.job.revision);
    setDraftBaseRevision(response.result.review.revision);
    // Controls are disabled during save; preserve any later changes defensively.
    setDraft(current => current === submitted ? empty() : current);
    try { localStorage.removeItem(storageKey); } catch { /* storage failure is already displayed */ }
    setMessage(`Saved revision ${response.result.review.revision}. ${response.result.review.validation.status === 'ready' ? 'Ready to continue separately.' : 'Review remaining issues.'}${response.result.requires_refresh ? ' Explicit input refresh required.' : ''}`);
    advance(response.result.review);
    onSaved(); await refresh();
  }, 'The save is taking longer than expected. Your edits are kept in this browser; try again.');
  const advance = (review: ProposalReviewRevision) => {
    const next = review.validation.issues.find(i => i.subject.kind === 'proposal' && i.details.some(d => d.severity === 'block'));
    if (next?.subject.kind === 'proposal') { setSelectedProposal(next.subject.proposal_id); focusRequested.current = true; }
    else { const nextBase = review.validation.issues.find(i => i.subject.kind === 'candidate' && i.details.some(d => d.severity === 'block')); setSelectedProposal(nextBase?.subject.kind === 'candidate' ? `base:${nextBase.subject.path}` : ''); focusRequested.current = !!nextBase; }
  };
  const focusBlocker = () => {
    const first = base.review.validation.issues.find(i => i.subject.kind === 'proposal' && i.details.some(d => d.severity === 'block'));
    if (first?.subject.kind === 'proposal') document.querySelector<HTMLElement>(`[data-proposal-field="${CSS.escape(first.subject.proposal_id)}"]`)?.focus();
    else document.querySelector<HTMLElement>('#starting-resume details[open] textarea')?.focus();
  };
  useEffect(() => {
    if (!busy && !stale && focusRequested.current) { focusRequested.current = false; focusBlocker(); }
  }, [busy, stale, base.review]);
  return <section aria-label="Proposal resolution" className={`${cardClass} p-3 space-y-2.5 min-w-0 break-words`}>
    {loadError && <p role="alert">{loadError} Showing the last successfully loaded review; it will refresh when the host responds.</p>}
    {overlayError && <p role="alert">{overlayError}. Showing the captured starting resume; this saved correction cannot be checked or continued.</p>}
    <header className="space-y-1.5 border-b border-slate-200 dark:border-slate-800 pb-2">
      <div className="flex flex-wrap items-center justify-between gap-2"><div><p className="text-xs font-semibold uppercase tracking-wide text-vermilion-600">Resume correction</p><h2 className="text-base font-bold">Proposal review</h2></div><span className={`rounded-full px-3 py-0.5 text-xs font-semibold ${blockers.length ? 'bg-amber-100 text-amber-900 dark:bg-amber-950/50 dark:text-amber-200' : 'bg-emerald-100 text-emerald-900 dark:bg-emerald-950/50 dark:text-emerald-200'}`}>{blockers.length ? pluralize(blockers.length, 'blocker') : 'Ready to continue'}</span></div>
      {blockers.length ? <details><summary className="text-xs cursor-pointer">Review overview · {pluralize(requiredPassages.length + candidateBlockers.length, 'required passage')}</summary><p className="text-xs">{proposalBlockers.size ? <>Resolve <strong>{pluralize(proposalBlockers.size, 'proposed edit')}</strong> and </> : <>Generated proposals have no blocking findings. </>}{candidateBlockers.length ? <>Update <strong>{pluralize(candidateBlockers.length, 'location')} in the starting resume</strong>. </> : null}Save checks your correction. Continue separately when all required passages are resolved.</p></details> : <p className="text-xs">The saved review passes validation. Continue preparation when you are ready; PDF approval comes later.</p>}

      {currentPassage?.required && <p className="text-xs">{blockers.find(issue => issue.subject.kind === 'proposal' && currentPassage.proposals.some(p => issue.subject.kind === 'proposal' && p.id === issue.subject.proposal_id))?.details.find(d => d.severity === 'block')?.message} Edit this passage using supported experience, then choose <strong>Save for this job</strong>.</p>}
    </header>
    <p className="text-xs">Saved revision {base.review.revision} · {dirty ? 'Unsaved changes are kept in this browser.' : 'No unsaved changes.'} Saving checks this job without running models.</p>
    {active && <p role="status">Preparation is active; its selected revision is frozen. Editing is disabled.</p>}
    {data.corpus_revision > (base.captured.knowledge?.revision ?? base.corpus_revision) && <p>Newer corpus knowledge exists. Refresh inputs explicitly to use it.</p>}
    {stale && <div role="alert"><p>The job or review changed. Local text is retained. Compare before reconciling.</p><details><summary>Compare server candidate</summary><pre className="whitespace-pre-wrap break-words">{compileMarkdownResume(data.review.candidate_preview)}</pre></details>
      <button className={secondaryButton} disabled={busy || active || data.input_stale} onClick={() => { setBase(data); setRevision(job.revision); setDraftBaseRevision(data.review.revision); try { localStorage.removeItem(storageKey); } catch { /* retain in memory */ } setMessage('Reconciled revision; review local edits against server content before saving.'); }}>Reconcile revision (keep edits)</button></div>}
    <div id="proposal-edits" className="space-y-2">
      {currentPassage && <section aria-label="Current passage" className="space-y-2">
        <div className="flex flex-wrap items-baseline justify-between gap-2"><h3 className="font-semibold text-sm">{currentPassage.label}</h3><p className="text-xs">{currentPassage.required ? `Decision ${requiredPassages.indexOf(currentPassage) + 1} of ${requiredPassages.length + candidateBlockers.length}` : 'Optional wording review'}</p></div>
        {currentPassage.proposals.map((p, i, all) => <JobProposalEditor key={p.id} position={{ index: i + 1, total: all.length }} proposal={p} evidence={base.captured.evidence} support={base.captured.skillSupport} disabled={busy || active} onSave={p.id === currentPassage.proposals.at(-1)?.id ? () => void save(false) : undefined} saveDisabled={stale} issues={base.review.validation.issues.filter(i => i.subject.kind === 'proposal' && i.subject.proposal_id === p.id)} requirements={base.captured.analysis.requirements.filter(r => p.requirement_ids.includes(r.id)).map(r => r.text)} grounding={draft.groundings.find(g => g.proposal_id === p.id)} onGrounding={g => setDraft(d => ({ ...d, groundings: [...d.groundings.filter(v => v.proposal_id !== p.id), ...(g ? [g] : [])] }))} onPatch={patch} />)}
      </section>}
      <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs">
        <details><summary className="cursor-pointer">Required passages ({requiredPassages.length + candidateBlockers.length})</summary><div className="flex flex-wrap gap-2 py-2">{requiredPassages.map(group => <button key={group.id} className={secondaryButton} onClick={() => setSelectedProposal(group.proposals.find(p => proposalBlockers.has(p.id))!.id)}>{group.label}</button>)}{candidateBlockers.map(path => <button key={path} className={secondaryButton} onClick={() => setSelectedProposal(`base:${path}`)}>{candidateFieldLabel(path)} (starting resume)</button>)}</div></details>
        <details><summary className="cursor-pointer">Optional proposals ({passages.filter(group => !group.required).length})</summary><div className="flex flex-wrap gap-2 py-2">{passages.filter(group => !group.required).map(group => <button key={group.id} className={secondaryButton} onClick={() => setSelectedProposal(group.proposals[0].id)}>{group.label}</button>)}</div></details>
      </div>
    </div>
    {candidateBlockers.length > 0 && <section id="starting-resume" className="space-y-1.5"><h3 className="font-semibold text-sm">Starting resume · {pluralize(candidateBlockers.length, 'location needs', 'locations need')} correction</h3>{candidateBlockers.map(path => {
      const issues = blockers.filter(i => i.subject.kind === 'candidate' && i.subject.path === path);
      const currentText = baseText(startingResume, path);
      return <div key={path} className="rounded-lg border border-amber-300 p-2 space-y-1 dark:border-amber-900">
        <div className="flex flex-wrap items-center justify-between gap-2 text-xs font-medium"><span>{candidateFieldLabel(path)} · {pluralize(issues.reduce((n, i) => n + i.details.filter(d => d.severity === 'block').length, 0), 'finding')}</span>{currentText !== undefined && <span className="text-slate-600 dark:text-slate-300">Starting wording: “{currentText}”</span>}</div>
        <IssueList issues={issues.flatMap(i => i.details)} />
        <details open={selectedProposal === `base:${path}`}><summary className="cursor-pointer text-xs font-medium underline" onClick={e => { e.preventDefault(); setSelectedProposal(`base:${path}`); }}>Edit starting wording for this job</summary>
          <JobStartingResumeCorrection job={{ ...job, revision: Math.max(job.revision, revision) }} review={base.review} resume={startingResume} path={path} disabled={busy || active || stale || dirty} onSaved={async result => {
            setBase(b => ({ ...b, review: result.review })); setRevision(result.job.revision); setDraftBaseRevision(result.review.revision);
            setMessage(`Job-local starting resume saved in revision ${result.review.revision}. ${result.review.validation.status === 'ready' ? 'Ready to continue separately.' : 'Review remaining issues.'}`);
            advance(result.review); onSaved(); await refresh();
          }} />
        </details>
      </div>;
    })}</section>}
    <JobRememberedSupport job={job} support={base.captured.skillSupport ?? []} knowledge={base.captured.knowledge} titleOf={id => evidenceTitle(base.captured.evidence, id)} refreshKey={base.corpus_revision} />
    {overlay.groundings.filter(g => !draft.removedGroundings?.includes(g.id)).map(g => <div key={g.id}><p>Saved grounding: {g.term} — {g.explanation} ({g.recorded_by})</p>{g.sources.map(s => <blockquote key={s.evidence_id}>{evidenceTitle(base.captured.evidence, s.evidence_id)}: {s.quote}</blockquote>)}<button className={secondaryButton} disabled={busy || active} onClick={() => setDraft(d => ({ ...d, removedGroundings: [...(d.removedGroundings ?? []), g.id] }))}>Remove saved grounding {g.term}</button></div>)}
    <label className="block">Correction explanation (optional unless grounding a term or remembering a rule)<textarea aria-label="Correction explanation" rows={2} className={inputClass} disabled={busy || active} value={draft.explanation} onChange={e => setDraft(d => ({ ...d, explanation: e.target.value }))} /></label>
    <details><summary>Remember a reusable relationship</summary>
      <p>No relationship is inferred from a rejection. Enter a correction explanation above and select a newly entered grounding decision.</p>
      <label className="block">Grounding to remember<select className={inputClass} value={memoryProposal} onChange={e => setMemoryProposal(e.target.value)}><option value="">Choose grounding</option>{draft.groundings.map(g => <option key={g.proposal_id} value={g.proposal_id}>'{g.term}' in {passages.find(group => group.proposals.some(p => p.id === g.proposal_id))?.label ?? 'this resume'}</option>)}</select></label>
      <label className="block">Canonical skill<input className={inputClass} value={skill} onChange={e => setSkill(e.target.value)} /></label>
      <label className="block">Precise facet<input className={inputClass} value={facet} onChange={e => setFacet(e.target.value)} /></label>
      <label className="block">Support level<select className={inputClass} value={support} onChange={e => setSupport(e.target.value as typeof support)}>{supportOptions.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
      <label className="block">Memory scope<select className={inputClass} value={scopeKind} onChange={e => setScopeKind(e.target.value as CorpusScope['kind'])}>{scopeOptions.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
      {scopeKind !== 'workspace' && scopeKind !== 'job' && <label className="block">Exact scope key<input className={inputClass} value={scopeKey} onChange={e => setScopeKey(e.target.value)} /></label>}
      {memoryGrounding && <div aria-label="Memory preview" className="space-y-1"><h3 className="font-semibold">What will be remembered</h3>
        <p>{supportDescription({ permitted_terms: [memoryGrounding.term], support, sources: [{ evidence_id: memoryGrounding.evidence_id }] }, id => evidenceTitle(base.captured.evidence, id))}.</p>
        <p>{scope.kind === 'workspace' || scope.key.trim() ? appliesTo(scope, { currentJobId: job.id }) : 'Applies to: enter the exact name below'}. Skill: {skill || '(enter a skill)'}{facet ? ` (${facet})` : ''}. Only the wording “{memoryGrounding.term}” is permitted.</p>
        <blockquote>{evidenceTitle(base.captured.evidence, memoryGrounding.evidence_id)}: {memoryGrounding.quote}</blockquote><p>Why: {memoryGrounding.explanation}</p>
        <details className="text-xs"><summary className="cursor-pointer">Details</summary><p>Bound to the captured version of this source; if the source changes before you save, saving is prevented.</p></details></div>}
      <button className={secondaryButton} disabled={busy || active || stale || !memoryReady} onClick={() => void save(true)}>Save and remember</button>
    </details>
    <div id="review-actions" className="flex flex-wrap items-center gap-2">
      {!currentPassage && <button className={primaryButton} disabled={busy || active || stale} onClick={() => void save(false)}>Save for this job</button>}
      <details><summary>Check diagnostics</summary><button className={secondaryButton} disabled={busy || dirty || active || stale} onClick={() => void run(async () => { const result = await apiClient.recheckJobProposals(job.id, base.review.id, binding); setBase(b => ({ ...b, review: result.review })); setMessage(`Rechecked: ${result.review.validation.status}`); if (result.review.validation.status === 'blocked') focusRequested.current = true; })}>Recheck saved revision</button></details>
      <button className={primaryButton} disabled={busy || dirty || active || stale || base.input_stale || base.review.validation.status !== 'ready'} onClick={() => void run(async () => { const body = { ...binding, validation_fingerprint: base.review.validation.fingerprint }; await apiClient.continueJobProposals(job.id, base.review.id, { ...body, idempotency_key: key(body) }); setMessage(`Started preparation with saved revision ${base.review.revision}.`); onSaved(); })}>Continue preparation</button>
      {blockers.length > 0 && <span className="text-xs text-slate-600 dark:text-slate-300">Resolve all {pluralize(blockers.length, 'blocker')} and save to enable Continue preparation.</span>}
    </div>
    <section id="refresh-inputs" className="space-y-2">
      {data.input_stale && <p role="alert">This review belongs to older inputs; saved changes remain in history. New preparation reapplies job-local starting-resume corrections where the shared wording is unchanged, but not proposal edits or groundings. {dirty && 'Preserve your unsaved text before changing versions; stale inputs cannot be saved.'}</p>}
      <p>Refresh inputs captures a new snapshot only. Saved reviews and browser drafts remain intact.</p>
      <button className={secondaryButton} disabled={busy || active || dirty} onClick={() => void run(async () => { try { const { unapplied_base_corrections: unapplied = [] } = await apiClient.captureJobInputs(job.id, job.revision); setMessage(`Inputs refreshed. ${unapplied.length ? `Your shared resume changed at ${unapplied.map(c => candidateFieldLabel(c.path)).join(', ')}; reapply those job-local corrections after preparing. ` : ''}Prepare the new version separately.`); } finally { onSaved(); await refresh(); } })}>Refresh inputs</button>
      {refreshedInput && action && <button className={primaryButton} disabled={busy || dirty} onClick={() => void run(async () => { const body = { expected_revision: job.revision, input_snapshot_id: refreshedInput }; await apiClient.prepareJob(job.id, action, { ...body, idempotency_key: key({ action, ...body }) }); setMessage('New preparation version requested.'); onSaved(); await refresh(); })}>Prepare refreshed inputs</button>}
    </section>
    <details><summary>Inspect saved candidate</summary><h3>Saved candidate preview {dirty ? '(does not include unsaved edits)' : ''}</h3><pre className="whitespace-pre-wrap break-words text-xs">{compileMarkdownResume(base.review.candidate_preview)}</pre></details>
    <details><summary>Historical reviews and generations</summary>{data.history.map(r => <details key={`${r.id}:${r.revision}`}><summary>Revision {r.revision} · {r.generation_id} · {r.created_at}</summary><pre className="whitespace-pre-wrap break-words text-xs">{compileMarkdownResume(r.candidate_preview)}</pre></details>)}</details>
    <p role="status">{message}</p>
  </section>;
}
export function JobProposalReview({ job, onSaved }: { job: Job; onSaved: () => void }) {
  const load = useCallback(() => apiClient.getJobProposals(job.id), [job.id]);
  const { data, error, refresh } = useJobsData(load);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const key = useIntentKey();
  if (error && !data) return <p role="alert">{error}</p>;
  if (!data) return <p role="status">Loading proposal review…</p>;
  if (data.availability === 'available') return <Editor key={`${job.workspace_id}:${job.id}:${data.generation.id}`} job={job} data={data} onSaved={onSaved} refresh={refresh} loadError={error ?? undefined} />;
  return <section className={`${cardClass} p-4 space-y-3`}>{error && <p role="alert">{error} Showing the last successfully loaded review status; it will refresh when the host responds.</p>}<h2>Proposal review unavailable</h2>{stoppedByUser(job) ? <p>Stopped. Output that arrived after Stop was discarded. To prepare again, open Automatic work controls and choose Start automatic preparation, then Retry this job.</p> : <p>Missing historical output cannot be reconstructed from error messages. Recovery reuses saved context and generates proposals once for inspection.</p>}
    {data.recoverable && data.input_snapshot_id && <button className={primaryButton} disabled={busy} onClick={async () => { setBusy(true); try { const body = { expected_job_revision: job.revision, input_snapshot_id: data.input_snapshot_id! }; await apiClient.recoverJobProposals(job.id, { ...body, idempotency_key: key(body) }); setMessage('Recovery started. The generated proposals will be retained for inspection.'); onSaved(); await refresh(); } catch (e) { setMessage(e instanceof Error ? e.message : 'Recovery prevented'); } finally { setBusy(false); } }}>Recover proposal review</button>}
    {data.latest_input_snapshot_id && data.latest_input_snapshot_id !== data.input_snapshot_id && preparationActionFor(job) && <button className={primaryButton} disabled={busy} onClick={async () => { setBusy(true); try { const action = preparationActionFor(job)!; const body = { expected_revision: job.revision, input_snapshot_id: data.latest_input_snapshot_id! }; await apiClient.prepareJob(job.id, action, { ...body, idempotency_key: key({ action, ...body }) }); onSaved(); await refresh(); } catch (e) { setMessage(e instanceof Error ? e.message : 'Preparation prevented'); } finally { setBusy(false); } }}>Prepare refreshed inputs</button>}
    {!data.recoverable && !stoppedByUser(job) && <p>Use Posting to inspect setup and explicitly prepare a new version.</p>}<p role="status">{message}</p></section>;
}
