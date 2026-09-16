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

export const DEFAULT_STARTER_RESUME: ResumeSpec = {
  profile: {
    name: 'Alex Mercer',
    title: 'Staff Software Engineer / Distributed Systems',
    email: 'alex.mercer@example.com',
    phone: '+1 (555) 019-2834',
    location: 'San Francisco, CA',
    links: {
      github: 'https://github.com/alexmercer',
      linkedin: 'https://linkedin.com/in/alexmercer',
      website: 'https://alexmercer.dev',
    },
  },
  summary:
    'Staff Software Engineer specializing in distributed consensus, high-throughput edge data planes, and high-reliability cloud architecture.',
  experiences: [
    {
      company: 'CloudMatrix Technologies',
      role: 'Staff Software Engineer',
      location: 'San Francisco, CA',
      startDate: '2023-01',
      endDate: 'Present',
      bullets: [
        {
          text: 'Architected distributed token issuance mesh maintaining p99 under 8ms globally (ev-001).',
          citations: ['ev-001'],
        },
        {
          text: 'Engineered dynamic sharding controller eliminating hot-spot partition stalls across 12M tenant accounts.',
        },
      ],
    },
    {
      company: 'Apex Cloud Platforms',
      role: 'Senior Software Engineer',
      location: 'Seattle, WA',
      startDate: '2020-03',
      endDate: '2022-12',
      bullets: [
        {
          text: 'Designed multi-region Raft replication engine processing 450k op/s with zero data loss.',
        },
        {
          text: 'Led cross-functional performance guild reducing p95 database query latency by 42%.',
        },
      ],
    },
  ],
  education: [
    {
      institution: 'University of California, Berkeley',
      degree: 'B.S. in Electrical Engineering and Computer Science',
      year: '2016',
      details: 'Focus on Distributed Systems and Computer Architecture',
    },
  ],
  skills: [
    {
      category: 'Languages',
      skills: ['TypeScript', 'Go', 'Rust', 'Python', 'C++'],
    },
    {
      category: 'Distributed Systems & Cloud',
      skills: ['Kubernetes', 'Raft / Paxos', 'gRPC', 'PostgreSQL', 'AWS', 'Redis', 'Docker'],
    },
  ],
};

