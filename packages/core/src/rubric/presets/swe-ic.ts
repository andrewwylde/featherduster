import { LevelingRubric } from '../../schemas/rubric.js';

export const SWE_IC_RUBRIC: LevelingRubric = {
  id: 'swe-ic-ladder',
  title: 'Software Engineering Individual Contributor (SWE IC) Leveling Rubric',
  target_level: 'L4',
  levels: [
    { id: 'L3', name: 'Software Engineer II (Junior / Mid-Level)' },
    { id: 'L4', name: 'Senior Software Engineer' },
    { id: 'L5', name: 'Staff Software Engineer / Tech Lead' },
    { id: 'L6', name: 'Principal Software Engineer' },
  ],
  competencies: [
    {
      id: 'system-architecture-scope',
      name: 'System Architecture & Scope',
      levels: {
        L3: 'Designs and implements components or features within an existing service architecture with minimal guidance.',
        L4: 'Designs end-to-end services and subsystems; evaluates technical trade-offs and anticipates failure modes.',
        L5: 'Architects multi-service platforms and distributed systems; sets organizational design standards and resolves high-ambiguity trade-offs.',
        L6: 'Defines company-wide architectural strategy, multi-year technical vision, and foundational technology choices across organizations.',
      },
    },
    {
      id: 'execution-delivery',
      name: 'Execution & Delivery',
      levels: {
        L3: 'Consistently delivers well-tested, high-quality PRs on schedule; breaks down medium tasks into actionable deliverables.',
        L4: 'Drives complex multi-month milestones to completion; proactively unblocks team members and mitigates project risks.',
        L5: 'Orchestrates cross-team, multi-quarter initiatives; balances velocity with technical debt and ensures sustainable delivery.',
        L6: 'Drives multi-year company-critical strategic programs; unblocks org-wide bottlenecks and establishes engineering excellence benchmarks.',
      },
    },
    {
      id: 'technical-leadership-mentorship',
      name: 'Technical Leadership & Mentorship',
      levels: {
        L3: 'Participates actively in code reviews, writes clear technical documentation, and supports onboarding teammates.',
        L4: 'Mentors junior and mid-level engineers; leads sprint design reviews and raises code quality across the team.',
        L5: 'Serves as Tech Lead across multiple teams; sponsors senior engineers for promotion; aligns engineering goals with business objectives.',
        L6: 'Recognized technical authority across the company; shapes engineering culture, hiring bars, and advises executive leadership.',
      },
    },
    {
      id: 'reliability-operations',
      name: 'Reliability & Operations',
      levels: {
        L3: 'Monitors services, responds to alerts during on-call rotation, and writes comprehensive unit and integration tests.',
        L4: 'Defines SLOs/SLIs, conducts thorough post-mortems with blameless root cause analysis, and drives operational hardening.',
        L5: 'Establishes incident management frameworks and disaster recovery protocols; drives systemic resilience across production systems.',
        L6: 'Defines org-wide availability and business continuity strategies; drives architectural fault tolerance against catastrophic outages.',
      },
    },
  ],
};
