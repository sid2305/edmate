// Unit (no database): task 12.2a. Every reports method rejects a bad scope, a bad staff id or a bad
// input before any SQL. The pool points at an unreachable host, so a query attempt would surface
// as a connection error instead of the RepositoryError these tests expect.
import { afterAll, describe, expect, it } from 'vitest';
import { createDb } from '../src/client.js';
import {
  createRepositories,
  REPORT_CATEGORIES,
  REPORT_NOTE_MAX,
  REPORTS_QUEUE_MAX_LIMIT,
  reportRowId,
  RepositoryError,
} from '../src/index.js';

const handle = createDb({ DATABASE_URL: 'postgres://u:p@127.0.0.1:1/none' });
const repos = createRepositories(handle.db);
afterAll(() => handle.close());

const SCOPE = { studentId: 'stu_1', teacherId: 'tch_a' };
const GOOD = { sessionId: 'ses_1a', messageId: 'msg_1a_2', category: 'harmful' as const };

async function kindOf(p: Promise<unknown>): Promise<{ kind: string; method: string }> {
  const e = await p.then(
    () => new Error('resolved'),
    (x: unknown) => x,
  );
  expect(e).toBeInstanceOf(RepositoryError);
  return { kind: (e as RepositoryError).kind, method: (e as RepositoryError).method };
}

describe('reports constants', () => {
  it('has the closed category set and the caps from the plan', () => {
    expect(REPORT_CATEGORIES).toEqual([
      'harmful',
      'inappropriate',
      'wrong_information',
      'copyright',
      'other',
    ]);
    expect(REPORTS_QUEUE_MAX_LIMIT).toBe(50);
    expect(REPORT_NOTE_MAX).toBe(500);
  });

  it('derives one row id per (reporter, message), never containing either id', () => {
    const a = reportRowId('stu_1', 'msg_1');
    expect(a).toMatch(/^rp_[0-9a-f]{40}$/);
    expect(reportRowId('stu_1', 'msg_1')).toBe(a);
    expect(reportRowId('stu_2', 'msg_1')).not.toBe(a);
    expect(reportRowId('stu_1', 'msg_2')).not.toBe(a);
    // The separator keeps ('stu_1', 'x') and ('stu_1x', '') apart.
    expect(reportRowId('ab', 'c')).not.toBe(reportRowId('a', 'bc'));
    expect(a).not.toContain('stu_1');
  });
});

describe('reports.file rejects before any SQL', () => {
  it.each([
    ['undefined', undefined],
    ['a teacher scope', { teacherId: 'tch_a' }],
    ['an extra key', { ...SCOPE, staff: true }],
    ['SQL in an id', { studentId: "x' or 1=1", teacherId: 'tch_a' }],
  ])('a bad scope (%s) is scope', async (_l, bad) => {
    expect(await kindOf(repos.reports.file(bad as never, GOOD))).toEqual({
      kind: 'scope',
      method: 'reports.file',
    });
  });

  it.each([
    ['no input', undefined],
    ['free text in category', { ...GOOD, category: 'he was rude to me' }],
    ['an unknown category', { ...GOOD, category: 'spam' }],
    ['a note (students send categories only)', { ...GOOD, note: 'my phone is 555' }],
    ['a reporter id key', { ...GOOD, studentId: 'stu_2' }],
    ['a missing message id', { sessionId: 'ses_1a', category: 'other' }],
    ['a malformed message id', { ...GOOD, messageId: 'msg 1' }],
    ['an empty session id', { ...GOOD, sessionId: '' }],
    ['a 129-char message id', { ...GOOD, messageId: 'm'.repeat(129) }],
  ])('a bad input (%s) is invalid', async (_l, bad) => {
    expect(await kindOf(repos.reports.file(SCOPE, bad as never))).toEqual({
      kind: 'invalid',
      method: 'reports.file',
    });
  });
});

describe('reports.listOpenForStaff rejects before any SQL', () => {
  it.each([
    ['undefined', undefined],
    ['null', null],
    ['an object', { by: 'stf_1' }],
    ['an empty string', ''],
    ['SQL', "x' or 1=1"],
  ])('a malformed staff id (%s) is invalid', async (_l, by) => {
    expect(await kindOf(repos.reports.listOpenForStaff(by))).toEqual({
      kind: 'invalid',
      method: 'reports.listOpenForStaff',
    });
  });
});

describe('reports.review rejects before any SQL', () => {
  const DECISION = { decision: 'dismissed' as const };

  it('a malformed staff id is invalid', async () => {
    for (const by of [undefined, '', { by: 'stf_1' }, 'a'.repeat(129)]) {
      expect(await kindOf(repos.reports.review(by, 'rp_1', DECISION))).toEqual({
        kind: 'invalid',
        method: 'reports.review',
      });
    }
  });

  it('a malformed report id is invalid', async () => {
    for (const id of [undefined, '', 'rp 1', 7]) {
      expect((await kindOf(repos.reports.review('stf_1', id, DECISION))).kind).toBe('invalid');
    }
  });

  it.each([
    ['no input', undefined],
    ['an open decision', { decision: 'open' }],
    ['an unknown decision', { decision: 'deleted' }],
    ['an empty note', { decision: 'dismissed', note: '' }],
    ['a whitespace note', { decision: 'dismissed', note: '   ' }],
    ['an over-long note', { decision: 'actioned', note: 'x'.repeat(REPORT_NOTE_MAX + 1) }],
    ['an extra key', { decision: 'dismissed', by: 'stf_2' }],
  ])('a bad decision (%s) is invalid', async (_l, bad) => {
    expect((await kindOf(repos.reports.review('stf_1', 'rp_1', bad as never))).kind).toBe(
      'invalid',
    );
  });
});
