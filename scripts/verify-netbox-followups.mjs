#!/usr/bin/env node
// Comprehensive Suite & Delivery Verification Script
// Programmatically exercises the 13 acceptance scenarios from docs/implementation/netbox-followups/README.md

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { chromium } from 'playwright';

const cliRequire = createRequire(new URL('../packages/cli/package.json', import.meta.url));
const yaml = cliRequire('js-yaml');
const { serve } = cliRequire('@hono/node-server');

// Core and CLI imports from dist
import * as C from '../packages/core/dist/index.js';
import {
  bindReviewFinding,
  computeArtifactChanges,
  validateProposalClaimCoverage,
  synthesizeExperienceBullets,
} from '../packages/core/dist/index.js';

import { createApp, loadResumeSpecsFromPaths, resolveResume, normalizeResumeId } from '../packages/cli/dist/server.js';
import { initWorkspace } from '../packages/cli/dist/commands/init.js';
import { createJobsRuntime } from '../packages/cli/dist/jobs/runtime.js';
import { openJobsDatabase } from '../packages/cli/dist/jobs/database.js';
import { JobsRepository } from '../packages/cli/dist/jobs/repository.js';
import { JobArtifactsService } from '../packages/cli/dist/jobs/artifacts.js';
import { JobDraftRepository } from '../packages/cli/dist/tailoring/drafts/repository.js';
import { CorpusRepository } from '../packages/cli/dist/corpus/repository.js';
import { CorpusService } from '../packages/cli/dist/corpus/service.js';
import { JobSemanticService, SemanticService } from '../packages/cli/dist/jobs/semantic-service.js';
import { ProposalService } from '../packages/cli/dist/jobs/proposal-service.js';
import { ProposalRepository } from '../packages/cli/dist/jobs/proposal-repository.js';
import { JobPreparation } from '../packages/cli/dist/jobs/preparation.js';
import { JobsService } from '../packages/cli/dist/jobs/service.js';
import { affectedClarificationDrafts } from '../packages/cli/dist/jobs/clarification-updates.js';
import { createScopedWatcher } from '../packages/cli/dist/watcher.js';
import { extractPostingMetadata } from '../packages/cli/dist/jobs/posting-extractor.js';
import { fingerprint } from '../packages/cli/dist/jobs/files.js';
import { getLatexTemplate } from '../packages/cli/dist/jobs/templates.js';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function cleanDir(dir) {
  for (let attempt = 0; attempt < 10; attempt++) {
    try {
      if (fs.existsSync(dir)) {
        fs.rmSync(dir, { recursive: true, force: true });
      }
      return;
    } catch {
      await sleep(100);
    }
  }
}

async function runScenario1() {
  // Scenario 1: 52 saved jobs, 37 PDFs, 4 confirmations -> no correction scan latency spike
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'verify-s1-'));
  const time = '2026-11-08T12:00:00.000Z';
  const spec = {
    profile: { name: 'Test', title: 'Engineer', email: 'test@example.com' },
    experiences: [{ company: 'Acme', role: 'Engineer', startDate: '2020', endDate: 'Present', bullets: [{ text: 'Built feature.', citations: [] }] }],
    education: [], skills: [],
  };

  const runtime = createJobsRuntime(root, {
    automaticDrain: false,
    loadResumes: () => [{ id: 'base', type: 'template', filePath: 'base.json', spec }],
    loadEvidence: () => new C.EvidenceStore(),
    loadPrivacyRules: () => ({}),
    runnerFactory: () => ({ id: 'fake', model: 'fixture', label: 'Fixture', locality: 'local', detect: async () => ({ available: true, detail: '' }), run: async () => ({}) }),
  });

  const repo = runtime.repository;
  const db = repo.database;
  const artifacts = runtime.artifacts;
  const drafts = new JobDraftRepository(repo);
  const corpusRepo = runtime.corpus.repository;

  try {
    // 4 standard confirmations without superseding corrections
    for (let c = 1; c <= 4; c++) {
      const workId = fingerprint(JSON.stringify(['Company', `Role ${c}`, '2020', '2022', [`ev-${c}`]]));
      const clar = {
        schema_version: 1, id: randomUUID(), job_id: randomUUID(), input_snapshot_id: randomUUID(), revision: 0,
        kind: 'confirmation', fact: { work_id: workId, predicate: 'feature-identity', qualifiers: [] }, claim_ids: [`claim-${c}`],
        question: `Confirm fact ${c}?`, assertion: `Confirmed answer ${c}`,
        actor: 'user', recorded_at: time, source_ids: [`ev-${c}`], confirmed: true,
        confirmed_claims: [`Confirmed claim ${c}`], supersedes: null,
      };
      const feedback = {
        schema_version: 1, id: randomUUID(), workspace_id: db.workspaceId,
        job_id: null, proposal_id: null, review_revision: null, kind: 'fact',
        before: `Claim ${c}`, after: `Confirmed answer ${c}`,
        explanation: `Confirmation ${c}`, recorded_at: time,
        scope: { kind: 'project', key: workId }, recorded_by: 'local-human',
      };
      corpusRepo.apply(feedback, {
        kind: 'clarification',
        value: {
          scope: { kind: 'project', key: workId },
          clarification: clar,
          sources: [{ evidence_id: `ev-${c}`, evidence_fingerprint: fingerprint(`ev-${c}`), quote: `Confirmed claim ${c}` }],
          explanation: `Confirmation ${c}`,
        },
      }, c === 1 ? 0 : c - 1, null);
    }

    // 52 saved jobs (37 with PDF artifacts, 15 without)
    for (let i = 1; i <= 52; i++) {
      const jobId = randomUUID();
      const job = {
        schema_version: 1, id: jobId, workspace_id: db.workspaceId, revision: 0, kind: 'job',
        original_url: null, canonical_url: null, employer_id: null, external_job_id: null, company: `Co ${i}`, role: `Role ${i}`,
        parent_discovery_id: null, posting_snapshot_id: null, preparation_state: i <= 37 ? 'queued' : 'saved', application_lifecycle: 'not_started',
        preparation_stage: null, base_resume_id: null, template_id: null, runner: null, policy_fingerprint: null,
        current_attempt_id: null, artifact_version_ids: [], missing_inputs: [], confirmation_provenance: [], state_reason: null,
        created_at: time, updated_at: time,
      };
      repo.createJob(job, `create:${i}`);

      if (i <= 37) {
        const posting = repo.savePostingSnapshot({ schema_version: 1, id: randomUUID(), workspace_id: db.workspaceId, job_id: jobId, source_kind: 'text', original_url: null, final_url: null, retrieved_at: null, captured_at: time, text: `Posting ${i}`, content_fingerprint: fingerprint(`Posting ${i}`) });
        const input = artifacts.captureInputs({ job_id: jobId, posting_id: posting.id, base_resume: yaml.dump(spec), selected_evidence: [], privacy_rules: {}, template: getLatexTemplate('default'), runner_configuration: { runner: 'test', model: 'fixture' }, policy: { schema_version: 1, mode: 'manual', output_format: 'latex', page_budget: 1, max_model_calls: 1, timeout_ms: 1000, max_repair_attempts: 0, model_retry_count: 0 } });
        const draft = drafts.create({ schema_version: 1, id: randomUUID(), workspace_id: db.workspaceId, job_id: jobId, revision: 0, input_snapshot_id: input.id, parent_artifact_version_id: null, candidate: spec, proposals: { proposals: [] }, created_at: time, updated_at: time });
        const attempt = repo.claimJob({ job_id: jobId, input_snapshot_id: input.id, mode: 'manual', stop_generation: 0, lease_ms: 10000, idempotency_key: randomUUID() }).result;
        artifacts.publishCandidate({ draft_id: draft.id, expected_draft_revision: 0, fence: { attempt_id: attempt.id, owner_token: attempt.owner_token, stop_generation: 0 }, source: 'tex', pdf: `pdf bytes ${i}`, previews: ['preview png'], validation_report: '{}', validation_result: 'passed' });
        db.db.prepare("UPDATE attempts SET status='completed' WHERE id=?").run(attempt.id);
      }
    }

    let pdfBytesRead = 0;
    const origReadArtifact = runtime.repository.database.files.readArtifact.bind(runtime.repository.database.files);
    runtime.repository.database.files.readArtifact = (ref, jobId, id) => {
      if (String(ref.id).endsWith('.pdf')) pdfBytesRead++;
      return origReadArtifact(ref, jobId, id);
    };

    const start = performance.now();
    const result = affectedClarificationDrafts(runtime);
    const duration = performance.now() - start;

    assert.equal(result.jobs.length, 0, 'No-correction discovery must return 0 jobs');
    assert.equal(pdfBytesRead, 0, 'No PDF bytes should be read when there are no corrections');
    assert.ok(duration < 250, `Discovery took ${duration.toFixed(1)}ms; should be virtually instantaneous without corrections`);

    console.log(`[PASS] Scenario 1: 52 saved jobs, 37 PDFs, 4 confirmations -> no correction scan latency spike (${duration.toFixed(2)}ms, 0 PDF reads)`);
  } finally {
    await runtime.dispose();
    await cleanDir(root);
  }
}

