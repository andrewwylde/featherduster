import { randomUUID } from 'node:crypto';
import * as C from '@featherduster/core';
import { JobsRepository, RepositoryError } from './repository.js';
import { fingerprint } from './files.js';
import { fetchPosting, MAX_POSTING_BYTES, type PostingFetchResult } from './posting-fetcher.js';
import { extractPosting, type Opening } from './posting-extractor.js';

export type IntakeRequest = C.JobIntakeInput & { fallback_job_id?: string; expected_revision?: number };
export interface IntakeItem {
  index: number; original: string; valid: boolean; error: { code: string; message: string } | null;
  fallback_available: boolean; job: C.Job | null; snapshot: C.PostingSnapshot | null; candidates: Opening[];
  duplicate_id: string | null; fallback?: { job_id: string; revision: number };
}
export interface IntakePreview { workspace_id: string; items: IntakeItem[] }
export class PostingIntakeService {
  private readonly previews = new WeakMap<IntakePreview, string>();
  constructor(private readonly repository: JobsRepository, private readonly options: { fetcher?: (url: string) => Promise<PostingFetchResult>; now?: () => string; uuid?: () => string } = {}) {}
  async preview(request: IntakeRequest): Promise<IntakePreview> {
    const now = this.options.now ?? (() => new Date().toISOString()); const uuid = this.options.uuid ?? randomUUID;
    const workspace_id = this.repository.database.workspaceId;
    const items: IntakeItem[] = [];
    for (const row of C.previewJobIntake(request)) {
      const item: IntakeItem = { index: row.index, original: row.original, valid: row.valid, error: null, fallback_available: false, job: null, snapshot: null, candidates: [], duplicate_id: null };
      items.push(item);
      if (!row.valid) { item.error = { code: 'invalid_input', message: row.error }; continue; }
      try {
        const existing = row.mode === 'urls' ? this.repository.findByAlias(row.canonical_url) ?? this.repository.findByAlias(row.original.trim()) : null;
        if (existing) { item.duplicate_id = existing.id; continue; }
        const id = request.fallback_job_id ?? uuid(); const time = now();
        const job: C.Job = { schema_version: 1, id, workspace_id, revision: 0, kind: 'job', original_url: row.mode === 'urls' ? row.original.trim() : null, canonical_url: row.mode === 'urls' ? row.canonical_url : null, employer_id: null, external_job_id: null, company: null, role: null, parent_discovery_id: null, posting_snapshot_id: null, preparation_state: 'queued', application_lifecycle: 'not_started', preparation_stage: null, base_resume_id: null, template_id: null, runner: null, policy_fingerprint: null, current_attempt_id: null, artifact_version_ids: [], missing_inputs: [], confirmation_provenance: [], state_reason: null, created_at: time, updated_at: time };
        item.job = job;
        if (request.fallback_job_id) {
          if (row.mode !== 'text' || request.expected_revision === undefined) throw new Error('Fallback requires text and expected revision');
          const old = this.repository.getJob(id);
          if (old.revision !== request.expected_revision || old.kind !== 'job' || old.preparation_state !== 'needs_input' || !old.missing_inputs.some(q => q.key === 'posting_text')) throw new Error('Fallback target is not eligible or revision is stale');
          item.job = old; item.fallback = { job_id: id, revision: request.expected_revision };
        }
        let text: string; let final_url: string | null = null; let retrieved_at: string | null = null;
        if (row.mode === 'text') {
          text = row.text;
          if (Buffer.byteLength(text) > MAX_POSTING_BYTES) throw new Error('Posting text exceeds 2 MiB');
        } else {
          try {
            const fetched = await (this.options.fetcher ?? fetchPosting)(row.original.trim());
            const extracted = extractPosting(fetched.html, fetched.final_url);
            text = extracted.text; final_url = fetched.final_url; retrieved_at = fetched.retrieved_at;
            job.canonical_url = C.canonicalizeJobUrl(final_url); job.kind = extracted.kind; job.company = extracted.company; job.role = extracted.role; job.external_job_id = extracted.external_job_id; item.candidates = extracted.candidates;
          } catch (error) {
            item.error = { code: error && typeof error === 'object' && 'code' in error ? String(error.code) : 'capture_failed', message: 'Unable to capture posting. Paste posting text instead.' };
            item.fallback_available = true; job.preparation_state = 'needs_input'; job.state_reason = `${item.error.code}: ${item.error.message}`;
            job.missing_inputs = [{ key: 'posting_text', question: 'Paste posting text', scope: { kind: 'job', job_id: id }, reason: job.state_reason }];
            continue;
          }
        }
        if (job.kind === 'discovery') {
          job.preparation_state = 'needs_input'; job.state_reason = 'Select an opening before preparation';
          job.missing_inputs = [{ key: 'select_opening', question: 'Which opening should be prepared?', scope: { kind: 'job', job_id: id }, reason: job.state_reason }];
        }
        item.snapshot = C.PostingSnapshotSchema.parse({ schema_version: 1, id: uuid(), workspace_id, job_id: id, source_kind: row.mode === 'text' ? 'text' : 'url', original_url: item.job.original_url, final_url, retrieved_at, captured_at: time, text, content_fingerprint: fingerprint(text) });
      } catch { item.valid = false; item.job = null; item.snapshot = null; item.error = { code: 'invalid_input', message: 'Invalid text or fallback target/revision.' }; }
    }
    const preview = { workspace_id, items }; this.previews.set(preview, JSON.stringify(preview)); return preview;
  }
  commit(preview: IntakePreview, idempotencyKey: string) {
    // Only unchanged, locally reviewed previews may cross the persistence boundary.
    if (preview.workspace_id !== this.repository.database.workspaceId || this.previews.get(preview) !== JSON.stringify(preview)) throw new Error('Invalid or modified intake preview');
    return preview.items.map(item => {
      try {
        if (!item.valid) return { ...item, disposition: 'error' as const, job_id: null };
        if (item.duplicate_id) return { ...item, disposition: 'duplicate' as const, job_id: this.repository.getJob(item.duplicate_id).id };
        const saved = this.repository.commitIntakeCapture(item.job!, item.snapshot, `${idempotencyKey}:${item.index}`, { input: item.original.replace(/\r\n?/g, '\n').trim(), error: item.error }, item.fallback);
        return { ...item, ...saved.result, job_id: saved.result.job.id, replayed: saved.replayed };
      } catch (error) { return { ...item, disposition: 'error' as const, job_id: null, error: { code: error instanceof RepositoryError ? error.code : 'commit_failed', message: error instanceof Error ? error.message.slice(0, 300) : 'Commit failed' } }; }
    });
  }
}
