import assert from 'node:assert/strict';

export function assertCapturedServer(actual, captured) {
  for (const key of ['origin', 'pid', 'instance_id', 'started_at', 'workspace'])
    assert.equal(actual[key], captured[key], `Captured deployment continuity failed: ${key}`);
}
export function requiredOutcomes(snapshot) {
  return { queue: snapshot.batch.queue.map(item => ({ job_id: item.job_id, artifact_id: item.artifact_id,
    artifact_fingerprint: item.artifact_fingerprint, approved: item.approved })),
    job_ids: snapshot.jobs.map(detail => detail.job.id), approved: snapshot.batch.counts.approved,
    supplemental: (snapshot.supplemental ?? []).map(detail => ({ id: detail.job.id, artifacts: detail.artifacts.map(artifact => artifact.id), state: detail.job.preparation_state })) };
}
/** Read-only checks of current readiness and approvals, not historical approval presence. */
export function assertRequiredOutcomes(snapshot, required) {
  assert.equal(snapshot.batch.counts.approved, required.approved, 'Current approval outcome regressed');
  for (const expected of required.queue) {
    const actual = snapshot.batch.queue.find(item => item.job_id === expected.job_id);
    assert.ok(actual, `Current verified PDF/approval outcome regressed for ${expected.job_id}`);
    for (const key of ['artifact_id', 'artifact_fingerprint', 'approved'])
      assert.equal(actual[key], expected[key], `Current queue outcome regressed: ${expected.job_id}/${key}`);
  }
  assert.deepEqual(snapshot.jobs.map(detail => detail.job.id), required.job_ids, 'Captured job membership changed');
  for (const detail of snapshot.jobs) assert.equal(detail.job.application_lifecycle, 'not_started', 'Approval or download changed application lifecycle');
  for (const expected of required.supplemental ?? []) {
    const actual = snapshot.supplemental.find(detail => detail.job.id === expected.id);
    assert.ok(actual, 'Supplemental guard/budget job missing');
    assert.deepEqual(actual.artifacts.map(artifact => artifact.id), expected.artifacts, 'Rejected guard/budget work was published');
    assert.equal(actual.job.preparation_state, expected.state, 'Guard/budget outcome changed');
  }
  assert.equal(snapshot.host.corpus_revision, 0, 'Shared corpus changed');
}
