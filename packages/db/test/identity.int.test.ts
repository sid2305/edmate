// Task 1.3: the identity store on a real Postgres 16 (see test/pg.ts; skipped locally without
// one, fails in CI). New users are always students, only grantRole changes a role (with an audit
// row in the same transaction), session tokens are stored hashed, and driver errors are scrubbed.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import pg from 'pg';
import { migrateDatabase } from '../src/migrate.js';
import { createDb, type DbHandle } from '../src/internal.js';
import {
  createIdentityStore,
  openDatabase,
  RepositoryError,
  type IdentityStore,
} from '../src/index.js';
import { hashSessionToken } from '../src/identity/token-hash.js';
import { expectScrubbed } from './scrub.js';
import {
  createDatabase,
  dropDatabase,
  postgresUp,
  SKIP_REASON,
  throwawayName,
  urlFor,
} from './pg.js';

const up = await postgresUp('identity integration tests');
const dbName = throwawayName();
const TEST_URL = urlFor(dbName);

const DAY = 86_400_000;
const later = () => new Date(Date.now() + 30 * DAY);
let n = 0;
const email = (label: string) => `${label}.${(n += 1)}@example.test`;
const token = (label: string) => `tok-${label}-${'x'.repeat(24)}-${(n += 1)}`;

async function kindOf(run: () => Promise<unknown>): Promise<string> {
  const err = await run().then(
    () => new Error('call succeeded'),
    (e: unknown) => e,
  );
  expect(err).toBeInstanceOf(RepositoryError);
  return (err as RepositoryError).kind;
}

