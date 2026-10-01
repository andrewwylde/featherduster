import type { DraftRunArtifacts, ResumeExperience, ResumeSpec } from '@featherduster/core';
import type { DraftSyncPreview, DraftSyncResolutions } from '../../api/client';

export function fieldLabel(key: string): string {
  const labels: Record<string, string> = {
    text: 'Text', startDate: 'Start date', endDate: 'End date',
    citations: 'Evidence', included: 'Included', skills: 'Skills',
  };
  return labels[key] ?? key.replace(/([A-Z])/g, ' $1').replace(/_/g, ' ').replace(/^./, c => c.toUpperCase());
}

/** Server conflicts already identify the smallest safe field/array, including
 * manual exclusion conflicts. Apply those exact choices without re-matching. */
export function resolvedCandidate(preview: DraftSyncPreview, choices: DraftSyncResolutions): ResumeSpec {
  const candidate = structuredClone(preview.candidate);
  for (const conflict of preview.conflicts) {
    const choice = choices[conflict.id];
    if (!choice) continue;
    const keys = conflict.path.split('/').slice(1).map(key => key.replace(/~1/g, '/').replace(/~0/g, '~'));
    let parent = candidate as unknown as Record<string, unknown>;
    for (const key of keys.slice(0, -1)) parent = parent[key] as Record<string, unknown>;
    const key = keys[keys.length - 1];
    if (conflict[choice] === undefined) delete parent[key];
    else Object.defineProperty(parent, key, { value: structuredClone(conflict[choice]), writable: true, enumerable: true, configurable: true });
  }
  return candidate;
}

function Experiences({ experiences }: { experiences: ResumeExperience[] }) {
  return <div className="space-y-3">
    {experiences.map((experience, index) => <section key={index}>
      <h4 className="font-semibold">{experience.company}</h4>
      <p>{experience.role}</p>
      <p>{[experience.startDate, experience.endDate].filter(Boolean).join(' – ')}{experience.location ? ` · ${experience.location}` : ''}</p>
      <ul className="list-disc pl-5">
        {experience.bullets.map((bullet, bulletIndex) => <li key={bulletIndex}>
          <span>{bullet.text}</span>
          {!!bullet.citations?.length && <small className="block">Evidence: {bullet.citations.join(', ')}</small>}
        </li>)}
      </ul>
    </section>)}
  </div>;
}

/** Readable field values for conflict sides, never a serialized storage record. */
export function MergeValue({ value }: { value: unknown }) {
  if (value === undefined || value === null || value === '') return <p>Not provided</p>;
  if (typeof value === 'boolean') return <p>{value ? 'Yes' : 'No'}</p>;
  if (typeof value !== 'object') return <p className="whitespace-pre-wrap">{String(value)}</p>;
  if (Array.isArray(value)) {
    if (!value.length) return <p>None</p>;
    if (value.every(item => item && typeof item === 'object' && 'company' in item && Array.isArray(item.bullets))) {
      return <Experiences experiences={value as ResumeExperience[]} />;
    }
    return <ul className="list-disc space-y-2 pl-5">
      {value.map((item, index) => <li key={index}><MergeValue value={item} /></li>)}
    </ul>;
  }
  return <dl className="space-y-2">
    {Object.entries(value).map(([key, item]) => <div key={key}>
      <dt className="font-medium">{fieldLabel(key)}</dt>
      <dd><MergeValue value={item} /></dd>
    </div>)}
  </dl>;
}

export function ResumePreview({ resume }: { resume: ResumeSpec }) {
  return <div className="space-y-4 py-3">
    <section>
      <h3 className="font-semibold">{resume.profile.name}</h3>
      <p>{resume.profile.title}</p>
      <p>{[resume.profile.email, resume.profile.phone, resume.profile.location].filter(Boolean).join(' · ')}</p>
      {resume.profile.links && <MergeValue value={resume.profile.links} />}
    </section>
    <section><h3 className="font-semibold">Summary</h3><MergeValue value={resume.summary} /></section>
    <section><h3 className="font-semibold">Experience</h3><Experiences experiences={resume.experiences} /></section>
    <section><h3 className="font-semibold">Education</h3><MergeValue value={resume.education} /></section>
    <section><h3 className="font-semibold">Skills</h3><MergeValue value={resume.skills} /></section>
  </div>;
}

export function PreviousOutputs({ previous }: { previous: DraftRunArtifacts }) {
  const requirement = (id: string) => previous.analysis?.requirements.find(item => item.id === id)?.text ?? 'Previous requirement';
  const analysis = previous.analysis && {
    Company: previous.analysis.company, Role: previous.analysis.role,
    Seniority: previous.analysis.seniority, Mission: previous.analysis.mission,
    Requirements: previous.analysis.requirements.map(item => ({ Requirement: item.text, Priority: item.tier, 'Posting quote': item.quote })),
  };
  const alignment = previous.alignment?.rows.map(row => ({
    Requirement: requirement(row.requirement_id), Match: row.classification,
    Reason: row.rationale, Evidence: row.citations, 'Related tool': row.adjacent_tool,
  }));
  const proposals = previous.proposals?.proposals.map(proposal => ({
    Change: proposal.type.replace('.', ' '), Decision: proposal.decision,
    Before: proposal.before, After: proposal.edited_after ?? proposal.after,
    Skills: proposal.skills, Reason: proposal.rationale, Evidence: proposal.citations,
  }));
  const brief = previous.brief && {
    'Anchor stories': previous.brief.anchor_stories.map(story => ({
      Title: story.title, Problem: story.problem, Ownership: story.ownership,
      Proof: story.proof, Evidence: story.citations,
    })),
    'Transferable skills': previous.brief.bridges.map(bridge => ({
      Requirement: requirement(bridge.requirement_id), 'Related tool': bridge.adjacent_tool, Framing: bridge.framing,
    })),
    Gaps: previous.brief.gaps.map(gap => ({
      Requirement: requirement(gap.requirement_id), Acknowledgement: gap.acknowledgement, 'Parallel mastery': gap.parallel_mastery,
    })),
  };
  return <div className="space-y-3">
    <details><summary>Previous base resume</summary><ResumePreview resume={previous.base.spec} /></details>
    <details><summary>Previous analysis</summary><MergeValue value={analysis} /></details>
    <details><summary>Previous alignment</summary><MergeValue value={alignment} /></details>
    <details><summary>Previous proposals</summary><MergeValue value={proposals} /></details>
    <details><summary>Previous interview brief</summary><MergeValue value={brief} /></details>
  </div>;
}
