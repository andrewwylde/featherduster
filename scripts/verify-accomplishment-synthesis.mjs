// Read-only real-evidence calibration. Uses existing runner consent; never edits the career corpus.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
const yaml = createRequire(new URL('../packages/cli/package.json', import.meta.url))('js-yaml');
import * as C from '../packages/core/dist/index.js';
import { loadSourceEvidenceStore, loadPrivacyRules } from '../packages/cli/dist/server.js';
import { loadTailoringConfig } from '../packages/cli/dist/tailoring/config.js';
import { loadTailoringSkill } from '../packages/cli/dist/tailoring/skill-text.js';
import { defaultRunnerFactory } from '../packages/cli/dist/runners/registry.js';
import { classifyBatch } from '../packages/cli/dist/jobs/semantic-classifier.js';
import { sourceFingerprint } from '../packages/cli/dist/corpus/load.js';
import { LatexRenderer } from '../packages/cli/dist/render/latex-renderer.js';
import { PdfVerifier } from '../packages/cli/dist/render/pdf-verifier.js';
const arg = name => process.argv[process.argv.indexOf(name) + 1];
const workspace = arg('--workspace'), outputRoot = arg('--output');
if (!process.argv.includes('--workspace') || !process.argv.includes('--output')) throw Error('Supply --workspace and --output.');
// Keep failed/needs-answer runs separate from earlier verified PDFs.
const output = path.join(outputRoot, new Date().toISOString().replace(/[:.]/g, '-'));
fs.mkdirSync(output, { recursive: true });
const hash = value => createHash('sha256').update(value).digest('hex');
const ledger = path.join(workspace, 'companies/parable/evidence/evidence-ledger.md'), ledgerBefore = hash(fs.readFileSync(ledger));
let report = { status: 'running', output };
process.on('exit', code => fs.writeFileSync(path.join(output, 'report.json'), JSON.stringify({ ...report,
  status: report.status === 'running' ? 'failed' : report.status, exit_code: code,
  ledger_unchanged: ledgerBefore === hash(fs.readFileSync(ledger)) }, null, 2)));
const config = loadTailoringConfig(workspace), runner = defaultRunnerFactory(config.runner.default, config.runner);
assert.ok(runner && (runner.locality !== 'cloud' || config.runner_consent[runner.id]), 'Existing runner consent is required.');
assert.ok((await runner.detect()).available, 'Configured runner unavailable.');
const rules = loadPrivacyRules(workspace), store = loadSourceEvidenceStore(workspace);
const ids = ['ev-022', 'ev-023', 'ev-026', 'ev-029'];
const evidence = ids.map(id => { const e = store.get(id); assert.ok(e, `Missing ${id}`); return e; });
const master = C.ResumeSpecSchema.parse(yaml.load(fs.readFileSync(path.join(workspace, 'resumes/templates/master.yaml'), 'utf8')));
const experience = master.experiences.find(e => e.company === 'Parable'); assert.ok(experience);
// These input bullets are a calibration fixture derived from real entries, not a replacement for master.yaml.
const base = { profile: { name: master.profile.name, title: master.profile.title, email: master.profile.email }, experiences: [{ ...experience, bullets: [
  { text: 'Implemented tenant-scoped connector admin APIs.', citations: ['ev-022'] },
  { text: 'Built connector configuration UI.', citations: ['ev-023'] },
  { text: 'Maintained database migration tooling.', citations: ['ev-029'] },
] }], skills: [], education: [] };
const analysis = C.JobAnalysisSchema.parse({ company: 'Product engineering calibration', role: 'Fullstack Engineer', seniority: 'Senior', mission: 'Deliver coherent user-facing product capabilities',
  requirements: [{ id: 'product', tier: 'must', text: 'Build product workflows across APIs and UI with input validation.', quote: 'Build product workflows across APIs and UI with input validation.', terms: [] }], boilerplate: [] });
const alignment = C.AlignmentMatrixSchema.parse({ rows: [{ requirement_id: 'product', classification: 'backed', citations: ['ev-022', 'ev-023', 'ev-026'], rationale: 'Recorded connector API, UI and validation work.', adjacent_tool: '', candidate_confirmed: false }] });
const prompt = C.buildProposalsPrompt(analysis, alignment, base, evidence, { locality: runner.locality, rules, evidenceIds: ids })
  + `\n${C.SYNTHESIS_INSTRUCTIONS}\nSelected page budget: 1. This calibration tests consolidation of related connector API and UI work, inclusion of supported validation work absent from the starting bullets, and separation of unrelated migrations. Skip optional metric enrichment; no measured impact is available.`;
