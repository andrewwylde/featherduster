import { auditSlop, SlopMatch } from './deslop-engine.js';

export type DefenseQuestionType = 'attribution' | 'tradeoffs' | 'metrics' | 'failure_modes';

export interface DefenseQuestion {
  id: string;
  type: DefenseQuestionType;
  interviewerRole: string;
  prompt: string;
  context: string;
}

export interface DefenseEvaluation {
  score: number; // 0 to 100
  verdict: 'defensible' | 'vulnerable' | 'unprepared';
  groundedMetrics: string[];
  flaggedSlop: string[];
  strengths: string[];
  improvements: string[];
}

export interface EntryInput {
  title: string;
  impact?: string;
  summary?: string;
  metrics?: Array<{ name: string; value: string; status?: string }>;
  themes?: string[];
}

/**
 * Generates targeted, skeptical interview defense questions for an evidence entry.
 * Simulates a Staff+ or Engineering Director probing for authentic ownership.
 */
export function generateDefenseQuestions(entry: EntryInput): DefenseQuestion[] {
  const questions: DefenseQuestion[] = [];
  const title = entry.title || 'this accomplishment';
  const impact = entry.impact || entry.summary || 'the reported production outcome';

  // 1. Attribution & Scope
  questions.push({
    id: 'attribution',
    type: 'attribution',
    interviewerRole: 'Staff Systems Interviewer',
    prompt: `On "${title}", what was your specific individual engineering contribution versus what was delivered by other team members or existing infrastructure?`,
    context: `Claims in resume must clearly separate personal architecture/implementation from group achievements.`,
  });

  // 2. Metrics & Isolation
  questions.push({
    id: 'metrics',
    type: 'metrics',
    interviewerRole: 'VP of Engineering',
    prompt: `You cited: "${impact}". How did you isolate and measure that exact metric in production, and how do you know other concurrent deployments didn't skew the results?`,
    context: `Tests whether numbers are grounded in telemetry or fabricated ballpark estimates.`,
  });

  // 3. Architectural Trade-offs
  questions.push({
    id: 'tradeoffs',
    type: 'tradeoffs',
    interviewerRole: 'Principal Architect',
    prompt: `What alternative designs or architectures did you consider before settling on this solution, and what specific trade-offs (e.g. latency vs consistency, complexity vs operational burden) did you knowingly accept?`,
    context: `Elite engineers justify choices via trade-offs rather than presenting their solution as an obvious silver bullet.`,
  });

  // 4. Failure Modes & Edge Cases
  questions.push({
    id: 'failure_modes',
    type: 'failure_modes',
    interviewerRole: 'Reliability & SRE Lead',
    prompt: `Under peak load, network partition, or partial system failure, what is the weakest link in this design, and what telemetry would trigger your rollback?`,
    context: `Verifies end-to-end operational rigor and disaster preparedness.`,
  });

  return questions;
}

/**
 * Evaluates a candidate's verbal defense response against evidence grounding,
 * technical precision, anti-slop rules, and trade-off depth.
 */
export function evaluateDefenseAnswer(
  answer: string,
  entry: EntryInput,
  question?: DefenseQuestion,
): DefenseEvaluation {
  const trimmed = answer.trim();

  // Empty or negligible response
  if (!trimmed || trimmed.split(/\s+/).length < 5) {
    return {
      score: 0,
      verdict: 'unprepared',
      groundedMetrics: [],
      flaggedSlop: [],
      strengths: [],
      improvements: [
        'Response is too brief. Provide a structured answer explaining context, action, trade-offs, and metrics.',
      ],
    };
  }

  const strengths: string[] = [];
  const improvements: string[] = [];
  let score = 50; // Baseline starting score

  // 1. Slop & Fluff Audit
  const slopAudit = auditSlop(trimmed);
  const flaggedSlop = slopAudit.matches.map((m: SlopMatch) => m.matchedText);

  if (slopAudit.isClean) {
    score += 15;
    strengths.push('Clean, direct tone with zero corporate fluff or hollow buzzwords.');
  } else {
    score -= Math.min(25, slopAudit.matches.length * 5);
    improvements.push(
      `Flagged ${slopAudit.matches.length} buzzword/filler pattern(s) (${flaggedSlop.slice(0, 3).join(', ')}). Speak in concrete engineering verbs instead.`,
    );
  }

  // 2. Metric and Quantitative Grounding
  const metricRegex = /\b(\d+(?:\.\d+)?(?:\s*(?:%|ms|s|gb|tb|mb|req\/s|rps|qps|k|m|million|billion|nodes|shards|instances|users))\b|\$\d+)/gi;
  const numbersFound = Array.from(trimmed.matchAll(metricRegex)).map((m) => m[0]);
  const groundedMetrics = Array.from(new Set(numbersFound));

  if (groundedMetrics.length > 0) {
    score += Math.min(20, groundedMetrics.length * 7);
    strengths.push(`Cited concrete telemetry metrics: ${groundedMetrics.slice(0, 3).join(', ')}.`);
  } else {
    score -= 10;
    improvements.push('No quantitative metrics cited. Back your claims with concrete numbers (latency ms, %, QPS, or scale).');
  }

  // 3. Technical Mechanism & Architectural Depth
  const technicalTerms = [
    'partition', 'shard', 'index', 'replica', 'cache', 'profiling', 'flamegraph', 'bottleneck',
    'concurrency', 'mutex', 'lock', 'event loop', 'queue', 'kafka', 'postgres', 'redis',
    'memory', 'cpu', 'heap', 'io', 'throughput', 'p99', 'canary', 'circuit breaker',
  ];
  const techFound = technicalTerms.filter((term) => new RegExp(`\\b${term}\\b`, 'i').test(trimmed));

  if (techFound.length >= 2) {
    score += 15;
    strengths.push(`Demonstrated technical depth mentioning key mechanisms: ${techFound.slice(0, 4).join(', ')}.`);
  } else {
    score -= 5;
    improvements.push('Mention specific engineering mechanisms (data structures, protocols, profiling tools) rather than high-level statements.');
  }

  // 4. Trade-off & Decision Justification
  const tradeoffTerms = [
    'trade-off', 'tradeoff', 'latency vs', 'throughput vs', 'consistency', 'alternative',
    'evaluated', 'compromise', 'cost', 'overhead', 'complexity', 'rather than', 'instead of',
  ];
  const hasTradeoff = tradeoffTerms.some((t) => trimmed.toLowerCase().includes(t));

  if (hasTradeoff) {
    score += 15;
    strengths.push('Articulated explicit engineering trade-offs and decision criteria.');
  } else if (question?.type === 'tradeoffs') {
    score -= 15;
    improvements.push('Direct question about trade-offs was not addressed. Explicitly compare two options and why you chose one over the other.');
  }

  // Clamp score
  score = Math.max(0, Math.min(100, Math.round(score)));

  let verdict: 'defensible' | 'vulnerable' | 'unprepared' = 'unprepared';
  if (score >= 75) {
    verdict = 'defensible';
  } else if (score >= 50) {
    verdict = 'vulnerable';
  }

  return {
    score,
    verdict,
    groundedMetrics,
    flaggedSlop,
    strengths,
    improvements,
  };
}
