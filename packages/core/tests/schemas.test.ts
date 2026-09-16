import { describe, it, expect } from 'vitest';
import {
  EvidenceEntrySchema,
  LevelingRubricSchema,
  PrivacyRulesSchema,
  WorkspaceConfigSchema,
} from '../src/index';

describe('EvidenceEntrySchema', () => {
  const validEvidence = {
    id: 'ev-042',
    date: '2026-04-12',
    company: 'cloudmatrix',
    title: 'Zero-Downtime Session Migration',
    summary: 'Architected token rotation protocol eliminating session invalidations during DB switch.',
    impact: 'Reduced user re-auth events by 99.4% across 140k active daily sessions.',
    themes: ['distributed-systems', 'reliability', 'auth'],
    confidence: 'verified' as const,
    in_flight: false,
    metrics: [
      { name: 're-auth reduction', value: '99.4%', status: 'verified' },
    ],
    internal_references: [
      { type: 'linear', ref: 'AUTH-892' },
      { type: 'datadog', ref: 'MON-108' },
    ],
  };

  it('validates a complete valid evidence entry', () => {
    const parsed = EvidenceEntrySchema.parse(validEvidence);
    expect(parsed.id).toBe('ev-042');
    expect(parsed.confidence).toBe('verified');
    expect(parsed.metrics).toHaveLength(1);
    expect(parsed.internal_references).toHaveLength(2);
  });

  it('accepts valid confidence enum values', () => {
    expect(EvidenceEntrySchema.parse({ ...validEvidence, confidence: 'verified' }).confidence).toBe('verified');
    expect(EvidenceEntrySchema.parse({ ...validEvidence, confidence: 'provisional' }).confidence).toBe('provisional');
    expect(EvidenceEntrySchema.parse({ ...validEvidence, confidence: 'retracted' }).confidence).toBe('retracted');
  });

  it('rejects invalid confidence values', () => {
    expect(() => EvidenceEntrySchema.parse({ ...validEvidence, confidence: 'unverified' })).toThrow();
    expect(() => EvidenceEntrySchema.parse({ ...validEvidence, confidence: 'high' })).toThrow();
  });

  it('rejects missing required fields', () => {
    const { id, ...missingId } = validEvidence;
    expect(() => EvidenceEntrySchema.parse(missingId)).toThrow();

    const { company, ...missingCompany } = validEvidence;
    expect(() => EvidenceEntrySchema.parse(missingCompany)).toThrow();

    const { title, ...missingTitle } = validEvidence;
    expect(() => EvidenceEntrySchema.parse(missingTitle)).toThrow();

    const { summary, ...missingSummary } = validEvidence;
    expect(() => EvidenceEntrySchema.parse(missingSummary)).toThrow();

    const { impact, ...missingImpact } = validEvidence;
    expect(() => EvidenceEntrySchema.parse(missingImpact)).toThrow();

    const { themes, ...missingThemes } = validEvidence;
    expect(() => EvidenceEntrySchema.parse(missingThemes)).toThrow();

    const { in_flight, ...missingInFlight } = validEvidence;
    expect(() => EvidenceEntrySchema.parse(missingInFlight)).toThrow();
  });

  it('rejects invalid metrics structure', () => {
    expect(() => EvidenceEntrySchema.parse({
      ...validEvidence,
      metrics: [{ name: 'only-name' }],
    })).toThrow();
  });

  it('rejects invalid internal_references structure', () => {
    expect(() => EvidenceEntrySchema.parse({
      ...validEvidence,
      internal_references: [{ type: 'missing-ref' }],
    })).toThrow();
  });
});

