import * as fs from 'node:fs';
import * as path from 'node:path';
import { randomUUID } from 'node:crypto';
import { DraftRepositoryError } from './errors.js';
const fail = (status: number, code: string, detail: string): never => {
  throw new DraftRepositoryError(status, code, detail);
};
const isCode = (error: unknown, code: string) =>
  (error as NodeJS.ErrnoException).code === code;
/** Atomic publication of complete owners; monotonically increasing fences prevent
 * stale contenders from acquiring a deleted generation. Never reclaim by age.
 * A crash before publication leaves an inert temp; a crash before release is
 * recovered only after the OS reports the owner dead. PID reuse fails closed.
 */
export function withDraftFileLock<T>(file: string, action: () => T): T {
  const busy = (): never =>
    fail(409, 'locked', 'Draft is locked by another operation');
  const safe = (name: string) => {
    try {
      if (fs.lstatSync(name).isSymbolicLink())
        fail(400, 'unsafe_path', 'Lock cannot be a symlink');
    } catch (e) {
      if (!isCode(e, 'ENOENT')) throw e;
    }
  };
  const ownerAt = (
    name: string,
  ): { pid: number; nonce: string } | undefined => {
    safe(name);
    try {
      const owner = JSON.parse(fs.readFileSync(name, 'utf8'));
      if (
        owner &&
        Number.isSafeInteger(owner.pid) &&
        owner.pid > 0 &&
        typeof owner.nonce === 'string' &&
        owner.nonce
      )
        return owner;
    } catch {
      /* An unpublished or malformed owner cannot establish abandonment. */
    }
    return undefined;
  };
  const dead = (name: string): boolean => {
    const owner = ownerAt(name);
    if (!owner) return false;
    try {
      process.kill(owner.pid, 0);
      return false;
    } catch (e) {
      return isCode(e, 'ESRCH');
    }
  };
  // Old malformed/ownerless locks require explicit offline repair. They cannot
  // be proven abandoned, so migration never removes them speculatively.
  safe(file + '.lock');
  safe(file + '.lock.reclaim');
  if (
    fs.existsSync(file + '.lock.reclaim') ||
    (fs.existsSync(file + '.lock') && !dead(file + '.lock'))
  )
    busy();
  const directory = file + '.locks';
  safe(directory);
  fs.mkdirSync(directory, { recursive: true });
  safe(directory);
  const generations = () => {
    const numbers = fs
      .readdirSync(directory)
      .filter((n) => /^\d+\.owner$/.test(n))
      .map((n) => Number(n.split('.')[0]));
    if (
      numbers.some(
        (n) =>
          !Number.isSafeInteger(n) || n <= 0 || n === Number.MAX_SAFE_INTEGER,
      )
    )
      fail(409, 'corrupt_lock', 'Invalid lock generation');
    return numbers;
  };
  const highest = () => Math.max(0, ...generations());
  const nonce = randomUUID();
  const temp = path.join(directory, `${process.pid}-${nonce}.tmp`);
  const fd = fs.openSync(temp, 'wx', 0o600);
  try {
    fs.writeFileSync(fd, JSON.stringify({ pid: process.pid, nonce }));
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
  let ownerFile: string | undefined;
  try {
    for (let attempt = 0; attempt < 64; attempt++) {
      const current = highest();
      if (current) {
        const previous = path.join(directory, `${current}.owner`);
        const done = previous + '.done';
        safe(previous);
        safe(done);
        let released = false;
        try {
          released =
            Boolean(ownerAt(previous)) &&
            fs.readFileSync(done, 'utf8') === fs.readFileSync(previous, 'utf8');
        } catch (e) {
          if (!isCode(e, 'ENOENT')) throw e;
        }
        if (!released && !dead(previous)) busy();
      }
      const candidate = path.join(directory, `${current + 1}.owner`);
      try {
        fs.linkSync(temp, candidate);
      } catch (e) {
        if (isCode(e, 'EEXIST')) continue;
        throw e;
      }
      if (highest() !== current + 1) {
        try {
          fs.unlinkSync(candidate);
        } catch (e) {
          if (!isCode(e, 'ENOENT')) throw e;
        }
        continue;
      }
      ownerFile = candidate;
      for (const generation of generations().filter((n) => n < current + 1)) {
        for (const suffix of ['.owner', '.owner.done']) {
          const old = path.join(directory, `${generation}${suffix}`);
          safe(old);
          try {
            fs.unlinkSync(old);
          } catch (e) {
            if (!isCode(e, 'ENOENT')) throw e;
          }
        }
      }
      break;
    }
    if (!ownerFile) return busy();
    try {
      return action();
    } catch (e) {
      if (e instanceof DraftRepositoryError) throw e;
      return fail(
        500,
        'storage_error',
        e instanceof Error ? e.message : String(e),
      );
    }
  } finally {
    try {
      if (ownerFile) fs.linkSync(temp, ownerFile + '.done');
    } finally {
      fs.unlinkSync(temp);
    }
  }
}
