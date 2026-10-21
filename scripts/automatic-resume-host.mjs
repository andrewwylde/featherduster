// Owned disposable host. Capture and later identity probes use this SAME process and origin.
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { Hono } from 'hono';
import { serve } from '@hono/node-server';
import { createApp } from '../packages/cli/dist/server.js';
import { createJobsRuntime, publicJobsResult } from '../packages/cli/dist/jobs/runtime.js';
import { LatexRenderer } from '../packages/cli/dist/render/latex-renderer.js';
import { PdfVerifier } from '../packages/cli/dist/render/pdf-verifier.js';
import { automaticFixtureRunner } from './automatic-resume-fixture.mjs';
const arg = name => process.argv[process.argv.indexOf(name) + 1];
const workspace = arg('--workspace'), stateFile = arg('--state'), token = arg('--token');
if (!workspace || !stateFile || !token || !path.basename(workspace).startsWith('featherduster-automatic-resume-') || !fs.existsSync(path.join(workspace, '.automatic-resume-disposable'))) throw Error('Disposable workspace and explicit host arguments required.');
const poppler = process.env.POPPLER_BIN || (process.platform === 'win32' ? path.join(process.env.LOCALAPPDATA, 'Programs/poppler/Library/bin') : undefined);
const verifier = new PdfVerifier(poppler ? { tools: Object.fromEntries(['pdfinfo', 'pdftotext', 'pdftoppm'].map(name => [name, { command: path.join(poppler, `${name}${process.platform === 'win32' ? '.exe' : ''}`) }])) } : {});
const renderer = new LatexRenderer({ verifier, probeTimeoutMs: 15000 });
const dispatches = [], control = { checkerOffline: false, hold: null, entered: false };
let release;
const runner = automaticFixtureRunner(dispatches, { beforeOperation: async operation => {
  if (control.hold?.caseId === operation.caseId && control.hold?.operation === operation.operation) {
    control.entered = true; await new Promise(resolve => { release = resolve; });
  }
} });
let runtime;
const app = createApp(workspace, { uiDir: path.resolve('packages/cli/dist/ui'), jobsDependencies: { automaticDrain: false, runnerFactory: () => runner,
  renderer: { preflight: (...args) => renderer.preflight(...args), renderPdf: (...args) => {
    if (control.checkerOffline) throw Error('PDF checks temporarily offline (explicit disposable fixture fault injection)');
    return renderer.renderPdf(...args);
  } } }, jobsRuntimeFactory: (root, deps) => runtime = createJobsRuntime(root, deps) });
app.initializeJobs();
const host = new Hono(), instanceId = randomUUID(), startedAt = new Date().toISOString();
let server;
const identity = () => ({ instance_id: instanceId, pid: process.pid, started_at: startedAt, workspace, origin: `http://127.0.0.1:${server.address().port}` });
host.use('/__automatic-resume/*', async (c, next) => c.req.header('x-fixture-token') === token ? next() : c.json({ error: 'Fixture token required' }, 403));
host.get('/__automatic-resume/identity', c => c.json(identity()));
host.get('/__automatic-resume/observations', c => {
  const tables = ['preparation_cycles', 'preparation_operations', 'preparation_repairs', 'preparation_decisions', 'semantic_calls', 'semantic_call_results', 'semantic_clarifications', 'mutation_receipts', 'draft_revisions', 'input_snapshots'];
  return c.json(publicJobsResult({ server: identity(), dispatches, control, corpus_revision: runtime.corpus.repository.snapshot().revision,
    durable: Object.fromEntries(tables.map(table => [table, runtime.repository.database.db.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all()])) }));
});
host.post('/__automatic-resume/control', async c => {
  const request = await c.req.json();
  if (typeof request.checkerOffline === 'boolean') control.checkerOffline = request.checkerOffline;
  if (request.hold) { control.hold = request.hold; control.entered = false; }
  if (request.release) { control.hold = null; release?.(); release = undefined; }
  if (request.shutdown) { setTimeout(close, 50); }
  return c.json({ control, server: identity() });
});
host.all('*', c => app.fetch(c.req.raw));
server = serve({ fetch: host.fetch, hostname: '127.0.0.1', port: 0 });
const diagnostic = detail => console.log(JSON.stringify({ at: new Date().toISOString(), pid: process.pid, ...detail }));
let connectionSequence = 0;
server.on('connection', socket => {
  const id = ++connectionSequence;
  diagnostic({ event: 'connection-open', id });
  socket.on('close', hadError => diagnostic({ event: 'connection-close', id, hadError }));
  socket.on('error', error => diagnostic({ event: 'connection-error', id, code: error.code, message: error.message }));
});
server.on('error', error => diagnostic({ event: 'server-error', code: error.code, message: error.message }));
process.on('uncaughtExceptionMonitor', error => diagnostic({ event: 'uncaught-exception', code: error.code, message: error.message }));
process.on('exit', code => diagnostic({ event: 'exit', code }));
await new Promise((resolve, reject) => { server.once('listening', resolve); server.once('error', reject); });
fs.writeFileSync(stateFile, JSON.stringify({ ...identity(), token }, null, 2));
let closing = false;
async function close() { if (closing) return; closing = true; diagnostic({ event: 'owned-shutdown' }); release?.(); await app.disposeJobs(); server.close(() => process.exit(0)); }
// The independent outcome gate can inspect the original server; no live server is ever restarted.
setTimeout(close, 2 * 60 * 60 * 1000).unref();
process.on('SIGTERM', close); process.on('SIGINT', close);
