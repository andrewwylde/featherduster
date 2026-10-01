import type { DraftBase, RunManifest } from '@featherduster/core';
import type { RunnerFactory } from '../runners/registry.js';
import type { RunnerId } from '../runners/types.js';
import type { TailoringConfig } from './config.js';
import { DraftRepositoryError } from './drafts/errors.js';

export interface CreateRunInput { posting: unknown; base_resume: unknown; runner: unknown; label?: unknown }
/** Validate without filesystem writes or model calls. Allocation belongs to the journal caller. */
export function prepareRun(input: CreateRunInput, base: DraftBase | null, config: TailoringConfig, factory: RunnerFactory, slug: string, now: Date): { manifest: RunManifest; posting: string } {
  const posting = typeof input.posting === 'string' ? input.posting.trim() : '';
  if (posting.length < 20) throw new DraftRepositoryError(400, 'invalid_posting', 'Paste the job posting text (at least 20 characters).');
  if (posting.length > 100_000) throw new DraftRepositoryError(400, 'invalid_posting', 'Job posting is too long (100k character limit).');
  if (!base) throw new DraftRepositoryError(400, 'invalid_base_resume', 'Base resume not found.');
  const runnerId = (typeof input.runner === 'string' && input.runner ? input.runner : config.runner.default) as RunnerId;
  const runner = factory(runnerId, config.runner);
  if (!runner) throw new DraftRepositoryError(400, 'invalid_runner', `Unknown or disabled runner "${runnerId}".`);
  const step = () => ({ status: 'pending' as const, completed_at: null, input_hash: null, error: null, raw_output: null });
  return { posting: posting + '\n', manifest: { slug, title: typeof input.label === 'string' ? input.label.trim() : '', created: now.toISOString(), updated: now.toISOString(), runner: runnerId, model: runner.model, base_resume: base.resumeId, state: 'draft', error: null, finalized_path: null, steps: { analysis: step(), alignment: step(), proposals: step(), brief: step() } } };
}
