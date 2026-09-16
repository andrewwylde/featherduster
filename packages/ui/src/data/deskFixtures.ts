import type {
  RecommendedLead,
  SignalSource,
  NodeMapEvidence,
  StoryThread,
  LiveDossier,
  InterviewMessage,
} from '../types/desk';

export const initialSources: SignalSource[] = [
  {
    id: 'src-pr-4821',
    type: 'pull_request',
    tag: 'platform / infra #4821',
    title: 'Add automated failover for job workers',
    date: 'Oct 14, 2024',
    description:
      'Introduces health checks and automatic failover, reducing manual intervention during worker outages.',
    quote: {
      text: 'This will save us a lot of 3 a.m. pages. Great design and clear rollback plan.',
      author: 'Reviewer',
    },
    url: 'https://github.com/org/platform/pull/4821',
    status: 'remembered',
  },
  {
    id: 'src-note-incident',
    type: 'project_note',
    tag: 'Reliability initiative',
    title: 'Post-incident improvements',
    date: 'Sep 3, 2024',
    description:
      'Captured key learnings from the service disruption and proposed follow up actions. Includes runbook updates and monitoring gaps.',
    quote: {
      text: 'Strong analysis and practical next steps. This raised the bar for how we do post-incident reviews.',
      author: 'Engineering manager',
    },
    url: '#',
    status: 'missing_proof',
  },
  {
    id: 'src-feedback-priya',
    type: 'colleague_feedback',
    tag: 'From Priya Shah',
    title: 'Leadership during the outage',
    date: 'Aug 21, 2024',
    description:
      'Kept the team calm, coordinated across teams, and drove a clear plan to restore service.',
    quote: {
      text: 'You brought clarity when things were chaotic, and made space for everyone to contribute.',
      author: 'Priya Shah',
    },
    url: '#',
    status: 'remembered',
  },
];

export const initialNodeMapEvidence: NodeMapEvidence[] = [
  {
    id: 'ev-resilience',
    title: 'Improved system resilience',
    status: 'verified',
    sourceIds: ['src-pr-4821'],
  },
  {
    id: 'ev-ops',
    title: 'Operational ownership',
    status: 'remembered',
    sourceIds: ['src-note-incident'],
  },
  {
    id: 'ev-trust',
    title: 'Trusted by teammates',
    status: 'remembered',
    sourceIds: ['src-feedback-priya'],
  },
];

export const initialStoryThreads: StoryThread[] = [
  {
    id: 'thread-reliability',
    title: 'Reliability leadership',
    status: 'active',
    evidenceIds: ['ev-resilience', 'ev-ops', 'ev-trust'],
    summary: 'Infrastructure resilience, operational ownership, and crisis response',
  },
  {
    id: 'thread-architecture',
    title: 'Distributed API architecture',
    status: 'active',
    evidenceIds: ['ev-resilience'],
    summary: 'Multi-service decoupling and token protocol modernization',
  },
];

export const initialDossierDraft: LiveDossier = {
  title: 'Evidence draft',
  updatedAt: 'Autosaved 2 minutes ago',
  claim: {
    text: 'You demonstrate reliability leadership by improving systems, driving operational excellence, and earning trust during high-stakes situations.',
    status: 'verified',
  },
  situation: {
    text: 'Routine worker failures were triggering manual intervention, which caused unnecessary pages and disrupted focus for the on-call engineer.',
    status: 'remembered',
  },
  action: {
    text: 'Added automated failover and health checks to recover from routine worker failures without manual intervention.',
    status: 'remembered',
  },
  outcome: {
    text: 'We stopped waking someone for routine worker failures, reducing pager noise and allowing the team to focus on real incidents. This happened about [METRIC NEEDED].',
    status: 'missing_proof',
    missingMetric: true,
  },
  skills: {
    names: [
      'Reliability engineering',
      'Incident response',
      'Automation',
      'Operational excellence',
      'Systems thinking',
    ],
    status: 'remembered',
  },
  sources: [
    {
      id: 'src-pr-4821',
      label: 'Pull request #4821',
      tag: 'platform / infra',
      status: 'remembered',
    },
    {
      id: 'src-note-incident',
      label: 'Incident review notes',
      tag: 'Reliability initiative',
      status: 'missing_proof',
    },
  ],
  stillNeeded: [
    'Larger scale impact (e.g. org wide reliability initiative)',
    'Quantitative outcomes (e.g. uptime, MTTR)',
  ],
};

export const initialTranscript: InterviewMessage[] = [
  {
    id: 'msg-1',
    speaker: 'editor',
    timestamp: '10:03 AM',
    headline: 'What changed because of your work?',
    context:
      'Focus on the difference your work made. You can reference systems, teams, customers, or operational outcomes.',
    body: '',
  },
  {
    id: 'msg-2',
    speaker: 'user',
    timestamp: '10:05 AM',
    headline: 'We stopped waking someone for routine worker failures.',
    body: 'We added automated failover and health checks so that routine worker failures recover without manual intervention. This reduced pager noise and let the team focus on real incidents.',
    annotation: 'Strong start. Consider adding how often this happened and a source.',
  },
  {
    id: 'msg-3',
    speaker: 'editor',
    timestamp: '10:07 AM',
    headline: 'How often was that happening, and where could we verify it?',
    context:
      'If you have numbers, share them. If not, tell me where we could find them (e.g. incident reviews, monitoring data, or a pull request).',
    body: '',
  },
];

export const initialLead: RecommendedLead = {
  id: 'lead-reliability',
  title: 'A reliability story may be taking shape.',
  leadParagraph:
    "You've shipped infrastructure improvements, documented operational learnings, and earned positive feedback. These signals point to growing reliability leadership. Here are three recent sources that stand out.",
  sources: initialSources,
  storyThread: initialStoryThreads[0],
  dossierDraft: initialDossierDraft,
  initialTranscript,
};
