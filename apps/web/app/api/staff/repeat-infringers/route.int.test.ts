// Task 12.3d end to end over a real Postgres -- the real handlers, the real guard, ROUTE_POLICY
// and repositories: the manual check from the plan (seed, flag, suspend, drop off the list),
// stood up as a route test instead of by hand against the dev database.
//
// Runs only when TEST_DATABASE_URL is set explicitly (CI sets it for the whole job; locally, point
// it at your own disposable Postgres -- never the dev compose database). Unset, it says so on
// stderr and skips; with CI=true it fails instead. Every row this test writes uses a fresh random
// tag. `takedowns.create`'s target must exist (12.2b), so each takedown here targets its own tiny
// `agents` row inserted directly (via `@edmate/db/internal`'s raw pool, the same test-only
// exception `verifications/route.int.test.ts` uses for cleanup) -- a real document would also need
// a course and a module, which this test does not otherwise need. `afterAll` deletes every row it
// wrote, in FK order, so nothing is left open, suspended or just orphaned in a shared database.
import { randomBytes } from 'node:crypto';
import { migrateDatabase, openDatabase } from '@edmate/db';
// Test-only cleanup and seeding, same exception `verifications/route.int.test.ts` relies on.
// eslint-disable-next-line no-restricted-imports
import { createDb } from '@edmate/db/internal';
import { NextRequest } from 'next/server';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createGuard, type CookieReader, type Principal } from '../../../../src/auth/guard';
import { createStaffRepeatInfringersHandlers } from './handlers';

const DB_URL = process.env.TEST_DATABASE_URL?.trim() ?? '';
const ORIGIN = 'http://localhost:8080';
const PATH = '/api/staff/repeat-infringers';

if (!DB_URL) {
  if (process.env.CI === 'true') {
    throw new Error(
      'CI=true but TEST_DATABASE_URL is not set; the repeat-infringers int test needs Postgres',
    );
  }
  process.stderr.write(
    '[@edmate/web] staff repeat-infringers int test SKIPPED: TEST_DATABASE_URL is not set\n',
  );
}

