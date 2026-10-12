import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import Database from 'better-sqlite3';
import * as C from '@featherduster/core';
import { JobsRepository } from './repository.js';
import { fingerprint } from './files.js';

export interface PrototypeImportRequest { source_path: string; format: 'sqlite' | 'json'; source_namespace: string }
type History = Extract<C.JobEvent['payload'], { kind: 'import_history' }>;
export interface PrototypeImportItem {
  index: number; original: unknown; original_id: string | null; job: C.Job | null; history: History | null;
  duplicate_id: string | null; warnings: string[]; error: string | null; key: string | null;
}
export interface PrototypeImportPreview {
  workspace_id: string; source_namespace: string; items: PrototypeImportItem[]; errors: string[];
  counts: { valid: number; errors: number; duplicates: number };
}
export interface PrototypeImportResult { index: number; disposition: 'imported' | 'duplicate' | 'error'; job_id: string | null; job: C.Job | null; replayed: boolean; error: string | null }
const previews = new WeakMap<PrototypeImportPreview, { repository: JobsRepository; snapshot: string }>();
const stable = (value: unknown): string => JSON.stringify(value, (_, v) => v && typeof v === 'object' && !Array.isArray(v) ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => a.localeCompare(b))) : v);
const message = (error: unknown): string => error instanceof Error ? error.message : String(error);
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Expected a job/event object');
  return value as Record<string, unknown>;
}
function sourceId(value: unknown): string {
  if (typeof value === 'string' && value.trim()) return value;
  if (typeof value === 'number' && Number.isSafeInteger(value)) return String(value);
  throw new Error('Source id must be a nonempty string or safe integer');
}
function nullable(row: Record<string, unknown>, key: string): string | null {
  const v = row[key]; if (v == null) return null;
  if (typeof v !== 'string') throw new Error(`${key} must be a string or null`);
  return v;
}
function events(value: unknown, sqlite: boolean): unknown[] {
  if (value == null) return [];
  if (sqlite && typeof value === 'string') value = JSON.parse(value);
  if (!Array.isArray(value)) throw new Error('events must be an array');
  return value;
}
// Compatibility boundary: JSON arrays or {jobs, events}; SQLite jobs OR applications,
// with optional events linked by job_id. Paths and event contents are inert archive data.
function readSource(request: PrototypeImportRequest): { jobs: unknown[]; events: unknown[] } {
  if (request.format === 'json') {
    const value: unknown = JSON.parse(readFileSync(request.source_path, 'utf8'));
    if (Array.isArray(value)) return { jobs: value, events: [] };
    const doc = object(value);
    if (!Array.isArray(doc.jobs)) throw new Error('JSON export requires a jobs array');
    return { jobs: doc.jobs, events: events(doc.events, false) };
  }
  if (request.format !== 'sqlite') throw new Error('Unsupported prototype format');
  const db = new Database(request.source_path, { readonly: true, fileMustExist: true });
  try {
    return db.transaction(() => {
      const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as { name: string }[];
      const names = new Set(tables.map(t => t.name));
      if (names.has('jobs') === names.has('applications')) throw new Error('SQLite export requires exactly one jobs or applications table');
      return { jobs: db.prepare(`SELECT * FROM ${names.has('jobs') ? 'jobs' : 'applications'}`).all(), events: names.has('events') ? db.prepare('SELECT * FROM events').all() : [] };
    })();
  } finally { db.close(); }
}

