import fs from 'node:fs';
import path from 'node:path';
import { parseEvidenceLedger } from '@featherduster/core';

/**
 * True when a file holds a consolidated evidence ledger (many entries). These files
 * must never be overwritten with a single serialized entry.
 */
export function isConsolidatedLedgerFile(file: string): boolean {
  if (path.basename(file).toLowerCase().startsWith('evidence-ledger')) return true;
  if (!fs.existsSync(file)) return false;
  try {
    const content = fs.readFileSync(file, 'utf-8');
    if (!content.includes('entries:')) return false;
    return parseEvidenceLedger(content, file).length > 0;
  } catch {
    return false;
  }
}

export function toWorkspaceRelative(workspaceDir: string, file: string): string {
  return path.relative(workspaceDir, file).replace(/\\/g, '/');
}

export function isInsideWorkspace(workspaceDir: string, file: string): boolean {
  const rel = path.relative(path.resolve(workspaceDir), path.resolve(file));
  return !rel.startsWith('..') && !path.isAbsolute(rel);
}
