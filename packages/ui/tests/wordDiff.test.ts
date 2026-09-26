import { describe, it, expect } from 'vitest';
import { wordDiff, sideBySideWordDiff } from '../src/views/tailoring/wordDiff.js';

describe('wordDiff', () => {
  describe('basic diffing', () => {
    it('returns no changes when strings are identical', () => {
      const result = wordDiff('hello world', 'hello world');
      expect(result).toEqual([{ type: 'same', text: 'hello world' }]);
    });

    it('returns removed for deleted content', () => {
      const result = wordDiff('hello world', '');
      expect(result).toEqual([{ type: 'removed', text: 'hello world' }]);
    });

    it('returns added for inserted content', () => {
      const result = wordDiff('', 'hello world');
      expect(result).toEqual([{ type: 'added', text: 'hello world' }]);
    });

    it('detects single word addition', () => {
      const result = wordDiff('hello world', 'hello wonderful world');
      // Tokens include whitespace, so verify the diff contains the expected changes
      expect(result.some((p) => p.type === 'same' && p.text.includes('hello'))).toBe(true);
      expect(result.some((p) => p.type === 'added' && p.text.includes('wonderful'))).toBe(true);
      expect(result.some((p) => p.type === 'same' && p.text.includes('world'))).toBe(true);
    });

    it('detects single word removal', () => {
      const result = wordDiff('hello cruel world', 'hello world');
      expect(result.some((p) => p.type === 'same' && p.text.includes('hello'))).toBe(true);
      expect(result.some((p) => p.type === 'removed' && p.text.includes('cruel'))).toBe(true);
      expect(result.some((p) => p.type === 'same' && p.text.includes('world'))).toBe(true);
    });

    it('detects single word replacement', () => {
      const result = wordDiff('hello world', 'hello universe');
      expect(result.some((p) => p.type === 'same' && p.text.includes('hello'))).toBe(true);
      expect(result.some((p) => p.type === 'removed' && p.text.includes('world'))).toBe(true);
      expect(result.some((p) => p.type === 'added' && p.text.includes('universe'))).toBe(true);
    });
  });

  describe('whitespace handling', () => {
    it('treats multiple spaces as single tokens', () => {
      const result = wordDiff('hello  world', 'hello world');
      // Multiple spaces should be preserved or normalized depending on tokenization
      expect(result.length).toBeGreaterThan(0);
    });

    it('handles newlines as tokens', () => {
      const result = wordDiff('hello\nworld', 'hello world');
      expect(result).toBeTruthy();
      expect(Array.isArray(result)).toBe(true);
    });

    it('handles tabs as tokens', () => {
      const result = wordDiff('hello\tworld', 'hello world');
      expect(result).toBeTruthy();
      expect(Array.isArray(result)).toBe(true);
    });

    it('handles leading/trailing whitespace', () => {
      const result = wordDiff('  hello world  ', 'hello world');
      expect(result).toBeTruthy();
      expect(Array.isArray(result)).toBe(true);
    });
  });

  describe('complex edits', () => {
    it('handles multiple additions', () => {
      const result = wordDiff('a c', 'a b c d');
      expect(result.filter((p) => p.type === 'added').length).toBeGreaterThan(0);
      expect(result.filter((p) => p.type === 'same').length).toBeGreaterThan(0);
    });

    it('handles multiple removals', () => {
      const result = wordDiff('a b c d', 'a c');
      expect(result.filter((p) => p.type === 'removed').length).toBeGreaterThan(0);
      expect(result.filter((p) => p.type === 'same').length).toBeGreaterThan(0);
    });

    it('handles completely different strings', () => {
      const result = wordDiff('abc def', 'xyz qwerty');
      expect(result).toContainEqual(expect.objectContaining({ type: 'removed' }));
      expect(result).toContainEqual(expect.objectContaining({ type: 'added' }));
    });

    it('groups consecutive changes of same type', () => {
      const result = wordDiff('a b c', 'd e f');
      const removedParts = result.filter((p) => p.type === 'removed');
      const addedParts = result.filter((p) => p.type === 'added');
      // Should group consecutive tokens
      expect(removedParts.length).toBeGreaterThanOrEqual(1);
      expect(addedParts.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe('real-world use cases', () => {
    it('diffs sentences with word additions', () => {
      const before = 'I like dogs';
      const after = 'I really like big dogs';
      const result = wordDiff(before, after);
      expect(result.some((p) => p.type === 'same' && p.text.includes('I'))).toBe(true);
      expect(result.some((p) => p.type === 'added' && p.text.includes('really'))).toBe(true);
      expect(result.some((p) => p.type === 'added' && p.text.includes('big'))).toBe(true);
      expect(result.some((p) => p.type === 'same' && p.text.includes('like'))).toBe(true);
      expect(result.some((p) => p.type === 'same' && p.text.includes('dogs'))).toBe(true);
    });

    it('diffs professional resume bullets', () => {
      const before = 'Led team to implement new authentication system';
      const after = 'Successfully led cross-functional team to implement new authentication system for production';
      const result = wordDiff(before, after);
      // Verify all parts have valid types
      expect(result.every((p) => ['same', 'added', 'removed'].includes(p.type))).toBe(true);
      // Verify there are additions and same parts
      expect(result.some((p) => p.type === 'added')).toBe(true);
      expect(result.some((p) => p.type === 'same')).toBe(true);
      // Verify common text is preserved
      expect(result.some((p) => p.text.includes('Led') || p.text.includes('led'))).toBe(true);
      expect(result.some((p) => p.text.includes('team'))).toBe(true);
      expect(result.some((p) => p.text.includes('implement'))).toBe(true);
    });

    it('diffs skill lists', () => {
      const before = 'TypeScript JavaScript React Node.js';
      const after = 'TypeScript JavaScript React Node.js AWS PostgreSQL';
      const result = wordDiff(before, after);
      expect(result.some((p) => p.type === 'added')).toBe(true);
      expect(result.some((p) => p.type === 'same')).toBe(true);
    });
  });

  describe('edge cases', () => {
    it('handles empty strings', () => {
      expect(wordDiff('', '')).toEqual([]);
    });

    it('handles single word', () => {
      const result = wordDiff('hello', 'hello');
      expect(result).toEqual([{ type: 'same', text: 'hello' }]);
    });

    it('handles single character words', () => {
      const result = wordDiff('a b c', 'a c');
      expect(result).toBeTruthy();
      expect(Array.isArray(result)).toBe(true);
    });

    it('handles punctuation as part of words', () => {
      const result = wordDiff('hello, world!', 'hello world');
      expect(result).toBeTruthy();
      expect(Array.isArray(result)).toBe(true);
    });

    it('handles numbers', () => {
      const result = wordDiff('test 123', 'test 456');
      expect(result).toBeTruthy();
    });

    it('handles special characters', () => {
      const result = wordDiff('test@example.com', 'test@example.org');
      expect(result).toBeTruthy();
    });
  });

  describe('large input fallback', () => {
    it('falls back to whole-string replace for very long before strings', () => {
      const longBefore = 'word '.repeat(500); // 2500 tokens (exceeds MAX_TOKENS of 400)
      const after = 'replacement';
      const result = wordDiff(longBefore, after);
      // Should return simple removed + added without complex diff
      expect(result).toEqual([
        { type: 'removed', text: longBefore },
        { type: 'added', text: after },
      ]);
    });

    it('falls back to whole-string replace for very long after strings', () => {
      const before = 'word';
      const longAfter = 'word '.repeat(500);
      const result = wordDiff(before, longAfter);
      expect(result).toEqual([
        { type: 'removed', text: before },
        { type: 'added', text: longAfter },
      ]);
    });

    it('falls back when both strings are very long', () => {
      const longBefore = 'before '.repeat(300);
      const longAfter = 'after '.repeat(300);
      const result = wordDiff(longBefore, longAfter);
      expect(result).toEqual([
        { type: 'removed', text: longBefore },
        { type: 'added', text: longAfter },
      ]);
    });

    it('uses normal diff when both strings are under token limit', () => {
      const before = 'word '.repeat(100); // ~500 chars, under 400 tokens
      const after = 'word '.repeat(100);
      const result = wordDiff(before, after);
      // Should use LCS algorithm
      expect(result.some((p) => p.type === 'same')).toBe(true);
    });
  });

  describe('return type validation', () => {
    it('returns array of DiffPart objects', () => {
      const result = wordDiff('a b', 'a c');
      expect(Array.isArray(result)).toBe(true);
      result.forEach((part) => {
        expect(part).toHaveProperty('type');
        expect(part).toHaveProperty('text');
        expect(['same', 'added', 'removed']).toContain(part.type);
        expect(typeof part.text).toBe('string');
      });
    });

    it('never returns empty text parts', () => {
      const result = wordDiff('hello world', 'goodbye world');
      result.forEach((part) => {
        expect(part.text.length).toBeGreaterThan(0);
      });
    });

    it('concatenates consecutive parts of same type', () => {
      // This is an implementation detail but important for correctness
      // There should be no two consecutive parts with the same type
      const result = wordDiff('a b c', 'd e f');
      for (let i = 0; i < result.length - 1; i++) {
        expect(result[i].type).not.toBe(result[i + 1].type);
      }
    });
  });

  describe('sideBySideWordDiff', () => {
    it('splits into beforeParts (no added) and afterParts (no removed)', () => {
      const before = 'Led migration of auth service';
      const after = 'Architected zero-downtime migration of auth service reducing latency by 40%';
      const { beforeParts, afterParts } = sideBySideWordDiff(before, after);

      expect(beforeParts.every((p) => p.type !== 'added')).toBe(true);
      expect(afterParts.every((p) => p.type !== 'removed')).toBe(true);
      expect(beforeParts.some((p) => p.type === 'removed' && p.text.includes('Led'))).toBe(true);
      expect(afterParts.some((p) => p.type === 'added' && p.text.includes('Architected'))).toBe(true);
      expect(afterParts.some((p) => p.type === 'added' && p.text.includes('40%'))).toBe(true);
    });
  });
});