async function runScenario2() {
  // Scenario 2: 1 correction among 52 jobs -> bounded discovery, no PDF bytes read
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'verify-s2-'));
  const time = '2026-11-08T12:00:00.000Z';
  const spec = {
    profile: { name: 'Test', title: 'Engineer', email: 'test@example.com' },
    experiences: [{ company: 'Acme', role: 'Engineer', startDate: '2020', endDate: 'Present', bullets: [{ text: 'Implemented AI Analytics.', citations: ['ev-work'] }] }],
    education: [], skills: [],
  };
  const evidence = new C.EvidenceStore();
  evidence.add({
    id: 'ev-work', date: '2026-01-01', company: 'Acme', title: 'Work record', summary: 'Implemented Time Spend reporting.',
    impact: 'Documented work', themes: [], confidence: 'verified', in_flight: false, metrics: [], internal_references: [],
  }, 'Implemented Time Spend reporting.');

  const runtime = createJobsRuntime(root, {
    automaticDrain: false,
    loadResumes: () => [{ id: 'base', type: 'template', filePath: 'base.json', spec }],
    loadEvidence: () => evidence,
    loadPrivacyRules: () => ({}),
    runnerFactory: () => ({ id: 'fake', model: 'fixture', label: 'Fixture', locality: 'local', detect: async () => ({ available: true, detail: '' }), run: async () => ({}) }),
  });

  const repo = runtime.repository;
  const db = repo.database;
  const artifacts = runtime.artifacts;
  const drafts = new JobDraftRepository(repo);
  const corpusRepo = runtime.corpus.repository;

  try {
    const workId = fingerprint(JSON.stringify(['Acme', 'Engineer', '2020', 'Present', ['ev-work']]));
    const initialClarification = {
      schema_version: 1, id: randomUUID(), job_id: randomUUID(), input_snapshot_id: randomUUID(), revision: 0,
      kind: 'confirmation', fact: { work_id: workId, predicate: 'feature-identity', qualifiers: [] }, claim_ids: ['claim-1'],
      question: 'Is this the same work?', assertion: 'AI Analytics was our name for this reporting feature.',
      actor: 'user', recorded_at: time, source_ids: ['ev-work'], confirmed: true,
      confirmed_claims: ['Implemented AI Analytics.'], supersedes: null,
    };
    const feedback1 = {
      schema_version: 1, id: randomUUID(), workspace_id: db.workspaceId,
      job_id: null, proposal_id: null, review_revision: null, kind: 'fact',
      before: 'AI Analytics was our name for this reporting feature.',
      after: 'AI Analytics was our name for this reporting feature.',
      explanation: 'Initial confirmation', recorded_at: time,
      scope: { kind: 'project', key: workId }, recorded_by: 'local-human',
    };
    const u1 = corpusRepo.apply(feedback1, {
      kind: 'clarification',
      value: {
        scope: { kind: 'project', key: workId }, clarification: initialClarification,
        sources: [{ evidence_id: 'ev-work', evidence_fingerprint: fingerprint('Implemented Time Spend reporting.'), quote: 'Implemented Time Spend reporting.' }],
        explanation: 'Initial confirmation',
      },
    }, 0, null);

    // One correction that supersedes the initial answer
    const correctionClarification = {
      schema_version: 1, id: randomUUID(), job_id: initialClarification.job_id, input_snapshot_id: initialClarification.input_snapshot_id, revision: 1,
      kind: 'correction', fact: { work_id: workId, predicate: 'feature-identity', qualifiers: [] }, claim_ids: ['claim-1'],
      question: 'Is this the same work?', assertion: 'Its correct name is Time Spend reporting.',
      actor: 'user', recorded_at: time, source_ids: ['ev-work'], confirmed: true,
      confirmed_claims: ['Implemented Time Spend reporting.'], supersedes: initialClarification.id,
      corrected_assertion: 'AI Analytics was our name for this reporting feature.', effective_date: '2026-11-05',
    };
    const feedback2 = {
      schema_version: 1, id: randomUUID(), workspace_id: db.workspaceId,
      job_id: null, proposal_id: null, review_revision: null, kind: 'fact',
      before: 'AI Analytics was our name for this reporting feature.',
      after: 'Its correct name is Time Spend reporting.',
      explanation: 'Correction', recorded_at: time,
      scope: { kind: 'project', key: workId }, recorded_by: 'local-human',
    };
    corpusRepo.apply(feedback2, {
      kind: 'clarification',
      value: {
        scope: { kind: 'project', key: workId }, clarification: correctionClarification,
        sources: [{ evidence_id: 'ev-work', evidence_fingerprint: fingerprint('Implemented Time Spend reporting.'), quote: 'Implemented Time Spend reporting.' }],
        explanation: 'Correction',
      },
    }, u1.revision, u1.id);

    // 1 affected job
    const affectedJobId = randomUUID();
    const affectedJob = {
      schema_version: 1, id: affectedJobId, workspace_id: db.workspaceId, revision: 0, kind: 'job',
      original_url: null, canonical_url: null, employer_id: null, external_job_id: null, company: 'Acme', role: 'Engineer',
      parent_discovery_id: null, posting_snapshot_id: null, preparation_state: 'queued', application_lifecycle: 'not_started',
      preparation_stage: null, base_resume_id: null, template_id: null, runner: null, policy_fingerprint: null,
      current_attempt_id: null, artifact_version_ids: [], missing_inputs: [], confirmation_provenance: [], state_reason: null,
      created_at: time, updated_at: time,
    };
    repo.createJob(affectedJob, 'create:affected');
    const posting1 = repo.savePostingSnapshot({ schema_version: 1, id: randomUUID(), workspace_id: db.workspaceId, job_id: affectedJobId, source_kind: 'text', original_url: null, final_url: null, retrieved_at: null, captured_at: time, text: 'Acme Engineer', content_fingerprint: fingerprint('Acme Engineer') });
    const input1 = artifacts.captureInputs({ job_id: affectedJobId, posting_id: posting1.id, base_resume: yaml.dump(spec), selected_evidence: [{ source_id: 'ev-work', bytes: 'Implemented Time Spend reporting.' }], privacy_rules: {}, template: getLatexTemplate('default'), runner_configuration: { runner: 'test', model: 'fixture' }, policy: { schema_version: 1, mode: 'manual', output_format: 'latex', page_budget: 1, max_model_calls: 1, timeout_ms: 1000, max_repair_attempts: 0, model_retry_count: 0 } });
    const draft1 = drafts.create({ schema_version: 1, id: randomUUID(), workspace_id: db.workspaceId, job_id: affectedJobId, revision: 0, input_snapshot_id: input1.id, parent_artifact_version_id: null, candidate: spec, proposals: { proposals: [] }, created_at: time, updated_at: time });
    const attempt1 = repo.claimJob({ job_id: affectedJobId, input_snapshot_id: input1.id, mode: 'manual', stop_generation: 0, lease_ms: 10000, idempotency_key: randomUUID() }).result;
    artifacts.publishCandidate({ draft_id: draft1.id, expected_draft_revision: 0, fence: { attempt_id: attempt1.id, owner_token: attempt1.owner_token, stop_generation: 0 }, source: 'tex', pdf: 'pdf bytes', previews: ['preview png'], validation_report: '{}', validation_result: 'passed' });
    db.db.prepare("UPDATE attempts SET status='completed' WHERE id=?").run(attempt1.id);

    // 51 unaffected jobs
    for (let i = 2; i <= 52; i++) {
      const unrelatedId = randomUUID();
      const unrelatedJob = {
        schema_version: 1, id: unrelatedId, workspace_id: db.workspaceId, revision: 0, kind: 'job',
        original_url: null, canonical_url: null, employer_id: null, external_job_id: null, company: `Unrelated ${i}`, role: `Role ${i}`,
        parent_discovery_id: null, posting_snapshot_id: null, preparation_state: 'queued', application_lifecycle: 'not_started',
        preparation_stage: null, base_resume_id: null, template_id: null, runner: null, policy_fingerprint: null,
        current_attempt_id: null, artifact_version_ids: [], missing_inputs: [], confirmation_provenance: [], state_reason: null,
        created_at: time, updated_at: time,
      };
      repo.createJob(unrelatedJob, `create:unrelated:${i}`);
      if (i <= 10) {
        const unrelatedSpec = {
          profile: { name: `Unrelated ${i}`, title: 'Dev', email: `u${i}@example.com` },
          experiences: [{ company: `OtherCo ${i}`, role: 'Dev', startDate: '2021', endDate: '2022', bullets: [{ text: `Built unrelated feature ${i}.`, citations: [] }] }],
          education: [], skills: [],
        };
        const p = repo.savePostingSnapshot({ schema_version: 1, id: randomUUID(), workspace_id: db.workspaceId, job_id: unrelatedId, source_kind: 'text', original_url: null, final_url: null, retrieved_at: null, captured_at: time, text: `Posting ${i}`, content_fingerprint: fingerprint(`Posting ${i}`) });
        const inp = artifacts.captureInputs({ job_id: unrelatedId, posting_id: p.id, base_resume: yaml.dump(unrelatedSpec), selected_evidence: [], privacy_rules: {}, template: getLatexTemplate('default'), runner_configuration: { runner: 'test', model: 'fixture' }, policy: { schema_version: 1, mode: 'manual', output_format: 'latex', page_budget: 1, max_model_calls: 1, timeout_ms: 1000, max_repair_attempts: 0, model_retry_count: 0 } });
        const d = drafts.create({ schema_version: 1, id: randomUUID(), workspace_id: db.workspaceId, job_id: unrelatedId, revision: 0, input_snapshot_id: inp.id, parent_artifact_version_id: null, candidate: unrelatedSpec, proposals: { proposals: [] }, created_at: time, updated_at: time });
        const att = repo.claimJob({ job_id: unrelatedId, input_snapshot_id: inp.id, mode: 'manual', stop_generation: 0, lease_ms: 10000, idempotency_key: randomUUID() }).result;
        artifacts.publishCandidate({ draft_id: d.id, expected_draft_revision: 0, fence: { attempt_id: att.id, owner_token: att.owner_token, stop_generation: 0 }, source: 'tex', pdf: `unrelated pdf ${i}`, previews: ['preview png'], validation_report: '{}', validation_result: 'passed' });
        db.db.prepare("UPDATE attempts SET status='completed' WHERE id=?").run(att.id);
      }
    }

    let pdfBytesRead = 0;
    const origReadArtifact = runtime.repository.database.files.readArtifact.bind(runtime.repository.database.files);
    runtime.repository.database.files.readArtifact = (ref, jobId, id) => {
      if (String(ref.id).endsWith('.pdf')) pdfBytesRead++;
      return origReadArtifact(ref, jobId, id);
    };

    const result = affectedClarificationDrafts(runtime);
    assert.equal(result.jobs.length, 1, 'Exactly one job must be discovered');
    assert.equal(result.jobs[0].job_id, affectedJobId, 'Discovered job must match affected job ID');
    assert.equal(pdfBytesRead, 0, 'No PDF bytes should be read during bounded correction discovery');

    // Test budget-capping and pagination cursor
    const capped = affectedClarificationDrafts(runtime, { maxDurationMs: 0 });
    assert.equal(capped.incomplete, true, 'Zero budget must report incomplete discovery');
    assert.ok(typeof capped.next_cursor === 'string', 'Next cursor must be a string');

    console.log('[PASS] Scenario 2: 1 correction among 52 jobs -> bounded discovery, no PDF bytes read');
  } finally {
    await runtime.dispose();
    await cleanDir(root);
  }
}

