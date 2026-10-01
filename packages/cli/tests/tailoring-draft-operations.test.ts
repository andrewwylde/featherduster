import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { randomUUID, createHash } from 'node:crypto';
import { afterEach, beforeEach, expect, it } from 'vitest';
import type { DraftRecord } from '@featherduster/core';
import { DraftRepository } from '../src/tailoring/drafts/repository.js';
import {
  DraftOperationRunner,
  type DraftOperation,
} from '../src/tailoring/drafts/operations.js';
let dir: string;
let repo: DraftRepository;
const sha = (s: string) => createHash('sha256').update(s).digest('hex');
const record = (): DraftRecord => ({
  schemaVersion: 1,
  id: randomUUID(),
  kind: 'setup',
  lifecycle: 'draft',
  revision: 0,
  createdAt: '2000-01-01T00:00:00Z',
  editedAt: '2000-01-01T00:00:00Z',
  savedAt: '2000-01-01T00:00:00Z',
  context: {},
  appliedContent: {},
  base: null,
  payload: { posting: '', label: '', runner: '', baseResumeId: '' },
});
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'draft-ops-'));
  repo = new DraftRepository(dir);
});
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));
function operation(
  command: DraftOperation['command'] = 'apply',
): DraftOperation {
  const a = repo.create(record(), 'initial');
  return {
    operationId: randomUUID(),
    draftId: a.record.id,
    command,
    expected: a.token,
    next: {
      ...a.record,
      lifecycle: command === 'complete' ? 'completed' : 'draft',
    },
    writes: [
      {
        path: 'tailoring/test/analysis.json',
        expectedHash: null,
        content: 'first',
      },
      {
        path: 'tailoring/test/run.yaml',
        expectedHash: null,
        content: 'second',
      },
    ],
    result: { runSlug: 'test' },
  };
}
it.each(['md', 'tex', 'yaml', 'yml', 'json'])('checks read-only nested resume sources with non-slug names (%s)', extension => {
  const op = operation('sync');
  const source = `resumes/templates/Nested folder/My Base Resume.${extension}`;
  fs.mkdirSync(path.dirname(path.join(dir, source)), { recursive: true });
  fs.writeFileSync(path.join(dir, source), 'source bytes');
  op.sources = [{ path: source, expectedHash: sha('source bytes') }];
  expect(new DraftOperationRunner(dir, repo).execute(op).acknowledgement.record.id).toBe(op.draftId);
  expect(fs.readFileSync(path.join(dir, source), 'utf8')).toBe('source bytes');
});
it.each(['resumes/templates/../secret.md', 'notes/private.md', 'resumes/templates/base.md:secret', '/resumes/templates/base.md'])('rejects unsafe or arbitrary read-only source %s', source => {
  const op = operation('sync'); op.sources = [{ path: source, expectedHash: null }];
  expect(() => new DraftOperationRunner(dir, repo).execute(op)).toThrow(/path|artifact/i);
});
it('rejects a read-only resume source with a symlink ancestor', () => {
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'source-outside-'));
  try {
    fs.mkdirSync(path.join(dir, 'resumes/templates'), { recursive: true });
    fs.symlinkSync(outside, path.join(dir, 'resumes/templates/linked'), 'junction');
    const op = operation('sync'); op.sources = [{ path: 'resumes/templates/linked/Base Resume.md', expectedHash: null }];
    expect(() => new DraftOperationRunner(dir, repo).execute(op)).toThrow(/symlink/i);
  } finally { fs.rmSync(outside, { recursive: true, force: true }); }
});
it('does not widen write paths when accepting broader read-only resume paths', () => {
  const op = operation('sync'); op.writes = [{ path: 'resumes/tailored/Nested folder/My Resume.md', expectedHash: null, content: 'new' }];
  expect(() => new DraftOperationRunner(dir, repo).execute(op)).toThrow(/artifact/i);
});
it.each(['create-run', 'apply', 'sync', 'complete'] as const)(
  'recovers %s at every durable boundary with one acknowledgement',
  (command) => {
    for (const point of [
      'before-prepare',
      'after-prepare',
      'before-write:0',
      'before-replace:0',
      'after-write:0',
      'before-write:1',
      'before-replace:1',
      'after-write:1',
      'before-written',
      'after-written',
      'before-commit',
      'after-commit',
      'before-receipt',
      'after-receipt',
    ]) {
      const isolated = fs.mkdtempSync(path.join(dir, 'case-'));
      const local = new DraftRepository(isolated);
      const a = local.create(record(), 'initial');
      const op: DraftOperation = {
        operationId: randomUUID(),
        draftId: a.record.id,
        command,
        expected: a.token,
        next: {
          ...a.record,
          lifecycle: command === 'complete' ? 'completed' : 'draft',
        },
        writes: [
          {
            path: 'tailoring/test/analysis.json',
            expectedHash: null,
            content: 'first',
          },
          {
            path: 'tailoring/test/run.yaml',
            expectedHash: null,
            content: 'second',
          },
        ],
        result: { runSlug: 'test' },
      };
      const broken = new DraftOperationRunner(isolated, local, {
        checkpoint: (p) => {
          if (p === point) throw Error(`crash ${point}`);
        },
      });
      expect(() => broken.execute(op)).toThrow('crash');
      const fresh = new DraftOperationRunner(
        isolated,
        new DraftRepository(isolated),
      );
      const recovery = fresh.recover();
      expect(recovery.errors).toEqual([]);
      const result = fresh.execute(op);
      expect(fresh.execute(op)).toEqual(result);
      expect(result.acknowledgement.record.revision).toBe(2);
      expect(
        fs.readFileSync(path.join(isolated, op.writes[0].path), 'utf8'),
      ).toBe('first');
      expect(local.read(op.draftId).record.lifecycle).toBe(
        command === 'complete' ? 'completed' : 'draft',
      );
    }
  },
);
it('preserves newer output and blocks unrelated draft edits until recovery', () => {
  const op = operation();
  const broken = new DraftOperationRunner(dir, repo, {
    checkpoint: (p) => {
      if (p === 'after-write:0') throw Error('crash');
    },
  });
  expect(() => broken.execute(op)).toThrow();
  fs.writeFileSync(path.join(dir, op.writes[0].path), 'newer work');
  expect(() =>
    repo.update(op.draftId, {
      expected: op.expected!,
      mutationId: 'edit',
      change: 'context',
      context: {},
    }),
  ).toThrow(/pending|unresolved/i);
  const runner = new DraftOperationRunner(dir, repo);
  expect(runner.recover().errors).toHaveLength(1);
  expect(fs.readFileSync(path.join(dir, op.writes[0].path), 'utf8')).toBe(
    'newer work',
  );
  expect(repo.read(op.draftId).record.revision).toBe(1);
});
it('rejects different input for an operation id and validates all paths before writes', () => {
  const op = operation();
  const runner = new DraftOperationRunner(dir, repo);
  runner.execute(op);
  expect(() => runner.execute({ ...op, result: { runSlug: 'other' } })).toThrow(
    /operation/i,
  );
  const bad = operation();
  bad.writes[1].path = '../escape';
  expect(() => runner.execute(bad)).toThrow(/path/i);
});
it('creates a new continued draft with stable repository metadata', () => {
  const next = record();
  const op: DraftOperation = {
    operationId: randomUUID(),
    draftId: next.id,
    command: 'continue',
    expected: null,
    next,
    writes: [],
    result: { draftId: next.id },
  };
  const runner = new DraftOperationRunner(dir, repo);
  const result = runner.execute(op);
  expect(result.acknowledgement.record.revision).toBe(1);
  expect(runner.execute(op)).toEqual(result);
});
it('checks source hashes without overwriting existing output', () => {
  const op = operation();
  fs.mkdirSync(path.join(dir, 'resumes/templates'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'resumes/templates/base.yaml'), 'old');
  op.sources = [
    { path: 'resumes/templates/base.yaml', expectedHash: sha('old') },
  ];
  const runner = new DraftOperationRunner(dir, repo, {
    checkpoint: (p) => {
      if (p === 'after-prepare')
        fs.writeFileSync(path.join(dir, 'resumes/templates/base.yaml'), 'new');
    },
  });
  expect(() => runner.execute(op)).toThrow(/source|conflict/i);
  expect(fs.existsSync(path.join(dir, op.writes[0].path))).toBe(false);
});

