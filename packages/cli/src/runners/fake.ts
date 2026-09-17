import { abortError, RunnerError, type ModelRunner, type RunnerDetection, type RunnerRequest } from './types.js';

export type FakeResponse = unknown | ((req: RunnerRequest) => unknown | Promise<unknown>);

/**
 * Deterministic runner for tests and the walkthrough. Responses are consumed in
 * order; a function response receives the request. Throwing inside a response
 * function simulates runner failures.
 */
export class FakeRunner implements ModelRunner {
  readonly id = 'fake' as const;
  readonly label = 'Fake (test)';
  readonly model = 'fake';
  readonly locality: 'local' | 'cloud';
  readonly requests: RunnerRequest[] = [];
  private readonly queue: FakeResponse[];
  private readonly delayMs: number;
  private readonly fallback?: FakeResponse;

  constructor(
    responses: FakeResponse[] = [],
    options: { locality?: 'local' | 'cloud'; delayMs?: number; fallback?: FakeResponse } = {}
  ) {
    this.queue = [...responses];
    this.locality = options.locality ?? 'cloud';
    this.delayMs = options.delayMs ?? 0;
    this.fallback = options.fallback;
  }

  enqueue(...responses: FakeResponse[]): void {
    this.queue.push(...responses);
  }

  async detect(): Promise<RunnerDetection> {
    return { available: true, detail: 'Fake runner (FEATHERDUSTER_RUNNER=fake)' };
  }

  async run(req: RunnerRequest): Promise<unknown> {
    this.requests.push(req);
    req.onProgress({ kind: 'status', text: 'Fake runner working…' });
    if (this.delayMs > 0) {
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(resolve, this.delayMs);
        req.signal.addEventListener('abort', () => {
          clearTimeout(timer);
          reject(abortError());
        });
      });
    }
    if (req.signal.aborted) throw abortError();
    if (this.queue.length === 0 && this.fallback === undefined) {
      throw new RunnerError('invalid_output', 'Fake runner has no scripted response.');
    }
    const next = this.queue.length > 0 ? this.queue.shift() : this.fallback;
    return typeof next === 'function' ? await (next as (r: RunnerRequest) => unknown)(req) : next;
  }
}
