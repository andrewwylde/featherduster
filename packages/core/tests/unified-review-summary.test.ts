import { describe, expect, it } from 'vitest';
import {
  computeUnifiedReviewSummary,
  type JobFacts,
  type JobFact,
  type ProposalIssue,
} from '../src/index.js';

function createMockFact(overrides: Partial<JobFact> = {}): JobFact {
  return {
    claim: {
      id: 'claim-1',
      text: 'Test claim',
      fact: { subject: 's', predicate: 'p', object: 'o' },
    },
    state: 'supported',
    evidence: [{ evidence_id: 'ev-1', field: 'title', text: 'quote' }],
    explanation: 'Supported by evidence',
    resolution: null,
    passage: {
      subject: { id: 'p-1', path: 'summary' },
      text: 'Passage text',
    },
    ...overrides,
  };
}

function createMockFacts(facts: JobFact[] = [], overrides: Partial<JobFacts> = {}): JobFacts {
  return {
    job_id: 'job-1',
    job_revision: 1,
    input_fingerprint: 'fp-in',
    semantic_revision: 1,
    target: { kind: 'review', review_id: '12345678-1234-1234-1234-123456789012', review_revision: 0 },
    candidate_fingerprint: 'fp-cand',
    support_fingerprint: 'fp-supp',
    facts,
    clarifications: [],
    execution: 'complete',
    configuration_evaluated: true,
    usage: { dispatched: 0, elapsed_ms: 0, tokens: null, cost: null },
    ...overrides,
  };
}

function createMockBlockerIssue(id: string = 'issue-1'): ProposalIssue {
  return {
    id,
    subject: { kind: 'proposal', proposal_id: 'p-1' },
    group: 'grounding',
    action: 'edit_proposal',
    details: [{
      severity: 'block',
      kind: 'unsupported_experience',
      message: 'Unverified wording',
    }],
  };
}

