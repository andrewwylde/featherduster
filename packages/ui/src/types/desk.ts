import type { EvidenceStatus } from '../theme/tokens';

export type SignalSourceType = 'pull_request' | 'project_note' | 'colleague_feedback';

export interface SignalSource {
  id: string;
  type: SignalSourceType;
  tag: string;
  title: string;
  date: string;
  description: string;
  quote?: {
    text: string;
    author: string;
  };
  url?: string;
  status: EvidenceStatus;
}

export interface NodeMapEvidence {
  id: string;
  title: string;
  status: EvidenceStatus;
  sourceIds: string[];
}

export interface StoryThread {
  id: string;
  title: string;
  status: 'active' | 'strengthened';
  evidenceIds: string[];
  summary: string;
}

export interface InterviewMessage {
  id: string;
  speaker: 'editor' | 'user';
  timestamp: string;
  headline?: string;
  body: string;
  context?: string;
  annotation?: string; // vermilion margin note
}

export interface LiveDossier {
  title: string;
  updatedAt: string;
  claim: { text: string; status: EvidenceStatus };
  situation: { text: string; status: EvidenceStatus };
  action: { text: string; status: EvidenceStatus };
  outcome: { text: string; status: EvidenceStatus; missingMetric?: boolean };
  skills: { names: string[]; status: EvidenceStatus };
  sources: Array<{ id: string; label: string; tag: string; status: EvidenceStatus }>;
  stillNeeded: string[];
}

export interface RecommendedLead {
  id: string;
  title: string;
  leadParagraph: string;
  sources: SignalSource[];
  storyThread: StoryThread;
  dossierDraft: LiveDossier;
  initialTranscript: InterviewMessage[];
}
