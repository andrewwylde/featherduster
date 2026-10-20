import { expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { DEFAULT_STARTER_RESUME } from '../src/schemas/resume.js';
import { discoverEvidence, inventoryPassages } from '../src/jobs/evidence-discovery.js';
const hash = (s: string) => createHash('sha256').update(s).digest('hex');
it('retrieves related source wording without assigning authority or including retracted sources', () => {
  const result = discoverEvidence('backend', [
    { id: 'server', fingerprint: 'b', work_id: 'server', text: 'Implemented server-side handlers and database queries.', retracted: false },
    { id: 'old', fingerprint: 'a', work_id: 'old', text: 'backend', retracted: true },
  ]);
  expect(result.matches.map(m => m.id)).toEqual(['server']);
  expect(result).not.toHaveProperty('supported');
});
it('includes inherited summaries and preserves unambiguous subjects when bullets move', () => {
  const resume = structuredClone(DEFAULT_STARTER_RESUME);
  const first = inventoryPassages(resume, hash);
  expect(first.some(p => p.subject.path === 'summary')).toBe(true);
  resume.experiences[0].bullets.reverse();
  const next = inventoryPassages(resume, hash, first);
  const old = first.find(p => p.subject.path === 'experiences.0.bullets.0.text')!;
  expect(next.find(p => p.text === old.text)?.subject.id).toBe(old.subject.id);
  expect(next.find(p => p.text === old.text)?.subject.path).not.toBe(old.subject.path);
});