async function runScenario3() {
  // Scenario 3: Batch 3 malformed -> batches 1-2 preserved, technical retry available
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'verify-s3-'));
  const time = '2026-11-08T12:00:00.000Z';
  const db = openJobsDatabase(root);
  const repo = new JobsRepository(db, { now: () => time });
  const drafts = new JobDraftRepository(repo);

  try {
    const jobId = randomUUID();
    const candidate = {
      profile: { name: 'Alex', title: 'Engineer', email: 'alex@example.com' },
      experiences: [{
        company: 'Acme', role: 'Engineer', startDate: '2020', endDate: 'Present',
        bullets: Array.from({ length: 9 }, (_, i) => ({ text: `Implemented backend service ${i}.` })),
      }],
      education: [], skills: [],
    };

    repo.createJob({
      schema_version: 1, id: jobId, workspace_id: db.workspaceId, revision: 0, kind: 'job',
      original_url: null, canonical_url: null, employer_id: null, external_job_id: null, company: 'Acme', role: 'Engineer',
      parent_discovery_id: null, posting_snapshot_id: null, preparation_state: 'saved', application_lifecycle: 'not_started',
      preparation_stage: null, base_resume_id: null, template_id: null, runner: null, policy_fingerprint: null,
      current_attempt_id: null, artifact_version_ids: [], missing_inputs: [], confirmation_provenance: [], state_reason: null,
      created_at: time, updated_at: time,
    }, 'create:job');

    const posting = repo.savePostingSnapshot({
      schema_version: 1, id: randomUUID(), workspace_id: db.workspaceId, job_id: jobId,
      source_kind: 'text', original_url: null, final_url: null, retrieved_at: null, captured_at: time,
      text: 'Build APIs', content_fingerprint: fingerprint('Build APIs'),
    });
    const evidence = C.EvidenceEntrySchema.parse({
      id: 'ev-1', date: '2026-01-01', company: 'Acme', title: 'Server work',
      summary: 'Implemented server-side handlers and database queries.', confidence: 'verified', impact: '', themes: [], in_flight: false
    });
    const artifacts = new JobArtifactsService(repo);
    const input = artifacts.captureInputs({
      job_id: jobId, posting_id: posting.id, base_resume: yaml.dump(candidate),
      selected_evidence: [{ source_id: evidence.id, bytes: C.serializeEvidenceMarkdown(evidence, evidence.summary) }],
      privacy_rules: {}, template: getLatexTemplate('default'),
      runner_configuration: { runner: 'test', model: 'fixture' },
      policy: { schema_version: 1, mode: 'manual', output_format: 'latex', page_budget: 1, max_model_calls: 1, timeout_ms: 1000, max_repair_attempts: 0, model_retry_count: 0 },
    });

    const draft = drafts.create({
      schema_version: 1, id: randomUUID(), workspace_id: db.workspaceId, job_id: jobId, revision: 0,
      input_snapshot_id: input.id, parent_artifact_version_id: null, candidate, proposals: { proposals: [] },
      created_at: time, updated_at: time,
    });

    let callCount = 0;
    const runner = {
      id: 'fake', model: 'fixture', label: 'Fixture', locality: 'local',
      detect: async () => ({ available: true, detail: '' }),
      run: async (request) => {
        callCount++;
        if (callCount === 3) {
          throw new Error('Malformed wire JSON at line 1 col 12');
        }
        const batch = JSON.parse(request.prompt);
        return {
          passages: batch.subjects.map((p) => ({
            subject_ref: p.ref,
            claims: [{
              text: p.text,
              fact: { predicate: 'backend', qualifiers: [] },
              qualifier_text: [],
              state: 'supported',
              evidence: [{
                source_ref: batch.sources[0]?.ref ?? 's1',
                quote: batch.sources[0]?.text ?? 'Implemented server-side handlers and database queries.',
              }],
              explanation: 'Supported by source.',
            }],
          })),
        };
      },
    };

    const service = new SemanticService(repo, artifacts, {
      runner: () => runner,
      consent: () => true,
      timeoutMs: () => 5000,
    });
    const target = { kind: 'draft', draft_id: draft.id, candidate };
    const result = await service.classifyJobPassages(jobId, { target });

    assert.equal(result.batchesSucceeded, 2, 'Batches 1-2 must succeed');
    assert.equal(result.batchesFailed, 1, 'Batch 3 must be recorded as failed');
    assert.equal(result.passages[0].status, 'supported', 'Passages from batch 1 must be preserved as supported');
    assert.ok(result.failures && result.failures.length > 0, 'Failures diagnostic must be captured');
    const f3 = result.failures.find(f => f.batch_index === 3);
    assert.ok(f3, 'Batch 3 failure must be present');
    assert.equal(f3.code, 'wire_shape_invalid', 'Code must indicate wire shape invalid');
    assert.ok(f3.safe_diagnostic.includes('Malformed wire JSON'), 'Safe diagnostic must describe wire JSON issue');

    console.log('[PASS] Scenario 3: Batch 3 malformed -> batches 1-2 preserved, technical retry available');
  } finally {
    if (db.db.open) db.close();
    await cleanDir(root);
  }
}