it('exposes original allocated operation data for service retries', () => {
  const op = operation();
  op.request = { command: 'apply', stage: 'analysis' };
  const broken = new DraftOperationRunner(dir, repo, {
    checkpoint: (p) => {
      if (p === 'after-prepare') throw Error('crash');
    },
  });
  expect(() => broken.execute(op)).toThrow('crash');
  const runner = new DraftOperationRunner(dir, repo);
  expect(runner.lookup(op.operationId)).toMatchObject({
    operation: op,
    phase: 'prepared',
  });
  expect(runner.lookup(randomUUID())).toBeUndefined();
  const result = runner.execute(op);
  expect(runner.lookup(op.operationId)?.receipt).toEqual(result);
});
it('detects external edits during output temp-file preparation', () => {
  const op = operation();
  const runner = new DraftOperationRunner(dir, repo, {
    checkpoint: (p) => {
      if (p === 'before-replace:0')
        fs.writeFileSync(path.join(dir, op.writes[0].path), 'newer');
    },
  });
  expect(() => runner.execute(op)).toThrow(/conflict/i);
  expect(fs.readFileSync(path.join(dir, op.writes[0].path), 'utf8')).toBe(
    'newer',
  );
  expect(repo.read(op.draftId).record.revision).toBe(1);
});

