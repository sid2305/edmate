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
  profileStoreFor,
  RepositoryError,
  studentScope,
  teacherQuestionStoreFor,
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
    // discovery.search has no required field at all (`{}` means "no filters, browse all public
    // teachers" -- a legitimate call, not a bad scope), so it cannot satisfy this grid; its own
    // malformed-input cases are covered directly in discovery.int.test.ts and leak.test.ts.
    if (name === 'discovery.search') continue;
    // teacherProfiles.listPendingForStaff (12.1a) takes a bare staff id, not a TeacherScope or
    // StudentScope object: some BAD_SCOPES entries (for example the plain string 'tch_a') are
    // well-formed ids by its own IdSchema, so they would reach the database instead of failing
    // before any SQL. Its own malformed/non-staff cases are covered in teacher-profiles.test.ts
    // and teacher-profiles.int.test.ts.
    if (name === 'teacherProfiles.listPendingForStaff') continue;
    // reports.listOpenForStaff and reports.review (12.2a) take a bare staff id first, like
    // listPendingForStaff: a plain id string among BAD_SCOPES is well-formed for them and would
    // reach the database. Their malformed/non-staff cases are in reports.test.ts and
    // reports.int.test.ts.
    if (name === 'reports.listOpenForStaff' || name === 'reports.review') continue;
    // safetyAlerts (12.5a) takes no scope object either: the worker passes a contracts
    // SafetyAlert (its ids are the scope, checked through the alert's own session) and staff
    // pass a bare staff id. A malformed one is `invalid` before any SQL (safety-alerts.test.ts);
    // a wrong one is `not_found` or `scope` (safety-alerts.int.test.ts, the isolation grid).
    if (name.startsWith('safetyAlerts.')) continue;
    // takedowns (12.2b) take a bare staff id first, like reports.review. Their malformed and
    // non-staff cases are in takedowns.test.ts and takedowns.int.test.ts.
    if (name.startsWith('takedowns.')) continue;
    // regulatedSubjects (12.4a) takes a bare staff id `by` first, like listPendingForStaff: a
    // malformed one is `invalid` before any SQL (regulated-subjects.test.ts); a non-staff one is
    // `scope` (regulated-subjects.int.test.ts, the isolation grid).
    if (name.startsWith('regulatedSubjects.')) continue;
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

  it('profileStoreFor and teacherQuestionStoreFor reject a bad scope at construction', () => {
    for (const [, bad] of BAD_SCOPES) {
      expectScopeError(() => profileStoreFor(repos, bad as never), 'profileStoreFor');
      expectScopeError(
        () => teacherQuestionStoreFor(repos, bad as never),
        'teacherQuestionStoreFor',
      );
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

  it('has no raw SQL strings and no deletes outside chunks.ts, learner.ts and outline.ts (8.2, 6.5, 8.3)', () => {
    const files = readdirSync(dir).filter((f) => f.endsWith('.ts'));
    expect(files.length).toBeGreaterThan(5);
    for (const f of files) {
      const src = readFileSync(join(dir, f), 'utf8');
      expect(src.includes('sql.raw('), `${f} uses sql.raw(`).toBe(false);
      expect(/\bdelete\s+from\b/i.test(src), `${f} deletes in SQL text`).toBe(false);
      if (f !== 'chunks.ts' && f !== 'learner.ts' && f !== 'outline.ts') {
        expect(src.includes('.delete('), `${f} uses .delete(`).toBe(false);
      }
    }
  });

  it("outline.ts deletes only the scope's own topics and topic links, scoped in the same statement (8.3)", () => {
    const src = readFileSync(join(dir, 'outline.ts'), 'utf8');
    const deletes = [...src.matchAll(/\.delete\((\w+)\)([\s\S]*?);/g)];
    expect(deletes.map((m) => m[1]).sort()).toEqual(['topicChunks', 'topics']);
    for (const [, table, rest] of deletes) {
      expect(rest, `${table} delete`).toMatch(
        new RegExp(`^\\s*\\.where\\(\\s*and\\([\\s\\S]*eq\\(${table}\\.teacherId, teacherId\\)`),
      );
    }
  });

  it("learner.ts deletes only the scope's own evidence_events, scoped in the same statement (6.5)", () => {
    const src = readFileSync(join(dir, 'learner.ts'), 'utf8');
    const deletes = [...src.matchAll(/\.delete\((\w+)\)([\s\S]*?);/g)];
    expect(deletes).toHaveLength(1);
    const [, table, rest] = deletes[0]!;
    expect(table).toBe('evidenceEvents');
    expect(rest).toContain('eq(evidenceEvents.teacherId,');
    expect(rest).toContain('eq(evidenceEvents.studentId,');
    expect(rest).toMatch(/^\s*\.where\(/);
  });

  it("deletes only a teacher's own chunks and documents, scoped in the same statement (8.2)", () => {
    const src = readFileSync(join(dir, 'chunks.ts'), 'utf8');
    const deletes = [...src.matchAll(/\.delete\((\w+)\)([\s\S]*?);/g)];
    expect(deletes.map((m) => m[1]).sort()).toEqual(['chunks', 'documents']);
    for (const [, table, rest] of deletes) {
      expect(rest, `${table} delete`).toMatch(
        new RegExp(`^\\s*\\.where\\(\\s*and\\([\\s\\S]*eq\\(${table}\\.teacherId, teacherId\\)`),
      );
    }
  });

  it('never reads from users (no names, emails or phones), except discovery.ts and the staff-only queue in teacher-profiles.ts', () => {
    // Task 9.2a lead decision (Q2): a teacher's public sign-in name is their public display name
    // on the discovery page and card -- teacherProfiles has no separate displayName column, and
    // the WHERE clause (verified + live agent + live package) already keeps this to public rows
    // only. discovery.ts reads only `users.role` and `users.name`, never email or phone.
    for (const f of readdirSync(dir).filter(
      (x) => x.endsWith('.ts') && x !== 'discovery.ts' && x !== 'teacher-profiles.ts',
    )) {
      const src = readFileSync(join(dir, f), 'utf8');
      expect(/\busers\b/.test(src), `${f} mentions users`).toBe(false);
    }
    const discoverySrc = readFileSync(join(dir, 'discovery.ts'), 'utf8');
    expect(/\busers\.(email|phone)\b/.test(discoverySrc)).toBe(false);
    // Task 12.1a lead decision (Q2): the staff verification queue is the one place a teacher's
    // declared name and email reach a repository caller, and only staff see it (checked by role
    // in listPendingForStaff). `users.phone` stays out even here.
    const profilesSrc = readFileSync(join(dir, 'teacher-profiles.ts'), 'utf8');
    expect(/\busers\.phone\b/.test(profilesSrc)).toBe(false);
    expect(profilesSrc).toContain('listPendingForStaff');
    expect(profilesSrc).toContain('users.name');
    expect(profilesSrc).toContain('users.email');
  });

  it('reads a user only through role-lock.ts, which selects the role column alone (8.1)', () => {
    const src = readFileSync(join(dir, '..', 'role-lock.ts'), 'utf8');
    const selects = [...src.matchAll(/\.select\(([^)]*)\)/g)].map((m) => m[1]);
    expect(selects).toEqual(['{ role: users.role }']);
    expect(/\busers\.(email|phone|name)\b/.test(src)).toBe(false);
  });
});