function runScenario4() {
  // Scenario 4: Numeric baseline finding -> bound to original baseline wording, not number-free replacement
  const finding = bindReviewFinding({
    issueKey: 'metric_unverified',
    message: 'Numbers not supported by cited verified evidence: 11.',
    target: {
      scope: 'retained_baseline',
      text: 'Senior Software Engineer with 11 years experience...',
      text_fingerprint: 'fp_base_11',
      span: [30, 32],
    },
    draft_revision: 2,
    preview_text: 'Senior Software Engineer with deep experience...',
  });

  assert.equal(finding.target.scope, 'retained_baseline', 'Scope must be retained_baseline');
  assert.ok(finding.target.text.includes('11 years'), 'Target text must retain original number');
  assert.equal(finding.is_stale_for_preview, true, 'Finding must be marked stale for replacement preview');

  console.log('[PASS] Scenario 4: Numeric baseline finding -> bound to original baseline wording, not number-free replacement');
}

function runScenario5() {
  // Scenario 5: Generated bindings omit connective text -> gap offsets identified, strict contract satisfied
  const proposal = {
    text: 'Experience spans leading frontend migrations and observability pipelines.',
    claims: [
      { text: 'leading frontend migrations', source_ids: ['src-1'], span: [17, 44] },
      { text: 'observability pipelines', source_ids: ['src-2'], span: [49, 72] },
    ],
  };

  const validation = validateProposalClaimCoverage(proposal.text, proposal.claims);
  assert.equal(validation.valid, false, 'Claim coverage without connective text must be invalid');
  assert.deepEqual(validation.gaps, [
    { span: [0, 17], text: 'Experience spans ' },
    { span: [44, 49], text: ' and ' },
    { span: [72, 73], text: '.' },
  ], 'Exact gap offsets and connective text must be identified');
  assert.ok(validation.issues[0].message.includes('Uncovered wording: "Experience spans "'), 'Issue message must name uncovered wording');

  console.log('[PASS] Scenario 5: Generated bindings omit connective text -> gap offsets identified, strict contract satisfied');
}