it.each([false, true])(
  'recovers a repository rename failure (already renamed: %s)',
  (renamed) => {
    const op = operation();
    const broken = new DraftRepository(dir, {
      replace: (from, to) => {
        if (renamed) fs.renameSync(from, to);
        throw Error('rename failed');
      },
    });
    expect(() => new DraftOperationRunner(dir, broken).execute(op)).toThrow(
      'rename failed',
    );
    const runner = new DraftOperationRunner(dir, new DraftRepository(dir));
    expect(runner.recover().errors).toEqual([]);
    expect(runner.execute(op).acknowledgement.record.revision).toBe(2);
  },
);
it('skips already identical outputs while applying missing outputs', () => {
  const op = operation();
  fs.mkdirSync(path.dirname(path.join(dir, op.writes[0].path)), {
    recursive: true,
  });
  fs.writeFileSync(path.join(dir, op.writes[0].path), op.writes[0].content);
  const runner = new DraftOperationRunner(dir, repo, {
    checkpoint: (p) => {
      if (p === 'before-replace:0') throw Error('must skip');
    },
  });
  expect(runner.execute(op).acknowledgement.record.revision).toBe(2);
});
it.each([NaN, undefined, new Date(), () => 42])(
  'rejects non-JSON results before journaling (%s)',
  (result) => {
    const op = operation();
    op.result = result as never;
    expect(() => new DraftOperationRunner(dir, repo).execute(op)).toThrow(
      /JSON/i,
    );
    expect(repo.read(op.draftId).record.revision).toBe(1);
  },
);
it('rejects artifact symlink ancestors before publishing an intent', () => {
  const op = operation();
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'draft-outside-'));
  try {
    fs.symlinkSync(outside, path.join(dir, 'tailoring'), 'junction');
    expect(() => new DraftOperationRunner(dir, repo).execute(op)).toThrow(
      /symlink/i,
    );
    expect(fs.readdirSync(outside)).toEqual([]);
  } finally {
    fs.rmSync(outside, { recursive: true, force: true });
  }
});
it('keeps original operation receipts after repository receipts expire', () => {
  const op = operation();
  const runner = new DraftOperationRunner(dir, repo);
  const result = runner.execute(op);
  let a = result.acknowledgement;
  for (let i = 0; i < 33; i++)
    a = repo.update(op.draftId, {
      expected: a.token,
      mutationId: `later-${i}`,
      change: 'context',
      context: {},
    });
  expect(
    new DraftOperationRunner(dir, new DraftRepository(dir)).execute(op),
  ).toEqual(result);
});

it.each(['update', 'discard', 'trustedTransition'] as const)(
  'blocks uppercase draft aliases with unresolved intents through %s',
  (method) => {
    const op = operation();
    const interrupted = new DraftOperationRunner(dir, repo, {
      checkpoint: (point) => {
        if (point === 'after-prepare') throw new Error('interrupted');
      },
    });
    expect(() => interrupted.execute(op)).toThrow('interrupted');
    const alias = op.draftId.toUpperCase();
    const mutate = () => {
      if (method === 'update') {
        return repo.update(alias, {
          expected: op.expected!,
          mutationId: 'alias-update',
          change: 'context',
          context: {},
        });
      }
      if (method === 'discard')
        return repo.discard(alias, op.expected!, 'alias-discard');
      return repo.trustedTransition(
        alias,
        {
          expected: op.expected!,
          mutationId: 'alias-transition',
          input: {},
        },
        (record) => record,
      );
    };
    expect(mutate).toThrow(/unresolved operation/i);
    expect(repo.read(alias).record.revision).toBe(1);
  },
);

