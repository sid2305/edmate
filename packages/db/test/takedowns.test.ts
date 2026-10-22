// Unit (no database): task 12.2b. Every takedowns method rejects a bad staff id or a bad input
// before any SQL. The pool points at an unreachable host, so a query attempt would surface as a
// connection error instead of the RepositoryError these tests expect. The SQL helper renders a
// qualified, parameter-free predicate.
import { PgDialect } from 'drizzle-orm/pg-core';
import { afterAll, describe, expect, it } from 'vitest';
import { createDb } from '../src/client.js';
import {
  createRepositories,
  notTakenDown,
  RepositoryError,
  TAKEDOWN_KINDS,
  TAKEDOWN_NOTE_MAX,
  TAKEDOWNS_ACTIVE_MAX_LIMIT,
} from '../src/index.js';
import { chunks, documents } from '../src/schema/index.js';

const handle = createDb({ DATABASE_URL: 'postgres://u:p@127.0.0.1:1/none' });
const repos = createRepositories(handle.db);
afterAll(() => handle.close());

const STAFF = 'stf_1';
const GOOD = { kind: 'document' as const, targetId: 'doc_1', category: 'copyright' as const };

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
  ['empty', ''],
  ['a number', 7],
  ['a space', 'stf 1'],
  ['too long', 'x'.repeat(129)],
  ['an object', { id: STAFF }],
];

describe('takedowns constants and the SQL helper', () => {
  it('has the plan caps and the two target kinds', () => {
    expect(TAKEDOWN_KINDS).toEqual(['document', 'agent']);
    expect(TAKEDOWNS_ACTIVE_MAX_LIMIT).toBe(200);
    expect(TAKEDOWN_NOTE_MAX).toBe(500);
  });

  it('qualifies the outer column so the subquery can never bind it to takedowns', () => {
    const q = new PgDialect().sqlToQuery(notTakenDown(chunks.documentId));
    expect(q.sql).toContain('"chunks"."document_id"');
    expect(q.sql).toMatch(/^not exists \(select 1 from "takedowns"/);
    expect(q.sql).toContain(`'active'`);
    expect(q.params).toEqual([]);
    expect(new PgDialect().sqlToQuery(notTakenDown(documents.id)).sql).toContain(
      '"documents"."id"',
    );
  });
});

describe('takedowns.create rejects before any SQL', () => {
  it.each(BAD_IDS)('a malformed staff id (%s) is invalid', async (_n, by) => {
    expect(await kindOf(repos.takedowns.create(by, GOOD))).toEqual({
      kind: 'invalid',
      method: 'takedowns.create',
    });
  });

  it.each([
    ['undefined', undefined],
    ['an unknown kind', { ...GOOD, kind: 'teacher' }],
    ['a message kind', { ...GOOD, kind: 'message' }],
    ['a bad target id', { ...GOOD, targetId: 'doc 1' }],
    ['a prefixed target id', { ...GOOD, targetId: 'document:doc_1' }],
    ['free text as category', { ...GOOD, category: 'they stole my notes' }],
    ['a bad report id', { ...GOOD, reportId: '' }],
    ['an empty note', { ...GOOD, note: '   ' }],
    ['a long note', { ...GOOD, note: 'n'.repeat(TAKEDOWN_NOTE_MAX + 1) }],
    ['an extra key', { ...GOOD, teacherId: 'tch_a' }],
    ['a by key', { ...GOOD, by: STAFF }],
  ])('%s is invalid', async (_n, input) => {
    expect(await kindOf(repos.takedowns.create(STAFF, input as never))).toEqual({
      kind: 'invalid',
      method: 'takedowns.create',
    });
  });
});

describe('takedowns.lift rejects before any SQL', () => {
  it.each(BAD_IDS)('a malformed staff id (%s) is invalid', async (_n, by) => {
    expect((await kindOf(repos.takedowns.lift(by, 'td_1', {}))).kind).toBe('invalid');
  });

  it.each(BAD_IDS)('a malformed takedown id (%s) is invalid', async (_n, id) => {
    expect((await kindOf(repos.takedowns.lift(STAFF, id, {}))).kind).toBe('invalid');
  });

  it.each([
    ['undefined', undefined],
    ['an empty note', { note: '' }],
    ['a long note', { note: 'n'.repeat(TAKEDOWN_NOTE_MAX + 1) }],
    ['an extra key', { note: 'ok', status: 'active' }],
  ])('%s is invalid', async (_n, input) => {
    expect(await kindOf(repos.takedowns.lift(STAFF, 'td_1', input as never))).toEqual({
      kind: 'invalid',
      method: 'takedowns.lift',
    });
  });
});

describe('takedowns.listActiveForStaff rejects before any SQL', () => {
  it.each(BAD_IDS)('a malformed staff id (%s) is invalid', async (_n, by) => {
    expect(await kindOf(repos.takedowns.listActiveForStaff(by))).toEqual({
      kind: 'invalid',
      method: 'takedowns.listActiveForStaff',
    });
  });
});
