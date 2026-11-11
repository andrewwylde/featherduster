import { z } from 'zod';
import * as C from '@featherduster/core';
import type { JobsRuntime } from './runtime.js';
import { RepositoryError } from './repository.js';
import { canonicalResumeValue as canonical } from './resume-context.js';
import { fingerprint } from './files.js';

const edit = z.object({ path: z.string(), before: z.string(), after: z.string().min(1) }).strict();
export const SelectedUpdatesSchema = z.object({ expected_corpus_revision: z.number().int().nonnegative(), idempotency_key: z.string().min(1),
  jobs: z.array(z.object({ job_id: z.string().guid(), fingerprint: z.string(), edits: z.array(edit).min(1) }).strict()).min(1).max(30),
}).strict();

/** Derives affected jobs from persisted answers and captured work identities, never employer-name similarity. */
export function affectedClarificationDrafts(r: JobsRuntime, options?: { maxDurationMs?: number; cursor?: string }) {
  const knowledge = r.corpus.repository.snapshot();
  const corrections = C.clarificationCorrections(knowledge);
  if (!corrections.length) return { corpus_revision: knowledge.revision, jobs: [] };

  const activeWorkIds = new Set<string>();
  const activeClaimTokens = new Set<string>();
  for (const c of corrections) {
    if (c.before.fact.work_id) activeWorkIds.add(c.before.fact.work_id);
    for (const claim of c.before.confirmed_claims ?? []) {
      if (claim.trim()) activeClaimTokens.add(claim);
    }
  }

  const db = r.repository.database.db;
  const maxDurationMs = options?.maxDurationMs ?? 1500;
  const startTime = Date.now();
  let incomplete = false;
  let next_cursor: string | undefined;

  const jobs: {
    job_id: string; company: string | null; role: string | null; target: C.SemanticTarget;
    draft_revision: number | undefined; working_draft: boolean; job_revision: number;
    fingerprint: string; edits: (C.PassageEdit & { proposal_id?: string; corrections: { update_id: string; answer: string }[] })[];
    historical_artifact: string | null; busy: boolean;
  }[] = [];

  let list = r.repository.listJobs();
  if (options?.cursor) {
    const idx = list.findIndex(j => j.id === options.cursor);
    if (idx >= 0) list = list.slice(idx);
  }

  const stmtDraft = db.prepare('SELECT payload FROM draft_revisions WHERE job_id=? ORDER BY rowid DESC LIMIT 1');
  const stmtSem = db.prepare('SELECT payload FROM semantic_records WHERE job_id=? ORDER BY head_revision DESC LIMIT 1');
  const stmtClar = db.prepare('SELECT payload FROM semantic_clarifications WHERE job_id=?');
  const stmtGen = db.prepare('SELECT payload FROM proposal_generations WHERE job_id=? ORDER BY rowid DESC LIMIT 1');
  const stmtWorking = db.prepare('SELECT id FROM draft_revisions WHERE job_id=? AND parent_artifact_version_id=? ORDER BY rowid DESC LIMIT 1');
  const stmtArtifact = db.prepare('SELECT payload FROM artifacts WHERE id=?');

  for (const job of list) {
    if (Date.now() - startTime > maxDurationMs) {
      incomplete = true;
      next_cursor = job.id;
      break;
    }

    try {
      // Lightweight index check: collect recorded work IDs before loading artifacts or reviewing
      const jobWorkIds = new Set<string>();
      let hasClaimTokenMatch = false;

      const draftRow = stmtDraft.get(job.id) as { payload: string } | undefined;
      if (draftRow) {
        try {
          const draftData = JSON.parse(draftRow.payload);
          if (draftData.candidate?.summary?.trim()) {
            jobWorkIds.add(`summary:${fingerprint(draftData.candidate.summary)}`);
            for (const token of activeClaimTokens) {
              if (draftData.candidate.summary.includes(token)) hasClaimTokenMatch = true;
            }
          }
          for (const exp of draftData.candidate?.experiences ?? []) {
            for (const b of exp.bullets ?? []) {
              const wid = fingerprint(JSON.stringify([
                exp.company, exp.role, exp.startDate, exp.endDate,
                b.citations?.length ? [...b.citations].sort() : b.text,
              ]));
              jobWorkIds.add(wid);
              for (const c of b.citations ?? []) jobWorkIds.add(c);
              for (const token of activeClaimTokens) {
                if (b.text?.includes(token)) hasClaimTokenMatch = true;
              }
            }
          }
        } catch {}
      }

      const semRow = stmtSem.get(job.id) as { payload: string } | undefined;
      if (semRow) {
        try {
          const semData = JSON.parse(semRow.payload);
          for (const p of semData.passages ?? []) {
            for (const c of p.claims ?? []) {
              if (c.claim?.fact?.work_id) jobWorkIds.add(c.claim.fact.work_id);
            }
          }
        } catch {}
      }

      const clarRows = stmtClar.all(job.id) as { payload: string }[];
      for (const clarRow of clarRows) {
        try {
          const clarData = JSON.parse(clarRow.payload);
          if (clarData.fact?.work_id) jobWorkIds.add(clarData.fact.work_id);
        } catch {}
      }

      const genRow = stmtGen.get(job.id) as { payload: string } | undefined;
      if (genRow) {
        try {
          const genData = JSON.parse(genRow.payload);
          for (const p of genData.proposals?.proposals ?? []) {
            for (const cit of p.citations ?? []) jobWorkIds.add(cit);
          }
        } catch {}
      }

      // Skip jobs whose recorded work IDs share no intersection with any active correction's work_id
      let intersects = hasClaimTokenMatch;
      if (!intersects) {
        for (const wid of jobWorkIds) {
          if (activeWorkIds.has(wid)) {
            intersects = true;
            break;
          }
        }
      }
      if (!intersects) continue;

      // Candidate match: load draft structure without reading or verifying .pdf bytes
      const artifactId = job.artifact_version_ids.at(-1);
      let draft: C.JobDraft | undefined;
      let working_draft = false;

      if (artifactId) {
        const workingRow = stmtWorking.get(job.id, artifactId) as { id: string } | undefined;
        if (workingRow) {
          draft = r.repository.getLatestDraft(workingRow.id);
          working_draft = true;
        } else {
          const artifactRow = stmtArtifact.get(artifactId) as { payload: string } | undefined;
          if (artifactRow) {
            const artifactPayload = JSON.parse(artifactRow.payload);
            const files = r.repository.database.files;
            const manifestRef = { id: `${files.bundlePath('artifacts', job.id, artifactId)}/manifest.json`, fingerprint: artifactPayload.version_fingerprint };
            const manifestBytes = files.readArtifact(manifestRef, job.id, artifactId);
            const manifest = JSON.parse(manifestBytes.toString());
            draft = r.repository.getDraftRevision(manifest.draft_id, manifest.draft_revision);
            working_draft = false;
          }
        }
      }

      const target: C.SemanticTarget | undefined = draft ? { kind: 'draft', draft_id: draft.id, candidate: draft.candidate } : undefined;
      const context = r.semantic.context(job.id, target);
      const edits = context.passages.flatMap(p => {
        const matches = corrections.filter(c => c.before.fact.work_id === p.work_id && c.before.confirmed_claims?.some(text => p.text.includes(text) && !c.after.confirmed_claims?.includes(text)));
        if (!matches.length) return [];
        let after = p.text;
        for (const c of matches) {
          const old = c.before.confirmed_claims?.filter(text => after.includes(text)) ?? [];
          const replacement = c.after.confirmed_claims ?? [];
          if (old.length === 1 && replacement.length === 1 && replacement[0] !== old[0]) after = after.replace(old[0], replacement[0]);
        }
        return [{ path: p.subject.path, before: p.text, after, proposal_id: p.subject.proposal_id,
          corrections: matches.map(c => ({ update_id: c.update.id, answer: c.after.assertion })) }];
      });
      if (!edits.length) continue;

      jobs.push({
        job_id: job.id, company: job.company, role: job.role, target: context.target, draft_revision: draft?.revision,
        working_draft,
        job_revision: job.revision, fingerprint: fingerprint(canonical([knowledge.revision, job.revision, context.target, draft?.revision, context.candidate])), edits,
        historical_artifact: artifactId ?? null, busy: ['queued', 'preparing'].includes(job.preparation_state),
      });
    } catch (error) {
      if (error instanceof RepositoryError && ['not_found', 'invalid_relationship'].includes(error.code)) continue;
      throw error;
    }
  }

  return { corpus_revision: knowledge.revision, jobs, ...(incomplete ? { incomplete: true, next_cursor } : {}) };
}

