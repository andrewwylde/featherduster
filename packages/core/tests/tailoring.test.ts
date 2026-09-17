import { describe, it, expect } from 'vitest';
import {
  EvidenceStore,
  redactText,
  buildAlignmentPrompt,
  buildAnalysisPrompt,
  buildProposalsPrompt,
  buildSystemPrompt,
  RedactionBlockedError,
  validateAnalysis,
  validateAlignment,
  validateProposal,
  validateProposals,
  applyProposals,
  pageBudgetOverruns,
  renderBriefMarkdown,
  METRIC_NEEDED,
  ProposalSchema,
  JobAnalysisSchema,
  type EvidenceEntry,
  type PrivacyRulesConfig,
  type ResumeSpec,
  type JobAnalysis,
  type AlignmentMatrix,
  type Proposal,
} from '../src/index.js';

const DEFAULT_INIT_RULES: PrivacyRulesConfig = {
  strip_patterns: ['[A-Z]{2,10}-\\d+', 'CONF-\\d+', 'SECRET-\\d+'],
  replacements: [{ search: 'SampleCorp', replace: 'Enterprise Client' }],
  banned_keywords: ['PROJECT_APOLLO'],
};

function entry(overrides: Partial<EvidenceEntry>): EvidenceEntry {
  return {
    id: 'ev-001',
    date: '2025-01-01',
    company: 'SampleCorp',
    title: 'Kafka ingestion pipeline',
    summary: 'Built event ingestion on RabbitMQ for AUTH-892 migration.',
    impact: 'Reduced p99 latency from 850ms to 42ms.',
    themes: ['distributed-systems', 'RabbitMQ'],
    confidence: 'verified',
    in_flight: false,
    metrics: [{ name: 'p99 latency', value: '42ms', status: 'verified' }],
    internal_references: [],
    ...overrides,
  };
}

function makeStore(): EvidenceStore {
  const store = new EvidenceStore();
  store.add(entry({ id: 'ev-001', title: 'Async ingestion pipeline' }), 'Owned the RabbitMQ consumer fleet.');
  store.add(
    entry({
      id: 'kong-002',
      title: 'Go gateway rewrite',
      summary: 'Rewrote gateway in Go.',
      impact: 'Cut CPU by 30%.',
      themes: ['Go', 'performance'],
      metrics: [{ name: 'cpu', value: '30%', status: 'verified' }],
    }),
    ''
  );
  store.add(entry({ id: 'ev-003', title: 'Retracted thing', confidence: 'retracted' }), '');
  return store;
}

const baseResume: ResumeSpec = {
  profile: { name: 'A', title: 'Engineer', email: 'a@x.dev' },
  summary: 'Backend engineer focused on reliability.',
  experiences: [
    {
      company: 'SampleCorp',
      role: 'Senior Engineer',
      startDate: '2022',
      endDate: 'Present',
      bullets: [
        { text: 'Built dashboards (ev-001).', citations: ['ev-001'] },
        { text: 'Rewrote gateway in Go.', citations: ['kong-002'] },
        { text: 'Mentored interns.' },
      ],
    },
  ],
  education: [],
  skills: [{ category: 'Languages', skills: ['TypeScript', 'Go', 'Python'] }],
};

const analysis: JobAnalysis = JobAnalysisSchema.parse({
  company: 'Acme',
  role: 'Staff Engineer',
  seniority: 'Staff',
  mission: 'Build streaming platform',
  requirements: [
    { id: 'r1', tier: 'must', text: 'Go experience', quote: 'strong Go', terms: ['Go'] },
    { id: 'r2', tier: 'must', text: 'Kafka streaming', quote: 'Kafka at scale', terms: ['Kafka'] },
    { id: 'r3', tier: 'nice', text: 'Kubernetes', quote: 'Kubernetes a plus', terms: ['Kubernetes'] },
  ],
  boilerplate: [],
});

const alignment: AlignmentMatrix = {
  rows: [
    { requirement_id: 'r1', classification: 'backed', citations: ['kong-002'], rationale: '', adjacent_tool: '', candidate_confirmed: false },
    { requirement_id: 'r2', classification: 'transferable', citations: ['ev-001'], rationale: '', adjacent_tool: 'RabbitMQ', candidate_confirmed: false },
    { requirement_id: 'r3', classification: 'gap', citations: [], rationale: '', adjacent_tool: '', candidate_confirmed: false },
  ],
};

function proposal(p: Partial<Proposal>): Proposal {
  return ProposalSchema.parse({ id: 'p1', type: 'bullet.rewrite', target: {}, ...p });
}

