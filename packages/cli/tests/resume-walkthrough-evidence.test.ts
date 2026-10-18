import { execFileSync } from 'node:child_process';
import { expect, it } from 'vitest';

function evaluate(expression: string) {
  const script = `import { currentIdentity, captureManifest } from './scripts/resume-finalization-evidence.mjs';
    console.log(JSON.stringify(${expression}));`;
  return JSON.parse(execFileSync(process.execPath, ['--input-type=module', '-e', script], { encoding: 'utf8' }));
}

it('emits exactly the CurrentIdentity keys with stable identities from observed bytes and outcomes', () => {
  const values = evaluate(`[
    currentIdentity({ '/': 'html', '/app.js': 'bytes' }, { job: 'job', revision: 2 }),
    currentIdentity({ '/app.js': 'bytes', '/': 'html' }, { revision: 2, job: 'job' }),
    currentIdentity({ '/': 'html', '/app.js': 'changed' }, { job: 'job', revision: 2 }),
    currentIdentity({ '/': 'html', '/app.js': 'bytes' }, { job: 'job', revision: 3 })
  ]`);
  expect(Object.keys(values[0]).sort()).toEqual(['outcome_identity', 'served_build_identity']);
  expect(values[0]).toEqual(values[1]);
  expect(values[2].served_build_identity).not.toBe(values[0].served_build_identity);
  expect(values[2].outcome_identity).toBe(values[0].outcome_identity);
  expect(values[3].outcome_identity).not.toBe(values[0].outcome_identity);
});

it('emits only CaptureManifest fields, referencing screenshot, trace and state evidence', () => {
  const manifest = evaluate(`captureManifest(currentIdentity({ '/app.js': 'bytes' }, { revision: 2 }),
    ['ready-desktop', 'pending-and-reactive', 'narrow-and-intake'],
    [{ path: 'resume.png', kind: 'screenshot' }, { path: 'trace.zip', kind: 'trace' }, { path: 'capture-state.json', kind: 'state' }])`);
  expect(Object.keys(manifest).sort()).toEqual(['artifacts', 'identity_method', 'observation', 'outcome_identity', 'scenario_ids', 'served_build_identity']);
  expect(manifest.scenario_ids).toHaveLength(3);
  expect(manifest.artifacts).toEqual([
    { path: 'resume.png', kind: 'screenshot' }, { path: 'trace.zip', kind: 'trace' }, { path: 'capture-state.json', kind: 'state' },
  ]);
  expect(manifest.identity_method).toMatch(/persisted/);
  expect(manifest.observation).toMatch(/375/);
});

it('extracts original Playwright action and network records as plain text', () => {
  const script = `import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path';
    import { execFileSync } from 'node:child_process';
    import { evidenceSnapshot, extractReadableTrace, runObservedCommand } from './scripts/resume-finalization-inspection.mjs';
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'resume-inspection-test-'));
    try {
      const zip = path.join(dir, 'trace.zip');
      const response = { status: 200, content: { mimeType: 'application/json', _file: 'resources/body.json' } };
      const network = { type: 'resource-snapshot', snapshot: { request: { url: 'http://fixture/api/jobs/x', method: 'GET' }, response } };
      execFileSync('python', ['-c', "import zipfile,sys; z=zipfile.ZipFile(sys.argv[1],'w'); z.writestr('0.trace',sys.argv[2]); z.writestr('0.network',sys.argv[3]); z.writestr('resources/body.json',sys.argv[4]); z.close()", zip, JSON.stringify({ type: 'before', method: 'press' }), JSON.stringify(network), JSON.stringify({ archived: 'actual response body' })]);
      const extracted = extractReadableTrace(zip, dir);
      const api = fs.readFileSync(path.join(dir, 'trace-api.jsonl'), 'utf8');
      const before = evidenceSnapshot(dir);
      const command = await runObservedCommand([process.execPath, '-e', 'console.log(42)'], process.cwd());
      const unchanged = JSON.stringify(before) === JSON.stringify(evidenceSnapshot(dir));
      console.log(JSON.stringify({ extracted, api, action: fs.readFileSync(path.join(dir, 'trace-actions.jsonl'), 'utf8'), command, unchanged }));
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }`;
  const result = JSON.parse(execFileSync(process.execPath, ['--input-type=module', '-e', script], { encoding: 'utf8' }));
  expect(result.extracted.actions).toBe(1);
  expect(JSON.parse(result.action)).toEqual({ type: 'before', method: 'press' });
  expect(JSON.parse(result.api).response).toEqual({ archived: 'actual response body' });
  expect(result.command.exit_code).toBe(0);
  expect(result.command.stdout.trim()).toBe('42');
  expect(result.unchanged).toBe(true);
});
