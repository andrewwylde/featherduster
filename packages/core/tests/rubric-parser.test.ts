import { describe, it, expect } from 'vitest';
import {
  parseRubricTable,
  analyzeCompetencyGaps,
  SWE_IC_RUBRIC,
  LevelingRubricSchema,
  EvidenceStore,
  EvidenceEntry,
  LevelingRubric,
} from '../src/index.js';

describe('parseRubricTable', () => {
  const standardMarkdown = `
| Competency | L3 | L4 | L5 | L6 |
| :--- | :--- | :--- | :--- | :--- |
| System Architecture & Scope | Builds single components within existing architectures | Owns end-to-end service design and trade-offs | Architects multi-service platforms and sets standards | Shapes company-wide architecture and tech vision |
| Execution & Delivery | Delivers well-scoped tasks on time | Drives multi-month milestones to completion | Orchestrates cross-team multi-quarter initiatives | Drives multi-year strategic company programs |
| Technical Leadership | Actively reviews PRs and writes documentation | Mentors engineers and leads design reviews | Tech Lead across teams; aligns with business | Recognized company authority and cultural leader |
| Reliability & Operations | Responds to on-call alerts; writes unit tests | Defines SLOs and runs blameless post-mortems | Establishes incident frameworks and disaster recovery | Sets org-wide resilience and business continuity |
`;

  it('parses standard markdown table into LevelingRubric', () => {
    const rubric = parseRubricTable(standardMarkdown, {
      id: 'eng-ladder',
      title: 'Engineering Ladder',
      target_level: 'L5',
    });

    expect(rubric.id).toBe('eng-ladder');
    expect(rubric.title).toBe('Engineering Ladder');
    expect(rubric.target_level).toBe('L5');
    expect(rubric.levels).toEqual([
      { id: 'L3', name: 'L3' },
      { id: 'L4', name: 'L4' },
      { id: 'L5', name: 'L5' },
      { id: 'L6', name: 'L6' },
    ]);
    expect(rubric.competencies).toHaveLength(4);

    const arch = rubric.competencies[0];
    expect(arch.id).toBe('system-architecture-scope');
    expect(arch.name).toBe('System Architecture & Scope');
    expect(arch.levels['L3']).toBe('Builds single components within existing architectures');
    expect(arch.levels['L4']).toBe('Owns end-to-end service design and trade-offs');
    expect(arch.levels['L5']).toBe('Architects multi-service platforms and sets standards');
    expect(arch.levels['L6']).toBe('Shapes company-wide architecture and tech vision');

    // Validates against LevelingRubricSchema
    expect(() => LevelingRubricSchema.parse(rubric)).not.toThrow();
  });

  it('extracts level IDs and names from formatted headers', () => {
    const tableWithHeaderDetails = `
| Dimension | L3: Junior / Mid | L4 - Senior Engineer | L5 (Staff / Tech Lead) | L6: Principal |
| --- | --- | --- | --- | --- |
| Architecture | Basic components | Subsystem design | Cross-system strategy | Global vision |
`;
    const rubric = parseRubricTable(tableWithHeaderDetails);

    expect(rubric.levels).toEqual([
      { id: 'L3', name: 'Junior / Mid' },
      { id: 'L4', name: 'Senior Engineer' },
      { id: 'L5', name: 'Staff / Tech Lead' },
      { id: 'L6', name: 'Principal' },
    ]);
    expect(rubric.competencies[0].levels['L3']).toBe('Basic components');
    expect(rubric.competencies[0].levels['L5']).toBe('Cross-system strategy');
  });

  it('parses TSV (tab-separated) tables copied from Notion or Google Docs', () => {
    const tsv = [
      ['Competency', 'L3', 'L4', 'L5'].join('\t'),
      ['Execution', 'Delivers tasks', 'Drives projects', 'Drives roadmaps'].join('\t'),
      ['Mentorship', 'Peer review', 'Mentors juniors', 'Sponsors seniors'].join('\t'),
    ].join('\n');

    const rubric = parseRubricTable(tsv, { title: 'Notion Leveling' });

    expect(rubric.title).toBe('Notion Leveling');
    expect(rubric.levels.map((l) => l.id)).toEqual(['L3', 'L4', 'L5']);
    expect(rubric.competencies).toHaveLength(2);
    expect(rubric.competencies[0].levels['L4']).toBe('Drives projects');
    expect(rubric.competencies[1].levels['L5']).toBe('Sponsors seniors');
  });

  it('parses CSV tables with quoted strings and commas', () => {
    const csv = [
      'Competency,L4,L5',
      '"System Architecture","Designs services, handles trade-offs","Architects platforms, sets standards"',
      '"Reliability","Maintains SLOs, leads post-mortems","Disaster recovery, incident governance"',
    ].join('\n');

    const rubric = parseRubricTable(csv, { id: 'csv-rubric' });

    expect(rubric.id).toBe('csv-rubric');
    expect(rubric.levels.map((l) => l.id)).toEqual(['L4', 'L5']);
    expect(rubric.competencies).toHaveLength(2);
    expect(rubric.competencies[0].levels['L4']).toBe('Designs services, handles trade-offs');
    expect(rubric.competencies[1].levels['L5']).toBe('Disaster recovery, incident governance');
  });

  it('handles messy formatting, extra pipes, trailing whitespace, empty lines, and escaped pipes', () => {
    const messyTable = `


| Competency | L4 | L5 |||  
|:---|:---|:---|  

| System Architecture | Handles single services | Handles distributed systems \\| multi-region |   
| | | |  
| Execution & Delivery | Delivers features | Leads multi-team programs |  

    `;

    const rubric = parseRubricTable(messyTable);

    expect(rubric.levels.map((l) => l.id)).toEqual(['L4', 'L5']);
    expect(rubric.competencies).toHaveLength(2);
    expect(rubric.competencies[0].name).toBe('System Architecture');
    expect(rubric.competencies[0].levels['L5']).toBe('Handles distributed systems | multi-region');
    expect(rubric.competencies[1].name).toBe('Execution & Delivery');
  });

  it('defaults id, title, and target_level if options are omitted', () => {
    const table = `
| Competency | L3 | L4 |
| --- | --- | --- |
| Velocity | Fast | Faster |
`;
    const rubric = parseRubricTable(table);

    expect(rubric.id).toBeDefined();
    expect(rubric.title).toBeDefined();
    expect(rubric.target_level).toBe('L3');
    expect(rubric.levels).toHaveLength(2);
  });

  it('throws descriptive error on empty or invalid input', () => {
    expect(() => parseRubricTable('')).toThrow(/empty/i);
    expect(() => parseRubricTable('   \n  \n  ')).toThrow(/empty/i);
    expect(() => parseRubricTable('Single Column Only\nValue 1\nValue 2')).toThrow(/column/i);
  });
});

