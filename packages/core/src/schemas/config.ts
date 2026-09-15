import { z } from 'zod';

export const WorkspaceConfigSchema = z.object({
  active_profile: z.string(),
  default_export_target: z.string(),
  port: z.number().int().positive().default(4173),
});
export type WorkspaceConfig = z.infer<typeof WorkspaceConfigSchema>;