describe('redactText protectTokens', () => {
  it('default init strip pattern would remove evidence IDs without protection', () => {
    const out = redactText('Shipped ev-001 and kong-002 work for AUTH-892', DEFAULT_INIT_RULES);
    expect(out.redactedText).not.toContain('ev-001');
    expect(out.redactedText).not.toContain('kong-002');
  });

  it('preserves protected evidence IDs while still stripping tickets and replacing names', () => {
    const out = redactText('SampleCorp: shipped (ev-001) and kong-002 for AUTH-892', DEFAULT_INIT_RULES, {
      protectTokens: ['ev-001', 'kong-002'],
    });
    expect(out.redactedText).toContain('ev-001');
    expect(out.redactedText).toContain('kong-002');
    expect(out.redactedText).not.toContain('AUTH-892');
    expect(out.redactedText).toContain('Enterprise Client');
  });

  it('is byte-identical to legacy behavior without options', () => {
    const text = 'Built X (ev-042) for CONF-12 at SampleCorp.';
    expect(redactText(text, DEFAULT_INIT_RULES)).toEqual(redactText(text, DEFAULT_INIT_RULES, {}));
  });
});

describe('context builders', () => {
  const store = makeStore();
  const ids = store.getAll().map((r) => r.id);

  it('redacts for cloud runners but keeps citations', () => {
    const prompt = buildAlignmentPrompt(analysis, store.getAll(), baseResume, {
      locality: 'cloud',
      rules: DEFAULT_INIT_RULES,
      evidenceIds: ids,
    });
    expect(prompt).toContain('ev-001');
    expect(prompt).toContain('kong-002');
    expect(prompt).not.toContain('AUTH-892');
    expect(prompt).not.toContain('SampleCorp');
    expect(prompt).not.toContain('Retracted thing');
    // Narrative-only facts reach the digest (redacted)
    expect(prompt).toContain('Owned the RabbitMQ consumer fleet.');
  });

  it('passes raw text to local runners', () => {
    const prompt = buildAlignmentPrompt(analysis, store.getAll(), baseResume, {
      locality: 'local',
      rules: DEFAULT_INIT_RULES,
      evidenceIds: ids,
    });
    expect(prompt).toContain('AUTH-892');
    expect(prompt).toContain('SampleCorp');
  });

  it('throws RedactionBlockedError on banned keywords for cloud runners', () => {
    const blocked = new EvidenceStore();
    blocked.add(entry({ id: 'ev-009', summary: 'Worked on PROJECT_APOLLO' }), '');
    expect(() =>
      buildProposalsPrompt(analysis, alignment, baseResume, blocked.getAll(), {
        locality: 'cloud',
        rules: DEFAULT_INIT_RULES,
        evidenceIds: ['ev-009'],
      })
    ).toThrow(RedactionBlockedError);
  });

  it('builds analysis prompt and system prompt with skill text and gate instructions', () => {
    const prompt = buildAnalysisPrompt('We need strong Go.', 'RUBRIC', {
      locality: 'cloud',
      rules: DEFAULT_INIT_RULES,
      evidenceIds: [],
    });
    expect(prompt).toContain('RUBRIC');
    expect(prompt).toContain('strong Go');
    const system = buildSystemPrompt('# Skill body', 'analysis');
    expect(system).toContain('# Skill body');
    expect(system).toContain('Gate 0');
  });
});

describe('validateAnalysis', () => {
  it('flags quotes absent from the posting and dedupes ids', () => {
    const posting = 'We want   strong Go and Kafka at scale.';
    const result = validateAnalysis(
      { ...analysis, requirements: [...analysis.requirements, { ...analysis.requirements[0] }] },
      posting
    );
    expect(result.requirements[0].ungrounded).toBe(false);
    expect(result.requirements[1].ungrounded).toBe(false);
    expect(result.requirements[2].ungrounded).toBe(true);
    expect(new Set(result.requirements.map((r) => r.id)).size).toBe(4);
  });
});

describe('validateAlignment', () => {
  const store = makeStore();

  it('enforces citation and classification rules and fills missing rows', () => {
    const result = validateAlignment(
      {
        rows: [
          { requirement_id: 'r1', classification: 'backed', citations: ['ev-003'], rationale: '', adjacent_tool: '', candidate_confirmed: false },
          { requirement_id: 'r2', classification: 'gap', citations: ['ev-404'], rationale: '', adjacent_tool: '', candidate_confirmed: false },
        ],
      },
      analysis,
      store.getAll()
    );
    const r1 = result.rows.find((r) => r.requirement_id === 'r1')!;
    const r2 = result.rows.find((r) => r.requirement_id === 'r2')!;
    const r3 = result.rows.find((r) => r.requirement_id === 'r3')!;
    expect(r1.issues?.map((i) => i.kind)).toContain('backed_without_evidence');
    expect(r2.issues?.map((i) => i.kind)).toEqual(expect.arrayContaining(['unresolved_citation', 'gap_with_citations']));
    expect(r3.issues?.map((i) => i.kind)).toContain('missing_row');
  });

  it('candidate confirmation satisfies backed without citations', () => {
    const result = validateAlignment(
      { rows: [{ requirement_id: 'r1', classification: 'backed', citations: [], rationale: '', adjacent_tool: '', candidate_confirmed: true }] },
      analysis,
      store.getAll()
    );
    expect(result.rows[0].issues).toEqual([]);
  });
});

