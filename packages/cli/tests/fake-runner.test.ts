import { describe, it, expect, beforeEach, vi } from 'vitest';
import { FakeRunner, type FakeResponse } from '../src/runners/fake.js';
import { RunnerError, abortError, type RunnerRequest } from '../src/runners/types.js';

describe('FakeRunner', () => {
  let runner: FakeRunner;
  let mockOnProgress: ReturnType<typeof vi.fn>;
  let mockAbortController: AbortController;

  beforeEach(() => {
    mockOnProgress = vi.fn();
    mockAbortController = new AbortController();
  });

  const createRunnerRequest = (overrides?: Partial<RunnerRequest>): RunnerRequest => ({
    schema: 'test-schema',
    prompt: 'test prompt',
    signal: mockAbortController.signal,
    onProgress: mockOnProgress,
    ...overrides,
  });

  describe('initialization', () => {
    it('creates a FakeRunner with default options', () => {
      runner = new FakeRunner();
      expect(runner.id).toBe('fake');
      expect(runner.label).toBe('Fake (test)');
      expect(runner.model).toBe('fake');
      expect(runner.locality).toBe('cloud');
    });

    it('accepts custom responses in constructor', () => {
      const responses: FakeResponse[] = [{ data: 'first' }, { data: 'second' }];
      runner = new FakeRunner(responses);
      expect(runner).toBeTruthy();
    });

    it('accepts custom locality', () => {
      runner = new FakeRunner([], { locality: 'local' });
      expect(runner.locality).toBe('local');
    });

    it('accepts custom delayMs', () => {
      runner = new FakeRunner([], { delayMs: 100 });
      expect(runner).toBeTruthy();
    });

    it('accepts fallback response', () => {
      runner = new FakeRunner([], { fallback: { data: 'fallback' } });
      expect(runner).toBeTruthy();
    });
  });

  describe('detect', () => {
    it('returns available=true', async () => {
      runner = new FakeRunner();
      const detection = await runner.detect();
      expect(detection.available).toBe(true);
      expect(detection.detail).toContain('Fake runner');
    });
  });

  describe('run', () => {
    it('returns static response from queue', async () => {
      const response = { result: 'success' };
      runner = new FakeRunner([response]);
      const request = createRunnerRequest();
      const result = await runner.run(request);
      expect(result).toEqual(response);
    });

    it('consumes responses in order', async () => {
      const response1 = { id: 1 };
      const response2 = { id: 2 };
      runner = new FakeRunner([response1, response2]);

      const req1 = createRunnerRequest();
      const req2 = createRunnerRequest();

      const result1 = await runner.run(req1);
      const result2 = await runner.run(req2);

      expect(result1).toEqual(response1);
      expect(result2).toEqual(response2);
    });

    it('calls function response with request', async () => {
      const responseFunc: FakeResponse = (req) => ({ prompt: req.prompt });
      runner = new FakeRunner([responseFunc]);

      const request = createRunnerRequest({ prompt: 'my prompt' });
      const result = (await runner.run(request)) as any;

      expect(result.prompt).toBe('my prompt');
    });

    it('supports async function responses', async () => {
      const responseFunc: FakeResponse = async (req) => {
        return new Promise((resolve) => {
          setTimeout(() => resolve({ prompt: req.prompt }), 10);
        });
      };
      runner = new FakeRunner([responseFunc]);

      const request = createRunnerRequest({ prompt: 'async test' });
      const result = (await runner.run(request)) as any;

      expect(result.prompt).toBe('async test');
    });

    it('records all requests', async () => {
      runner = new FakeRunner([{ data: 'response' }]);
      const request = createRunnerRequest({ prompt: 'recorded' });
      await runner.run(request);

      expect(runner.requests).toHaveLength(1);
      expect(runner.requests[0].prompt).toBe('recorded');
    });

    it('calls onProgress with status update', async () => {
      runner = new FakeRunner([{ data: 'test' }]);
      const request = createRunnerRequest();
      await runner.run(request);

      expect(mockOnProgress).toHaveBeenCalledWith(
        expect.objectContaining({
          kind: 'status',
          text: expect.stringContaining('Fake runner'),
        })
      );
    });

    it('throws RunnerError when queue is empty and no fallback', async () => {
      runner = new FakeRunner([]);
      const request = createRunnerRequest();

      await expect(runner.run(request)).rejects.toThrow(RunnerError);
    });

    it('uses fallback response when queue is empty', async () => {
      const fallback = { fallback: true };
      runner = new FakeRunner([], { fallback });

      const request = createRunnerRequest();
      const result = await runner.run(request);

      expect(result).toEqual(fallback);
    });

    it('uses fallback as function', async () => {
      const fallback: FakeResponse = (req) => ({ schema: req.schema });
      runner = new FakeRunner([], { fallback });

      const request = createRunnerRequest({ schema: 'my-schema' });
      const result = (await runner.run(request)) as any;

      expect(result.schema).toBe('my-schema');
    });

    it('respects delayMs', async () => {
      runner = new FakeRunner([{ data: 'test' }], { delayMs: 50 });
      const request = createRunnerRequest();

      const start = Date.now();
      await runner.run(request);
      const elapsed = Date.now() - start;

      expect(elapsed).toBeGreaterThanOrEqual(40); // Allow some variance
    });

    it('propagates errors from response functions', async () => {
      const errorFunc: FakeResponse = () => {
        throw new Error('Response error');
      };
      runner = new FakeRunner([errorFunc]);

      const request = createRunnerRequest();
      await expect(runner.run(request)).rejects.toThrow('Response error');
    });

    it('respects abort signal before starting', async () => {
      runner = new FakeRunner([{ data: 'test' }]);
      mockAbortController.abort();

      const request = createRunnerRequest();
      await expect(runner.run(request)).rejects.toThrow();
    });

    it('respects abort signal during delay', async () => {
      runner = new FakeRunner([{ data: 'test' }], { delayMs: 1000 });
      const request = createRunnerRequest();

      setTimeout(() => mockAbortController.abort(), 50);
      await expect(runner.run(request)).rejects.toThrow();
    });
  });

  describe('enqueue', () => {
    it('adds responses to queue', async () => {
      runner = new FakeRunner([{ id: 1 }]);

      runner.enqueue({ id: 2 });
      runner.enqueue({ id: 3 });

      const req1 = createRunnerRequest();
      const req2 = createRunnerRequest();
      const req3 = createRunnerRequest();

      const result1 = (await runner.run(req1)) as any;
      const result2 = (await runner.run(req2)) as any;
      const result3 = (await runner.run(req3)) as any;

      expect(result1.id).toBe(1);
      expect(result2.id).toBe(2);
      expect(result3.id).toBe(3);
    });

    it('enqueue accepts multiple responses', async () => {
      runner = new FakeRunner();

      runner.enqueue({ a: 1 }, { b: 2 }, { c: 3 });

      const req1 = createRunnerRequest();
      const req2 = createRunnerRequest();
      const req3 = createRunnerRequest();

      const result1 = (await runner.run(req1)) as any;
      const result2 = (await runner.run(req2)) as any;
      const result3 = (await runner.run(req3)) as any;

      expect(result1.a).toBe(1);
      expect(result2.b).toBe(2);
      expect(result3.c).toBe(3);
    });

    it('works with fallback after queue is empty', async () => {
      const fallback = { default: true };
      runner = new FakeRunner([], { fallback });

      runner.enqueue({ first: true });

      const req1 = createRunnerRequest();
      const req2 = createRunnerRequest();

      const result1 = (await runner.run(req1)) as any;
      const result2 = (await runner.run(req2)) as any;

      expect(result1.first).toBe(true);
      expect(result2.default).toBe(true);
    });
  });

  describe('request tracking', () => {
    it('tracks multiple requests', async () => {
      runner = new FakeRunner([{ id: 1 }, { id: 2 }, { id: 3 }]);

      const req1 = createRunnerRequest({ prompt: 'first' });
      const req2 = createRunnerRequest({ prompt: 'second' });
      const req3 = createRunnerRequest({ prompt: 'third' });

      await runner.run(req1);
      await runner.run(req2);
      await runner.run(req3);

      expect(runner.requests).toHaveLength(3);
      expect(runner.requests[0].prompt).toBe('first');
      expect(runner.requests[1].prompt).toBe('second');
      expect(runner.requests[2].prompt).toBe('third');
    });

    it('preserves request details', async () => {
      runner = new FakeRunner([{}]);

      const request = createRunnerRequest({
        schema: 'my-schema',
        prompt: 'my-prompt',
      });

      await runner.run(request);

      expect(runner.requests[0].schema).toBe('my-schema');
      expect(runner.requests[0].prompt).toBe('my-prompt');
    });
  });

  describe('complex scenarios', () => {
    it('handles mixed static and function responses', async () => {
      runner = new FakeRunner([{ static: true }, (req) => ({ schema: req.schema })]);

      const req1 = createRunnerRequest();
      const req2 = createRunnerRequest({ schema: 'custom' });

      const result1 = (await runner.run(req1)) as any;
      const result2 = (await runner.run(req2)) as any;

      expect(result1.static).toBe(true);
      expect(result2.schema).toBe('custom');
    });

    it('simulates a multi-step conversation', async () => {
      const responses: FakeResponse[] = [
        { step: 1, analysis: 'initial' },
        (req) => ({
          step: 2,
          schema: req.schema,
          based_on: req.prompt,
        }),
        { step: 3, complete: true },
      ];
      runner = new FakeRunner(responses);

      const step1 = (await runner.run(createRunnerRequest())) as any;
      const step2 = (await runner.run(createRunnerRequest({ schema: 'align' }))) as any;
      const step3 = (await runner.run(createRunnerRequest())) as any;

      expect(step1.step).toBe(1);
      expect(step2.step).toBe(2);
      expect(step2.schema).toBe('align');
      expect(step3.complete).toBe(true);
    });
  });
});
