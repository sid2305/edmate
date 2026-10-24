// Task 8.1: teacherProfiles input checks that run before any SQL. The database handle here throws
// on any use, so a call that reaches it fails the test with "touched the database" instead of the
// expected RepositoryError. teacher-profiles.int.test.ts covers the SQL paths on Postgres.
import { describe, expect, it } from 'vitest';
import type { Db } from '../src/client.js';
import { RepositoryError } from '../src/index.js';
import { DisplayName, teacherProfilesRepo } from '../src/repositories/teacher-profiles.js';

const noDb = new Proxy(
  {},
  {
    get() {
      throw new Error('touched the database');
    },
  },
) as Db;
const repo = teacherProfilesRepo(noDb);
const scope = { teacherId: 'tch_a' };

async function failure(p: Promise<unknown>): Promise<{ kind: string; method: string }> {
  const e = await p.then(
    () => new Error('resolved'),
    (x: unknown) => x,
  );
  expect(e).toBeInstanceOf(RepositoryError);
  const { kind, method } = e as RepositoryError;
  return { kind, method };
}

describe('teacherProfiles.update: a teacher can never set their own verification', () => {
  it.each([
    ['verificationStatus', { verificationStatus: 'verified' }],
    [
      'verificationStatus next to a real field',
      { subject: 'Maths', verificationStatus: 'verified' },
    ],
    ['payoutAccountRef (M10)', { payoutAccountRef: 'acct_1' }],
    ['photo (no photo input in this slice)', { photo: 'https://example.test/p.png' }],
    ['slug (set once, at create)', { slug: 'new-slug' }],
    ['userId', { userId: 'tch_b' }],
    ['an empty patch', {}],
    ['an empty subject', { subject: '' }],
    ['a non-object', 'verified'],
  ])('rejects %s as invalid before any SQL', async (_label, patch) => {
    expect(await failure(repo.update(scope, patch as never))).toEqual({
      kind: 'invalid',
      method: 'teacherProfiles.update',
    });
  });
});

