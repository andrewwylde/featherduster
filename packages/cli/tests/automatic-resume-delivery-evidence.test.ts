import { expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { assertCapturedServer, requiredOutcomes, assertRequiredOutcomes } from '../../../scripts/automatic-resume-observation.mjs';
import { currentIdentity } from '../../../scripts/resume-finalization-evidence.mjs';
it('keeps the browser evidence entry points syntactically executable', () => {
  for (const script of ['capture-automatic-resume-delivery.mjs', 'automatic-resume-fixture.mjs', 'automatic-resume-host.mjs', 'automatic-resume-observation.mjs', 'automatic-resume-http.mjs', 'automatic-resume-preview.mjs', 'automatic-resume-engineering.mjs']) {
    const result = spawnSync(process.execPath, ['--check', path.resolve('scripts', script)], { encoding: 'utf8' });
    expect(result.status, result.stderr).toBe(0);
  }
});
it('changes observed identity when served assets or persisted outcomes change', () => {
  const assets = { '/': 'real-html-hash', '/app.js': 'served-script-hash' };
  const state = { draft: { revision: 1 }, artifact: { fingerprint: 'pdf-hash' }, approvals: [] };
  const original = currentIdentity(assets, state);
  expect(currentIdentity({ ...assets, '/app.js': 'new-served-script' }, state).served_build_identity).not.toBe(original.served_build_identity);
  expect(currentIdentity(assets, { ...state, draft: { revision: 2 } }).outcome_identity).not.toBe(original.outcome_identity);
});
it('retains both declared scenarios and the disposable-only capture and observation-only probe paths', () => {
  const source = fs.readFileSync(path.resolve('scripts/capture-automatic-resume-delivery.mjs'), 'utf8');
  expect(source).toContain("scenario_ids: ['batch', 'review']");
  expect(source).not.toContain('createApp(');
  expect(source).not.toContain('serve({');
  expect(source).toContain('assertCapturedServer(await api');
  expect(source).toContain('assertRequiredOutcomes(observedNow, state.required)');
  expect(source).toContain("'.automatic-resume-disposable'");
  expect(source).toContain('const current = currentIdentity(await assets(), observedNow)');
});
it('rejects deployment replacement and loss of current approval despite historical approval', () => {
  const server = { origin: 'http://127.0.0.1:49100', pid: 123, instance_id: 'owned-instance', started_at: 'now', workspace: 'fixture' };
  expect(() => assertCapturedServer({ ...server, instance_id: 'replacement' }, server)).toThrow(/continuity/);
  const snapshot = { batch: { queue: [{ job_id: 'a', artifact_id: 'current', artifact_fingerprint: 'hash', approved: true }], counts: { approved: 1 } },
    jobs: [{ job: { id: 'a', application_lifecycle: 'not_started' } }], host: { corpus_revision: 0 } };
  const required = requiredOutcomes(snapshot);
  expect(() => assertRequiredOutcomes(snapshot, required)).not.toThrow();
  expect(() => assertRequiredOutcomes({ ...snapshot, batch: { queue: [], counts: { approved: 0 } }, historicalApprovals: ['current'] }, required)).toThrow(/approval outcome regressed/);
});
