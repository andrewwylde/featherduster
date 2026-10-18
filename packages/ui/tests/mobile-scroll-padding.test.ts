import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';

// Controls scrolled into view (focus, scrollIntoView) must stop above the fixed mobile navigation.
it('reserves scroll padding for the fixed mobile navigation', () => {
  const css = readFileSync(new URL('../src/index.css', import.meta.url), 'utf8');
  expect(css).toMatch(/@media \(max-width: 767px\)\s*\{\s*html\s*\{\s*scroll-padding-bottom: calc\(6rem \+ env\(safe-area-inset-bottom, 0px\)\);/);
});