describe('computeUnifiedReviewSummary', () => {
  describe('Primary next-action resolution (all 6 states)', () => {
    it('projects wait_checking when isChecking flag is true', () => {
      const summary = computeUnifiedReviewSummary({
        isChecking: true,
        wordingIssuesCount: 3,
        hasPdf: false,
      });
      expect(summary.primary_next_action).toBe('wait_checking');
    });

    it('projects wait_checking when facts execution is checking', () => {
      const facts = createMockFacts([], { execution: 'checking' });
      const summary = computeUnifiedReviewSummary({
        facts,
        wordingIssuesCount: 1,
      });
      expect(summary.primary_next_action).toBe('wait_checking');
    });

    it('projects wait_checking when draft has no blockers but PDF has not been generated yet', () => {
      const summary = computeUnifiedReviewSummary({
        hasPdf: false,
        isApproved: false,
      });
      expect(summary.primary_next_action).toBe('wait_checking');
    });

    it('projects answer_facts when unresolved facts need user response', () => {
      const unresolvedFact = createMockFact({
        state: 'needs_clarification',
        question: 'Did you deploy this API?',
        resolution: null,
      });
      const facts = createMockFacts([unresolvedFact]);
      const summary = computeUnifiedReviewSummary({
        facts,
        wordingIssuesCount: 2,
        hasPdf: true,
      });
      expect(summary.unresolved_facts_count).toBe(1);
      expect(summary.primary_next_action).toBe('answer_facts');
    });

    it('projects retry_technical when technical check failures exist and no human facts are pending', () => {
      const facts = createMockFacts([], {
        failures: [{
          stage: 'schema_validation',
          code: 'wire_shape_invalid',
          safe_diagnostic: 'Schema error in batch 2',
        }],
      });
      const summary = computeUnifiedReviewSummary({
        facts,
        wordingIssuesCount: 1,
        hasPdf: true,
      });
      expect(summary.technical_failures_count).toBe(1);
      expect(summary.primary_next_action).toBe('retry_technical');
    });

    it('projects fix_wording when only wording issues block completion', () => {
      const summary = computeUnifiedReviewSummary({
        wordingIssuesCount: 3,
        hasPdf: true,
      });
      expect(summary.wording_issues_count).toBe(3);
      expect(summary.primary_next_action).toBe('fix_wording');
    });

    it('projects ready_to_approve when all checks pass, PDF exists, and artifact is not yet approved', () => {
      const supportedFact = createMockFact({
        state: 'supported',
        resolution: { provenance: 'model', explanation: 'Verified' },
      });
      const facts = createMockFacts([supportedFact]);
      const summary = computeUnifiedReviewSummary({
        facts,
        hasPdf: true,
        isApproved: false,
      });
      expect(summary.unresolved_facts_count).toBe(0);
      expect(summary.wording_issues_count).toBe(0);
      expect(summary.technical_failures_count).toBe(0);
      expect(summary.primary_next_action).toBe('ready_to_approve');
    });

    it('projects review_pdf when all checks pass, PDF exists, and artifact is approved', () => {
      const summary = computeUnifiedReviewSummary({
        hasPdf: true,
        isApproved: true,
      });
      expect(summary.primary_next_action).toBe('review_pdf');
    });
  });

  describe('Count calculations and precedence', () => {
    it('prefers wordingIssuesCount parameter over issues array when provided', () => {
      const issues = [createMockBlockerIssue('issue-1'), createMockBlockerIssue('issue-2')];
      const summary = computeUnifiedReviewSummary({
        issues,
        wordingIssuesCount: 5,
      });
      expect(summary.wording_issues_count).toBe(5);
    });

    it('filters blocking issues from issues array when wordingIssuesCount is omitted', () => {
      const blocker = createMockBlockerIssue('blocker-1');
      const warning: ProposalIssue = {
        id: 'warn-1',
        subject: { kind: 'proposal', proposal_id: 'p-1' },
        group: 'formatting',
        action: 'edit_proposal',
        details: [{ severity: 'warn', kind: 'unsupported_experience', message: 'Minor warning' }],
      };
      const summary = computeUnifiedReviewSummary({
        issues: [blocker, warning],
      });
      expect(summary.wording_issues_count).toBe(1);
    });

    it('counts unresolved facts only when unresolved and answerable (needs_clarification or contradicted)', () => {
      const answerable1 = createMockFact({ state: 'needs_clarification', resolution: null });
      const answerable2 = createMockFact({ state: 'contradicted', resolution: null });
      const alreadyResolved = createMockFact({
        state: 'needs_clarification',
        resolution: { provenance: 'human', explanation: 'Confirmed' },
      });
      const unavailable = createMockFact({ state: 'unavailable', resolution: null });
      const supported = createMockFact({ state: 'supported', resolution: null });

      const facts = createMockFacts([answerable1, answerable2, alreadyResolved, unavailable, supported]);
      const summary = computeUnifiedReviewSummary({ facts });

      expect(summary.unresolved_facts_count).toBe(2);
      expect(summary.total_claims_count).toBe(5);
      expect(summary.supported_claims_count).toBe(2); // alreadyResolved + supported
      expect(summary.technical_failures_count).toBe(1); // unavailable
    });

    it('preserves prior supported claims and total claims counts while checking is active', () => {
      const supported1 = createMockFact({ state: 'supported' });
      const supported2 = createMockFact({ resolution: { provenance: 'human', explanation: 'Yes' } });
      const facts = createMockFacts([supported1, supported2], { execution: 'checking' });

      const summary = computeUnifiedReviewSummary({
        facts,
        isChecking: true,
      });

      expect(summary.supported_claims_count).toBe(2);
      expect(summary.total_claims_count).toBe(2);
      expect(summary.primary_next_action).toBe('wait_checking');
    });

    it('gives precedence to batch failures over unavailable facts for technical failures', () => {
      const unavailableFact = createMockFact({ state: 'unavailable', resolution: null });
      const facts = createMockFacts([unavailableFact], {
        failures: [
          { stage: 'schema_validation', code: 'wire_shape_invalid', safe_diagnostic: 'Batch 1 failed' },
          { stage: 'timeout', code: 'timeout', safe_diagnostic: 'Batch 2 timed out' },
        ],
      });
      const summary = computeUnifiedReviewSummary({ facts });
      expect(summary.technical_failures_count).toBe(2);
    });
  });
});
