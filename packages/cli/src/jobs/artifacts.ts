import yaml from 'js-yaml';
import { sourceFingerprint } from '../corpus/load.js';
import { randomUUID } from 'node:crypto';
import * as C from '@featherduster/core';
import { z } from 'zod';
import { fingerprint } from './files.js';
import { JobsRepository, RepositoryError, type OwnershipFence } from './repository.js';

const canonical = (value: unknown): string => JSON.stringify(value, (_, v) => v && typeof v === 'object' && !Array.isArray(v) ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => a.localeCompare(b))) : v);
type Bytes = string | Uint8Array;
/** An empty CLI model records the choice to use that CLI's default. */
export const JobRunnerConfigurationSchema = z.object({
  runner: z.string().min(1), model: z.string(),
}).strict().refine(({ runner, model }) => model.length > 0 || runner === 'codex' || runner === 'claude-code', {
  message: 'Configure a model for this runner', path: ['model'],
});
export interface CaptureInputsRequest {
  job_id: string; posting_id: string; base_resume: Bytes;
  selected_evidence: { source_id: string; bytes: Bytes }[];
  privacy_rules: unknown; template: C.LatexTemplateProfile;
  /** Explicit non-secret provider/model settings, never a credentials file. */
  runner_configuration: { runner: string; model: string };
  policy: C.PreparationPolicy;
  corpus_knowledge?: C.CorpusSnapshot;
}
const inputManifest = z.object({
  schema_version: z.literal(1), snapshot: C.InputSnapshotSchema.omit({ fingerprint: true }),
  posting_file: C.ImmutableReferenceSchema, policy_file: C.ImmutableReferenceSchema,
  evidence_sources: z.array(z.string().min(1)),
  job_scope: z.object({ company: z.string().nullable(), role: z.string().nullable(), employer_id: z.string().nullable() }).optional(),
}).strict();
const artifactManifest = z.object({
  schema_version: z.literal(1), artifact: C.ArtifactVersionSchema.innerType().omit({ version_fingerprint: true }),
  draft_id: z.string().uuid(), draft_revision: z.number().int().nonnegative(), previews: z.array(C.ImmutableReferenceSchema),
}).strict();

