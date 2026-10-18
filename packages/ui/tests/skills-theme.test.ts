import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';

// The Skills page was styled for dark mode only; in light mode the title was white on white.
it('gives every dark-only Skills page colour a light-theme counterpart', () => {
  const source = readFileSync(new URL('../src/views/RubricGapMatrix.tsx', import.meta.url), 'utf8');
  const tokens = source.match(/[\w:/[\]#.-]+/g) ?? [];
  const darkOnly = /^(?:(?:hover|group-hover|focus):)?(?:text-white|text-slate-[234]00|bg-slate-(?:7|8|9)\d\d(?:\/\d+)?|border-slate-(?:7|8|9)\d\d(?:\/\d+)?|text-(?:teal|emerald|amber|rose)-[34]00(?:\/\d+)?)$/;
  expect(tokens.filter(t => darkOnly.test(t))).toEqual([]);
  expect(source).toMatch(/<h1 className="[^"]*text-slate-900 dark:text-white/);
});
