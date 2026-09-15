import { z } from 'zod';

export const RubricLevelSchema = z.object({
  id: z.string(),
  name: z.string(),
});
export type RubricLevel = z.infer<typeof RubricLevelSchema>;

export const EvidenceMappingSchema = z.object({
  ev_id: z.string(),
  relevance: z.string(),
  narrative: z.string().optional(),
});
export type EvidenceMapping = z.infer<typeof EvidenceMappingSchema>;

export const RubricCompetencySchema = z.object({
  id: z.string(),
  name: z.string(),
  levels: z.record(z.string(), z.string()),
  evidence_mapped: z.array(EvidenceMappingSchema).optional(),
});
export type RubricCompetency = z.infer<typeof RubricCompetencySchema>;

export const LevelingRubricSchema = z.object({
  id: z.string(),
  title: z.string(),
  target_level: z.string(),
  levels: z.array(RubricLevelSchema),
  competencies: z.array(RubricCompetencySchema),
});
export type LevelingRubric = z.infer<typeof LevelingRubricSchema>;
