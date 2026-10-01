import fs from 'node:fs';
import path from 'node:path';
import yaml from 'js-yaml';
import { randomUUID } from 'node:crypto';
import { DraftRepositoryError } from './drafts/errors.js';
import { withDraftFileLock } from './drafts/locks.js';
import { RunManifestSchema, type RunManifest } from '@featherduster/core';

export const TAILORING_DIR = 'tailoring';
const SLUG_RE = /^[a-z0-9][a-z0-9-]{0,79}$/;

export const RUN_FILES = {
  manifest: 'run.yaml',
  posting: 'job-posting.md',
  analysis: 'analysis.json',
  alignment: 'alignment.json',
  proposals: 'proposals.json',
  resume: 'resume.yaml',
  brief: 'brief.md',
  briefData: 'brief.json',
} as const;
export type RunFile = (typeof RUN_FILES)[keyof typeof RUN_FILES];

export class RunStoreError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = 'RunStoreError';
    this.status = status;
  }
}

export function isValidSlug(slug: string): boolean {
  return SLUG_RE.test(slug);
}

export function slugify(label: string): string {
  return label
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
    .replace(/-+$/g, '');
}

function timestampSlug(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `run-${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`;
}

/** Filesystem persistence for tailoring runs under `<workspace>/tailoring/<slug>/`. */
export class RunStore {
  readonly rootDir: string;

  constructor(workspaceDir: string, private readonly mutationGuard?: <T>(slug: string, action: (validate: () => void) => T) => T) {
    this.rootDir = path.join(path.resolve(workspaceDir), TAILORING_DIR);
  }

  runDir(slug: string): string {
    if (!isValidSlug(slug)) throw new RunStoreError(400, `Invalid run slug "${slug}"`);
    const dir = path.join(this.rootDir, slug);
    const rel = path.relative(this.rootDir, dir);
    if (rel.startsWith('..') || path.isAbsolute(rel)) throw new RunStoreError(403, 'Path traversal detected');
    return dir;
  }

  private filePath(slug: string, file: RunFile): string {
    const full = path.join(this.runDir(slug), file);
    if (fs.existsSync(full) && fs.lstatSync(full).isSymbolicLink()) {
      throw new RunStoreError(403, 'Refusing to read or write symbolic links');
    }
    return full;
  }

  exists(slug: string): boolean {
    return isValidSlug(slug) && fs.existsSync(path.join(this.rootDir, slug, RUN_FILES.manifest));
  }

  allocateSlug(label: string | undefined, now: Date, reserved: ReadonlySet<string> = new Set()): string {
    const base = (label && slugify(label)) || timestampSlug(now);
    const safeBase = isValidSlug(base) ? base : timestampSlug(now);
    let slug = safeBase;
    let n = 2;
    while (reserved.has(slug) || fs.existsSync(path.join(this.rootDir, slug))) {
      slug = `${safeBase.slice(0, 74)}-${n++}`;
    }
    return slug;
  }

  create(slug: string): void {
    const dir = this.runDir(slug);
    if (fs.existsSync(dir)) throw new RunStoreError(409, `Run "${slug}" already exists`);
    fs.mkdirSync(dir, { recursive: true });
  }

  readManifest(slug: string): RunManifest {
    const file = this.filePath(slug, RUN_FILES.manifest);
    if (!fs.existsSync(file)) throw new RunStoreError(404, `Run "${slug}" not found`);
    return RunManifestSchema.parse(yaml.load(fs.readFileSync(file, 'utf-8')));
  }

  writeManifest(manifest: RunManifest): void {
    const validated = RunManifestSchema.parse(manifest);
    this.writeGuarded(validated.slug, RUN_FILES.manifest, yaml.dump(validated, { indent: 2, lineWidth: 120 }), () => {
      const current = this.exists(validated.slug) ? this.readManifest(validated.slug) : undefined;
      if (current?.draft_id && current.draft_id !== validated.draft_id) {
        throw new DraftRepositoryError(409, 'association_conflict', 'Run association changed; reload the manifest before writing');
      }
    });
  }

  readText(slug: string, file: RunFile): string | null {
    const full = this.filePath(slug, file);
    return fs.existsSync(full) ? fs.readFileSync(full, 'utf-8') : null;
  }

  writeText(slug: string, file: RunFile, content: string): void {
    this.writeGuarded(slug, file, content);
  }

  private writeGuarded(slug: string, file: RunFile, content: string, validateContent: () => void = () => {}): void {
    const action = (validateGuard: () => void = () => {}) => writeRunArtifactAtomic(this.filePath(slug, file), content, () => {
      validateGuard();
      validateContent();
    });
    if (this.mutationGuard) this.mutationGuard(slug, action);
    else action();
  }

  readJson<T>(slug: string, file: RunFile, parse: (raw: unknown) => T): T | null {
    const text = this.readText(slug, file);
    if (text === null) return null;
    try {
      return parse(JSON.parse(text));
    } catch {
      return null;
    }
  }

  writeJson(slug: string, file: RunFile, data: unknown): void {
    this.writeText(slug, file, JSON.stringify(data, null, 2) + '\n');
  }

  list(): RunManifest[] {
    if (!fs.existsSync(this.rootDir)) return [];
    const manifests: RunManifest[] = [];
    for (const entry of fs.readdirSync(this.rootDir, { withFileTypes: true })) {
      if (!entry.isDirectory() || !isValidSlug(entry.name)) continue;
      try {
        manifests.push(this.readManifest(entry.name));
      } catch {
        // skip malformed runs
      }
    }
    return manifests.sort((a, b) => b.updated.localeCompare(a.updated));
  }

}

/** Shared with finalized resume writes; callers acquire draft ownership before artifact ownership. */
export function writeRunArtifactAtomic(file: string, content: string, validate: () => void = () => {}): void {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    withDraftFileLock(file, () => {
      // Read-only validation under artifact ownership must never acquire a draft lock.
      validate();
      const tmp = `${file}.${randomUUID()}.tmp`;
      try {
        fs.writeFileSync(tmp, content, { encoding: 'utf-8', flag: 'wx', mode: 0o600 });
        validate();
        fs.renameSync(tmp, file);
      } finally {
        if (fs.existsSync(tmp)) fs.unlinkSync(tmp);
      }
    });
}