/** Each selected job commits independently; late/stale results never overwrite another edit. */
export async function updateSelectedClarificationDrafts(r: JobsRuntime, request: z.infer<typeof SelectedUpdatesSchema>) {
  const preview = affectedClarificationDrafts(r, { maxDurationMs: Number.POSITIVE_INFINITY });
  const results: { job_id: string; status: string; error?: string; operation_key?: string }[] = [];
  const checks: (() => Promise<void>)[] = [];
  for (const selection of request.jobs) {
    try {
      const receipt = r.repository.withReceipt('selected_clarification_update', `${request.idempotency_key}:${selection.job_id}`, selection, () => {
        if (preview.corpus_revision !== request.expected_corpus_revision) throw new RepositoryError('revision_conflict', 'Shared answers changed. Reload the affected drafts.');
        const affected = preview.jobs.find(j => j.job_id === selection.job_id);
        if (!affected || affected.fingerprint !== selection.fingerprint || affected.busy) throw new RepositoryError('revision_conflict', 'Draft changed or preparation is active. Reload it.');
        if (selection.edits.some(e => !affected.edits.some(a => a.path === e.path && a.before === e.before))) throw new RepositoryError('invalid_relationship', 'Only affected passages may be updated.');
        const job = r.repository.getJob(selection.job_id);
        if (job.revision !== affected.job_revision || ['queued', 'preparing'].includes(job.preparation_state)) throw new RepositoryError('revision_conflict', 'Draft changed during update.');
        const ctx = r.semantic.context(selection.job_id, affected.target);
        const draft = affected.target.kind === 'draft' ? r.repository.getLatestDraft(affected.target.draft_id) : undefined;
        if (draft && draft.revision !== affected.draft_revision) throw new RepositoryError('revision_conflict', 'Draft changed during update.');
        const currentFingerprint = fingerprint(canonical([preview.corpus_revision, job.revision, affected.target, draft?.revision, ctx.candidate]));
        if (currentFingerprint !== affected.fingerprint) throw new RepositoryError('revision_conflict', 'Draft changed during update.');
        const candidate = C.replaceSelectedPassages(ctx.candidate, selection.edits);
        if (affected.target.kind === 'draft') {
          let draft = r.repository.getLatestDraft(affected.target.draft_id);
          if (!affected.working_draft) {
            const artifact = r.artifacts.getArtifact(affected.historical_artifact!);
            draft = r.artifacts.continueEditing({ job_id: selection.job_id, artifact_version_id: artifact.id, artifact_fingerprint: artifact.version_fingerprint,
              expected_job_revision: r.repository.getJob(selection.job_id).revision, idempotency_key: `correction-fork:${request.idempotency_key}:${selection.job_id}` });
          }
          const saved = r.repository.saveDraft({ ...draft, candidate }, draft.revision);
          return { job_id: selection.job_id, draft_id: saved.id, before_revision: draft.revision, after_revision: saved.revision, edits: selection.edits };
        }
        let view = r.proposals.read(selection.job_id);
        if (view.availability !== 'available') throw new RepositoryError('not_found', 'Review unavailable.');
        const starting = C.effectiveBaseResume(view.captured.base_resume, view.review);
        const patches: C.ProposalPatch[] = [];
        for (const e of selection.edits) {
          const p = affected.edits.find(a => a.path === e.path)!;
          if (p.proposal_id) patches.push({ proposal_id: p.proposal_id, edited_after: e.after });
          else {
            const candidates = [{ path: 'summary', text: starting.summary }, ...starting.experiences.flatMap((exp, ei) => exp.bullets.map((b, bi) => ({ path: `experiences.${ei}.bullets.${bi}.text`, text: b.text })))].filter(v => v.text === e.before);
            if (candidates.length !== 1) throw new RepositoryError('invalid_relationship', 'Original wording is ambiguous. Edit this passage in its job.');
            r.proposals.correctBase({ job_id: selection.job_id, review_id: view.review.id, expected_job_revision: r.repository.getJob(selection.job_id).revision,
              expected_review_revision: view.review.revision, input_fingerprint: view.review.input_fingerprint, path: candidates[0].path, text: e.after, idempotency_key: `correction:${request.idempotency_key}:${selection.job_id}:${e.path}` });
            view = r.proposals.read(selection.job_id) as Extract<C.ProposalReadResponse, { availability: 'available' }>;
          }
        }
        const saved = patches.length ? r.proposals.save({ job_id: selection.job_id, review_id: view.review.id, expected_job_revision: r.repository.getJob(selection.job_id).revision,
          expected_review_revision: view.review.revision, input_fingerprint: view.review.input_fingerprint, patches, groundings: [], feedback_kind: 'fact',
          explanation: 'Applied selected shared factual corrections only.', idempotency_key: `correction:${request.idempotency_key}:${selection.job_id}` }).result.review : view.review;
        return { job_id: selection.job_id, review_id: saved.id, before_revision: affected.target.review_revision, after_revision: saved.revision, edits: selection.edits };
      });
      const saved = receipt.result;
      const operation_key = `${request.idempotency_key}:${selection.job_id}`;
      if (receipt.replayed) {
        const checked = r.repository.database.db.prepare("SELECT result FROM mutation_receipts WHERE workspace_id=? AND operation='selected_clarification_check' AND idempotency_key=?").get(r.repository.database.workspaceId, operation_key) as { result: string } | undefined;
        results.push(checked ? JSON.parse(checked.result) : { ...saved, operation_key, status: 'needs_retry', error: 'Wording is saved. Open this draft to finish its checks.' });
        continue;
      }
      // Save all selected drafts before waiting for any model or renderer.
      checks.push(async () => {
      let result: { job_id: string; status: string; error?: string; operation_key: string };
      try {
      const draft = 'draft_id' in saved && saved.draft_id ? r.repository.getLatestDraft(saved.draft_id) : undefined;
      const target: C.SemanticTarget | undefined = draft ? { kind: 'draft', draft_id: draft.id, candidate: draft.candidate } : undefined;
      const facts = r.semantic.read(selection.job_id, target);
      r.semantic.start(selection.job_id, { target: facts.target, input_fingerprint: facts.input_fingerprint, expected_job_revision: facts.job_revision,
        expected_semantic_revision: facts.semantic_revision, reason: 'edit', idempotency_key: `correction-check:${request.idempotency_key}:${selection.job_id}` });
      await r.semantic.wait(selection.job_id);
      const check = draft ? await r.drafts.check(selection.job_id, draft.id, draft.candidate) : r.proposals.refreshFacts((r.proposals.read(selection.job_id) as Extract<C.ProposalReadResponse, { availability: 'available' }>).review).validation;
      if (draft && check.status === 'ready' && 'binding' in check) await r.drafts.finalize(selection.job_id, draft.id, {
        expected_job_revision: check.job_revision, expected_draft_revision: draft.revision, binding: check.binding,
        idempotency_key: `correction-pdf:${request.idempotency_key}:${selection.job_id}` });
      if (!draft && check.status === 'ready') {
        const view = r.proposals.read(selection.job_id), job = r.repository.getJob(selection.job_id);
        if (view.availability === 'available' && view.generation.generation_policy === C.SYNTHESIS_POLICY && job.preparation_state === 'needs_input')
          r.proposals.continue({ job_id: job.id, review_id: view.review.id, expected_job_revision: job.revision,
            expected_review_revision: view.review.revision, input_fingerprint: view.review.input_fingerprint,
            validation_fingerprint: view.review.validation.fingerprint, idempotency_key: `correction-pdf:${request.idempotency_key}:${job.id}` });
      }
      result = { ...saved, operation_key, status: check.status };
      } catch (e) { result = { ...saved, operation_key, status: 'needs_retry', error: e instanceof Error ? e.message : 'Checks unavailable. Wording is saved.' }; }
      r.repository.withReceipt('selected_clarification_check', operation_key, { operation_key }, () => result);
      results.push(result);
      });
    } catch (e) { results.push({ job_id: selection.job_id, status: 'needs_retry', error: e instanceof Error ? e.message : 'Update unavailable.' }); }
  }
  for (const check of checks) await check();
  return { results };
}

