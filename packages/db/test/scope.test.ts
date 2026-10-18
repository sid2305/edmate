// Unit (no database): a bad scope never reaches SQL. Every repository method is called with bad
// scopes against a pool pointed at an unreachable host, so a query attempt would surface as a
// connection error instead of the `scope` RepositoryError this test expects.
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';
import { createDb } from '../src/client.js';
import {
  createRepositories,
  RepositoryError,
  studentScope,
  teacherScope,
  transcriptStoreFor,
  usageMeterFor,
} from '../src/index.js';

const handle = createDb({ DATABASE_URL: 'postgres://u:p@127.0.0.1:1/none' });
const repos = createRepositories(handle.db);
afterAll(() => handle.close());

const BAD_SCOPES: [string, unknown][] = [
  ['undefined', undefined],
  ['null', null],
  ['a string', 'tch_a'],
  ['an empty object', {}],
  ['empty ids', { studentId: '', teacherId: '' }],
  ['SQL in an id', { studentId: "x' or 1=1", teacherId: "x' or 1=1" }],
  ['a 129-char id', { studentId: 'a'.repeat(129), teacherId: 'a'.repeat(129) }],
  ['an undefined id', { studentId: undefined, teacherId: undefined }],
  ['an array', ['tch_a']],
];

function expectScopeError(fn: () => unknown, method?: string) {
  let caught: unknown;
  try {
    fn();
  } catch (e) {
    caught = e;
  }
  expect(caught).toBeInstanceOf(RepositoryError);
  const err = caught as RepositoryError;
  expect(err.kind).toBe('scope');
  expect(err.code).toBe('forbidden');
  if (method) expect(err.method).toBe(method);
}

describe('scope parsers', () => {
  it('accept valid ids and return a fresh object with only the scope keys', () => {
    const input = { teacherId: 'tch_a' };
    const t = teacherScope(input);
    expect(t).toEqual({ teacherId: 'tch_a' });
    expect(t).not.toBe(input);
    expect(studentScope({ studentId: 'stu_1', teacherId: 'tch-A_9' })).toEqual({
      studentId: 'stu_1',
      teacherId: 'tch-A_9',
    });
    expect(teacherScope({ teacherId: 'a'.repeat(128) }).teacherId).toHaveLength(128);
  });

  it.each(BAD_SCOPES)('teacherScope rejects %s', (_label, bad) => {
    expectScopeError(() => teacherScope(bad));
  });

  it.each(BAD_SCOPES)('studentScope rejects %s', (_label, bad) => {
    expectScopeError(() => studentScope(bad));
  });

  it('reject extra keys and half scopes', () => {
    expectScopeError(() => teacherScope({ teacherId: 'tch_a', studentId: 'stu_1' }));
    expectScopeError(() => studentScope({ studentId: 'stu_1', teacherId: 'tch_a', admin: true }));
    expectScopeError(() => studentScope({ studentId: 'stu_1' }));
    expectScopeError(() => studentScope({ teacherId: 'tch_a' }));
  });

  it('name the method, never the ids, in the error message', () => {
    try {
      studentScope({ studentId: 'stu_secret_1', teacherId: "x' or 1=1" }, 'sessions.get');
      expect.unreachable();
    } catch (e) {
      const err = e as RepositoryError;
      expect(err.method).toBe('sessions.get');
      expect(err.message).toContain('sessions.get');
      expect(err.message).not.toContain('stu_secret_1');
      expect(err.message).not.toContain('or 1=1');
    }
  });
});

/** Every `repo.method` on createRepositories(db), found at runtime. */
function allMethods(): [string, (...args: unknown[]) => Promise<unknown>][] {
  return Object.entries(repos).flatMap(([repo, methods]) =>
    Object.entries(methods as Record<string, (...args: unknown[]) => Promise<unknown>>).map(
      ([name, fn]) => [`${repo}.${name}`, fn] as [string, (...args: unknown[]) => Promise<unknown>],
    ),
  );
}

describe('every repository method rejects a bad scope before any SQL', () => {
  const methods = allMethods();

  it('finds the methods', () => {
    expect(methods.length).toBeGreaterThanOrEqual(16);
  });

  // Plausible non-scope arguments, so only the scope can be at fault.
  const otherArgs = [
    { agentId: 'agt_a', version: 1, status: 'open', limit: 10, text: 'x', similarIds: [] },
    10,
    { id: 'm1', role: 'student', text: 'x', createdAt: '2026-10-17T10:00:00Z' },
  ];

  const extra = [
    ['a teacher scope with an extra key', { teacherId: 'tch_a', extra: 1 }],
    ['a student scope with an extra key', { studentId: 'stu_1', teacherId: 'tch_a', extra: 1 }],
  ] as const;

  for (const [name, fn] of methods) {
    it(`${name}`, async () => {
      for (const [, bad] of [...BAD_SCOPES, ...extra]) {
        const err = await fn(bad, 'ses_1', ...otherArgs).then(
          () => new Error('resolved'),
          (e: unknown) => e,
        );
        expect(err, name).toBeInstanceOf(RepositoryError);
        expect((err as RepositoryError).kind, name).toBe('scope');
        expect((err as RepositoryError).method).toBe(name);
      }
    });
  }

  it('transcriptStoreFor rejects a bad scope at construction', () => {
    for (const [, bad] of BAD_SCOPES) {
      expectScopeError(() => transcriptStoreFor(repos, bad as never), 'transcriptStoreFor');
    }
  });

  it('usageMeterFor rejects a bad scope at construction', () => {
    for (const [, bad] of BAD_SCOPES) {
      expectScopeError(() => usageMeterFor(repos, bad as never), 'usageMeterFor');
    }
  });
});

describe('package surface', () => {
  it('the root export has no raw database handle and no schema tables', async () => {
    const root = await import('../src/index.js');
    const keys = Object.keys(root);
    for (const k of ['createDb', 'sessions', 'messages', 'users', 'learnerProfiles']) {
      expect(keys, k).not.toContain(k);
    }
    const internal = await import('../src/internal.js');
    expect(Object.keys(internal)).toEqual(
      expect.arrayContaining(['createDb', 'sessions', 'users']),
    );
  });
});

describe('repositories source', () => {
  const dir = fileURLToPath(new URL('../src/repositories', import.meta.url));

  it('has no raw SQL strings and no deletes', () => {
    const files = readdirSync(dir).filter((f) => f.endsWith('.ts'));
    expect(files.length).toBeGreaterThan(5);
    for (const f of files) {
      const src = readFileSync(join(dir, f), 'utf8');
      expect(src.includes('sql.raw('), `${f} uses sql.raw(`).toBe(false);
      expect(src.includes('.delete('), `${f} uses .delete(`).toBe(false);
      expect(/\bdelete\s+from\b/i.test(src), `${f} deletes`).toBe(false);
    }
  });

  it('never reads from users (no names, emails or phones)', () => {
    for (const f of readdirSync(dir).filter((x) => x.endsWith('.ts'))) {
      const src = readFileSync(join(dir, f), 'utf8');
      expect(/\busers\b/.test(src), `${f} mentions users`).toBe(false);
    }
  });
});
