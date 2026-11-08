import fs from 'node:fs';
import path from 'node:path';
import yaml from 'js-yaml';
import { DEFAULT_STARTER_RESUME, ResumeSpecSchema, parseLatexResume, type ResumeSpec } from '@featherduster/core';

export interface ResumeRecord {
  id: string;
  name: string;
  type: 'template' | 'tailored';
  filePath: string;
  spec: ResumeSpec;
  modifiedAt?: string;
}

export function findFiles(
  dir: string,
  extensions: string[],
  visited: Set<string> = new Set()
): string[] {
  if (!fs.existsSync(dir)) return [];
  try {
    const realDir = fs.realpathSync(dir);
    if (visited.has(realDir)) return [];
    visited.add(realDir);
  } catch {
    return [];
  }

  const results: string[] = [];
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name !== 'node_modules' && entry.name !== '.git') {
        results.push(...findFiles(fullPath, extensions, visited));
      }
    } else if (entry.isFile() || entry.isSymbolicLink()) {
      const ext = path.extname(entry.name).toLowerCase();
      if (extensions.includes(ext)) {
        try {
          if (fs.statSync(fullPath).isFile()) {
            results.push(fullPath);
          }
        } catch {
          // Skip inaccessible files
        }
      }
    }
  }
  return results;
}

export function normalizeResumeId(filePath: string, workspaceDir?: string): string {
  let rel = filePath;
  if (workspaceDir && path.isAbsolute(filePath)) {
    rel = path.relative(workspaceDir, filePath);
  }
  rel = rel.replace(/\\/g, '/');
  rel = rel.replace(/^\.?\//, '');
  if (rel.startsWith('resumes/')) {
    rel = rel.slice('resumes/'.length);
  }
  const ext = path.extname(rel);
  const extClean = ext.startsWith('.') ? ext.slice(1).toLowerCase() : '';
  const withoutExt = ext ? rel.slice(0, -ext.length) : rel;
  return extClean ? `${withoutExt}:${extClean}` : withoutExt;
}

export function loadResumeSpecsFromPaths(
  files: string[],
  workspaceDir: string = ''
): ResumeRecord[] {
  const records: ResumeRecord[] = [];
  for (const file of files) {
    const absPath = path.isAbsolute(file) || !workspaceDir
      ? file
      : path.resolve(workspaceDir, file);
    const rel = workspaceDir
      ? path.relative(workspaceDir, absPath).replace(/\\/g, '/')
      : file.replace(/\\/g, '/');
    const normalizedRel = rel.startsWith('resumes/') ? rel.slice('resumes/'.length) : rel;
    const ext = path.extname(file).toLowerCase();
    const baseName = path.basename(file, ext);
    const id = normalizeResumeId(file, workspaceDir);
    const type: 'template' | 'tailored' = normalizedRel.startsWith('templates/') ? 'template' : 'tailored';

    let spec: ResumeSpec = {
      profile: { name: baseName, title: '', email: '' },
      experiences: [],
      education: [],
      skills: [],
    };
    let modifiedAt: string | undefined = undefined;

    if (fs.existsSync(absPath)) {
      try {
        const stat = fs.statSync(absPath);
        modifiedAt = stat.mtime.toISOString();
        const raw = fs.readFileSync(absPath, 'utf-8');
        let parsed: any;
        if (ext === '.json') {
          parsed = JSON.parse(raw);
        } else if (ext === '.yaml' || ext === '.yml') {
          parsed = yaml.load(raw);
        } else if (ext === '.tex') {
          parsed = parseLatexResume(raw);
        } else if (ext === '.md') {
          const match = raw.match(/^---\r?\n([\s\S]*?)\r?\n---/);
          if (match) {
            parsed = yaml.load(match[1]);
          } else {
            parsed = yaml.load(raw);
          }
        }
        if (parsed && typeof parsed === 'object') {
          if (!parsed.profile && parsed.candidate) {
            parsed.profile = parsed.candidate;
          }
        }
        const validated = ResumeSpecSchema.safeParse(parsed);
        if (validated.success) {
          spec = validated.data;
        } else {
          continue;
        }
      } catch {
        continue;
      }
    }

    records.push({
      id,
      name: baseName,
      type,
      filePath: rel,
      spec,
      ...(modifiedAt ? { modifiedAt } : {}),
    });
  }
  return records;
}

export interface ResolveResumeResult {
  resume?: ResumeRecord;
  ambiguous: boolean;
  matchingIds?: string[];
}

export function resolveResume(
  resumes: Array<{ id: string; type?: string; name?: string; filePath?: string; spec?: any }>,
  targetId: string
): ResolveResumeResult {
  if (!targetId) return { ambiguous: false };

  // 1. Exact ID match
  const exact = resumes.find(r => r.id === targetId);
  if (exact) {
    return { resume: exact as ResumeRecord, ambiguous: false };
  }

  // 2. Legacy ID or relative path resolution
  const matches = resumes.filter(r => {
    if (r.id === targetId) return true;
    const filePath = r.filePath ?? '';
    const ext = path.extname(filePath);
    const baseName = path.basename(filePath, ext);
    const type = r.type ?? (filePath.includes('template') ? 'template' : 'tailored');
    const name = r.name ?? baseName;
    if (`${type}-${baseName}` === targetId) return true;
    if (`${type}-${name}` === targetId) return true;
    if (baseName === targetId) return true;
    if (name === targetId) return true;
    if (targetId === 'template-starter' && (r.id === 'templates/starter:yaml' || filePath.includes('starter.yaml'))) return true;
    const idPrefix = r.id.includes(':') ? r.id.slice(0, r.id.lastIndexOf(':')) : r.id;
    if (idPrefix === targetId) return true;
    return false;
  });

  if (matches.length === 1) {
    return { resume: matches[0] as ResumeRecord, ambiguous: false };
  }
  if (matches.length > 1) {
    return { ambiguous: true, matchingIds: matches.map(m => m.id) };
  }

  return { ambiguous: false };
}

export function loadResumeSpecs(workspaceDir: string, includeStarter = true): ResumeRecord[] {
  const resumesDir = path.join(workspaceDir, 'resumes');
  let files: string[] = [];
  if (fs.existsSync(resumesDir)) {
    files = findFiles(resumesDir, ['.yaml', '.yml', '.json', '.md', '.tex'])
      .filter(f => !f.replace(/\\/g, '/').includes('/resumes/exports/'));
  }
  const records = loadResumeSpecsFromPaths(files, workspaceDir);

  // If no templates exist, provide a default starter template conforming to ResumeSpec
  if (includeStarter && records.filter((r) => r.type === 'template').length === 0) {
    records.unshift({
      id: 'templates/starter:yaml',
      name: 'Starter Template',
      type: 'template',
      filePath: 'resumes/templates/starter.yaml',
      spec: DEFAULT_STARTER_RESUME,
    });
  }

  // Sort: templates first (with master priority 1, main priority 2), then tailored
  records.sort((a, b) => {
    if (a.type !== b.type) return a.type === 'template' ? -1 : 1;
    const aPriority = a.name.toLowerCase() === 'master' ? 1 : a.name.toLowerCase() === 'main' ? 2 : 3;
    const bPriority = b.name.toLowerCase() === 'master' ? 1 : b.name.toLowerCase() === 'main' ? 2 : 3;
    if (aPriority !== bPriority) return aPriority - bPriority;
    return a.name.localeCompare(b.name);
  });

  return records;
}
