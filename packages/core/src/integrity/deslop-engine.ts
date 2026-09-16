export type SlopTellType =
  | 'hedge'
  | 'stakes'
  | 'delve'
  | 'bizjargon'
  | 'triadic'
  | 'copula'
  | 'corporate_uplift'
  | 'intensifier_filler'
  | 'assistant_voice'
  | 'vague_quantifier'
  | 'throat_clearing';

export interface SlopMatch {
  type: SlopTellType;
  patternName: string;
  matchedText: string;
  index: number;
  line?: number;
}

export interface SlopAuditResult {
  isClean: boolean;
  score: number; // 0 (clean) to 100+
  slopBand: 'clean' | 'low' | 'moderate' | 'high';
  matches: SlopMatch[];
  summary: string;
}

export interface SlopRule {
  type: SlopTellType;
  patternName: string;
  regex: RegExp;
  weight: number;
}

/**
 * Severity weights for each slop tell type.
 * Higher weight indicates stronger slop tell or corporate fluff.
 */
export const SLOP_WEIGHTS: Record<SlopTellType, number> = {
  corporate_uplift: 3,
  assistant_voice: 3,
  delve: 2,
  hedge: 2,
  stakes: 2,
  copula: 2,
  throat_clearing: 2,
  triadic: 2,
  bizjargon: 2,
  vague_quantifier: 1,
  intensifier_filler: 1,
};

/**
 * Comprehensive dictionary of slop detection rules.
 * Case-insensitive regular expressions targeting AI writing tells,
 * buzzword inflation, manufactured stakes, and empty hedging.
 */