export function clarificationUpdateHistory(r: JobsRuntime) {
  return (r.repository.database.db.prepare("SELECT idempotency_key,result FROM mutation_receipts WHERE workspace_id=? AND operation='selected_clarification_update' ORDER BY rowid DESC LIMIT 100").all(r.repository.database.workspaceId) as { idempotency_key: string; result: string }[])
    .map(row => {
      const checked = r.repository.database.db.prepare("SELECT result FROM mutation_receipts WHERE workspace_id=? AND operation='selected_clarification_check' AND idempotency_key=?").get(r.repository.database.workspaceId, row.idempotency_key) as { result: string } | undefined;
      const undone = r.repository.database.db.prepare("SELECT 1 FROM mutation_receipts WHERE workspace_id=? AND operation='undo_clarification_update' AND idempotency_key=?").get(r.repository.database.workspaceId, row.idempotency_key);
      return { ...JSON.parse(row.result), operation_key: row.idempotency_key, check: checked ? JSON.parse(checked.result) : { status: 'needs_retry' }, undone: !!undone };
    });
}

export function undoClarificationUpdate(r: JobsRuntime, operationKey: string) {
  return r.repository.withReceipt('undo_clarification_update', operationKey, { operationKey }, () => {
    const saved = clarificationUpdateHistory(r).find(item => item.operation_key === operationKey);
    if (!saved) throw new RepositoryError('not_found', 'Saved correction update unavailable.');
    const job = r.repository.getJob(saved.job_id);
    if (['queued', 'preparing'].includes(job.preparation_state)) throw new RepositoryError('ineligible', 'Finish active preparation before undoing a correction.');
    const edits: C.PassageEdit[] = saved.edits.map((e: C.PassageEdit) => ({ path: e.path, before: e.after, after: e.before }));
    let draftId = saved.draft_id;
    // A saved proposal review may have automatically become a PDF since this receipt was written.
    if (!draftId && saved.review_id && job.artifact_version_ids.length) {
      const artifact = r.artifacts.review(job.id, job.artifact_version_ids.at(-1)!);
      const sourceReview = r.artifacts.attemptReview(artifact.artifact.attempt_id);
      if (!sourceReview || sourceReview.id !== saved.review_id || sourceReview.revision < saved.after_revision)
        throw new RepositoryError('revision_conflict', 'A different review produced this PDF. Compare its history before undoing.');
      draftId = (artifact.working_draft ?? artifact.draft).id;
    }
    if (draftId) {
      let draft = r.repository.getLatestDraft(draftId);
      const artifactId = job.artifact_version_ids.at(-1);
      if (artifactId) {
        const artifact = r.artifacts.review(job.id, artifactId);
        if (artifact.draft.id === draft.id) draft = r.artifacts.continueEditing({ job_id: job.id, artifact_version_id: artifactId,
          artifact_fingerprint: artifact.artifact.version_fingerprint, expected_job_revision: job.revision, idempotency_key: `undo-fork:${operationKey}` });
        else if (artifact.working_draft?.id !== draft.id) throw new RepositoryError('revision_conflict', 'A newer PDF replaced this draft. Compare its history before undoing.');
      }
      const candidate = C.replaceSelectedPassages(draft.candidate, edits);
      return { draft: r.repository.saveDraft({ ...draft, candidate }, draft.revision) };
    }
    let view = r.proposals.read(job.id);
    if (view.availability !== 'available' || view.review.id !== saved.review_id) throw new RepositoryError('revision_conflict', 'The review was replaced. Open its history to compare.');
    const ctx = r.semantic.context(job.id);
    C.replaceSelectedPassages(ctx.candidate, edits);
    for (const e of edits) {
      const proposal = C.proposalForPassage(ctx.proposals, e.path, e.before);
      if (proposal) r.proposals.save({ job_id: job.id, review_id: view.review.id, expected_job_revision: r.repository.getJob(job.id).revision,
        expected_review_revision: view.review.revision, input_fingerprint: view.review.input_fingerprint, patches: [{ proposal_id: proposal.id, edited_after: e.after }],
        groundings: [], feedback_kind: 'wording', explanation: 'Undid selected clarification wording; the corrected fact remains recorded.', idempotency_key: `undo:${operationKey}:${e.path}` });
      else {
        const base = C.effectiveBaseResume(view.captured.base_resume, view.review);
        const paths = [{ path: 'summary', text: base.summary }, ...base.experiences.flatMap((exp, ei) => exp.bullets.map((b, bi) => ({ path: `experiences.${ei}.bullets.${bi}.text`, text: b.text })))].filter(p => p.text === e.before);
        if (paths.length !== 1) throw new RepositoryError('revision_conflict', 'Original target changed. Review current wording.');
        r.proposals.correctBase({ job_id: job.id, review_id: view.review.id, expected_job_revision: r.repository.getJob(job.id).revision,
          expected_review_revision: view.review.revision, input_fingerprint: view.review.input_fingerprint, path: paths[0].path, text: e.after, idempotency_key: `undo:${operationKey}:${e.path}` });
      }
      view = r.proposals.read(job.id) as Extract<C.ProposalReadResponse, { availability: 'available' }>;
    }
    return { review: view.review };
  });
}
