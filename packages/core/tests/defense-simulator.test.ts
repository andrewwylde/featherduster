import { describe, it, expect } from 'vitest';
import {
  generateDefenseQuestions,
  evaluateDefenseAnswer,
} from '../src/index';

describe('Interview Defense Simulator', () => {
  const sampleEntry = {
    title: 'Zero-Downtime Partition Sharding',
    impact: 'Reduced p99 tail latency from 850ms to 42ms across 14M accounts.',
    summary: 'Architected dynamic consistent hashing controller eliminating partition hotspots.',
    metrics: [
      { name: 'latency reduction', value: '42ms', status: 'verified' },
      { name: 'tenants', value: '14M', status: 'verified' },
    ],
    themes: ['distributed', 'database', 'performance'],
  };

  it('generates 4 probing defense questions across attribution, metrics, trade-offs, and failure modes', () => {
    const questions = generateDefenseQuestions(sampleEntry);
    expect(questions).toHaveLength(4);

    const types = questions.map((q) => q.type);
    expect(types).toContain('attribution');
    expect(types).toContain('metrics');
    expect(types).toContain('tradeoffs');
    expect(types).toContain('failure_modes');

    expect(questions[0].prompt).toContain('Zero-Downtime Partition Sharding');
    expect(questions[1].prompt).toContain('850ms to 42ms');
  });

  it('evaluates a strong, metric-backed, trade-off rich defense response as defensible', () => {
    const strongAnswer = `
I personally designed the consistent hashing ring and implemented the virtual node controller in Go.
While the existing infra team managed Kafka broker provisioning, I wrote the rebalancing algorithm.
To verify the outcome, we isolated canary clusters and ran flamegraph profiling before and after.
The primary trade-off was memory overhead versus lookup speed: virtual nodes increased RAM usage by 15%,
but eliminated partition hotspots and dropped our p99 tail latency from 850ms down to 42ms for 14M users.
`.trim();

    const evaluation = evaluateDefenseAnswer(strongAnswer, sampleEntry);
    expect(evaluation.score).toBeGreaterThanOrEqual(75);
    expect(evaluation.verdict).toBe('defensible');
    expect(evaluation.groundedMetrics).toContain('42ms');
    expect(evaluation.flaggedSlop).toHaveLength(0);
    expect(evaluation.strengths.length).toBeGreaterThan(0);
  });

  it('flags empty corporate slop and buzzwords in a vague answer', () => {
    const sloppyAnswer = `
Needless to say, in today's fast-paced digital landscape, I spearheaded cross-functional synergies
to foster alignment across key stakeholders. It's worth noting that we unlocked transformative value
and delved into cutting-edge paradigms to revolutionize our offerings.
`.trim();

    const evaluation = evaluateDefenseAnswer(sloppyAnswer, sampleEntry);
    expect(evaluation.verdict).toBe('unprepared');
    expect(evaluation.flaggedSlop.length).toBeGreaterThan(0);
    expect(evaluation.groundedMetrics).toHaveLength(0);
    expect(evaluation.improvements.some((i) => i.includes('buzzword'))).toBe(true);
  });

  it('returns unprepared for very short responses', () => {
    const shortAnswer = 'I wrote the code.';
    const evaluation = evaluateDefenseAnswer(shortAnswer, sampleEntry);
    expect(evaluation.verdict).toBe('unprepared');
    expect(evaluation.score).toBe(0);
    expect(evaluation.improvements.some((i) => i.includes('too brief'))).toBe(true);
  });

  it('penalizes missing trade-offs when answering a trade-off specific question', () => {
    const question = generateDefenseQuestions(sampleEntry).find((q) => q.type === 'tradeoffs')!;
    const answerWithoutTradeoffs = `
I wrote the algorithm and deployed it to production. It worked perfectly and there were no issues at all.
We measured 42ms latency and 14M accounts had faster responses.
`.trim();

    const evaluation = evaluateDefenseAnswer(answerWithoutTradeoffs, sampleEntry, question);
    expect(evaluation.improvements.some((i) => i.includes('trade-off'))).toBe(true);
  });
});
