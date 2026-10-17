import Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
import { JobFiles } from './files.js';

export interface Migration { version: number; sql: string }
const migrations: Migration[] = [{ version: 1, sql: `
CREATE TABLE workspace_metadata (id INTEGER PRIMARY KEY CHECK(id=1), workspace_id TEXT NOT NULL UNIQUE);
CREATE TABLE worker_control (workspace_id TEXT PRIMARY KEY REFERENCES workspace_metadata(workspace_id), revision INTEGER NOT NULL, enabled INTEGER NOT NULL, pause_after_current INTEGER NOT NULL, stop_generation INTEGER NOT NULL, stopped_at TEXT, updated_at TEXT NOT NULL, payload TEXT NOT NULL);
CREATE TABLE jobs (id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL REFERENCES workspace_metadata(workspace_id), revision INTEGER NOT NULL, kind TEXT NOT NULL, updated_at TEXT NOT NULL, canonical_url TEXT, preparation_state TEXT NOT NULL, application_lifecycle TEXT NOT NULL, created_at TEXT NOT NULL, payload TEXT NOT NULL, UNIQUE(workspace_id, canonical_url));
CREATE INDEX jobs_queue ON jobs(workspace_id, preparation_state, created_at, id);
CREATE TABLE url_aliases (workspace_id TEXT NOT NULL REFERENCES workspace_metadata(workspace_id), url TEXT NOT NULL, job_id TEXT NOT NULL REFERENCES jobs(id), PRIMARY KEY(workspace_id,url));
CREATE TABLE posting_snapshots (id TEXT PRIMARY KEY, job_id TEXT NOT NULL REFERENCES jobs(id), fingerprint TEXT NOT NULL, payload TEXT NOT NULL);
CREATE TABLE profiles (id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL REFERENCES workspace_metadata(workspace_id), revision INTEGER NOT NULL, payload TEXT NOT NULL);
CREATE TABLE scoped_answers (id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL REFERENCES workspace_metadata(workspace_id), scope_kind TEXT NOT NULL, scope_identity TEXT NOT NULL, key TEXT NOT NULL, job_id TEXT REFERENCES jobs(id), payload TEXT NOT NULL, UNIQUE(workspace_id,scope_kind,scope_identity,key));
CREATE TABLE input_snapshots (id TEXT PRIMARY KEY, job_id TEXT NOT NULL REFERENCES jobs(id), fingerprint TEXT NOT NULL, payload TEXT NOT NULL);
CREATE TABLE attempts (id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL REFERENCES workspace_metadata(workspace_id), job_id TEXT NOT NULL REFERENCES jobs(id), input_snapshot_id TEXT NOT NULL REFERENCES input_snapshots(id), status TEXT NOT NULL, owner_token TEXT NOT NULL, lease_expires_at TEXT NOT NULL, stop_generation INTEGER NOT NULL, payload TEXT NOT NULL);
CREATE UNIQUE INDEX single_active_worker ON attempts(workspace_id) WHERE status='active';
CREATE TABLE checkpoints (id TEXT PRIMARY KEY, job_id TEXT NOT NULL REFERENCES jobs(id), attempt_id TEXT NOT NULL REFERENCES attempts(id), completed_stage TEXT NOT NULL, completed_at TEXT NOT NULL, payload TEXT NOT NULL, UNIQUE(attempt_id,completed_stage));
CREATE TABLE events (sequence INTEGER PRIMARY KEY AUTOINCREMENT, id TEXT NOT NULL UNIQUE, workspace_id TEXT NOT NULL REFERENCES workspace_metadata(workspace_id), job_id TEXT NOT NULL REFERENCES jobs(id), attempt_id TEXT REFERENCES attempts(id), idempotency_key TEXT, payload TEXT NOT NULL, UNIQUE(workspace_id,idempotency_key));
CREATE TABLE artifacts (id TEXT PRIMARY KEY, job_id TEXT NOT NULL REFERENCES jobs(id), attempt_id TEXT NOT NULL REFERENCES attempts(id), input_snapshot_id TEXT NOT NULL REFERENCES input_snapshots(id), parent_version_id TEXT REFERENCES artifacts(id), payload TEXT NOT NULL);
CREATE TABLE draft_revisions (id TEXT NOT NULL, revision INTEGER NOT NULL, job_id TEXT NOT NULL REFERENCES jobs(id), input_snapshot_id TEXT NOT NULL REFERENCES input_snapshots(id), parent_artifact_version_id TEXT REFERENCES artifacts(id), payload TEXT NOT NULL, PRIMARY KEY(id,revision));
CREATE TABLE mutation_receipts (workspace_id TEXT NOT NULL REFERENCES workspace_metadata(workspace_id), operation TEXT NOT NULL, idempotency_key TEXT NOT NULL, fingerprint TEXT NOT NULL, result TEXT NOT NULL, created_at TEXT NOT NULL, PRIMARY KEY(workspace_id,operation,idempotency_key));
` }, { version: 2, sql: `
CREATE TABLE corpus_heads (workspace_id TEXT PRIMARY KEY REFERENCES workspace_metadata(workspace_id), revision INTEGER NOT NULL CHECK(revision>=0));
INSERT INTO corpus_heads SELECT workspace_id,0 FROM workspace_metadata;
CREATE TABLE corpus_feedback (id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL REFERENCES workspace_metadata(workspace_id), payload TEXT NOT NULL);
CREATE TABLE corpus_updates (id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL REFERENCES corpus_heads(workspace_id), revision INTEGER NOT NULL, feedback_id TEXT NOT NULL REFERENCES corpus_feedback(id), supersedes TEXT REFERENCES corpus_updates(id), payload TEXT NOT NULL, UNIQUE(workspace_id,revision));
CREATE TABLE corpus_feedback_updates (feedback_id TEXT PRIMARY KEY REFERENCES corpus_feedback(id), update_id TEXT NOT NULL REFERENCES corpus_updates(id));
CREATE TRIGGER corpus_feedback_no_update BEFORE UPDATE ON corpus_feedback BEGIN SELECT RAISE(ABORT,'immutable feedback'); END;
CREATE TRIGGER corpus_feedback_no_delete BEFORE DELETE ON corpus_feedback BEGIN SELECT RAISE(ABORT,'immutable feedback'); END;
CREATE TRIGGER corpus_updates_no_update BEFORE UPDATE ON corpus_updates BEGIN SELECT RAISE(ABORT,'immutable corpus history'); END;
CREATE TRIGGER corpus_updates_no_delete BEFORE DELETE ON corpus_updates BEGIN SELECT RAISE(ABORT,'immutable corpus history'); END;
` }, { version: 3, sql: `
CREATE TABLE proposal_generations (id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL REFERENCES workspace_metadata(workspace_id), job_id TEXT NOT NULL REFERENCES jobs(id), attempt_id TEXT NOT NULL REFERENCES attempts(id), input_snapshot_id TEXT NOT NULL REFERENCES input_snapshots(id), payload TEXT NOT NULL);
CREATE TABLE proposal_review_revisions (id TEXT NOT NULL, revision INTEGER NOT NULL CHECK(revision>=0), generation_id TEXT NOT NULL REFERENCES proposal_generations(id), job_id TEXT NOT NULL REFERENCES jobs(id), input_snapshot_id TEXT NOT NULL REFERENCES input_snapshots(id), payload TEXT NOT NULL, PRIMARY KEY(id,revision));
CREATE TABLE job_proposal_reviews (job_id TEXT PRIMARY KEY REFERENCES jobs(id), review_id TEXT NOT NULL, revision INTEGER NOT NULL, FOREIGN KEY(review_id,revision) REFERENCES proposal_review_revisions(id,revision));
CREATE TABLE attempt_proposal_reviews (attempt_id TEXT PRIMARY KEY REFERENCES attempts(id), review_id TEXT NOT NULL, revision INTEGER NOT NULL, validation_fingerprint TEXT NOT NULL, FOREIGN KEY(review_id,revision) REFERENCES proposal_review_revisions(id,revision));
CREATE TRIGGER proposal_generations_no_update BEFORE UPDATE ON proposal_generations BEGIN SELECT RAISE(ABORT,'immutable generation'); END;
CREATE TRIGGER proposal_generations_no_delete BEFORE DELETE ON proposal_generations BEGIN SELECT RAISE(ABORT,'immutable generation'); END;
CREATE TRIGGER proposal_reviews_no_update BEFORE UPDATE ON proposal_review_revisions BEGIN SELECT RAISE(ABORT,'immutable review'); END;
CREATE TRIGGER proposal_reviews_no_delete BEFORE DELETE ON proposal_review_revisions BEGIN SELECT RAISE(ABORT,'immutable review'); END;
CREATE TRIGGER attempt_reviews_no_update BEFORE UPDATE ON attempt_proposal_reviews BEGIN SELECT RAISE(ABORT,'immutable selection'); END;
CREATE TRIGGER attempt_reviews_no_delete BEFORE DELETE ON attempt_proposal_reviews BEGIN SELECT RAISE(ABORT,'immutable selection'); END;
` }, { version: 4, sql: `
CREATE TABLE material_revisions (id TEXT PRIMARY KEY, job_id TEXT NOT NULL REFERENCES jobs(id), kind TEXT NOT NULL, payload TEXT NOT NULL);
CREATE TABLE material_heads (job_id TEXT NOT NULL REFERENCES jobs(id), kind TEXT NOT NULL, revision_id TEXT NOT NULL REFERENCES material_revisions(id), PRIMARY KEY(job_id,kind));
CREATE TRIGGER materials_no_update BEFORE UPDATE ON material_revisions BEGIN SELECT RAISE(ABORT,'immutable material'); END;
CREATE TRIGGER materials_no_delete BEFORE DELETE ON material_revisions BEGIN SELECT RAISE(ABORT,'immutable material'); END;
` }];

