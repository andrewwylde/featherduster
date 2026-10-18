import { useCallback, useEffect, useRef, useState } from 'react';
import type { JobDraftCheck, ResumeSpec } from '@featherduster/core';
import { apiClient } from '../../api/client.js';
import { sseClient } from '../../api/events.js';
type Result = { key: string; value?: JobDraftCheck; error?: string };
export function useJobDraftChecks(jobId: string | undefined, draftId: string | undefined, candidate: ResumeSpec, paused = false) {
  const [nonce, setNonce] = useState(0), [result, setResult] = useState<Result | null>(null);
  const identity = JSON.stringify([jobId, draftId, candidate, nonce]);
  const sequence = useRef({ identity, value: 0 });
  if (sequence.current.identity !== identity) sequence.current = { identity, value: sequence.current.value + 1 };
  const key = `${sequence.current.value}:${identity}`;
  const current = useRef({ key, jobId, draftId, candidate, paused });
  current.current = { key, jobId, draftId, candidate, paused };
  const pending = useRef<{ key: string; due: number } | null>(null);
  const running = useRef(false), alive = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout>>();
  const pump = useRef<() => void>(() => {});
  const schedule = () => {
    clearTimeout(timer.current);
    if (!pending.current || !alive.current) return;
    timer.current = setTimeout(() => pump.current(), Math.max(0, pending.current!.due - Date.now()));
  };
  pump.current = () => {
    if (running.current || !alive.current || !pending.current) return;
    const request = current.current;
    if (request.paused || !request.jobId || !request.draftId) { pending.current = null; return; }
    if (pending.current.due > Date.now()) { schedule(); return; }
    pending.current = null; running.current = true;
    apiClient.checkJobDraft(request.jobId, request.draftId, request.candidate).then(value => {
      if (alive.current && current.current.key === request.key && !current.current.paused) setResult({ key: request.key, value });
    }, error => {
      if (alive.current && current.current.key === request.key && !current.current.paused)
        setResult({ key: request.key, error: error instanceof Error ? error.message : 'Checks unavailable.' });
    }).finally(() => { running.current = false; if (alive.current) schedule(); });
  };
  const retry = useCallback(() => setNonce(n => n + 1), []);
  useEffect(() => {
    alive.current = true;
    const focus = () => retry();
    window.addEventListener('focus', focus);
    const offJobs = sseClient.onJobs(event => { if (jobId && event.job_id === jobId) retry(); });
    const offCorpus = sseClient.onCorpus(() => { if (jobId) retry(); });
    return () => { alive.current = false; clearTimeout(timer.current); window.removeEventListener('focus', focus); offJobs(); offCorpus(); };
  }, [retry, jobId]);
  useEffect(() => {
    clearTimeout(timer.current);
    if (!jobId || !draftId || paused) { pending.current = null; return; }
    pending.current = { key, due: Date.now() + 600 }; schedule();
    return () => clearTimeout(timer.current);
  }, [key, jobId, draftId, paused]);
  const active = result?.key === key ? result : null;
  const status = active?.error ? 'unavailable' : active?.value?.status ?? 'checking';
  return { status, ready: !paused && status === 'ready', check: active?.value,
    issues: active?.value?.issues ?? [], error: active?.error, retry };
}
export type JobDraftChecks = ReturnType<typeof useJobDraftChecks>;

