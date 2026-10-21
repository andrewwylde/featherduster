import { expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { assertEngineeringReceipt } from '../../../scripts/automatic-resume-engineering.mjs';
const sha = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');
function fixture() {
  const logs = { 'build.log': Buffer.from('actual command stdout\n'), 'tests.log': Buffer.from('actual test stdout\n') };
  const current = { node: process.version, input_sha256: 'current-source', outputs: { 'packages/cli/dist/ui/index.html': 'built-html' } };
  const receipt = { schema_version: 1, status: 'complete', ...current, checks: [
    { argv: ['npm', 'run', 'build'], exit_code: 0, log: 'build.log', log_sha256: sha(logs['build.log']) },
    { argv: ['npm', 'test'], exit_code: 0, log: 'tests.log', log_sha256: sha(logs['tests.log']) },
  ] };
  return { logs, current, receipt };
}
it('accepts only zero-exit exact commands bound to current source, build outputs and raw logs', () => {
  const f = fixture(); expect(() => assertEngineeringReceipt(f.receipt, f.current, f.logs)).not.toThrow();
  expect(() => assertEngineeringReceipt(f.receipt, { ...f.current, input_sha256: 'edited-source' }, f.logs)).toThrow(/inputs changed/);
  expect(() => assertEngineeringReceipt(f.receipt, { ...f.current, outputs: {} }, f.logs)).toThrow(/outputs changed/);
  expect(() => assertEngineeringReceipt(f.receipt, f.current, { ...f.logs, 'tests.log': Buffer.from('rewritten') })).toThrow(/log changed/);
});
it('rejects failed or incomplete runs rather than finding pass text or using an earlier success', () => {
  const f = fixture();
  expect(() => assertEngineeringReceipt({ ...f.receipt, status: 'running' }, f.current, f.logs)).toThrow(/incomplete or failed/);
  f.receipt.checks[1].exit_code = 1;
  expect(() => assertEngineeringReceipt(f.receipt, f.current, f.logs)).toThrow(/did not exit zero/);
});
