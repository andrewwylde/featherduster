import { useCallback, useState } from 'react';
import type { Job } from '@featherduster/core';
import { apiClient } from '../../api/client.js';
import { useJobsData } from '../../hooks/useJobsData.js';
import { WorkerControls } from './WorkerControls.js';
import { JobIntake } from './JobIntake.js';

const filters = ['All', 'Queued', 'Preparing', 'Needs input', 'Resume ready', 'Applied', 'Archived'] as const;
export function matchesJobFilter(job: Job, filter: typeof filters[number]) {
  switch (filter) {
    case 'Queued': return job.preparation_state === 'queued';
    case 'Preparing': return job.preparation_state === 'preparing';
    case 'Needs input': return job.preparation_state === 'needs_input' || job.application_lifecycle === 'needs_input';
    case 'Resume ready': return job.preparation_state === 'resume_ready';
    case 'Applied': return job.application_lifecycle === 'submitted';
    case 'Archived': return job.preparation_state === 'skipped' || job.preparation_state === 'cancelled';
    default: return true;
  }
}
export function JobsView({ navigate }: { navigate: (path: string) => void }) {
  const load = useCallback(() => apiClient.getJobs(), []);
  const { data, error, refresh } = useJobsData(load);
  const [filter, setFilter] = useState<typeof filters[number]>('All');
  const jobs = data?.jobs.filter(job => matchesJobFilter(job, filter));
  return <div className="space-y-5">
    <h1 className="text-2xl font-bold">Jobs</h1><WorkerControls />
    <JobIntake onSaved={() => void refresh()} />
    <label>Filter jobs <select className="min-h-[44px] rounded border bg-transparent p-2" value={filter} onChange={e => setFilter(e.target.value as typeof filter)}>{filters.map(f => <option key={f}>{f}</option>)}</select></label>
    {filter === 'Archived' && <p>Skipped and cancelled jobs; records are retained.</p>}
    {error && <p role="alert">{error} <button onClick={() => void refresh()}>Retry loading jobs</button></p>}
    {!data && !error && <p role="status">Loading jobs…</p>}
    {data && !data.jobs.length && <p>No jobs yet. Preview a posting to get started.</p>}
    {!!data?.jobs.length && !jobs?.length && <p>No jobs match this filter.</p>}
    <ul className="space-y-3">{jobs?.map(job => <li key={job.id} className="rounded-lg border p-4 space-y-2 break-words">
      <h2><a className="font-semibold underline" href={`/jobs/${job.id}`} onClick={e => { if (!e.ctrlKey && !e.metaKey) { e.preventDefault(); navigate(`/jobs/${job.id}`); } }}>{job.company ?? 'Unknown company'} — {job.role ?? 'Untitled role'}</a></h2>
      <p>Preparation: {job.preparation_state} · Application: {job.application_lifecycle}</p>
      <p>{job.preparation_stage ?? 'Not assessed'}{job.state_reason ? ` — ${job.state_reason}` : ''}</p>
      <p>{job.kind === 'discovery' ? 'Discovery — select an opening' : 'Fit: Not assessed'}</p>
      <time dateTime={job.updated_at}>{job.updated_at}</time>
      {!!job.artifact_version_ids.length && <button className="block underline min-h-[44px]" onClick={() => navigate(`/jobs/${job.id}/resume`)}>Review resume</button>}
    </li>)}</ul>
  </div>;
}
