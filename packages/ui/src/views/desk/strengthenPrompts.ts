import type { EvidenceEntry } from '@featherduster/core';

export interface StrengthenPrompt {
  id: 'metric' | 'verify-metrics' | 'references' | 'confidence' | 'narrative';
  question: string;
  hint: string;
}

const PLACEHOLDER = /METRIC NEEDED/i;

/** Deterministic questions for the gaps actually present in an entry. No model involved. */
export function strengthenPrompts(entry: EvidenceEntry, narrative: string): StrengthenPrompt[] {
  const prompts: StrengthenPrompt[] = [];
  const text = [entry.title, entry.summary, entry.impact, narrative].join('\n');
  if (PLACEHOLDER.test(text) || entry.metrics.some((m) => PLACEHOLDER.test(m.value) || PLACEHOLDER.test(m.status))) {
    prompts.push({
      id: 'metric',
      question: 'What number shows the change?',
      hint: 'Replace [METRIC NEEDED] only with a figure you can point to. Leave it if you cannot.',
    });
  }
  if (entry.metrics.some((m) => m.status.toLowerCase() !== 'verified')) {
    prompts.push({
      id: 'verify-metrics',
      question: 'Where can each metric be verified?',
      hint: 'Add the dashboard, PR, ticket, or doc under References, then mark the metric verified.',
    });
  }
  if (entry.internal_references.length === 0) {
    prompts.push({
      id: 'references',
      question: 'Which PR, ticket, or doc shows this happened?',
      hint: 'References stay private; they are stripped from exports.',
    });
  }
  if (entry.confidence === 'provisional') {
    prompts.push({
      id: 'confidence',
      question: 'Is this shipped and confirmed?',
      hint: 'Switch confidence to verified only when the outcome is confirmed.',
    });
  }
  if (narrative.trim().length < 80) {
    prompts.push({
      id: 'narrative',
      question: 'What was the situation before, and what did you do?',
      hint: 'A few sentences of context make the entry defensible in an interview.',
    });
  }
  return prompts;
}
