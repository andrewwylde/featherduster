import { randomUUID } from 'node:crypto';
import * as C from '@featherduster/core';
import { z } from 'zod';
import { fingerprint } from './files.js';
import { JobsRepository, RepositoryError, type OwnershipFence } from './repository.js';

const canonical = (value: unknown): string => JSON.stringify(value, (_, v) => v && typeof v === 'object' && !Array.isArray(v) ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => a.localeCompare(b))) : v);
type Bytes = string | Uint8Array;
export interface CaptureInputsRequest {
  job_id: string; posting_id: string; base_resume: Bytes;
  selected_evidence: { source_id: string; bytes: Bytes }[];
  privacy_rules: unknown; template: C.LatexTemplateProfile;
  /** Explicit non-secret provider/model settings, never a credentials file. */
  runner_configuration: { runner: string; model: string };
  policy: C.PreparationPolicy;
}
const inputManifest = z.object({
  schema_version: z.literal(1), snapshot: C.InputSnapshotSchema.omit({ fingerprint: true }),
  posting_file: C.ImmutableReferenceSchema, policy_file: C.ImmutableReferenceSchema,
  evidence_sources: z.array(z.string().min(1)),
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
      const runner = z.object({ runner: z.string().min(1), model: z.string().min(1) }).strict().parse(request.runner_configuration);
      const snapshot = {
        schema_version: 1 as const, id, workspace_id: job.workspace_id, job_id: job.id, created_at: this.now(),
        posting: { id: posting.id, fingerprint: posting.content_fingerprint }, base_resume: add('base-resume.yaml', request.base_resume),
        selected_evidence: request.selected_evidence.map((e, i) => add(`evidence-${i}.txt`, e.bytes)),
        privacy_rules: add('privacy-rules.json', canonical(request.privacy_rules)), template: add('template.json', canonical(C.LatexTemplateProfileSchema.parse(request.template))),
        runner_configuration: add('runner-configuration.json', canonical(runner)), policy, policy_fingerprint: fingerprint(canonical(policy)),
      };
      const manifest = inputManifest.parse({ schema_version: 1, snapshot, posting_file: add('posting.txt', posting.text), policy_file: add('policy.json', canonical(policy)), evidence_sources: request.selected_evidence.map(e => e.source_id) });
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
      for (const ref of [input.base_resume, ...input.selected_evidence, input.privacy_rules, input.template, input.runner_configuration]) read(ref);
      return input;
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
