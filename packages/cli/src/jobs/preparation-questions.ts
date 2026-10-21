import * as C from '@featherduster/core';
import { z } from 'zod';
import { fingerprint } from './files.js';
import { canonicalResumeValue as canonical } from './resume-context.js';
import { PreparationBatchRepository } from './preparation-batch-repository.js';
import type { PreparationCoordinator } from './preparation-coordinator.js';
import { RepositoryError } from './repository.js';
import { randomUUID } from 'node:crypto';
import { ProposalRepository } from './proposal-repository.js';
import type { ProposalService } from './proposal-service.js';
import type { SemanticService } from './semantic-service.js';
const citedWork = (fact: C.JobFact): string[] => { try { return JSON.parse(fact.passage.work_context ?? '{}').cited_work ?? []; } catch { return []; } };
export const AnswerPreparationQuestionSchema = z.object({ members: z.array(C.PreparationQuestionMemberSchema).min(1),
  action: z.enum(['answer', 'narrower', 'later']), assertion: z.string().min(1), confirmed: z.boolean(),
  kind: z.enum(['confirmation', 'correction']), corrected_assertion: z.string().min(1).optional(), effective_date: z.string().optional(), idempotency_key: z.string().min(1),
}).strict();
export class PreparationQuestions {
  constructor(private batches: PreparationBatchRepository, private semantic: SemanticService, private coordinator: PreparationCoordinator, private proposals: ProposalService) {}
  read(batchId: string) {
    this.batches.get(batchId);
    const members: C.PreparationQuestionMember[] = [];
    for (const member of this.batches.members(batchId).filter(m => ['question', 'later'].includes(m.state) || (m.questions_visible && ['pending', 'running'].includes(m.state)))) {
      let facts: C.JobFacts;
      try {
        const draft = member.draft_id ? this.batches.jobs.getLatestDraft(member.draft_id) : null;
        facts = this.semantic.read(member.job_id, draft ? { kind: 'draft', draft_id: draft.id, candidate: draft.candidate } : undefined);
      } catch { continue; }
      if (facts.execution === 'unavailable') continue;
      for (const fact of facts.facts.filter(f => !f.resolution && ['needs_clarification', 'contradicted'].includes(f.state))) {
        let cited: string[] = [], company: string | undefined;
        try { const work = JSON.parse(fact.passage.work_context ?? '{}'); cited = work.cited_work ?? []; company = work.company; } catch { /* no safe work identity */ }
        const alternative = fact.state === 'needs_clarification' ? facts.sources?.find(source => cited.includes(source.evidence_id) && source.field === 'summary'
          && source.text !== fact.passage.text && source.company === company) : undefined;
        const narrower = alternative ? { text: alternative.text, source: { evidence_id: alternative.evidence_id, evidence_fingerprint: alternative.evidence_fingerprint,
          field: alternative.field, start: alternative.start, end: alternative.start + alternative.text.length, quote: alternative.text } } : undefined;
        const binding = { job_id: member.job_id, input_fingerprint: facts.input_fingerprint, job_revision: facts.job_revision,
          semantic_revision: facts.semantic_revision, target: facts.target, claim_ids: [fact.claim.id], fact: fact.claim.fact,
          ...(narrower ? { narrower } : {}), assertion: fact.claim.text, question: fact.question ?? fact.explanation, state: fact.state as 'needs_clarification' | 'contradicted', source_ids: [...new Set(fact.evidence.map(q => q.evidence_id))] };
        members.push({ ...binding, content_fingerprint: fingerprint(canonical(binding)) });
      }
    }
    return C.groupPreparationQuestions(members).map(group => ({ ...group, details: group.members.map(member => {
      const job = this.batches.jobs.getJob(member.job_id), facts = this.semantic.read(member.job_id, member.target);
      return { job_id: job.id, company: job.company, role: job.role, sources: facts.sources,
        facts: facts.facts.filter(f => member.claim_ids.includes(f.claim.id)) };
    }) }));
  }
  materials(batchId: string) {
    this.batches.get(batchId);
    return this.batches.members(batchId).flatMap(member => {
      const view = this.proposals.read(member.job_id);
      if (view.availability !== 'available' || view.input_stale) return [];
      const job = this.batches.jobs.getJob(member.job_id);
      const overlay = C.applyProposalPatches(view.generation.proposals.proposals, [], view.review.patches).proposals;
      return view.review.validation.issues.filter(i => i.details.some(d => d.kind === 'material_decision')).flatMap(issue => {
        const subject = issue.subject;
        const proposal = subject.kind === 'proposal' ? overlay.find(p => p.id === subject.proposal_id) : undefined;
        if (!proposal) return [];
        return [{ job_id: job.id, company: job.company, role: job.role, job_revision: job.revision, review_id: view.review.id, review_revision: view.review.revision,
          input_fingerprint: view.review.input_fingerprint, generation_id: view.generation.id, proposal_id: proposal.id, before: proposal.before, reason: proposal.rationale,
          question: proposal.type === 'bullet.drop' ? 'May this accomplishment be omitted?' : 'May these capabilities be removed?' }];
      });
    });
  }
  decide(batchId: string, raw: unknown) {
    const request = z.object({ job_id: z.string().uuid(), expected_job_revision: z.number().int().nonnegative(), review_id: z.string().uuid(),
      expected_review_revision: z.number().int().nonnegative(), input_fingerprint: z.string().min(1), proposal_id: z.string().min(1),
      action: z.enum(['omit', 'retain', 'later']), idempotency_key: z.string().min(1) }).strict().parse(raw);
    const jobs = this.batches.jobs;
    const result = jobs.withReceipt('automatic_material_decision', request.idempotency_key, { batchId, request }, () => {
      const current = this.materials(batchId).find(m => m.job_id === request.job_id && m.proposal_id === request.proposal_id);
      if (!current || current.job_revision !== request.expected_job_revision || current.review_id !== request.review_id
        || current.review_revision !== request.expected_review_revision || current.input_fingerprint !== request.input_fingerprint)
        throw new RepositoryError('revision_conflict', 'The accomplishment or starting inputs changed. Review the current decision.');
      if (request.action === 'later') { this.coordinator.defer(request.job_id); return { status: 'later' }; }
      if (request.action === 'retain') this.proposals.save({ job_id: request.job_id, review_id: request.review_id,
        expected_job_revision: request.expected_job_revision, expected_review_revision: request.expected_review_revision, input_fingerprint: request.input_fingerprint,
        patches: [{ proposal_id: request.proposal_id, decision: 'rejected' }], groundings: [], feedback_kind: 'rejection', explanation: 'Retained the accomplishment after an explicit material content decision.', idempotency_key: `retain:${request.idempotency_key}` });
      else {
        const value = { ...current, id: randomUUID(), decision: 'omit', actor: 'local-human', recorded_at: new Date().toISOString() };
        const member = this.batches.members(batchId).find(m => m.job_id === request.job_id)!;
        jobs.database.db.prepare('INSERT INTO preparation_decisions VALUES (?,?,?,?,?,?)').run(value.id, request.job_id, member.input_snapshot_id, current.generation_id, current.proposal_id, JSON.stringify(value));
        const active = new ProposalRepository(jobs).getActive(request.job_id)!; this.proposals.refreshFacts(active);
      }
      return { status: 'saved' };
    });
    if (!result.replayed && request.action !== 'later') this.coordinator.answered(request.job_id);
    return result;
  }
  answer(batchId: string, groupId: string, raw: unknown) {
    const request = AnswerPreparationQuestionSchema.parse(raw), jobs = this.batches.jobs;
    const result = jobs.withReceipt('preparation_group_answer', request.idempotency_key, { batchId, groupId, request }, () => {
      const group = this.read(batchId).find(g => g.id === groupId);
      return request.members.map((member, index) => {
        try {
          return jobs.database.db.transaction(() => {
            const current = group?.members.find(m => m.job_id === member.job_id && canonical(m) === canonical(member));
            if (!current) throw new RepositoryError('revision_conflict', 'This job or question changed. Reload its current facts.');
            if (request.action === 'later') { this.coordinator.defer(member.job_id); return { job_id: member.job_id, status: 'later' as const }; }
            if (request.action === 'narrower') {
              if (!current.narrower || member.target.kind !== 'review') throw new RepositoryError('invalid_relationship', 'No bound narrower alternative is available.');
              const view = this.proposals.read(member.job_id);
              if (view.availability !== 'available') throw new RepositoryError('revision_conflict', 'Reload the current draft.');
              const facts = this.semantic.read(member.job_id, member.target), fact = facts.facts.find(f => member.claim_ids.includes(f.claim.id));
              if (!fact) throw new RepositoryError('revision_conflict', 'The claim changed.');
              const overlay = C.applyProposalPatches(view.generation.proposals.proposals, [], view.review.patches).proposals;
              const proposal = overlay.find(p => p.id === fact.passage.subject.proposal_id && (p.edited_after ?? p.after) === fact.passage.text);
              if (proposal) this.proposals.save({ job_id: member.job_id, review_id: view.review.id, expected_job_revision: member.job_revision, expected_review_revision: view.review.revision,
                input_fingerprint: member.input_fingerprint, patches: [{ proposal_id: proposal.id, edited_after: current.narrower.text }], groundings: [], feedback_kind: 'wording', explanation: 'Explicitly selected captured narrower wording instead of confirming an uncertain fact.', idempotency_key: `narrower:${request.idempotency_key}:${index}` });
              else {
                const base = C.effectiveBaseResume(view.captured.base_resume, view.review);
                const targets = base.experiences.flatMap((experience, ei) => experience.bullets.flatMap((bullet, bi) => bullet.text === fact.passage.text
                  && JSON.stringify([...(bullet.citations ?? [])].sort()) === JSON.stringify([...citedWork(fact)].sort()) ? [`experiences.${ei}.bullets.${bi}.text`] : []));
                if (targets.length !== 1) throw new RepositoryError('revision_conflict', 'The original wording is missing or ambiguous; edit the current draft.');
                this.proposals.correctBase({ job_id: member.job_id, review_id: view.review.id, expected_job_revision: member.job_revision,
                  expected_review_revision: view.review.revision, input_fingerprint: member.input_fingerprint, path: targets[0], text: current.narrower.text, idempotency_key: `narrower:${request.idempotency_key}:${index}` });
              }
              const decision = { id: randomUUID(), job_id: member.job_id, before: fact.passage.text, after: current.narrower.text, reason: 'You selected the displayed captured wording rather than confirming the uncertain assertion.', decision: 'narrower', actor: 'local-human', source: current.narrower.source };
              jobs.database.db.prepare('INSERT INTO preparation_decisions VALUES (?,?,?,?,?,?)').run(decision.id, member.job_id, view.review.input_snapshot_id, view.generation.id, proposal?.id ?? `base:${fact.passage.subject.id}`, JSON.stringify(decision));
              return { job_id: member.job_id, status: 'saved' as const };
            }
            this.semantic.clarify(member.job_id, { target: member.target, input_fingerprint: member.input_fingerprint,
              expected_job_revision: member.job_revision, expected_semantic_revision: member.semantic_revision,
              claim_ids: member.claim_ids, fact: member.fact, assertion: request.assertion, kind: request.kind,
              confirmed: request.confirmed, corrected_assertion: request.corrected_assertion, effective_date: request.effective_date,
              source_ids: member.source_ids, supersedes: null, idempotency_key: `group:${request.idempotency_key}:${index}` });
            return { job_id: member.job_id, status: 'saved' as const };
          }).immediate();
        } catch (error) { return { job_id: member.job_id, status: 'conflict' as const, error: error instanceof Error ? error.message : String(error) }; }
      });
    });
    if (!result.replayed && request.action !== 'later') for (const item of result.result) if (item.status === 'saved') this.coordinator.answered(item.job_id);
    return result;
  }
}
