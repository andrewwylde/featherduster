import * as fs from 'node:fs';
import * as path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import {
  canonicalJson, DraftRecordSchema, DraftUpdateSchema, DraftAcknowledgementSchema, DraftRevisionTokenSchema,
  type DraftRecord, type DraftEnvelope, type DraftAcknowledgement, type DraftUpdate, type RevisionToken,
} from '@featherduster/core';

import { DraftRepositoryError } from './errors.js';
import { withDraftFileLock } from './locks.js';
export { DraftRepositoryError } from './errors.js';
interface Receipt { mutationId: string; request: string; acknowledgement: DraftAcknowledgement }
/** On-disk v1 envelope: { storageVersion: 1, record: DraftRecord, receipts: Receipt[] }.
 * Tokens are recomputed from the validated record, never trusted from disk.
 * The last 32 receipts include original acknowledgements. Older retries conflict on
 * their expired revision (or existing identity for create) and never replay changes.
 */
interface StoredDraft { storageVersion: 1; record: DraftRecord; receipts: Receipt[] }
export interface TrustedDraftTransition {
  expected: RevisionToken;
  mutationId: string;
  /** All deterministic operation inputs, including an operation name. */
  input: unknown;
  contentChanged?: boolean;
}
const hash = (value: unknown) => createHash('sha256').update(canonicalJson(value)).digest('hex');
const envelope = (record: DraftRecord): DraftEnvelope => ({ record, token: { revision: record.revision, fingerprint: hash(record) } });
const fail = (status: number, code: string, detail: string): never => { throw new DraftRepositoryError(status, code, detail); };
const isCode = (error: unknown, code: string) => (error as NodeJS.ErrnoException).code === code;
const validId = (id: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);

