// Task 8.1 on Postgres: a teacher creates, reads and edits their own profile; only a current staff
// user can verify or reject it (with a `teacher.verify` audit row in the same transaction); and an
// unverified teacher cannot publish (`assertVerifiedForPublish`). See test/pg.ts.
import pg from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { migrateDatabase } from '../src/migrate.js';
import { createDb, type DbHandle } from '../src/internal.js';
import {
  createRepositories,
  type Repositories,
  RepositoryError,
  STAFF_QUEUE_MAX_LIMIT,
} from '../src/index.js';
import { seed, studentId, teacherId } from './isolation-seed.js';
import {
  createDatabase,
  dropDatabase,
  postgresUp,
  SKIP_REASON,
  throwawayName,
  urlFor,
} from './pg.js';

const up = await postgresUp('teacher profile tests');
const dbName = throwawayName();
const TEST_URL = urlFor(dbName);
let handle: DbHandle;
let repos: Repositories;
let raw: pg.Client;

const A = { teacherId: teacherId('A') };
const B = { teacherId: teacherId('B') };
const STAFF = 'stf_tp_1';
const FORMER_STAFF = 'stf_tp_2';

async function failure(p: Promise<unknown>): Promise<{ kind: string; method: string }> {
  const e = await p.then(
    () => new Error('resolved'),
    (x: unknown) => x,
  );
  expect(e).toBeInstanceOf(RepositoryError);
  const { kind, method } = e as RepositoryError;
  return { kind, method };
}

const statusOf = async (tid: string) =>
  (
    await raw.query<{ s: string }>(
      'select verification_status as s from teacher_profiles where user_id = $1',
      [tid],
    )
  ).rows[0]?.s;
const auditCount = async () =>
  Number((await raw.query<{ n: string }>('select count(*) as n from audit_log')).rows[0]?.n);

