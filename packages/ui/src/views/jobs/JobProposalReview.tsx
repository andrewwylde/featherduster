import { JobFacts } from './JobFacts.js';
import { ResumeDraftSurface, resumeReviewRows, type ResumeReviewNavigation } from './ResumeDraftSurface.js';
import { JobStartingResumeCorrection } from './JobStartingResumeCorrection.js';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  applyProposalPatches,
  applyProposals,
  originalPassagePath,
  makeAccomplishmentOmission,
  baseText,
  compileMarkdownResume,
  effectiveBaseResume,
  sameFact,
  SYNTHESIS_POLICY,
  isFindingStaleForPreview,
  computeUnifiedReviewSummary,
  type CorpusScope,
  type Job,
  type JobFacts as Facts,
  type ProposalPatch,
  type ProposalReadResponse,
  type ProposalReviewRevision,
  type ProposalSaveRequest,
} from '@featherduster/core';
import { apiClient } from '../../api/client.js';
import { useIntentKey, useJobsData } from '../../hooks/useJobsData.js';
import { cardClass, inputClass, IssueList, primaryButton, secondaryButton } from '../tailoring/ui.js';
import { evidenceTitle, JobProposalEditor, type GroundingDraft } from './JobProposalEditor.js';
import { pluralize, preparationActionFor, requestErrorMessage, stoppedByUser } from './job-utils.js';
import { JobRememberedSupport } from './JobRememberedSupport.js';
import { appliesTo, supportDescription } from '../../components/corpus-labels.js';
import { JobPassagesDrawer, type PassageDrawerItem } from './JobPassagesDrawer.js';
import { JobProposalCompletion } from './JobProposalCompletion.js';
import { FileText } from 'lucide-react';

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