async function runScenario6() {
  // Scenario 6: Worker leases / snapshot bursts -> zero broad refresh storms
  const testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'verify-s6-'));
  fs.mkdirSync(path.join(testDir, '.leases'), { recursive: true });
  fs.mkdirSync(path.join(testDir, '.cache'), { recursive: true });
  fs.mkdirSync(path.join(testDir, 'tmp'), { recursive: true });
  fs.mkdirSync(path.join(testDir, 'corpus'), { recursive: true });

  let watcher = null;
  try {
    const events = [];
    watcher = createScopedWatcher(testDir, (event) => events.push(event.path));
    await sleep(150); // allow chokidar to bind on Windows

    // Rapidly write ignored files
    fs.writeFileSync(path.join(testDir, 'featherduster.db-wal'), 'data');
    fs.writeFileSync(path.join(testDir, 'featherduster.db-shm'), 'data');
    fs.writeFileSync(path.join(testDir, '.leases', 'worker.lock'), 'data');
    fs.writeFileSync(path.join(testDir, '.cache', 'temp.json'), 'data');
    fs.writeFileSync(path.join(testDir, 'tmp', 'scratch.tmp'), 'data');

    // Rapid burst of edits on an evidence file
    fs.writeFileSync(path.join(testDir, 'corpus', 'facts.yaml'), 'v1');
    fs.writeFileSync(path.join(testDir, 'corpus', 'facts.yaml'), 'v2');

    await sleep(250);

    const ignoredEvents = events.filter(e => e.includes('db-wal') || e.includes('db-shm') || e.includes('.leases') || e.includes('.cache') || e.includes('tmp'));
    assert.equal(ignoredEvents.length, 0, 'Operational files and sidecars must emit 0 watcher events');
    const factsEvents = events.filter(e => e.includes('facts.yaml'));
    assert.equal(factsEvents.length, 1, 'Rapid burst of user file edits must be coalesced into 1 event');

    // Test SSE endpoint scoping
    const app = createApp(testDir);
    const resCorpus = await app.request('/api/events?topic=corpus');
    assert.equal(resCorpus.status, 200, 'Topic corpus must be accessible');
    assert.ok(resCorpus.headers.get('content-type')?.includes('text/event-stream'), 'Content type must be text/event-stream');

    const resIntegrity = await app.request('/api/events?topic=workspace_integrity');
    assert.equal(resIntegrity.status, 200, 'Topic workspace_integrity must be accessible');

    const resJob = await app.request('/api/events?topic=jobs:job-123');
    assert.equal(resJob.status, 200, 'Scoped topic jobs:job-123 must be accessible');

    if (app.disposeJobs) await app.disposeJobs();
    console.log('[PASS] Scenario 6: Worker leases / snapshot bursts -> zero broad refresh storms');
  } finally {
    if (watcher) await watcher.close();
    await cleanDir(testDir);
  }
}