describe('analyzeCompetencyGaps', () => {
  const sampleRubric: LevelingRubric = {
    id: 'eng-ladder',
    title: 'Engineering Ladder',
    target_level: 'L5',
    levels: [
      { id: 'L4', name: 'Senior' },
      { id: 'L5', name: 'Staff' },
      { id: 'L6', name: 'Principal' },
    ],
    competencies: [
      {
        id: 'architecture',
        name: 'System Architecture & Scope',
        levels: {
          L4: 'Designs services with clear boundaries.',
          L5: 'Architects multi-service platforms and cross-system protocols.',
          L6: 'Sets organizational technical direction.',
        },
        evidence_mapped: [
          { ev_id: 'ev-001', relevance: 'primary' },
          { ev_id: 'ev-002', relevance: 'secondary' },
        ],
      },
      {
        id: 'execution',
        name: 'Execution & Delivery',
        levels: {
          L4: 'Drives projects to completion.',
          L5: 'Leads cross-functional multi-quarter programs.',
          L6: 'Drives company-wide transformation programs.',
        },
        evidence_mapped: [
          { ev_id: 'ev-003', relevance: 'primary' },
        ],
      },
      {
        id: 'leadership',
        name: 'Technical Leadership & Mentorship',
        levels: {
          L4: 'Mentors engineers.',
          L5: 'Sponsors senior talent and leads org-wide initiatives.',
          L6: 'Shapes company culture and technical vision.',
        },
        evidence_mapped: [
          { ev_id: 'ev-004', relevance: 'primary' },
        ],
      },
      {
        id: 'reliability',
        name: 'Reliability & Operations',
        levels: {
          L4: 'Manages on-call and SLOs.',
          L5: 'Architects DR and automated recovery across regions.',
          L6: 'Establishes org-wide resilience standards.',
        },
        evidence_mapped: [],
      },
    ],
  };

  const createEvidence = (overrides: Partial<EvidenceEntry>): EvidenceEntry => ({
    id: 'ev-001',
    date: '2026-05-10',
    company: 'parable',
    title: 'Distributed Session Cache',
    summary: 'Built cache layer.',
    impact: 'Reduced latency by 45%.',
    themes: ['distributed-systems', 'architecture'],
    confidence: 'verified',
    in_flight: false,
    metrics: [{ name: 'latency', value: '45%', status: 'verified' }],
    internal_references: [],
    ...overrides,
  });

  it('computes coverage report when all competencies are met', () => {
    const store = new EvidenceStore([
      { entry: createEvidence({ id: 'ev-001', confidence: 'verified' }), narrative: 'Solid work.' },
      { entry: createEvidence({ id: 'ev-002', confidence: 'verified' }), narrative: 'Great results.' },
      { entry: createEvidence({ id: 'ev-003', confidence: 'verified' }), narrative: 'Delivered program.' },
      { entry: createEvidence({ id: 'ev-004', confidence: 'verified' }), narrative: 'Mentored engineers.' },
      { entry: createEvidence({ id: 'ev-005', confidence: 'verified' }), narrative: 'DR automated.' },
    ]);

    // Map reliability to ev-005
    const fullyMappedRubric: LevelingRubric = {
      ...sampleRubric,
      competencies: sampleRubric.competencies.map((c) =>
        c.id === 'reliability'
          ? { ...c, evidence_mapped: [{ ev_id: 'ev-005', relevance: 'primary' }] }
          : c
      ),
    };

    const analysis = analyzeCompetencyGaps(fullyMappedRubric, store);

    expect(analysis.targetLevel).toBe('L5');
    expect(analysis.totalCompetencies).toBe(4);
    expect(analysis.coveredCompetencies).toBe(4);
    expect(analysis.gapPercentage).toBe(0);

    analysis.competencies.forEach((c) => {
      expect(c.status).toBe('met');
      expect(c.verifiedCount).toBeGreaterThanOrEqual(1);
      expect(c.issues).toHaveLength(0);
    });
  });

  it('identifies coverage gaps: 0 verified mapped entries, missing evidence, and empty mappings', () => {
    const store = new EvidenceStore([
      { entry: createEvidence({ id: 'ev-001', confidence: 'verified' }), narrative: 'Architecture work.' },
      // ev-002 is not in store!
      // ev-003 is provisional
      { entry: createEvidence({ id: 'ev-003', confidence: 'provisional' }), narrative: 'Execution draft.' },
      // ev-004 has unverified metrics
      {
        entry: createEvidence({
          id: 'ev-004',
          confidence: 'verified',
          metrics: [{ name: 'speed', value: '[METRIC NEEDED]', status: 'unverified' }],
        }),
        narrative: 'Leadership metric pending.',
      },
    ]);

    const analysis = analyzeCompetencyGaps(sampleRubric, store);

    expect(analysis.targetLevel).toBe('L5');
    expect(analysis.totalCompetencies).toBe(4);
    // Only architecture has 1 verified entry with valid metrics, but ev-002 is missing so it has an issue -> partial
    // execution has only provisional -> partial
    // leadership has unverified metrics -> partial
    // reliability has 0 evidence -> gap
    expect(analysis.coveredCompetencies).toBe(0);
    expect(analysis.gapPercentage).toBe(100);

    const arch = analysis.competencies.find((c) => c.id === 'architecture')!;
    expect(arch.status).toBe('partial');
    expect(arch.verifiedCount).toBe(1);
    expect(arch.issues.some((i) => i.includes('ev-002'))).toBe(true);

    const exec = analysis.competencies.find((c) => c.id === 'execution')!;
    expect(exec.status).toBe('partial');
    expect(exec.provisionalCount).toBe(1);
    expect(exec.verifiedCount).toBe(0);
    expect(exec.issues.some((i) => i.toLowerCase().includes('provisional'))).toBe(true);

    const lead = analysis.competencies.find((c) => c.id === 'leadership')!;
    expect(lead.status).toBe('partial');
    expect(lead.issues.some((i) => i.toLowerCase().includes('metric'))).toBe(true);

    const rel = analysis.competencies.find((c) => c.id === 'reliability')!;
    expect(rel.status).toBe('gap');
    expect(rel.verifiedCount).toBe(0);
    expect(rel.provisionalCount).toBe(0);
    expect(rel.issues.some((i) => i.toLowerCase().includes('no evidence'))).toBe(true);
  });

  it('evaluates custom targetLevel parameter and flags missing level criteria', () => {
    const store = new EvidenceStore([
      { entry: createEvidence({ id: 'ev-001', confidence: 'verified' }), narrative: 'Architecture work.' },
    ]);

    const rubricWithMissingLevel: LevelingRubric = {
      id: 'partial-ladder',
      title: 'Partial Ladder',
      target_level: 'L4',
      levels: [
        { id: 'L4', name: 'Senior' },
        { id: 'L7', name: 'Fellow' },
      ],
      competencies: [
        {
          id: 'architecture',
          name: 'System Architecture',
          levels: {
            L4: 'Senior architecture criteria.',
            // L7 is intentionally missing
          },
          evidence_mapped: [{ ev_id: 'ev-001', relevance: 'primary' }],
        },
      ],
    };

    const analysisL7 = analyzeCompetencyGaps(rubricWithMissingLevel, store, 'L7');
    expect(analysisL7.targetLevel).toBe('L7');
    expect(analysisL7.competencies[0].status).toBe('partial');
    expect(analysisL7.competencies[0].issues.some((i) => i.includes('L7'))).toBe(true);
  });

  it('handles in-flight and retracted evidence gracefully', () => {
    const store = new EvidenceStore([
      {
        entry: createEvidence({
          id: 'ev-001',
          confidence: 'verified',
          in_flight: true,
        }),
        narrative: 'Currently in progress.',
      },
      {
        entry: createEvidence({
          id: 'ev-002',
          confidence: 'retracted',
        }),
        narrative: 'Disproven claim.',
      },
    ]);

    const rubric: LevelingRubric = {
      id: 'test',
      title: 'Test',
      target_level: 'L5',
      levels: [{ id: 'L5', name: 'Staff' }],
      competencies: [
        {
          id: 'architecture',
          name: 'Architecture',
          levels: { L5: 'Staff level' },
          evidence_mapped: [
            { ev_id: 'ev-001', relevance: 'primary' },
            { ev_id: 'ev-002', relevance: 'secondary' },
          ],
        },
      ],
    };

    const analysis = analyzeCompetencyGaps(rubric, store);
    const comp = analysis.competencies[0];

    expect(comp.status).toBe('partial');
    expect(comp.issues.some((i) => i.toLowerCase().includes('in-flight'))).toBe(true);
    expect(comp.issues.some((i) => i.toLowerCase().includes('retracted'))).toBe(true);
  });

  it('discovers evidence by matching themes when evidence_mapped is empty', () => {
    const store = new EvidenceStore([
      {
        entry: createEvidence({
          id: 'ev-theme-1',
          themes: ['system-architecture-scope'],
          confidence: 'verified',
        }),
        narrative: 'Tagged with theme',
      },
    ]);

    const rubric: LevelingRubric = {
      id: 'test',
      title: 'Test',
      target_level: 'L4',
      levels: [{ id: 'L4', name: 'Senior' }],
      competencies: [
        {
          id: 'system-architecture-scope',
          name: 'System Architecture & Scope',
          levels: { L4: 'Senior architecture' },
        },
      ],
    };

    const analysis = analyzeCompetencyGaps(rubric, store);
    expect(analysis.competencies[0].status).toBe('met');
    expect(analysis.competencies[0].verifiedCount).toBe(1);
    expect(analysis.coveredCompetencies).toBe(1);
    expect(analysis.gapPercentage).toBe(0);
  });
});

