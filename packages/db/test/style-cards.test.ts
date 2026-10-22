// Task 8.4a: styleCards.create / latest input checks that run before any SQL. The database handle
// here throws on any use, so a call that reaches it fails the test with "touched the database"
// instead of the expected RepositoryError. style-cards.int.test.ts covers the SQL paths.
import { LIMITS } from '@edmate/contracts';
import { describe, expect, it } from 'vitest';
import type { Db } from '../src/client.js';
import { RepositoryError } from '../src/index.js';
import { STYLE_CARD_LIMITS, styleCardsRepo } from '../src/repositories/style-cards.js';

const noDb = new Proxy(
  {},
  {
    get() {
      throw new Error('touched the database');
    },
  },
) as Db;
const repo = styleCardsRepo(noDb);
const scope = { teacherId: 'tch_a' };
const good = { text: 'Warm, short sentences.', mistakeTags: ['sign-error'] };

async function failure(p: Promise<unknown>): Promise<{ kind: string; method: string }> {
  const e = await p.then(
    () => new Error('resolved'),
    (x: unknown) => x,
  );
  expect(e).toBeInstanceOf(RepositoryError);
  const { kind, method } = e as RepositoryError;
  return { kind, method };
}

describe('styleCards.create: scope is checked before any SQL', () => {
  it.each([
    ['undefined', undefined],
    ['null', null],
    ['an empty object', {}],
    ['an empty teacher id', { teacherId: '' }],
    ['a malformed teacher id', { teacherId: 'tch a; drop table' }],
    ['an extra key (a client-sent studentId)', { teacherId: 'tch_a', studentId: 'stu_1' }],
  ])('%s is `scope`', async (_label, bad) => {
    expect(await failure(repo.create(bad as never, good))).toEqual({
      kind: 'scope',
      method: 'styleCards.create',
    });
  });
});

describe('styleCards.create: the draft is checked before any SQL', () => {
  const words = (n: number) => Array.from({ length: n }, () => 'w').join(' ');
  it.each([
    ['no draft', undefined],
    ['a missing text', { mistakeTags: [] }],
    ['a missing mistakeTags', { text: 'ok' }],
    ['an empty text', { text: '', mistakeTags: [] }],
    ['a whitespace-only text', { text: ' \n\t ', mistakeTags: [] }],
    [
      `more than ${LIMITS.styleCardMaxWords} words`,
      { text: words(LIMITS.styleCardMaxWords + 1), mistakeTags: [] },
    ],
    [
      `more than ${STYLE_CARD_LIMITS.textMaxChars} characters`,
      { text: 'x'.repeat(STYLE_CARD_LIMITS.textMaxChars + 1), mistakeTags: [] },
    ],
    [
      `more than ${STYLE_CARD_LIMITS.tagsMax} tags`,
      {
        text: 'ok',
        mistakeTags: Array.from({ length: STYLE_CARD_LIMITS.tagsMax + 1 }, (_, i) => `t${i}`),
      },
    ],
    [
      'a tag over the length cap',
      { text: 'ok', mistakeTags: ['x'.repeat(STYLE_CARD_LIMITS.tagMaxChars + 1)] },
    ],
    ['an empty tag', { text: 'ok', mistakeTags: [''] }],
    ['a whitespace-only tag', { text: 'ok', mistakeTags: ['  '] }],
    ['a non-string tag', { text: 'ok', mistakeTags: [1] }],
    ['a non-string text', { text: 42, mistakeTags: [] }],
    ['a client-set version', { ...good, version: 7 }],
    ['a client-set teacherId', { ...good, teacherId: 'tch_b' }],
    ['a client-set id', { ...good, id: 'sty_b' }],
  ])('%s is `invalid`', async (_label, bad) => {
    expect(await failure(repo.create(scope, bad as never))).toEqual({
      kind: 'invalid',
      method: 'styleCards.create',
    });
  });

  it('accepts exactly the word cap (fails only later, at the database)', async () => {
    await expect(
      repo.create(scope, { text: words(LIMITS.styleCardMaxWords), mistakeTags: [] }),
    ).rejects.toThrow('touched the database');
  });
});

describe('styleCards.latest: scope is checked before any SQL', () => {
  it.each([
    ['undefined', undefined],
    ['a malformed teacher id', { teacherId: '../tch_b' }],
    ['an extra key', { teacherId: 'tch_a', agentId: 'agt_a' }],
  ])('%s is `scope`', async (_label, bad) => {
    expect(await failure(repo.latest(bad as never))).toEqual({
      kind: 'scope',
      method: 'styleCards.latest',
    });
  });
});
