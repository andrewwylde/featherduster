import { useEffect, useRef, useState } from 'react';
import { compileMarkdownResume, computeArtifactChanges, computeSkillsListDiff, ProposalSchema, restoreAccomplishmentInDraft, tightenResumeWording, undoProposalInDraft, undoPassageInDraft, type Job, type JobDraft, type ResumeSpec, type Proposal, type PassageDiffStage, type PassageDiffTrace, type ArtifactChangesSummary } from '@featherduster/core';
import { apiClient, type JobReview } from '../../api/client.js';
import { cardClass, secondaryButton } from '../tailoring/ui.js';

function stageKindLabel(kind: string): string {
  switch (kind) {
    case 'job_local_correction': return 'Job-local correction';
    case 'tailored_proposal': return 'Tailored proposal';
    case 'user_edit': return 'Your edit';
    case 'omission': return 'Omission';
    case 'original_capture': return 'Original capture';
    default: return kind;
  }
}

/** The visible summary belongs to this exact PDF. Restoring forks a draft and requires fresh approval. */
export function JobArtifactChanges({ job, review, disabled, onSaved }: { job: Job; review: JobReview; disabled: boolean; onSaved(): void }) {
  const [busy, setBusy] = useState(false), [message, setMessage] = useState('');
  const [draft, setDraft] = useState<JobDraft | null>(review.working_draft ?? null);
  const [overflow, setOverflow] = useState<ResumeSpec>();
  const alive = useRef(true);
  useEffect(() => () => { alive.current = false; }, []);
  useEffect(() => { setDraft(review.working_draft ?? null); }, [review.working_draft]);
  const candidate = draft?.candidate ?? review.draft.candidate;
  const published = review.draft.candidate;
  const pendingChanges = JSON.stringify(candidate) !== JSON.stringify(published);
  const rawBase = review.raw_base_resume;
  const originalBase = rawBase ?? review.base_resume;
  const baseCorrections = review.base_corrections ?? [];
  const changesSummary: ArtifactChangesSummary = review.changes_summary
    ?? computeArtifactChanges(originalBase, baseCorrections, review.draft.proposals.proposals);
  const findTrace = (p: Proposal): PassageDiffTrace | undefined => {
    const traces: PassageDiffTrace[] = changesSummary.passages;
    if (p.type === 'summary.rewrite') {
      return traces.find((t: PassageDiffTrace) => t.passage_id === 'summary' || t.final_text === (p.edited_after ?? p.after));
    }
    if (p.type === 'bullet.add') {
      return traces.find((t: PassageDiffTrace) => t.passage_id === p.id || (t.original_text === '' && t.final_text === (p.edited_after ?? p.after)));
    }
    if (p.type === 'skills.prune' || p.type === 'skills.reorder') {
      return traces.find((t: PassageDiffTrace) => t.skill_group_index === p.target?.skill_group_index || t.passage_id === `skills.${p.target?.skill_group_index}`);
    }
    const expectedPath = `experiences.${p.target.experience_index}.bullets.${p.target.bullet_index}.text`;
    const targetText = p.edited_after ?? p.after;
    return traces.find((t: PassageDiffTrace) => t.passage_id === expectedPath && (t.final_text === targetText || t.stages.some((s: PassageDiffStage) => s.text === targetText)))
      ?? traces.find((t: PassageDiffTrace) => t.passage_id.endsWith(`:${p.target.bullet_index}`) && (t.final_text === targetText || t.stages.some((s: PassageDiffStage) => s.text === targetText)))
      ?? traces.find((t: PassageDiffTrace) => t.final_text === targetText && (t.stages.some((s: PassageDiffStage) => s.text === p.before) || t.original_text === p.before))
      ?? traces.find((t: PassageDiffTrace) => t.stages.some((s: PassageDiffStage) => s.text === p.before))
      ?? traces.find((t: PassageDiffTrace) => t.final_text === targetText);
  };
  const isSkillsActive = (p: Proposal) => {
    const group = published.skills?.[p.target?.skill_group_index ?? -1];
    if (!group) return false;
    const before = p.before_skills ?? (p.before ? p.before.split(/,\s*/).map(s => s.trim()).filter(Boolean) : group.skills);
    const expected = p.result_skills ?? (p.type === 'skills.prune'
      ? before.filter(s => !p.skills.some(rem => rem.toLowerCase() === s.toLowerCase()))
      : p.skills);
    return JSON.stringify(group.skills) === JSON.stringify(expected);
  };
  const active = review.draft.proposals.proposals.filter(p => {
    if (p.type === 'bullet.drop') return false;
    if (p.type === 'summary.rewrite') return published.summary === (p.edited_after ?? p.after);
    if (p.type === 'skills.prune' || p.type === 'skills.reorder') return isSkillsActive(p);
    return published.experiences[p.target.experience_index]?.bullets.some(b => b.text === (p.edited_after ?? p.after));
  });
  const findProposalForTrace = (trace: PassageDiffTrace): Proposal | undefined => {
    if (trace.passage_id === 'summary') {
      return active.find(p => p.type === 'summary.rewrite');
    }
    if (trace.skill_group_index !== undefined) {
      return active.find(p => (p.type === 'skills.prune' || p.type === 'skills.reorder') && p.target?.skill_group_index === trace.skill_group_index);
    }
    return active.find(p => {
      if (p.id === trace.passage_id) return true;
      const targetText = p.edited_after ?? p.after;
      if (targetText === trace.final_text || trace.stages.some(s => s.text === targetText)) {
        if (trace.experience_index !== undefined && p.target?.experience_index !== undefined) {
          return p.target.experience_index === trace.experience_index;
        }
        return true;
      }
      return false;
    });
  };
  const substantiveTraces = changesSummary.passages.filter(
    t => t.original_text !== t.final_text && t.final_text.trim() !== ''
  );
  const matchedProposals = new Set<Proposal>();
  const changeItems: { trace?: PassageDiffTrace; proposal?: Proposal }[] = substantiveTraces.map(trace => {
    const p = findProposalForTrace(trace);
    if (p) matchedProposals.add(p);
    return { trace, proposal: p };
  });
  for (const p of active) {
    if (matchedProposals.has(p)) continue;
    if (!['summary.rewrite', 'bullet.rewrite', 'bullet.add', 'bullet.consolidate', 'skills.prune', 'skills.reorder'].includes(p.type)) continue;
    const trace = findTrace(p);
    changeItems.push({ trace, proposal: p });
  }
  const generatedOmissions = review.draft.proposals.proposals.filter(p => p.decision === 'rejected'
    && ['bullet.add', 'bullet.rewrite', 'bullet.consolidate'].includes(p.type) && (p.edited_after ?? p.after).trim()
    && !published.experiences[p.target.experience_index]?.bullets.some(b => b.text === (p.edited_after ?? p.after))
    && (p.type === 'bullet.add' || (p.type === 'bullet.consolidate' ? p.source_bullets ?? [] : [{ before: p.before }])
      .every(s => !published.experiences[p.target.experience_index]?.bullets.some(b => b.text === s.before))));
  const omissions = review.base_resume.experiences.flatMap((exp, ei) => exp.bullets.flatMap((b, bi) => {
    if (generatedOmissions.some(p => p.target.experience_index === ei && (p.type === 'bullet.consolidate'
      ? p.source_bullets?.some(s => s.bullet_index === bi) : p.type === 'bullet.rewrite' && p.target.bullet_index === bi))) return [];
    if (published.experiences[ei]?.bullets.some(v => v.text === b.text) || active.some(p => p.target.experience_index === ei
      && (p.type === 'bullet.consolidate' ? p.source_bullets?.some(s => s.bullet_index === bi) : p.type === 'bullet.rewrite' && p.target.bullet_index === bi))) return [];
    const saved = review.draft.proposals.proposals.find(p => p.type === 'bullet.drop' && p.target.experience_index === ei && p.target.bullet_index === bi);
    return [saved ?? ProposalSchema.parse({ id: `omitted:${ei}:${bi}`, type: 'bullet.drop', target: { experience_index: ei, bullet_index: bi }, before: b.text, rationale: 'Omitted from this version.' })];
  }));
  const saveAndCheck = async (next: ResumeSpec) => {
    setBusy(true); setOverflow(undefined); setMessage('Saving draft…');
    try {
      let working = draft;
      if (!working) {
        const current = await apiClient.getJob(job.id);
        working = (await apiClient.editJobResume(job.id, review.artifact.id, { expected_job_revision: current.job.revision,
          artifact_fingerprint: review.artifact.version_fingerprint, idempotency_key: crypto.randomUUID() })).draft;
      }
      let saved = (await apiClient.saveJobDraft(job.id, working.id, working.revision, next)).draft;
      setDraft(saved); onSaved(); setMessage('Saved. Checking facts and page fit…');
      for (let attempt = 0; attempt < 2; attempt++) {
        const target = { kind: 'draft' as const, draft_id: saved.id, candidate: saved.candidate };
        let facts = await apiClient.viewJobFacts(job.id, target);
        if (!facts.facts.length || facts.facts.some(f => !f.resolution)) {
          await apiClient.startJobFactCheck(job.id, { target, input_fingerprint: facts.input_fingerprint, expected_job_revision: facts.job_revision,
            expected_semantic_revision: facts.semantic_revision, reason: 'edit', idempotency_key: crypto.randomUUID() });
          const deadline = Date.now() + 70000;
          do {
            await new Promise(resolve => setTimeout(resolve, 1000));
            if (!alive.current) return;
            facts = await apiClient.viewJobFacts(job.id, target);
          } while (facts.execution === 'checking' && Date.now() < deadline);
        }
        if (!facts.facts.length || facts.facts.some(f => !f.resolution)) { setMessage('Saved. Open the draft to resolve factual questions or retry checks.'); return; }
        const checked = await apiClient.checkJobDraft(job.id, saved.id, saved.candidate);
        if (checked.status === 'ready') {
          await apiClient.finalizeJobDraft(job.id, saved.id, { expected_job_revision: checked.job_revision, expected_draft_revision: saved.revision,
            binding: checked.binding, idempotency_key: crypto.randomUUID() });
          setMessage('New PDF generated. Review and approve this version.'); onSaved(); return;
        }
        if (checked.issues.some(i => /page|overflow/i.test(`${i.code} ${i.message}`))) {
          const tighter = tightenResumeWording(saved.candidate);
          if (attempt === 0 && JSON.stringify(tighter) !== JSON.stringify(saved.candidate)) {
            saved = (await apiClient.saveJobDraft(job.id, saved.id, saved.revision, tighter)).draft;
            setDraft(saved); setMessage('Saved tighter wording without removing distinct claims. Checking page fit again…'); continue;
          }
          setOverflow(saved.candidate); setMessage('The restored draft still exceeds the page budget after checking tighter wording. Choose an accomplishment below to replace, or edit the draft.'); return;
        }
        setMessage(`Saved. ${checked.issues.map(i => i.message).join(' ')}`); return;
      }
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Checking needs retry. Saved draft changes are retained.'); }
    finally { if (alive.current) setBusy(false); }
  };
  return <section aria-label="PDF change summary" className={`${cardClass} p-5 space-y-4`}>
    <h2 className="font-semibold">Changes in this PDF</h2>
    <p className="text-sm">Final approval covers the displayed PDF and these changes. Restoring or undoing creates a new draft that needs fresh checks and approval.</p>
    {pendingChanges && <p role="status">Your saved draft has pending changes. This summary still describes the displayed PDF; open the draft below to finish its checks.</p>}
    {changeItems.map(({ trace, proposal: p }, idx) => {
      const key = p?.id ?? trace?.passage_id ?? `change-${idx}`;
      const isSkills = p?.type === 'skills.prune' || p?.type === 'skills.reorder';
      const title = p?.type === 'skills.prune' ? 'Remove skills'
        : p?.type === 'skills.reorder' ? 'Reorder skills'
        : p?.type === 'bullet.consolidate' ? 'Consolidation'
        : p?.type === 'bullet.add' ? 'Addition'
        : p?.type === 'bullet.rewrite' || p?.type === 'summary.rewrite' ? 'Rewrite'
        : 'Correction';
      let beforeText = (p?.type === 'bullet.add' || !trace?.original_text)
        ? '(new content)'
        : (trace?.original_text || p?.source_bullets?.map(s => s.before).join(' / ') || p?.before || '(new content)');
      let afterText = p ? (p.edited_after ?? p.after) : (trace?.final_text ?? '');

      if (isSkills && p) {
        const group = published.skills?.[p.target?.skill_group_index ?? -1];
        const beforeSkills = p.before_skills ?? (p.before ? p.before.split(/,\s*/).map(s => s.trim()).filter(Boolean) : group?.skills ?? []);
        const afterSkills = p.result_skills ?? (p.type === 'skills.prune'
          ? beforeSkills.filter(s => !p.skills.some(rem => rem.toLowerCase() === s.toLowerCase()))
          : p.skills.length ? p.skills : (group?.skills ?? []));
        const diff = computeSkillsListDiff(beforeSkills, afterSkills);
        beforeText = beforeSkills.join(', ');
        if (p.type === 'skills.prune') {
          afterText = `Retained: ${diff.retained.join(', ') || 'None'}${diff.removed.length ? ` (Removed: ${diff.removed.join(', ')})` : ''}`;
        } else {
          afterText = `Order change: ${diff.after.join(', ')}`;
        }
      }
      return <div key={key} className="border-t pt-3 text-sm space-y-2">
        <h3 className="font-semibold">{title}</h3>
        <p><strong>Before: </strong>{beforeText}</p>
        <p><strong>After: </strong>{afterText}</p>
        {trace && trace.stages.length > 1 && (
          <details className="mt-1 text-xs text-slate-600 bg-slate-50 p-2 rounded border border-slate-200">
            <summary className="cursor-pointer font-medium text-slate-700 select-none">
              Correction history ({trace.stages.length} stages)
            </summary>
            <ol className="mt-1 space-y-1 pl-4 list-decimal">
              {trace.stages.map((stage: PassageDiffStage, sIdx: number) => (
                <li key={sIdx}>
                  <span className="font-semibold text-slate-800">{stageKindLabel(stage.kind)}: </span>
                  <span>{stage.text || '(empty)'}</span>
                </li>
              ))}
            </ol>
          </details>
        )}
        {p?.rationale && <p>{p.rationale}</p>}
        <button
          className={secondaryButton}
          disabled={disabled || busy || pendingChanges}
          onClick={() => {
            try {
              const next = p
                ? undoProposalInDraft(candidate, review.base_resume, p)
                : trace
                  ? undoPassageInDraft(candidate, originalBase, trace)
                  : null;
              if (next) void saveAndCheck(next);
            } catch (e) {
              setMessage(e instanceof Error ? e.message : String(e));
            }
          }}
        >
          Undo change
        </button>
      </div>;
    })}
    <h3 className="font-semibold">Omitted accomplishments ({omissions.length + generatedOmissions.length})</h3>
    {generatedOmissions.map(p => <div key={p.id} className="border-t pt-3 text-sm space-y-2"><p>{p.edited_after ?? p.after}</p><p>{p.rationale}</p>
      <button className={secondaryButton} disabled={disabled || busy || pendingChanges} onClick={() => { try { void saveAndCheck(restoreAccomplishmentInDraft(candidate, review.base_resume, p)); } catch (e) { setMessage(String(e)); } }}>Restore accomplishment</button></div>)}
    {omissions.map(p => <div key={p.id} className="border-t pt-3 text-sm space-y-2"><p>{p.before}</p><p>{p.rationale}</p>
      <button className={secondaryButton} disabled={disabled || busy || pendingChanges} onClick={() => { try { void saveAndCheck(undoProposalInDraft(candidate, review.base_resume, p)); } catch (e) { setMessage(String(e)); } }}>Restore accomplishment</button></div>)}
    <details open={!changeItems.length && !omissions.length}>
      <summary>Complete before and after text</summary>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 pt-3 text-sm">
        <section><h3 className="font-semibold">Before</h3><pre className="whitespace-pre-wrap break-words font-sans">{compileMarkdownResume(originalBase)}</pre></section>
        <section><h3 className="font-semibold">In this PDF</h3><pre className="whitespace-pre-wrap break-words font-sans">{compileMarkdownResume(published)}</pre></section>
      </div>
    </details>
    <p role="status">{message}</p>
    {draft && <a className="underline" href={`/tailor/canvas/jobs/${job.id}/${draft.id}`}>Open saved draft and checks</a>}
    {overflow && <section aria-label="Choose a replacement" className="space-y-3"><h3 className="font-semibold">Replace one accomplishment</h3>
      {overflow.experiences.flatMap((exp, ei) => exp.bullets.map((b, bi) => <button key={`${ei}:${bi}`} className={`${secondaryButton} block w-full text-left`} disabled={disabled || busy} onClick={() => {
        const next = structuredClone(overflow); next.experiences[ei].bullets.splice(bi, 1); void saveAndCheck(next);
      }}>Remove “{b.text}” and check fit</button>))}
    </section>}
  </section>;
}