describe.skipIf(!DB_URL)('repeat-infringer flag over a real Postgres', () => {
  const tag = randomBytes(5).toString('hex');
  let db: ReturnType<typeof openDatabase>;
  const who: Record<string, Principal> = {};
  let staffId = '';
  const agentIds: string[] = [];
  const teacherIds: string[] = [];

  async function user(name: string): Promise<string> {
    const created = await db.identity.createStudent({
      email: `ri-int-${tag}-${name}@example.test`,
      emailVerifiedAt: new Date(),
      name: `Int ${name} ${tag}`,
    });
    await db.identity.grantRole({ userId: created.id, role: 'teacher', by: 'operator' });
    teacherIds.push(created.id);
    return created.id;
  }

  async function teacher(name: string, slug: string): Promise<string> {
    const teacherId = await user(name);
    await db.repos.teacherProfiles.create(
      { teacherId },
      { slug, displayName: name, subject: 'Math' },
    );
    return teacherId;
  }

  async function agentTarget(raw: ReturnType<typeof createDb>, teacherId: string): Promise<string> {
    const agentId = `agt-ri-${tag}-${agentIds.length}`;
    agentIds.push(agentId);
    await raw.pool.query('insert into agents (id, teacher_id) values ($1, $2)', [
      agentId,
      teacherId,
    ]);
    return agentId;
  }

  async function copyrightTakedown(
    teacherId: string,
    raw: ReturnType<typeof createDb>,
  ): Promise<string> {
    const agentId = await agentTarget(raw, teacherId);
    const { id } = await db.repos.takedowns.create(staffId, {
      kind: 'agent',
      targetId: agentId,
      category: 'copyright',
    });
    return id;
  }

  let flaggedTeacher = '';
  let twoOnlyTeacher = '';
  let liftedOneTeacher = '';
  let rejectedTeacher = '';
  let liftedTakedownId = '';

  beforeAll(async () => {
    await migrateDatabase(DB_URL);
    db = openDatabase({ DATABASE_URL: DB_URL });
    const raw = createDb({ DATABASE_URL: DB_URL });
    try {
      const staff = await db.identity.createStudent({
        email: `ri-int-${tag}-staff@example.test`,
        emailVerifiedAt: new Date(),
        name: `Int staff ${tag}`,
      });
      staffId = staff.id;
      await db.identity.grantRole({ userId: staffId, role: 'staff', by: 'operator' });
      who.staff = { userId: staffId, role: 'staff' };
      who.teacher = { userId: '', role: 'teacher' };

      // Flagged: 3 in-window active copyright takedowns.
      flaggedTeacher = await teacher('flagged', `flagged-ri-${tag}`);
      await copyrightTakedown(flaggedTeacher, raw);
      await copyrightTakedown(flaggedTeacher, raw);
      await copyrightTakedown(flaggedTeacher, raw);

      // Not flagged: only 2.
      twoOnlyTeacher = await teacher('two-only', `two-only-ri-${tag}`);
      await copyrightTakedown(twoOnlyTeacher, raw);
      await copyrightTakedown(twoOnlyTeacher, raw);

      // Not flagged: 3, but one lifted (matches countUpheld's "a lifted one does not count").
      liftedOneTeacher = await teacher('lifted-one', `lifted-one-ri-${tag}`);
      await copyrightTakedown(liftedOneTeacher, raw);
      await copyrightTakedown(liftedOneTeacher, raw);
      liftedTakedownId = await copyrightTakedown(liftedOneTeacher, raw);
      await db.repos.takedowns.lift(staffId, liftedTakedownId, {
        note: 'int test: not an upheld 3rd',
      });
      liftedTakedownId = '';

      // Not flagged: 3, but already rejected -- nothing left to prompt staff to do.
      rejectedTeacher = await teacher('rejected', `rejected-ri-${tag}`);
      await copyrightTakedown(rejectedTeacher, raw);
      await copyrightTakedown(rejectedTeacher, raw);
      await copyrightTakedown(rejectedTeacher, raw);
      await db.repos.teacherProfiles.setVerification(
        { teacherId: rejectedTeacher },
        {
          status: 'rejected',
          by: staffId,
          reason: 'int test: already rejected before the flag read',
        },
      );
    } finally {
      await raw.close();
    }
  }, 120_000);

  afterAll(async () => {
    if (!db) return;
    for (const teacherId of [flaggedTeacher, twoOnlyTeacher, liftedOneTeacher]) {
      if (!teacherId) continue;
      await db.repos.teacherProfiles
        .setVerification(
          { teacherId },
          { status: 'rejected', by: staffId, reason: 'int test cleanup' },
        )
        .catch(() => undefined);
    }
    const raw = createDb({ DATABASE_URL: DB_URL });
    try {
      const targets = agentIds.map((id) => `agent:${id}`);
      if (targets.length > 0) {
        await raw.pool.query('delete from takedowns where target = any($1)', [targets]);
      }
      const ids = [staffId, ...teacherIds].filter((id) => id !== '');
      if (ids.length > 0) {
        await raw.pool.query('delete from audit_log where teacher_id = any($1)', [ids]);
        await raw.pool.query('delete from platform_audit_log where subject_user_id = any($1)', [
          ids,
        ]);
        await raw.pool.query('delete from teacher_profiles where user_id = any($1)', [ids]);
      }
      if (agentIds.length > 0) {
        await raw.pool.query('delete from agents where id = any($1)', [agentIds]);
      }
      if (ids.length > 0) {
        await raw.pool.query('delete from users where id = any($1)', [ids]);
      }
    } finally {
      await raw.close();
    }
    await db.close();
  });

  function routes() {
    const guard = createGuard(
      () => ({
        getPrincipal: async (c: CookieReader) => who[c.get('who')?.value ?? ''] ?? null,
        learnerStatus: async () => 'clear',
        allowedOrigin: ORIGIN,
      }),
      () => {
        throw new Error('not a page');
      },
    );
    const h = createStaffRepeatInfringersHandlers({ repos: () => db.repos, log: () => undefined });
    return { GET: guard.withRole(['staff'], h.list) };
  }
  const getAs = (as: string | null) =>
    new NextRequest(`${ORIGIN}${PATH}`, {
      method: 'GET',
      headers: as ? { cookie: `who=${as}` } : {},
    });

  it('seed: only the teacher with 3 upheld in-window copyright takedowns is flagged', async () => {
    const res = await routes().GET(getAs('staff'));
    expect(res.status).toBe(200);
    const { teachers } = (await res.json()) as { teachers: { teacherId: string; slug: string }[] };
    const slugs = teachers.map((t) => t.slug);
    expect(slugs).toContain(`flagged-ri-${tag}`);
    expect(slugs).not.toContain(`two-only-ri-${tag}`);
    expect(slugs).not.toContain(`lifted-one-ri-${tag}`);
    expect(slugs).not.toContain(`rejected-ri-${tag}`);
  });

  it('suspend: rejecting the flagged teacher (the existing setVerification path) drops them off the list', async () => {
    await db.repos.teacherProfiles.setVerification(
      { teacherId: flaggedTeacher },
      { status: 'rejected', by: staffId, reason: 'int test: suspend the repeat infringer' },
    );
    const res = await routes().GET(getAs('staff'));
    const { teachers } = (await res.json()) as { teachers: { slug: string }[] };
    expect(teachers.map((t) => t.slug)).not.toContain(`flagged-ri-${tag}`);
  });

  it('a non-staff user is 403, signed out is 401', async () => {
    const r = routes();
    expect((await r.GET(getAs(null))).status).toBe(401);
    who.someone = { userId: twoOnlyTeacher, role: 'teacher' };
    expect((await r.GET(getAs('someone'))).status).toBe(403);
  });
});
