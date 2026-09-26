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
  challenge?: string;
  intervention?: string;
  metric?: string;
  themes?: string[];
}

export interface StoryThread {
  id: string;
  title: string;
  status: 'active' | 'strengthened';
  evidenceIds: string[];
  summary: string;
}
