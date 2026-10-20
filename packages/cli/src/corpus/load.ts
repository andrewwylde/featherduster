import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import * as C from '@featherduster/core';
import { fingerprint } from '../jobs/files.js';

export const sourceFingerprint = (record: C.EvidenceRecord): string => fingerprint(C.serializeEvidenceMarkdown(record.entry, record.narrative));
export const emptyCorpus = (): C.CorpusSnapshot => ({ schema_version: 1, revision: 0, updates: [] });
/** Read only: never constructs JobFiles or migrates a database. */
export function loadCorpusSnapshot(workspace: string): C.CorpusSnapshot {
  const root = fs.realpathSync(workspace);
  let current = root;
  for (const part of ['.featherduster', 'jobs', 'jobs.sqlite3']) {
    current = path.join(current, part);
    try { if (fs.lstatSync(current).isSymbolicLink()) throw new Error('Unsafe corpus symlink'); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return emptyCorpus(); throw error; }
  }
  for (const suffix of ['-wal', '-shm']) {
    try { if (fs.lstatSync(current + suffix).isSymbolicLink()) throw new Error('Unsafe corpus sidecar'); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  }
  const db = new Database(current, { readonly: true, fileMustExist: true });
  try {
    return db.transaction(() => {
      const versions = db.prepare('SELECT version FROM schema_migrations ORDER BY version').all() as {version: number}[];
      if (!versions.length || versions.some((r, i) => r.version !== i + 1 || r.version > 5)) throw new Error('Unsupported corpus database schema');
      const identity = db.prepare('SELECT workspace_id FROM workspace_metadata WHERE id=1').get() as {workspace_id: string} | undefined;
      if (!identity || !/^[0-9a-f-]{36}$/i.test(identity.workspace_id)) throw new Error('Corrupt workspace identity');
      if (versions.length === 1) return emptyCorpus();
      const head = db.prepare('SELECT revision FROM corpus_heads WHERE workspace_id=?').get(identity.workspace_id) as {revision: number} | undefined;
      if (!head) throw new Error('Missing corpus head');
      const rows = db.prepare('SELECT id,revision,payload FROM corpus_updates WHERE workspace_id=? ORDER BY revision').all(identity.workspace_id) as {id: string; revision: number; payload: string}[];
      const updates = rows.map(row => {
        const u = C.CorpusUpdateSchema.parse(JSON.parse(row.payload));
        if (u.id !== row.id || u.revision !== row.revision || u.workspace_id !== identity.workspace_id) throw new Error('Corrupt corpus update');
        const rowF = db.prepare('SELECT payload FROM corpus_feedback WHERE id=? AND workspace_id=?').get(u.feedback_id, identity.workspace_id) as {payload: string} | undefined;
        if (!rowF) throw new Error('Missing corpus feedback');
        const f = C.FeedbackEventSchema.parse(JSON.parse(rowF.payload));
        if (f.id !== u.feedback_id || f.workspace_id !== identity.workspace_id) throw new Error('Foreign corpus feedback');
        return u;
      });
      if (updates.length !== head.revision || updates.some((u, i) => u.revision !== i + 1)) throw new Error('Corrupt corpus sequence');
      return C.CorpusSnapshotSchema.parse({ schema_version: 1, revision: head.revision, updates });
    })();
  } finally { db.close(); }
}
export function loadEffectiveCorpus(workspace: string, source: C.EvidenceStore): C.EffectiveCorpus {
  return C.applyCorpusSnapshot(source, loadCorpusSnapshot(workspace), { fingerprint: sourceFingerprint });
}
