import { LevelingRubric } from '../../schemas/rubric.js';

export const INDUSTRY_SWE_IC_RUBRIC: LevelingRubric = {
  id: 'us-industry-swe-ic',
  title: 'U.S. Industry Software Engineering (IC) Leveling Framework',
  target_level: 'Senior',
  levels: [
    { id: 'Junior', name: 'Junior Software Engineer' },
    { id: 'Mid-level', name: 'Mid-Level Software Engineer' },
    { id: 'Senior', name: 'Senior Software Engineer' },
    { id: 'Staff', name: 'Staff Software Engineer' },
    { id: 'Principal', name: 'Principal Software Engineer' },
  ],
  competencies: [
    {
      id: 'scope-problem-complexity',
      name: 'Scope & Problem Complexity',
      levels: {
        Junior:
          'Completes well-defined tasks with guidance while building familiarity with the codebase, tooling, and team processes. Shows increasing independence on scoped problems as they grow.',
        'Mid-level':
          'Delivers features independently, participates in design discussions, reviews code, and improves existing components. Owns small-to-medium scoped problems end-to-end.',
        Senior:
          'Leads development of complex features and systems end-to-end, makes architectural tradeoffs, raises engineering quality, mentors others, and drives delivery across multiple engineers and stakeholders.',
        Staff:
          'Solves high-impact, ambiguous problems, leads cross-team technical initiatives, and sets direction for significant areas of the product or platform. Coaches senior engineers and partners closely with product/leadership.',
        Principal:
          'Defines long-term technical vision and guides large-scale system evolution. Sets standards that shape the engineering organization and influences company-wide strategy through technical leadership and decision-making.',
      },
    },
    {
      id: 'autonomy-execution',
      name: 'Execution & Autonomy',
      levels: {
        Junior:
          'Works with guidance; focuses on learning codebase, execution hygiene, task estimation, and steadily increasing independence on assigned deliverables.',
        'Mid-level':
          'Largely self-directed on scoped work; drives feature delivery from kickoff to testing and rollout, sharpens estimation, and takes direct ownership of project outcomes.',
        Senior:
          'Self-directed across multiple people and stakeholders; navigates technical ambiguity, balances velocity with technical debt, and drives operational excellence and project milestones.',
        Staff:
          'Drives cross-team initiatives autonomously; navigates organizational ambiguity, aligns cross-functional stakeholders, and builds leverage via platforms, standards, and enablement.',
        Principal:
          'Operates with total strategic autonomy; sets company-wide technical strategy, eliminates systemic organizational bottlenecks, and creates durable engineering practices at scale.',
      },
    },
    {
      id: 'craft-system-design',
      name: 'System Design & Craft Depth',
      levels: {
        Junior:
          'Focuses on fundamentals: methodical debugging, testing, clean readable code, and code-review hygiene while working effectively within team processes.',
        'Mid-level':
          'Focuses on maintainability, reliability basics, performance, sound tradeoffs on scoped components, and thoughtful integration of third-party libraries and services.',
        Senior:
          'Deep system-design expertise and architectural judgment; evaluates competing tradeoffs, anticipates failure modes, and leads complex refactors or service migrations.',
        Staff:
          'Designs distributed systems at scale; addresses systemic scalability bottlenecks, defines org-wide architectural patterns, and sets durable technical standards.',
        Principal:
          'Defines foundational technology choices, multi-year architecture, and global reliability and data strategies across multiple product lines and platforms.',
      },
    },
    {
      id: 'leadership-mentorship',
      name: 'Technical Leadership & Mentorship',
      levels: {
        Junior:
          'Demonstrates solid fundamentals, strong coachability, asks good clarifying questions, and actively engages in team processes and peer code reviews.',
        'Mid-level':
          'Conducts constructive code reviews, mentors junior engineers, collaborates effectively with cross-functional partners, and contributes to team knowledge sharing.',
        Senior:
          'Mentors and coaches engineers across the team; leads technical design reviews, sets code and operational quality standards, and coordinates delivery across teams.',
        Staff:
          'Coaches senior engineers and partners closely with product leadership; operates across Staff archetypes (Tech Lead, Architect, Solver, Right Hand) to multiply engineering leverage.',
        Principal:
          'Recognized company-wide technical authority; advises executive leadership, shapes engineering culture and hiring bars, sponsors emerging technical leaders, and mentors Staff+ talent.',
      },
    },
    {
      id: 'interview-signals-calibration',
      name: 'Interview Signals & Behavioral Calibration',
      levels: {
        Junior:
          'Signals: Solid fundamentals, coachability, clean code, asks good questions. Story: A bug debugged methodically, or a feature shipped and learned from. Pitfall to avoid: Over-explaining basics; not knowing why a choice was made.',
        'Mid-level':
          'Signals: Independent delivery, sound tradeoffs on scoped work, reliability awareness. Story: A feature owned end-to-end, including testing and rollout. Pitfall to avoid: Describing tasks instead of decisions; no ownership of outcomes.',
        Senior:
          'Signals: System-design depth, architectural tradeoffs, raising team quality, mentoring. Story: A complex system led with tradeoffs weighed and why. Pitfall to avoid: Going broad but shallow; cannot quantify impact or justify alternatives.',
        Staff:
          'Signals: Cross-team influence, ambiguity navigation, leverage, technical strategy. Story: An ambiguous, org-spanning problem scoped and driven to resolution. Pitfall to avoid: Staying in the IC weeds; no evidence of multiplying others’ work.',
        Principal:
          'Signals: Org-shaping vision, durable standards, company-wide judgment. Story: A platform/standard defined that changed how many teams work. Pitfall to avoid: Vision with no execution; influence claims without measurable adoption.',
      },
    },
    {
      id: 'representative-projects',
      name: 'Representative Project Scope',
      levels: {
        Junior:
          'Implement a small feature (e.g., add a UI button that triggers an API call, including basic frontend changes, a straightforward backend handler, and standard error handling).',
        'Mid-level':
          'Build an authentication flow (login / registration / password reset), integrating a library or service, handling security considerations, instrumenting key metrics, and resolving performance issues.',
        Senior:
          'Lead a refactor from a monolith to multiple services: define boundaries and APIs, plan migrations, preserve contracts, reduce risk, and coordinate rollout across teams.',
        Staff:
          'Drive a data-store migration to address scalability bottlenecks (e.g., PostgreSQL → distributed NoSQL system), coordinate engineering/product/DevOps, manage correctness, and execute phased rollout with rollback plans.',
        Principal:
          'Define and drive adoption of a company-wide framework or platform (e.g., standardizing service templates, observability, or a cloud migration) impacting hundreds of engineers and multiple product lines.',
      },
    },
  ],
};