export function runMigrations(db: Database.Database, steps: Migration[] = migrations): void {
  db.transaction(() => {
    db.exec('CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL)');
    const rows = db.prepare('SELECT version FROM schema_migrations ORDER BY version').all() as { version: number }[];
    if (rows.some((r, i) => r.version !== i + 1 || !steps.some(s => s.version === r.version)) || steps.some((s, i) => s.version !== i + 1)) throw new Error('Unsupported or incomplete jobs migrations; restore a compatible database backup');
    for (const step of steps.slice(rows.length)) {
      db.exec(step.sql);
      db.prepare('INSERT INTO schema_migrations VALUES (?,?)').run(step.version, new Date().toISOString());
    }
  }).immediate();
}
export interface JobsDatabase { db: Database.Database; files: JobFiles; workspaceId: string; close(): void }
export function openJobsDatabase(workspaceDir: string): JobsDatabase {
  const files = new JobFiles(workspaceDir);
  const db = new Database(files.databasePath);
  try {
    db.pragma('busy_timeout = 5000');
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');
    db.pragma('synchronous = FULL');
    if (db.pragma('journal_mode', { simple: true }) !== 'wal' || db.pragma('foreign_keys', { simple: true }) !== 1 || db.pragma('synchronous', { simple: true }) !== 2 || db.pragma('busy_timeout', { simple: true }) !== 5000) throw new Error('Jobs database requires WAL, foreign keys, FULL synchronization and a bounded busy timeout');
    runMigrations(db);
    const workspaceId = db.transaction(() => {
      const row = db.prepare('SELECT workspace_id FROM workspace_metadata WHERE id=1').get() as { workspace_id: string } | undefined;
      if (row) {
        if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(row.workspace_id)) throw new Error('Corrupt workspace identity; restore database backup');
        return row.workspace_id;
      }
      const id = randomUUID();
      db.prepare('INSERT INTO workspace_metadata VALUES (1,?)').run(id);
      db.prepare('INSERT INTO corpus_heads VALUES (?,0)').run(id);
      db.prepare('INSERT INTO worker_control VALUES (?,0,0,0,0,NULL,?,?)').run(id, new Date().toISOString(), JSON.stringify({ schema_version: 1, workspace_id: id, revision: 0, automatic_preparation_enabled: false, pause_after_current: false, stop_generation: 0, stopped_at: null, updated_at: new Date().toISOString() }));
      return id;
    }).immediate();
    return { db, files, workspaceId, close: () => db.close() };
  } catch (error) { db.close(); throw error; }
}
