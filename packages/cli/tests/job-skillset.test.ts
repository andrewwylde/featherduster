import { afterEach, beforeEach, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { loadSourceEvidenceStore } from '../src/server.js';
import { openJobsDatabase } from '../src/jobs/database.js';
import { JobsRepository } from '../src/jobs/repository.js';
import { CorpusRepository } from '../src/corpus/repository.js';
import { CorpusService } from '../src/corpus/service.js';
import { sourceFingerprint } from '../src/corpus/load.js';
import { selectJobSkillset } from '../src/jobs/skillset.js';

let workspace: string;
let database: ReturnType<typeof openJobsDatabase>;
let corpus: CorpusService;
let ledger: string;
const bytes = `entries:
  - id: api
    date: '2026-01-01'
    company: Synthetic Company
    title: APIs
    summary: Built APIs and authentication.
    impact: Reliability
    themes: [platform]
    confidence: verified
    in_flight: false
    metrics: []
    internal_references: []
`;
beforeEach(() => {
  workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'job-skillset-'));
  fs.mkdirSync(path.join(workspace, 'evidence'));
  ledger = path.join(workspace, 'evidence', 'evidence-ledger.yaml');
  fs.writeFileSync(ledger, bytes);
  database = openJobsDatabase(workspace);
  corpus = new CorpusService(new CorpusRepository(new JobsRepository(database)), () => loadSourceEvidenceStore(workspace));
});
afterEach(() => { database.close(); fs.rmSync(workspace, { recursive: true, force: true }); });
function remember(support: 'direct' | 'transferable' | 'unsupported' = 'transferable') {
  const record = loadSourceEvidenceStore(workspace).get('api')!;
  return corpus.remember({ workspace_id: database.workspaceId, expected_revision: 0, idempotency_key: 'save', supersedes: null, explanation: 'Explicit synthetic support', change: { kind: 'skill_support', value: {
    skill: 'backend', facet: 'development', permitted_terms: ['backend'], support,
    scope: { kind: 'role', key: 'Backend Engineer' }, explanation: 'API experience',
    sources: [{ evidence_id: 'api', evidence_fingerprint: sourceFingerprint(record), quote: 'Built APIs' }],
  } } }).result;
}
it('selects evidence without requiring a resume, runner or renderer and records source versions', () => {
  const selection = selectJobSkillset(corpus.read());
  expect(selection.evidence.map(record => record.id)).toEqual(['api']);
  expect(selection.knowledge.materialized?.support).toEqual([]);
  expect(selection.provenance.sources[0]).toEqual({ evidence_id: 'api', source_fingerprint: sourceFingerprint(selection.evidence[0]), effective_fingerprint: sourceFingerprint(selection.evidence[0]) });
  expect(selection.fingerprint).toMatch(/^[a-f0-9]{64}$/);
  expect(fs.readFileSync(ledger, 'utf8')).toBe(bytes);
});
it.each(['direct', 'transferable', 'unsupported'] as const)('retains saved %s support without upgrading it and respects scope and selection', kind => {
  remember(kind);
  expect(selectJobSkillset(corpus.read()).provenance.support).toEqual([]);
  const view = corpus.read({ role: 'Backend Engineer' });
  expect(selectJobSkillset(view).provenance.support[0].support).toBe(kind);
  expect(selectJobSkillset(view, []).provenance.support).toEqual([]);
  expect(selectJobSkillset(view, []).evidence).toEqual([]);
});
it('rejects unknown and duplicate source selections rather than substituting all sources', () => {
  const view = corpus.read();
  expect(() => selectJobSkillset(view, ['missing'])).toThrow('Unknown evidence');
  expect(() => selectJobSkillset(view, ['api', 'api'])).toThrow('only once');
});
it('changes identity on source edits and preserves prior capture', () => {
  remember();
  const before = selectJobSkillset(corpus.read({ role: 'Backend Engineer' }));
  fs.writeFileSync(ledger, bytes.replace('Built APIs and authentication.', 'Built interfaces.'));
  const after = selectJobSkillset(corpus.read({ role: 'Backend Engineer' }));
  expect(after.fingerprint).not.toBe(before.fingerprint);
  expect(after.provenance.support).toEqual([]);
  expect(before.provenance.support).toHaveLength(1);
});
it('withdraws future support without rewriting the captured knowledge', () => {
  const update = remember();
  const before = selectJobSkillset(corpus.read({ role: 'Backend Engineer' }));
  corpus.withdraw({ workspace_id: database.workspaceId, expected_revision: 1, idempotency_key: 'withdraw', supersedes: null, explanation: 'Withdraw synthetic support', change: { kind: 'withdrawal', update_id: update.id, reason: 'Correction' } });
  const after = selectJobSkillset(corpus.read({ role: 'Backend Engineer' }));
  expect(after.fingerprint).not.toBe(before.fingerprint);
  expect(after.knowledge.materialized?.support).toEqual([]);
  expect(before.knowledge.materialized?.support).toHaveLength(1);
  expect(after.knowledge.updates).toHaveLength(2);
});
it('fails closed when a selected record has no raw source provenance', () => {
  const view = corpus.read();
  expect(() => selectJobSkillset({ ...view, records: [] })).toThrow('no source provenance');
});
it('does not carry saved support forward after source retraction', () => {
  remember();
  const before = selectJobSkillset(corpus.read({ role: 'Backend Engineer' }));
  fs.writeFileSync(ledger, bytes.replace('confidence: verified', 'confidence: retracted'));
  const after = selectJobSkillset(corpus.read({ role: 'Backend Engineer' }));
  expect(after.provenance.support).toEqual([]);
  expect(after.fingerprint).not.toBe(before.fingerprint);
  expect(after.evidence[0].confidence).toBe('retracted');
});