export function previewPrototypeImport(repository: JobsRepository, request: PrototypeImportRequest): PrototypeImportPreview {
  if (!request.source_namespace.trim()) throw new Error('A stable source_namespace is required');
  const preview: PrototypeImportPreview = { workspace_id: repository.database.workspaceId, source_namespace: request.source_namespace, items: [], errors: [], counts: { valid: 0, errors: 0, duplicates: 0 } };
  try {
    const source = readSource(request);
    const ids = new Map<string, unknown[]>();
    for (const value of source.jobs) {
      try { const id = sourceId(object(value).id); ids.set(id, [...(ids.get(id) ?? []), value]); } catch { /* Report on the indexed row below. */ }
    }
    const external = new Map<string, unknown[]>();
    for (const value of source.events) {
      try {
        const id = sourceId(object(value).job_id);
        if (!ids.has(id)) throw new Error(`Orphan event for source job ${id}`);
        external.set(id, [...(external.get(id) ?? []), value]);
      } catch (error) { preview.errors.push(message(error)); }
    }
    const targets = new Map<string, string>();
    source.jobs.forEach((original, index) => {
      const item: PrototypeImportItem = { index, original, original_id: null, job: null, history: null, duplicate_id: null, warnings: [], error: null, key: null };
      preview.items.push(item);
      try {
        const row = object(original); const id = sourceId(row.id); item.original_id = id;
        if (ids.get(id)!.some(other => stable(other) !== stable(original))) throw new Error(`Conflicting repeated source id ${id}`);
        const tuple = JSON.stringify([request.source_namespace, id]); item.key = fingerprint(tuple);
        const archived = [...events(row.events, request.format === 'sqlite'), ...(external.get(id) ?? [])];
        const status = nullable(row, 'status');
        item.history = { kind: 'import_history', source_namespace: request.source_namespace, original_id: id, original_status: status, resume_path: nullable(row, 'resume_path'), tex_path: nullable(row, 'tex_path'), notes: nullable(row, 'notes'), events_json: `[${[...new Set(archived.map(stable))].join(',')}]` };
        const url = (key: string): { original: string; canonical: string } | null => {
          if (row[key] == null) return null;
          try { const original = nullable(row, key)!; return { original: original.trim(), canonical: C.canonicalizeJobUrl(original) }; }
          catch { item.warnings.push(`Invalid ${key}: ${String(row[key])}`); return null; }
        };
        const originalUrl = url('url'); const canonicalUrl = url('canonical_url'); const time = new Date().toISOString();
        item.job = C.JobSchema.parse({ schema_version: 1, id: randomUUID(), workspace_id: preview.workspace_id, revision: 0, kind: 'job', original_url: originalUrl?.original ?? null, canonical_url: canonicalUrl?.canonical ?? originalUrl?.canonical ?? null, employer_id: null, external_job_id: tuple, company: nullable(row, 'company')?.trim() || null, role: nullable(row, 'role')?.trim() || null, parent_discovery_id: null, posting_snapshot_id: null, preparation_state: 'skipped', application_lifecycle: ['submitted', 'applied'].includes(status?.trim().toLowerCase() ?? '') ? 'submitted' : 'unknown', preparation_stage: null, base_resume_id: null, template_id: null, runner: null, policy_fingerprint: null, current_attempt_id: null, artifact_version_ids: [], missing_inputs: [], confirmation_provenance: [], state_reason: 'Imported prior history; explicit preparation override required', created_at: time, updated_at: time });
        const receipt = repository.database.db.prepare("SELECT result FROM mutation_receipts WHERE workspace_id=? AND operation='create' AND idempotency_key=?").get(preview.workspace_id, `prototype:create:${item.key}`) as { result: string } | undefined;
        const urls = [item.job.canonical_url, item.job.original_url].filter((u): u is string => u !== null);
        const matches = new Set(urls.map(u => repository.findByAlias(u)?.id ?? targets.get(u)).filter((v): v is string => !!v));
        if (receipt) matches.add((JSON.parse(receipt.result) as C.Job).id);
        if (targets.has(tuple)) matches.add(targets.get(tuple)!);
        if (matches.size > 1) throw new Error('Aliases belong to different jobs');
        item.duplicate_id = [...matches][0] ?? null;
        for (const key of [...urls, tuple]) targets.set(key, item.duplicate_id ?? item.job.id);
      } catch (error) { item.error = message(error); item.job = null; item.history = null; }
    });
  } catch (error) { preview.errors.push(`Unable to read prototype source: ${message(error)}`); }
  preview.counts = { valid: preview.items.filter(i => !i.error).length, errors: preview.errors.length + preview.items.filter(i => i.error).length, duplicates: preview.items.filter(i => !i.error && i.duplicate_id).length };
  previews.set(preview, { repository, snapshot: JSON.stringify(preview) }); return preview;
}

export function commitPrototypeImport(repository: JobsRepository, preview: PrototypeImportPreview): PrototypeImportResult[] {
  const issued = previews.get(preview);
  if (issued?.repository !== repository || issued.snapshot !== JSON.stringify(preview) || preview.workspace_id !== repository.database.workspaceId) throw new Error('Invalid or modified prototype preview');
  return preview.items.map(item => {
    try {
      if (item.error || !item.job || !item.history) throw new Error(item.error ?? 'Invalid source row');
      return repository.database.db.transaction((): PrototypeImportResult => {
        const saved = repository.createJob(item.job!, `prototype:create:${item.key}`);
        repository.appendEvent({ schema_version: 1, id: randomUUID(), workspace_id: preview.workspace_id, job_id: saved.result.id, created_at: new Date().toISOString(), actor: { kind: 'import', id: 'prototype-importer' }, attempt_id: null, idempotency_key: `prototype:history:${item.key}`, payload: item.history! });
        const job = repository.getJob(saved.result.id);
        return { index: item.index, disposition: saved.replayed || job.id !== item.job!.id ? 'duplicate' : 'imported', job_id: job.id, job, replayed: saved.replayed, error: null };
      }).immediate();
    } catch (error) { return { index: item.index, disposition: 'error', job_id: null, job: null, replayed: false, error: message(error) }; }
  });
}
