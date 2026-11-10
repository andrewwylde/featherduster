import { randomUUID } from 'node:crypto';
import * as C from '@featherduster/core';
import { JobsRepository, RepositoryError } from './repository.js';
import { fingerprint } from './files.js';
import { fetchPosting, MAX_POSTING_BYTES, type PostingFetchResult } from './posting-fetcher.js';
import { fetchPostingInBrowser } from './posting-browser.js';
import { extractPosting, extractPostingMetadata, type Opening } from './posting-extractor.js';

export type IntakeRequest = C.JobIntakeInput & { fallback_job_id?: string; expected_revision?: number; details?: Partial<Pick<C.Job, 'company' | 'role' | 'notes' | 'context_url'>> };
export type CaptureAttempt = C.PostingCaptureAttempt;
type CaptureError = { code: string; message: string; status?: number; url?: string };
function captureError(error: unknown, method: CaptureAttempt['method']): CaptureError {
  const value = error as { code?: unknown; status?: unknown; url?: unknown } | null;
  const code = typeof value?.code === 'string' ? value.code : 'capture_failed';
  const status = typeof value?.status === 'number' ? value.status : undefined;
  const url = typeof value?.url === 'string' ? value.url : undefined;
  const reasons: Record<string, string> = {
    http_error: status === 403 ? `The site refused ${method === 'browser' ? 'browser capture' : 'the direct request'} (HTTP 403).`
      : status === 429 ? 'The site is rate limiting requests (HTTP 429). Try again later.' : `The site returned HTTP ${status ?? 'error'}.`,
    timeout: `${method === 'browser' ? 'Browser capture' : 'The direct request'} timed out.`,
    blocked_destination: 'This link points to a private or restricted network address.',
    invalid_url: 'Use a public HTTPS posting link without credentials or a custom port.',
    dns_error: 'The posting host could not be resolved.',
    redirect_error: 'The posting redirects in a loop or to an unsupported link.',
    too_large: 'The posting exceeds the capture size limit.',
    unsupported_content: 'The site did not return supported HTML.',
    extraction_failed: 'The page did not expose a usable job description, or requires a human check.',
    browser_unavailable: 'Browser capture is unavailable on this computer.',
    browser_busy: 'Browser capture is busy. Try again shortly.',
    network_error: `${method === 'browser' ? 'Browser capture' : 'The direct request'} could not connect.`,
  };
  return { code, message: `${reasons[code] ?? 'The posting could not be captured.'} Paste posting text instead.`, ...(status ? { status } : {}), ...(url ? { url } : {}) };
}
export interface IntakeItem {
  index: number; original: string; valid: boolean; error: CaptureError | null;
  fallback_available: boolean; job: C.Job | null; snapshot: C.PostingSnapshot | null; candidates: Opening[];
  duplicate_id: string | null; fallback?: { job_id: string; revision: number };
  capture_method?: CaptureAttempt['method']; capture_attempts?: CaptureAttempt[];
}
export interface IntakePreview { workspace_id: string; items: IntakeItem[] }
export class PostingIntakeService {
  private readonly previews = new WeakMap<IntakePreview, string>();
  constructor(private readonly repository: JobsRepository, private readonly options: { fetcher?: (url: string) => Promise<PostingFetchResult>; browserFetcher?: (url: string) => Promise<PostingFetchResult>; now?: () => string; uuid?: () => string } = {}) {}
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
        const job: C.Job = { schema_version: 1, id, workspace_id, revision: 0, kind: 'job', original_url: row.mode === 'urls' ? row.original.trim() : null, canonical_url: row.mode === 'urls' ? row.canonical_url : null, employer_id: null, external_job_id: null, company: null, role: null, parent_discovery_id: null, posting_snapshot_id: null, preparation_state: 'saved', application_lifecycle: 'not_started', preparation_stage: null, base_resume_id: null, template_id: null, runner: null, policy_fingerprint: null, current_attempt_id: null, artifact_version_ids: [], missing_inputs: [], confirmation_provenance: [], state_reason: null, created_at: time, updated_at: time };
        if (request.details) Object.assign(job, C.JobSchema.parse({ ...job, ...request.details }));
        item.job = job;
        if (request.fallback_job_id) {
          if (row.mode !== 'text' || request.expected_revision === undefined) throw new Error('Fallback requires text and expected revision');
          const old = this.repository.getJob(id);
          if (old.revision !== request.expected_revision || old.kind !== 'job' || old.preparation_state !== 'needs_input' || !old.missing_inputs.some(q => q.key === 'posting_text')) throw new Error('Fallback target is not eligible or revision is stale');
          item.job = old; item.fallback = { job_id: id, revision: request.expected_revision };
        }
        let text: string; let final_url: string | null = null; let retrieved_at: string | null = null;
        let metadata: C.JobPostingMetadata | undefined = undefined;
        if (row.mode === 'text') {
          text = row.text;
          if (Buffer.byteLength(text) > MAX_POSTING_BYTES) throw new Error('Posting text exceeds 2 MiB');
          try {
            metadata = await extractPostingMetadata(text);
          } catch { /* Unstructured or plain text postings remain usable without structured metadata */ }
        } else {
          try {
            let method: CaptureAttempt['method'] = 'http';
            item.capture_attempts = [];
            const capture = async () => {
              const fetched = await (method === 'http' ? this.options.fetcher ?? fetchPosting : this.options.browserFetcher ?? fetchPostingInBrowser)(row.original.trim());
              return { fetched, extracted: extractPosting(fetched.html, fetched.final_url) };
            };
            let captured: Awaited<ReturnType<typeof capture>>;
            try { captured = await capture(); }
            catch (error) {
              const direct = captureError(error, method);
              item.capture_attempts.push({ method, outcome: 'failed', code: direct.code, status: direct.status, url: direct.url });
              // Never escalate blocked/private destinations or rate limits into a
              // browser retry. Rendering helps refused requests and JS-only HTML.
              if (!(direct.code === 'http_error' && direct.status === 403) && !['extraction_failed', 'unsupported_content'].includes(direct.code)) throw error;
              method = 'browser';
              try { captured = await capture(); }
              catch (browserError) {
                const failure = captureError(browserError, method);
                item.capture_attempts.push({ method, outcome: 'failed', code: failure.code, status: failure.status, url: failure.url });
                throw browserError;
              }
            }
            item.capture_method = method;
            const { fetched, extracted } = captured;
            item.capture_attempts.push({ method, outcome: 'captured', url: fetched.final_url });
            text = extracted.text; final_url = fetched.final_url; retrieved_at = fetched.retrieved_at;
            job.canonical_url = C.canonicalizeJobUrl(final_url); job.kind = extracted.kind; job.company = extracted.company; job.role = extracted.role; job.external_job_id = extracted.external_job_id; item.candidates = extracted.candidates;
            try {
              metadata = await extractPostingMetadata(fetched.html, final_url);
            } catch { /* Structured metadata extraction is best-effort */ }
          } catch (error) {
            const method = item.capture_attempts?.at(-1)?.method ?? 'http';
            item.error = captureError(error, method);
            item.fallback_available = true; job.preparation_state = 'needs_input'; job.state_reason = `${item.error.code}: ${item.error.message}`;
            job.capture_attempts = item.capture_attempts;
            job.missing_inputs = [{ key: 'posting_text', question: 'Paste posting text', scope: { kind: 'job', job_id: id }, reason: job.state_reason }];
            continue;
          }
        }
        if (metadata) {
          metadata.captured_at = time;
          job.posting_metadata = metadata;
          if (item.job) item.job.posting_metadata = metadata;
        }
        if (item.capture_attempts) job.capture_attempts = item.capture_attempts;
        if (job.kind === 'discovery') {
          job.preparation_state = 'needs_input'; job.state_reason = 'Select an opening before preparation';
          job.missing_inputs = [{ key: 'select_opening', question: 'Which opening should be prepared?', scope: { kind: 'job', job_id: id }, reason: job.state_reason }];
        }
        if (request.details) item.job = C.JobSchema.parse({ ...item.job, ...request.details });
        item.snapshot = C.PostingSnapshotSchema.parse({ schema_version: 1, id: uuid(), workspace_id, job_id: id, source_kind: row.mode === 'text' ? 'text' : 'url', original_url: item.job.original_url, final_url, retrieved_at, captured_at: time, text, content_fingerprint: fingerprint(text), ...(metadata ? { posting_metadata: metadata } : {}), ...(item.capture_attempts ? { capture_attempts: item.capture_attempts } : {}) });
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