export const SLOP_RULES: SlopRule[] = [
  {
    type: 'hedge',
    patternName: 'empty_hedging_stem',
    regex: /\b(?:it'?s|it is) (?:worth noting|important to (?:note|remember|understand))\b|\b(?:that said|needless to say|as we all know|at the end of the day)\b/gi,
    weight: SLOP_WEIGHTS.hedge,
  },
  {
    type: 'stakes',
    patternName: 'manufactured_stakes',
    regex: /\b(?:in today'?s (?:(?:fast-paced |digital |modern )+)?(?:world|landscape|era)|now more than ever|more important than ever|the stakes have never been higher)\b/gi,
    weight: SLOP_WEIGHTS.stakes,
  },
  {
    type: 'delve',
    patternName: 'llm_lexicon_filler',
    regex: /\b(?:delv(?:e|es|ed|ing)|tapestry|a testament to|(?:in )?the realm of|navigat(?:e|es|ed|ing) the (?:complex|intricat|nuanc))\b/gi,
    weight: SLOP_WEIGHTS.delve,
  },
  {
    type: 'bizjargon',
    patternName: 'business_jargon',
    regex: /\b(?:circle back|double down|move the needle|low-hanging fruit|boil the ocean|take a step back|on the same page|moving forward|lean into)\b/gi,
    weight: SLOP_WEIGHTS.bizjargon,
  },
  {
    type: 'triadic',
    patternName: 'triadic_buzzwords',
    regex: /\b(?:fast|reliable|scalable|secure|robust|powerful|flexible|intuitive|seamless|efficient|innovative|modern),?\s+(?:fast|reliable|scalable|secure|robust|powerful|flexible|intuitive|seamless|efficient|innovative|modern),?\s+and\s+(?:fast|reliable|scalable|secure|robust|powerful|flexible|intuitive|seamless|efficient|innovative|modern)\b/gi,
    weight: SLOP_WEIGHTS.triadic,
  },
  {
    type: 'copula',
    patternName: 'copula_inflation',
    regex: /\b(?:boasts|(?:serves|stands) as a (?:testament|reminder|symbol|cornerstone))\b/gi,
    weight: SLOP_WEIGHTS.copula,
  },
  {
    type: 'corporate_uplift',
    patternName: 'corporate_buzzword_salad',
    regex: /\b(?:spearhead(?:ed|ing)? cross[- ]functional synergies?|foster(?:ed|ing)? synergistic alignment|holistic paradigm shift|dr(?:ove|iving) best-in-class leverage)\b/gi,
    weight: SLOP_WEIGHTS.corporate_uplift,
  },
  {
    type: 'intensifier_filler',
    patternName: 'filler_intensifier',
    regex: /\b(?:truly|genuinely|honestly|literally|simply|basically|essentially|undoubtedly)\s+\w+/gi,
    weight: SLOP_WEIGHTS.intensifier_filler,
  },
  {
    type: 'assistant_voice',
    patternName: 'assistant_sycophancy',
    regex: /\b(?:great question|good question|i'?d be happy to|i'?m happy to|happy to help|as an ai(?: language model)?|i hope this (?:email|message) finds you well)\b/gi,
    weight: SLOP_WEIGHTS.assistant_voice,
  },
  {
    type: 'vague_quantifier',
    patternName: 'vague_quantifier',
    regex: /\b(?:a (?:wide|broad) (?:variety|range|array) of|a plethora of|a myriad of|a host of)\b/gi,
    weight: SLOP_WEIGHTS.vague_quantifier,
  },
  {
    type: 'throat_clearing',
    patternName: 'throat_clearing',
    regex: /\b(?:the uncomfortable truth is|it turns out(?:,| that)?|let me be clear|let that sink in|make no mistake)\b/gi,
    weight: SLOP_WEIGHTS.throat_clearing,
  },
];

/**
 * Calculates 1-based line number for a character index in text.
 */
function getLineNumber(text: string, index: number): number {
  let line = 1;
  for (let i = 0; i < index; i++) {
    if (text.charCodeAt(i) === 10) {
      line++;
    }
  }
  return line;
}

/**
 * Scans text and returns all slop matches with line numbers and matched spans.
 */
export function detectSlop(text: string): SlopMatch[] {
  if (!text) return [];

  const rawMatches: SlopMatch[] = [];

  for (const rule of SLOP_RULES) {
    const rx = new RegExp(rule.regex.source, rule.regex.flags);
    let match: RegExpExecArray | null;

    while ((match = rx.exec(text)) !== null) {
      const matchedText = match[0];
      const index = match.index;
      const line = getLineNumber(text, index);

      rawMatches.push({
        type: rule.type,
        patternName: rule.patternName,
        matchedText,
        index,
        line,
      });

      if (match.index === rx.lastIndex) {
        rx.lastIndex++;
      }
    }
  }

  // Sort by char index ascending, then by pattern name
  rawMatches.sort((a, b) => a.index - b.index || a.patternName.localeCompare(b.patternName));

  // Deduplicate exact duplicate matches at same index with same type
  const seen = new Set<string>();
  const matches: SlopMatch[] = [];
  for (const m of rawMatches) {
    const key = `${m.type}:${m.index}:${m.matchedText}`;
    if (!seen.has(key)) {
      seen.add(key);
      matches.push(m);
    }
  }

  return matches;
}

/**
 * Assigns weights to matches, calculates an aggregate slop score,
 * and categorizes the text into clean (0), low (1-2), moderate (3-5), or high (>5).
 */
export function auditSlop(text: string): SlopAuditResult {
  const matches = detectSlop(text);
  const score = matches.reduce((total, m) => total + (SLOP_WEIGHTS[m.type] ?? 1), 0);

  let slopBand: 'clean' | 'low' | 'moderate' | 'high';
  if (score === 0) {
    slopBand = 'clean';
  } else if (score <= 2) {
    slopBand = 'low';
  } else if (score <= 5) {
    slopBand = 'moderate';
  } else {
    slopBand = 'high';
  }

  const isClean = score === 0;
  let summary: string;
  if (isClean) {
    summary = 'Clean: No slop detected.';
  } else {
    const categories = Array.from(new Set(matches.map((m) => m.type)));
    summary = `Slop score ${score} (${slopBand}): detected ${matches.length} tell(s) across categories: ${categories.join(', ')}.`;
  }

  return {
    isClean,
    score,
    slopBand,
    matches,
    summary,
  };
}

const PROTECTED_CASING = [
  'iOS',
  'eBPF',
  'p99',
  'p95',
  'p90',
  'npm',
  'gRPC',
  'k8s',
  'kubectl',
  'eBay',
  'macOS',
  'iPhone',
  'iPad',
];

function safeCapitalizeFirstWord(str: string): string {
  if (!str) return str;
  const match = str.match(/^([a-zA-Z0-9_-]+)(.*)$/s);
  if (!match) return str;
  const firstWord = match[1];
  const rest = match[2];

  for (const protectedWord of PROTECTED_CASING) {
    if (firstWord.toLowerCase() === protectedWord.toLowerCase()) {
      return protectedWord + rest;
    }
  }
  return firstWord.charAt(0).toUpperCase() + firstWord.slice(1) + rest;
}

/**
 * Deterministically strips or tightens the most common empty hedging,
 * throat-clearing, and intensifier fillers without inventing facts or altering numbers/metrics.
 */
export function cleanSlop(text: string): { cleanedText: string; fixesApplied: string[] } {
  if (!text) {
    return { cleanedText: text, fixesApplied: [] };
  }

  const fixesApplied: string[] = [];
  const lines = text.split('\n');

  const leadingStemRules: Array<{ type: 'hedge' | 'throat'; regex: RegExp }> = [
    {
      type: 'hedge',
      regex: /^\s*(?:it'?s|it is) (?:worth noting|important to (?:note|remember|understand))(?: that)?(?:[:,])?\s*/i,
    },
    {
      type: 'hedge',
      regex: /^\s*(?:that said|needless to say|as we all know|at the end of the day)(?:[:,])?\s*/i,
    },
    {
      type: 'throat',
      regex: /^\s*(?:the uncomfortable truth is(?: that)?|it turns out(?: that|,)?|let me be clear|let that sink in|make no mistake)(?:[:,])?\s*/i,
    },
  ];

  const cleanedLines = lines.map((line) => {
    // Preserve bullet point, number, or leading whitespace indentation
    const prefixMatch = line.match(/^(\s*(?:[-*•]|\d+[.)])\s*|\s*)/);
    const prefix = prefixMatch ? prefixMatch[1] : '';
    let content = line.slice(prefix.length);

    if (content.trim().length === 0) {
      return line;
    }

    // 1. Strip leading hedge and throat-clearing stems at start of line content
    let matchedLeading = true;
    let loopGuard = 0;
    while (matchedLeading && loopGuard < 5) {
      matchedLeading = false;
      loopGuard++;

      for (const rule of leadingStemRules) {
        const match = content.match(rule.regex);
        if (match && match[0].length > 0) {
          const stem = match[0];
          content = safeCapitalizeFirstWord(content.slice(stem.length));
          if (rule.type === 'hedge') {
            fixesApplied.push(`Stripped empty hedge: "${stem.trim()}"`);
          } else {
            fixesApplied.push(`Stripped throat-clearing: "${stem.trim()}"`);
          }
          matchedLeading = true;
          break;
        }
      }
    }

    // 2. Strip hedge and throat-clearing stems after sentence boundaries (. ! ?)
    const sentenceStemRegex = /(?<=[.!?]\s+)(?:((?:it'?s|it is) (?:worth noting|important to (?:note|remember|understand))(?: that)?(?:[:,])?\s*)|((?:that said|needless to say|as we all know|at the end of the day)(?:[:,])?\s*)|((?:the uncomfortable truth is(?: that)?|it turns out(?: that|,)?|let me be clear|let that sink in|make no mistake)(?:[:,])?\s*))(\S+)/gi;
    content = content.replace(
      sentenceStemRegex,
      (_match, hedge1, hedge2, throat, firstWord) => {
        const hedge = hedge1 || hedge2;
        if (hedge) {
          fixesApplied.push(`Stripped empty hedge: "${hedge.trim()}"`);
        } else if (throat) {
          fixesApplied.push(`Stripped throat-clearing: "${throat.trim()}"`);
        }
        return safeCapitalizeFirstWord(firstWord);
      }
    );

    // 3. Strip leading intensifier fillers at start of line content
    const leadingIntensifierMatch = content.match(
      /^(truly|genuinely|honestly|literally|simply|basically|essentially|undoubtedly)[,:]?\s*(\S+)/i
    );
    if (leadingIntensifierMatch) {
      const word = leadingIntensifierMatch[1];
      const nextWord = leadingIntensifierMatch[2];
      fixesApplied.push(`Removed intensifier filler: "${word}"`);
      content = safeCapitalizeFirstWord(nextWord) + content.slice(leadingIntensifierMatch[0].length);
    }

    // 4. Strip intensifiers after sentence boundaries
    const sentenceIntensifierRegex = /(?<=[.!?]\s+)(truly|genuinely|honestly|literally|simply|basically|essentially|undoubtedly)[,:]?\s*(\S+)/gi;
    content = content.replace(sentenceIntensifierRegex, (_match, word, firstWord) => {
      fixesApplied.push(`Removed intensifier filler: "${word}"`);
      return safeCapitalizeFirstWord(firstWord);
    });

    // 5. Strip mid-sentence filler intensifier adverbs modifying adjacent words
    const midIntensifierRegex = /\b(truly|genuinely|honestly|literally|simply|basically|essentially|undoubtedly)[,]?\s+(?=\S)/gi;
    content = content.replace(midIntensifierRegex, (_match, word) => {
      fixesApplied.push(`Removed intensifier filler: "${word}"`);
      return '';
    });

    // Normalize multiple spaces created by removals
    content = content.replace(/[ \t]{2,}/g, ' ');

    return prefix + content;
  });

  return {
    cleanedText: cleanedLines.join('\n'),
    fixesApplied,
  };
}