async function runScenario7() {
  // Scenario 7: Mixed edits typing burst -> saved as atomic revision
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'verify-s7-'));
  const db = openJobsDatabase(root);
  const repo = new JobsRepository(db);
  const artifacts = new JobArtifactsService(repo);
  const analysis = { company: 'Acme', role: 'Engineer', seniority: '', mission: '', requirements: [{ id: 'r1', text: 'Backend', terms: ['backend'], tier: 'must', quote: 'Build things' }] };
  let runCall = 0;
  const runner = {
    id: 'fake', model: 'fake', label: 'Fake', locality: 'local',
    detect: async () => ({ available: true, detail: '' }),
    run: async () => {
      runCall++;
      if (runCall === 1) return analysis;
      if (runCall === 2) return { rows: [] };
      return { proposals: [{ id: 'p', type: 'summary.rewrite', target: {}, before: '', after: 'Built backend APIs.', citations: ['ev-1'], requirement_ids: ['r1'] }] };
    }
  };
  const renderer = {
    preflight: async () => ({ available: true, tools: [], diagnostics: [] }),
    renderPdf: async () => ({ status: 'passed', source: 'latex', pdf: Buffer.from('pdf'), previews: [{ page: 1, mimeType: 'image/png', bytes: Buffer.from('png') }], report: { passed: true, pageCount: 1, pageBudget: 1, coverage: 1, missingFragments: [], diagnostics: [] }, diagnostics: [] })
  };
  const evidence = new C.EvidenceStore([{ entry: C.EvidenceEntrySchema.parse({ id: 'ev-1', date: '2026-01-01', company: 'Acme', title: 'APIs', summary: 'Built APIs.', impact: '', themes: [], confidence: 'verified', in_flight: false, metrics: [], internal_references: [] }), narrative: 'Built APIs and fixed BFF authentication.' }]);
  const corpus = new CorpusService(new CorpusRepository(repo), () => evidence);
  const proposals = new ProposalRepository(repo);
  const prep = new JobPreparation({ repository: repo, artifacts, renderer, resolveRunner: () => runner, hasConsent: () => true });
  const inputs = new Map();
  const service = new JobsService({ repository: repo, preparation: prep, resolveInput: (j) => j.current_attempt_id ? repo.getAttempt(j.current_attempt_id).input_snapshot_id : inputs.get(j.id), onEvent: () => {}, leaseMs: 3000, automaticDrain: false });
  const reviews = new ProposalService(repo, proposals, artifacts, corpus, service);

  try {
    const base = {
      profile: { name: 'Test', title: 'Engineer', email: 'test@example.com' },
      experiences: [
        { company: 'Acme', role: 'Engineer', startDate: '2020', endDate: 'Present', bullets: [{ text: 'Legacy bullet 1' }] }
      ],
      education: [],
      skills: [],
    };
    const now = new Date().toISOString();
    const jobId = randomUUID();
    repo.createJob({ schema_version: 1, id: jobId, workspace_id: db.workspaceId, revision: 0, kind: 'job', original_url: null, canonical_url: null, employer_id: null, external_job_id: null, company: 'Acme', role: 'Engineer', parent_discovery_id: null, posting_snapshot_id: null, preparation_state: 'queued', application_lifecycle: 'not_started', preparation_stage: null, base_resume_id: null, template_id: null, runner: null, policy_fingerprint: null, current_attempt_id: null, artifact_version_ids: [], missing_inputs: [], confirmation_provenance: [], state_reason: null, created_at: now, updated_at: now }, randomUUID());
    const posting = repo.savePostingSnapshot({ schema_version: 1, id: randomUUID(), workspace_id: db.workspaceId, job_id: jobId, source_kind: 'text', original_url: null, final_url: null, retrieved_at: null, captured_at: now, text: 'Build things', content_fingerprint: fingerprint('Build things') });
    const input = artifacts.captureInputs({ job_id: jobId, posting_id: posting.id, base_resume: yaml.dump(base), selected_evidence: evidence.getAll().map(e => ({ source_id: e.id, bytes: C.serializeEvidenceMarkdown(e.entry, e.narrative) })), privacy_rules: {}, template: getLatexTemplate('default'), runner_configuration: { runner: 'fake', model: 'fake' }, policy: { schema_version: 1, mode: 'candidate', output_format: 'latex', page_budget: 1, max_model_calls: 4, timeout_ms: 10000, max_repair_attempts: 0, model_retry_count: 0 } });
    inputs.set(jobId, input.id);

    service.prepare({ job_id: jobId, expected_revision: 0, input_snapshot_id: input.id, idempotency_key: randomUUID() });
    await service.worker.whenIdle();

    const view = reviews.read(jobId);
    assert.equal(view.availability, 'available');
    const mutation = {
      job_id: jobId,
      expected_revision: view.review.revision,
      idempotency_key: 'idem-batch-1',
      base_corrections: [
        { path: 'experiences.0.bullets.0.text', before: 'Legacy bullet 1', after: 'Corrected bullet 1' },
      ],
      generated_patches: [
        { proposal_id: 'p', before: 'Built backend APIs.', after: 'User edited generated text' },
      ],
    };

    const res = await reviews.saveMixedDraftEdits(mutation);
    assert.equal(res.success, true, 'Mixed draft edit batch must succeed');
    assert.equal(res.new_revision, view.review.revision + 1, 'Draft revision must increment atomically by 1');

    // Fencing: Stale revision must be rejected atomically
    await assert.rejects(
      async () => reviews.saveMixedDraftEdits({ ...mutation, expected_revision: view.review.revision }),
      /Stale/,
      'Stale revision must be rejected atomically'
    );

    console.log('[PASS] Scenario 7: Mixed edits typing burst -> saved as atomic revision');
  } finally {
    await service.dispose();
    if (db.db.open) db.close();
    await cleanDir(root);
  }
}

