import { describe, it, expect } from 'vitest';
import {
  scanConfidentiality,
  type ConfidentialityScanResult,
  type PrivacyRulesConfig,
} from '../src/index';

describe('Automated Secret & Confidentiality Leak Scanner (Task #15)', () => {
  const sampleRules: PrivacyRulesConfig = {
    strip_patterns: ['[A-Z]{2,10}-\\d+'],
    banned_keywords: ['Project Titan', 'ConfidentialAcquisition', 'AcmeSecretKey'],
    replacements: [
      { search: 'InternalMegacorp', replace: 'Fortune 50 Enterprise' },
      { search: 'Project Apollo', replace: 'Next-Gen Storage Mesh' },
    ],
  };

  describe('Clean text validation', () => {
    it('passes completely clean for public professional resume text', () => {
      const cleanResume = `
# Alex Rivera - Staff Software Engineer
- Architected distributed rate limiter handling 150k QPS across multi-region Kubernetes clusters.
- Optimized PostgreSQL indexing and partition queries, cutting p99 read latency from 45ms to 12ms.
- Mentored 6 senior engineers across systems design and fault-tolerant architecture standards.
`;
      const result: ConfidentialityScanResult = scanConfidentiality(cleanResume, sampleRules);

      expect(result.isClean).toBe(true);
      expect(result.blockCount).toBe(0);
      expect(result.warnCount).toBe(0);
      expect(result.leaks).toHaveLength(0);
      expect(result.scannedCharacters).toBeGreaterThan(50);
    });
  });

  describe('Credential, Token & Key Leaks', () => {
    it('detects and masks OpenAI and Anthropic API keys (severity: block)', () => {
      const text = 'Deploys LLM pipelines using key sk-1234567890abcdef1234567890abcdef for edge inference.';
      const result = scanConfidentiality(text);

      expect(result.isClean).toBe(false);
      expect(result.blockCount).toBeGreaterThanOrEqual(1);

      const leak = result.leaks.find((l) => l.ruleId === 'credential_api_key');
      expect(leak).toBeDefined();
      expect(leak?.severity).toBe('block');
      expect(leak?.category).toBe('credential_or_key');
      expect(leak?.matchedText).toContain('sk-');
      // Secret must be masked in snippet
      expect(leak?.redactedSnippet).toContain('sk-****');
    });

    it('detects GitHub Personal Access Tokens and AWS Access Keys', () => {
      const text = `
- Configured CI/CD automation with token ghp_9876543210fedcba9876543210fedcba for artifact publishing.
- Provisioned S3 glacier backup vault using AWS key AKIAIOSFODNN7EXAMPLE.
`;
      const result = scanConfidentiality(text);

      expect(result.isClean).toBe(false);
      expect(result.blockCount).toBe(2);

      const ghLeak = result.leaks.find((l) => l.ruleId === 'credential_github_pat');
      const awsLeak = result.leaks.find((l) => l.ruleId === 'credential_aws_key');

      expect(ghLeak).toBeDefined();
      expect(ghLeak?.severity).toBe('block');
      expect(awsLeak).toBeDefined();
      expect(awsLeak?.severity).toBe('block');
    });

    it('detects private key blocks and JWT bearer tokens', () => {
      const text = `
-----BEGIN RSA PRIVATE KEY-----
MIIEowIBAAKCAQEA0m...
-----END RSA PRIVATE KEY-----
`;
      const result = scanConfidentiality(text);
      expect(result.isClean).toBe(false);
      expect(result.leaks.some((l) => l.ruleId === 'credential_private_key')).toBe(true);
    });
  });

  describe('Internal Hostnames, IPs & Network Infrastructure', () => {
    it('detects internal domain names (*.corp.*, *.internal.*, *.local)', () => {
      const text = `
- Maintained production observability pipelines at metrics.corp.megacorp.internal.
- Integrated Grafana dashboards routed via auth-gateway.internal.
`;
      const result = scanConfidentiality(text);

      expect(result.isClean).toBe(false);
      const domainLeaks = result.leaks.filter((l) => l.category === 'internal_hostname_or_ip');
      expect(domainLeaks.length).toBeGreaterThanOrEqual(1);
      expect(domainLeaks[0].severity).toBe('block');
      expect(domainLeaks[0].remediation).toContain('hostname');
    });

    it('detects private RFC 1918 IP addresses', () => {
      const text = 'Configured upstream proxy balancing traffic across 10.0.4.15 and 192.168.1.100 nodes.';
      const result = scanConfidentiality(text);

      expect(result.isClean).toBe(false);
      const ipLeaks = result.leaks.filter((l) => l.ruleId === 'internal_private_ip');
      expect(ipLeaks.length).toBe(2);
      expect(ipLeaks.every((l) => l.severity === 'block')).toBe(true);
    });

    it('detects internal git remotes (gitlab.corp / github.com/internal-*)', () => {
      const text = 'Managed deployment repos under git@gitlab.corp.enterprise.com:platform/core-engine.git.';
      const result = scanConfidentiality(text);

      expect(result.isClean).toBe(false);
      expect(result.leaks.some((l) => l.category === 'private_vcs_or_repo')).toBe(true);
    });
  });

  describe('Privacy Rules Config Leaks (Banned Keywords & Unreplaced Replacements)', () => {
    it('flags unredacted banned keywords defined in privacy-rules.yaml', () => {
      const text = 'Spearheaded technical development for Project Titan before transitioning to infrastructure.';
      const result = scanConfidentiality(text, sampleRules);

      expect(result.isClean).toBe(false);
      const banned = result.leaks.find((l) => l.ruleId === 'banned_keyword_violation');
      expect(banned).toBeDefined();
      expect(banned?.severity).toBe('block');
      expect(banned?.matchedText).toBe('Project Titan');
    });

    it('flags unreplaced entity names when replacements rule exists', () => {
      const text = 'Delivered multi-tenant auth layer for InternalMegacorp on scheduled timeline.';
      const result = scanConfidentiality(text, sampleRules);

      expect(result.isClean).toBe(false);
      const unreplaced = result.leaks.find((l) => l.ruleId === 'unreplaced_confidential_entity');
      expect(unreplaced).toBeDefined();
      expect(unreplaced?.severity).toBe('block');
      expect(unreplaced?.matchedText).toBe('InternalMegacorp');
      expect(unreplaced?.remediation).toContain('Fortune 50 Enterprise');
    });

    it('warns on unredacted ticket ID strip patterns residue', () => {
      const text = 'Closed critical memory leak incident referenced in JIRA-4091.';
      const result = scanConfidentiality(text, sampleRules);

      expect(result.isClean).toBe(false);
      const ticket = result.leaks.find((l) => l.ruleId === 'internal_ticket_pattern');
      expect(ticket).toBeDefined();
      expect(ticket?.matchedText).toBe('JIRA-4091');
    });
  });

  describe('Line numbering & contextual snippet extraction', () => {
    it('accurately identifies line numbers and extracts clean redacted context snippet', () => {
      const multiline = [
        '# Header',
        'Line 2 is public.',
        'Line 3 has leak: api_key = "1234567890abcdef"',
        'Line 4 is public.',
      ].join('\n');

      const result = scanConfidentiality(multiline);
      const leak = result.leaks[0];

      expect(leak).toBeDefined();
      expect(leak.lineNumber).toBe(3);
      expect(leak.redactedSnippet).toContain('Line 3 has leak');
      expect(leak.redactedSnippet).not.toContain('1234567890abcdef');
    });
  });
});
