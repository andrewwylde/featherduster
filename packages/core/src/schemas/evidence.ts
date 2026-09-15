import { z } from 'zod';

export const ConfidenceLevelSchema = z.enum(['verified', 'provisional', 'retracted']);
export type ConfidenceLevel = z.infer<typeof ConfidenceLevelSchema>;

export const MetricEntrySchema = z.object({
  name: z.string(),
  value: z.string(),
  status: z.string(),
});
export type MetricEntry = z.infer<typeof MetricEntrySchema>;

export const InternalReferenceSchema = z.object({
  type: z.string(),
  ref: z.string(),
});
export type InternalReference = z.infer<typeof InternalReferenceSchema>;

export const EvidenceEntrySchema = z.object({
  id: z.string(),
  date: z.string(),
  company: z.string(),
  title: z.string(),
  summary: z.string(),
  impact: z.string(),
  themes: z.array(z.string()),
  confidence: ConfidenceLevelSchema,
  in_flight: z.boolean(),
  metrics: z.array(MetricEntrySchema).default([]),
  internal_references: z.array(InternalReferenceSchema).default([]),
});
export type EvidenceEntry = z.infer<typeof EvidenceEntrySchema>;