async function runScenario8() {
  // Scenario 8: Human title confirmation -> reused in second synthetic job without quotes
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'verify-s8-'));
  const time = '2026-11-08T12:00:00.000Z';
  const db = openJobsDatabase(root);
  const repo = new JobsRepository(db, { now: () => time });
  const artifacts = new JobArtifactsService(repo, { now: () => time });
  const drafts = new JobDraftRepository(repo);

  try {
    const specKong = {
      profile: { name: 'Test', title: 'Senior Software Engineer', email: 'test@example.com' },
      experiences: [{
        company: 'Kong', role: 'Senior Software Engineer', startDate: '2021', endDate: '2024',
        bullets: [{ text: 'Built gateway plugin architecture.', citations: [] }],
      }],
      education: [], skills: [],
    };

    const job1Id = randomUUID();
    repo.createJob({
      schema_version: 1, id: job1Id, workspace_id: db.workspaceId, revision: 0, kind: 'job',
      original_url: null, canonical_url: null, employer_id: null, external_job_id: null, company: 'Kong', role: 'Senior Software Engineer',
      parent_discovery_id: null, posting_snapshot_id: null, preparation_state: 'saved', application_lifecycle: 'not_started',
      preparation_stage: null, base_resume_id: null, template_id: null, runner: null, policy_fingerprint: null,
      current_attempt_id: null, artifact_version_ids: [], missing_inputs: [], confirmation_provenance: [], state_reason: null,
      created_at: time, updated_at: time,
    }, 'create:job1');
    const p1 = repo.savePostingSnapshot({ schema_version: 1, id: randomUUID(), workspace_id: db.workspaceId, job_id: job1Id, source_kind: 'text', original_url: null, final_url: null, retrieved_at: null, captured_at: time, text: 'Kong Engineer', content_fingerprint: fingerprint('Kong Engineer') });
    const in1 = artifacts.captureInputs({ job_id: job1Id, posting_id: p1.id, base_resume: yaml.dump(specKong), selected_evidence: [], privacy_rules: {}, template: getLatexTemplate('default'), runner_configuration: { runner: 'test', model: 'fixture' }, policy: { schema_version: 1, mode: 'manual', output_format: 'latex', page_budget: 1, max_model_calls: 1, timeout_ms: 1000, max_repair_attempts: 0, model_retry_count: 0 } });
    drafts.create({ schema_version: 1, id: randomUUID(), workspace_id: db.workspaceId, job_id: job1Id, revision: 0, input_snapshot_id: in1.id, parent_artifact_version_id: null, candidate: specKong, proposals: { proposals: [] }, created_at: time, updated_at: time });

    const job2Id = randomUUID();
    repo.createJob({
      schema_version: 1, id: job2Id, workspace_id: db.workspaceId, revision: 0, kind: 'job',
      original_url: null, canonical_url: null, employer_id: null, external_job_id: null, company: 'Another Employer', role: 'Staff Engineer',
      parent_discovery_id: null, posting_snapshot_id: null, preparation_state: 'saved', application_lifecycle: 'not_started',
      preparation_stage: null, base_resume_id: null, template_id: null, runner: null, policy_fingerprint: null,
      current_attempt_id: null, artifact_version_ids: [], missing_inputs: [], confirmation_provenance: [], state_reason: null,
      created_at: time, updated_at: time,
    }, 'create:job2');
    const p2 = repo.savePostingSnapshot({ schema_version: 1, id: randomUUID(), workspace_id: db.workspaceId, job_id: job2Id, source_kind: 'text', original_url: null, final_url: null, retrieved_at: null, captured_at: time, text: 'Staff Engineer', content_fingerprint: fingerprint('Staff Engineer') });
    const in2 = artifacts.captureInputs({ job_id: job2Id, posting_id: p2.id, base_resume: yaml.dump(specKong), selected_evidence: [], privacy_rules: {}, template: getLatexTemplate('default'), runner_configuration: { runner: 'test', model: 'fixture' }, policy: { schema_version: 1, mode: 'manual', output_format: 'latex', page_budget: 1, max_model_calls: 1, timeout_ms: 1000, max_repair_attempts: 0, model_retry_count: 0 } });
    drafts.create({ schema_version: 1, id: randomUUID(), workspace_id: db.workspaceId, job_id: job2Id, revision: 0, input_snapshot_id: in2.id, parent_artifact_version_id: null, candidate: specKong, proposals: { proposals: [] }, created_at: time, updated_at: time });

    const mockRunner = {
      id: 'fake', model: 'fixture', label: 'Fixture', locality: 'local',
      detect: async () => ({ available: true, detail: '' }),
      run: async () => ({ passages: [] }),
    };
    const service = new JobSemanticService(repo, mockRunner);

    // Confirm title at Kong with no quotes/citations
    const answer = await service.saveHumanConfirmation({
      job_id: job1Id,
      employment: { employer: 'Kong', period: '2021 - 2024' },
      question: 'Was Senior Software Engineer your formal title at Kong?',
      confirmed_title: 'Senior Software Engineer',
      scope: 'remember_for_employment',
    });

    assert.equal(answer.support_basis, 'human_confirmation', 'Support basis must be human_confirmation');
    assert.equal(answer.sources.length, 0, 'Sources array must be empty for source-free title confirmation');

    // Reuse in second synthetic job
    const secondJobResult = await service.resolveJobSupport(job2Id, { employer: 'Kong' });
    const titleClaim = secondJobResult.passages.find(p => p.text.includes('Senior Software Engineer'));
    assert.ok(titleClaim, 'Title claim must be present in second job');
    assert.equal(titleClaim.status, 'supported', 'Title must be supported in second job');
    assert.equal(titleClaim.support_label, 'Confirmed by you', 'Support label must be Confirmed by you');

    console.log('[PASS] Scenario 8: Human title confirmation -> reused in second synthetic job without quotes');
  } finally {
    if (db.db.open) db.close();
    await cleanDir(root);
  }
}

function runScenario9() {
  // Scenario 9: Final PDF change summary -> lists inherited corrections and original-to-final diff
  const originalSnapshot = {
    experience: [{ id: 'kong', bullets: ['Engineered accessible UI components across apps.'] }],
  };
  const baseCorrections = [
    { target: 'Engineered accessible UI components across apps.', replacement: 'Engineered accessible web forms for internal admin tools.' },
  ];
  const generatedOperations = [
    { op: 'replace', before: 'Engineered accessible web forms for internal admin tools.', after: 'Delivered WCAG 2.1 accessible form controls in React.' },
  ];

  const changes = computeArtifactChanges(originalSnapshot, baseCorrections, generatedOperations);
  assert.equal(changes.passages[0].original_text, 'Engineered accessible UI components across apps.', 'Original text must be preserved from initial capture');
  assert.equal(changes.passages[0].final_text, 'Delivered WCAG 2.1 accessible form controls in React.', 'Final text must reflect the published candidate');
  assert.equal(changes.passages[0].stages.length, 2, 'Should trace through 2 stages of transformation');
  assert.equal(changes.passages[0].stages[0].kind, 'job_local_correction', 'Stage 0 must be job_local_correction');
  assert.equal(changes.passages[0].stages[1].kind, 'tailored_proposal', 'Stage 1 must be tailored_proposal');

  console.log('[PASS] Scenario 9: Final PDF change summary -> lists inherited corrections and original-to-final diff');
}

