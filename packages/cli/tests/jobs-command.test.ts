import { afterEach, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { cac } from 'cac';
import { runJobsCommand, registerJobsCommand, type JobsCommandDependencies } from '../src/commands/jobs.js';
import { createJobsRuntime } from '../src/jobs/runtime.js';
import { openJobsDatabase } from '../src/jobs/database.js';
import { JobsRepository } from '../src/jobs/repository.js';
import { loadResumeSpecs, loadEvidenceStore, loadPrivacyRules } from '../src/server.js';

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true }); vi.restoreAllMocks(); });
function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'jobs-cmd-')); roots.push(root);
  fs.mkdirSync(path.join(root, 'resumes/templates'), { recursive: true });
  fs.writeFileSync(path.join(root, 'resumes/templates/base.json'), JSON.stringify({ profile: { name: 'Test', title: 'Engineer', email: 'a@b.com' }, experiences: [], education: [], skills: [] }));
  const run = vi.fn(async () => ({ company: '', role: '', seniority: '', mission: '', requirements: [], rows: [], proposals: [] }));
  const dependencies: JobsCommandDependencies = {
    runnerFactory: () => ({ id: 'fake', model: 'fake', label: 'Fake', locality: 'local', detect: async () => ({ available: true, detail: '' }), run }),
    renderer: { preflight: async () => ({ available: true, tools: [], diagnostics: [] }), renderPdf: async () => ({ status: 'passed', source: 'latex', pdf: Buffer.from('pdf'), previews: [{ page: 1, mimeType: 'image/png', bytes: Buffer.from('png') }], report: { passed: true, pageCount: 1, pageBudget: 1, coverage: 1, missingFragments: [], diagnostics: [] }, diagnostics: [] }) },
    fetcher: async url => ({ original_url: url, html: '<html><body>Engineer role</body></html>', final_url: url, retrieved_at: new Date().toISOString() }),
  };
  const command = (action: string, argument?: string, options: Parameters<typeof runJobsCommand>[2] = {}) => runJobsCommand(action, argument, { workspace: root, ...options }, dependencies);
  const add = async () => (await command('add', 'Build systems', { text: true })).result as any;
  const runtime = () => createJobsRuntime(root, { loadResumes: () => loadResumeSpecs(root), loadEvidence: () => loadEvidenceStore(root), loadPrivacyRules: () => loadPrivacyRules(root), ...dependencies, automaticDrain: false });
  return { root, command, add, runtime, run, dependencies };
}
it('supports text/inbox/URL intake, preview, list, get and invalid actions', async () => {
  const f = fixture();
  expect((await f.command('nope')).exitCode).toBe(1);
  expect((await f.command('add', 'Text', { text: true, preview: true })).exitCode).toBe(0);
  expect((await f.command('list')).result).toEqual({ jobs: [] });
  const inbox = path.join(f.root, 'inbox.txt'); fs.writeFileSync(inbox, 'Job posting');
  expect((await f.command('add', undefined, { file: inbox, text: true })).exitCode).toBe(0);
  expect(fs.readFileSync(inbox, 'utf8')).toBe('Job posting');
  expect((await f.command('add', 'other', { file: inbox })).exitCode).toBe(1);
  expect((await f.command('add', 'https://example.com/jobs/one\nbad')).exitCode).toBe(1);
  expect((await f.command('add', 'https://example.com/jobs/one')).exitCode).toBe(0);
  const list: any = (await f.command('list')).result;
  expect(list.jobs).toHaveLength(2);
  expect((await f.command('get', list.jobs[0].id)).exitCode).toBe(0);
  expect((await f.command('get', 'invalid')).exitCode).toBe(1);
  expect((await f.command('list', undefined, { kind: 'invalid' })).exitCode).toBe(1);
  expect(f.run).not.toHaveBeenCalled();
});
it('process limit remains bounded with automatic enable and honors persistent stop', async () => {
  const f = fixture(); await f.add(); await f.add(); await f.add();
  expect((await f.command('start')).exitCode).toBe(0); expect(f.run).not.toHaveBeenCalled();
  expect((await f.command('process', undefined, { limit: 1 })).exitCode).toBe(0);
  expect(f.run).toHaveBeenCalledTimes(4);
  expect((await f.command('stop')).exitCode).toBe(0);
  expect((await f.command('process')).exitCode).toBe(0);
  expect(f.run).toHaveBeenCalledTimes(4);
  const db = openJobsDatabase(f.root);
  try { expect(new JobsRepository(db).getControl().stop_generation).toBe(1); } finally { db.close(); }
  expect((await f.command('process', undefined, { limit: 0 })).exitCode).toBe(1);
});
it('explicit prepare/retry/resume validate revisions and replay without rerunning', async () => {
  const f = fixture(); const id = (await f.add()).items[0].job_id;
  const runtime = f.runtime(); const job = runtime.repository.getJob(id);
  const input = runtime.captureInputs(id, job.revision); await runtime.dispose();
  const options = { expectedRevision: job.revision, inputSnapshot: input.id, idempotencyKey: 'first' };
  expect((await f.command('prepare', id)).exitCode).toBe(1);
  f.run.mockResolvedValueOnce(null as any);
  expect((await f.command('prepare', id, options)).exitCode).toBe(1);
  expect((await f.command('prepare', id, options)).exitCode).toBe(1);
  expect(f.run).toHaveBeenCalledTimes(1);
  const detail: any = (await f.command('get', id)).result;
  expect((await f.command('resume', id, { ...options, expectedRevision: detail.job.revision, idempotencyKey: 'resume' })).exitCode).toBe(1);
  expect((await f.command('retry', id, { ...options, expectedRevision: detail.job.revision, idempotencyKey: 'retry' })).exitCode).toBe(0);
  expect(f.run).toHaveBeenCalledTimes(5);
});
it('imports read-only previews and idempotent historical records without work', async () => {
  const f = fixture(); const file = path.join(f.root, 'old.json');
  fs.writeFileSync(file, JSON.stringify({ jobs: [{ id: 'old-1', company: 'Acme', role: 'Engineer', status: 'applied' }] }));
  const options = { format: 'json', sourceNamespace: 'legacy' };
  expect((await f.command('import', file, { ...options, preview: true })).exitCode).toBe(0);
  expect((await f.command('list')).result).toEqual({ jobs: [] });
  expect((await f.command('import', file, options)).exitCode).toBe(0);
  expect((await f.command('import', file, options)).exitCode).toBe(0);
  expect(((await f.command('list')).result as any).jobs).toHaveLength(1);
  expect(f.run).not.toHaveBeenCalled();
});
it('registers CAC options and prints parseable JSON without starting a server', async () => {
  const f = fixture(); const cli = cac('test'); registerJobsCommand(cli);
  const log = vi.spyOn(console, 'log').mockImplementation(() => {});
  const oldExit = process.exitCode;
  try {
    cli.parse(['node', 'test', 'jobs', 'list', '--workspace', f.root, '--json'], { run: false });
    await cli.runMatchedCommand();
    expect(JSON.parse(String(log.mock.calls[0][0]))).toEqual({ jobs: [] });
    expect(process.exitCode).toBe(0);
    expect(() => cli.parse(['node', 'test', 'jobs', 'list', '--bogus'])).toThrow();
  } finally { process.exitCode = oldExit; }
});
it('closes runtime after errors as well as reads', async () => {
  const f = fixture(); const disposals: ReturnType<typeof vi.spyOn>[] = [];
  f.dependencies.runtimeFactory = (w, d) => { const runtime = createJobsRuntime(w, d); disposals.push(vi.spyOn(runtime, 'dispose')); return runtime; };
  await f.command('list'); await f.command('get', 'bad');
  expect(disposals).toHaveLength(2); for (const dispose of disposals) expect(dispose).toHaveBeenCalledOnce();
});