describe('validateProposal', () => {
  const store = makeStore();
  const ctx = { analysis, alignment, baseResume, evidence: store.getAll() };

  it('blocks text edits without citations', () => {
    const p = validateProposal(proposal({ target: { experience_index: 0, bullet_index: 2, skill_group_index: -1 }, after: 'Mentored interns.' }), ctx);
    expect(p.checks.some((c) => c.kind === 'ledger_ceiling' && c.severity === 'block')).toBe(true);
  });

  it('Ledger Ceiling blocks unbacked Kafka in bullet.add but allows grounded Go', () => {
    const kafka = validateProposal(
      proposal({ type: 'bullet.add', target: { experience_index: 0, bullet_index: 0, skill_group_index: -1 }, after: 'Operated Kafka pipelines.', citations: ['ev-001'] }),
      ctx
    );
    expect(kafka.checks.find((c) => c.kind === 'ledger_ceiling')?.message).toContain('Kafka');

    const go = validateProposal(
      proposal({ type: 'bullet.add', target: { experience_index: 0, bullet_index: 0, skill_group_index: -1 }, after: 'Rewrote gateway in Go.', citations: ['kong-002'] }),
      ctx
    );
    expect(go.checks.some((c) => c.severity === 'block')).toBe(false);
  });

  it('treats terms of approved backed requirements as grounded when their evidence is cited', () => {
    const vocabAnalysis = JobAnalysisSchema.parse({
      ...analysis,
      requirements: [...analysis.requirements, { id: 'r4', tier: 'vocabulary', text: 'Observability', quote: 'observability', terms: ['observability'] }],
    });
    const after = 'Owned observability for the Go gateway.';
    const make = (classification: 'backed' | 'gap') =>
      validateProposal(
        proposal({ type: 'bullet.add', target: { experience_index: 0, bullet_index: 0, skill_group_index: -1 }, after, citations: ['kong-002'] }),
        {
          ...ctx,
          analysis: vocabAnalysis,
          alignment: { rows: [...alignment.rows, { requirement_id: 'r4', classification, citations: classification === 'backed' ? ['kong-002'] : [], rationale: '', adjacent_tool: '', candidate_confirmed: false }] },
        }
      );
    expect(make('backed').checks.some((c) => c.kind === 'ledger_ceiling')).toBe(false);
    expect(make('gap').checks.find((c) => c.kind === 'ledger_ceiling')?.message).toContain('observability');
  });

  it('Ledger Ceiling blocks skills.reorder that adds skills', () => {
    const p = validateProposal(
      proposal({ type: 'skills.reorder', target: { experience_index: -1, bullet_index: -1, skill_group_index: 0 }, skills: ['Go', 'Kubernetes'] }),
      ctx
    );
    expect(p.checks.find((c) => c.kind === 'ledger_ceiling')?.message).toContain('Kubernetes');
  });

  it('replaces ungrounded numbers with [METRIC NEEDED] but keeps verified ones', () => {
    const p = validateProposal(
      proposal({
        target: { experience_index: 0, bullet_index: 1, skill_group_index: -1 },
        after: 'Rewrote gateway in Go, cutting CPU by 30% and p99 latency by 65%.',
        citations: ['kong-002'],
      }),
      ctx
    );
    expect(p.after).toContain('30%');
    expect(p.after).toContain(METRIC_NEEDED);
    expect(p.after).not.toContain('65%');
    expect(p.after).toContain('p99');
    expect(p.checks.some((c) => c.kind === 'metric_needed')).toBe(true);
    expect(p.before).toBe('Rewrote gateway in Go.');
  });

  it('flags slop at or above the warn band', () => {
    const p = validateProposal(
      proposal({
        target: { experience_index: 0, bullet_index: 1, skill_group_index: -1 },
        after:
          'Spearheaded cross-functional synergies to delve into a rich tapestry of Go, a testament to leveraging best-in-class paradigms in today\'s fast-paced digital landscape.',
        citations: ['kong-002'],
      }),
      ctx
    );
    expect(p.checks.some((c) => c.kind === 'deslop')).toBe(true);
  });

  it('blocks invalid targets and reorders', () => {
    const p = validateProposal(
      proposal({ type: 'bullet.reorder', target: { experience_index: 0, bullet_index: -1, skill_group_index: -1 }, order: [0, 0, 9] }),
      ctx
    );
    expect(p.checks.some((c) => c.kind === 'invalid_target')).toBe(true);
  });
});