export class JobArtifactsService {
  private readonly now: () => string;
  private readonly uuid: () => string;
  constructor(private readonly repository: JobsRepository, options: { now?: () => string; uuid?: () => string } = {}) {
    this.now = options.now ?? (() => new Date().toISOString()); this.uuid = options.uuid ?? randomUUID;
  }
  private tx<T>(fn: () => T): T { return this.repository.database.db.transaction(fn).immediate(); }
  private corrupt<T>(fn: () => T): T {
    try { return fn(); } catch (error) {
      if (error instanceof RepositoryError && error.code === 'corrupt_data') throw error;
      throw new RepositoryError('corrupt_data', 'Immutable bundle is missing, unsafe or changed; recover original files');
    }
  }
  captureInputs(request: CaptureInputsRequest): C.InputSnapshot {
    return this.tx(() => {
      const r = this.repository; const job = r.getJob(request.job_id); const posting = r.getPostingSnapshot(request.posting_id);
      if (posting.job_id !== job.id || posting.content_fingerprint !== fingerprint(posting.text)) throw new RepositoryError('invalid_relationship', 'Posting binding mismatch');
      const id = this.uuid(); const files = r.database.files; const parent = files.bundlePath('snapshots', job.id, id);
      const bundle: Record<string, Bytes> = {};
      const add = (name: string, bytes: Bytes): C.ImmutableReference => { bundle[name] = bytes; return { id: `${parent}/${name}`, fingerprint: fingerprint(bytes) }; };
      const policy = C.PreparationPolicySchema.parse(request.policy);
      const runner = JobRunnerConfigurationSchema.parse(request.runner_configuration);
      const knowledge = C.CorpusSnapshotSchema.parse(request.corpus_knowledge ?? { schema_version: 1, revision: 0, updates: [] });
      if (!knowledge.materialized && knowledge.updates.length) {
        const evidence = new C.EvidenceStore();
        for (const selected of request.selected_evidence) {
          const bytes = typeof selected.bytes === 'string' ? selected.bytes : Buffer.from(selected.bytes).toString();
          for (const entry of bytes.trimStart().startsWith('---') ? [C.parseEvidenceMarkdown(bytes)] : C.parseEvidenceLedger(bytes)) evidence.add(entry);
        }
        const resolved = C.applyCorpusSnapshot(evidence, { ...knowledge, updates: knowledge.updates.filter(u => u.change.kind !== 'evidence_amendment') }, { fingerprint: sourceFingerprint });
        knowledge.materialized = { support: C.applicableSkillSupport(resolved.support, { job_id: job.id, employer: job.employer_id ?? undefined, role: job.role ?? undefined }), sources: [] };
      }
      const snapshot = {
        schema_version: 1 as const, id, workspace_id: job.workspace_id, job_id: job.id, created_at: this.now(),
        corpus_knowledge: add('corpus-knowledge.json', canonical(knowledge)),
        posting: { id: posting.id, fingerprint: posting.content_fingerprint }, base_resume: add('base-resume.yaml', request.base_resume),
        selected_evidence: request.selected_evidence.map((e, i) => add(`evidence-${i}.txt`, e.bytes)),
        privacy_rules: add('privacy-rules.json', canonical(request.privacy_rules)), template: add('template.json', canonical(C.LatexTemplateProfileSchema.parse(request.template))),
        runner_configuration: add('runner-configuration.json', canonical(runner)), policy, policy_fingerprint: fingerprint(canonical(policy)),
      };
      const manifest = inputManifest.parse({ schema_version: 1, snapshot, job_scope: { company: job.company, role: job.role, employer_id: job.employer_id }, posting_file: add('posting.txt', posting.text), policy_file: add('policy.json', canonical(policy)), evidence_sources: request.selected_evidence.map(e => e.source_id) });
      const bytes = canonical(manifest); bundle['manifest.json'] = bytes;
      const input = C.InputSnapshotSchema.parse({ ...snapshot, fingerprint: fingerprint(bytes) });
      files.writeBundle('snapshots', job.id, id, bundle);
      return r.saveInputSnapshot(input);
    });
  }
  getInputSnapshot(id: string): C.InputSnapshot {
    const input = this.repository.getInputSnapshot(id);
    return this.corrupt(() => {
      const files = this.repository.database.files;
      const read = (ref: C.ImmutableReference) => files.readSnapshot(ref, input.job_id, input.id);
      const manifest = inputManifest.parse(JSON.parse(read({ id: `${files.bundlePath('snapshots', input.job_id, input.id)}/manifest.json`, fingerprint: input.fingerprint }).toString()));
      const { fingerprint: hash, ...metadata } = input;
      if (canonical(metadata) !== canonical(manifest.snapshot) || manifest.evidence_sources.length !== input.selected_evidence.length) throw new Error('Snapshot binding mismatch');
      const posting = this.repository.getPostingSnapshot(input.posting.id);
      if (posting.job_id !== input.job_id || fingerprint(read(manifest.posting_file)) !== input.posting.fingerprint || posting.content_fingerprint !== input.posting.fingerprint) throw new Error('Posting mismatch');
      if (read(manifest.policy_file).toString() !== canonical(input.policy) || fingerprint(canonical(input.policy)) !== input.policy_fingerprint) throw new Error('Policy mismatch');
      for (const ref of [input.base_resume, ...input.selected_evidence, input.privacy_rules, input.template, input.runner_configuration, ...(input.corpus_knowledge ? [input.corpus_knowledge] : [])]) read(ref);
      return input;
    });
  }
  capturedContext(id: string) {
    const input = this.getInputSnapshot(id);
    return this.corrupt(() => {
      const read = (ref: C.ImmutableReference) => this.repository.database.files.readSnapshot(ref, input.job_id, input.id).toString();
      const evidence = new C.EvidenceStore();
      for (const ref of input.selected_evidence) {
        const bytes = read(ref);
        for (const entry of bytes.trimStart().startsWith('---') ? [C.parseEvidenceMarkdown(bytes)] : C.parseEvidenceLedger(bytes)) evidence.add(entry);
      }
      const knowledge = C.CorpusSnapshotSchema.parse(input.corpus_knowledge ? JSON.parse(read(input.corpus_knowledge)) : { schema_version: 1, revision: 0, updates: [] });
      // Materialized evidence already contains amendments. Never apply them a second time.
      const skillSupport = (knowledge.materialized?.support ?? []).filter(s => s.sources.every(binding => {
        const record = evidence.get(binding.evidence_id);
        return record && sourceFingerprint(record) === binding.evidence_fingerprint && record.confidence !== 'retracted' && [record.title, record.summary, record.impact, record.narrative].some(t => t.includes(binding.quote))
          && (!binding.source_status || (binding.source_status.confidence === record.confidence && binding.source_status.in_flight === record.in_flight));
      }));
      const manifest = inputManifest.parse(JSON.parse(read({ id: `${this.repository.database.files.bundlePath('snapshots', input.job_id, input.id)}/manifest.json`, fingerprint: input.fingerprint })));
      return { input, job_scope: manifest.job_scope, base_resume: C.ResumeSpecSchema.parse(yaml.load(read(input.base_resume))), evidence, knowledge, skillSupport };
    });
  }
  publishCandidate(request: { draft_id: string; expected_draft_revision: number; fence: OwnershipFence; source: Bytes; pdf?: Bytes; previews?: Bytes[]; validation_report?: Bytes; validation_result: C.ArtifactVersion['validation_result'] }): C.ArtifactVersion {
    return this.tx(() => {
      const r = this.repository; const draft = r.getLatestDraft(request.draft_id);
      if (draft.revision !== request.expected_draft_revision) throw new RepositoryError('revision_conflict', 'Stale draft revision');
      const input = this.getInputSnapshot(draft.input_snapshot_id);
      if (!r.isAttemptCurrent(request.fence)) throw new RepositoryError('invalid_ownership', 'Attempt is no longer current');
      const attempt = r.getAttempt(request.fence.attempt_id);
      if (attempt.job_id !== draft.job_id || attempt.input_snapshot_id !== input.id) throw new RepositoryError('invalid_relationship', 'Attempt input mismatch');
      const id = this.uuid(); const files = r.database.files; const parent = files.bundlePath('artifacts', draft.job_id, id);
      const bundle: Record<string, Bytes> = {};
      const add = (name: string, bytes: Bytes): C.ImmutableReference => { bundle[name] = bytes; return { id: `${parent}/${name}`, fingerprint: fingerprint(bytes) }; };
      const previews = (request.previews ?? []).map((bytes, i) => add(`preview-${i}.png`, bytes));
      const artifact = { schema_version: 1 as const, id, workspace_id: draft.workspace_id, job_id: draft.job_id, attempt_id: attempt.id, input_snapshot_id: input.id, input_fingerprint: input.fingerprint, parent_version_id: draft.parent_artifact_version_id, created_at: this.now(), source: add('source.tex', request.source), pdf: request.pdf === undefined ? null : add('resume.pdf', request.pdf), preview: previews[0] ?? null, validation_report: request.validation_report === undefined ? null : add('validation.json', request.validation_report), validation_result: request.validation_result };
      const bytes = canonical(artifactManifest.parse({ schema_version: 1, artifact, draft_id: draft.id, draft_revision: draft.revision, previews }));
      bundle['manifest.json'] = bytes;
      const result = C.ArtifactVersionSchema.parse({ ...artifact, version_fingerprint: fingerprint(bytes) });
      files.writeBundle('artifacts', draft.job_id, id, bundle);
      return r.publishArtifact(result, request.fence, { id: draft.id, revision: draft.revision });
    });
  }
  private verifiedArtifact(id: string) {
    return this.corrupt(() => {
      const artifact = this.repository.getArtifact(id); const files = this.repository.database.files;
      const read = (ref: C.ImmutableReference) => files.readArtifact(ref, artifact.job_id, id);
      const manifest = artifactManifest.parse(JSON.parse(read({ id: `${files.bundlePath('artifacts', artifact.job_id, id)}/manifest.json`, fingerprint: artifact.version_fingerprint }).toString()));
      const { version_fingerprint, ...metadata } = artifact;
      if (canonical(metadata) !== canonical(manifest.artifact) || canonical(artifact.preview) !== canonical(manifest.previews[0] ?? null)) throw new Error('Artifact binding mismatch');
      for (const ref of manifest.previews) read(ref);
      const input = this.getInputSnapshot(artifact.input_snapshot_id); const draft = this.repository.getDraftRevision(manifest.draft_id, manifest.draft_revision);
      if (input.fingerprint !== artifact.input_fingerprint || input.job_id !== artifact.job_id || draft.job_id !== artifact.job_id || draft.input_snapshot_id !== input.id || draft.parent_artifact_version_id !== artifact.parent_version_id) throw new Error('Draft binding mismatch');
      return { artifact, manifest };
    });
  }
  /** The review an attempt continued from, or the initial review it generated; its corrections define the effective base. */
  private attemptReview(attemptId: string | null) {
    const db = this.repository.database.db;
    const row = attemptId ? (db.prepare('SELECT r.payload FROM attempt_proposal_reviews a JOIN proposal_review_revisions r ON r.id=a.review_id AND r.revision=a.revision WHERE a.attempt_id=?').get(attemptId)
      ?? db.prepare('SELECT r.payload FROM proposal_generations g JOIN proposal_review_revisions r ON r.generation_id=g.id AND r.revision=0 WHERE g.attempt_id=?').get(attemptId)) as { payload: string } | undefined : undefined;
    return row ? C.ProposalReviewRevisionSchema.parse(JSON.parse(row.payload)) : null;
  }
  preparationContext(attemptId: string | null) {
    return this.corrupt(() => {
      if (!attemptId) return { analysis: null, alignment: null, brief_markdown: null };
      const r = this.repository; const attempt = r.getAttempt(attemptId);
      if (r.getExecutionInput(attempt.input_snapshot_id).schema_version !== 1) return { analysis: null, alignment: null, brief_markdown: null };
      const input = this.getInputSnapshot(attempt.input_snapshot_id);
      const read = <T>(stage: C.PreparationStage, schema: z.ZodType<T, z.ZodTypeDef, unknown>): T | null => {
        const cp = r.listCheckpoints(attemptId).find(c => c.completed_stage === stage);
        if (!cp) return null;
        if (cp.job_id !== attempt.job_id || cp.input_fingerprint !== input.fingerprint || cp.output_references.length !== 1) throw new Error('Checkpoint binding mismatch');
        const bytes = r.database.files.readArtifact(cp.output_references[0]!, attempt.job_id);
        if (fingerprint(bytes) !== cp.output_fingerprint) throw new Error('Checkpoint hash mismatch');
        return z.object({ schema_version: z.literal(1), stage: z.literal(stage), input_fingerprint: z.literal(input.fingerprint), data: schema }).parse(JSON.parse(bytes.toString())).data as T;
      };
      const analysis = read('analysis', C.JobAnalysisSchema);
      const alignment = read('alignment', C.AlignmentMatrixSchema);
      const brief = read('brief', C.DefensibilityBriefSchema);
      return { captured: this.capturedContext(input.id), analysis, alignment, brief_markdown: brief && analysis && alignment ? C.renderBriefMarkdown(brief, analysis, alignment) : null };
    });
  }
  review(jobId: string, id: string) {
    const { artifact, manifest } = this.verifiedArtifact(id);
    if (artifact.job_id !== jobId) throw new RepositoryError('invalid_relationship', 'Artifact belongs to another job');
    return this.corrupt(() => {
      const r = this.repository; const files = r.database.files;
      const input = this.getInputSnapshot(artifact.input_snapshot_id);
      files.readArtifact(artifact.source, jobId, id);
      if (artifact.pdf) files.readArtifact(artifact.pdf, jobId, id);
      const working = r.database.db.prepare('SELECT id FROM draft_revisions WHERE job_id=? AND parent_artifact_version_id=? ORDER BY rowid DESC LIMIT 1').get(jobId, id) as { id: string } | undefined;
      return { artifact, working_draft: working ? r.getLatestDraft(working.id) : null, draft: r.getDraftRevision(manifest.draft_id, manifest.draft_revision),
        base_resume: C.effectiveBaseResume(C.ResumeSpecSchema.parse(yaml.load(files.readSnapshot(input.base_resume, jobId, input.id).toString())), this.attemptReview(artifact.attempt_id) ?? {}),
        ...this.preparationContext(artifact.attempt_id),
        validation_report: artifact.validation_report ? JSON.parse(files.readArtifact(artifact.validation_report, jobId, id).toString()) : null,
        preview_count: manifest.previews.length };
    });
  }
  content(jobId: string, id: string, page?: number) {
    const { artifact, manifest } = this.verifiedArtifact(id);
    if (artifact.job_id !== jobId) throw new RepositoryError('invalid_relationship', 'Artifact belongs to another job');
    const ref = page === undefined ? artifact.pdf : manifest.previews[page - 1];
    if (!ref) throw new RepositoryError('not_found', 'Artifact content unavailable');
    return this.corrupt(() => this.repository.database.files.readArtifact(ref, jobId, id));
  }
  getArtifact(id: string): C.ArtifactVersion { return this.verifiedArtifact(id).artifact; }
  approveResume(request: Parameters<JobsRepository['approveResume']>[0]): C.ResumeReview {
    return this.tx(() => { this.getArtifact(request.artifact_version_id); return this.repository.approveResume(request); });
  }
  continueEditing(request: Omit<Parameters<JobsRepository['forkDraft']>[0], 'draft_id' | 'draft_revision'>): C.JobDraft {
    return this.tx(() => {
      const { manifest } = this.verifiedArtifact(request.artifact_version_id);
      return this.repository.forkDraft({ ...request, draft_id: manifest.draft_id, draft_revision: manifest.draft_revision });
    });
  }
}
