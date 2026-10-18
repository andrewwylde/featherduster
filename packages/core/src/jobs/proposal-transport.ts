import type { ClaimGrounding, ProposalGeneration, ProposalPatch, ProposalReviewRevision } from './proposal-review.js';
import type { Attempt, InputSnapshot, Job } from './schemas.js';
import type { CorpusChange, CorpusSnapshot, CorpusUpdate, FeedbackEvent, SkillSupport, SourceSupport } from '../corpus/schemas.js';
import type { EvidenceRecord } from '../parsers/index-store.js';
import type { ResumeSpec } from '../schemas/resume.js';
import type { AlignmentMatrix, JobAnalysis } from '../tailoring/schemas.js';

export type ClientCorpusChange = Exclude<CorpusChange, { kind: 'skill_support' }> | { kind: 'skill_support'; value: Omit<SkillSupport, 'sources'> & { sources: Omit<SourceSupport, 'source_status'>[] } };
export interface CorpusWriteRequest {
  workspace_id: string; expected_revision: number; idempotency_key: string; explanation: string;
  supersedes?: string | null; change: ClientCorpusChange;
}
export interface CorpusView {
  workspace_id: string; snapshot: CorpusSnapshot; evidence: EvidenceRecord[]; support: SkillSupport[];
  issues: { update_id: string; code: string; message: string }[];
  history: { update: CorpusUpdate; state: string; withdraw_url: string }[];
  records: { source: EvidenceRecord; effective?: EvidenceRecord; fingerprint: string; storage_kind: string }[];
  feedback: { feedback: FeedbackEvent; update_id: string | null }[];
}
export interface ProposalBinding { expected_job_revision: number; expected_review_revision: number; input_fingerprint: string }
export interface ProposalSaveRequest extends ProposalBinding {
  patches: ProposalPatch[];
  removed_grounding_ids?: string[];
  groundings: (Pick<ClaimGrounding, 'proposal_id' | 'claim_fingerprint' | 'term' | 'explanation'> & { sources: Omit<SourceSupport, 'source_status'>[] })[];
  feedback_kind: FeedbackEvent['kind']; explanation: string;
  remember?: { expected_corpus_revision: number; change: ClientCorpusChange; supersedes?: string };
  idempotency_key: string;
}
export interface ProposalBaseCorrectionRequest extends ProposalBinding { review_id: string; path: string; text: string; idempotency_key: string }
export interface ProposalContinueRequest extends ProposalBinding { validation_fingerprint: string; idempotency_key: string }
export interface ProposalRecoverRequest { expected_job_revision: number; input_snapshot_id: string; idempotency_key: string }
export type ProposalReadResponse = { availability: 'missing_output'; recoverable: boolean; input_snapshot_id: string | null; latest_input_snapshot_id: string | null } | {
  availability: 'available'; generation: ProposalGeneration; generations: ProposalGeneration[]; review: ProposalReviewRevision; history: ProposalReviewRevision[];
  latest_input_snapshot_id: string | null; input_stale: boolean; corpus_revision: number;
  captured: { source_fingerprints: Record<string, string>; input: InputSnapshot; base_resume: ResumeSpec; evidence: EvidenceRecord[]; knowledge: CorpusSnapshot; skillSupport: SkillSupport[]; analysis: JobAnalysis; alignment: AlignmentMatrix };
};
export interface MutationReceipt<T> { result: T; replayed: boolean }
export type ProposalSaveResponse = MutationReceipt<{ job: Job; review: ProposalReviewRevision; corpus_revision: number; update?: CorpusUpdate; requires_refresh: boolean }>;
export type ProposalBaseCorrectionResponse = MutationReceipt<{ job: Job; review: ProposalReviewRevision }>;
export type ProposalAdmissionResponse = MutationReceipt<{ admission: 'started'; attempt: Omit<Attempt, 'owner_token'>; previous_attempt_id: string | null }>;
export type ProposalReviewSummary = { availability: 'missing_output'; recoverable: boolean } | { availability: 'available'; review_id: string; revision: number; status: 'ready' | 'blocked'; blocking_count: number; input_stale: boolean };
export interface CorpusPreviewResponse {
  request: CorpusWriteRequest; feedback: FeedbackEvent; update: CorpusUpdate;
  conflicts: { update_id: string; code: string; message: string }[];
  confidence_changes: { evidence_id: string; before: string; after?: string }[];
  records: { source: EvidenceRecord; effective?: EvidenceRecord }[];
}
