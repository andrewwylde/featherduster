/**
 * @vitest-environment jsdom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { sseClient } from '../src/api/events';

describe('sseClient singleton', () => {
  let mockEventSourceInstances: any[] = [];

  beforeEach(() => {
    mockEventSourceInstances = [];
    sseClient.resetForTesting();

    (global as any).EventSource = vi.fn().mockImplementation(() => {
      const listeners: Record<string, ((...args: any[]) => void)[]> = {};
      const instance = {
        addEventListener: vi.fn((event: string, cb: (...args: any[]) => void) => {
          listeners[event] = listeners[event] || [];
          listeners[event].push(cb);
        }),
        removeEventListener: vi.fn(),
        close: vi.fn(),
        emit(event: string, data: any) {
          if (listeners[event]) {
            listeners[event].forEach((cb) => cb(data));
          }
        },
      };
      mockEventSourceInstances.push(instance);
      return instance;
    });
  });

  afterEach(() => {
    sseClient.resetForTesting();
    vi.restoreAllMocks();
  });

  it('shares a single EventSource connection across multiple subscribers', () => {
    const changeHandler1 = vi.fn();
    const changeHandler2 = vi.fn();

    const unsub1 = sseClient.onChange(changeHandler1);
    const unsub2 = sseClient.onChange(changeHandler2);

    expect(global.EventSource).toHaveBeenCalledTimes(1);
    expect(mockEventSourceInstances.length).toBe(1);

    const source = mockEventSourceInstances[0];
    source.emit('change', { data: JSON.stringify({ type: 'change', relativePath: 'test.md' }) });

    expect(changeHandler1).toHaveBeenCalledWith({ type: 'change', relativePath: 'test.md' });
    expect(changeHandler2).toHaveBeenCalledWith({ type: 'change', relativePath: 'test.md' });

    unsub1();
    unsub2();
  });

  it('notifies status subscribers of connection state changes', () => {
    const statusHandler = vi.fn();
    const unsub = sseClient.onStatus(statusHandler);

    expect(statusHandler).toHaveBeenCalledWith(false);

    const source = mockEventSourceInstances[0];
    source.emit('connected', {});
    expect(statusHandler).toHaveBeenCalledWith(true);

    unsub();
  });
  it('shares and releases the named jobs stream without delivering it to other listeners', () => {
    vi.useFakeTimers();
    const jobs = vi.fn(); const change = vi.fn();
    const offJobs = sseClient.onJobs(jobs); const offChange = sseClient.onChange(change);
    expect(global.EventSource).toHaveBeenCalledTimes(1);
    const source = mockEventSourceInstances[0];
    source.emit('jobs', { data: JSON.stringify({ job_id: 'job', payload: { kind: 'resume_review' } }) });
    expect(jobs).toHaveBeenCalledWith({ job_id: 'job', payload: { kind: 'resume_review' } });
    expect(change).not.toHaveBeenCalled();
    offChange(); vi.advanceTimersByTime(5000); expect(source.close).not.toHaveBeenCalled();
    offJobs(); vi.advanceTimersByTime(5000); expect(source.close).toHaveBeenCalledOnce();
    vi.useRealTimers();
  });

});
