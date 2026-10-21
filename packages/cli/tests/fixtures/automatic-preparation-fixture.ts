import { vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { randomUUID } from 'node:crypto';
import { EvidenceStore, type ResumeSpec } from '@featherduster/core';
import { createJobsRuntime } from '../../src/jobs/runtime.js';
export function automaticPreparationFixture(onCleanup: (cleanup: () => Promise<void>) => void) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'automatic-preparation-test-'));
  const spec: ResumeSpec = { profile: { name: 'Test', title: 'Engineer', email: 'test@example.com' }, experiences: [], education: [], skills: [] };
  fs.writeFileSync(path.join(root, 'base.json'), JSON.stringify(spec));
  const run = vi.fn(async (_request: import('../../src/runners/types.js').RunnerRequest): Promise<unknown> => ({ company: '', role: '', seniority: '', mission: '', requirements: [], rows: [], proposals: [] }));
  const deps = { automaticDrain: false, loadResumes: () => [{ id: 'base', type: 'template', filePath: 'base.json', spec }],
    loadEvidence: () => evidence, loadPrivacyRules: () => ({}),
    runnerFactory: () => ({ id: 'fake' as const, model: 'fixture', label: 'Fixture only', locality: 'local' as const, detect: async () => ({ available: true, detail: '' }), run }),
    renderer: { preflight: async () => ({ available: true, tools: [], diagnostics: [] }), renderPdf: async () => ({ status: 'passed' as const, source: 'latex', pdf: Buffer.from('unit PDF'), previews: [{ page: 1, mimeType: 'image/png' as const, bytes: Buffer.from('unit PNG') }], report: { passed: true, pageCount: 1, pageBudget: 1, coverage: 1, missingFragments: [], diagnostics: [] }, diagnostics: [] }) } };
  const evidence = new EvidenceStore();
  let runtime = createJobsRuntime(root, deps);
  onCleanup(async () => { await runtime.dispose(); fs.rmSync(root, { recursive: true, force: true }); });
  const add = async () => {
    const preview = await runtime.intake.preview({ mode: 'text', input: `Build things ${randomUUID()}` });
    const id = runtime.intake.commit(preview, randomUUID())[0].job_id!;
    return runtime.repository.getJob(id);
  };
  return { root, deps, spec, evidence, run, add, runtime: () => runtime, reopen: async () => { await runtime.dispose(); runtime = createJobsRuntime(root, deps); return runtime; } };
}
export function installAutomaticContent(fixture: ReturnType<typeof automaticPreparationFixture>, kind: 'feature' | 'qualifier' | 'base-qualifier') {
  const text = kind === 'feature' ? 'Implemented AI Analytics.' : kind === 'base-qualifier' ? 'Led implementation of caching.' : 'Implemented caching.';
  const supported = kind === 'feature' ? 'Implemented Time Spend reporting.' : 'Implemented caching.';
  fixture.spec.experiences = [{ company: 'Acme', role: 'Engineer', startDate: '2020', endDate: 'Present', bullets: [{ text, citations: ['ev-work'] }] }];
  fixture.evidence.add({ id: 'ev-work', date: '2026-01-01', company: 'Acme', title: 'Work record', summary: supported,
    impact: 'Documented work', themes: [], confidence: 'verified', in_flight: false, metrics: [], internal_references: [] }, supported);
  fixture.run.mockImplementation(async request => {
    const properties = request.schema.properties as Record<string, unknown>;
    if (properties.passages) {
      const batch = JSON.parse(request.prompt) as { subjects: { ref: string; text: string }[]; sources: { ref: string; text: string; field: string; evidence_id: string }[] };
      const source = batch.sources.find(s => s.field === 'summary' && s.evidence_id === 'ev-work')!;
      return { passages: batch.subjects.map(p => ({ subject_ref: p.ref, claims: [{ text: p.text, fact: { predicate: p.text.startsWith('Led') ? 'leadership' : 'feature-identity', qualifiers: [] }, qualifier_text: [],
        state: p.text === supported ? 'supported' : 'needs_clarification', evidence: [{ source_ref: source.ref, quote: source.text }], explanation: 'Fixture checks exact captured work.', question: 'Is this the same work?' }] })) };
    }
    return { company: '', role: '', seniority: '', mission: '', requirements: [], rows: [],
      proposals: properties.proposals && kind === 'qualifier' ? [{ id: 'wording', type: 'bullet.rewrite', target: { experience_index: 0, bullet_index: 0 }, before: text, after: 'Led implementation of caching.', citations: ['ev-work'] }] : [] };
  });
}