function Editor({
  job,
  data,
  onSaved,
  refresh,
  loadError,
  selectTarget,
  initialFacts,
}: {
  job: Job;
  data: Available;
  onSaved: () => void;
  refresh: () => Promise<void>;
  loadError?: string;
  selectTarget?: { id: string; sequence: number };
  initialFacts?: Facts;
}) {
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
  const focusSaveRequested = useRef(false);
  const saveDraftButton = useRef<HTMLButtonElement>(null);
  useEffect(() => { if (focusSaveRequested.current) { focusSaveRequested.current = false; saveDraftButton.current?.focus(); saveDraftButton.current?.scrollIntoView?.({ block: 'center' }); } }, [draft]);
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
  const startingFields = [...new Set([...candidateBlockers, ...(selectedProposal.startsWith('base:') ? [selectedProposal.slice(5)] : [])])];

  const [startingDrafts, setStartingDrafts] = useState<Map<string, { path: string; text: string; citations?: string[]; before: string }>>(new Map());
  const updateStartingDraft = useCallback((path: string, item: { path: string; text: string; citations?: string[]; before: string } | null) => {
    setStartingDrafts(prev => {
      const next = new Map(prev);
      if (item) next.set(path, item);
      else next.delete(path);
      return next;
    });
  }, []);
  const [autoSaveStatus, setAutoSaveStatus] = useState<string>('');
  const autoSaveTimerRef = useRef<NodeJS.Timeout | null>(null);
  const autoSavePendingRef = useRef(false);

  const saveMixedDrafts = useCallback(async () => {
    if (busy || autoSavePendingRef.current) return;
    autoSavePendingRef.current = true;
    setAutoSaveStatus('Saving...');
    setBusy(true);

    const base_corrections = Array.from(startingDrafts.values()).map(c => ({
      path: c.path,
      before: c.before,
      after: c.text,
      citations: c.citations,
    }));
    const generated_patches = draft.patches.map(p => ({
      proposal_id: p.proposal_id,
      before: base.review.patches.find(item => item.proposal_id === p.proposal_id)?.edited_after
        ?? base.generation.proposals.proposals.find(item => item.id === p.proposal_id)?.after,
      after: p.edited_after ?? '',
      edited_after: p.edited_after,
      citations: p.citations,
      decision: p.decision,
      order: p.order,
      skills: p.skills,
      omission: p.omission,
    }));

    const mutation = {
      expected_revision: base.review.revision,
      idempotency_key: key({ base_corrections, generated_patches, rev: base.review.revision }),
      base_corrections,
      generated_patches,
    };

    try {
      const response = await apiClient.saveMixedDraftEdits(job.id, mutation);
      setAutoSaveStatus('Saved');
      setBase(b => ({ ...b, review: response.review }));
      setRevision(response.job.revision);
      setDraftBaseRevision(response.review.revision);
      setStartingDrafts(new Map());
      setDraft(empty());
      setMessage(`Saved mixed edits in revision ${response.review.revision}.`);
      onSaved();
      await refresh();
    } catch (error: any) {
      const msg = error?.message || String(error);
      if (/stale|conflict|revision/i.test(msg)) {
        setAutoSaveStatus('Conflict: edit rejected');
        setMessage('Conflict: edit rejected. The draft revision is stale; please refresh.');
      } else {
        setAutoSaveStatus('Error saving');
        setMessage(requestErrorMessage(error, { timeout: 'Save timed out. Your draft is retained.', fallback: 'Save failed. Your draft is retained.' }));
      }
    } finally {
      autoSavePendingRef.current = false;
      setBusy(false);
    }
  }, [busy, startingDrafts, draft.patches, base.review.revision, base.review.patches, base.generation.proposals.proposals, job.id, key, onSaved, refresh]);

  useEffect(() => {
    if (busy || active || stale) return;
    if (startingDrafts.size > 0 && draft.patches.length > 0) {
      if (autoSaveTimerRef.current) clearTimeout(autoSaveTimerRef.current);
      autoSaveTimerRef.current = setTimeout(() => {
        void saveMixedDrafts();
      }, 500);
      return () => {
        if (autoSaveTimerRef.current) clearTimeout(autoSaveTimerRef.current);
      };
    }
  }, [startingDrafts, draft.patches, busy, active, stale, saveMixedDrafts]);

  // Drawer and Semantic Facts state
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [factsData, setFactsData] = useState<Facts | null>(() => initialFacts ?? null);
  const resumeNavigation = useRef<ResumeReviewNavigation>(null);
  const [confirmedFacts, setConfirmedFacts] = useState<Record<string, boolean>>({});
  const factReadSequence = useRef(0);
  const factsBinding = useRef({ job: job.id, review: base.review.id, revision: base.review.revision });
  factsBinding.current = { job: job.id, review: base.review.id, revision: base.review.revision };
  useEffect(() => () => { factReadSequence.current++; }, []);

  const acceptFacts = useCallback((f: Facts) => {
    if (f.target?.kind === 'review' && (f.target.review_id !== factsBinding.current.review || f.target.review_revision !== factsBinding.current.revision)) return;
    setFactsData(previous => previous && previous.input_fingerprint === f.input_fingerprint && previous.candidate_fingerprint === f.candidate_fingerprint && previous.semantic_revision > f.semantic_revision ? previous : f);
  }, []);

  const reloadFacts = useCallback(async () => {
    const sequence = ++factReadSequence.current;
    try {
      const f = await apiClient.getJobFacts(job.id);
      if (sequence !== factReadSequence.current || job.id !== factsBinding.current.job
        || f.target?.kind === 'review' && (f.target.review_id !== factsBinding.current.review || f.target.review_revision !== factsBinding.current.revision)) return;
      acceptFacts(f);
    } catch { /* optional facts */ }
  }, [job.id]);

  useEffect(() => {
    void reloadFacts();
  }, [reloadFacts, base.review.revision]);

  useEffect(() => {
    if (factsData?.execution !== 'checking') return;
    const timer = setTimeout(() => void reloadFacts(), 2000);
    return () => clearTimeout(timer);
  }, [factsData, reloadFacts]);

  useEffect(() => { if (selectTarget) { setSelectedProposal(selectTarget.id); focusRequested.current = true; } }, [selectTarget]);
  useEffect(() => {
    if (!dirty && data.review.revision > base.review.revision) { setBase(data); setDraftBaseRevision(data.review.revision); setRevision(job.revision); }
  }, [data, dirty, base.review.revision, job.revision]);

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
  const omitAccomplishment = (path: string, text: string) => {
    try {
      const omission = makeAccomplishmentOmission(startingResume, overlay.proposals, path, text, crypto.randomUUID());
      const existing = overlay.patches.find(p => p.omission && JSON.stringify(p.omission) === JSON.stringify(omission.omission));
      patch(existing ? { proposal_id: existing.proposal_id, decision: 'pending' } : omission);
      focusSaveRequested.current = true;
      setMessage('Accomplishment left out of this draft. Save draft to apply it. You can restore it under Changes.');
    } catch (e) { setMessage(e instanceof Error ? e.message : 'Could not identify this accomplishment.'); }
  };
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
    const remaining = response.result.review.validation.issues.filter(issue => issue.subject.kind === 'proposal'
      && currentPassage?.proposals.some(p => issue.subject.kind === 'proposal' && p.id === issue.subject.proposal_id))
      .flatMap(issue => issue.details.filter(d => d.severity === 'block'));
    setMessage(`Saved revision ${response.result.review.revision}. ${remaining.length
      ? `This passage still needs changes: ${[...new Set(remaining.map(d => d.message))].join(' ')} Your edits are saved, but this passage has not passed checks.`
      : response.result.review.validation.status === 'ready' ? 'Checks passed. Continue preparation when ready.'
      : 'This passage passed checks. The next required correction is open below.'}${response.result.requires_refresh ? ' Explicit input refresh required.' : ''}`);
    if (!remaining.length) advance(response.result.review);
    else focusRequested.current = true;
    onSaved(); await refresh();
  }, 'The save is taking longer than expected. Your edits are kept in this browser; try again.');

  const advance = (review: ProposalReviewRevision) => {
    const next = review.validation.issues.find(i => i.subject.kind === 'proposal' && i.details.some(d => d.severity === 'block'));
    if (next?.subject.kind === 'proposal') { setSelectedProposal(next.subject.proposal_id); focusRequested.current = true; }
    else { const nextBase = review.validation.issues.find(i => i.subject.kind === 'candidate' && i.details.some(d => d.severity === 'block')); setSelectedProposal(nextBase?.subject.kind === 'candidate' ? `base:${nextBase.subject.path}` : ''); focusRequested.current = !!nextBase; }
  };

  const focusBlocker = () => {
    if (selectedProposal && !selectedProposal.startsWith('base:')) document.querySelector<HTMLElement>(`[data-proposal-field="${CSS.escape(selectedProposal)}"]`)?.focus();
    else document.querySelector<HTMLElement>('#starting-resume details[open] textarea')?.focus();
  };

  useEffect(() => {
    if (!busy && !stale && focusRequested.current) { focusRequested.current = false; focusBlocker(); }
  }, [busy, stale, base.review, selectedProposal]);

  // Drawer items
  const drawerItems: PassageDrawerItem[] = [
    ...candidateBlockers.map(path => ({
      id: `base:${path}`,
      label: `${candidateFieldLabel(path)} (Starting resume)`,
      status: 'blocker' as const,
      candidatePath: path,
    })),
    ...passages.map(group => {
      const hasBlocker = group.proposals.some(p => proposalBlockers.has(p.id));
      const fact = factsData?.facts.find(f => group.proposals.some(p => f.passage.subject.proposal_id === p.id));
      const status = hasBlocker
        ? ('blocker' as const)
        : fact && fact.state !== 'supported' && !confirmedFacts[fact.claim.id]
        ? ('fact_needed' as const)
        : fact?.resolution ? ('passing' as const) : ('fact_needed' as const);
      return {
        id: group.proposals[0]?.id ?? group.id,
        label: group.label,
        status,
        proposalId: group.proposals[0]?.id,
      };
    }),
  ];

  // Active queue
  const queue = [
    ...candidateBlockers.map(path => `base:${path}`),
    ...requiredPassages.map(g => g.proposals.find(p => proposalBlockers.has(p.id))?.id).filter(Boolean) as string[],
  ];
  const currentQueueIndex = queue.indexOf(selectedProposal);

  const activeProposal = currentPassage?.proposals[0];
  const matchingFact = factsData?.facts.find(f =>
    activeProposal && (f.passage.subject.proposal_id === activeProposal.id || f.claim.id === activeProposal.after || f.claim.id === activeProposal.before)
  );
  const factConfirmed = matchingFact ? !!confirmedFacts[matchingFact.claim.id] || matchingFact.resolution?.provenance === 'human' : false;

  const handleConfirmFact = async () => {
    if (!matchingFact || !factsData) return;
    try {
      const assertion = 'I confirm this claim describes my work.';
      await apiClient.saveJobFactClarification(job.id, {
        target: factsData.target,
        expected_job_revision: factsData.job_revision,
        expected_semantic_revision: factsData.semantic_revision,
        input_fingerprint: factsData.input_fingerprint,
        idempotency_key: crypto.randomUUID(),
        claim_ids: [matchingFact.claim.id],
        fact: matchingFact.claim.fact,
        assertion,
        confirmed: true,
        kind: matchingFact.state === 'contradicted' ? 'correction' : 'confirmation',
        source_ids: matchingFact.evidence.map(e => e.evidence_id),
        supersedes: factsData.clarifications.find(c => sameFact(c.fact, matchingFact.claim.fact))?.id ?? null,
      });
      setConfirmedFacts(prev => ({ ...prev, [matchingFact.claim.id]: true }));
      await reloadFacts();
      setMessage('Fact confirmed for this job.');
    } catch (e) {
      setMessage(e instanceof Error ? e.message : 'Unable to confirm fact.');
    }
  };

  const generatePdfAction = async () => {
    await run(async () => {
      const body = { ...binding, validation_fingerprint: base.review.validation.fingerprint };
      await apiClient.continueJobProposals(job.id, base.review.id, { ...body, idempotency_key: key(body) });
      setMessage(`Started preparation with saved revision ${base.review.revision}.`);
      onSaved();
    });
  };

  const autoContinued = useRef('');
  const autoChecked = useRef('');
  const unified = base.generation.generation_policy === SYNTHESIS_POLICY;
  const recheckInFlight = useRef<Promise<void>>();
  const [refreshingChecks, setRefreshingChecks] = useState(false);
  const recheckSaved = () => {
    if (recheckInFlight.current) return recheckInFlight.current;
    if (refreshingChecks || factsData?.execution === 'checking') return Promise.resolve();
    setRefreshingChecks(true);
    const run = async () => {
    const latest = await apiClient.getJob(job.id);
    const view = await apiClient.getJobProposals(job.id);
    if (view.availability !== 'available') return;
    const result = await apiClient.recheckJobProposals(job.id, view.review.id, { expected_job_revision: latest.job.revision,
      expected_review_revision: view.review.revision, input_fingerprint: view.review.input_fingerprint });
    setBase({ ...view, review: result.review }); setRevision(latest.job.revision); setDraftBaseRevision(result.review.revision);
    await reloadFacts(); onSaved(); await refresh();
    };
    recheckInFlight.current = run().finally(() => { recheckInFlight.current = undefined; setRefreshingChecks(false); });
    return recheckInFlight.current;
  };
  useEffect(() => {
    if (!unified || busy || dirty || stale || active || !factsData || job.preparation_state !== 'needs_input') return;
    const identity = `${base.review.id}:${factsData.support_fingerprint}:${factsData.execution}`;
    if (autoChecked.current === identity || factsData.execution === 'checking' || factsData.execution === 'unavailable') return;
    autoChecked.current = identity;
    if (factsData.execution === 'unchecked') {
      void apiClient.startJobFactCheck(job.id, { target: factsData.target, input_fingerprint: factsData.input_fingerprint,
        expected_job_revision: factsData.job_revision, expected_semantic_revision: factsData.semantic_revision,
        reason: 'edit', idempotency_key: key({ check: identity }) }).then(reloadFacts).catch(e => setMessage(`Saved. Checking needs retry: ${e.message}`));
    } else if (base.review.validation.status !== 'ready' && factsData.facts.length && factsData.facts.every(f => f.resolution)) {
      void recheckSaved().catch(e => setMessage(`Saved. Resume checks need retry: ${e.message}`));
    }
  }, [unified, base.review, factsData, busy, dirty, stale, active, job.preparation_state]);
  useEffect(() => {
    if (base.generation.generation_policy !== SYNTHESIS_POLICY || busy || dirty || stale || active || job.preparation_state !== 'needs_input'
      || base.review.validation.status !== 'ready' || !factsData?.facts.length || !factsData.facts.every(f => f.resolution)) return;
    const identity = `${base.review.id}:${base.review.revision}`;
    if (autoContinued.current === identity) return;
    autoContinued.current = identity;
    void generatePdfAction();
  }, [base.review, factsData, busy, dirty, stale, active, job.preparation_state]);

  const unifiedResume = unified ? applyProposals(startingResume, overlay.proposals.map(p => ({ ...p, checks: [], decision: p.decision === 'rejected' ? 'rejected' : 'accepted' }))) : startingResume;
  const reviewRows = unified ? resumeReviewRows(unifiedResume, overlay.proposals, factsData, base.review.validation.issues) : [];
  const hasRetainedAnswers = reviewRows.some(r => r.status === 'Needs saving');
  const hasQuestions = reviewRows.some(r => r.status === 'Needs your answer');
  const changeCount = reviewRows.filter(r => r.status === 'Needs changes').length;
  const hasChanges = changeCount > 0;
  const factsComplete = factsData?.execution === 'complete' && factsData.facts.length > 0 && factsData.facts.every(f => !!f.resolution);
  const hasRetry = reviewRows.some(r => r.status === 'Needs retry');
  const checkingFacts = refreshingChecks || !factsData || factsData.execution === 'checking';

  const unifiedSummary = computeUnifiedReviewSummary({
    facts: factsData ?? undefined,
    issues: base.review.validation.issues,
    isChecking: refreshingChecks || factsData?.execution === 'checking',
    hasPdf: !!job.artifact_version_ids?.length,
    isApproved: false,
  });

  const summaryHeader = (
    <div data-testid="unified-review-summary" className="p-3 bg-slate-50 dark:bg-slate-900/60 rounded-xl border border-slate-200 dark:border-slate-800 space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <span
            data-testid="fact-count-badge"
            className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-amber-100 text-amber-800 dark:bg-amber-950/40 dark:text-amber-300"
          >
            {unifiedSummary.unresolved_facts_count} {unifiedSummary.unresolved_facts_count === 1 ? 'fact needs answer' : 'facts need answer'}
          </span>
          <span
            data-testid="wording-issue-badge"
            className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-rose-100 text-rose-800 dark:bg-rose-950/40 dark:text-rose-300"
          >
            {unifiedSummary.wording_issues_count} {unifiedSummary.wording_issues_count === 1 ? 'wording issue' : 'wording issues'}
          </span>
          <span
            data-testid="technical-retry-badge"
            className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-sky-100 text-sky-800 dark:bg-sky-950/40 dark:text-sky-300"
          >
            {unifiedSummary.technical_failures_count} {unifiedSummary.technical_failures_count === 1 ? 'technical check needs retry' : 'technical checks need retry'}
          </span>
          <span
            data-testid="supported-claims-summary"
            className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-emerald-100 text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300"
          >
            {unifiedSummary.supported_claims_count} {unifiedSummary.supported_claims_count === 1 ? 'claim supported' : 'claims supported'}
          </span>
        </div>
        <div
          data-testid="primary-next-action"
          className="text-xs font-semibold text-slate-700 dark:text-slate-300"
        >
          {unifiedSummary.primary_next_action === 'wait_checking' && 'Checking in progress...'}
          {unifiedSummary.primary_next_action === 'answer_facts' && 'Answer facts to continue'}
          {unifiedSummary.primary_next_action === 'fix_wording' && 'Fix wording issues'}
          {unifiedSummary.primary_next_action === 'retry_technical' && 'Retry failed technical checks'}
          {unifiedSummary.primary_next_action === 'review_pdf' && 'Review generated PDF'}
          {unifiedSummary.primary_next_action === 'ready_to_approve' && 'Ready for final approval'}
        </div>
      </div>
    </div>
  );

  if (unified) return <section aria-label="Resume review" className="space-y-4">
    {summaryHeader}
    <div role="status" className="rounded-xl border border-amber-300 bg-amber-50 p-4 space-y-2 text-amber-950 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-100">
      <h2 className="font-semibold">{active ? 'Generating your PDF' : dirty ? 'Save your changes to continue' : base.review.validation.status === 'ready' ? 'Your draft is ready for PDF generation' : hasRetainedAnswers ? 'Finish saving your earlier answers' : hasQuestions ? 'Your draft has unanswered factual questions' : checkingFacts ? 'Checking the saved facts' : hasChanges ? factsComplete ? 'Factual answers complete; wording or evidence needs attention' : 'Wording or evidence needs attention' : hasRetry ? 'Evidence checks need retry' : 'Resume checks need an update'}</h2>
      <p className="text-sm">{active ? 'Your required checks passed. The PDF will appear here when it is ready.' : dirty ? 'Your edits are kept in this browser. Choose Save draft to check the updated wording.' : base.review.validation.status === 'ready' ? 'The PDF will be generated automatically after the final evidence checks.' : hasRetainedAnswers ? 'Earlier answers are retained, but still need saving or confirmation. Open the existing answer below; you do not need to enter it again.' : hasQuestions ? 'Your saved confirmations are retained. Open the next unanswered question below. Your PDF follows when all required checks pass.' : checkingFacts ? 'Wait for the evidence checks to finish. Saved answers are retained.' : hasChanges ? `${changeCount} ${changeCount === 1 ? 'passage still needs' : 'passages still need'} changes. Choose Review remaining changes to open the affected wording and its evidence. You do not need to answer the completed questions again.` : hasRetry ? 'Choose Review evidence checks to open the check that needs retrying. Your saved answers are retained.' : 'Choose Update resume checks below to check this saved draft again. Your saved answers are retained.'}</p>
      {message && <p className="text-sm">{message}</p>}
      {!active && !dirty && !checkingFacts && base.review.validation.status !== 'ready' && (hasRetainedAnswers || hasQuestions || hasChanges || hasRetry) && <button className={secondaryButton} disabled={busy || stale} onClick={() => resumeNavigation.current?.reviewNext()}>{hasRetainedAnswers ? 'Finish saving answers' : hasQuestions ? 'Review the next question' : hasChanges ? 'Review remaining changes' : 'Review evidence checks'}</button>}
      {!active && !dirty && !checkingFacts && !hasRetainedAnswers && !hasQuestions && !hasChanges && !hasRetry && base.review.validation.status !== 'ready' && <div className="space-y-2">
        {blockers.flatMap(i => i.details).filter(d => d.severity === 'block').map((d, i) => <p key={i}>{d.message}</p>)}
        <button className={secondaryButton} disabled={busy || stale} onClick={() => void recheckSaved().catch(e => setMessage(`Resume checks need retry: ${e.message}`))}>Update resume checks</button>
      </div>}
    </div>
    {(loadError || overlayError) && <p role="alert">{loadError || overlayError}</p>}
    {stale && <p role="alert">The saved review changed. Your local edits are retained. <button className={secondaryButton} onClick={() => { setBase(data); setRevision(job.revision); setDraftBaseRevision(data.review.revision); }}>Reconcile current review and keep edits</button></p>}
    <button ref={saveDraftButton} className={primaryButton} disabled={busy || active || stale || (!dirty && startingDrafts.size === 0)} onClick={() => startingDrafts.size > 0 ? void saveMixedDrafts() : void save(false)}>Save draft</button>
    <ResumeDraftSurface ref={resumeNavigation} resume={unifiedResume}
      proposals={overlay.proposals} omissions={overlay.patches.filter(p => p.omission)} facts={factsData} issues={base.review.validation.issues} evidence={base.captured.evidence} workspaceId={job.workspace_id}
      disabled={busy || active || stale} onSelect={setSelectedProposal} onToggle={(id, rejected) => patch({ proposal_id: id, decision: rejected ? 'rejected' : 'pending' })}
      renderResolution={(id, path, text, navigation) => {
        const proposal = overlay.proposals.find(p => p.id === id);
        const originalPath = originalPassagePath(startingResume, path, text);
        return <div className="space-y-3">
          {dirty ? <p>Save draft to check the changed wording and evidence.</p> : !active && !stale && <JobFacts jobId={job.id} passagePath={path} passageText={text} focusRequest={navigation.focusRequest} wordingChangesRequired={navigation.action === 'Needs changes'} checksPending={refreshingChecks} onFactsChanged={acceptFacts} onResolved={recheckSaved} />}
          <details key={`${id}:${navigation.focusRequest}`} open={navigation.action === 'Needs changes'}><summary className="cursor-pointer font-medium underline">Edit wording or evidence instead</summary>
          {path.startsWith('experiences.') && <div className="space-y-2 py-2"><button className={secondaryButton} disabled={busy || active || stale} onClick={() => omitAccomplishment(path, text)}>Leave out of this draft</button><p className="text-xs">Removes this whole accomplishment from this job’s resume. Restore it later under Changes.</p></div>}
          {proposal ? <JobProposalEditor proposal={proposal} position={{ index: 1, total: 1 }} evidence={base.captured.evidence} support={base.captured.skillSupport}
            disabled={busy || active || stale} onPatch={patch} onSave={() => void save(false)} saveDisabled={stale}
            issues={base.review.validation.issues.filter(i => i.subject.kind === 'proposal' && i.subject.proposal_id === id)}
            requirements={base.captured.analysis.requirements.filter(r => proposal.requirement_ids.includes(r.id)).map(r => r.text)}
            grounding={draft.groundings.find(g => g.proposal_id === id)} onGrounding={g => setDraft(d => ({ ...d, groundings: [...d.groundings.filter(v => v.proposal_id !== id), ...(g ? [g] : [])] }))} />
            : originalPath ? <JobStartingResumeCorrection key={originalPath} job={{ ...job, revision }} review={base.review} resume={startingResume} path={originalPath} evidence={base.captured.evidence} disabled={busy || active || stale}
              onDraftChange={change => updateStartingDraft(originalPath, change)} autoSaveStatus={autoSaveStatus} onSaveMixed={startingDrafts.size > 0 && draft.patches.length > 0 ? () => void saveMixedDrafts() : undefined}
              onSaved={result => { setBase(b => ({ ...b, review: result.review })); setRevision(result.job.revision); setDraftBaseRevision(result.review.revision); void reloadFacts(); onSaved(); void refresh(); }} /> : <p>This wording has multiple possible original targets. Undo the associated change before editing it.</p>}
          </details>
        </div>;
      }} />
    {base.review.validation.status === 'ready' && !active && !dirty && <button className={secondaryButton} disabled={busy || stale} onClick={() => void generatePdfAction()}>Retry PDF generation</button>}
  </section>;

  return (
    <section aria-label="Proposal resolution" className={`${cardClass} proposal-review text-slate-900 dark:text-slate-100 p-4 sm:p-6 space-y-5 min-w-0 break-words`}>
      {summaryHeader}
      {autoSaveStatus && <p role="status" data-testid="auto-save-status" className="text-sm font-semibold text-sky-600 dark:text-sky-400">{autoSaveStatus}</p>}
      {loadError && <p role="alert">{loadError} Showing the last successfully loaded review; it will refresh when the host responds.</p>}
      {overlayError && <p role="alert">{overlayError}. Showing the captured starting resume; this saved correction cannot be checked or continued.</p>}

      {/* Primary Stepper Progress Bar Header */}
      {blockers.length > 0 && (
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 p-3.5 rounded-xl bg-slate-50 dark:bg-slate-900/60 border border-slate-200 dark:border-slate-800">
          <div>
            <div className="flex items-center gap-2">
              <span className="text-[11px] font-semibold uppercase tracking-wider text-amber-600 dark:text-amber-400">
                Review Required
              </span>
              <span className="text-slate-400">·</span>
              <span className="text-xs text-slate-500 dark:text-slate-400">
                {blockers.length} {blockers.length === 1 ? 'blocker' : 'blockers'} to resolve
              </span>
            </div>
            <p className="text-sm font-bold text-slate-900 dark:text-white mt-0.5">
              {currentQueueIndex >= 0 ? `Passage ${currentQueueIndex + 1} of ${queue.length} needing review` : currentPassage?.label ?? 'Passage review'}
            </p>
          </div>

          <div className="flex items-center gap-3">
            <div className="w-24 sm:w-32 bg-slate-200 dark:bg-slate-800 h-2 rounded-full overflow-hidden">
              <div
                className="bg-emerald-500 h-full rounded-full transition-all duration-300"
                style={{ width: `${Math.round(((drawerItems.length - blockers.length) / Math.max(1, drawerItems.length)) * 100)}%` }}
              />
            </div>
            <button
              type="button"
              onClick={() => setDrawerOpen(true)}
              className={`${secondaryButton} text-xs py-1.5 px-2.5 inline-flex items-center gap-1.5`}
            >
              <FileText className="h-3.5 w-3.5 text-slate-500" />
              <span>All passages ({drawerItems.length})</span>
            </button>
          </div>
        </div>
      )}

      {/* Accessible Header with Status Badges and Requirements Overview */}
      <header className="space-y-1.5 border-b border-slate-200 dark:border-slate-800 pb-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-vermilion-600">Resume correction</p>
            <h2 className="text-base font-bold">Proposal review</h2>
          </div>
          <span className={`rounded-full px-3 py-0.5 text-xs font-semibold ${blockers.length ? 'bg-amber-100 text-amber-900 dark:bg-amber-950/50 dark:text-amber-200' : 'bg-emerald-100 text-emerald-900 dark:bg-emerald-950/50 dark:text-emerald-200'}`}>
            {blockers.length ? pluralize(blockers.length, 'blocker') : 'Ready to continue'}
          </span>
        </div>

        {blockers.length ? (
          <details className="text-xs">
            <summary className="cursor-pointer">
              Review overview · {pluralize(requiredPassages.length + candidateBlockers.length, 'required passage')}
            </summary>
            <p className="pt-1">
              {proposalBlockers.size ? <>Resolve <strong>{pluralize(proposalBlockers.size, 'proposed edit')}</strong> and </> : <>Generated proposals have no blocking findings. </>}
              {candidateBlockers.length ? <>Update <strong>{pluralize(candidateBlockers.length, 'location in the starting resume')}</strong>. </> : null}
              Save checks your correction. Continue separately when all required passages are resolved.
            </p>
          </details>
        ) : (
          <p className="text-xs">The saved review passes validation. Continue preparation when you are ready; PDF approval comes later.</p>
        )}

        {currentPassage?.required && (() => {
          const activeIssue = blockers.find(issue => issue.subject.kind === 'proposal' && currentPassage.proposals.some(p => issue.subject.kind === 'proposal' && p.id === issue.subject.proposal_id));
          const matchingProposal = currentPassage.proposals.find(p => activeIssue?.subject.kind === 'proposal' && p.id === activeIssue.subject.proposal_id);
          const previewText = matchingProposal ? (matchingProposal.edited_after ?? matchingProposal.after) : '';
          const detail = activeIssue?.details.find(d => {
            if (d.severity !== 'block') return false;
            const target = d.target ?? activeIssue.target;
            if (target && isFindingStaleForPreview(target, previewText)) return false;
            return true;
          });
          if (!detail) return null;
          return (
            <p className="text-xs text-amber-700 dark:text-amber-300">
              {detail.message} Edit this passage using supported experience, then choose <strong>Save for this job</strong>.
            </p>
          );
        })()}
      </header>

      {/* Next Step Banner */}
      <section aria-label="Next step" className="rounded-desk border border-slate-200 bg-slate-50 p-4 space-y-2 text-sm leading-relaxed text-slate-700 dark:border-slate-800 dark:bg-slate-900/50 dark:text-slate-300">
        <h3 className="font-semibold">{active ? 'Preparation is running' : stale ? 'Review changed inputs first' : blockers.length ? 'Next: resolve the highlighted wording' : 'Next: continue preparation'}</h3>
        {active ? <p>Wait for preparation to finish, then return to Resume to review the PDF.</p> : stale ? <p>Your saved review is out of date. Use the revision or input recovery controls below before continuing.</p> : blockers.length ? <>
          {proposalBlockers.size > 0 && <p>Revise the proposed wording or keep the original, then choose <strong>Save for this job</strong>.</p>}
          {candidateBlockers.length > 0 && <p>Confirm the facts with supporting details, or revise the starting wording. Save each correction to recheck it.</p>}
          <button className={primaryButton} disabled={busy} onClick={() => { advance(base.review); focusBlocker(); document.getElementById(proposalBlockers.size ? 'proposal-edits' : 'starting-resume')?.scrollIntoView({ block: 'start', behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth' }); }}>Go to next required correction</button>
        </> : <p>Your saved corrections pass checks. Choose <strong>Continue preparation</strong> below to generate the PDF, then return to Resume. Saving alone does not start preparation.</p>}
      </section>

      <p className="text-xs">Saved revision {base.review.revision} · {dirty ? 'Unsaved changes are kept in this browser.' : 'No unsaved changes.'} Saving checks this job without running models.</p>
      <p role="status" aria-live="polite" className="text-sm font-medium">{message}</p>
      {active && <p role="status">Preparation is active; its selected revision is frozen. Editing is disabled.</p>}
      {data.corpus_revision > (base.captured.knowledge?.revision ?? base.corpus_revision) && <p>Newer corpus knowledge exists. Refresh inputs explicitly to use it.</p>}

      {stale && (
        <div role="alert" className="p-3 rounded bg-amber-50 dark:bg-amber-950/40 border border-amber-300 dark:border-amber-800 text-xs space-y-2">
          <p>The job or review changed. Local text is retained. Compare before reconciling.</p>
          <details><summary>Compare server candidate</summary><pre className="whitespace-pre-wrap break-words">{compileMarkdownResume(data.review.candidate_preview)}</pre></details>
          <button className={secondaryButton} disabled={busy || active || data.input_stale} onClick={() => { setBase(data); setRevision(job.revision); setDraftBaseRevision(data.review.revision); try { localStorage.removeItem(storageKey); } catch { /* retain */ } setMessage('Reconciled revision; review local edits against server content before saving.'); }}>
            Reconcile revision (keep edits)
          </button>
        </div>
      )}

      {/* Active Proposal Edit Section */}
      <div id="proposal-edits" className="space-y-3">
        {currentPassage ? (
          <section aria-label="Current passage" className="space-y-2">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h3 className="font-semibold text-sm">{currentPassage.label}</h3>
              <p className="text-xs text-slate-500">
                {currentPassage.required ? `Decision ${requiredPassages.indexOf(currentPassage) + 1} of ${requiredPassages.length + candidateBlockers.length}` : 'Optional wording review'}
              </p>
            </div>

            <p role="status" aria-label="Passage save status" className="text-sm font-semibold">
              {busy ? 'Saving or checking…' : dirty ? 'Unsaved changes' : base.review.patches.some(patch => currentPassage.proposals.some(p => p.id === patch.proposal_id))
                ? currentPassage.required ? 'Saved — still needs changes. Review the findings below.' : 'Saved — checks passed for this passage.'
                : 'Review this passage, then save your decision.'}
            </p>

            {currentPassage.proposals.map((p, i, all) => (
              <JobProposalEditor
                key={p.id}
                position={{ index: i + 1, total: all.length }}
                proposal={p}
                evidence={base.captured.evidence}
                support={base.captured.skillSupport}
                disabled={busy || active}
                onSave={p.id === currentPassage.proposals.at(-1)?.id ? () => void save(false) : undefined}
                saveDisabled={stale}
                issues={base.review.validation.issues.filter(it => it.subject.kind === 'proposal' && it.subject.proposal_id === p.id)}
                requirements={base.captured.analysis.requirements.filter(r => p.requirement_ids.includes(r.id)).map(r => r.text)}
                grounding={draft.groundings.find(g => g.proposal_id === p.id)}
                onGrounding={g => setDraft(d => ({ ...d, groundings: [...d.groundings.filter(v => v.proposal_id !== p.id), ...(g ? [g] : [])] }))}
                onPatch={patch}
                fact={matchingFact}
                factConfirmed={factConfirmed}
                onConfirmFact={handleConfirmFact}
              />
            ))}
          </section>
        ) : blockers.length === 0 ? (
          <JobProposalCompletion
            acceptedCount={overlay.proposals.filter(p => p.decision !== 'rejected').length}
            rejectedCount={overlay.proposals.filter(p => p.decision === 'rejected').length}
            totalCount={overlay.proposals.length}
            candidatePreview={base.review.candidate_preview}
            onGeneratePdf={generatePdfAction}
            onOpenDrawer={() => setDrawerOpen(true)}
            busy={busy}
            message={message}
          />
        ) : null}

            <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs">
              <details><summary className="cursor-pointer">Required passages ({requiredPassages.length + candidateBlockers.length})</summary><div className="flex flex-wrap gap-2 py-2">{requiredPassages.map(group => <button key={group.id} className={secondaryButton} onClick={() => setSelectedProposal(group.proposals.find(p => proposalBlockers.has(p.id))!.id)}>{group.label}</button>)}{candidateBlockers.map(path => <button key={path} className={secondaryButton} onClick={() => setSelectedProposal(`base:${path}`)}>{candidateFieldLabel(path)} (starting resume)</button>)}</div></details>
              <details><summary className="cursor-pointer">Optional proposals ({passages.filter(group => !group.required).length})</summary><div className="flex flex-wrap gap-2 py-2">{passages.filter(group => !group.required).map(group => <button key={group.id} className={secondaryButton} onClick={() => setSelectedProposal(group.proposals[0].id)}>{group.label}</button>)}</div></details>
            </div>
          </div>

          {/* Starting Resume Corrections */}
          {startingFields.length > 0 && (
            <section id="starting-resume" className="space-y-2">
              <h3 className="font-semibold text-sm">
                Starting resume · {pluralize(startingFields.length, 'location needs', 'locations need')} correction
              </h3>
              {startingFields.map(path => {
                const issues = blockers.filter(i => i.subject.kind === 'candidate' && i.subject.path === path);
                const currentText = baseText(startingResume, path);
                const activeProposal = overlay.proposals.find(p => p.decision !== 'rejected' && ((p.type === 'summary.rewrite' && path === 'summary') || (p.target.experience_index !== undefined && path === `experiences.${p.target.experience_index}.bullets.${p.target.bullet_index}.text`)));
                const previewText = activeProposal ? (activeProposal.edited_after ?? activeProposal.after) : currentText;
                return (
                  <div key={path} className={`${cardClass} p-4 space-y-4`}>
                    <div className="flex flex-wrap items-center justify-between gap-2 text-xs font-medium">
                      <span>{candidateFieldLabel(path)} · {pluralize(issues.reduce((n, i) => n + i.details.filter(d => d.severity === 'block').length, 0), 'finding')}</span>
                      {currentText !== undefined && <span className="text-slate-600 dark:text-slate-300">Starting wording: “{currentText}”</span>}
                    </div>
                    <IssueList issues={issues.flatMap(i => i.details.map(d => ({ ...d, target: d.target ?? i.target })))} currentText={previewText} />
                    <p className="text-sm text-slate-500 dark:text-slate-400">Confirm what you did and add supporting details, or revise this passage to match your experience.</p>
                    <details>
                      <summary className={`${secondaryButton} cursor-pointer`}>Confirm facts or add supporting evidence</summary>
                      <div className="pt-3">
                        {busy || active || stale || dirty ? <p role="status">Save pending proposal changes and finish active preparation before reviewing these facts.</p> : <JobFacts jobId={job.id} passagePath={path} onResolved={async () => {
                          const latest = await apiClient.getJob(job.id);
                          const result = await apiClient.recheckJobProposals(job.id, base.review.id, { ...binding, expected_job_revision: latest.job.revision });
                          setBase(b => ({ ...b, review: result.review }));
                          setRevision(latest.job.revision);
                          setDraftBaseRevision(result.review.revision);
                          await reloadFacts(); onSaved(); await refresh();
                        }} />}
                      </div>
                    </details>
                    <details open={selectedProposal === `base:${path}`}>
                      <summary className={`${secondaryButton} cursor-pointer`} onClick={e => { e.preventDefault(); setSelectedProposal(previous => previous === `base:${path}` ? '' : `base:${path}`); }}>
                        Edit starting wording for this job
                      </summary>
                      <div className="pt-2">
                        <JobStartingResumeCorrection
                          job={{ ...job, revision: Math.max(job.revision, revision) }}
                          review={base.review}
                          resume={startingResume}
                          path={path}
                          disabled={busy || active || stale}
                          onDraftChange={change => updateStartingDraft(path, change)}
                          autoSaveStatus={autoSaveStatus}
                          onSaveMixed={startingDrafts.size > 0 && draft.patches.length > 0 ? () => void saveMixedDrafts() : undefined}
                          onSaved={async result => {
                            setBase(b => ({ ...b, review: result.review }));
                            setRevision(result.job.revision);
                            setDraftBaseRevision(result.review.revision);
                            setMessage(`Job-local starting resume saved in revision ${result.review.revision}. ${result.review.validation.status === 'ready' ? 'Ready to continue separately.' : 'Review remaining issues.'}`);
                            advance(result.review);
                            onSaved();
                            await refresh();
                          }}
                        />
                      </div>
                    </details>
                  </div>
                );
              })}
            </section>
          )}

          {/* Remembered Support */}
          <JobRememberedSupport job={job} support={base.captured.skillSupport ?? []} knowledge={base.captured.knowledge} titleOf={id => evidenceTitle(base.captured.evidence, id)} refreshKey={base.corpus_revision} />

          {overlay.groundings.filter(g => !draft.removedGroundings?.includes(g.id)).map(g => (
            <div key={g.id} className="text-xs space-y-1 p-2 rounded bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800">
              <p>Saved grounding: {g.term} — {g.explanation} ({g.recorded_by})</p>
              {g.sources.map(s => <blockquote key={s.evidence_id} className="italic text-slate-500">{evidenceTitle(base.captured.evidence, s.evidence_id)}: {s.quote}</blockquote>)}
              <button className={secondaryButton} disabled={busy || active} onClick={() => setDraft(d => ({ ...d, removedGroundings: [...(d.removedGroundings ?? []), g.id] }))}>
                Remove saved grounding {g.term}
              </button>
            </div>
          ))}

          {/* Explanation */}
          <label className="block text-xs">
            Correction explanation (optional unless grounding a term or remembering a rule)
            <textarea aria-label="Correction explanation" rows={2} className={`${inputClass} mt-1`} disabled={busy || active} value={draft.explanation} onChange={e => setDraft(d => ({ ...d, explanation: e.target.value }))} />
          </label>

          <details className="text-xs">
            <summary className="cursor-pointer">Remember a reusable relationship</summary>
            <div className="mt-2 space-y-2 p-3 rounded-lg bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800">
              <p>No relationship is inferred from a rejection. Enter a correction explanation above and select a newly entered grounding decision.</p>
              <label className="block">Grounding to remember<select className={inputClass} value={memoryProposal} onChange={e => setMemoryProposal(e.target.value)}><option value="">Choose grounding</option>{draft.groundings.map(g => <option key={g.proposal_id} value={g.proposal_id}>'{g.term}' in {passages.find(group => group.proposals.some(p => p.id === g.proposal_id))?.label ?? 'this resume'}</option>)}</select></label>
              <label className="block">Canonical skill<input className={inputClass} value={skill} onChange={e => setSkill(e.target.value)} /></label>
              <label className="block">Precise facet<input className={inputClass} value={facet} onChange={e => setFacet(e.target.value)} /></label>
              <label className="block">Support level<select className={inputClass} value={support} onChange={e => setSupport(e.target.value as typeof support)}>{supportOptions.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
              <label className="block">Memory scope<select className={inputClass} value={scopeKind} onChange={e => setScopeKind(e.target.value as CorpusScope['kind'])}>{scopeOptions.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
              {scopeKind !== 'workspace' && scopeKind !== 'job' && <label className="block">Exact scope key<input className={inputClass} value={scopeKey} onChange={e => setScopeKey(e.target.value)} /></label>}
              {memoryGrounding && (
                <div aria-label="Memory preview" className="space-y-1">
                  <h3 className="font-semibold">What will be remembered</h3>
                  <p>{supportDescription({ permitted_terms: [memoryGrounding.term], support, sources: [{ evidence_id: memoryGrounding.evidence_id }] }, id => evidenceTitle(base.captured.evidence, id))}.</p>
                  <p>{scope.kind === 'workspace' || scope.key.trim() ? appliesTo(scope, { currentJobId: job.id }) : 'Applies to: enter the exact name below'}. Skill: {skill || '(enter a skill)'}{facet ? ` (${facet})` : ''}. Only the wording “{memoryGrounding.term}” is permitted.</p>
                  <blockquote>{evidenceTitle(base.captured.evidence, memoryGrounding.evidence_id)}: {memoryGrounding.quote}</blockquote>
                  <p>Why: {memoryGrounding.explanation}</p>
                </div>
              )}
              <button className={secondaryButton} disabled={busy || active || stale || !memoryReady} onClick={() => void save(true)}>
                Save and remember
              </button>
            </div>
          </details>

          {/* Primary Action Buttons */}
          <div id="review-actions" className="flex flex-wrap items-center gap-2 pt-2 border-t border-slate-200 dark:border-slate-800">
            {!currentPassage && <button className={primaryButton} disabled={busy || active || stale} onClick={() => void save(false)}>Save for this job</button>}
            <button className={secondaryButton} disabled={busy || dirty || active || stale} onClick={() => void run(async () => { const result = await apiClient.recheckJobProposals(job.id, base.review.id, binding); setBase(b => ({ ...b, review: result.review })); advance(result.review); setMessage(`Rechecked: ${result.review.validation.status}`); })}>
              Recheck saved revision
            </button>
            <button className={primaryButton} disabled={busy || dirty || active || stale || base.input_stale || base.review.validation.status !== 'ready'} onClick={() => void run(async () => { const body = { ...binding, validation_fingerprint: base.review.validation.fingerprint }; await apiClient.continueJobProposals(job.id, base.review.id, { ...body, idempotency_key: key(body) }); setMessage(`Started preparation with saved revision ${base.review.revision}.`); onSaved(); })}>
              Continue preparation
            </button>
            {blockers.length > 0 && <span className="text-xs text-slate-600 dark:text-slate-300">Resolve all {pluralize(blockers.length, 'blocker')} and save to enable Continue preparation.</span>}
          </div>

          {/* Advanced Inputs Refresh */}
          <details id="refresh-inputs" className="space-y-2 text-xs" open={data.input_stale}>
            <summary className="cursor-pointer font-medium text-slate-500">Advanced: refresh starting inputs</summary>
            {data.input_stale && <p role="alert">This review belongs to older inputs; saved changes remain in history. New preparation reapplies job-local starting-resume corrections where the shared wording is unchanged, but not proposal edits or groundings. {dirty && 'Preserve your unsaved text before changing versions; stale inputs cannot be saved.'}</p>}
            <p>Refresh inputs captures a new snapshot only. Saved reviews and browser drafts remain intact.</p>
            <button className={secondaryButton} disabled={busy || active || dirty} onClick={() => void run(async () => { try { const { unapplied_base_corrections: unapplied = [] } = await apiClient.captureJobInputs(job.id, job.revision); setMessage(`Inputs refreshed. ${unapplied.length ? `Your shared resume changed at ${unapplied.map(c => candidateFieldLabel(c.path)).join(', ')}; reapply those job-local corrections after preparing. ` : ''}Prepare the new version separately.`); } finally { onSaved(); await refresh(); } })}>
              Refresh inputs
            </button>
            {refreshedInput && action && <button className={primaryButton} disabled={busy || dirty} onClick={() => void run(async () => { const body = { expected_revision: job.revision, input_snapshot_id: refreshedInput }; await apiClient.prepareJob(job.id, action, { ...body, idempotency_key: key({ action, ...body }) }); setMessage('New preparation version requested.'); onSaved(); await refresh(); })}>
              Prepare refreshed inputs
            </button>}
          </details>

          <details className="text-xs"><summary className="cursor-pointer text-slate-500">Inspect saved candidate</summary><h3>Saved candidate preview {dirty ? '(does not include unsaved edits)' : ''}</h3><pre className="whitespace-pre-wrap break-words text-xs">{compileMarkdownResume(base.review.candidate_preview)}</pre></details>
          <details className="text-xs"><summary className="cursor-pointer text-slate-500">Historical reviews and generations</summary>{data.history.map(r => <details key={`${r.id}:${r.revision}`}><summary>Revision {r.revision} · {r.generation_id} · {r.created_at}</summary><pre className="whitespace-pre-wrap break-words text-xs">{compileMarkdownResume(r.candidate_preview)}</pre></details>)}</details>

      {/* Slide-out Drawer for All Passages */}
      <JobPassagesDrawer
        isOpen={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        passages={drawerItems}
        activeId={selectedProposal}
        onSelectPassage={id => {
          setSelectedProposal(id);
          focusRequested.current = true;
        }}
      />
    </section>
  );
}

export function JobProposalReview({
  job,
  onSaved,
  selectTarget: explicitSelectTarget,
  initialData,
  initialFacts,
}: {
  job: Job;
  onSaved: () => void;
  selectTarget?: { id: string; sequence: number };
  initialData?: Available;
  initialFacts?: Facts;
}) {
  const load = useCallback(() => apiClient.getJobProposals(job.id), [job.id]);
  const { data, error, refresh } = useJobsData(load, initialData);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const key = useIntentKey();
  const [wordingOpen, setWordingOpen] = useState(true);
  const [selectTarget] = useState<{ id: string; sequence: number } | undefined>(explicitSelectTarget);

  if (error && !data) return <p role="alert">{error}</p>;
  if (!data) return <p role="status">Loading proposal review…</p>;

  if (data.availability === 'available') {
    if (data.generation.generation_policy === SYNTHESIS_POLICY) return <Editor key={`${job.workspace_id}:${job.id}:${data.generation.id}`} job={job} data={data} onSaved={onSaved} refresh={refresh} loadError={error ?? undefined} initialFacts={initialFacts} />;
    return (
      <div className="space-y-4">
        {message && <p role="status">{message}</p>}
        <details open={wordingOpen} onToggle={e => setWordingOpen(e.currentTarget.open)}>
          <summary className="cursor-pointer font-medium text-xs text-slate-400 hover:text-slate-200">
            Edit wording, citations, and preparation details
          </summary>
          <div className="pt-2">
            <Editor
              selectTarget={selectTarget}
              key={`${job.workspace_id}:${job.id}:${data.generation.id}`}
              job={job}
              data={data}
              onSaved={onSaved}
              refresh={refresh}
              loadError={error ?? undefined}
              initialFacts={initialFacts}
            />
          </div>
        </details>
      </div>
    );
  }

  return (
    <section className={`${cardClass} p-4 space-y-3`}>
      {error && <p role="alert">{error} Showing the last successfully loaded review status; it will refresh when the host responds.</p>}
      <h2>Proposal review unavailable</h2>
      {stoppedByUser(job) ? <p>Stopped. Output that arrived after Stop was discarded. To prepare again, open Automatic work controls and choose Start automatic preparation, then Retry this job.</p> : <p>Missing historical output cannot be reconstructed from error messages. Recovery reuses saved context and generates proposals once for inspection.</p>}
      {data.recoverable && data.input_snapshot_id && (
        <button className={primaryButton} disabled={busy} onClick={async () => {
          setBusy(true);
          try {
            const body = { expected_job_revision: job.revision, input_snapshot_id: data.input_snapshot_id! };
            await apiClient.recoverJobProposals(job.id, { ...body, idempotency_key: key(body) });
            setMessage('Recovery started. The generated proposals will be retained for inspection.');
            onSaved();
            await refresh();
          } catch (e) {
            setMessage(e instanceof Error ? e.message : 'Recovery prevented');
          } finally {
            setBusy(false);
          }
        }}>
          Recover proposal review
        </button>
      )}
      {data.latest_input_snapshot_id && data.latest_input_snapshot_id !== data.input_snapshot_id && preparationActionFor(job) && (
        <button className={primaryButton} disabled={busy} onClick={async () => {
          setBusy(true);
          try {
            const act = preparationActionFor(job)!;
            const body = { expected_revision: job.revision, input_snapshot_id: data.latest_input_snapshot_id! };
            await apiClient.prepareJob(job.id, act, { ...body, idempotency_key: key({ action: act, ...body }) });
            onSaved();
            await refresh();
          } catch (e) {
            setMessage(e instanceof Error ? e.message : 'Preparation prevented');
          } finally {
            setBusy(false);
          }
        }}>
          Prepare refreshed inputs
        </button>
      )}
      {!data.recoverable && !stoppedByUser(job) && <p>Use Posting to inspect setup and explicitly prepare a new version.</p>}
      <p role="status">{message}</p>
    </section>
  );
}