describe('SWE_IC_RUBRIC', () => {
  it('conforms to LevelingRubricSchema', () => {
    const parsed = LevelingRubricSchema.parse(SWE_IC_RUBRIC);
    expect(parsed.id).toBeDefined();
    expect(parsed.title).toBeDefined();
    expect(parsed.target_level).toBeDefined();
  });

  it('defines standard L3, L4, L5, L6 levels', () => {
    const levelIds = SWE_IC_RUBRIC.levels.map((l) => l.id);
    expect(levelIds).toEqual(['L3', 'L4', 'L5', 'L6']);

    const l3 = SWE_IC_RUBRIC.levels.find((l) => l.id === 'L3')!;
    expect(l3.name).toMatch(/junior|mid/i);

    const l4 = SWE_IC_RUBRIC.levels.find((l) => l.id === 'L4')!;
    expect(l4.name).toMatch(/senior/i);

    const l5 = SWE_IC_RUBRIC.levels.find((l) => l.id === 'L5')!;
    expect(l5.name).toMatch(/staff|tech lead/i);

    const l6 = SWE_IC_RUBRIC.levels.find((l) => l.id === 'L6')!;
    expect(l6.name).toMatch(/principal/i);
  });

  it('covers the four core engineering competencies with criteria for all levels', () => {
    const competencyNames = SWE_IC_RUBRIC.competencies.map((c) => c.name);
    expect(competencyNames).toContain('System Architecture & Scope');
    expect(competencyNames).toContain('Execution & Delivery');
    expect(competencyNames).toContain('Technical Leadership & Mentorship');
    expect(competencyNames).toContain('Reliability & Operations');

    SWE_IC_RUBRIC.competencies.forEach((comp) => {
      ['L3', 'L4', 'L5', 'L6'].forEach((lvl) => {
        expect(comp.levels[lvl]).toBeDefined();
        expect(comp.levels[lvl].trim().length).toBeGreaterThan(10);
      });
    });
  });
});
