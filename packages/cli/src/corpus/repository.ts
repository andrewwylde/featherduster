import { randomUUID } from 'node:crypto';
import * as C from '@featherduster/core';
import { JobsRepository, RepositoryError } from '../jobs/repository.js';

const stable = (value: unknown): string => JSON.stringify(value, (_, v) => v && typeof v === 'object' && !Array.isArray(v) ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => a.localeCompare(b))) : v);
export function semanticCorpusChange(change: C.CorpusChange): string {
  if (change.kind === 'withdrawal') return stable(change);
  const { explanation: _explanation, ...value } = change.value;
  if (change.kind === 'evidence_amendment') return stable({ kind: change.kind, value });
  const support = change.value;
  const normalize = (text: string) => text.trim().toLowerCase().replace(/\s+/g, ' ');
  return stable({ kind: change.kind, skill: normalize(support.skill), facet: normalize(support.facet), scope: support.scope,
    support: support.support, permitted_terms: [...new Set(support.permitted_terms.map(normalize))].sort(),
    sources: support.sources.map(({ source_status: _status, ...s }) => s).sort((a,b) => stable(a).localeCompare(stable(b))) });
}
function contradicts(a: C.CorpusChange, b: C.CorpusChange): boolean {
  if (a.kind === 'evidence_amendment' && b.kind === a.kind) return a.value.evidence_id === b.value.evidence_id;
  if (a.kind !== 'skill_support' || b.kind !== 'skill_support') return false;
  return a.value.skill.toLowerCase() === b.value.skill.toLowerCase() && a.value.facet.toLowerCase() === b.value.facet.toLowerCase()
    && stable(a.value.scope) === stable(b.value.scope) && a.value.support !== b.value.support
    && stable(a.value.sources.map(s => s.evidence_id).sort()) === stable(b.value.sources.map(s => s.evidence_id).sort());
}
export class CorpusRepository {
  constructor(readonly jobs: JobsRepository) {}
  snapshot(): C.CorpusSnapshot {
    try { return this.jobs.database.db.transaction(() => this.readSnapshot())(); }
    catch (error) { if (error instanceof RepositoryError) throw error; throw new RepositoryError('corrupt_data', 'Invalid stored corpus'); }
  }
  private readSnapshot(): C.CorpusSnapshot {
    const { db, workspaceId } = this.jobs.database;
    const head = db.prepare('SELECT revision FROM corpus_heads WHERE workspace_id=?').get(workspaceId) as { revision: number } | undefined;
    if (!head) throw new RepositoryError('corrupt_data', 'Missing corpus head');
    const updates = db.prepare('SELECT * FROM corpus_updates WHERE workspace_id=? ORDER BY revision').all(workspaceId) as { id: string; revision: number; feedback_id: string; supersedes: string | null; payload: string }[];
    const parsed = updates.map(row => {
      const u = C.CorpusUpdateSchema.parse(JSON.parse(row.payload));
      if (u.workspace_id !== workspaceId || u.id !== row.id || u.revision !== row.revision || u.feedback_id !== row.feedback_id || u.supersedes !== row.supersedes) throw new RepositoryError('corrupt_data', 'Corpus metadata mismatch');
      const feedback = this.feedback(u.feedback_id);
      if (feedback.workspace_id !== workspaceId) throw new RepositoryError('corrupt_data', 'Foreign feedback');
      return u;
    });
    if (parsed.length !== head.revision || parsed.some((u, i) => u.revision !== i + 1)) throw new RepositoryError('corrupt_data', 'Invalid corpus revision sequence');
    return C.CorpusSnapshotSchema.parse({ schema_version: 1, revision: head.revision, updates: parsed });
  }
  feedback(id: string): C.FeedbackEvent {
    const row = this.jobs.database.db.prepare('SELECT payload FROM corpus_feedback WHERE id=? AND workspace_id=?').get(id, this.jobs.database.workspaceId) as { payload: string } | undefined;
    if (!row) throw new RepositoryError('not_found', 'Feedback not found');
    let value: C.FeedbackEvent;
    try { value = C.FeedbackEventSchema.parse(JSON.parse(row.payload)); }
    catch { throw new RepositoryError('corrupt_data', 'Invalid stored feedback'); }
    if (value.id !== id || value.workspace_id !== this.jobs.database.workspaceId) throw new RepositoryError('corrupt_data', 'Feedback metadata mismatch');
    return value;
  }
  listFeedback(): { feedback: C.FeedbackEvent; update_id: string | null }[] {
    const rows = this.jobs.database.db.prepare('SELECT f.id,l.update_id FROM corpus_feedback f LEFT JOIN corpus_feedback_updates l ON l.feedback_id=f.id WHERE f.workspace_id=? ORDER BY f.rowid').all(this.jobs.database.workspaceId) as { id: string; update_id: string | null }[];
    return rows.map(row => ({ feedback: this.feedback(row.id), update_id: row.update_id }));
  }
  saveFeedback(value: C.FeedbackEvent): void {
    const f = C.FeedbackEventSchema.parse(value);
    if (f.workspace_id !== this.jobs.database.workspaceId) throw new RepositoryError('invalid_relationship', 'Foreign feedback');
    if (f.job_id) this.jobs.getJob(f.job_id);
    this.jobs.database.db.prepare('INSERT INTO corpus_feedback VALUES (?,?,?)').run(f.id, f.workspace_id, JSON.stringify(f));
  }
  apply(feedback: C.FeedbackEvent, change: C.CorpusChange, expectedRevision: number, supersedes: string | null = null): C.CorpusUpdate {
    return this.jobs.database.db.transaction(() => {
      change = C.CorpusChangeSchema.parse(change);
      const snapshot = this.snapshot();
      if (snapshot.revision !== expectedRevision) throw new RepositoryError('revision_conflict', 'Stale corpus revision');
      const inactive = new Set(snapshot.updates.flatMap(u => [...(u.supersedes ? [u.supersedes] : []), ...(u.change.kind === 'withdrawal' ? [u.change.update_id] : [])]));
      const active = snapshot.updates.filter(u => !inactive.has(u.id) && u.change.kind !== 'withdrawal');
      if (supersedes && !active.some(u => u.id === supersedes)) throw new RepositoryError('invalid_relationship', 'Supersession target is not active');
      if (change.kind === 'withdrawal' && !active.some(u => u.id === (change as Extract<C.CorpusChange, {kind: 'withdrawal'}>).update_id)) throw new RepositoryError('invalid_relationship', 'Withdrawal target is not active');
      this.saveFeedback(feedback);
      const equivalent = active.find(u => semanticCorpusChange(u.change) === semanticCorpusChange(change));
      if (equivalent && !supersedes) {
        this.jobs.database.db.prepare('INSERT INTO corpus_feedback_updates VALUES (?,?)').run(feedback.id, equivalent.id);
        return equivalent;
      }
      if (active.some(u => u.id !== supersedes && contradicts(u.change, change))) throw new RepositoryError('invalid_relationship', 'Contradictory update requires explicit supersession');
      const update = C.CorpusUpdateSchema.parse({ schema_version: 1, id: randomUUID(), workspace_id: this.jobs.database.workspaceId, revision: snapshot.revision + 1, feedback_id: feedback.id, supersedes, change, recorded_at: feedback.recorded_at });
      this.jobs.database.db.prepare('INSERT INTO corpus_updates VALUES (?,?,?,?,?,?)').run(update.id, update.workspace_id, update.revision, update.feedback_id, update.supersedes, JSON.stringify(update));
      this.jobs.database.db.prepare('INSERT INTO corpus_feedback_updates VALUES (?,?)').run(feedback.id, update.id);
      this.jobs.database.db.prepare('UPDATE corpus_heads SET revision=? WHERE workspace_id=?').run(update.revision, update.workspace_id);
      return update;
    }).immediate();
  }
  withdraw(feedback: C.FeedbackEvent, id: string, reason: string, expectedRevision: number): C.CorpusUpdate {
    return this.apply(feedback, { kind: 'withdrawal', update_id: id, reason }, expectedRevision);
  }
}