console.log(`Generating with configured ${runner.id}/${runner.model || 'default'}; maximum three model calls.`);
const raw = await runner.run({ system: C.buildSynthesisSystemPrompt(loadTailoringSkill(workspace).skill, 'proposals'), prompt,
  schema: C.PROPOSALS_JSON_SCHEMA, signal: AbortSignal.timeout(config.runner.step_timeout_seconds * 1000), transportRetryCount: 0, onProgress: () => {} });
const proposals = C.normalizeGenerationProposals(C.ProposalSetSchema.parse(raw).proposals).map(p => ({ ...p, decision: p.decision === 'rejected' ? 'rejected' : 'accepted' }));
fs.writeFileSync(path.join(output, 'proposals.json'), JSON.stringify(proposals, null, 2));
assert.ok(proposals.some(p => p.type === 'bullet.consolidate'), 'No consolidation generated.');
assert.equal(C.detectProposalConflicts(proposals).length, 0);
const candidate = C.applyProposals(base, proposals);
const sources = evidence.flatMap(e => ['title', 'summary', 'impact', 'narrative'].filter(field => e[field]?.trim()).map(field => ({ evidence_id: e.id,
  evidence_fingerprint: sourceFingerprint(e), work_id: e.id, company: e.company, field, start: 0, text: e[field] })))
  .filter(s => { const safe = C.redactText(s.text, rules); return safe.isClean && safe.redactedText === s.text; });
const classify = async spec => classifyBatch(runner, { subjects: C.inventoryPassages(spec, hash), sources, configuration_key: 'real-calibration',
  configuredStepTimeoutMs: Math.min(config.runner.step_timeout_seconds * 1000, 60000), coverage: { searched_source_count: evidence.length, omitted_source_ids: [], truncated: false } }, AbortSignal.timeout(65000));
console.log('Checking generated claims against source excerpts.');
const checked = await classify(candidate);
fs.writeFileSync(path.join(output, 'facts.json'), JSON.stringify(checked, null, 2));
assert.equal(checked.status, 'complete', checked.reason);
if (!checked.passages.every(p => p.claims.every(c => c.state === 'supported'))) report = { ...report, status: 'needs_answer', candidate,
  questions: checked.passages.flatMap(p => p.claims.filter(c => c.state !== 'supported').map(c => ({ text: c.claim.text, question: c.question, explanation: c.explanation }))) };
assert.ok(checked.passages.every(p => p.claims.every(c => c.state === 'supported')), 'Generated wording needs factual resolution.');
const merge = proposals.find(p => p.type === 'bullet.consolidate');
assert.ok(merge.source_bullets.length >= 2 && !merge.source_bullets.some(s => s.bullet_index === 2), 'Unrelated migration combined into connector accomplishment.');
assert.ok(/validat|malformed|invalid/i.test(C.compileMarkdownResume(candidate)), 'Absent supported validation work was missed.');
const negative = structuredClone(base); negative.experiences[0].bullets = [{ text: 'Owned all connector and database migration architecture, increasing adoption by 40%.', citations: ids }];
console.log('Checking unsupported ownership and impact control.');
const negativeCheck = await classify(negative);
assert.equal(negativeCheck.status, 'complete', negativeCheck.reason);
assert.ok(negativeCheck.passages.some(p => p.claims.some(c => c.state !== 'supported')), 'Unsupported impact was accepted.');
const poppler = process.env.POPPLER_BIN ?? path.join(process.env.LOCALAPPDATA ?? '', 'Programs/poppler/Library/bin');
const verifier = new PdfVerifier(fs.existsSync(path.join(poppler, 'pdftotext.exe')) ? { tools: Object.fromEntries(['pdfinfo', 'pdftotext', 'pdftoppm'].map(name => [name, { command: path.join(poppler, `${name}.exe`) }])) } : {});
const renderer = new LatexRenderer({ verifier });
const rendered = await renderer.renderPdf({ templateId: 'default', spec: candidate, rules, signal: AbortSignal.timeout(60000) });
assert.equal(rendered.status, 'passed', JSON.stringify(rendered.diagnostics));
assert.equal(rendered.report.pageCount, 1);
fs.writeFileSync(path.join(output, 'resume.pdf'), rendered.pdf);
for (const p of rendered.previews) fs.writeFileSync(path.join(output, `page-${p.page}.png`), p.bytes);
report = { status: 'passed', policy: C.SYNTHESIS_POLICY, runner: runner.id, model: runner.model, calls: 3,
  candidate, proposals, negativeCheck, export: rendered.report };
assert.equal(hash(fs.readFileSync(ledger)), ledgerBefore);
console.log(`Real evidence, negative control and one-page export passed: ${output}`);
