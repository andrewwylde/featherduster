// packages/core/src/jobs/draft-content.ts
import { z } from 'zod';
import { ResumeSpecSchema, ResumeProfileSchema, ResumeExperienceSchema,
  ResumeBulletSchema, ResumeEducationSchema, ResumeSkillGroupSchema } from '../schemas/resume.js';
export const DraftResumeSpecSchema = ResumeSpecSchema.extend({
  profile: ResumeProfileSchema.extend({ name: z.string(), title: z.string(), email: z.string() }),
  experiences: z.array(ResumeExperienceSchema.extend({
    company: z.string(), role: z.string(), startDate: z.string(), endDate: z.string(),
    bullets: z.array(ResumeBulletSchema.extend({ text: z.string() })).default([]),
  })).default([]),
  education: z.array(ResumeEducationSchema.extend({ institution: z.string(), degree: z.string() })).default([]),
  skills: z.array(ResumeSkillGroupSchema.extend({ category: z.string() })).default([]),
});