describe.skipIf(!up)(`identity store on Postgres 16${up ? '' : ` (${SKIP_REASON})`}`, () => {
  let handle: DbHandle;
  let identity: IdentityStore;
  let raw: pg.Client;

  beforeAll(async () => {
    await createDatabase(dbName);
    await migrateDatabase(TEST_URL);
    handle = createDb({ DATABASE_URL: TEST_URL });
    identity = createIdentityStore(handle.db);
    raw = new pg.Client({ connectionString: TEST_URL });
    await raw.connect();
  });

  afterAll(async () => {
    await raw?.end();
    await handle?.close();
    await dropDatabase(dbName);
  });

  describe('createStudent', () => {
    it('always writes role student, market global, locale en, and returns identity fields only', async () => {
      const verified = new Date('2026-10-01T00:00:00Z');
      const u = await identity.createStudent({
        email: `  Mixed.Case.${(n += 1)}@Example.TEST `,
        emailVerifiedAt: verified,
        name: '  Asha  ',
      });
      expect(Object.keys(u).sort()).toEqual(['email', 'emailVerifiedAt', 'id', 'name', 'role']);
      expect(u.role).toBe('student');
      expect(u.email).toMatch(/^mixed\.case\.\d+@example\.test$/);
      expect(u.name).toBe('Asha');
      expect(u.emailVerifiedAt?.toISOString()).toBe(verified.toISOString());
      const { rows } = await raw.query(`select role, market, locale from users where id = $1`, [
        u.id,
      ]);
      expect(rows).toEqual([{ role: 'student', market: 'global', locale: 'en' }]);
    });

    it('refuses a role or any extra field as invalid', async () => {
      for (const extra of [{ role: 'staff' }, { market: 'in' }, { image: 'https://x' }]) {
        expect(
          await kindOf(() =>
            identity.createStudent({
              email: email('extra'),
              emailVerifiedAt: null,
              name: 'X',
              ...extra,
            } as never),
          ),
        ).toBe('invalid');
      }
    });

    it('rejects a bad email or name, and a duplicate email (case-insensitively)', async () => {
      expect(
        await kindOf(() =>
          identity.createStudent({ email: 'not-an-email', emailVerifiedAt: null, name: 'X' }),
        ),
      ).toBe('invalid');
      expect(
        await kindOf(() =>
          identity.createStudent({
            email: email('n'),
            emailVerifiedAt: null,
            name: 'x'.repeat(201),
          }),
        ),
      ).toBe('invalid');
      const e = email('dup');
      await identity.createStudent({ email: e, emailVerifiedAt: null, name: 'A' });
      expect(
        await kindOf(() =>
          identity.createStudent({ email: e.toUpperCase(), emailVerifiedAt: null, name: 'B' }),
        ),
      ).toBe('invalid');
    });
  });

  describe('lookups', () => {
    it('getUser, getUserByEmail (normalised) and getUserByAccount find the user; unknown is null', async () => {
      const e = email('look');
      const u = await identity.createStudent({ email: e, emailVerifiedAt: null, name: 'L' });
      expect(await identity.getUser(u.id)).toEqual(u);
      expect(await identity.getUserByEmail(` ${e.toUpperCase()} `)).toEqual(u);
      await identity.linkAccount({
        userId: u.id,
        type: 'oidc',
        provider: 'google',
        providerAccountId: `sub-${u.id}`,
      });
      expect(await identity.getUserByAccount('google', `sub-${u.id}`)).toEqual(u);
      expect(await identity.getUserByAccount('github', `sub-${u.id}`)).toBeNull();
      expect(await identity.getUser('usr_missing')).toBeNull();
      expect(await identity.getUserByEmail(email('missing'))).toBeNull();
    });

    it('rejects malformed lookup arguments before SQL', async () => {
      expect(await kindOf(() => identity.getUser('bad id!'))).toBe('invalid');
      expect(await kindOf(() => identity.getUserByEmail(''))).toBe('invalid');
      expect(await kindOf(() => identity.getUserByAccount('', 'x'))).toBe('invalid');
      expect(await kindOf(() => identity.getUserByAccount('google', ''))).toBe('invalid');
    });
  });

  describe('accounts', () => {
    it('an account links once: a second user with the same provider id is invalid; a ghost user is not_found', async () => {
      const a = await identity.createStudent({
        email: email('a'),
        emailVerifiedAt: null,
        name: 'A',
      });
      const b = await identity.createStudent({
        email: email('b'),
        emailVerifiedAt: null,
        name: 'B',
      });
      const acct = { type: 'oidc', provider: 'google', providerAccountId: `sub-shared-${a.id}` };
      await identity.linkAccount({ userId: a.id, ...acct });
      expect(await kindOf(() => identity.linkAccount({ userId: b.id, ...acct }))).toBe('invalid');
      expect(
        await kindOf(() =>
          identity.linkAccount({ userId: 'usr_ghost', ...acct, providerAccountId: 'other' }),
        ),
      ).toBe('not_found');
    });

    it('stores no OAuth tokens: extra fields are refused and the table has no token columns', async () => {
      const u = await identity.createStudent({
        email: email('t'),
        emailVerifiedAt: null,
        name: 'T',
      });
      expect(
        await kindOf(() =>
          identity.linkAccount({
            userId: u.id,
            type: 'oidc',
            provider: 'google',
            providerAccountId: 'sub-tokens',
            access_token: 'ya29.secret',
          } as never),
        ),
      ).toBe('invalid');
      const { rows } = await raw.query<{ column_name: string }>(
        `select column_name from information_schema.columns where table_name = 'auth_accounts'`,
      );
      expect(rows.map((r) => r.column_name).sort()).toEqual([
        'created_at',
        'id',
        'provider',
        'provider_account_id',
        'type',
        'updated_at',
        'user_id',
      ]);
    });
  });

  describe('markEmailVerified', () => {
    it('sets the timestamp; an unknown user is not_found; a bad date is invalid', async () => {
      const u = await identity.createStudent({
        email: email('v'),
        emailVerifiedAt: null,
        name: 'V',
      });
      const at = new Date('2026-10-18T10:00:00Z');
      expect((await identity.markEmailVerified(u.id, at)).emailVerifiedAt?.toISOString()).toBe(
        at.toISOString(),
      );
      expect(await kindOf(() => identity.markEmailVerified('usr_ghost', at))).toBe('not_found');
      expect(await kindOf(() => identity.markEmailVerified(u.id, new Date('nope')))).toBe(
        'invalid',
      );
    });
  });

  describe('sessions', () => {
    it('stores only the SHA-256 of the token, and reads the session with its user', async () => {
      const u = await identity.createStudent({
        email: email('s'),
        emailVerifiedAt: null,
        name: 'S',
      });
      const t = token('store');
      const exp = later();
      expect(await identity.createSession(t, u.id, exp)).toEqual({ userId: u.id, expires: exp });
      const { rows } = await raw.query<Record<string, unknown>>(
        `select * from auth_sessions where user_id = $1`,
        [u.id],
      );
      expect(rows).toHaveLength(1);
      expect(rows[0]?.session_token_hash).toBe(hashSessionToken(t));
      expect(rows[0]?.session_token_hash).toMatch(/^[0-9a-f]{64}$/);
      expect(JSON.stringify(rows)).not.toContain(t);
      expect(await identity.getSessionAndUser(t)).toEqual({
        session: { userId: u.id, expires: exp },
        user: u,
      });
    });

    it('an expired session reads as null and cannot be extended; an unknown token is null', async () => {
      const u = await identity.createStudent({
        email: email('x'),
        emailVerifiedAt: null,
        name: 'X',
      });
      const t = token('expired');
      await identity.createSession(t, u.id, new Date(Date.now() - 1_000));
      expect(await identity.getSessionAndUser(t)).toBeNull();
      expect(await identity.updateSession(t, later())).toBeNull();
      expect(await identity.getSessionAndUser(token('unknown'))).toBeNull();
    });

    it('honours an injected clock', async () => {
      const u = await identity.createStudent({
        email: email('c'),
        emailVerifiedAt: null,
        name: 'C',
      });
      const t = token('clock');
      const exp = new Date(Date.now() + DAY);
      await identity.createSession(t, u.id, exp);
      const future = createIdentityStore(handle.db, { now: () => new Date(exp.getTime() + 1) });
      expect(await future.getSessionAndUser(t)).toBeNull();
      expect(await identity.getSessionAndUser(t)).not.toBeNull();
    });

    it('updateSession moves a live expiry; deleteSession removes it', async () => {
      const u = await identity.createStudent({
        email: email('u'),
        emailVerifiedAt: null,
        name: 'U',
      });
      const t = token('update');
      await identity.createSession(t, u.id, later());
      const moved = new Date(Date.now() + 40 * DAY);
      expect(await identity.updateSession(t, moved)).toEqual({ userId: u.id, expires: moved });
      expect((await identity.getSessionAndUser(t))?.session.expires).toEqual(moved);
      await identity.deleteSession(t);
      expect(await identity.getSessionAndUser(t)).toBeNull();
      await identity.deleteSession(t); // idempotent
    });

    it('rejects a short token, a ghost user and a duplicate token', async () => {
      const u = await identity.createStudent({
        email: email('d'),
        emailVerifiedAt: null,
        name: 'D',
      });
      expect(await kindOf(() => identity.createSession('short', u.id, later()))).toBe('invalid');
      expect(await kindOf(() => identity.getSessionAndUser('short'))).toBe('invalid');
      expect(await kindOf(() => identity.updateSession('short', later()))).toBe('invalid');
      expect(await kindOf(() => identity.deleteSession('short'))).toBe('invalid');
      expect(await kindOf(() => identity.createSession(token('g'), 'usr_ghost', later()))).toBe(
        'not_found',
      );
      const t = token('dup');
      await identity.createSession(t, u.id, later());
      expect(await kindOf(() => identity.createSession(t, u.id, later()))).toBe('invalid');
    });

    it('a role change is visible on the next session read', async () => {
      const u = await identity.createStudent({
        email: email('r'),
        emailVerifiedAt: null,
        name: 'R',
      });
      const t = token('role');
      await identity.createSession(t, u.id, later());
      expect((await identity.getSessionAndUser(t))?.user.role).toBe('student');
      await identity.grantRole({ userId: u.id, role: 'teacher', by: 'operator' });
      expect((await identity.getSessionAndUser(t))?.user.role).toBe('teacher');
    });
  });

  describe('grantRole', () => {
    it('writes the role and a role.grant audit row in one transaction', async () => {
      const u = await identity.createStudent({
        email: email('g'),
        emailVerifiedAt: null,
        name: 'G',
      });
      const out = await identity.grantRole({
        userId: u.id,
        role: 'staff',
        by: 'operator',
        reason: 'first staff account',
      });
      expect(out).toEqual({ ...u, role: 'staff' });
      const { rows } = await raw.query(
        `select actor, actor_role, action, target, teacher_id, student_id, reason, before, after
           from audit_log where target = $1`,
        [`user:${u.id}`],
      );
      expect(rows).toEqual([
        {
          actor: 'operator',
          actor_role: 'staff',
          action: 'role.grant',
          target: `user:${u.id}`,
          teacher_id: u.id,
          student_id: null,
          reason: 'first staff account',
          before: { role: 'student' },
          after: { role: 'staff' },
        },
      ]);
    });

    it('a bad role, actor or extra field is invalid; an unknown user is not_found; nothing is written', async () => {
      const u = await identity.createStudent({
        email: email('b'),
        emailVerifiedAt: null,
        name: 'B',
      });
      const count = async () =>
        (await raw.query(`select count(*)::int as n from audit_log`)).rows[0].n as number;
      const before = await count();
      for (const bad of [
        { userId: u.id, role: 'admin', by: 'operator' },
        { userId: u.id, role: 'staff', by: 'not an id!' },
        { userId: u.id, role: 'staff', by: 'operator', extra: 1 },
        { userId: u.id, role: 'staff', by: 'operator', reason: '' },
      ]) {
        expect(await kindOf(() => identity.grantRole(bad as never))).toBe('invalid');
      }
      expect(
        await kindOf(() =>
          identity.grantRole({ userId: 'usr_ghost', role: 'staff', by: 'operator' }),
        ),
      ).toBe('not_found');
      expect(await count()).toBe(before);
      expect((await identity.getUser(u.id))?.role).toBe('student');
    });

    it('rolls the role back when the audit write fails', async () => {
      const u = await identity.createStudent({
        email: email('f'),
        emailVerifiedAt: null,
        name: 'F',
      });
      // Make the audit insert fail with a trigger: the role update must not survive it.
      await raw.query(`create or replace function edmate_test_fail() returns trigger as $$
        begin raise exception 'audit down'; end $$ language plpgsql`);
      await raw.query(
        `create trigger edmate_test_fail before insert on audit_log for each row execute function edmate_test_fail()`,
      );
      try {
        const err = await identity
          .grantRole({ userId: u.id, role: 'teacher', by: 'operator' })
          .catch((e: unknown) => e);
        expectScrubbed(err, 'identity.grantRole', [u.id, 'audit down']);
        expect((await identity.getUser(u.id))?.role).toBe('student');
      } finally {
        await raw.query(`drop trigger edmate_test_fail on audit_log`);
      }
    });
  });

  it('scrubs driver errors: no email, token or SQL leaves', async () => {
    const closed = createDb({ DATABASE_URL: TEST_URL });
    const store = createIdentityStore(closed.db);
    await closed.close();
    const secret = 'very.private.person@example.test';
    const err = await store
      .createStudent({ email: secret, emailVerifiedAt: null, name: 'Private Name' })
      .catch((e: unknown) => e);
    expectScrubbed(err, 'identity.createStudent', [secret, 'Private Name']);
    const t = token('scrub');
    expectScrubbed(
      await store.getSessionAndUser(t).catch((e: unknown) => e),
      'identity.getSessionAndUser',
      [t, hashSessionToken(t)],
    );
  });

  it('openDatabase exposes the identity store', async () => {
    const opened = openDatabase({ DATABASE_URL: TEST_URL });
    try {
      expect(await opened.identity.getUser('usr_missing')).toBeNull();
    } finally {
      await opened.close();
    }
  });
});
