import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { test } from 'node:test';
import { waitForReady, stopChild } from './walkthrough-process.mjs';

const child = code => spawn(process.execPath, ['-e', code], { windowsHide: true, stdio: ['ignore', 'ignore', 'ignore', 'ipc'] });
const noListeners = process => {
  for (const event of ['message', 'error', 'exit']) assert.equal(process.listenerCount(event), 0, `${event} listener leaked`);
};

test('startup rejects an exit before readiness and removes listeners', async () => {
  const process = child('process.exit(23)');
  try { await assert.rejects(waitForReady(process), /exited before ready.*code 23/); noListeners(process); }
  finally { await stopChild(process); }
});

test('startup rejects spawn errors and removes listeners', async () => {
  const process = spawn('__missing_featherduster_walkthrough_executable__', [], { windowsHide: true });
  try { await assert.rejects(waitForReady(process), /ENOENT/); noListeners(process); }
  finally { await stopChild(process); }
});

test('startup deadline and forced shutdown settle for an unresponsive child', async () => {
  const process = child('setInterval(() => {}, 1000)');
  try { await assert.rejects(waitForReady(process, 50), /did not become ready/); noListeners(process); }
  finally { await stopChild(process, { timeoutMs: 50 }); }
  noListeners(process);
});

test('shutdown recognizes an already signal-terminated child', async () => {
  const process = child("process.send('ready'); setInterval(() => {}, 1000)");
  try {
    await waitForReady(process); noListeners(process);
    const exit = once(process, 'exit'); process.kill('SIGKILL'); await exit;
    assert.notEqual(process.signalCode, null);
    await stopChild(process); noListeners(process);
  } finally { await stopChild(process); }
});

test('shutdown listens before requesting immediate graceful exit', async () => {
  const process = child("process.on('message', () => process.exit(0)); process.send('ready')");
  try { await waitForReady(process); await stopChild(process); assert.equal(process.exitCode, 0); noListeners(process); }
  finally { await stopChild(process); }
});
