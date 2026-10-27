// Unit (no database): task 9.3h. `audit.findLastVerifyForStaff` rejects a malformed `by` or
// `teacherId` before any SQL. The pool points at an unreachable host, so a query attempt would
// surface as a connection error instead of the RepositoryError these tests expect.
// audit.int.test.ts's grid entry (packages/db/test/repositories.int.test.ts) covers the SQL path.
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';
import { createDb } from '../src/client.js';
import { AUDIT_JSON_MAX_LENGTH } from '../src/repositories/audit.js';
import { createRepositories, RepositoryError } from '../src/index.js';
import type * as RedactJson from '../src/repositories/redact-json.js';

vi.mock('../src/repositories/redact-json.js', async (importOriginal) => {
  const actual = await importOriginal<typeof RedactJson>();
  return { ...actual, redactPersonalData: vi.fn(actual.redactPersonalData) };
});
import { redactPersonalData } from '../src/repositories/redact-json.js';

const handle = createDb({ DATABASE_URL: 'postgres://u:p@127.0.0.1:1/none' });
const repos = createRepositories(handle.db);
afterAll(() => handle.close());

afterEach(() => {
  vi.mocked(redactPersonalData).mockClear();
});

const STAFF = 'stf_1';
const TEACHER = 'tch_1';
const STUDENT = 'stu_1';

async function kindOf(p: Promise<unknown>): Promise<{ kind: string; method: string }> {
  const e = await p.then(
    () => new Error('resolved'),
    (x: unknown) => x,
  );
  expect(e).toBeInstanceOf(RepositoryError);
  return { kind: (e as RepositoryError).kind, method: (e as RepositoryError).method };
}

const BAD_IDS: [string, unknown][] = [
  ['undefined', undefined],
  ['null', null],
  ['empty', ''],
  ['a number', 7],
  ['a space', 'stf 1'],
  ['too long', 'x'.repeat(129)],
  ['an object', { id: STAFF }],
];

describe('audit.findLastVerifyForStaff rejects before any SQL', () => {
  it.each(BAD_IDS)('a malformed staff id (%s) is invalid', async (_n, by) => {
    expect(await kindOf(repos.audit.findLastVerifyForStaff(by, TEACHER))).toEqual({
      kind: 'invalid',
      method: 'audit.findLastVerifyForStaff',
    });
  });

  it.each(BAD_IDS)('a malformed teacher id (%s) is invalid', async (_n, teacherId) => {
    expect(await kindOf(repos.audit.findLastVerifyForStaff(STAFF, teacherId))).toEqual({
      kind: 'invalid',
      method: 'audit.findLastVerifyForStaff',
    });
  });
});

const BAD_LIMITS: [string, unknown][] = [
  ['undefined', undefined],
  ['null', null],
  ['a string', '3'],
  ['zero', 0],
  ['negative', -1],
  ['not an integer', 1.5],
  ['over the cap', 11],
];

describe('audit.findSubjectHistoryForStaff rejects before any SQL', () => {
  it.each(BAD_IDS)('a malformed staff id (%s) is invalid', async (_n, by) => {
    expect(await kindOf(repos.audit.findSubjectHistoryForStaff(by, TEACHER, 10))).toEqual({
      kind: 'invalid',
      method: 'audit.findSubjectHistoryForStaff',
    });
  });

  it.each(BAD_IDS)('a malformed teacher id (%s) is invalid', async (_n, teacherId) => {
    expect(await kindOf(repos.audit.findSubjectHistoryForStaff(STAFF, teacherId, 10))).toEqual({
      kind: 'invalid',
      method: 'audit.findSubjectHistoryForStaff',
    });
  });

  it.each(BAD_LIMITS)('a malformed limit (%s) is invalid', async (_n, limit) => {
    expect(await kindOf(repos.audit.findSubjectHistoryForStaff(STAFF, TEACHER, limit))).toEqual({
      kind: 'invalid',
      method: 'audit.findSubjectHistoryForStaff',
    });
  });
});

describe('storable() caps size before redacting, not after', () => {
  const OVERSIZED = 'x'.repeat(AUDIT_JSON_MAX_LENGTH + 1);

  it('audit.appendForTeacher rejects an oversized before without redacting it', async () => {
    expect(
      await kindOf(
        repos.audit.appendForTeacher(
          { teacherId: TEACHER },
          {
            actor: TEACHER,
            actorRole: 'teacher',
            action: 'config.update',
            target: 'teacher:tch_1',
            before: OVERSIZED,
          },
        ),
      ),
    ).toEqual({ kind: 'invalid', method: 'audit.appendForTeacher' });
    expect(vi.mocked(redactPersonalData).mock.calls.length).toBe(0);
  });

  it('audit.appendForStudent rejects an oversized after without redacting it', async () => {
    expect(
      await kindOf(
        repos.audit.appendForStudent(
          { teacherId: TEACHER, studentId: STUDENT },
          {
            actor: TEACHER,
            actorRole: 'teacher',
            action: 'memory.update',
            target: 'student:stu_1',
            after: OVERSIZED,
          },
        ),
      ),
    ).toEqual({ kind: 'invalid', method: 'audit.appendForStudent' });
    expect(vi.mocked(redactPersonalData).mock.calls.length).toBe(0);
  });

  it('still rejects a value that redacts from under the cap to over it', async () => {
    // Under the pre-cap raw, but redaction replaces each short value with the longer `[redacted]`
    // placeholder enough times to push the result over the cap: the unchanged post-redaction
    // check (not the new pre-check) is what catches this one.
    const before: Record<string, string> = {};
    for (let i = 0; i < 700; i++) before[`email${i}`] = '';
    expect(
      await kindOf(
        repos.audit.appendForTeacher(
          { teacherId: TEACHER },
          {
            actor: TEACHER,
            actorRole: 'teacher',
            action: 'config.update',
            target: 'teacher:tch_1',
            before,
          },
        ),
      ),
    ).toEqual({ kind: 'invalid', method: 'audit.appendForTeacher' });
    expect(vi.mocked(redactPersonalData).mock.calls.length).toBe(1);
  });
});
