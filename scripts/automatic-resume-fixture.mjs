// Fixture-only model responses. Real routes, coordinator, repositories, checks and PDF tools are used.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import yaml from 'js-yaml';
import { initWorkspace } from '../packages/cli/dist/commands/init.js';

export async function makeAutomaticResumeFixture() {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'featherduster-automatic-resume-'));
  await initWorkspace({ workspace, silent: true });
  fs.writeFileSync(path.join(workspace, '.featherduster/privacy-rules.yaml'), yaml.dump({ banned_keywords: ['FIXTURE_PRIVATE'], replacements: [], strip_patterns: [] }));
  fs.writeFileSync(path.join(workspace, '.automatic-resume-disposable'), 'Fixture only; never a live career workspace.');
  const baseline = { profile: { name: 'Jordan Morgan', title: 'Software Engineer', email: 'jordan@example.com' },
    experiences: [{ company: 'Harbor Systems', role: 'Engineer', startDate: '2022-01', endDate: 'Present', bullets: [
      { text: 'Maintained "gateway" request handlers.', citations: ['harbor-api'] },
      { text: 'Built release automation.', citations: ['harbor-release'] },
    ] }], education: [{ institution: 'Cascadia University', degree: 'Computer Science', year: '2020' }], skills: [{ category: 'Engineering', skills: ['TypeScript', 'SQL'] }] };
  const specs = Array.from({ length: 7 }, () => structuredClone(baseline));
  specs[0].experiences[0].bullets[1].citations = ['harbor-orchestration'];
  specs[1].experiences[0].bullets[0] = { text: 'Implemented caching.', citations: ['harbor-cache'] };
  for (const i of [2, 3]) specs[i].experiences[0].bullets[0] = { text: 'Implemented AI Analytics.', citations: ['harbor-analytics'] };
  for (const i of [2, 3]) specs[i].experiences[0].bullets.push({ text: 'Deployed release tooling.', citations: ['harbor-prototype'] });
  for (const [i, spec] of specs.entries()) fs.writeFileSync(path.join(workspace, 'resumes/templates', `automatic-${i + 1}.yaml`), yaml.dump(spec));
  const entries = [
    ['harbor-api', 'Gateway support', 'Maintained “gateway” request handlers.'],
    ['harbor-release', 'Release automation', 'Built release automation.'],
    ['harbor-orchestration', 'Delivery workflow', 'Developed deployment orchestration.'],
    ['harbor-cache', 'Caching implementation', 'Implemented caching.'],
    ['harbor-analytics', 'Time Spend reporting', 'Implemented Time Spend reporting.'],
    ['harbor-prototype', 'Release tooling prototype', 'Built prototype release tooling.'],
    ['cedar-other', 'Other project', 'Led delivery of a production analytics system.'],
  ].map(([id, title, summary]) => ({ id, company: id === 'cedar-other' ? 'Cedar Labs' : 'Harbor Systems', title, summary,
    date: '2026-01-01', impact: 'Documented implementation', themes: ['engineering'], confidence: 'verified', in_flight: false, metrics: [], internal_references: [] }));
  fs.writeFileSync(path.join(workspace, 'evidence/evidence-ledger.yaml'), yaml.dump({ entries }));
  return { workspace, specs };
}
export function automaticFixtureRunner(dispatches, options = {}) {
  const failures = new Map();
  return { id: 'fake', model: 'automatic-fixture', label: 'Deterministic disposable fixture only', locality: 'local',
    detect: async () => ({ available: true, detail: 'Deterministic local fixture; no provider request' }),
    run: async request => {
      const properties = request.schema?.properties ?? {};
      const operation = properties.passages ? 'semantic' : properties.requirements ? 'analysis' : properties.rows ? 'alignment' : properties.proposals ? 'proposals' : 'brief';
      const caseId = Number(/AUTOMATIC_CASE_(\d)/.exec(request.prompt)?.[1] ?? 0);
      const record = { at: new Date().toISOString(), operation, caseId, prompt: request.prompt, system: request.system };
      dispatches.push(record);
      await options.beforeOperation?.({ operation, caseId });
      if ((caseId === 6 && operation === 'alignment') || (caseId === 7 && operation === 'analysis') || options.offline) {
        const key = `${caseId}:${operation}`, count = (failures.get(key) ?? 0) + 1; failures.set(key, count);
        if (caseId === 7 || count === 1 || options.offline) { record.error = 'temporarily offline (fixture)'; throw Error(record.error); }
      }
      let result;
      if (operation === 'semantic') {
        const batch = JSON.parse(request.prompt);
        result = { passages: batch.subjects.map(p => {
          const uncertain = /AI Analytics|Deployed release tooling|^Led implementation/.test(p.text);
          const cited = JSON.parse(p.work_context ?? '{}').cited_work ?? [];
          const sourcePool = batch.sources.filter(s => s.company === 'Harbor Systems' && (!cited.length || cited.includes(s.evidence_id)));
          const source = sourcePool.find(s => s.text.includes(p.text) || s.text.replaceAll('“', '"').replaceAll('”', '"').includes(p.text)
            || (p.text.trim() === 'Built release automation. '.repeat(400).trim() && s.text === 'Built release automation.')
            || (p.text === 'Built release automation.' && s.evidence_id === 'harbor-orchestration' && s.text === 'Developed deployment orchestration.'))
            ?? sourcePool.find(s => s.field === 'summary');
          const supported = !uncertain && source;
          return { subject_ref: p.ref, claims: [{ text: p.text, fact: { predicate: p.text.includes('AI Analytics') ? 'feature-identity' : p.text.includes('Deployed') ? 'production-deployment' : p.text.includes('Led') ? 'leadership' : 'documented-implementation', qualifiers: [] },
            qualifier_text: p.text.startsWith('Led') ? ['Led'] : [], state: supported ? 'supported' : 'needs_clarification',
            evidence: source ? [{ source_ref: source.ref, quote: source.text }] : [], explanation: supported ? 'Exact captured work supports this wording (fixture classification).' : 'Captured work does not establish this qualifier or identity.',
            question: uncertain ? p.text.includes('AI Analytics') ? 'Is AI Analytics the same feature as Time Spend reporting?' : p.text.includes('Deployed') ? 'Was the release tooling deployed for users?' : 'Did you lead the caching implementation?' : 'What captured work supports this wording?' }] };
        }) };
      } else if (operation === 'analysis') result = { company: `AUTOMATIC_CASE_${caseId}`, role: `AUTOMATIC_CASE_${caseId}`, seniority: '', mission: '', requirements: [] };
      else if (operation === 'alignment') result = { rows: [] };
      else if (operation === 'proposals') result = { proposals: caseId === 2 ? [
        { id: 'cache-wording', type: 'bullet.rewrite', target: { experience_index: 0, bullet_index: 0 }, before: 'Implemented caching.', after: 'Led implementation of caching.', citations: ['harbor-cache'] },
        { id: 'reorder', type: 'bullet.reorder', target: { experience_index: 0 }, order: [1, 0] },
        { id: 'skills', type: 'skills.reorder', target: { skill_group_index: 0 }, skills: ['SQL', 'SQL', 'Invented capability'] },
      ] : caseId === 5 ? [{ id: 'material-omission', type: 'bullet.drop', target: { experience_index: 0, bullet_index: 1 }, before: 'Built release automation.', rationale: 'Omitting this unique outcome would require your decision.' }] : caseId === 6 ? [{ id: 'repeated-layout', type: 'bullet.rewrite', target: { experience_index: 0, bullet_index: 1 }, before: 'Built release automation.', after: 'Built release automation. '.repeat(400).trim(), citations: ['harbor-release'] }] : [] };
      else result = { anchor_stories: [], bridges: [], gaps: [] };
      record.result = result;
      return result;
    } };
}
