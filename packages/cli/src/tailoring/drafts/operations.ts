import * as fs from 'node:fs';
import * as path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import {
  canonicalJson,
  DraftRecordSchema,
  DraftRevisionTokenSchema,
  DraftAcknowledgementSchema,
  type DraftRecord,
  type RevisionToken,
  type DraftAcknowledgement,
} from '@featherduster/core';
import { DraftRepository, DraftRepositoryError } from './repository.js';
import { withDraftFileLock } from './locks.js';
import { RUN_FILES } from '../store.js';

type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
export interface DraftOperationSource {
  path: string;
  expectedHash: string | null;
}
export interface DraftOperationWrite extends DraftOperationSource {
  content: string;
}
/** Trusted service input, never a generic HTTP write API. All identifiers, output
 * paths and bytes must be decided before execute. expected:null creates next as a
 * new draft (continue/fork); existing source snapshots can be guarded in sources.
 * Otherwise next replaces editable/workflow fields of the existing draft. The
 * repository always owns identity, revision and timestamps. No callbacks persist.
 */
export interface DraftOperation {
  operationId: string;
  draftId: string;
  command: 'create-run' | 'apply' | 'sync' | 'complete' | 'continue' | 'fork';
  expected: RevisionToken | null;
  next: DraftRecord;
  contentChanged?: boolean;
  /** Original caller request, for service retry identity checks before reuse. */
  request?: Json;
  sources?: DraftOperationSource[];
  writes: DraftOperationWrite[];
  result: Json;
}
export interface DraftOperationResult {
  acknowledgement: DraftAcknowledgement;
  result: Json;
}
interface Intent {
  version: 1;
  operation: DraftOperation;
  requestHash: string;
  outputHashes: string[];
  phase: 'prepared' | 'written' | 'committed';
  receipt?: DraftOperationResult;
}
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const digest = (value: string | Buffer) =>
  createHash('sha256').update(value).digest('hex');
const error = (code: string, detail: string): never => {
  throw new DraftRepositoryError(409, code, detail);
};
const isMissing = (e: unknown) =>
  (e as NodeJS.ErrnoException).code === 'ENOENT';
function plain(value: unknown, depth = 0): void {
  if (depth > 64)
    error('invalid_operation', 'Operation JSON is too deeply nested');
  if (value === null || typeof value === 'string' || typeof value === 'boolean')
    return;
  if (typeof value === 'number' && Number.isFinite(value)) return;
  if (Array.isArray(value)) {
    for (const item of value) plain(item, depth + 1);
    return;
  }
  if (
    typeof value === 'object' &&
    value &&
    Object.getPrototypeOf(value) === Object.prototype
  ) {
    for (const item of Object.values(value)) plain(item, depth + 1);
    return;
  }
  error(
    'invalid_operation',
    'Operation must contain only plain finite JSON data',
  );
}
function keys(value: object, allowed: string[]): void {
  if (Object.keys(value).some((key) => !allowed.includes(key)))
    error('invalid_operation', 'Unexpected operation field');
}

