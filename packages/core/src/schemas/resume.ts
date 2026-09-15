import { z } from 'zod';

export const ResumeLinksSchema = z
  .object({
    github: z.string().optional(),
    linkedin: z.string().optional(),
    website: z.string().optional(),
  })
  .catchall(z.string().optional());
export type ResumeLinks = z.infer<typeof ResumeLinksSchema>;

export const ResumeProfileSchema = z.object({
  name: z.string().min(1),
  title: z.string().min(1),
  email: z.string().min(1),
  phone: z.string().optional(),
  location: z.string().optional(),
  links: ResumeLinksSchema.optional(),
});
export type ResumeProfile = z.infer<typeof ResumeProfileSchema>;

export const ResumeBulletSchema = z.object({
  text: z.string().min(1),
  citations: z.array(z.string()).optional(),
});
export type ResumeBullet = z.infer<typeof ResumeBulletSchema>;

export const ResumeExperienceSchema = z.object({
  company: z.string().min(1),
  role: z.string().min(1),
  location: z.string().optional(),
  startDate: z.string().min(1),
  endDate: z.string().min(1),
  bullets: z.array(ResumeBulletSchema).default([]),
});
export type ResumeExperience = z.infer<typeof ResumeExperienceSchema>;

export const ResumeEducationSchema = z.object({
  institution: z.string().min(1),
  degree: z.string().min(1),
  year: z.union([z.string(), z.number()]).transform((val) => String(val)),
  details: z.string().optional(),
});
export type ResumeEducation = z.infer<typeof ResumeEducationSchema>;

export const ResumeSkillGroupSchema = z.object({
  category: z.string().min(1),
  skills: z.array(z.string()),
});
export type ResumeSkillGroup = z.infer<typeof ResumeSkillGroupSchema>;

export const ResumeSpecSchema = z.object({
  profile: ResumeProfileSchema,
  summary: z.string().optional(),
  experiences: z.array(ResumeExperienceSchema).default([]),
  education: z.array(ResumeEducationSchema).default([]),
  skills: z.array(ResumeSkillGroupSchema).default([]),
});
export type ResumeSpec = z.infer<typeof ResumeSpecSchema>;
