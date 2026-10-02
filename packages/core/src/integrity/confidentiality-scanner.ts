import type { PrivacyRulesConfig } from '../schemas/privacy.js';

export type LeakSeverity = 'block' | 'warn';

export type LeakCategory =
  | 'credential_or_key'
  | 'internal_hostname_or_ip'
  | 'private_vcs_or_repo'
  | 'banned_keyword'
  | 'unreplaced_entity'
  | 'internal_identifier';

export interface ConfidentialityLeak {
  category: LeakCategory;
  severity: LeakSeverity;
  ruleId: string;
  matchedText: string;
  redactedSnippet: string;
  lineNumber?: number;
  message: string;
  remediation: string;
}

export interface ConfidentialityScanResult {
  isClean: boolean;
  blockCount: number;
  warnCount: number;
  leaks: ConfidentialityLeak[];
  scannedCharacters: number;
}

interface DeterministicRule {
  ruleId: string;
  category: LeakCategory;
  severity: LeakSeverity;
  pattern: RegExp;
  message: string;
  remediation: string;
  isSecret?: boolean;
}

function escapeRegExp(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function maskSecret(secret: string): string {
  if (secret.length <= 8) return '****';
  const prefix = secret.slice(0, 3);
  const suffix = secret.slice(-4);
  return `${prefix}****...****${suffix}`;
}

const DETERMINISTIC_RULES: DeterministicRule[] = [
  // 1. Credentials, API Keys & Secrets
  {
    ruleId: 'credential_api_key',
    category: 'credential_or_key',
    severity: 'block',
    pattern: /\b(?:sk-[a-zA-Z0-9_-]{20,}|ant-[a-zA-Z0-9_-]{20,})\b/g,
    message: 'Detected active API key token (OpenAI/Anthropic pattern).',
    remediation: 'Immediately remove or redact API keys before exporting or sharing resume documents.',
    isSecret: true,
  },
  {
    ruleId: 'credential_github_pat',
    category: 'credential_or_key',
    severity: 'block',
    pattern: /\b(?:gh[pousr]_[a-zA-Z0-9]{20,}|github_pat_[a-zA-Z0-9_]{30,})\b/g,
    message: 'Detected GitHub Personal Access Token or fine-grained secret.',
    remediation: 'Revoke and remove GitHub personal access token from text.',
    isSecret: true,
  },
  {
    ruleId: 'credential_aws_key',
    category: 'credential_or_key',
    severity: 'block',
    pattern: /\bAKIA[0-9A-Z]{16}\b/g,
    message: 'Detected AWS Access Key ID (AKIA format).',
    remediation: 'Remove AWS credentials and replace with high-level architecture description.',
    isSecret: true,
  },
  {
    ruleId: 'credential_slack_token',
    category: 'credential_or_key',
    severity: 'block',
    pattern: /\bxox[baprs]-[0-9a-zA-Z]{10,}\b/g,
    message: 'Detected Slack API token.',
    remediation: 'Revoke token and remove reference.',
    isSecret: true,
  },
  {
    ruleId: 'credential_private_key',
    category: 'credential_or_key',
    severity: 'block',
    pattern: /-----BEGIN (?:RSA |OPENSSH |EC |DSA )?PRIVATE KEY-----/g,
    message: 'Detected private cryptographic key header block.',
    remediation: 'Strip all private key PEM blocks immediately.',
    isSecret: true,
  },
  {
    ruleId: 'credential_assignment',
    category: 'credential_or_key',
    severity: 'block',
    pattern: /\b(?:password|secret|api_key|apikey|auth_token)\s*[:=]\s*['"][^'"]{8,}['"]/gi,
    message: 'Detected inline credential or secret variable assignment.',
    remediation: 'Remove hardcoded credentials from portfolio snippets.',
    isSecret: true,
  },
  {
    ruleId: 'credential_jwt',
    category: 'credential_or_key',
    severity: 'block',
    pattern: /\beyJ[a-zA-Z0-9_-]{10,}\.eyJ[a-zA-Z0-9_-]{10,}\.[a-zA-Z0-9_-]{10,}\b/g,
    message: 'Detected JSON Web Token (JWT) bearer string.',
    remediation: 'Remove signed bearer token.',
    isSecret: true,
  },

  // 2. Internal Domains & Hostnames
  {
    ruleId: 'internal_domain_suffix',
    category: 'internal_hostname_or_ip',
    severity: 'block',
    pattern: /\b[a-zA-Z0-9.-]+\.(?:corp|internal|priv|intra|local|lan)\b/gi,
    message: 'Detected internal private DNS domain hostname (*.corp, *.internal, etc.).',
    remediation: 'Replace internal hostname with generic terminology (e.g. "production metrics gateway").',
  },
  {
    ruleId: 'internal_corp_subdomain',
    category: 'internal_hostname_or_ip',
    severity: 'block',
    pattern: /\b[a-zA-Z0-9-]+\.(?:corp|internal)\.[a-zA-Z0-9.-]+\b/gi,
    message: 'Detected corporate internal subdomain route.',
    remediation: 'Replace internal corporate hostnames before exporting.',
  },
  {
    ruleId: 'internal_private_ip',
    category: 'internal_hostname_or_ip',
    severity: 'block',
    pattern: /\b(?:10\.(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)\.(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)\.(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)|172\.(?:1[6-9]|2\d|3[01])\.(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)\.(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)|192\.168\.(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)\.(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d))\b/g,
    message: 'Detected private RFC 1918 IPv4 address.',
    remediation: 'Omit private IP addresses from external resume bullets.',
  },
  {
    ruleId: 'internal_git_remote',
    category: 'private_vcs_or_repo',
    severity: 'block',
    pattern: /\b(?:git@gitlab\.corp\.[^\/\s]+:[^\/\s]+|git@github\.com:internal-[^\/\s]+\/[^\/\s]+)\b/gi,
    message: 'Detected internal Git/VCS repository remote address.',
    remediation: 'Remove internal repository git remotes and URLs.',
  },
];

/**
 * Scans resume text or compiled deliverables for confidential internal hostnames,
 * secrets, credentials, unredacted client names, and policy violations.
 */
export function scanConfidentiality(
  text: string,
  rules?: Partial<PrivacyRulesConfig>
): ConfidentialityScanResult {
  const leaks: ConfidentialityLeak[] = [];
  const lines = text.split('\n');

  // Compute line start index offsets for fast line number lookup
  const lineOffsets: number[] = [0];
  for (let i = 0; i < text.length; i++) {
    if (text[i] === '\n') {
      lineOffsets.push(i + 1);
    }
  }

  function getLineInfo(index: number): { lineNumber: number; lineText: string } {
    let lineIdx = 0;
    for (let i = 0; i < lineOffsets.length; i++) {
      if (lineOffsets[i] <= index) {
        lineIdx = i;
      } else {
        break;
      }
    }
    return {
      lineNumber: lineIdx + 1,
      lineText: lines[lineIdx] ?? '',
    };
  }

  // 1. Run deterministic patterns
  for (const rule of DETERMINISTIC_RULES) {
    const regex = new RegExp(rule.pattern.source, rule.pattern.flags);
    let match: RegExpExecArray | null;
    while ((match = regex.exec(text)) !== null) {
      const matched = match[0];
      const matchIndex = match.index;
      const { lineNumber, lineText } = getLineInfo(matchIndex);

      let snippet = lineText.trim();
      if (rule.isSecret) {
        snippet = snippet.replace(matched, maskSecret(matched));
      }

      leaks.push({
        category: rule.category,
        severity: rule.severity,
        ruleId: rule.ruleId,
        matchedText: matched,
        redactedSnippet: snippet,
        lineNumber,
        message: rule.message,
        remediation: rule.remediation,
      });
    }
  }

  // 2. Scan Banned Keywords from PrivacyRulesConfig
  const bannedKeywords = rules?.banned_keywords ?? [];
  for (const keyword of bannedKeywords) {
    if (!keyword || !keyword.trim()) continue;
    const escaped = escapeRegExp(keyword.trim());
    const regex = new RegExp(`(?<![a-zA-Z0-9_-])${escaped}(?![a-zA-Z0-9_-])`, 'gi');
    let match: RegExpExecArray | null;
    while ((match = regex.exec(text)) !== null) {
      const { lineNumber, lineText } = getLineInfo(match.index);
      leaks.push({
        category: 'banned_keyword',
        severity: 'block',
        ruleId: 'banned_keyword_violation',
        matchedText: match[0],
        redactedSnippet: lineText.trim(),
        lineNumber,
        message: `Contains banned keyword or project code: "${match[0]}".`,
        remediation: 'Redact or remove this confidential keyword per privacy-rules.yaml.',
      });
    }
  }

  // 3. Scan Unreplaced Entity Names from replacements
  const replacements = rules?.replacements ?? [];
  for (const rep of replacements) {
    if (!rep.search || !rep.search.trim()) continue;
    const escaped = escapeRegExp(rep.search.trim());
    const regex = new RegExp(`(?<![a-zA-Z0-9_-])${escaped}(?![a-zA-Z0-9_-])`, 'gi');
    let match: RegExpExecArray | null;
    while ((match = regex.exec(text)) !== null) {
      const { lineNumber, lineText } = getLineInfo(match.index);
      leaks.push({
        category: 'unreplaced_entity',
        severity: 'block',
        ruleId: 'unreplaced_confidential_entity',
        matchedText: match[0],
        redactedSnippet: lineText.trim(),
        lineNumber,
        message: `Unreplaced confidential entity: "${match[0]}".`,
        remediation: `Replace with sanitized alias "${rep.replace}" per privacy-rules.yaml.`,
      });
    }
  }

  // 4. Scan for strip_patterns residue (e.g. ticket numbers)
  const stripPatterns = rules?.strip_patterns ?? [];
  for (const pattern of stripPatterns) {
    if (!pattern || !pattern.trim()) continue;
    try {
      const regex = new RegExp(`(?<![a-zA-Z0-9_-])(?:${pattern.trim()})(?![a-zA-Z0-9])`, 'gi');
      let match: RegExpExecArray | null;
      while ((match = regex.exec(text)) !== null) {
        const { lineNumber, lineText } = getLineInfo(match.index);
        leaks.push({
          category: 'internal_identifier',
          severity: 'warn',
          ruleId: 'internal_ticket_pattern',
          matchedText: match[0],
          redactedSnippet: lineText.trim(),
          lineNumber,
          message: `Unredacted internal ticket identifier: "${match[0]}".`,
          remediation: `Strip internal ticket ID matching pattern "${pattern}".`,
        });
      }
    } catch {
      // Ignore invalid regex
    }
  }

  // Deduplicate identical leaks on the same line
  const uniqueLeaks: ConfidentialityLeak[] = [];
  const seen = new Set<string>();
  for (const leak of leaks) {
    const key = `${leak.ruleId}-${leak.matchedText}-${leak.lineNumber}`;
    if (!seen.has(key)) {
      seen.add(key);
      uniqueLeaks.push(leak);
    }
  }

  const blockCount = uniqueLeaks.filter((l) => l.severity === 'block').length;
  const warnCount = uniqueLeaks.filter((l) => l.severity === 'warn').length;

  return {
    isClean: blockCount === 0 && warnCount === 0,
    blockCount,
    warnCount,
    leaks: uniqueLeaks,
    scannedCharacters: text.length,
  };
}
