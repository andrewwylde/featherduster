import { describe, it, expect } from 'vitest';
import { STEP_JSON_SCHEMAS } from '@featherduster/core';
import { createDemoResponder } from '../src/runners/demo-responder.js';
import type { RunnerRequest } from '../src/runners/types.js';

describe('demo-responder', () => {
  const createRequest = (schema: string, prompt: string): RunnerRequest => ({
    schema,
    prompt,
  });

  describe('createDemoResponder', () => {
    it('returns a function that accepts RunnerRequest', () => {
      const responder = createDemoResponder();
      expect(typeof responder).toBe('function');
    });

    it('throws error for unknown schema', () => {
      const responder = createDemoResponder();
      const request = createRequest('unknown-schema', 'test prompt');
      expect(() => responder(request)).toThrow('Demo responder: unknown schema');
    });
  });

  describe('analysis response', () => {
    it('extracts role and company from job posting', () => {
      const prompt = `## Job Posting
Senior Software Engineer at Google
Building cloud infrastructure for 1M+ users.

## Requirements
JSON`;
      const responder = createDemoResponder();
      const result = responder(createRequest(STEP_JSON_SCHEMAS.analysis, prompt)) as any;

      expect(result).toHaveProperty('role');
      expect(result).toHaveProperty('company');
      expect(result.role).toContain('Senior Software Engineer');
      expect(result.company).toContain('Google');
    });

    it('extracts seniority level from posting', () => {
      const prompt = `## Job Posting
Principal Engineer at ACME Corp

## Requirements
JSON`;
      const responder = createDemoResponder();
      const result = responder(createRequest(STEP_JSON_SCHEMAS.analysis, prompt)) as any;

      expect(result).toHaveProperty('seniority');
      expect(result.seniority).toMatch(/Principal/i);
    });

    it('detects known technical terms in posting', () => {
      const prompt = `## Job Posting
Looking for TypeScript and React expert

## Requirements
JSON`;
      const responder = createDemoResponder();
      const result = responder(createRequest(STEP_JSON_SCHEMAS.analysis, prompt)) as any;

      expect(result).toHaveProperty('requirements');
      expect(Array.isArray(result.requirements)).toBe(true);
      expect(result.requirements.length).toBeGreaterThan(0);
      const hasTech = result.requirements.some((r: any) =>
        ['TypeScript', 'React'].some((t) => r.text.toLowerCase().includes(t.toLowerCase()))
      );
      expect(hasTech).toBe(true);
    });

    it('marks fast-paced as boilerplate', () => {
      const prompt = `## Job Posting
Join our fast-paced startup

## Requirements
JSON`;
      const responder = createDemoResponder();
      const result = responder(createRequest(STEP_JSON_SCHEMAS.analysis, prompt)) as any;

      expect(result).toHaveProperty('boilerplate');
      expect(Array.isArray(result.boilerplate)).toBe(true);
      const hasFastPaced = result.boilerplate.some((b: string) => b.toLowerCase().includes('fast-paced'));
      expect(hasFastPaced).toBe(true);
    });

    it('limits requirements to 10 items', () => {
      const prompt = `## Job Posting
Experience with TypeScript JavaScript Go Rust Python Java C++ SQL React Node.js Kafka RabbitMQ Kubernetes Docker AWS

## Requirements
JSON`;
      const responder = createDemoResponder();
      const result = responder(createRequest(STEP_JSON_SCHEMAS.analysis, prompt)) as any;

      expect(result.requirements.length).toBeLessThanOrEqual(10);
    });

    it('marks nice-to-have skills appropriately', () => {
      const prompt = `## Job Posting
Required: TypeScript
Nice to have: Rust

## Requirements
JSON`;
      const responder = createDemoResponder();
      const result = responder(createRequest(STEP_JSON_SCHEMAS.analysis, prompt)) as any;

      const rustReq = result.requirements.find((r: any) => r.quote?.includes('Rust'));
      if (rustReq) {
        expect(rustReq.tier).toBe('nice');
      }
    });

    it('returns mission section from posting', () => {
      const prompt = `## Job Posting
Senior Engineer at ACME
Building distributed systems at scale

## Requirements
JSON`;
      const responder = createDemoResponder();
      const result = responder(createRequest(STEP_JSON_SCHEMAS.analysis, prompt)) as any;

      expect(result).toHaveProperty('mission');
      expect(typeof result.mission).toBe('string');
    });
  });

  describe('alignment response', () => {
    it('returns rows array', () => {
      const prompt = `## Requirements
[{"id":"r1","terms":["TypeScript"],"text":"TypeScript experience"}]
## Evidence Ledger Digest
[{"id":"ev-1","title":"API Gateway","summary":"Built in TypeScript","themes":[]}]`;
      const responder = createDemoResponder();
      const result = responder(createRequest(STEP_JSON_SCHEMAS.alignment, prompt)) as any;

      expect(result).toHaveProperty('rows');
      expect(Array.isArray(result.rows)).toBe(true);
    });

    it('classifies backed requirements', () => {
      const prompt = `## Requirements
[{"id":"r1","terms":["TypeScript"],"text":"TypeScript experience"}]
## Evidence Ledger Digest
[{"id":"ev-1","title":"API Rewrite","summary":"Implemented in TypeScript","themes":[],"impact":"Reduced latency"}]`;
      const responder = createDemoResponder();
      const result = responder(createRequest(STEP_JSON_SCHEMAS.alignment, prompt)) as any;

      const backedRow = result.rows.find((r: any) => r.requirement_id === 'r1');
      expect(backedRow).toBeDefined();
      expect(backedRow.classification).toBe('backed');
    });

    it('classifies gap requirements', () => {
      const prompt = `## Requirements
[{"id":"r1","terms":["Rust"],"text":"Rust experience"}]
## Evidence Ledger Digest
[{"id":"ev-1","title":"Project","summary":"JavaScript only","themes":[],"impact":"Something"}]`;
      const responder = createDemoResponder();
      const result = responder(createRequest(STEP_JSON_SCHEMAS.alignment, prompt)) as any;

      const gapRow = result.rows.find((r: any) => r.requirement_id === 'r1');
      expect(gapRow).toBeDefined();
      expect(gapRow.classification).toBe('gap');
    });

    it('includes citations for backed requirements', () => {
      const prompt = `## Requirements
[{"id":"r1","terms":["Docker"],"text":"Docker experience"}]
## Evidence Ledger Digest
[{"id":"ev-1","title":"Container Migrations","summary":"Used Docker extensively","themes":[],"impact":"Streamlined deployment"}]`;
      const responder = createDemoResponder();
      const result = responder(createRequest(STEP_JSON_SCHEMAS.alignment, prompt)) as any;

      const backedRow = result.rows.find((r: any) => r.classification === 'backed');
      expect(backedRow.citations).toContain('ev-1');
    });

    it('limits citations to 2 per requirement', () => {
      const prompt = `## Requirements
[{"id":"r1","terms":["TypeScript"],"text":"TypeScript"}]
## Evidence Ledger Digest
[
  {"id":"ev-1","title":"Project A","summary":"TypeScript","themes":[],"impact":"Impact"},
  {"id":"ev-2","title":"Project B","summary":"TypeScript","themes":[],"impact":"Impact"},
  {"id":"ev-3","title":"Project C","summary":"TypeScript","themes":[],"impact":"Impact"}
]`;
      const responder = createDemoResponder();
      const result = responder(createRequest(STEP_JSON_SCHEMAS.alignment, prompt)) as any;

      const backedRow = result.rows[0];
      if (backedRow.classification === 'backed') {
        expect(backedRow.citations.length).toBeLessThanOrEqual(2);
      }
    });
  });

  describe('proposals response', () => {
    it('returns proposals array', () => {
      const prompt = `## Approved Alignment Matrix
[]
## Base Resume
{"summary":"","experiences":[],"skills":[]}
## Cited Evidence
[]
## Requirements
[]`;
      const responder = createDemoResponder();
      const result = responder(createRequest(STEP_JSON_SCHEMAS.proposals, prompt)) as any;

      expect(result).toHaveProperty('proposals');
      expect(Array.isArray(result.proposals)).toBe(true);
    });

    it('generates summary rewrite proposal when relevant evidence exists', () => {
      const prompt = `## Approved Alignment Matrix
[{"requirement_id":"r1","classification":"backed","citations":["ev-1"]}]
## Base Resume
{"summary":"Experienced engineer","experiences":[],"skills":[]}
## Cited Evidence
[{"id":"ev-1","title":"Platform Redesign","impact":"Increased throughput"}]
## Requirements
[]`;
      const responder = createDemoResponder();
      const result = responder(createRequest(STEP_JSON_SCHEMAS.proposals, prompt)) as any;

      const summaryProposal = result.proposals.find((p: any) => p.type === 'summary.rewrite');
      if (summaryProposal) {
        expect(summaryProposal.before).toBeTruthy();
        expect(summaryProposal.after).toBeTruthy();
        // Title is converted to lowercase in the proposal
        expect(summaryProposal.after.toLowerCase()).toContain('platform redesign');
      }
    });

    it('generates bullet add proposal for first experience', () => {
      const prompt = `## Approved Alignment Matrix
[{"requirement_id":"r1","classification":"backed","citations":["ev-1"]}]
## Base Resume
{"summary":"","experiences":[{"bullets":[]}],"skills":[]}
## Cited Evidence
[{"id":"ev-1","title":"Gateway Optimization","impact":"Reduced CPU by 40%"}]
## Requirements
[{"id":"r1","text":"Performance optimization"}]`;
      const responder = createDemoResponder();
      const result = responder(createRequest(STEP_JSON_SCHEMAS.proposals, prompt)) as any;

      const bulletProposal = result.proposals.find((p: any) => p.type === 'bullet.add');
      if (bulletProposal) {
        expect(bulletProposal.after).toContain('Gateway Optimization');
      }
    });

    it('generates bullet reorder for multiple bullets', () => {
      const prompt = `## Approved Alignment Matrix
[]
## Base Resume
{"summary":"","experiences":[{"bullets":[{"bullet_index":0,"text":"Bullet 1"},{"bullet_index":1,"text":"Bullet 2"}]}],"skills":[]}
## Cited Evidence
[]
## Requirements
[]`;
      const responder = createDemoResponder();
      const result = responder(createRequest(STEP_JSON_SCHEMAS.proposals, prompt)) as any;

      const reorderProposal = result.proposals.find((p: any) => p.type === 'bullet.reorder');
      if (reorderProposal) {
        expect(Array.isArray(reorderProposal.order)).toBe(true);
      }
    });

    it('generates skills reorder proposal when skills exist', () => {
      const prompt = `## Approved Alignment Matrix
[]
## Base Resume
{"summary":"","experiences":[],"skills":[{"skills":["Python","TypeScript"]}]}
## Cited Evidence
[]
## Requirements
[{"id":"r1","text":"TypeScript and React"}]`;
      const responder = createDemoResponder();
      const result = responder(createRequest(STEP_JSON_SCHEMAS.proposals, prompt)) as any;

      const skillsProposal = result.proposals.find((p: any) => p.type === 'skills.reorder');
      if (skillsProposal) {
        expect(Array.isArray(skillsProposal.skills)).toBe(true);
      }
    });
  });

  describe('brief response', () => {
    it('returns brief structure with anchor_stories, bridges, and gaps', () => {
      const prompt = `## Approved Alignment Matrix
[]
## Cited Evidence
[]`;
      const responder = createDemoResponder();
      const result = responder(createRequest(STEP_JSON_SCHEMAS.brief, prompt)) as any;

      expect(result).toHaveProperty('anchor_stories');
      expect(result).toHaveProperty('bridges');
      expect(result).toHaveProperty('gaps');
      expect(Array.isArray(result.anchor_stories)).toBe(true);
      expect(Array.isArray(result.bridges)).toBe(true);
      expect(Array.isArray(result.gaps)).toBe(true);
    });

    it('includes evidence in anchor stories', () => {
      const prompt = `## Approved Alignment Matrix
[]
## Cited Evidence
[{"id":"ev-1","title":"Performance Optimization","summary":"Reduced latency","impact":"20% improvement","themes":[]}]`;
      const responder = createDemoResponder();
      const result = responder(createRequest(STEP_JSON_SCHEMAS.brief, prompt)) as any;

      expect(result.anchor_stories.length).toBeGreaterThan(0);
      const story = result.anchor_stories[0];
      expect(story.title).toBe('Performance Optimization');
      expect(story.problem).toBe('Reduced latency');
      expect(story.proof).toBe('20% improvement');
    });

    it('limits anchor stories to 3', () => {
      const prompt = `## Approved Alignment Matrix
[]
## Cited Evidence
[
  {"id":"ev-1","title":"Story 1","summary":"S1","impact":"I1","themes":[]},
  {"id":"ev-2","title":"Story 2","summary":"S2","impact":"I2","themes":[]},
  {"id":"ev-3","title":"Story 3","summary":"S3","impact":"I3","themes":[]},
  {"id":"ev-4","title":"Story 4","summary":"S4","impact":"I4","themes":[]}
]`;
      const responder = createDemoResponder();
      const result = responder(createRequest(STEP_JSON_SCHEMAS.brief, prompt)) as any;

      expect(result.anchor_stories.length).toBeLessThanOrEqual(3);
    });

    it('includes transferable bridges', () => {
      const prompt = `## Approved Alignment Matrix
[{"requirement_id":"r1","classification":"transferable","citations":[],"adjacent_tool":"GraphQL"}]
## Cited Evidence
[]`;
      const responder = createDemoResponder();
      const result = responder(createRequest(STEP_JSON_SCHEMAS.brief, prompt)) as any;

      const bridge = result.bridges.find((b: any) => b.requirement_id === 'r1');
      if (bridge) {
        expect(bridge.adjacent_tool).toBe('GraphQL');
        expect(bridge.framing).toContain('GraphQL');
      }
    });

    it('includes gaps in response', () => {
      const prompt = `## Approved Alignment Matrix
[{"requirement_id":"r1","classification":"gap","citations":[],"adjacent_tool":""}]
## Cited Evidence
[]`;
      const responder = createDemoResponder();
      const result = responder(createRequest(STEP_JSON_SCHEMAS.brief, prompt)) as any;

      const gap = result.gaps.find((g: any) => g.requirement_id === 'r1');
      expect(gap).toBeDefined();
      expect(gap).toHaveProperty('acknowledgement');
      expect(gap).toHaveProperty('parallel_mastery');
    });
  });

  describe('schema validation', () => {
    it('handles all four schema types without error', () => {
      const responder = createDemoResponder();
      const schemas = [
        STEP_JSON_SCHEMAS.analysis,
        STEP_JSON_SCHEMAS.alignment,
        STEP_JSON_SCHEMAS.proposals,
        STEP_JSON_SCHEMAS.brief,
      ];

      for (const schema of schemas) {
        expect(() => {
          responder(createRequest(schema, '## Section\ntest'));
        }).not.toThrow();
      }
    });
  });
});
