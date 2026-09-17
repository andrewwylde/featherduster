import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const SRC = path.resolve(__dirname, '../src');
const BANNED = ['Priya Shah', '#4821', 'wa-au-018', 'deskFixtures', 'reliability story may be taking shape', '140k daily worker tasks'];

function files(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((d) => {
    const full = path.join(dir, d.name);
    return d.isDirectory() ? files(full) : /\.(ts|tsx)$/.test(d.name) ? [full] : [];
  });
}

describe('no demo data in the shipped UI', () => {
  it('contains none of the retired fixture strings', () => {
    const hits = files(SRC).flatMap((f) => {
      const text = fs.readFileSync(f, 'utf-8');
      return BANNED.filter((b) => text.includes(b)).map((b) => `${path.relative(SRC, f)}: ${b}`);
    });
    expect(hits).toEqual([]);
  });
});
