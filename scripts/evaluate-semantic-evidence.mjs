import fs from 'node:fs';
import path from 'node:path';
import { loadTailoringConfig } from '../packages/cli/dist/tailoring/config.js';
import { defaultRunnerFactory } from '../packages/cli/dist/runners/registry.js';
import { evaluateSemanticRunner } from '../packages/cli/dist/jobs/semantic-evaluation.js';
import { openJobsDatabase } from '../packages/cli/dist/jobs/database.js';
import { JobsRepository } from '../packages/cli/dist/jobs/repository.js';
import { SemanticRepository } from '../packages/cli/dist/jobs/semantic-repository.js';
const arg = name => { const i = process.argv.indexOf(name); return i < 0 ? undefined : process.argv[i + 1]; };
const workspace = arg('--workspace'), output = arg('--output');
if (!workspace || !output) throw Error('Supply --workspace and --output. --record explicitly enables persistence of the gate.');
const config = loadTailoringConfig(workspace), id = arg('--runner') ?? config.runner.default;
const runner = defaultRunnerFactory(id, config.runner);
if (!runner) throw Error('Configured runner is unavailable.');
if (runner.locality === 'cloud' && !config.runner_consent[id]) throw Error('Existing runner consent is required.');
const detection = await runner.detect();
if (!detection.available) throw Error(detection.detail);
console.log(`Evaluating synthetic fixtures using ${runner.id}/${runner.model}.`);
const report = await evaluateSemanticRunner(runner, Math.min(60000, config.runner.step_timeout_seconds * 1000),
  (completed, total) => console.log(`Completed ${completed}/${total}`));
fs.mkdirSync(path.dirname(path.resolve(output)), { recursive: true });
fs.writeFileSync(output, JSON.stringify(report, null, 2));
if (process.argv.includes('--record')) {
  if (runner.id === 'fake') throw Error('Fake runner reports cannot enable production automatic support.');
  const db = openJobsDatabase(workspace);
  try { new SemanticRepository(new JobsRepository(db)).saveEvaluation(report); } finally { db.close(); }
}
console.log(`Gate ${report.passed ? 'passed' : 'failed'}; report: ${output}`);
process.exitCode = report.passed ? 0 : 1;
