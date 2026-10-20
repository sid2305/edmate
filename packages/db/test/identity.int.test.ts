// Task 1.3: the identity store on a real Postgres 16 (see test/pg.ts; skipped locally without
// one, fails in CI). New users are always students, only grantRole changes a role (with an audit
// row in the same transaction), session tokens are stored hashed, and driver errors are scrubbed.
// Task 1.4: magic-link verification tokens are stored hashed, single use, newest only per address.
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
      expect(await identity.useVerificationToken({ identifier: addr, token: token('x') })).toBeNull();
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
            identity.createVerificationToken(input as Parameters<IdentityStore['createVerificationToken']>[0]),
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
            identity.useVerificationToken(input as Parameters<IdentityStore['useVerificationToken']>[0]),
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
});
