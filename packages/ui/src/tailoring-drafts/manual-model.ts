import { ManualDraftPayloadSchema, type ManualDraftPayload, type ResumeSpec } from '@featherduster/core';

/** Called only when choosing a new source. Recovery restores this payload directly. */
export function manualFromSpec(spec: ResumeSpec, selectedResumeId: string, makeId: () => string = () => crypto.randomUUID()): ManualDraftPayload {
  return ManualDraftPayloadSchema.parse({
    profile: spec.profile, summary: spec.summary ?? '',
    experiences: spec.experiences.map(experience => ({ ...experience, id: makeId(), bullets: experience.bullets.map(bullet => ({ ...bullet, id: makeId(), included: true })) })),
    education: spec.education ?? [], skills: spec.skills ?? [],
    jobDescription: '', selectedResumeId, squeezeMode: false,
  });
}

/** Export projection only: never use this lossy representation for recovery. */
export function manualToSpec(payload: ManualDraftPayload): ResumeSpec {
  return {
    profile: payload.profile, summary: payload.summary,
    experiences: payload.experiences.map(({ id: _id, bullets, ...experience }) => ({ ...experience, bullets: bullets.filter(bullet => bullet.included).map(({ id: _bulletId, included: _included, ...bullet }) => bullet) })),
    education: payload.education, skills: payload.skills,
  };
}
