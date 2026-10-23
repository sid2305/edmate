// Task 1.3: the identity store on a real Postgres 16 (see test/pg.ts; skipped locally without
// one, fails in CI). New users are always students, only grantRole changes a role (with an audit
// row in the same transaction), session tokens are stored hashed, and driver errors are scrubbed.
// Task 1.4: magic-link verification tokens are stored hashed, single use, newest only per address.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import pg from 'pg';
import { migrateDatabase } from '../src/migrate.js';
import { createDb, type DbHandle } from '../src/internal.js';
import {
  type AgePolicy,
  createIdentityStore,
  DEFAULT_AGE_POLICY,
  OPERATOR,
  openDatabase,
  RepositoryError,
  type IdentityStore,
} from '../src/index.js';
import { hashSessionToken, hashToken } from '../src/identity/token-hash.js';
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

    it('a user has at most one account per provider: a second Google account is invalid', async () => {
      const a = await identity.createStudent({
        email: email('one'),
        emailVerifiedAt: null,
        name: 'One',
      });
      await identity.linkAccount({
        userId: a.id,
        type: 'oidc',
        provider: 'google',
        providerAccountId: `sub-first-${a.id}`,
      });
      expect(
        await kindOf(() =>
          identity.linkAccount({
            userId: a.id,
            type: 'oidc',
            provider: 'google',
            providerAccountId: `sub-second-${a.id}`,
          }),
        ),
      ).toBe('invalid');
      expect(await identity.getUserByAccount('google', `sub-second-${a.id}`)).toBeNull();
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
    const student = (label: string) =>
      identity.createStudent({ email: email(label), emailVerifiedAt: null, name: label });
    const platformRows = async (target: string) =>
      (
        await raw.query(
          `select actor, actor_role, action, target, subject_user_id, reason, before, after
             from platform_audit_log where target = $1`,
          [target],
        )
      ).rows;
    const count = async (table: 'audit_log' | 'platform_audit_log') =>
      (await raw.query(`select count(*)::int as n from ${table}`)).rows[0].n as number;

    it('by the operator: writes the role and a platform audit row (actor role operator), not a teacher-scoped one', async () => {
      const u = await student('g');
      const teacherRows = await count('audit_log');
      const out = await identity.grantRole({
        userId: u.id,
        role: 'staff',
        by: 'operator',
        reason: 'first staff account',
      });
      expect(out).toEqual({ ...u, role: 'staff' });
      expect(await platformRows(`user:${u.id}`)).toEqual([
        {
          actor: 'operator',
          actor_role: 'operator',
          action: 'role.grant',
          target: `user:${u.id}`,
          subject_user_id: u.id,
          reason: 'first staff account',
          before: { role: 'student' },
          after: { role: 'staff' },
        },
      ]);
      // 1.6's audit_log keeps "every row belongs to one teacher": grants don't go there.
      expect(await count('audit_log')).toBe(teacherRows);
    });

    it('by a staff user: records the staff id and actor role staff', async () => {
      const staff = await student('s');
      await identity.grantRole({ userId: staff.id, role: 'staff', by: 'operator' });
      const u = await student('t');
      await identity.grantRole({ userId: u.id, role: 'teacher', by: staff.id });
      expect(await platformRows(`user:${u.id}`)).toEqual([
        expect.objectContaining({ actor: staff.id, actor_role: 'staff', reason: null }),
      ]);
      expect((await identity.getUser(u.id))?.role).toBe('teacher');
    });

    it('refuses an actor that is not staff (a student, a teacher, an unknown id) as scope; nothing is written', async () => {
      const target = await student('x');
      const notStaff = await student('y');
      const teacher = await student('z');
      await identity.grantRole({ userId: teacher.id, role: 'teacher', by: 'operator' });
      const before = await count('platform_audit_log');
      for (const by of [notStaff.id, teacher.id, 'usr_ghost', 'Operator']) {
        expect(
          await kindOf(() => identity.grantRole({ userId: target.id, role: 'staff', by })),
          by,
        ).toBe('scope');
      }
      // A user can't grant themselves staff either.
      expect(
        await kindOf(() =>
          identity.grantRole({ userId: notStaff.id, role: 'staff', by: notStaff.id }),
        ),
      ).toBe('scope');
      expect(await count('platform_audit_log')).toBe(before);
      expect((await identity.getUser(target.id))?.role).toBe('student');
    });

    it('a bad role, actor or extra field is invalid; an unknown user is not_found; nothing is written', async () => {
      const u = await student('b');
      const before = await count('platform_audit_log');
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
      expect(await count('platform_audit_log')).toBe(before);
      expect((await identity.getUser(u.id))?.role).toBe('student');
    });

    it('rolls the role back when the audit write fails', async () => {
      const u = await student('f');
      // Make the audit insert fail with a trigger: the role update must not survive it.
      await raw.query(`create or replace function edmate_test_fail() returns trigger as $$
        begin raise exception 'audit down'; end $$ language plpgsql`);
      await raw.query(
        `create trigger edmate_test_fail before insert on platform_audit_log for each row execute function edmate_test_fail()`,
      );
      try {
        const err = await identity
          .grantRole({ userId: u.id, role: 'teacher', by: 'operator' })
          .catch((e: unknown) => e);
        expectScrubbed(err, 'identity.grantRole', [u.id, 'audit down']);
        expect((await identity.getUser(u.id))?.role).toBe('student');
      } finally {
        await raw.query(`drop trigger edmate_test_fail on platform_audit_log`);
      }
    });
  });

  describe('verification tokens (1.4 magic links)', () => {
    const MIN = 60_000;
    const soon = () => new Date(Date.now() + 15 * MIN);

    async function rowsFor(identifier: string) {
      const { rows } = await raw.query<Record<string, unknown>>(
        `select * from auth_verification_tokens where identifier = $1`,
        [identifier],
      );
      return rows;
    }

    it('stores only the SHA-256 of the token, under the lower-cased address', async () => {
      const addr = email('link');
      const t = token('link');
      const expires = soon();
      const made = await identity.createVerificationToken({
        identifier: `  ${addr.toUpperCase()} `,
        token: t,
        expires,
      });
      expect(made).toEqual({ identifier: addr, expires });
      const rows = await rowsFor(addr);
      expect(rows).toHaveLength(1);
      expect(rows[0]?.token_hash).toBe(hashToken(t));
      expect(Object.keys(rows[0] ?? {}).sort()).toEqual(
        ['created_at', 'expires_at', 'id', 'identifier', 'token_hash', 'updated_at'].sort(),
      );
      expect(JSON.stringify(rows)).not.toContain(t);
    });

    it('is single use: the first use returns it, the second is null and the row is gone', async () => {
      const addr = email('once');
      const t = token('once');
      const expires = soon();
      await identity.createVerificationToken({ identifier: addr, token: t, expires });
      expect(await identity.useVerificationToken({ identifier: addr, token: t })).toEqual({
        identifier: addr,
        expires,
      });
      expect(await identity.useVerificationToken({ identifier: addr, token: t })).toBeNull();
      expect(await rowsFor(addr)).toHaveLength(0);
    });

    it('two concurrent uses: exactly one wins', async () => {
      const addr = email('race');
      const t = token('race');
      await identity.createVerificationToken({ identifier: addr, token: t, expires: soon() });
      const results = await Promise.all(
        Array.from({ length: 5 }, () =>
          identity.useVerificationToken({ identifier: addr, token: t }),
        ),
      );
      expect(results.filter((r) => r !== null)).toHaveLength(1);
      expect(await rowsFor(addr)).toHaveLength(0);
    });

    it('an expired token reads as null and is still deleted (injected clock)', async () => {
      let clock = new Date('2026-10-20T10:00:00Z');
      const store = createIdentityStore(handle.db, { now: () => clock });
      const addr = email('expired');
      const t = token('expired');
      await store.createVerificationToken({
        identifier: addr,
        token: t,
        expires: new Date('2026-10-20T10:15:00Z'),
      });
      clock = new Date('2026-10-20T10:15:00Z');
      expect(await store.useVerificationToken({ identifier: addr, token: t })).toBeNull();
      expect(await rowsFor(addr)).toHaveLength(0);
    });

    it('needs the matching address: the right token for another address is null and kept', async () => {
      const addr = email('bound');
      const t = token('bound');
      await identity.createVerificationToken({ identifier: addr, token: t, expires: soon() });
      expect(
        await identity.useVerificationToken({ identifier: email('other'), token: t }),
      ).toBeNull();
      expect(await rowsFor(addr)).toHaveLength(1);
      expect(
        await identity.useVerificationToken({ identifier: addr, token: token('x') }),
      ).toBeNull();
      expect(await identity.useVerificationToken({ identifier: addr, token: t })).not.toBeNull();
    });

    it('a new link replaces older ones for that address only', async () => {
      const a = email('newest');
      const b = email('bystander');
      const [a1, a2, b1] = [token('a1'), token('a2'), token('b1')];
      await identity.createVerificationToken({ identifier: a, token: a1, expires: soon() });
      await identity.createVerificationToken({ identifier: b, token: b1, expires: soon() });
      await identity.createVerificationToken({ identifier: a, token: a2, expires: soon() });
      expect(await rowsFor(a)).toHaveLength(1);
      expect(await identity.useVerificationToken({ identifier: a, token: a1 })).toBeNull();
      expect(await identity.useVerificationToken({ identifier: a, token: a2 })).not.toBeNull();
      expect(await identity.useVerificationToken({ identifier: b, token: b1 })).not.toBeNull();
    });

    it('concurrent new links for one address leave exactly one live token', async () => {
      const addr = email('burst');
      const toks = Array.from({ length: 6 }, (_, i) => token(`burst${i}`));
      await Promise.all(
        toks.map((t) =>
          identity.createVerificationToken({ identifier: addr, token: t, expires: soon() }),
        ),
      );
      const rows = await rowsFor(addr);
      expect(rows).toHaveLength(1);
      const live = toks.filter((t) => hashToken(t) === rows[0]?.token_hash);
      expect(live).toHaveLength(1);
    });

    it('rejects bad input as invalid before any SQL', async () => {
      const ok = { identifier: email('bad'), token: token('bad'), expires: soon() };
      const bad: unknown[] = [
        { ...ok, identifier: 'not-an-email' },
        { ...ok, identifier: 'a@example.test, b@example.test' },
        { ...ok, token: 'short' },
        { ...ok, token: 42 },
        { ...ok, expires: '2026-10-20' },
        { ...ok, extra: true },
        null,
      ];
      for (const input of bad) {
        expect(
          await kindOf(() =>
            identity.createVerificationToken(
              input as Parameters<IdentityStore['createVerificationToken']>[0],
            ),
          ),
        ).toBe('invalid');
      }
      const useBad: unknown[] = [
        { identifier: 'nope', token: ok.token },
        { identifier: ok.identifier, token: 'short' },
        { identifier: ok.identifier, token: ok.token, expires: ok.expires },
        undefined,
      ];
      for (const input of useBad) {
        expect(
          await kindOf(() =>
            identity.useVerificationToken(
              input as Parameters<IdentityStore['useVerificationToken']>[0],
            ),
          ),
        ).toBe('invalid');
      }
      expect(await rowsFor(ok.identifier)).toHaveLength(0);
    });

    it('indexes identifier (unique) and expires_at, with no foreign key to users', async () => {
      const { rows } = await raw.query<{ indexname: string; indexdef: string }>(
        `select indexname, indexdef from pg_indexes where tablename = 'auth_verification_tokens'`,
      );
      const defs = Object.fromEntries(rows.map((r) => [r.indexname, r.indexdef]));
      expect(defs.auth_verification_tokens_identifier_key).toMatch(/UNIQUE.*\(identifier\)/);
      expect(defs.auth_verification_tokens_token_hash_key).toMatch(/UNIQUE.*\(token_hash\)/);
      expect(defs.auth_verification_tokens_expires_at_idx).toMatch(/\(expires_at\)/);
      const fks = await raw.query(
        `select 1 from pg_constraint where conrelid = 'auth_verification_tokens'::regclass and contype = 'f'`,
      );
      expect(fks.rowCount).toBe(0);
    });
  });

  describe('age and consent (1.7)', () => {
    const NOW = new Date('2026-10-20T12:00:00Z');
    const policy = (market: string): AgePolicy =>
      market === 'US' ? { minAge: 13, consentRequired: false } : DEFAULT_AGE_POLICY;
    let aged: IdentityStore;

    beforeAll(() => {
      aged = createIdentityStore(handle.db, { now: () => NOW, agePolicy: policy });
    });

    const student = () =>
      identity.createStudent({ email: email('age'), emailVerifiedAt: null, name: 'Learner' });
    const answer = (userId: string, birthYear: unknown, market: unknown = 'IN', store = aged) =>
      store.recordAgeAnswer({ userId, market, birthYear, noticeVersion: 'draft-0' } as never);

    async function userRow(id: string) {
      const { rows } = await raw.query(
        `select market, birth_year, age_confirmed_at from users where id = $1`,
        [id],
      );
      return rows[0] as
        { market: string; birth_year: number | null; age_confirmed_at: Date | null } | undefined;
    }
    async function consentRows(id: string) {
      const { rows } = await raw.query(
        `select kind, version, granted_by, withdrawn_at, ts from consents where user_id = $1`,
        [id],
      );
      return rows;
    }
    async function parental(id: string, withdrawn: Date | null = null, by = 'parent') {
      await raw.query(
        `insert into consents (id, user_id, kind, version, granted_by, withdrawn_at)
           values ($1, $2, 'parental', $1, $3, $4)`,
        [`cns_${(n += 1)}`, id, by, withdrawn],
      );
    }

    it('an adult: clear; stores the birth year, market and time, and the notice version', async () => {
      const u = await student();
      expect(await aged.learnerStatus(u.id)).toBe('age_needed');
      expect(await answer(u.id, 1990)).toEqual({ status: 'clear' });
      expect(await userRow(u.id)).toEqual({
        market: 'IN',
        birth_year: 1990,
        age_confirmed_at: NOW,
      });
      expect(await consentRows(u.id)).toEqual([
        {
          kind: 'privacy_notice',
          version: 'draft-0',
          granted_by: 'self',
          withdrawn_at: null,
          ts: expect.any(Date),
        },
      ]);
      expect(await aged.learnerStatus(u.id)).toBe('clear');
    });

    it('13-17 in a consent market: parent_needed until a live parental consent', async () => {
      const u = await student();
      expect(await answer(u.id, 2012)).toEqual({ status: 'parent_needed' });
      expect(await aged.learnerStatus(u.id)).toBe('parent_needed');
      await parental(u.id, null, 'self');
      expect(await aged.learnerStatus(u.id), 'a self-granted parental row').toBe('parent_needed');
      await parental(u.id, new Date('2026-10-19T00:00:00Z'));
      expect(await aged.learnerStatus(u.id), 'a withdrawn consent').toBe('parent_needed');
      await parental(u.id);
      expect(await aged.learnerStatus(u.id)).toBe('clear');
      await raw.query(
        `update consents set withdrawn_at = now() where user_id = $1 and kind = 'parental'`,
        [u.id],
      );
      expect(await aged.learnerStatus(u.id), 'after withdrawal').toBe('parent_needed');
    });

    it('a market whose policy waives consent clears 13-17; "somewhere else" uses the default', async () => {
      const us = await student();
      expect(await answer(us.id, 2010, 'US')).toEqual({ status: 'clear' });
      const elsewhere = await student();
      expect(await answer(elsewhere.id, 2010, 'global')).toEqual({ status: 'parent_needed' });
      expect((await userRow(elsewhere.id))?.market).toBe('global');
    });

    it('with no agePolicy option every market needs consent for 13-17', async () => {
      const plain = createIdentityStore(handle.db, { now: () => NOW });
      const u = await student();
      expect(await answer(u.id, 2010, 'US', plain)).toEqual({ status: 'parent_needed' });
      expect(await plain.learnerStatus(u.id)).toBe('parent_needed');
    });

    it('under 13: erases the user and its sign-in rows in one go and keeps no birth year', async () => {
      const u = await student();
      const other = await student();
      await identity.linkAccount({
        userId: u.id,
        type: 'oidc',
        provider: 'google',
        providerAccountId: `g-${(n += 1)}`,
      });
      await identity.createSession(token('child'), u.id, later());
      await identity.createSession(token('other'), other.id, later());
      await identity.createVerificationToken({
        identifier: u.email ?? '',
        token: token('child-link'),
        expires: later(),
      });
      await identity.createVerificationToken({
        identifier: other.email ?? '',
        token: token('other-link'),
        expires: later(),
      });

      expect(await answer(u.id, 2014)).toEqual({ status: 'under_age' });

      expect(await userRow(u.id)).toBeUndefined();
      for (const [table, col, value] of [
        ['auth_accounts', 'user_id', u.id],
        ['auth_sessions', 'user_id', u.id],
        ['consents', 'user_id', u.id],
        ['auth_verification_tokens', 'identifier', u.email],
      ] as const) {
        const { rowCount } = await raw.query(`select 1 from ${table} where ${col} = $1`, [value]);
        expect(rowCount, table).toBe(0);
      }
      const { rowCount: years } = await raw.query(`select 1 from users where birth_year = 2014`);
      expect(years).toBe(0);
      // Another user's rows are untouched.
      expect(await identity.getUser(other.id)).not.toBeNull();
      const { rowCount: kept } = await raw.query(
        `select 1 from auth_verification_tokens where identifier = $1`,
        [other.email],
      );
      expect(kept).toBe(1);
      await expect(aged.learnerStatus(u.id)).rejects.toMatchObject({ kind: 'not_found' });
    });

    it('a blocking foreign row: the sign-in rows go, the account stays blocked forever (fix round 1)', async () => {
      const u = await student();
      // A row the erase does not own blocks deleting the user (foreign key), but only that delete.
      await raw.query(
        `insert into platform_audit_log (id, actor, actor_role, action, target, subject_user_id)
           values ($1, 'operator', 'operator', 'test', 'user', $2)`,
        [`pal_${(n += 1)}`, u.id],
      );
      await identity.linkAccount({
        userId: u.id,
        type: 'oidc',
        provider: 'google',
        providerAccountId: `g-${(n += 1)}`,
      });
      await identity.createSession(token('kept'), u.id, later());
      await identity.createVerificationToken({
        identifier: u.email ?? '',
        token: token('kept-link'),
        expires: later(),
      });

      expect(await answer(u.id, 2014)).toEqual({ status: 'erase_blocked' });

      // The user row stays (no birth year ever stored), but every sign-in row is gone.
      expect(await userRow(u.id)).toEqual({
        market: 'global',
        birth_year: null,
        age_confirmed_at: null,
      });
      for (const [table, col, value] of [
        ['auth_accounts', 'user_id', u.id],
        ['auth_sessions', 'user_id', u.id],
        ['consents', 'user_id', u.id],
        ['auth_verification_tokens', 'identifier', u.email],
      ] as const) {
        const { rowCount } = await raw.query(`select 1 from ${table} where ${col} = $1`, [value]);
        expect(rowCount, table).toBe(0);
      }
      const { rows } = await raw.query<{ age_blocked_at: Date | null }>(
        `select age_blocked_at from users where id = $1`,
        [u.id],
      );
      expect(rows[0]?.age_blocked_at).not.toBeNull();

      // Blocked forever: no second answer from this browser or any other, and the standing shows.
      expect(await kindOf(() => answer(u.id, 1990))).toBe('invalid');
      expect(await aged.learnerStatus(u.id)).toBe('under_age');
    });

    it('an unexpected failure on the erase rolls back everything (the savepoint is not a shield for it)', async () => {
      const u = await student();
      await identity.createSession(token('unexpected'), u.id, later());
      // Not a constraint violation (no RepositoryError translation): the savepoint's own catch
      // rethrows it, and that aborts the whole answer, sign-in rows included.
      await raw.query(`create or replace function edmate_test_fail() returns trigger as $$
        begin raise exception 'erase down'; end $$ language plpgsql`);
      await raw.query(
        `create trigger edmate_test_fail before delete on users for each row execute function edmate_test_fail()`,
      );
      try {
        const err = await answer(u.id, 2014).catch((e: unknown) => e);
        expectScrubbed(err, 'identity.recordAgeAnswer', [u.id, 'erase down']);
      } finally {
        await raw.query(`drop trigger edmate_test_fail on users`);
      }
      expect(await userRow(u.id)).toEqual({
        market: 'global',
        birth_year: null,
        age_confirmed_at: null,
      });
      const { rowCount } = await raw.query(`select 1 from auth_sessions where user_id = $1`, [
        u.id,
      ]);
      expect(rowCount).toBe(1);
    });

    it('the answer is given once: a second one is invalid and changes nothing', async () => {
      const u = await student();
      await answer(u.id, 1990);
      expect(await kindOf(() => answer(u.id, 2014, 'US'))).toBe('invalid');
      expect(await userRow(u.id)).toMatchObject({ market: 'IN', birth_year: 1990 });
      expect(await consentRows(u.id)).toHaveLength(1);
    });

    it('two concurrent answers: exactly one is stored', async () => {
      const u = await student();
      const results = await Promise.allSettled([answer(u.id, 1990), answer(u.id, 2014)]);
      expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
      const row = await userRow(u.id);
      if (row) expect(row.birth_year).toBe(1990);
      else expect(results[1]).toMatchObject({ status: 'fulfilled' });
    });

    it('rejects a bad year, market, version or extra field as invalid before any SQL', async () => {
      const u = await student();
      for (const year of [1899, 2101, 2027, 1990.5, '1990', null]) {
        expect(await kindOf(() => answer(u.id, year)), `year ${String(year)}`).toBe('invalid');
      }
      for (const market of ['in', 'IND', '', 'GLOBAL', 'I N', 42]) {
        expect(await kindOf(() => answer(u.id, 1990, market)), `market ${String(market)}`).toBe(
          'invalid',
        );
      }
      for (const noticeVersion of ['', 'x'.repeat(65)]) {
        expect(
          await kindOf(() =>
            aged.recordAgeAnswer({ userId: u.id, market: 'IN', birthYear: 1990, noticeVersion }),
          ),
        ).toBe('invalid');
      }
      expect(
        await kindOf(() =>
          aged.recordAgeAnswer({
            userId: u.id,
            market: 'IN',
            birthYear: 1990,
            noticeVersion: 'v1',
            role: 'staff',
          } as never),
        ),
      ).toBe('invalid');
      expect(await userRow(u.id)).toEqual({
        market: 'global',
        birth_year: null,
        age_confirmed_at: null,
      });
    });

    it('an unknown user is not_found; a teacher or staff user is scope and is never erased', async () => {
      expect(await kindOf(() => answer('usr_missing_age', 1990))).toBe('not_found');
      expect(await kindOf(() => aged.learnerStatus('usr_missing_age'))).toBe('not_found');
      expect(await kindOf(() => aged.learnerStatus('bad id!'))).toBe('invalid');
      const t = await student();
      await identity.grantRole({ userId: t.id, role: 'teacher', by: OPERATOR });
      expect(await kindOf(() => answer(t.id, 2014))).toBe('scope');
      expect(await identity.getUser(t.id)).not.toBeNull();
      // learnerStatus is for students only (the web gate never asks for other roles).
      expect(await kindOf(() => aged.learnerStatus(t.id))).toBe('scope');
      const s = await student();
      await identity.grantRole({ userId: s.id, role: 'staff', by: OPERATOR });
      expect(await kindOf(() => aged.learnerStatus(s.id))).toBe('scope');
    });

    it('getMarket (9.4a): global at signup, the answered market after, null for an unknown id', async () => {
      const u = await student();
      expect(await aged.getMarket(u.id)).toBe('global');
      await answer(u.id, 1990, 'US');
      expect(await aged.getMarket(u.id)).toBe('US');
      expect(await aged.getMarket('usr_missing_market')).toBeNull();
      expect(await kindOf(() => aged.getMarket('bad id!'))).toBe('invalid');
      // Any role: a teacher's own market reads the same (the caller decides who may ask).
      const t = await student();
      await identity.grantRole({ userId: t.id, role: 'teacher', by: OPERATOR });
      expect(await aged.getMarket(t.id)).toBe('global');
    });

    it('with a noticeVersion option, only the version the server shows for that market is taken', async () => {
      const shown = (market: string) => (market === 'IN' ? 'in-3' : 'global-1');
      const store = createIdentityStore(handle.db, {
        now: () => NOW,
        agePolicy: policy,
        noticeVersion: shown,
      });
      const u = await student();
      const at = (market: string, noticeVersion: string, birthYear = 1990) =>
        store.recordAgeAnswer({ userId: u.id, market, birthYear, noticeVersion });
      expect(await kindOf(() => at('IN', 'draft-0'))).toBe('invalid');
      expect(await kindOf(() => at('IN', 'global-1'))).toBe('invalid');
      // A wrong version on an under-13 answer erases nothing.
      expect(await kindOf(() => at('IN', 'x', 2020))).toBe('invalid');
      expect(await userRow(u.id)).toMatchObject({ birth_year: null });
      expect(await at('IN', 'in-3')).toEqual({ status: 'clear' });
      expect(await consentRows(u.id)).toEqual([expect.objectContaining({ version: 'in-3' })]);
    });

    it('a broken market policy fails the call and erases no one', async () => {
      const broken = createIdentityStore(handle.db, {
        now: () => NOW,
        agePolicy: () => ({ minAge: Number.NaN, consentRequired: true }),
      });
      const u = await student();
      expect(await kindOf(() => answer(u.id, 2020, 'IN', broken))).toBe('failed');
      expect(await userRow(u.id)).toMatchObject({ birth_year: null });
      await answer(u.id, 2010);
      expect(await kindOf(() => broken.learnerStatus(u.id))).toBe('failed');
    });

    it('a learner below a market minimum raised after they answered is not cleared', async () => {
      const u = await student();
      await answer(u.id, 2010);
      await parental(u.id);
      const raised = createIdentityStore(handle.db, {
        now: () => NOW,
        agePolicy: () => ({ minAge: 16, consentRequired: true }),
      });
      expect(await raised.learnerStatus(u.id)).toBe('parent_needed');
    });
  });

  it('indexes auth_sessions.expires_at and allows one account per provider per user', async () => {
    const { rows } = await raw.query<{ indexname: string; indexdef: string }>(
      `select indexname, indexdef from pg_indexes where tablename in ('auth_sessions', 'auth_accounts')`,
    );
    const defs = Object.fromEntries(rows.map((r) => [r.indexname, r.indexdef]));
    expect(defs.auth_sessions_expires_at_idx).toMatch(/\(expires_at\)/);
    expect(defs.auth_accounts_user_id_provider_key).toMatch(/UNIQUE.*\(user_id, provider\)/);
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
    const addr = 'link.private.person@example.test';
    const lt = token('scrub-link');
    expectScrubbed(
      await store
        .createVerificationToken({ identifier: addr, token: lt, expires: later() })
        .catch((e: unknown) => e),
      'identity.createVerificationToken',
      [addr, lt, hashToken(lt)],
    );
    expectScrubbed(
      await store.useVerificationToken({ identifier: addr, token: lt }).catch((e: unknown) => e),
      'identity.useVerificationToken',
      [addr, lt, hashToken(lt)],
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

  it('openDatabase passes the age policy and notice versions to the identity store', async () => {
    const opened = openDatabase(
      { DATABASE_URL: TEST_URL },
      {
        identity: {
          agePolicy: () => ({ minAge: 13, consentRequired: false }),
          noticeVersion: () => 'v-open',
        },
      },
    );
    try {
      const u = await opened.identity.createStudent({
        email: email('open'),
        emailVerifiedAt: null,
        name: 'Learner',
      });
      const at = (noticeVersion: string) =>
        opened.identity.recordAgeAnswer({ userId: u.id, market: 'US', birthYear: 2010, noticeVersion });
      expect(await kindOf(() => at('draft-0'))).toBe('invalid');
      expect(await at('v-open')).toEqual({ status: 'clear' });
    } finally {
      await opened.close();
    }
  });
});