describe('applyProposals', () => {
  const accepted = (p: Partial<Proposal>) => proposal({ decision: 'accepted', ...p });

  it('applies every proposal type against original indices', () => {
    const result = applyProposals(baseResume, [
      accepted({ id: 'a', type: 'summary.rewrite', after: 'Distributed systems engineer.', citations: ['ev-001'] }),
      accepted({ id: 'b', type: 'bullet.rewrite', target: { experience_index: 0, bullet_index: 0, skill_group_index: -1 }, after: 'Owned RabbitMQ ingestion.', citations: ['ev-001'] }),
      accepted({ id: 'c', type: 'bullet.drop', target: { experience_index: 0, bullet_index: 2, skill_group_index: -1 } }),
      accepted({ id: 'd', type: 'bullet.reorder', target: { experience_index: 0, bullet_index: -1, skill_group_index: -1 }, order: [1, 0, 2] }),
      accepted({ id: 'e', type: 'bullet.add', target: { experience_index: 0, bullet_index: 0, skill_group_index: -1 }, after: 'Scaled consumers.', citations: ['ev-001'] }),
      accepted({ id: 'f', type: 'skills.reorder', target: { experience_index: -1, bullet_index: -1, skill_group_index: 0 }, skills: ['Go'] }),
      accepted({ id: 'g', type: 'skills.prune', target: { experience_index: -1, bullet_index: -1, skill_group_index: 0 }, skills: ['Python'] }),
      proposal({ id: 'h', type: 'summary.rewrite', after: 'Rejected', decision: 'rejected' }),
    ]);
    expect(result.summary).toBe('Distributed systems engineer.');
    expect(result.experiences[0].bullets.map((b) => b.text)).toEqual([
      'Rewrote gateway in Go.',
      'Scaled consumers.',
      'Owned RabbitMQ ingestion.',
    ]);
    expect(result.skills[0].skills).toEqual(['Go', 'TypeScript']);
    expect(baseResume.experiences[0].bullets).toHaveLength(3);
  });

  it('skips blocked proposals and uses edited_after', () => {
    const result = applyProposals(baseResume, [
      accepted({ type: 'summary.rewrite', after: 'model', edited_after: 'mine', citations: ['ev-001'] }),
      accepted({ id: 'x', type: 'bullet.add', target: { experience_index: 0, bullet_index: -1, skill_group_index: -1 }, after: 'nope', checks: [{ severity: 'block', kind: 'ledger_ceiling', message: '' }] }),
    ]);
    expect(result.summary).toBe('mine');
    expect(result.experiences[0].bullets).toHaveLength(3);
  });

  it('reports page budget overruns for added lines', () => {
    const over = pageBudgetOverruns(baseResume, [
      accepted({ id: 'add1', type: 'bullet.add', target: { experience_index: 0, bullet_index: -1, skill_group_index: -1 }, after: 'New bullet', citations: ['ev-001'] }),
    ]);
    expect(over.overBy).toBeGreaterThan(0);
    expect(over.proposalIds).toEqual(['add1']);
  });
});

describe('validateProposals + renderBriefMarkdown', () => {
  it('dedupes proposal ids', () => {
    const store = makeStore();
    const out = validateProposals(
      [proposal({ id: 'p1', type: 'bullet.drop', target: { experience_index: 0, bullet_index: 2, skill_group_index: -1 } }), proposal({ id: 'p1', type: 'bullet.drop', target: { experience_index: 0, bullet_index: 1, skill_group_index: -1 } })],
      { analysis, alignment, baseResume, evidence: store.getAll() }
    );
    expect(out[0].id).not.toBe(out[1].id);
  });

  it('renders the three brief sections', () => {
    const md = renderBriefMarkdown(
      {
        anchor_stories: [{ title: 'Gateway', problem: 'CPU', ownership: 'Led', proof: '30%', citations: ['kong-002'] }],
        bridges: [{ requirement_id: 'r2', adjacent_tool: 'RabbitMQ', framing: 'Same backpressure patterns.' }],
        gaps: [{ requirement_id: 'r3', acknowledgement: 'No prod k8s.', parallel_mastery: 'Ran ECS.' }],
      },
      analysis,
      alignment
    );
    expect(md).toContain('# Interview Defensibility Brief: Acme — Staff Engineer');
    expect(md).toContain('## Primary Anchor Stories');
    expect(md).toContain('Kafka streaming ← RabbitMQ');
    expect(md).toContain('## Addressing True Gaps');
    expect(md).toContain('1 backed · 1 transferable · 1 gaps');
  });
});
