import * as C from '@featherduster/core';
import { randomUUID } from 'node:crypto';
import { PreparationBatchRepository } from './preparation-batch-repository.js';
import { ProposalService } from './proposal-service.js';
import type { OwnershipFence } from './repository.js';
import type { SemanticService } from './semantic-service.js';
import { fingerprint } from './files.js';

export const isTransientPreparationFailure = (message: string) => /timeout|timed out|temporar|offline|ECONNRESET|ECONNREFUSED|EPIPE|rate.limit|\b429\b|\b503\b/i.test(message);
export interface AutomaticRepairRecord {
  id: string; job_id: string; cycle_id: string; input_snapshot_id: string; review_id: string; review_revision: number;
  proposal_id: string; original_target: C.Proposal['target']; before: string; after: string; reason: string;
  sources: C.SourceQuote[]; provenance: 'worker'; meaningful: boolean; created_at: string;
}
/** Exact supported narrower sentences only. No free-form rewrite, factual confirmation, drop or skill addition. */
export function supportedNarrowerWording(before: string, sources: string[]) {
  const alternatives = [before.replace(/^Led (?:the )?implementation of /i, 'Implemented '),
    before.replace(/^(?:Led|Owned) (?:the )?(?:development|delivery) of /i, 'Built '),
    before.replace(/\b(?:globally|single-handedly|company-wide)\s+/gi, '')];
  const normalize = (text: string) => text.trim().replace(/[.!]$/, '').replace(/\s+/g, ' ').toLowerCase();
  return alternatives.find(after => after !== before && after.trim() && sources.some(source => normalize(source).includes(normalize(after)))) ?? null;
}
export async function repairAutomaticReview(reviews: ProposalService, semantic: SemanticService, review: C.ProposalReviewRevision,
  fence: OwnershipFence, signal: AbortSignal): Promise<C.ProposalReviewRevision> {
  const batches = new PreparationBatchRepository(reviews.jobs), member = batches.enrolled(review.job_id);
  if (!member) return review;
  let current = review;
  for (let pass = 0; pass < 2; pass++) {
    signal.throwIfAborted();
    const generation = reviews.proposals.getGeneration(current.generation_id);
    const facts = semantic.read(current.job_id), overlay = C.applyProposalPatches(generation.proposals.proposals, [], current.patches).proposals;
    const patches: C.ProposalPatch[] = [], records: AutomaticRepairRecord[] = [];
    for (const proposal of overlay) {
      if (!['bullet.rewrite', 'summary.rewrite'].includes(proposal.type) || proposal.decision === 'rejected') continue;
      const before = proposal.edited_after ?? proposal.after;
      const affected = facts.facts.filter(f => f.passage.text === before);
      if (!affected.some(f => f.state === 'needs_clarification' && !f.resolution) || affected.some(f => ['contradicted', 'unavailable'].includes(f.state))) continue;
      const sources = (facts.sources ?? []).filter(s => proposal.citations.includes(s.evidence_id));
      const after = supportedNarrowerWording(before, sources.map(s => s.text));
      if (!after) continue;
      patches.push({ proposal_id: proposal.id, edited_after: after });
      records.push({ id: randomUUID(), job_id: current.job_id, cycle_id: member.cycle_id, input_snapshot_id: current.input_snapshot_id,
        review_id: current.id, review_revision: current.revision + 1, proposal_id: proposal.id, original_target: proposal.target,
        before, after, reason: 'Removed an unsupported qualifier; retained the sentence present in cited captured evidence.',
        sources: sources.filter(s => s.text.toLowerCase().includes(after.toLowerCase())).map(s => ({ evidence_id: s.evidence_id, evidence_fingerprint: s.evidence_fingerprint,
          field: s.field, start: s.start, end: s.start + s.text.length, quote: s.text })), provenance: 'worker', meaningful: true, created_at: new Date().toISOString() });
    }
    const capturedBase = reviews.artifacts.capturedContext(current.input_snapshot_id).base_resume;
    const base = C.effectiveBaseResume(capturedBase, current), baseEdits: { path: string; before: string; after: string }[] = [];
    for (const fact of facts.facts) {
      if (fact.passage.subject.proposal_id || fact.state !== 'needs_clarification' || fact.resolution) continue;
      const before = fact.passage.text, peers = facts.facts.filter(other => other.passage.subject.id === fact.passage.subject.id);
      if (peers.some(other => ['contradicted', 'unavailable'].includes(other.state))) continue;
      let citations = fact.evidence.map(quote => quote.evidence_id), company: string | undefined;
      try { const context = JSON.parse(fact.passage.work_context ?? '{}'); citations = context.cited_work ?? citations; company = context.company; } catch { continue; }
      const sources = (facts.sources ?? []).filter(source => citations.includes(source.evidence_id) && (!company || source.company === company));
      const after = supportedNarrowerWording(before, sources.map(source => source.text));
      if (!after) continue;
      const targets = fact.passage.subject.path === 'summary' && base.summary === before ? [{ path: 'summary', experience_index: -1, bullet_index: -1 }]
        : base.experiences.flatMap((experience, ei) => experience.bullets.flatMap((bullet, bi) => bullet.text === before && (!company || experience.company === company)
          && JSON.stringify([...(bullet.citations ?? [])].sort()) === JSON.stringify([...citations].sort()) ? [{ path: `experiences.${ei}.bullets.${bi}.text`, experience_index: ei, bullet_index: bi }] : []));
      if (targets.length !== 1 || baseEdits.some(edit => edit.path === targets[0].path)) continue;
      const target = targets[0]; baseEdits.push({ path: target.path, before, after });
      records.push({ id: randomUUID(), job_id: current.job_id, cycle_id: member.cycle_id, input_snapshot_id: current.input_snapshot_id, review_id: current.id, review_revision: current.revision + 1,
        proposal_id: `base:${target.path}`, original_target: { experience_index: target.experience_index, bullet_index: target.bullet_index, skill_group_index: -1 }, before, after,
        reason: 'Removed an unsupported qualifier from original captured wording while retaining exact cited implementation.',
        sources: sources.map(source => ({ evidence_id: source.evidence_id, evidence_fingerprint: source.evidence_fingerprint, field: source.field,
          start: source.start, end: source.start + source.text.length, quote: source.text })), provenance: 'worker', meaningful: true, created_at: new Date().toISOString() });
    }
    if (!patches.length && !baseEdits.length) return current;
    batches.reserve(member, `repair:${current.id}:${current.revision}`, 'repair');
    current = reviews.automaticPatches(current, patches, fence, baseEdits);
    for (const record of records) reviews.jobs.database.db.prepare('INSERT INTO preparation_repairs VALUES (?,?,?,?)').run(record.id, record.job_id, record.cycle_id, JSON.stringify(record));
    const next = semantic.read(current.job_id);
    semantic.start(current.job_id, { target: next.target, expected_job_revision: next.job_revision, expected_semantic_revision: next.semantic_revision,
      input_fingerprint: next.input_fingerprint, reason: 'check', idempotency_key: `repair:${fingerprint(JSON.stringify([patches, baseEdits]))}:${current.revision}` }, fence.attempt_id, signal);
    await semantic.wait(current.job_id);
    signal.throwIfAborted(); current = reviews.refreshFacts(current, fence);
    if (current.validation.status === 'ready') return current;
  }
  return current;
}
/** Reorders may only rearrange existing supported entries, never add skills or drop unique entries. */
export function repairAutomaticStructure(base: C.ResumeSpec, proposals: C.Proposal[]) {
  const changes: { proposal_id: string; before: string; after: string; reason: string }[] = [];
  const repaired = proposals.map(proposal => {
    const next = structuredClone(proposal);
    if (['summary.rewrite', 'bullet.rewrite', 'bullet.add'].includes(next.type)) {
      const before = next.edited_after ?? next.after;
      let after = before;
      for (const id of next.citations) {
        after = after.replaceAll(`[${id}]`, '').replaceAll(`[source:${id}]`, '');
      }
      after = after.replace(/\s+([.,;:!?])/g, '$1').replace(/ {2,}/g, ' ').trim();
      if (after !== before) { next.edited_after = after; changes.push({ proposal_id: next.id, before, after, reason: 'Removed internal citation labels from public wording while retaining the captured citation bindings.' }); }
    }
    if (['bullet.rewrite', 'bullet.add'].includes(next.type)) {
      const experience = base.experiences[next.target.experience_index ?? -1];
      const repeated = experience?.bullets.some((bullet, i) => (next.type === 'bullet.add' || i !== next.target.bullet_index) && bullet.text === (next.edited_after ?? next.after));
      if (repeated) {
        next.decision = 'rejected';
        changes.push({ proposal_id: next.id, before: next.after, after: next.before, reason: 'Retained the original accomplishment instead of introducing a duplicate bullet.' });
      }
    }
    if (next.type === 'skills.reorder') {
      const group = base.skills[next.target.skill_group_index ?? -1];
      if (!group) return next;
      const existing = new Map(group.skills.map(skill => [skill.toLowerCase(), skill]));
      const ordered = [...new Set(next.skills.map(skill => existing.get(skill.toLowerCase())).filter((skill): skill is string => !!skill))];
      next.skills = [...ordered, ...group.skills.filter(skill => !ordered.includes(skill))];
      if (JSON.stringify(next.skills) !== JSON.stringify(proposal.skills)) changes.push({ proposal_id: next.id, before: JSON.stringify(proposal.skills), after: JSON.stringify(next.skills), reason: 'Reordered existing skills only; removed duplicate and unknown reorder entries without adding capabilities.' });
    }
    if (next.type === 'bullet.reorder') {
      const experience = base.experiences[next.target.experience_index ?? -1];
      if (!experience) return next;
      const existing = experience.bullets.map((_, i) => i), ordered = [...new Set(next.order.filter(i => existing.includes(i)))];
      next.order = [...ordered, ...existing.filter(i => !ordered.includes(i))];
      if (JSON.stringify(next.order) !== JSON.stringify(proposal.order)) changes.push({ proposal_id: next.id, before: JSON.stringify(proposal.order), after: JSON.stringify(next.order), reason: 'Repaired reorder against original bullet identities, retaining unique content.' });
    }
    return next;
  });
  return { proposals: repaired, changes };
}
/** Only repeated complete sentences may be removed for layout; distinct outcomes stay intact. */
export function trimRepeatedSentences(text: string): string {
  const sentences = text.match(/[^.!?]+[.!?]+(?:\s+|$)|[^.!?]+$/g);
  if (!sentences || sentences.map(s => s.trim()).join(' ') !== text.trim().replace(/\s+/g, ' ')) return text;
  const seen = new Set<string>(), kept: string[] = [];
  for (const sentence of sentences) {
    const key = sentence.trim();
    if (!seen.has(key)) { seen.add(key); kept.push(key); }
  }
  return kept.length < sentences.length ? kept.join(' ') : text;
}
