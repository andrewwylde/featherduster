import type { PreparationPolicy } from './schemas.js';

export interface AutomaticUsage { calls: number; repairs: number; retries: number; elapsed_ms: number }
/** Reserve before dispatch. The durable caller owns persistence and operation receipts. */
export function reserveAutomaticOperation(policy: Pick<PreparationPolicy, 'max_model_calls' | 'max_repair_attempts' | 'timeout_ms'>,
  usage: AutomaticUsage, operation: 'model' | 'repair' | 'retry'): AutomaticUsage {
  const next = { ...usage, calls: usage.calls + 1,
    repairs: usage.repairs + Number(operation === 'repair'), retries: usage.retries + Number(operation === 'retry') };
  if (Object.values(next).some(n => !Number.isSafeInteger(n) || n < 0) || next.calls > policy.max_model_calls
    || next.repairs > Math.min(2, policy.max_repair_attempts) || next.retries > 1 || next.elapsed_ms >= policy.timeout_ms)
    throw new Error('Automatic preparation budget exhausted; explicitly retry or review inputs.');
  return next;
}
export interface OriginalTarget { work_id: string; text: string }
/** Never interpret a rendered bullet index as an original-base index. */
export function resolveOriginalTarget(targets: OriginalTarget[], anchor: OriginalTarget): number | null {
  const found = targets.flatMap((target, i) => target.work_id === anchor.work_id && target.text === anchor.text ? [i] : []);
  return found.length === 1 ? found[0] : null;
}
export interface AutomaticRepairFinding {
  kind: 'qualifier' | 'mechanical' | 'omission' | 'uncertain' | 'conflict' | 'outage';
  before: string; after: string; supported: boolean; unique_content_removed: boolean; conflict: boolean;
}
/** Eligibility is not factual verification: repaired output must still pass the normal checks. */
export function automaticRepairDecision(finding: AutomaticRepairFinding): 'repair' | 'question' | 'technical' {
  if (finding.kind === 'outage') return 'technical';
  if (finding.conflict || finding.unique_content_removed || !finding.supported || !finding.after.trim()
    || !['qualifier', 'mechanical'].includes(finding.kind)) return 'question';
  return 'repair';
}