export class DraftOperationRunner {
  private readonly root: string;
  constructor(
    workspaceDir: string,
    private readonly repository: DraftRepository,
    private readonly options: { checkpoint?: (point: string) => void } = {},
  ) {
    this.root = path.resolve(workspaceDir);
  }
  private checkpoint(point: string): void {
    this.options.checkpoint?.(point);
  }
  private safe(relative: string): string {
    if (
      typeof relative !== 'string' ||
      relative.includes('\\') ||
      /[\x00-\x1f:]/.test(relative) ||
      relative
        .split('/')
        .some((part) => !part || part === '.' || part === '..') ||
      path.isAbsolute(relative)
    )
      error('unsafe_path', 'Unsafe operation path');
    let cursor = this.root;
    for (const part of ['', ...relative.split('/')]) {
      if (part) cursor = path.join(cursor, part);
      try {
        if (fs.lstatSync(cursor).isSymbolicLink())
          error('unsafe_path', 'Operation path has a symlink ancestor');
      } catch (e) {
        if (!isMissing(e)) throw e;
      }
    }
    return cursor;
  }
  /** Resume imports may be nested and use human filenames, unlike generated outputs. */
  private source(relative: string): string {
    const resume = /^resumes\/(templates|tailored)\/.+\.(yaml|yml|json|md|tex)$/i.test(relative);
    const draft = /^tailoring-drafts\/[0-9a-f-]{36}\.json$/.test(relative);
    if (!resume && !draft) return this.artifact(relative, true);
    if (relative.split('/').some(part => /^(con|prn|aux|nul|com[0-9]|lpt[0-9])(\.|$)/i.test(part))) {
      error('unsafe_path', 'Reserved operation path');
    }
    return this.safe(relative);
  }
  private artifact(relative: string, write: boolean): string {
    if (!write) return this.source(relative);
    const run = /^tailoring\/([a-z0-9][a-z0-9-]{0,79})\/([^/]+)$/.exec(
      relative,
    );
    const resume =
      /^resumes\/(tailored|templates)\/[a-z0-9][a-z0-9-]{0,119}\.(yaml|yml|json)$/.test(
        relative,
      );
    const completion = /^tailoring-drafts\/completions\/[0-9a-f-]{36}\.json$/.test(relative);
    const brief =
      /^resumes\/tailored\/briefs\/[a-z0-9][a-z0-9-]{0,119}\.(md|json)$/.test(
        relative,
      );
    if (
      !(
        run &&
        Object.values(RUN_FILES).includes(
          run[2] as (typeof RUN_FILES)[keyof typeof RUN_FILES],
        )
      ) &&
      !resume &&
      !brief && !completion
    )
      error('unsafe_path', 'Operation path is not an allowed artifact');
    if (
      relative
        .split('/')
        .some((part) =>
          /^(con|prn|aux|nul|com[0-9]|lpt[0-9])(\.|$)/i.test(part),
        )
    )
      error('unsafe_path', 'Reserved operation path');
    return this.safe(relative);
  }
  private validate(input: DraftOperation): DraftOperation {
    plain(input);
    plain(input.result);
    if (JSON.stringify(input).length > 16 * 1024 * 1024)
      error('invalid_operation', 'Operation exceeds size limit');
    keys(input, [
      'operationId',
      'draftId',
      'command',
      'expected',
      'next',
      'contentChanged',
      'sources',
      'writes',
      'result',
      'request',
    ]);
    if (
      typeof input.operationId !== 'string' ||
      typeof input.draftId !== 'string' ||
      !uuid.test(input.operationId) ||
      !uuid.test(input.draftId) ||
      !['create-run', 'apply', 'sync', 'complete', 'continue', 'fork'].includes(
        input.command,
      )
    )
      error('invalid_operation', 'Invalid operation identity or command');
    const next = DraftRecordSchema.parse(input.next);
    if (next.id !== input.draftId)
      error('invalid_operation', 'Operation draft identity differs');
    if (input.expected !== null) DraftRevisionTokenSchema.parse(input.expected);
    if (
      input.contentChanged !== undefined &&
      typeof input.contentChanged !== 'boolean'
    )
      error('invalid_operation', 'Invalid contentChanged');
    if (
      !Array.isArray(input.writes) ||
      input.writes.length > 128 ||
      (input.sources !== undefined &&
        (!Array.isArray(input.sources) || input.sources.length > 128))
    )
      error('invalid_operation', 'Invalid operation file list');
    const seen = new Set<string>();
    for (const [write, files] of [
      [true, input.writes],
      [false, input.sources ?? []],
    ] as const)
      for (const file of files) {
        keys(
          file,
          write
            ? ['path', 'expectedHash', 'content']
            : ['path', 'expectedHash'],
        );
        if (
          typeof file.path !== 'string' ||
          (file.expectedHash !== null &&
            (typeof file.expectedHash !== 'string' ||
              !/^[a-f0-9]{64}$/.test(file.expectedHash)))
        )
          error('invalid_operation', 'Invalid file precondition');
        this.artifact(file.path, write);
        if (seen.has(file.path))
          error('invalid_operation', 'Duplicate operation path');
        seen.add(file.path);
        if (write && typeof (file as DraftOperationWrite).content !== 'string')
          error('invalid_operation', 'Invalid output bytes');
        if (write && file.path.startsWith('tailoring-drafts/completions/')) {
          const snapshot = DraftRecordSchema.safeParse(JSON.parse((file as DraftOperationWrite).content));
          if (input.command !== 'complete' || file.expectedHash !== null || !next.completion || next.lifecycle !== 'completed'
            || file.path !== `tailoring-drafts/completions/${next.completion.outputId}.json`
            || !snapshot.success || canonicalJson(snapshot.data) !== canonicalJson(next)) {
            error('invalid_completion', 'Completion snapshot must be an immutable snapshot owned by this completion');
          }
        }

      }
    return { ...JSON.parse(JSON.stringify(input)), next };
  }
  private hashFile(relative: string, write = false): string | null {
    const file = this.artifact(relative, write);
    try {
      return digest(fs.readFileSync(file));
    } catch (e) {
      if (isMissing(e)) return null;
      throw e;
    }
  }
  private atomic(
    relative: string,
    bytes: string,
    exclusive = false,
    beforeReplace?: () => void,
  ): void {
    const file = this.safe(relative);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    this.safe(relative);
    const temp = file + '.' + randomUUID() + '.tmp';
    const fd = fs.openSync(temp, 'wx', 0o600);
    try {
      try {
        fs.writeFileSync(fd, bytes);
        fs.fsyncSync(fd);
      } finally {
        fs.closeSync(fd);
      }
      this.safe(relative);
      beforeReplace?.();
      if (exclusive) fs.linkSync(temp, file);
      else fs.renameSync(temp, file);
    } finally {
      if (fs.existsSync(temp)) fs.unlinkSync(temp);
    }
  }
  private load(relative: string): Intent | undefined {
    let intent: Intent;
    try {
      intent = JSON.parse(fs.readFileSync(this.safe(relative), 'utf8'));
    } catch (e) {
      if (isMissing(e)) return undefined;
      throw e;
    }
    if (
      intent.version !== 1 ||
      !['prepared', 'written', 'committed'].includes(intent.phase)
    )
      error('corrupt_operation', 'Invalid operation intent');
    intent.operation = this.validate(intent.operation);
    if (
      digest(canonicalJson(intent.operation)) !== intent.requestHash ||
      canonicalJson(intent.outputHashes) !==
        canonicalJson(
          intent.operation.writes.map((write) => digest(write.content)),
        )
    )
      error('corrupt_operation', 'Operation hashes differ');
    if (intent.phase === 'committed') {
      if (!intent.receipt)
        return error(
          'corrupt_operation',
          'Committed operation is missing receipt',
        );
      intent.receipt.acknowledgement = DraftAcknowledgementSchema.parse(
        intent.receipt.acknowledgement,
      );
      const ack = intent.receipt.acknowledgement;
      if (
        ack.token.revision !== ack.record.revision ||
        ack.token.fingerprint !== digest(canonicalJson(ack.record))
      )
        return error('corrupt_operation', 'Invalid acknowledgement token');
      if (
        intent.receipt.acknowledgement.mutationId !==
          intent.operation.operationId ||
        intent.receipt.acknowledgement.record.id !== intent.operation.draftId ||
        canonicalJson(intent.receipt.result) !==
          canonicalJson(intent.operation.result)
      )
        error('corrupt_operation', 'Invalid operation receipt');
    }
    return intent;
  }
  /** Ownership is encoded outside JSON so corrupt records affect one draft.
   * Operation IDs remain global: locate every matching filename before parsing.
   */
  private locate(operationId: string): Intent | undefined {
    const root = this.safe('tailoring-drafts/operations');
    if (!fs.existsSync(root)) return undefined;
    const matches: { relative: string; draftId: string }[] = [];
    if (
      fs.existsSync(
        this.safe(`tailoring-drafts/operations/${operationId}.json`),
      )
    )
      return error(
        'corrupt_operation',
        'Legacy operation ownership requires explicit recovery',
      );
    for (const owner of fs.readdirSync(root, { withFileTypes: true })) {
      const draftId = owner.name.toLowerCase();
      if (!uuid.test(draftId) || !owner.isDirectory()) continue;
      const relative = `tailoring-drafts/operations/${owner.name}/${operationId}.json`;
      if (fs.existsSync(this.safe(relative)))
        matches.push({ relative, draftId });
    }
    if (matches.length > 1)
      return error(
        'operation_conflict',
        'Operation identity exists under multiple drafts',
      );
    if (!matches.length) return undefined;
    const match = matches[0];
    const intent = this.load(match.relative)!;
    if (
      intent.operation.operationId !== operationId ||
      intent.operation.draftId !== match.draftId
    )
      return error(
        'corrupt_operation',
        'Intent ownership differs from filename',
      );
    return intent;
  }
  /** Recover allocated IDs/timestamps before reconstructing a retry. The service
   * must compare command, draft, expected token and request with the caller first.
   */
  lookup(operationId: string):
    | {
        operation: DraftOperation;
        phase: Intent['phase'];
        receipt?: DraftOperationResult;
      }
    | undefined {
    if (!uuid.test(operationId))
      return error('invalid_operation', 'Invalid operation identity');
    const intent = this.locate(operationId);
    if (!intent) return undefined;
    if (intent.operation.operationId !== operationId)
      return error('corrupt_operation', 'Intent filename differs');
    return {
      operation: intent.operation,
      phase: intent.phase,
      ...(intent.receipt ? { receipt: intent.receipt } : {}),
    };
  }
  execute(input: DraftOperation): DraftOperationResult {
    const operation = this.validate(input);
    const relative = `tailoring-drafts/operations/${operation.draftId}/${operation.operationId}.json`;
    const requestHash = digest(canonicalJson(operation));
    const read = () => {
      const existing = this.locate(operation.operationId);
      if (existing && existing.requestHash !== requestHash)
        error(
          'operation_conflict',
          'Operation id was used for different content',
        );
      return existing;
    };
    const prior = read();
    if (prior?.phase === 'committed') return prior.receipt!;
    return this.repository.trustedOperation(
      { ...operation, input: operation },
      (commit, acknowledged) => {
        const journal = this.safe(relative);
        fs.mkdirSync(path.dirname(journal), { recursive: true });
        this.safe(relative);
        const identityLock = this.safe(
          `tailoring-drafts/operations/${operation.operationId}.identity`,
        );
        return withDraftFileLock(identityLock, () => {
          let intent = read();
          if (intent?.phase === 'committed') return intent.receipt!;
          const finishReceipt = (
            acknowledgement: DraftAcknowledgement,
          ): DraftOperationResult => {
            const receipt = { acknowledgement, result: operation.result };
            this.checkpoint('before-receipt');
            intent = {
              version: 1,
              operation,
              requestHash,
              outputHashes: operation.writes.map((write) =>
                digest(write.content),
              ),
              phase: 'committed',
              receipt,
            };
            this.atomic(relative, JSON.stringify(intent));
            this.checkpoint('after-receipt');
            return receipt;
          };
          // trustedOperation verifies the exact persisted request before returning
          // its acknowledgement. The draft commit already proves this operation
          // finished; later source/output changes belong to later work.
          if (acknowledged) return finishReceipt(acknowledged);
          const paths = [...operation.writes, ...(operation.sources ?? [])]
            .map((file) => file.path)
            .sort();
          const locked = (
            index: number,
            action: () => DraftOperationResult,
          ): DraftOperationResult => {
            if (index === paths.length) return action();
            const file = this.artifact(
              paths[index],
              operation.writes.some((write) => write.path === paths[index]),
            );
            fs.mkdirSync(path.dirname(file), { recursive: true });
            this.safe(paths[index]);
            return withDraftFileLock(file, () => locked(index + 1, action));
          };
          return locked(0, () => {
            if (!intent) {
              this.checkpoint('before-prepare');
              intent = {
                version: 1,
                operation,
                requestHash,
                outputHashes: operation.writes.map((write) =>
                  digest(write.content),
                ),
                phase: 'prepared',
              };
              this.atomic(relative, JSON.stringify(intent), true);
              this.checkpoint('after-prepare');
            }
            const sources = () => {
              for (const source of operation.sources ?? [])
                if (this.hashFile(source.path) !== source.expectedHash)
                  error('source_conflict', `Source conflict: ${source.path}`);
            };
            const outputs = () => {
              for (const [index, write] of operation.writes.entries()) {
                const actual = this.hashFile(write.path, true);
                if (
                  actual !== intent!.outputHashes[index] &&
                  actual !== write.expectedHash
                )
                  error('output_conflict', `Output conflict: ${write.path}`);
              }
            };
            sources();
            outputs();
            for (const [index, write] of operation.writes.entries()) {
              this.checkpoint(`before-write:${index}`);
              sources();
              outputs();
              if (
                this.hashFile(write.path, true) !== intent.outputHashes[index]
              )
                this.atomic(write.path, write.content, false, () => {
                  this.checkpoint(`before-replace:${index}`);
                  sources();
                  outputs();
                });
              this.checkpoint(`after-write:${index}`);
            }
            this.checkpoint('before-written');
            intent.phase = 'written';
            this.atomic(relative, JSON.stringify(intent));
            this.checkpoint('after-written');
            this.checkpoint('before-commit');
            sources();
            for (const [index, write] of operation.writes.entries())
              if (
                this.hashFile(write.path, true) !== intent.outputHashes[index]
              )
                error('output_conflict', `Output conflict: ${write.path}`);
            const acknowledgement = commit();
            this.checkpoint('after-commit');
            return finishReceipt(acknowledgement);
          });
        });
      },
    );
  }
  recover(): {
    results: DraftOperationResult[];
    errors: { operationId: string; message: string }[];
  } {
    const results: DraftOperationResult[] = [];
    const errors: { operationId: string; message: string }[] = [];
    const directory = this.safe('tailoring-drafts/operations');
    if (!fs.existsSync(directory)) return { results, errors };
    const candidates: {
      operationId: string;
      draftId?: string;
      relative: string;
    }[] = [];
    for (const owner of fs
      .readdirSync(directory, { withFileTypes: true })
      .sort((a, b) => a.name.localeCompare(b.name))) {
      if (owner.name.endsWith('.json')) {
        candidates.push({
          operationId: owner.name.slice(0, -5),
          relative: `tailoring-drafts/operations/${owner.name}`,
        });
        continue;
      }
      const draftId = owner.name.toLowerCase();
      if (!uuid.test(draftId)) continue;
      try {
        const owned = this.safe(`tailoring-drafts/operations/${owner.name}`);
        if (!owner.isDirectory())
          error('corrupt_operation', 'Invalid operation owner directory');
        for (const name of fs
          .readdirSync(owned)
          .filter((name) => name.endsWith('.json'))
          .sort())
          candidates.push({
            operationId: name.slice(0, -5),
            draftId,
            relative: `tailoring-drafts/operations/${owner.name}/${name}`,
          });
      } catch (e) {
        errors.push({
          operationId: draftId,
          message: e instanceof Error ? e.message : String(e),
        });
      }
    }
    for (const candidate of candidates) {
      const { operationId, draftId, relative } = candidate;
      try {
        if (!draftId)
          error(
            'corrupt_operation',
            'Legacy operation ownership requires explicit recovery',
          );
        if (!uuid.test(operationId))
          error('corrupt_operation', 'Invalid intent filename');
        const intent = this.load(relative)!;
        if (
          intent.operation.operationId !== operationId ||
          intent.operation.draftId !== draftId
        )
          error('corrupt_operation', 'Intent ownership differs from filename');
        if (intent.phase !== 'committed')
          results.push(this.execute(intent.operation));
      } catch (e) {
        errors.push({
          operationId,
          message: e instanceof Error ? e.message : String(e),
        });
      }
    }
    return { results, errors };
  }
}
