import { expect, it } from 'vitest';
import { JobSchema } from '../src/jobs/schemas.js';
import { RunDraftPayloadSchema } from '../src/tailoring/drafts.js';

it('rejects an oversized persisted capture collection before walking its elements', () => {
  let visited = 0;
  const attempts = Array.from({ length: 3 }, () => ({
    get method() { visited++; return 'http'; }, outcome: 'failed', code: 'http_error',
  }));
  const result = JobSchema.shape.capture_attempts.safeParse(attempts);
  expect(result.success).toBe(false);
  if (!result.success) expect(result.error.issues).toEqual([expect.objectContaining({ code: 'too_big', path: [] })]);
  expect(visited).toBe(0);
});

it('preserves omitted saved-run defaults after the validation-library upgrade', () => {
  expect(RunDraftPayloadSchema.parse({})).toEqual({ proposalTextById: {}, artifactTokens: {} });
});