describe.skipIf(!up)(`teacherProfiles on Postgres${up ? '' : ` (${SKIP_REASON})`}`, () => {
  beforeAll(async () => {
    await createDatabase(dbName);
    await migrateDatabase(TEST_URL);
    handle = createDb({ DATABASE_URL: TEST_URL });
    await seed(handle.db);
    repos = createRepositories(handle.db);
    raw = new pg.Client({ connectionString: TEST_URL });
    await raw.connect();
    await raw.query(
      `insert into users (id, name, locale, market, role) values
       ($1, 'Staff One', 'en', 'test', 'staff'), ($2, 'Staff Two', 'en', 'test', 'teacher')`,
      [STAFF, FORMER_STAFF],
    );
  }, 60_000);

  afterAll(async () => {
    await raw?.end();
    await handle?.close();
    await dropDatabase(dbName);
  });

  beforeEach(async () => {
    await raw.query('delete from teacher_profiles');
  });

  it('a teacher creates, reads and edits their own profile; it starts pending', async () => {
    expect(await repos.teacherProfiles.get(A)).toBeNull();
    const made = await repos.teacherProfiles.create(A, {
      slug: 'ms-alpha',
      subject: 'Maths',
      bio: 'Fictional test teacher.',
      languages: ['en'],
    });
    expect(made).toMatchObject({
      teacherId: teacherId('A'),
      slug: 'ms-alpha',
      subject: 'Maths',
      bio: 'Fictional test teacher.',
      languages: ['en'],
      verificationStatus: 'pending',
    });
    expect(Object.keys(made).sort()).toEqual(
      ['bio', 'id', 'languages', 'slug', 'subject', 'teacherId', 'verificationStatus'].sort(),
    );
    expect(await repos.teacherProfiles.get(A)).toEqual(made);
    expect(await repos.teacherProfiles.get(B)).toBeNull();

    const edited = await repos.teacherProfiles.update(A, { subject: 'Physics', languages: [] });
    expect(edited).toEqual({ ...made, subject: 'Physics', languages: [] });
    expect(await repos.teacherProfiles.get(A)).toEqual(edited);
  });

  it('defaults bio and languages to empty', async () => {
    const made = await repos.teacherProfiles.create(A, { slug: 'ms-alpha', subject: 'Maths' });
    expect(made).toMatchObject({ bio: '', languages: [] });
  });

  it('one profile per teacher, one teacher per slug', async () => {
    await repos.teacherProfiles.create(A, { slug: 'ms-alpha', subject: 'Maths' });
    expect(
      await failure(repos.teacherProfiles.create(A, { slug: 'ms-alpha-2', subject: 'Maths' })),
    ).toEqual({ kind: 'invalid', method: 'teacherProfiles.create' });
    expect(
      await failure(repos.teacherProfiles.create(B, { slug: 'ms-alpha', subject: 'Maths' })),
    ).toEqual({ kind: 'invalid', method: 'teacherProfiles.create' });
    expect(await repos.teacherProfiles.get(B)).toBeNull();
  });

  it('only a teacher user gets a profile: a ghost is not_found, a student or staff is scope', async () => {
    expect(
      await failure(
        repos.teacherProfiles.create({ teacherId: 'tch_ghost' }, { slug: 'ghost', subject: 'X' }),
      ),
    ).toEqual({ kind: 'not_found', method: 'teacherProfiles.create' });
    for (const id of [studentId('1'), STAFF]) {
      expect(
        await failure(
          repos.teacherProfiles.create({ teacherId: id }, { slug: 'nope', subject: 'X' }),
        ),
      ).toEqual({ kind: 'scope', method: 'teacherProfiles.create' });
    }
    const n = await raw.query('select 1 from teacher_profiles');
    expect(n.rowCount).toBe(0);
  });

  it('updating a profile that does not exist is not_found', async () => {
    expect(await failure(repos.teacherProfiles.update(A, { subject: 'X' }))).toEqual({
      kind: 'not_found',
      method: 'teacherProfiles.update',
    });
  });

  describe('setVerification (staff only)', () => {
    beforeEach(async () => {
      await repos.teacherProfiles.create(A, { slug: 'ms-alpha', subject: 'Maths' });
      await repos.teacherProfiles.create(B, { slug: 'mr-beta', subject: 'Maths' });
    });

    it.each([
      ['the teacher themself', teacherId('A')],
      ['another teacher', teacherId('B')],
      ['a student', studentId('1')],
      ['a user who is no longer staff', FORMER_STAFF],
      ['an id that is no user', 'stf_ghost'],
    ])('refuses %s as scope and changes nothing', async (_label, by) => {
      const audits = await auditCount();
      expect(
        await failure(repos.teacherProfiles.setVerification(A, { status: 'verified', by })),
      ).toEqual({ kind: 'scope', method: 'teacherProfiles.setVerification' });
      expect(await statusOf(teacherId('A'))).toBe('pending');
      expect(await auditCount()).toBe(audits);
    });

    it('a staff user verifies one teacher, with one teacher.verify audit row', async () => {
      const row = await repos.teacherProfiles.setVerification(A, {
        status: 'verified',
        by: STAFF,
        reason: 'documents checked',
      });
      expect(row).toMatchObject({ teacherId: teacherId('A'), verificationStatus: 'verified' });
      expect(await statusOf(teacherId('A'))).toBe('verified');
      expect(await statusOf(teacherId('B'))).toBe('pending');

      const rows = await repos.audit.listForTeacher(A, {
        target: `teacher:${teacherId('A')}`,
        limit: 10,
      });
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        actor: STAFF,
        actorRole: 'staff',
        action: 'teacher.verify',
        target: `teacher:${teacherId('A')}`,
        teacherId: teacherId('A'),
        reason: 'documents checked',
        before: { verificationStatus: 'pending' },
        after: { verificationStatus: 'verified' },
      });
      expect(rows[0]?.studentId).toBeUndefined();
      expect(
        await repos.audit.listForTeacher(B, { target: `teacher:${teacherId('A')}`, limit: 10 }),
      ).toEqual([]);
    });

    it('staff can later reject a verified teacher; the audit row keeps both states', async () => {
      await repos.teacherProfiles.setVerification(A, { status: 'verified', by: STAFF });
      const row = await repos.teacherProfiles.setVerification(A, { status: 'rejected', by: STAFF });
      expect(row.verificationStatus).toBe('rejected');
      const [latest] = await repos.audit.listForTeacher(A, {
        target: `teacher:${teacherId('A')}`,
        limit: 1,
      });
      expect(latest).toMatchObject({
        before: { verificationStatus: 'verified' },
        after: { verificationStatus: 'rejected' },
      });
      expect(latest?.reason).toBeUndefined();
    });

    it('a teacher with no profile is not_found and nothing is audited', async () => {
      await raw.query('delete from teacher_profiles where user_id = $1', [teacherId('A')]);
      const audits = await auditCount();
      expect(
        await failure(repos.teacherProfiles.setVerification(A, { status: 'verified', by: STAFF })),
      ).toEqual({ kind: 'not_found', method: 'teacherProfiles.setVerification' });
      expect(await auditCount()).toBe(audits);
    });

    it('a teacher cannot verify themself through update', async () => {
      expect(
        await failure(repos.teacherProfiles.update(A, { verificationStatus: 'verified' } as never)),
      ).toEqual({ kind: 'invalid', method: 'teacherProfiles.update' });
      expect(await statusOf(teacherId('A'))).toBe('pending');
    });
  });

  // Task 8.1c (B-30): a subject change sends a verified teacher back to pending, in the same
  // UPDATE statement; bio, languages and a same-value subject leave the status alone.
  describe('update: a subject change resets verification', () => {
    beforeEach(async () => {
      await repos.teacherProfiles.create(A, { slug: 'ms-alpha', subject: 'Maths' });
      await repos.teacherProfiles.create(B, { slug: 'mr-beta', subject: 'Maths' });
      await repos.teacherProfiles.setVerification(A, { status: 'verified', by: STAFF });
      await repos.teacherProfiles.setVerification(B, { status: 'verified', by: STAFF });
    });

    it('a verified teacher who changes subject is pending again; nobody else changes', async () => {
      const row = await repos.teacherProfiles.update(A, { subject: 'Physics' });
      expect(row).toMatchObject({ subject: 'Physics', verificationStatus: 'pending' });
      expect(await statusOf(teacherId('A'))).toBe('pending');
      expect(await statusOf(teacherId('B'))).toBe('verified');
      expect(await failure(repos.teacherProfiles.assertVerifiedForPublish(A))).toEqual({
        kind: 'scope',
        method: 'teacherProfiles.assertVerifiedForPublish',
      });
    });

    it('a subject change together with a bio edit still resets', async () => {
      const row = await repos.teacherProfiles.update(A, { subject: 'Physics', bio: 'New bio' });
      expect(row).toMatchObject({
        subject: 'Physics',
        bio: 'New bio',
        verificationStatus: 'pending',
      });
    });

    it('a rejected teacher who changes subject goes back to pending', async () => {
      await repos.teacherProfiles.setVerification(A, { status: 'rejected', by: STAFF });
      const row = await repos.teacherProfiles.update(A, { subject: 'Physics' });
      expect(row.verificationStatus).toBe('pending');
    });

    it.each([
      ['a bio-only edit', { bio: 'I teach maths.' }],
      ['a languages-only edit', { languages: ['en', 'pt-BR'] }],
      ['a same-value subject edit', { subject: 'Maths' }],
      ['a same-value subject with surrounding spaces', { subject: '  Maths  ' }],
      ['a same-value subject with a bio edit', { subject: 'Maths', bio: 'Updated' }],
    ])('%s leaves a verified teacher verified', async (_label, patch) => {
      const row = await repos.teacherProfiles.update(A, patch);
      expect(row.verificationStatus).toBe('verified');
      expect(row.subject).toBe('Maths');
      expect(await statusOf(teacherId('A'))).toBe('verified');
      await expect(repos.teacherProfiles.assertVerifiedForPublish(A)).resolves.toBeUndefined();
    });

    it('a pending teacher who changes subject stays pending', async () => {
      await raw.query(
        `update teacher_profiles set verification_status = 'pending' where user_id = $1`,
        [teacherId('A')],
      );
      const row = await repos.teacherProfiles.update(A, { subject: 'Physics' });
      expect(row.verificationStatus).toBe('pending');
    });
  });

  describe('listPendingForStaff (staff only)', () => {
    it.each([
      ['the teacher themself', () => teacherId('A')],
      ['a user who is no longer staff', () => FORMER_STAFF],
      ['an id that is no user', () => 'stf_ghost'],
    ])('refuses %s as scope', async (_label, by) => {
      expect(await failure(repos.teacherProfiles.listPendingForStaff(by()))).toEqual({
        kind: 'scope',
        method: 'teacherProfiles.listPendingForStaff',
      });
    });

    it('a staff user sees only pending teachers, oldest first, ties broken by id, with name and email joined', async () => {
      await repos.teacherProfiles.create(A, { slug: 'ms-alpha', subject: 'Maths' });
      await repos.teacherProfiles.create(B, { slug: 'mr-beta', subject: 'Science' });
      // Both rows share one created_at, so only the id tie-breaker decides the order. A is
      // inserted (and rewritten) first but gets the larger id, so insertion order would put it first.
      const [idA, idB] = ['tp-tie-2', 'tp-tie-1'];
      await raw.query(
        `update teacher_profiles set id = $2, created_at = '2026-01-01T00:00:00Z' where user_id = $1`,
        [teacherId('A'), idA],
      );
      await raw.query(
        `update teacher_profiles set id = $2, created_at = '2026-01-01T00:00:00Z' where user_id = $1`,
        [teacherId('B'), idB],
      );
      const rowB = {
        id: idB,
        teacherId: teacherId('B'),
        slug: 'mr-beta',
        subject: 'Science',
        verificationStatus: 'pending',
        name: '[B] teacher',
        email: null,
      };
      expect(await repos.teacherProfiles.listPendingForStaff(STAFF)).toEqual([
        rowB,
        {
          id: idA,
          teacherId: teacherId('A'),
          slug: 'ms-alpha',
          subject: 'Maths',
          verificationStatus: 'pending',
          name: '[A] teacher',
          email: null,
        },
      ]);

      // Verified teachers never show up in the queue.
      await repos.teacherProfiles.setVerification(A, { status: 'verified', by: STAFF });
      expect(await repos.teacherProfiles.listPendingForStaff(STAFF)).toEqual([rowB]);
    });

    it('is empty when nothing is pending', async () => {
      expect(await repos.teacherProfiles.listPendingForStaff(STAFF)).toEqual([]);
    });

    it('never exceeds STAFF_QUEUE_MAX_LIMIT rows: the oldest ones come back', async () => {
      const total = STAFF_QUEUE_MAX_LIMIT + 1;
      const ids = Array.from({ length: total }, (_, i) => `tch_cap_${String(i).padStart(3, '0')}`);
      await raw.query(
        `insert into users (id, name, locale, market, role)
         select x, 'Cap teacher', 'en', 'test', 'teacher' from unnest($1::text[]) as x
         on conflict (id) do nothing`,
        [ids],
      );
      // Created newest-first, then dated so ids[0] is the oldest: the queue must follow
      // created_at, not insertion order.
      for (const tid of [...ids].reverse()) {
        await repos.teacherProfiles.create(
          { teacherId: tid },
          { slug: tid.replaceAll('_', '-'), subject: 'Maths' },
        );
      }
      await raw.query(
        `update teacher_profiles t
         set created_at = timestamptz '2026-01-01T00:00:00Z' + (x.n * interval '1 minute')
         from unnest($1::text[]) with ordinality as x(uid, n) where t.user_id = x.uid`,
        [ids],
      );

      const rows = await repos.teacherProfiles.listPendingForStaff(STAFF);
      expect(rows).toHaveLength(STAFF_QUEUE_MAX_LIMIT);
      expect(rows.map((r) => r.teacherId)).toEqual(ids.slice(0, STAFF_QUEUE_MAX_LIMIT));
    });
  });

  describe('assertVerifiedForPublish: an unverified teacher cannot publish', () => {
    const publish = (s: { teacherId: string }) => repos.teacherProfiles.assertVerifiedForPublish(s);
    const SCOPE = { kind: 'scope', method: 'teacherProfiles.assertVerifiedForPublish' };

    it('no profile: refused', async () => {
      expect(await failure(publish(A))).toEqual(SCOPE);
      expect(await failure(publish({ teacherId: 'tch_ghost' }))).toEqual(SCOPE);
    });

    it('pending: refused', async () => {
      await repos.teacherProfiles.create(A, { slug: 'ms-alpha', subject: 'Maths' });
      expect(await failure(publish(A))).toEqual(SCOPE);
    });

    it('rejected: refused', async () => {
      await repos.teacherProfiles.create(A, { slug: 'ms-alpha', subject: 'Maths' });
      await repos.teacherProfiles.setVerification(A, { status: 'rejected', by: STAFF });
      expect(await failure(publish(A))).toEqual(SCOPE);
    });

    it('verified: allowed, and only for that teacher', async () => {
      await repos.teacherProfiles.create(A, { slug: 'ms-alpha', subject: 'Maths' });
      await repos.teacherProfiles.create(B, { slug: 'mr-beta', subject: 'Maths' });
      await repos.teacherProfiles.setVerification(A, { status: 'verified', by: STAFF });
      await expect(publish(A)).resolves.toBeUndefined();
      expect(await failure(publish(B))).toEqual(SCOPE);
    });
  });
});
