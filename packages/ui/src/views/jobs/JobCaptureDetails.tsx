import type { PostingCaptureAttempt } from '@featherduster/core';

export function JobCaptureDetails({ attempts }: { attempts?: PostingCaptureAttempt[] }) {
  if (!attempts?.length) return null;
  return <details className="text-xs text-slate-500">
    <summary className="cursor-pointer">Capture details</summary>
    <ul className="mt-1 space-y-1">
      {attempts.map((attempt, index) => <li key={index}>
        {attempt.method === 'http' ? 'Direct request' : 'Browser capture'}: {attempt.outcome === 'captured' ? 'captured' : attempt.status ? `HTTP ${attempt.status}` : attempt.code?.replaceAll('_', ' ')}
        {attempt.url && <span className="block break-all">{attempt.url}</span>}
      </li>)}
    </ul>
  </details>;
}
