import { describe, it, expect } from 'vitest';
import {
  analyzeATS,
  extractSectionHeaders,
  detectMultiColumnDistortion,
  computeKeywordScore,
  simulateGreenhouseParse,
  simulateLeverParse,
} from '../src/index';

const SAMPLE_CLEAN_RESUME = `
# Jane Doe
Staff Infrastructure Engineer

## Summary
Experienced systems architect with 10+ years designing high-throughput distributed backends.
Specializes in performance optimization, distributed consensus, and zero-downtime migrations.

## Experience
### Principal Architect — Acme Cloud (2022–Present)
- Led architecture of dynamic multi-region partition sharding across 14M accounts.
- Reduced p99 tail latency from 850ms to 42ms with zero scheduled downtime.
- Mentored 12 senior engineers on distributed consensus protocols.

### Senior Systems Engineer — DataCorp (2018–2022)
- Re-architected core messaging bus with Kafka, improving throughput by 300%.
- Designed automated CI/CD canary verification pipelines.

## Skills
- Distributed Systems, Kubernetes, Go, TypeScript, PostgreSQL, Kafka
- High-throughput testing, architectural leadership, latency profiling

## Education
### B.S. in Computer Science — Stanford University (2014–2018)
`.trim();

describe('ATS Simulation & Readability Gate', () => {
  it('evaluates clean, complete resume with excellent score and standard sections', () => {
    const result = analyzeATS(SAMPLE_CLEAN_RESUME, 'greenhouse');

    expect(result.score).toBeGreaterThanOrEqual(85);
    expect(result.band).toBe('excellent');
    expect(result.isClean).toBe(true);
    expect(result.sectionsMissing).toHaveLength(0);
    expect(result.sectionsFound).toContain('Summary');
    expect(result.sectionsFound).toContain('Experience');
    expect(result.sectionsFound).toContain('Skills');
    expect(result.sectionsFound).toContain('Education');
  });

  it('flags missing Experience section and lowers score below 75', () => {
    const resumeWithoutExp = `
# Jane Doe
## Summary
Experienced software engineer.
## Skills
TypeScript, Node.js
## Education
B.S. Computer Science
`.trim();

    const result = analyzeATS(resumeWithoutExp, 'greenhouse');
    expect(result.sectionsMissing).toContain('Experience');
    expect(result.score).toBeLessThan(75);
    const expIssue = result.issues.find((i) => i.section === 'Experience');
    expect(expIssue).toBeDefined();
    expect(expIssue?.severity).toBe('error');
  });

  it('flags missing Education section with warning', () => {
    const resumeWithoutEdu = `
# Jane Doe
## Summary
Experienced software engineer.
## Experience
### Senior Engineer
- Built stuff.
## Skills
TypeScript
`.trim();

    const result = analyzeATS(resumeWithoutEdu, 'greenhouse');
    expect(result.sectionsMissing).toContain('Education');
    expect(result.issues.some((i) => i.section === 'Education')).toBe(true);
  });

  it('accurately scores custom target keywords and ratios', () => {
    const targetKeywords = ['Kafka', 'Kubernetes', 'Rust', 'GraphQL', 'AWS'];
    const result = analyzeATS(SAMPLE_CLEAN_RESUME, 'greenhouse', targetKeywords);

    // Kafka & Kubernetes are in the resume, Rust & GraphQL & AWS are not
    expect(result.keywordMatches).toBe(2);
    expect(result.keywordTotal).toBe(5);
  });

  it('detects multi-column distortion when tables are present in resume', () => {
    const resumeWithTable = `
## Summary
Engineer profile.
## Experience
| Role | Company | Dates |
|---|---|---|
| Architect | Acme | 2022-Present |
| Dev | Corp | 2018-2022 |
## Education
Stanford
## Skills
Go, TypeScript
`.trim();

    const result = analyzeATS(resumeWithTable, 'greenhouse');
    const tableDistortion = result.issues.find((i) => i.type === 'multi_column_distortion');
    expect(tableDistortion).toBeDefined();
    expect(result.isClean).toBe(false);
  });

  it('detects malformed headers appearing in ALL CAPS without markdown prefixes', () => {
    const resumeWithAllCaps = `
SUMMARY
Experienced software engineer.

EXPERIENCE
- Built distributed storage controller.

SKILLS
Go, Python

EDUCATION
MIT
`.trim();

    const result = analyzeATS(resumeWithAllCaps, 'greenhouse');
    const malformedIssues = result.issues.filter((i) => i.type === 'malformed_header');
    expect(malformedIssues.length).toBeGreaterThan(0);
    expect(malformedIssues[0].message).toContain('ALL CAPS without markdown header prefix');
  });

  it('matches case-insensitive and aliased section headers like WORK EXPERIENCE', () => {
    const resumeWithAliases = `
## PROFESSIONAL SUMMARY
Systems leader.

## WORK EXPERIENCE
- Built cloud platform.

## CORE COMPETENCIES
Kubernetes, Distributed Systems

## ACADEMIC BACKGROUND
Computer Science
`.trim();

    const result = analyzeATS(resumeWithAliases, 'greenhouse');
    expect(result.sectionsFound).toContain('Summary');
    expect(result.sectionsFound).toContain('Experience');
    expect(result.sectionsFound).toContain('Skills');
    expect(result.sectionsFound).toContain('Education');
    expect(result.sectionsMissing).toHaveLength(0);
  });

  it('returns zero score and poor band for empty or whitespace resumes', () => {
    const emptyResult = analyzeATS('   \n\n   ');
    expect(emptyResult.score).toBe(0);
    expect(emptyResult.band).toBe('poor');
    expect(emptyResult.isClean).toBe(false);
    expect(emptyResult.sectionsMissing.length).toBeGreaterThanOrEqual(4);
  });

  it('supports greenhouse, lever, and generic schemas cleanly', () => {
    const gh = analyzeATS(SAMPLE_CLEAN_RESUME, 'greenhouse');
    const lever = analyzeATS(SAMPLE_CLEAN_RESUME, 'lever');
    const generic = analyzeATS(SAMPLE_CLEAN_RESUME, 'generic');

    expect(gh.schema).toBe('greenhouse');
    expect(lever.schema).toBe('lever');
    expect(generic.schema).toBe('generic');
    expect(gh.score).toBeGreaterThanOrEqual(70);
    expect(lever.score).toBeGreaterThanOrEqual(70);
    expect(generic.score).toBeGreaterThanOrEqual(70);
  });

  it('simulates plain-text section splitting for Greenhouse and Lever', () => {
    const ghSections = simulateGreenhouseParse(SAMPLE_CLEAN_RESUME);
    expect(ghSections['Summary']).toContain('10+ years');
    expect(ghSections['Experience']).toContain('Principal Architect');

    const leverSections = simulateLeverParse(SAMPLE_CLEAN_RESUME);
    expect(leverSections['Summary'] || leverSections['Experience']).toBeDefined();
  });
});
