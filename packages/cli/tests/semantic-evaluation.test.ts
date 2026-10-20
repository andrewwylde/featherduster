import { expect, it } from 'vitest';
import { SEMANTIC_CASES, evaluationPassed } from '../src/jobs/semantic-evaluation.js';
it('requires every repetition, clear positive, negative and quotation check', () => {
  const observations = SEMANTIC_CASES.flatMap(([id, , , expected]) => [0, 1, 2].map(repetition => ({
    case_id: id, repetition, expected, actual: expected as string, quotes_valid: true, elapsed_ms: 1,
  })));
  expect(evaluationPassed(observations)).toBe(true);
  expect(evaluationPassed(observations.slice(1))).toBe(false);
  for (const id of ['backend-positive', 'backend-consumer', 'production-prototype']) {
    expect(evaluationPassed(observations.map(o => o.case_id === id && o.repetition === 2
      ? { ...o, actual: o.actual === 'supported' ? 'unavailable' : 'supported' } : o))).toBe(false);
  }
  expect(evaluationPassed(observations.map((o, i) => i ? o : { ...o, quotes_valid: false }))).toBe(false);
});
