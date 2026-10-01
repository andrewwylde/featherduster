import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { withDraftFileLock } from '../src/tailoring/drafts/locks.js';
const hooks = vi.hoisted(() => ({
  beforeLink: undefined as
    | undefined
    | ((source: fs.PathLike, target: fs.PathLike) => void),
  afterLink: undefined as
    | undefined
    | ((source: fs.PathLike, target: fs.PathLike) => void),
}));
vi.mock('node:fs', async (importOriginal) => {
  const original = await importOriginal<typeof fs>();
  return {
    ...original,
    linkSync: (source: fs.PathLike, target: fs.PathLike) => {
      hooks.beforeLink?.(source, target);
      original.linkSync(source, target);
      hooks.afterLink?.(source, target);
    },
  };
});
let dir: string;
let file: string;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'draft-locks-'));
  file = path.join(dir, 'draft.json');
});
afterEach(() => {
  hooks.beforeLink = undefined;
  hooks.afterLink = undefined;
  fs.rmSync(dir, { recursive: true, force: true });
});
it('a delayed contender abandons a recreated older generation before entering', () => {
  const events: string[] = [];
  hooks.beforeLink = (_source, target) => {
    if (!String(target).endsWith('1.owner')) return;
    hooks.beforeLink = undefined;
    withDraftFileLock(file, () => events.push('first'));
    withDraftFileLock(file, () => events.push('second'));
  };
  withDraftFileLock(file, () => events.push('delayed'));
  expect(events).toEqual(['first', 'second', 'delayed']);
  expect(
    fs.readdirSync(file + '.locks').filter((n) => n.endsWith('.owner')),
  ).toEqual(['3.owner']);
});
it('never advances past a live unreleased owner', () => {
  withDraftFileLock(file, () =>
    expect(() =>
      withDraftFileLock(file, () => {
        throw Error('entered');
      }),
    ).toThrow(/locked/i),
  );
});
it('recovers dead ownership without relying on a release marker or age', () => {
  fs.mkdirSync(file + '.locks');
  fs.writeFileSync(
    path.join(file + '.locks', '1.owner'),
    JSON.stringify({ pid: 2147483647, nonce: 'published' }),
  );
  expect(withDraftFileLock(file, () => 42)).toBe(42);
  expect(
    fs.readdirSync(file + '.locks').filter((n) => n.endsWith('.owner')),
  ).toEqual(['2.owner']);
});
it('ignores an unpublished owner temp left by an initialization crash', () => {
  fs.mkdirSync(file + '.locks');
  fs.writeFileSync(path.join(file + '.locks', '2147483647-abandoned.tmp'), '');
  expect(withDraftFileLock(file, () => 42)).toBe(42);
});
it('publishes complete verifiable ownership and release data atomically', () => {
  hooks.afterLink = (_source, target) => {
    const owner = JSON.parse(fs.readFileSync(target, 'utf8'));
    expect(owner.pid).toBe(process.pid);
    expect(owner.nonce).toMatch(/^[a-f0-9-]{36}$/);
  };
  expect(withDraftFileLock(file, () => 42)).toBe(42);
});
it('does not trust a mismatched release marker for a live owner', () => {
  fs.mkdirSync(file + '.locks');
  fs.writeFileSync(
    path.join(file + '.locks', '1.owner'),
    JSON.stringify({ pid: process.pid, nonce: 'live' }),
  );
  fs.writeFileSync(
    path.join(file + '.locks', '1.owner.done'),
    JSON.stringify({ pid: process.pid, nonce: 'other' }),
  );
  expect(() => withDraftFileLock(file, () => 42)).toThrow(/locked/i);
});

it('does not accept two malformed files as verified ownership and release', () => {
  fs.mkdirSync(file + '.locks');
  fs.writeFileSync(path.join(file + '.locks', '1.owner'), '');
  fs.writeFileSync(path.join(file + '.locks', '1.owner.done'), '');
  expect(() => withDraftFileLock(file, () => 42)).toThrow(/locked/i);
});
it('rejects non-safe generation numbers instead of wrapping the fence', () => {
  fs.mkdirSync(file + '.locks');
  const name = path.join(file + '.locks', '9007199254740992.owner');
  const owner = JSON.stringify({ pid: process.pid, nonce: 'released' });
  fs.writeFileSync(name, owner);
  fs.writeFileSync(name + '.done', owner);
  expect(() => withDraftFileLock(file, () => 42)).toThrow(/generation/i);
});
