import { createHash, randomUUID } from 'node:crypto';
import { chmodSync, closeSync, existsSync, fsyncSync, lstatSync, mkdirSync, openSync, readFileSync, realpathSync, renameSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { ImmutableReference } from '@featherduster/core';

export const fingerprint = (bytes: string | Uint8Array): string => createHash('sha256').update(bytes).digest('hex');
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** Protects normal filesystem operations, not against hostile concurrent OS users. */
export class JobFiles {
  readonly workspace: string;
  readonly databasePath: string;
  constructor(workspace: string) {
    this.workspace = realpathSync(workspace);
    this.directory('.featherduster/jobs');
    this.databasePath = this.checked('.featherduster/jobs/jobs.sqlite3');
    for (const suffix of ['-wal', '-shm']) this.checked(`.featherduster/jobs/jobs.sqlite3${suffix}`);
    if (!existsSync(this.databasePath)) this.create('.featherduster/jobs/jobs.sqlite3', new Uint8Array());
    if (!lstatSync(this.databasePath).isFile()) throw new Error('Database must be a regular file');
    if (process.platform !== 'win32') chmodSync(this.databasePath, 0o600);
    const ignore = '.featherduster/jobs/.gitignore';
    if (!existsSync(this.checked(ignore))) this.create(ignore, '*\n');
  }
  private parts(relative: string): string[] {
    if (!relative || relative.includes('\0') || relative.includes('\\') || path.posix.isAbsolute(relative) || path.win32.isAbsolute(relative) || relative.includes(':')) throw new Error('Unsafe private path');
    const parts = relative.split('/');
    if (parts.some(p => !p || p === '.' || p === '..') || !['.featherduster', 'tailoring'].includes(parts[0]!) || (parts.length > 1 && parts[1] !== 'jobs')) throw new Error('Unsafe private path');
    return parts;
  }
  private inside(target: string): void {
    const relative = path.relative(this.workspace, target);
    if (path.isAbsolute(relative) || relative === '..' || relative.startsWith(`..${path.sep}`)) throw new Error('Path escapes workspace');
  }
  private checked(relative: string): string {
    const parts = this.parts(relative);
    let current = this.workspace;
    for (const part of parts) {
      current = path.join(current, part);
      this.inside(current);
      try {
        if (lstatSync(current).isSymbolicLink()) throw new Error('Private path contains a symlink');
        this.inside(realpathSync(current));
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      }
    }
    return current;
  }
  private directory(relative: string): void {
    const parts = this.parts(relative);
    for (let i = 1; i <= parts.length; i++) {
      const name = parts.slice(0, i).join('/');
      const target = this.checked(name);
      if (!existsSync(target)) { mkdirSync(target, { mode: 0o700 }); this.syncDirectory(path.dirname(target)); }
      if (!lstatSync(this.checked(name)).isDirectory()) throw new Error('Private parent is not a directory');
    }
  }
  private create(relative: string, bytes: string | Uint8Array): void {
    const target = this.checked(relative);
    const fd = openSync(target, 'wx', 0o600);
    try { writeFileSync(fd, bytes); fsyncSync(fd); }
    catch (error) { unlinkSync(target); throw error; }
    finally { closeSync(fd); }
  }
  private syncDirectory(target: string): void {
    let fd: number | undefined;
    try { fd = openSync(target, 'r'); fsyncSync(fd); }
    catch (error) {
      // Windows does not support opening/flushing directory handles through Node.
      if (process.platform !== 'win32' || !['EPERM', 'EISDIR', 'EINVAL', 'ENOTSUP'].includes((error as NodeJS.ErrnoException).code ?? '')) throw error;
    } finally { if (fd !== undefined) closeSync(fd); }
  }
  bundlePath(kind: 'snapshots' | 'artifacts', jobId: string, id: string): string {
    if (!uuid.test(jobId) || !uuid.test(id)) throw new Error('Invalid bundle identity');
    return kind === 'snapshots' ? `tailoring/jobs/${jobId}/snapshots/${id}` : `.featherduster/jobs/artifacts/${jobId}/${id}`;
  }
  /** Caller holds the workspace SQLite immediate transaction across publication. */
  writeBundle(kind: 'snapshots' | 'artifacts', jobId: string, id: string, files: Record<string, string | Uint8Array>): void {
    const destination = this.bundlePath(kind, jobId, id);
    const parent = path.posix.dirname(destination);
    this.directory(parent);
    const staging = `${parent}/stage-${randomUUID()}`;
    let renamed = false;
    try {
      this.directory(staging);
      for (const [name, bytes] of Object.entries(files)) {
        if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(name) || name.endsWith('.') || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(name)) throw new Error('Invalid bundle filename');
        this.create(`${staging}/${name}`, bytes);
      }
      this.syncDirectory(this.checked(staging));
      if (existsSync(this.checked(destination))) throw new Error('Immutable bundle already exists');
      renameSync(this.checked(staging), this.checked(destination)); renamed = true;
      this.syncDirectory(this.checked(parent));
    } finally { if (!renamed) rmSync(this.checked(staging), { recursive: true, force: true }); }
  }
  readSnapshot(reference: ImmutableReference, jobId: string, id: string): Buffer {
    const parent = this.bundlePath('snapshots', jobId, id);
    if (path.posix.dirname(reference.id) !== parent) throw new Error('Invalid snapshot reference');
    const target = this.checked(reference.id);
    if (!lstatSync(target).isFile()) throw new Error('Snapshot is not a regular file');
    const bytes = readFileSync(target);
    if (fingerprint(bytes) !== reference.fingerprint) throw new Error('Snapshot fingerprint mismatch');
    return bytes;
  }
  writeArtifact(jobId: string, versionId: string, filename: string, bytes: Uint8Array | string): ImmutableReference {
    if (!uuid.test(jobId) || !uuid.test(versionId) || (!/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(filename) || filename.endsWith('.') || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(filename))) throw new Error('Invalid artifact component');
    const parent = `.featherduster/jobs/artifacts/${jobId}/${versionId}`;
    this.directory(parent);
    const id = `${parent}/${filename}`;
    this.create(id, bytes);
    return { id, fingerprint: fingerprint(bytes) };
  }
  readArtifact(reference: ImmutableReference, jobId?: string, versionId?: string): Buffer {
    const parts = this.parts(reference.id);
    if (parts[0] !== '.featherduster' || parts.length !== 6 || parts[2] !== 'artifacts' || !uuid.test(parts[3]!) || !uuid.test(parts[4]!) || (jobId && parts[3] !== jobId) || (versionId && parts[4] !== versionId)) throw new Error('Invalid artifact reference');
    const target = this.checked(reference.id);
    if (!lstatSync(target).isFile()) throw new Error('Artifact is not a regular file');
    const bytes = readFileSync(target);
    if (fingerprint(bytes) !== reference.fingerprint) throw new Error('Artifact fingerprint mismatch');
    return bytes;
  }
}