export class DraftRepository {
  private readonly directory: string;
  private readonly replace: typeof fs.renameSync;
  private readonly now: () => Date;
  constructor(private readonly workspaceDir: string, options: { replace?: typeof fs.renameSync; now?: () => Date } = {}) {
    this.directory = path.resolve(workspaceDir, 'tailoring-drafts');
    this.replace = options.replace ?? fs.renameSync; this.now = options.now ?? (() => new Date());
  }
  private ensureDirectory(): void {
    fs.mkdirSync(this.workspaceDir, { recursive: true });
    this.rejectSymlink(this.directory);
    fs.mkdirSync(this.directory, { recursive: true });
    this.rejectSymlink(this.directory);
    if (path.dirname(fs.realpathSync(this.directory)) !== fs.realpathSync(this.workspaceDir)) fail(400, 'unsafe_path', 'Draft directory escapes workspace');
  }
  private rejectSymlink(file: string): void {
    try { if (fs.lstatSync(file).isSymbolicLink()) fail(400, 'unsafe_path', 'Draft paths cannot be symlinks'); }
    catch (error) { if (!isCode(error, 'ENOENT')) throw error; }
  }
  private filename(id: string): string {
    if (!validId(id)) fail(400, 'invalid_id', 'Draft id must be a UUID');
    this.ensureDirectory();
    const file = path.resolve(this.directory, `${id.toLowerCase()}.json`);
    if (path.dirname(file) !== this.directory) fail(400, 'unsafe_path', 'Draft path escapes directory');
    this.rejectSymlink(file); return file;
  }
  private load(id: string): StoredDraft {
    const file = this.filename(id);
    let raw: unknown;
    try { raw = JSON.parse(fs.readFileSync(file, 'utf8')); }
    catch (error) {
      if (isCode(error, 'ENOENT')) return fail(404, 'not_found', 'Draft not found');
      return fail(422, 'corrupt_record', `Cannot recover draft: ${String(error)}`);
    }
    const stored = raw as StoredDraft;
    const parsed = DraftRecordSchema.safeParse(stored?.record);
    if (!parsed.success || stored.storageVersion !== 1 || !Array.isArray(stored.receipts) || parsed.data.id.toLowerCase() !== id.toLowerCase()) return fail(422, 'corrupt_record', 'Malformed draft envelope');
    const ids = new Set<string>();
    for (const receipt of stored.receipts) {
      const ack = DraftAcknowledgementSchema.safeParse(receipt?.acknowledgement);
      if (!ack.success || typeof receipt.request !== 'string' || !/^[a-f0-9]{64}$/.test(receipt.request) || receipt.mutationId !== ack.data.mutationId || ack.data.record.id.toLowerCase() !== id.toLowerCase() || ids.has(receipt.mutationId) || canonicalJson(ack.data.token) !== canonicalJson(envelope(ack.data.record).token)) fail(422, 'corrupt_record', 'Malformed draft mutation receipt');
      ids.add(receipt.mutationId);
      receipt.acknowledgement = ack.data!;
    }
    return { storageVersion: 1, record: parsed.data, receipts: stored.receipts };
  }
  read(id: string): DraftEnvelope { return envelope(this.load(id).record); }
  list(): { records: DraftEnvelope[]; recoveryErrors: { id: string; message: string }[] } {
    this.ensureDirectory();
    const records: DraftEnvelope[] = []; const recoveryErrors: { id: string; message: string }[] = [];
    for (const name of fs.readdirSync(this.directory).sort()) {
      if (!name.endsWith('.json')) continue;
      const id = name.slice(0, -5);
      try { const result = this.read(id); if (result.record.lifecycle !== 'discarded') records.push(result); }
      catch (error) { recoveryErrors.push({ id, message: String(error) }); }
    }
    return { records, recoveryErrors };
  }
  private locked<T>(id: string, action: () => T): T {
    return withDraftFileLock(this.filename(id), action);
  }
  /** Cooperating run writers use the same draft-before-artifact lock order as journals. */
  withRunMutation<T>(id: string, action: () => T): T {
    return this.locked(id, () => {
      const stored = this.load(id);
      if (stored.record.lifecycle !== 'draft') fail(409, 'inactive_draft', 'Completed or discarded drafts cannot be changed');
      this.pending(id);
      return action();
    });
  }
  private pending(id: string, allowed?: string): void {
    const root = path.join(this.directory, 'operations');
    this.rejectSymlink(root);
    const canonicalId = id.toLowerCase();
    const directory = path.join(root, canonicalId);
    this.rejectSymlink(directory);
    if (!fs.existsSync(directory)) return;
    for (const name of fs
      .readdirSync(directory)
      .filter((name) => name.endsWith('.json'))) {
      const file = path.join(directory, name);
      this.rejectSymlink(file);
      let intent: {
        operation?: { draftId?: string; operationId?: string };
        phase?: string;
      };
      try {
        intent = JSON.parse(fs.readFileSync(file, 'utf8'));
      } catch {
        return fail(
          409,
          'pending_operation',
          'Unreadable operation intent requires recovery',
        );
      }
      if (
        !intent?.operation ||
        typeof intent.operation.draftId !== 'string' ||
        typeof intent.operation.operationId !== 'string' ||
        intent.operation.draftId.toLowerCase() !== canonicalId ||
        name !== `${intent.operation.operationId}.json` ||
        !['prepared', 'written', 'committed'].includes(intent.phase ?? '')
      )
        return fail(
          409,
          'pending_operation',
          'Malformed operation intent requires recovery',
        );
      if (
        intent.operation.draftId.toLowerCase() === canonicalId &&
        intent.phase !== 'committed' &&
        intent.operation.operationId !== allowed
      )
        fail(
          409,
          'pending_operation',
          'Draft has an unresolved operation; recover it first',
        );
    }
  }
  /** Internal journal integration. Holds the draft lock around artifact locks,
   * prepare/write, final CAS and receipt publication. The commit closure may only
   * be used synchronously inside perform. Repository owns revision and timestamps.
   */
  trustedOperation<T>(
    options: {
      draftId: string;
      operationId: string;
      expected: RevisionToken | null;
      next: DraftRecord;
      input: unknown;
      contentChanged?: boolean;
    },
    perform: (
      commit: () => DraftAcknowledgement,
      prior?: DraftAcknowledgement,
    ) => T,
  ): T {
    const next = DraftRecordSchema.parse(options.next);
    if (next.id !== options.draftId)
      return fail(400, 'invalid_record', 'Operation draft identity differs');
    if (options.expected !== null)
      DraftRevisionTokenSchema.parse(options.expected);
    this.mutationId(options.operationId);
    const request = hash({ operation: 'journal', input: options.input });
    return this.locked(options.draftId, () => {
      this.pending(options.draftId, options.operationId);
      const exists = fs.existsSync(this.filename(options.draftId));
      const stored = exists ? this.load(options.draftId) : undefined;
      const prior = stored
        ? this.retry(stored, options.operationId, request)
        : undefined;
      if (!prior) {
        if (options.expected === null) {
          if (stored)
            return fail(409, 'already_exists', 'Draft already exists');
          if (next.lifecycle !== 'draft' || next.completion)
            return fail(
              400,
              'invalid_record',
              'Create requires a draft without completion',
            );
        } else {
          if (!stored) return fail(404, 'not_found', 'Draft not found');
          this.check(stored.record, options.expected);
          if (stored.record.lifecycle !== 'draft')
            return fail(
              409,
              'inactive_draft',
              'Completed or discarded drafts cannot be changed',
            );
        }
      }
      let acknowledgement = prior;
      return perform(() => {
        if (acknowledgement) return acknowledgement;
        const timestamp = this.now().toISOString();
        const record = DraftRecordSchema.parse({
          ...next,
          revision: stored ? stored.record.revision + 1 : 1,
          createdAt: stored?.record.createdAt ?? timestamp,
          editedAt:
            stored && !options.contentChanged
              ? stored.record.editedAt
              : timestamp,
          savedAt: timestamp,
        });
        acknowledgement = {
          ...envelope(record),
          mutationId: options.operationId,
        };
        this.persist(
          options.draftId,
          {
            storageVersion: 1,
            record,
            receipts: [
              ...(stored?.receipts ?? []),
              { mutationId: options.operationId, request, acknowledgement },
            ].slice(-32),
          },
          stored?.record,
        );
        return acknowledgement;
      }, prior);
    });
  }
  private retry(stored: StoredDraft, mutationId: string, request: string): DraftAcknowledgement | undefined {
    const receipt = stored.receipts.find((item) => item.mutationId === mutationId);
    if (receipt && receipt.request !== request) fail(409, 'mutation_conflict', 'Mutation id was already used for a different request');
    return receipt?.acknowledgement;
  }
  private mutationId(id: string): void { if (typeof id !== 'string' || !id.length || id.length > 512) fail(400, 'invalid_mutation', 'Invalid mutation id'); }
  private check(record: DraftRecord, expected: RevisionToken): void {
    const token = envelope(record).token;
    if (token.revision !== expected.revision || token.fingerprint !== expected.fingerprint) fail(409, 'revision_conflict', 'Draft revision conflict');
  }
  private persist(id: string, stored: StoredDraft, previous: DraftRecord | undefined): void {
    const file = this.filename(id); const temp = file + '.' + randomUUID() + '.tmp';
    try {
      const fd = fs.openSync(temp, 'wx', 0o600);
      try { fs.writeFileSync(fd, JSON.stringify(stored)); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
      // Detect noncooperating edits as late as possible. This is not filesystem CAS:
      // an external writer can still race the check and rename.
      this.filename(id);
      if (previous) this.check(this.load(id).record, envelope(previous).token);
      else if (fs.existsSync(file)) fail(409, 'revision_conflict', 'Draft creation conflict');
      this.replace(temp, file);
    } finally { if (fs.existsSync(temp)) fs.unlinkSync(temp); }
  }
  create(record: DraftRecord, mutationId: string): DraftAcknowledgement {
    const parsed = DraftRecordSchema.safeParse(record);
    if (!parsed.success || parsed.data.lifecycle !== 'draft' || parsed.data.completion !== undefined) return fail(400, 'invalid_record', 'Create requires a valid draft record without completion');
    return this.createFromSeed(record.id, mutationId, parsed.data, () => parsed.data);
  }
  /** Server-only lazy create: receipt identity is the validated client seed, while
   * snapshots are captured only after checking receipts under the draft lock. */
  createFromSeed(id: string, mutationId: string, seed: unknown, build: () => DraftRecord): DraftAcknowledgement {
    this.mutationId(mutationId);
    const request = hash({ operation: 'create', record: seed });
    return this.locked(id, () => {
      this.pending(id);
      if (fs.existsSync(this.filename(id))) {
        const stored = this.load(id); const retry = this.retry(stored, mutationId, request);
        if (retry) return retry;
        return fail(409, 'already_exists', 'Draft already exists');
      }
      const parsed = DraftRecordSchema.safeParse(build());
      if (!parsed.success || parsed.data.id !== id || parsed.data.lifecycle !== 'draft' || parsed.data.completion !== undefined) return fail(400, 'invalid_record', 'Create requires a valid draft record without completion');
      const timestamp = this.now().toISOString();
      const created = { ...parsed.data, revision: 1, createdAt: timestamp, editedAt: timestamp, savedAt: timestamp } as DraftRecord;
      const acknowledgement = { ...envelope(created), mutationId };
      this.persist(id, { storageVersion: 1, record: created, receipts: [{ mutationId, request, acknowledgement }] }, undefined);
      return acknowledgement;
    });
  }
  update(id: string, update: DraftUpdate): DraftAcknowledgement {
    const parsed = DraftUpdateSchema.safeParse(update);
    if (!parsed.success) return fail(400, 'invalid_update', 'Invalid draft update');
    return this.mutate(id, update.expected, update.mutationId, { operation: 'update', update: parsed.data }, (record) => {
      const next = { ...record, payload: update.change === 'content' ? update.payload : record.payload, context: update.context ?? record.context };
      if (update.change === 'content') next.editedAt = this.now().toISOString();
      const validated = DraftRecordSchema.safeParse(next);
      if (!validated.success) return fail(400, 'invalid_payload', 'Payload does not match draft kind');
      return validated.data;
    });
  }
  discard(id: string, expected: RevisionToken, operationId: string): DraftEnvelope {
    const { mutationId: _, ...result } = this.mutate(id, expected, operationId, { operation: 'discard', expected }, (record) => ({ ...record, lifecycle: 'discarded' }));
    return result;
  }
  /** Server-only workflow transition. Never expose the callback or its result as a
   * generic HTTP write. Runs once under the record lock after receipt/CAS checks;
   * completed and discarded records remain immutable. External side effects need
   * their own operation journal: the callback and a filesystem rename are not one transaction.
   */
  trustedTransition(id: string, options: TrustedDraftTransition, change: (record: DraftRecord) => DraftRecord): DraftAcknowledgement {
    return this.mutate(id, options.expected, options.mutationId, { operation: 'trustedTransition', ...options }, (record) => {
      const next = change(structuredClone(record));
      return { ...next, id: record.id, createdAt: record.createdAt, editedAt: options.contentChanged ? this.now().toISOString() : record.editedAt };
    });
  }
  private mutate(id: string, expected: RevisionToken, mutationId: string, input: unknown, change: (record: DraftRecord) => DraftRecord): DraftAcknowledgement {
    const parsedExpected = DraftRevisionTokenSchema.safeParse(expected);
    if (!parsedExpected.success) return fail(400, 'invalid_revision_token', 'Invalid draft revision token');
    this.mutationId(mutationId); const request = hash(input);
    return this.locked(id, () => {
      this.pending(id);
      const stored = this.load(id); const retry = this.retry(stored, mutationId, request); if (retry) return retry;
      if (stored.record.lifecycle === 'discarded') return fail(410, 'discarded', 'Draft was discarded');
      this.check(stored.record, parsedExpected.data);
      if (stored.record.lifecycle !== 'draft') return fail(409, 'inactive_draft', 'Completed or discarded drafts cannot be changed');
      const next = change(structuredClone(stored.record));
      const record = DraftRecordSchema.parse({ ...next, revision: stored.record.revision + 1, savedAt: this.now().toISOString() });
      const acknowledgement = { ...envelope(record), mutationId };
      this.persist(id, { storageVersion: 1, record, receipts: [...stored.receipts, { mutationId, request, acknowledgement }].slice(-32) }, stored.record);
      return acknowledgement;
    });
  }
}
