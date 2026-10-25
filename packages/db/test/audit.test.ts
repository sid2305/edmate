// Unit (no database): task 9.3h. `audit.findLastVerifyForStaff` rejects a malformed `by` or
// `teacherId` before any SQL. The pool points at an unreachable host, so a query attempt would
// surface as a connection error instead of the RepositoryError these tests expect.
// audit.int.test.ts's grid entry (packages/db/test/repositories.int.test.ts) covers the SQL path.
import { afterAll, describe, expect, it } from 'vitest';
import { createDb } from '../src/client.js';
import { createRepositories, RepositoryError } from '../src/index.js';

const handle = createDb({ DATABASE_URL: 'postgres://u:p@127.0.0.1:1/none' });
const repos = createRepositories(handle.db);
afterAll(() => handle.close());

const STAFF = 'stf_1';
const TEACHER = 'tch_1';

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
