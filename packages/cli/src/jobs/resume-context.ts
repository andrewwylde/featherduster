import * as C from '@featherduster/core';
import { sourceFingerprint } from '../corpus/load.js';
import { JobArtifactsService } from './artifacts.js';
import { JobsRepository, RepositoryError } from './repository.js';
import { fingerprint } from './files.js';
import { getLatexTemplate } from './templates.js';
import type { selectJobSkillset } from './skillset.js';
export const canonicalResumeValue = (value: unknown): string => JSON.stringify(value, (_, v) =>
  v && typeof v === 'object' && !Array.isArray(v) ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => a.localeCompare(b))) : v);
export type SelectResumeEvidence = (id: string, ids: string[]) => ReturnType<typeof selectJobSkillset>;
export function currentResumeContext(r: JobsRepository, artifacts: JobArtifactsService, jobId: string, artifactId: string,
  select: SelectResumeEvidence, currentRules: () => C.PrivacyRulesConfig) {
  const fail = (message: string): never => { throw new RepositoryError('ineligible', message); };
  const job = r.getJob(jobId), artifact = artifacts.getArtifact(artifactId);
  if (artifact.job_id !== jobId) throw new RepositoryError('invalid_relationship', 'Artifact belongs to another job');
  if (job.artifact_version_ids.at(-1) !== artifact.id) fail('This is historical. Return to the current resume.');
  if (r.active().some(a => a.job_id === jobId)) fail('Stop or finish preparation before finalizing current files.');
  const context = artifacts.capturedContext(artifact.input_snapshot_id), input = context.input;
  const canonical = canonicalResumeValue;
  if (!context.job_scope || canonical(context.job_scope) !== canonical({ company: job.company, role: job.role, employer_id: job.employer_id })) fail('Job scope changed. Review current inputs first.');
  const latest = r.database.db.prepare("SELECT id FROM input_snapshots WHERE job_id=? AND json_extract(payload, '$.schema_version')=1 ORDER BY rowid DESC LIMIT 1").get(jobId) as { id: string } | undefined;
  if (latest?.id !== input.id || job.posting_snapshot_id !== input.posting.id || job.recovery?.kind === 'stale_inputs') fail('Posting or starting inputs changed. Review current inputs first.');
  const read = (ref: C.ImmutableReference) => r.database.files.readSnapshot(ref, jobId, input.id).toString();
  const rules = C.PrivacyRulesConfigSchema.parse(JSON.parse(read(input.privacy_rules)));
  if (canonical(rules) !== canonical(C.PrivacyRulesConfigSchema.parse(currentRules()))) fail('Privacy rules changed. Review current inputs first.');
  const evidence = context.evidence.getAll();
  let live: ReturnType<SelectResumeEvidence>;
  try { live = select(jobId, evidence.map(e => e.id)); }
  catch { return fail('Selected evidence is unavailable. Inspect sources and prepare again.'); }
  if (canonical(evidence.map(sourceFingerprint)) !== canonical(live.evidence.map(sourceFingerprint)) || canonical(context.knowledge.materialized ?? { support: [], sources: [] }) !== canonical(live.knowledge.materialized ?? { support: [], sources: [] })) fail('Evidence or scoped support changed. Inspect sources and prepare again.');
  const template = C.LatexTemplateProfileSchema.parse(JSON.parse(read(input.template)));
  if (canonical(template) !== canonical(getLatexTemplate(template.id)) || template.page_budget !== input.policy.page_budget) fail('Template changed. Review current inputs first.');
  const contextFingerprint = fingerprint(canonical({ input: input.fingerprint, scope: context.job_scope, rules, template,
    evidence: evidence.map(sourceFingerprint), knowledge: context.knowledge.materialized, parent: artifact.version_fingerprint }));
  return { job, artifact, context, rules, template, contextFingerprint };
}

