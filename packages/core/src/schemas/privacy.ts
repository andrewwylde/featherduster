import { z } from 'zod';

export const ReplacementRuleSchema = z.object({
  search: z.string(),
  replace: z.string(),
});
export type ReplacementRule = z.infer<typeof ReplacementRuleSchema>;

export const PrivacyRulesConfigSchema = z.object({
  strip_patterns: z.array(z.string()).default([]),
  replacements: z.array(ReplacementRuleSchema).default([]),
  banned_keywords: z.array(z.string()).default([]),
});
export type PrivacyRulesConfig = z.infer<typeof PrivacyRulesConfigSchema>;

export const PrivacyRulesSchema = z.object({
  rules: PrivacyRulesConfigSchema,
});
export type PrivacyRules = z.infer<typeof PrivacyRulesSchema>;
