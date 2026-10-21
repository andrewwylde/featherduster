// Execute the exact engineering commands outside the browser capture's 600-second budget.
import fs from 'node:fs';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { runObservedCommand } from './resume-finalization-inspection.mjs';
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const canonical = value => JSON.stringify(value);
const store = root => path.join(root, 'adws/adw_data/automatic-resume-engineering');
export function engineeringInputs(root) {
  const listed = execFileSync('git', ['-C', root, 'ls-files', '--cached', '--others', '--exclude-standard', '-z', '--', 'packages', 'scripts'], { encoding: 'utf8' }).split('\0').filter(Boolean);
  for (const name of ['package.json', 'package-lock.json', 'vitest.config.ts', 'tsconfig.json', 'tsconfig.base.json', '.npmrc']) if (fs.existsSync(path.join(root, name))) listed.push(name);
  const files = [...new Set(listed)].filter(name => !name.includes('/dist/') && !name.includes('/node_modules/') && !name.endsWith('.tsbuildinfo')).sort();
  return sha(canonical(files.map(name => [name, sha(fs.readFileSync(path.join(root, name)))])));
}
export function engineeringOutputs(root) {
  const files = {};
  const visit = folder => {
    for (const entry of fs.readdirSync(path.join(root, folder), { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const relative = `${folder}/${entry.name}`;
      if (entry.isDirectory()) visit(relative); else if (entry.isFile()) files[relative] = sha(fs.readFileSync(path.join(root, relative)));
    }
  };
  visit('packages/core/dist'); visit('packages/cli/dist'); return files;
}
export function assertEngineeringReceipt(receipt, current, logs) {
  assert.equal(receipt.schema_version, 1, 'Unsupported engineering receipt');
  assert.equal(receipt.status, 'complete', 'Engineering checks are incomplete or failed');
  assert.equal(receipt.node, current.node, 'Node version changed after engineering checks');
  assert.equal(receipt.input_sha256, current.input_sha256, 'Engineering inputs changed; rerun engineering verification');
  assert.deepEqual(receipt.outputs, current.outputs, 'Build outputs changed; rerun engineering verification');
  assert.deepEqual(receipt.checks.map(check => check.argv), [['npm', 'run', 'build'], ['npm', 'test']], 'Exact build and test commands required');
  for (const check of receipt.checks) {
    assert.equal(check.exit_code, 0, `${check.argv.join(' ')} did not exit zero`);
    assert.ok(logs[check.log]?.length, 'Missing engineering command output');
    assert.equal(sha(logs[check.log]), check.log_sha256, 'Engineering log changed');
  }
}
export function copyCurrentEngineering(root, destination) {
  let pointer;
  try { pointer = JSON.parse(fs.readFileSync(path.join(store(root), 'current.json'), 'utf8')); }
  catch { throw Error('Run node scripts/automatic-resume-engineering.mjs before capture to supply current build/test evidence.'); }
  assert.match(pointer.run, /^[0-9a-f-]{36}$/, 'Invalid engineering run reference');
  const directory = path.join(store(root), pointer.run), receipt = JSON.parse(fs.readFileSync(path.join(directory, 'receipt.json'), 'utf8'));
  assert.equal(receipt.status, 'complete', 'Latest engineering run is incomplete or failed; rerun node scripts/automatic-resume-engineering.mjs');
  const logs = { 'build.log': fs.readFileSync(path.join(directory, 'build.log')), 'tests.log': fs.readFileSync(path.join(directory, 'tests.log')) };
  assertEngineeringReceipt(receipt, { node: process.version, input_sha256: engineeringInputs(root), outputs: engineeringOutputs(root) }, logs);
  fs.mkdirSync(destination, { recursive: true });
  fs.copyFileSync(path.join(directory, 'receipt.json'), path.join(destination, 'receipt.json'));
  for (const [name, bytes] of Object.entries(logs)) fs.writeFileSync(path.join(destination, name), bytes);
  return receipt;
}
export async function verifyEngineering(root = process.cwd()) {
  const run = randomUUID(), directory = path.join(store(root), run); fs.mkdirSync(directory, { recursive: true });
  const receipt = { schema_version: 1, status: 'running', node: process.version, started_at: new Date().toISOString(), input_sha256: engineeringInputs(root), checks: [] };
  const save = () => fs.writeFileSync(path.join(directory, 'receipt.json'), JSON.stringify(receipt, null, 2));
  save(); fs.writeFileSync(path.join(store(root), 'current.json'), JSON.stringify({ run }));
  try {
    for (const [argv, log] of [[['npm', 'run', 'build'], 'build.log'], [['npm', 'test'], 'tests.log']]) {
      const platform = process.platform === 'win32' ? [process.env.ComSpec || 'cmd.exe', '/d', '/s', '/c', argv.join(' ')] : argv;
      console.log(JSON.stringify({ event: 'engineering-start', argv }));
      const started = Date.now(), result = await runObservedCommand(platform, root, 360000);
      const bytes = Buffer.from(`$ ${argv.join(' ')}\nexit: ${result.exit_code}\n--- stdout ---\n${result.stdout}\n--- stderr ---\n${result.stderr}`);
      fs.writeFileSync(path.join(directory, log), bytes);
      receipt.checks.push({ argv, platform_argv: platform, exit_code: result.exit_code, signal: result.signal, duration_ms: Date.now() - started, log, log_sha256: sha(bytes) }); save();
      assert.equal(result.exit_code, 0, `Engineering command failed: ${argv.join(' ')}; see ${path.join(directory, log)}`);
    }
    assert.equal(engineeringInputs(root), receipt.input_sha256, 'Sources changed while engineering checks ran');
    receipt.outputs = engineeringOutputs(root); receipt.status = 'complete'; receipt.completed_at = new Date().toISOString(); save();
    console.log(JSON.stringify({ event: 'engineering-complete', receipt: path.join(directory, 'receipt.json'), input_sha256: receipt.input_sha256 }));
    return receipt;
  } catch (error) { receipt.status = 'failed'; receipt.error = error.message; save(); throw error; }
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await verifyEngineering();
