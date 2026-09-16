import { describe, it, expect } from 'vitest';
import {
  detectSlop,
  auditSlop,
  cleanSlop,
  SLOP_RULES,
  SLOP_WEIGHTS,
} from '../src/index';

describe('De-Slop Engine', () => {
  describe('detectSlop - Empty Hedges', () => {
    it('detects "it\'s worth noting that..."', () => {
      const text = "It's worth noting that our system scaled well.";
      const matches = detectSlop(text);
      expect(matches.length).toBeGreaterThanOrEqual(1);
      expect(matches.some((m) => m.type === 'hedge')).toBe(true);
      const match = matches.find((m) => m.type === 'hedge');
      expect(match?.matchedText.toLowerCase()).toContain("it's worth noting");
    });

    it('detects "it is important to remember"', () => {
      const text = 'It is important to remember that memory was constrained.';
      const matches = detectSlop(text);
      expect(matches.some((m) => m.type === 'hedge')).toBe(true);
    });

    it('detects idiom hedges like "needless to say", "that said", and "at the end of the day"', () => {
      const text = 'Needless to say, we succeeded. That said, at the end of the day, latency mattered.';
      const matches = detectSlop(text);
      const hedgeMatches = matches.filter((m) => m.type === 'hedge');
      expect(hedgeMatches.length).toBe(3);
    });
  });

  describe('detectSlop - LLM Lexicon & Copula Inflation', () => {
    it('detects LLM lexicon ("delve into the rich tapestry")', () => {
      const text = 'We delve into the rich tapestry of our distributed architecture.';
      const matches = detectSlop(text);
      expect(matches.some((m) => m.type === 'delve')).toBe(true);
      const delveMatches = matches.filter((m) => m.type === 'delve');
      expect(delveMatches.some((m) => /delve/i.test(m.matchedText))).toBe(true);
      expect(delveMatches.some((m) => /tapestry/i.test(m.matchedText))).toBe(true);
    });

    it('detects significance inflation and copula ("stands as a testament to")', () => {
      const text = 'The new pipeline stands as a testament to our team perseverance.';
      const matches = detectSlop(text);
      expect(matches.some((m) => m.type === 'delve' || m.type === 'copula')).toBe(true);
      expect(matches.some((m) => /testament/i.test(m.matchedText))).toBe(true);
    });

    it('detects "realm of" and "navigating the complex"', () => {
      const text = 'In the realm of cloud computing, navigating the complex nuances is hard.';
      const matches = detectSlop(text);
      const delveMatches = matches.filter((m) => m.type === 'delve');
      expect(delveMatches.length).toBeGreaterThanOrEqual(2);
    });

    it('ignores words inside inline code backticks and fenced code blocks', () => {
      const text = 'Use `delve` to debug Go routines.\n```\nHere is a rich tapestry of code.\n```\nOutside code blocks, we delve into details.';
      const matches = detectSlop(text);
      expect(matches.length).toBe(1);
      expect(matches[0].type).toBe('delve');
      expect(matches[0].line).toBe(5);
    });
  });

  describe('detectSlop - Corporate Buzzword Salad', () => {
    it('detects "spearheaded cross-functional synergies"', () => {
      const text = 'Spearheaded cross-functional synergies to optimize team velocity.';
      const matches = detectSlop(text);
      expect(matches.some((m) => m.type === 'corporate_uplift')).toBe(true);
      const match = matches.find((m) => m.type === 'corporate_uplift');
      expect(match?.matchedText.toLowerCase()).toContain('spearheaded cross-functional synergies');
    });

    it('detects other corporate uplift phrases', () => {
      const text = 'Fostered synergistic alignment and drove a holistic paradigm shift.';
      const matches = detectSlop(text);
      const upliftMatches = matches.filter((m) => m.type === 'corporate_uplift');
      expect(upliftMatches.length).toBe(2);
    });
  });

  describe('detectSlop - Manufactured Stakes', () => {
    it('detects "In today\'s fast-paced digital landscape"', () => {
      const text = "In today's fast-paced digital landscape, uptime is essential.";
      const matches = detectSlop(text);
      expect(matches.some((m) => m.type === 'stakes')).toBe(true);
      const match = matches.find((m) => m.type === 'stakes');
      expect(match?.matchedText.toLowerCase()).toContain("in today's fast-paced digital landscape");
    });

    it('detects "now more than ever" and "stakes have never been higher"', () => {
      const text = 'Now more than ever, the stakes have never been higher for security.';
      const matches = detectSlop(text);
      const stakesMatches = matches.filter((m) => m.type === 'stakes');
      expect(stakesMatches.length).toBe(2);
    });
  });

  describe('detectSlop - Additional Slop Tells', () => {
    it('detects business jargon filler', () => {
      const text = "Let's circle back, double down, and grab the low-hanging fruit.";
      const matches = detectSlop(text);
      const bizMatches = matches.filter((m) => m.type === 'bizjargon');
      expect(bizMatches.length).toBe(3);
    });

    it('detects triadic buzzword triplets', () => {
      const text = 'Built a fast, reliable, and scalable event ingestion system.';
      const matches = detectSlop(text);
      expect(matches.some((m) => m.type === 'triadic')).toBe(true);
    });

    it('detects intensifier fillers', () => {
      const text = 'We literally revamped the codebase and genuinely improved latency.';
      const matches = detectSlop(text);
      const fillers = matches.filter((m) => m.type === 'intensifier_filler');
      expect(fillers.length).toBe(2);
    });

    it('detects assistant sycophancy voice', () => {
      const text = "Great question! As an AI language model, I'd be happy to help.";
      const matches = detectSlop(text);
      const assistant = matches.filter((m) => m.type === 'assistant_voice');
      expect(assistant.length).toBeGreaterThanOrEqual(2);
    });

    it('detects vague quantifiers', () => {
      const text = 'Migrated a wide variety of microservices across a plethora of regions.';
      const matches = detectSlop(text);
      const quant = matches.filter((m) => m.type === 'vague_quantifier');
      expect(quant.length).toBe(2);
    });

    it('detects throat clearing stems', () => {
      const text = 'The uncomfortable truth is, latency was unviable. Make no mistake, we solved it.';
      const matches = detectSlop(text);
      const throat = matches.filter((m) => m.type === 'throat_clearing');
      expect(throat.length).toBe(2);
    });
  });

  describe('auditSlop - Clean Engineering Accomplishments with Metrics', () => {
    it('rates genuine engineering accomplishments with metrics as clean (score 0)', () => {
      const text = 'Reduced p99 latency by 45% using Go connection pooling and gRPC microservices';
      const result = auditSlop(text);
      expect(result.isClean).toBe(true);
      expect(result.score).toBe(0);
      expect(result.slopBand).toBe('clean');
      expect(result.matches).toHaveLength(0);
      expect(result.summary).toContain('Clean');
    });

    it('rates realistic multi-bullet resume accomplishments as clean', () => {
      const bullets = [
        'Scaled Kafka consumer clusters to ingest 4.2M events/sec with zero data loss during peak load.',
        'Migrated monolithic MySQL database to partitioned PostgreSQL on AWS RDS, improving read query throughput by 62%.',
        'Implemented distributed tracing across 48 microservices via OpenTelemetry and Jaeger, cutting incident MTTD from 35m to 6m.',
      ].join('\n');

      const result = auditSlop(bullets);
      expect(result.isClean).toBe(true);
      expect(result.score).toBe(0);
      expect(result.slopBand).toBe('clean');
      expect(result.matches).toHaveLength(0);
    });
  });

  describe('auditSlop - Scoring Bands and Line Tracking', () => {
    it('classifies score 1-2 as low slop band', () => {
      const text = "It's worth noting that the database ran on Linux.";
      const result = auditSlop(text);
      expect(result.isClean).toBe(false);
      expect(result.score).toBe(SLOP_WEIGHTS.hedge);
      expect(result.slopBand).toBe('low');
    });

    it('classifies score 3-5 as moderate slop band', () => {
      const text = 'Spearheaded cross-functional synergies for the team.';
      const result = auditSlop(text);
      expect(result.isClean).toBe(false);
      expect(result.score).toBe(SLOP_WEIGHTS.corporate_uplift);
      expect(result.slopBand).toBe('moderate');
    });

    it('classifies score > 5 as high slop band', () => {
      const text = "In today's fast-paced digital landscape, spearheaded cross-functional synergies to delve into the rich tapestry.";
      const result = auditSlop(text);
      expect(result.isClean).toBe(false);
      expect(result.score).toBeGreaterThan(5);
      expect(result.slopBand).toBe('high');
      expect(result.summary).toContain('high');
    });

    it('accurately tracks 1-based line numbers across multi-line text', () => {
      const text = [
        'Clean engineering line 1.',
        "It's worth noting that line 2 has a hedge.",
        'Clean engineering line 3.',
        'Spearheaded cross-functional synergies on line 4.',
      ].join('\n');

      const result = auditSlop(text);
      expect(result.matches).toHaveLength(2);
      expect(result.matches[0].line).toBe(2);
      expect(result.matches[1].line).toBe(4);
    });
  });

  describe('cleanSlop - Deterministic Tightening and Claim Preservation', () => {
    it('cleans empty hedge stems while preserving engineering claims and metrics', () => {
      const input = "It's worth noting that we reduced p99 latency by 45% using Go connection pooling and gRPC microservices.";
      const { cleanedText, fixesApplied } = cleanSlop(input);

      expect(cleanedText).toBe('We reduced p99 latency by 45% using Go connection pooling and gRPC microservices.');
      expect(fixesApplied.length).toBeGreaterThanOrEqual(1);
      expect(fixesApplied[0]).toContain('Stripped empty hedge');
    });

    it('cleans bullet points with leading hedge stems and preserves bullet formatting', () => {
      const input = "- It's worth noting that we scaled the ingestion pipeline to 10M events/day.";
      const { cleanedText, fixesApplied } = cleanSlop(input);

      expect(cleanedText).toBe('- We scaled the ingestion pipeline to 10M events/day.');
      expect(fixesApplied.length).toBe(1);
    });

    it('cleans throat-clearing stems while preserving metrics', () => {
      const input = 'Make no mistake, this reduced cloud infrastructure costs by $50,000 annually.';
      const { cleanedText, fixesApplied } = cleanSlop(input);

      expect(cleanedText).toBe('This reduced cloud infrastructure costs by $50,000 annually.');
      expect(fixesApplied[0]).toContain('Stripped throat-clearing');
    });

    it('cleans "The uncomfortable truth is" throat clearing', () => {
      const input = 'The uncomfortable truth is that our queries were unindexed, causing 800ms latencies.';
      const { cleanedText, fixesApplied } = cleanSlop(input);

      expect(cleanedText).toBe('Our queries were unindexed, causing 800ms latencies.');
      expect(fixesApplied.length).toBe(1);
    });

    it('removes intensifier fillers mid-sentence without losing engineering actions', () => {
      const input = 'We genuinely improved throughput by 3x and literally cut CPU usage by 40%.';
      const { cleanedText, fixesApplied } = cleanSlop(input);

      expect(cleanedText).toBe('We improved throughput by 3x and cut CPU usage by 40%.');
      expect(fixesApplied).toContain('Removed intensifier filler: "genuinely"');
      expect(fixesApplied).toContain('Removed intensifier filler: "literally"');
    });

    it('handles leading intensifiers with commas', () => {
      const input = 'Basically, we automated the CI/CD pipeline, reducing deployment time from 45m to 4m.';
      const { cleanedText, fixesApplied } = cleanSlop(input);

      expect(cleanedText).toBe('We automated the CI/CD pipeline, reducing deployment time from 45m to 4m.');
      expect(fixesApplied).toContain('Removed intensifier filler: "Basically"');
    });

    it('cleans stems following sentence punctuation within the same line', () => {
      const input = "Service launched on Monday. It's worth noting that error rates dropped to 0.01%.";
      const { cleanedText, fixesApplied } = cleanSlop(input);

      expect(cleanedText).toBe('Service launched on Monday. Error rates dropped to 0.01%.');
      expect(fixesApplied.length).toBe(1);
    });

    it('leaves already clean engineering accomplishments untouched and returns empty fixesApplied', () => {
      const cleanInput = 'Reduced p99 latency by 45% using Go connection pooling and gRPC microservices';
      const { cleanedText, fixesApplied } = cleanSlop(cleanInput);

      expect(cleanedText).toBe(cleanInput);
      expect(fixesApplied).toEqual([]);
    });

    it('is idempotent: running cleanSlop twice produces the same result with 0 additional fixes', () => {
      const input = "Needless to say, we genuinely migrated 10 Redis clusters to AWS with zero downtime.";
      const pass1 = cleanSlop(input);
      expect(pass1.cleanedText).toBe('We migrated 10 Redis clusters to AWS with zero downtime.');
      expect(pass1.fixesApplied.length).toBe(2);

      const pass2 = cleanSlop(pass1.cleanedText);
      expect(pass2.cleanedText).toBe(pass1.cleanedText);
      expect(pass2.fixesApplied).toEqual([]);
    });
  });
});