describe('teacherProfiles input checks', () => {
  it.each([
    ['a missing teacherId', {}],
    ['an extra key', { teacherId: 'tch_a', studentId: 'stu_1' }],
    ['a malformed id', { teacherId: "x' or 1=1" }],
    ['null', null],
  ])('every method rejects %s as scope', async (_label, bad) => {
    const s = bad as never;
    for (const [m, p] of [
      ['create', repo.create(s, { slug: 'abc', displayName: 'Abc', subject: 'Maths' })],
      ['get', repo.get(s)],
      ['update', repo.update(s, { subject: 'Maths' })],
      ['setVerification', repo.setVerification(s, { status: 'verified', by: 'stf_1' })],
      ['assertVerifiedForPublish', repo.assertVerifiedForPublish(s)],
    ] as const) {
      expect(await failure(p)).toEqual({ kind: 'scope', method: `teacherProfiles.${m}` });
    }
  });

  it.each([
    ['verificationStatus', { slug: 'abc', displayName: 'Abc', subject: 'Maths', verificationStatus: 'verified' }],
    ['photo', { slug: 'abc', displayName: 'Abc', subject: 'Maths', photo: 'https://example.test/p.png' }],
    ['payoutAccountRef', { slug: 'abc', displayName: 'Abc', subject: 'Maths', payoutAccountRef: 'acct_1' }],
    ['no slug', { displayName: 'Abc', subject: 'Maths' }],
    ['no displayName', { slug: 'abc', subject: 'Maths' }],
    ['an upper-case slug', { slug: 'Abc', displayName: 'Abc', subject: 'Maths' }],
    ['a slug with a space', { slug: 'a bc', displayName: 'Abc', subject: 'Maths' }],
    ['a two-letter slug', { slug: 'ab', displayName: 'Abc', subject: 'Maths' }],
    ['a 61-letter slug', { slug: 'a'.repeat(61), displayName: 'Abc', subject: 'Maths' }],
    ['a leading hyphen', { slug: '-abc', displayName: 'Abc', subject: 'Maths' }],
    ['no subject', { slug: 'abc', displayName: 'Abc' }],
    ['an over-long bio', { slug: 'abc', displayName: 'Abc', subject: 'Maths', bio: 'x'.repeat(2001) }],
    ['a bad language tag', { slug: 'abc', displayName: 'Abc', subject: 'Maths', languages: ['english!'] }],
    [
      'too many languages',
      { slug: 'abc', displayName: 'Abc', subject: 'Maths', languages: Array(11).fill('en') },
    ],
  ])('create rejects %s as invalid before any SQL', async (_label, input) => {
    expect(await failure(repo.create(scope, input as never))).toEqual({
      kind: 'invalid',
      method: 'teacherProfiles.create',
    });
  });

  // Task 9.2d: the public display name a teacher sets in onboarding. Every row below is invalid
  // before any SQL, on both create and update (minimally, { displayName } alone is already
  // non-empty so update's "at least one key" refine never masks the displayName failure).
  const BAD_DISPLAY_NAMES: [string, string][] = [
    ['empty', ''],
    ['one character', 'A'],
    ['61 characters', 'a'.repeat(61)],
    ['whitespace only', '   '],
    ['no letter', '123'],
    ['a URL (://)', 'https://x.y'],
    ['a URL (www.)', 'www.example.com'],
    ['a word.tld shape', 'ada.example.com'],
    ['an email', 'ada@example.com'],
    ['a phone number (spaced)', '+1 (415) 555-0100'],
    ['a phone number (dotted)', '415.555.0100'],
    ['a zero-width character', 'A​da'],
    ['a bidi override', '‮Ada'],
    ['an emoji', 'Ada 😀'],
    ['a lone newline', '\n'],
    ['the platform name', 'Edmate Support'],
    ['an impersonation word', 'Official Tutor'],
    // Task 9.2d fix round: fullwidth Unicode letters spell a blocked word visually but don't
    // match the impersonation regex until NFKC-normalized to ASCII first.
    ['a fullwidth impersonation word', 'ＡＤＭＩＮ'],
    ['a fullwidth impersonation phrase', 'ＯＦＦＩＣＩＡＬ ＥＤＭＡＴＥ'],
    // Devanagari digits: \p{N} (not \d) so a phone number spelled in a non-ASCII digit script
    // still trips the phone-like check.
    ['a phone number (Devanagari digits)', 'Call ४१५५५५०१००'],
  ];

  it.each(BAD_DISPLAY_NAMES)('create rejects displayName %s as invalid before any SQL', async (_label, bad) => {
    expect(
      await failure(repo.create(scope, { slug: 'abc', subject: 'Maths', displayName: bad } as never)),
    ).toEqual({ kind: 'invalid', method: 'teacherProfiles.create' });
  });

  it.each(BAD_DISPLAY_NAMES)('update rejects displayName %s as invalid before any SQL', async (_label, bad) => {
    expect(await failure(repo.update(scope, { displayName: bad } as never))).toEqual({
      kind: 'invalid',
      method: 'teacherProfiles.update',
    });
  });

  it('create without displayName is invalid before any SQL', async () => {
    expect(await failure(repo.create(scope, { slug: 'abc', subject: 'Maths' } as never))).toEqual({
      kind: 'invalid',
      method: 'teacherProfiles.create',
    });
  });

  it('update({}) stays invalid even though displayName now exists (the non-empty refine)', async () => {
    expect(await failure(repo.update(scope, {}))).toEqual({
      kind: 'invalid',
      method: 'teacherProfiles.update',
    });
  });

  describe('DisplayName schema', () => {
    it('trims and collapses internal whitespace runs to one space', () => {
      expect(DisplayName.parse('  Ada   Lovelace ')).toBe('Ada Lovelace');
    });

    it.each([
      'Dr. Smith',
      'J.R.R. Tolkien',
      "Mary-Jane O'Neil",
      'Teacher 2024',
      'Søren Ålesund',
      'प्रिया',
      'José Núñez',
    ])('accepts %s', (good) => {
      expect(() => DisplayName.parse(good)).not.toThrow();
    });

    it.each(BAD_DISPLAY_NAMES)('rejects %s', (_label, bad) => {
      expect(() => DisplayName.parse(bad)).toThrow();
    });

    it('normalizes fullwidth letters (NFKC) to their canonical form before storage', () => {
      expect(DisplayName.parse('Ａｄａ')).toBe('Ada');
    });
  });

  it.each([
    [
      'pending (staff verify or reject; pending is only the start)',
      { status: 'pending', by: 'stf_1' },
    ],
    ['an unknown status', { status: 'approved', by: 'stf_1' }],
    ['no by', { status: 'verified' }],
    ['a malformed by', { status: 'verified', by: 'a b' }],
    ['an empty reason', { status: 'verified', by: 'stf_1', reason: '' }],
    ['an extra key naming a teacher', { status: 'verified', by: 'stf_1', teacherId: 'tch_b' }],
    // Task 9.3e: the safety flag is a boolean and only ever goes with a rejection.
    ['safety on an approval', { status: 'verified', by: 'stf_1', safety: true }],
    ['a non-boolean safety', { status: 'rejected', by: 'stf_1', safety: 'yes' }],
    ['a numeric safety', { status: 'rejected', by: 'stf_1', safety: 1 }],
  ])('setVerification rejects %s as invalid before any SQL', async (_label, input) => {
    expect(await failure(repo.setVerification(scope, input as never))).toEqual({
      kind: 'invalid',
      method: 'teacherProfiles.setVerification',
    });
  });

  it('setVerification refuses a teacher verifying themself before any SQL', async () => {
    expect(
      await failure(repo.setVerification(scope, { status: 'verified', by: scope.teacherId })),
    ).toEqual({ kind: 'scope', method: 'teacherProfiles.setVerification' });
  });

  it.each([
    ['undefined', undefined],
    ['null', null],
    ['an empty string', ''],
    ['SQL in the id', "x' or 1=1"],
    ['a 129-char id', 'a'.repeat(129)],
    ['a scope object, not a bare id', { teacherId: 'stf_1' }],
    ['an array', ['stf_1']],
  ])('listPendingForStaff rejects %s as invalid before any SQL', async (_label, by) => {
    expect(await failure(repo.listPendingForStaff(by as never))).toEqual({
      kind: 'invalid',
      method: 'teacherProfiles.listPendingForStaff',
    });
  });
});