function runScenario10() {
  // Scenario 10: Same-named resume files -> unique namespaced identities and searchable selection
  const files = [
    'resumes/tailored/main.yaml',
    'resumes/tailored/main.tex',
    'resumes/archive/main.yaml',
  ];
  const specs = loadResumeSpecsFromPaths(files, '/workspace');

  assert.equal(new Set(specs.map(s => s.id)).size, 3, 'All 3 identically-named resumes must receive unique IDs');
  assert.equal(specs[0].id, 'tailored/main:yaml', 'First file normalized ID');
  assert.equal(specs[1].id, 'tailored/main:tex', 'Second file normalized ID');
  assert.equal(specs[2].id, 'archive/main:yaml', 'Third file normalized ID');

  // Ambiguous legacy resolution
  const ambiguous = resolveResume(specs, 'tailored-main');
  assert.equal(ambiguous.ambiguous, true, 'tailored-main must be marked ambiguous');
  assert.equal(ambiguous.resume, undefined, 'Ambiguous resolution must not pick arbitrarily');

  // Direct namespaced resolution
  const exact = resolveResume(specs, 'tailored/main:tex');
  assert.equal(exact.ambiguous, false, 'Exact namespaced ID must not be ambiguous');
  assert.equal(exact.resume?.id, 'tailored/main:tex', 'Exact ID must resolve correct variant');

  console.log('[PASS] Scenario 10: Same-named resume files -> unique namespaced identities and searchable selection');
}

async function runScenario11() {
  // Scenario 11: Multi-region posting metadata -> US/UK/LATAM preserved across intake
  const html = `
    <html>
      <div class="location">Remote - US, UK, LATAM</div>
      <div class="salary">US: $160,000 - $190,000 USD | UK: £100,000 - £120,000 GBP</div>
      <div class="employment-type">Full-time Employee</div>
      <div class="description"><p>Lead frontend development across platforms...</p></div>
    </html>
  `;
  const parsed = await extractPostingMetadata(html, 'https://example.com/jobs/123');

  assert.deepEqual(parsed.locations, ['US', 'UK', 'LATAM'], 'Multi-region locations must be preserved');
  assert.equal(parsed.remote_policy, 'Remote', 'Remote policy must be extracted');
  assert.equal(parsed.employment_type, 'Full-time Employee', 'Employment type must be extracted');
  assert.equal(parsed.compensation.length, 2, 'Two regional compensation entries must be extracted');
  assert.deepEqual(parsed.compensation[0], {
    region: 'US', currency: 'USD', min: 160000, max: 190000, period: 'annual', raw_text: '$160,000 - $190,000 USD'
  }, 'US compensation must match');
  assert.deepEqual(parsed.compensation[1], {
    region: 'UK', currency: 'GBP', min: 100000, max: 120000, period: 'annual', raw_text: '£100,000 - £120,000 GBP'
  }, 'UK compensation must match');
  assert.equal(parsed.source_url, 'https://example.com/jobs/123', 'Provenance source URL must be retained');
  assert.ok(parsed.captured_at, 'Captured_at timestamp must be recorded');

  console.log('[PASS] Scenario 11: Multi-region posting metadata -> US/UK/LATAM preserved across intake');
}

function runScenario12() {
  // Scenario 12: Job-specific accomplishment ranking -> visualization leads for frontend role
  const candidate = synthesizeExperienceBullets({
    role_requirements: ['frontend observability', 'data visualization', 'test isolation'],
    experience: {
      employer: 'Parable',
      accomplishments: [
        { id: 'acc-1', topic: 'general administration', evidence_supported: true },
        { id: 'acc-2', topic: 'time spend visualization and drilldown', evidence_supported: true },
        { id: 'acc-3', topic: 'internal build scripting', evidence_supported: true },
      ],
    },
  });

  assert.equal(candidate.bullets[0].accomplishment_id, 'acc-2', 'Visualization accomplishment must be ranked first for frontend role');
  assert.ok(!/improved team velocity by \d+%/i.test(candidate.bullets[0].text), 'Speculative metrics without cited support must not be hallucinated');

  // Constraint check: unproven pluralizations narrowed
  const narrowTest = synthesizeExperienceBullets({
    role_requirements: ['SDK development'],
    experience: {
      employer: 'Parable',
      accomplishments: [
        { id: 'acc-sdk', topic: 'client SDK development and maintenance', evidence_supported: true, evidence_count: 1 },
      ],
    },
  });
  assert.ok(!/\bSDKs\b/.test(narrowTest.bullets[0].text), 'Unsupported pluralizations must be narrowed to documented singular evidence');

  console.log('[PASS] Scenario 12: Job-specific accomplishment ranking -> visualization leads for frontend role');
}

async function runScenario13() {
  // Scenario 13: Desktop & 390-pixel responsive layout -> zero horizontal overflow
  const ws = fs.mkdtempSync(path.join(os.tmpdir(), 'verify-s13-'));
  await initWorkspace({ workspace: ws, silent: true });
  const app = createApp(ws, { uiDir: path.resolve('packages/cli/dist/ui') });
  const server = serve({ fetch: app.fetch, hostname: '127.0.0.1', port: 0 });
  await new Promise(r => server.once('listening', r));
  const port = server.address().port;
  const origin = `http://127.0.0.1:${port}`;

  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });

    // Desktop review
    await page.goto(`${origin}/jobs`);
    const desktopJobsOverflow = await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);
    assert.ok(desktopJobsOverflow, 'Desktop 1440px /jobs must have zero horizontal overflow');

    await page.goto(`${origin}/`);
    const desktopRootOverflow = await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);
    assert.ok(desktopRootOverflow, 'Desktop 1440px / must have zero horizontal overflow');

    // 390px mobile review
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`${origin}/jobs`);
    const mobileJobsOverflow = await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);
    assert.ok(mobileJobsOverflow, 'Mobile 390px /jobs must have zero horizontal overflow');

    await page.goto(`${origin}/`);
    const mobileRootOverflow = await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);
    assert.ok(mobileRootOverflow, 'Mobile 390px / must have zero horizontal overflow');

    console.log('[PASS] Scenario 13: Desktop & 390-pixel responsive layout -> zero horizontal overflow');
  } finally {
    await browser.close();
    server.close();
    if (app.disposeJobs) await app.disposeJobs();
    await cleanDir(ws);
  }
}

async function main() {
  console.log('--- NetBox Follow-ups Integrated Acceptance Verification ---');
  const startTime = Date.now();

  await runScenario1();
  await runScenario2();
  await runScenario3();
  runScenario4();
  runScenario5();
  await runScenario6();
  await runScenario7();
  await runScenario8();
  runScenario9();
  runScenario10();
  await runScenario11();
  runScenario12();
  await runScenario13();

  const totalSeconds = ((Date.now() - startTime) / 1000).toFixed(2);
  console.log(`\nAll 13 NetBox follow-up scenarios PASSED in ${totalSeconds}s.`);
  process.exit(0);
}

main().catch((err) => {
  console.error('\n[FAIL] Verification scenario failed:', err);
  process.exit(1);
});