describe('LevelingRubricSchema', () => {
  const validRubric = {
    id: 'eng-ic-ladder',
    title: 'Engineering IC Competency Framework',
    target_level: 'L5',
    levels: [
      { id: 'L4', name: 'Senior Software Engineer' },
      { id: 'L5', name: 'Staff / Tech Lead' },
      { id: 'L6', name: 'Principal Engineer' },
    ],
    competencies: [
      {
        id: 'architecture-scope',
        name: 'System Architecture & Scope',
        levels: {
          L4: 'Designs single-service modules with minimal guidance.',
          L5: 'Leads multi-service system designs; resolves ambiguous trade-offs.',
          L6: 'Defines cross-organization architectural strategy and standards.',
        },
        evidence_mapped: [
          {
            ev_id: 'ev-042',
            relevance: 'primary',
            narrative: 'Cross-system token protocol spanning auth-service and web-app.',
          },
        ],
      },
    ],
  };

  it('validates a complete rubric with mapped evidence', () => {
    const parsed = LevelingRubricSchema.parse(validRubric);
    expect(parsed.id).toBe('eng-ic-ladder');
    expect(parsed.levels).toHaveLength(3);
    expect(parsed.competencies[0].evidence_mapped).toHaveLength(1);
  });

  it('validates rubric without evidence_mapped in competencies', () => {
    const rubricNoMapped = {
      ...validRubric,
      competencies: [
        {
          id: 'execution',
          name: 'Execution & Velocity',
          levels: {
            L4: 'Delivers high-quality PRs consistently.',
            L5: 'Unblocks team and drives multi-quarter initiatives.',
          },
        },
      ],
    };
    const parsed = LevelingRubricSchema.parse(rubricNoMapped);
    expect(parsed.competencies[0].evidence_mapped).toBeUndefined();
  });

  it('rejects missing required rubric fields', () => {
    const { id, ...missingId } = validRubric;
    expect(() => LevelingRubricSchema.parse(missingId)).toThrow();

    const { levels, ...missingLevels } = validRubric;
    expect(() => LevelingRubricSchema.parse(missingLevels)).toThrow();

    const { competencies, ...missingCompetencies } = validRubric;
    expect(() => LevelingRubricSchema.parse(missingCompetencies)).toThrow();
  });

  it('rejects invalid levels item structure', () => {
    expect(() => LevelingRubricSchema.parse({
      ...validRubric,
      levels: [{ id: 'L4' }],
    })).toThrow();
  });
});

describe('PrivacyRulesSchema', () => {
  const validPrivacy = {
    rules: {
      strip_patterns: ['(ev-[0-9]{3})', '([A-Z]{2,10}-[0-9]{1,5})'],
      replacements: [
        { search: 'Fortune 50 Bank X', replace: 'a global tier-1 financial institution' },
        { search: 'proto-codegen', replace: 'internal schema code generator' },
      ],
      banned_keywords: ['confidential-project-apollo'],
    },
  };

  it('validates complete privacy rules structure', () => {
    const parsed = PrivacyRulesSchema.parse(validPrivacy);
    expect(parsed.rules.strip_patterns).toHaveLength(2);
    expect(parsed.rules.replacements).toHaveLength(2);
    expect(parsed.rules.banned_keywords).toHaveLength(1);
  });

  it('rejects invalid replacement item without replace field', () => {
    expect(() => PrivacyRulesSchema.parse({
      rules: {
        ...validPrivacy.rules,
        replacements: [{ search: 'foo' }],
      },
    })).toThrow();
  });

  it('rejects missing rules property', () => {
    expect(() => PrivacyRulesSchema.parse({})).toThrow();
  });
});

describe('WorkspaceConfigSchema', () => {
  const validConfig = {
    active_profile: 'cloudmatrix',
    default_export_target: 'markdown',
    port: 4173,
  };

  it('validates workspace config', () => {
    const parsed = WorkspaceConfigSchema.parse(validConfig);
    expect(parsed.active_profile).toBe('cloudmatrix');
    expect(parsed.default_export_target).toBe('markdown');
    expect(parsed.port).toBe(4173);
  });

  it('rejects non-numeric or invalid port', () => {
    expect(() => WorkspaceConfigSchema.parse({
      ...validConfig,
      port: 'invalid-port',
    })).toThrow();
  });

  it('rejects missing required fields', () => {
    const { active_profile, ...missingProfile } = validConfig;
    expect(() => WorkspaceConfigSchema.parse(missingProfile)).toThrow();

    const { default_export_target, ...missingTarget } = validConfig;
    expect(() => WorkspaceConfigSchema.parse(missingTarget)).toThrow();
  });
});
