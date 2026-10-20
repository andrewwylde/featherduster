import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import yaml from 'js-yaml';
import * as C from '@featherduster/core';
import { openJobsDatabase } from '../../src/jobs/database.js';
import { JobsRepository } from '../../src/jobs/repository.js';
import { JobArtifactsService } from '../../src/jobs/artifacts.js';
import { getLatexTemplate } from '../../src/jobs/templates.js';
import { fingerprint } from '../../src/jobs/files.js';
export function semanticFixture() {
  const root = mkdtempSync(path.join(tmpdir(), 'fd-semantic-'));
  const database = openJobsDatabase(root), jobs = new JobsRepository(database), artifacts = new JobArtifactsService(jobs);
  const now = new Date().toISOString();
  const job = C.JobSchema.parse({ schema_version: 1, id: randomUUID(), workspace_id: database.workspaceId, revision: 0,
    kind: 'job', original_url: null, canonical_url: null, employer_id: null, external_job_id: null, company: 'Acme', role: 'Engineer',
    parent_discovery_id: null, posting_snapshot_id: null, preparation_state: 'saved', application_lifecycle: 'not_started',
    preparation_stage: null, base_resume_id: null, template_id: null, runner: null, policy_fingerprint: null,
    current_attempt_id: null, artifact_version_ids: [], missing_inputs: [], confirmation_provenance: [], state_reason: null, created_at: now, updated_at: now });
  jobs.createJob(job, randomUUID());
  const posting = jobs.savePostingSnapshot({ schema_version: 1, id: randomUUID(), workspace_id: job.workspace_id, job_id: job.id,
    source_kind: 'text', original_url: null, final_url: null, retrieved_at: null, captured_at: now, text: 'Build APIs', content_fingerprint: fingerprint('Build APIs') });
  const candidate: C.ResumeSpec = { profile: { name: 'Test', title: 'Engineer', email: 'test@example.com' },
    summary: 'Implemented backend services.', experiences: [], education: [], skills: [] };
  const evidence = C.EvidenceEntrySchema.parse({ id: 'ev-1', date: '2026-01-01', company: 'Acme', title: 'Server work', summary: 'Implemented server-side handlers and database queries.', confidence: 'verified', impact: '', themes: [], in_flight: false });
  const input = artifacts.captureInputs({ job_id: job.id, posting_id: posting.id, base_resume: yaml.dump(candidate),
    selected_evidence: [{ source_id: evidence.id, bytes: C.serializeEvidenceMarkdown(evidence, evidence.summary) }], privacy_rules: {},
    template: getLatexTemplate('default'), runner_configuration: { runner: 'fake', model: 'fake' },
    policy: { schema_version: 1, mode: 'candidate', output_format: 'latex', page_budget: 1, max_model_calls: 4, timeout_ms: 10000, max_repair_attempts: 0, model_retry_count: 0 } });
  return { root, database, jobs, artifacts, job, input, candidate, cleanup() { database.close(); rmSync(root, { recursive: true, force: true }); } };
}