it('isolates corrupted journal ownership while recovering healthy drafts', () => {
  const bad = operation();
  bad.writes = [];
  const healthy = operation();
  healthy.writes = [];
  const interrupted = new DraftOperationRunner(dir, repo, {
    checkpoint: (point) => {
      if (point === 'after-prepare') throw new Error('interrupted');
    },
  });
  expect(() => interrupted.execute(bad)).toThrow('interrupted');
  expect(() => interrupted.execute(healthy)).toThrow('interrupted');
  const root = path.join(dir, 'tailoring-drafts', 'operations');
  const badJournal = fs
    .readdirSync(root, { recursive: true })
    .map(String)
    .find((name) => name.endsWith(`${bad.operationId}.json`))!;
  fs.writeFileSync(path.join(root, badJournal), '{');
  fs.writeFileSync(path.join(root, `${randomUUID()}.json`), '{');
  expect(() =>
    repo.update(bad.draftId, {
      expected: bad.expected!,
      mutationId: 'blocked',
      change: 'context',
      context: {},
    }),
  ).toThrow(/recovery/i);
  const unaffected = repo.create(record(), 'unaffected');
  expect(
    repo.update(unaffected.record.id, {
      expected: unaffected.token,
      mutationId: 'healthy-edit',
      change: 'context',
      context: {},
    }).record.revision,
  ).toBe(2);
  const recovered = new DraftOperationRunner(dir, repo).recover();
  expect(recovered.errors).toHaveLength(2);
  expect(recovered.results).toHaveLength(1);
  expect(recovered.results[0].acknowledgement.record.id).toBe(healthy.draftId);
});
it('rejects cross-draft operation identity reuse even when the first journal is corrupt', () => {
  const first = operation();
  first.writes = [];
  const second = operation();
  second.writes = [];
  second.operationId = first.operationId;
  const runner = new DraftOperationRunner(dir, repo);
  runner.execute(first);
  expect(() => runner.execute(second)).toThrow(/operation/i);
  const root = path.join(dir, 'tailoring-drafts', 'operations');
  const journal = fs
    .readdirSync(root, { recursive: true })
    .map(String)
    .find((name) => name.endsWith(`${first.operationId}.json`))!;
  fs.writeFileSync(path.join(root, journal), '{');
  expect(() => runner.execute(second)).toThrow();
  expect(repo.read(second.draftId).record.revision).toBe(1);
});

it('finalizes an already committed operation without replaying changed sources or artifacts', () => {
  const op = operation();
  const sourcePath = path.join(dir, 'resumes', 'templates', 'base.yaml');
  fs.mkdirSync(path.dirname(sourcePath), { recursive: true });
  fs.writeFileSync(sourcePath, 'original source');
  op.sources = [
    {
      path: 'resumes/templates/base.yaml',
      expectedHash: sha('original source'),
    },
  ];
  const interrupted = new DraftOperationRunner(dir, repo, {
    checkpoint: (point) => {
      if (point === 'after-commit') throw new Error('receipt interrupted');
    },
  });
  expect(() => interrupted.execute(op)).toThrow('receipt interrupted');
  const committed = repo.read(op.draftId);
  expect(committed.record.revision).toBe(2);
  fs.writeFileSync(sourcePath, 'new source');
  const later = operation();
  later.writes = op.writes.map((output) => ({
    ...output,
    expectedHash: sha(output.content),
    content: 'new shared artifact',
  }));
  expect(
    new DraftOperationRunner(dir, repo).execute(later).acknowledgement.record
      .revision,
  ).toBe(2);
  const runner = new DraftOperationRunner(dir, new DraftRepository(dir));
  const recovered = runner.recover();
  expect(recovered.errors).toEqual([]);
  const originalResult = {
    acknowledgement: { ...committed, mutationId: op.operationId },
    result: op.result,
  };
  expect(recovered.results).toEqual([originalResult]);
  expect(runner.execute(op)).toEqual(originalResult);
  expect(runner.lookup(op.operationId)?.phase).toBe('committed');
  expect(fs.readFileSync(sourcePath, 'utf8')).toBe('new source');
  for (const output of op.writes)
    expect(fs.readFileSync(path.join(dir, output.path), 'utf8')).toBe(
      'new shared artifact',
    );
  expect(
    repo.update(op.draftId, {
      expected: committed.token,
      mutationId: 'after-recovery',
      change: 'context',
      context: {},
    }).record.revision,
  ).toBe(3);
});
