import { setTimeout, clearTimeout } from 'node:timers';

const exited = child => child.exitCode !== null || child.signalCode !== null;

/** Child startup must settle even if it dies without ever sending IPC readiness. */
export function waitForReady(child, timeoutMs = 15000) {
  return new Promise((resolve, reject) => {
    const cleanup = () => {
      clearTimeout(timer);
      child.off('message', onMessage); child.off('error', onError); child.off('exit', onExit);
    };
    const finish = error => { cleanup(); if (error) reject(error); else resolve(); };
    const onMessage = message => { if (message === 'ready') finish(); };
    const onError = error => finish(error);
    const onExit = (code, signal) => finish(Error(`Walkthrough server exited before ready (code ${code}, signal ${signal})`));
    const timer = setTimeout(() => finish(Error(`Walkthrough server did not become ready within ${timeoutMs}ms`)), timeoutMs);
    child.on('message', onMessage); child.once('error', onError); child.once('exit', onExit);
    if (exited(child)) onExit(child.exitCode, child.signalCode);
  });
}

/** Listen before acting, recognize prior signal exits, and bound graceful cleanup. */
export function stopChild(child, { kill = false, timeoutMs = 5000 } = {}) {
  if (!child || exited(child) || !child.pid) return Promise.resolve();
  return new Promise((resolve, reject) => {
    let timer, forceTimer;
    let settled = false;
    const cleanup = () => {
      clearTimeout(timer); clearTimeout(forceTimer);
      child.off('exit', onExit); child.off('error', onError);
    };
    const finish = error => {
      if (settled) return;
      settled = true; cleanup(); if (error) reject(error); else resolve();
    };
    const onExit = () => finish();
    const onError = error => finish(error);
    const force = () => {
      if (exited(child)) { finish(); return; }
      try { child.kill('SIGKILL'); } catch (error) { finish(error); }
    };
    child.once('exit', onExit); child.once('error', onError);
    // The final deadline remains active after escalation so cleanup cannot hang.
    timer = setTimeout(() => finish(Error('Walkthrough server did not exit after termination')), timeoutMs * 2);
    if (kill || !child.connected) force();
    else {
      forceTimer = setTimeout(force, timeoutMs);
      try { child.send('close', error => { if (error && !settled) force(); }); }
      catch { force(); }
    }
  });
}
