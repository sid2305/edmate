// Task 12.1b: the staff verification API end to end over a real Postgres -- the real handlers, the
// real guard and ROUTE_POLICY, and the real repositories (12.1a's listPendingForStaff, 8.1's
// setVerification and assertVerifiedForPublish). It proves the acceptance line: approve/reject is
// audited (`teacher.verify` rows) and an unverified teacher can't publish.
//
// Runs only when TEST_DATABASE_URL is set explicitly (CI sets it for the whole job; locally, point
// it at your own disposable Postgres -- never the dev compose database). Unset, it says so on
// stderr and skips; with CI=true it fails instead. Every row it writes uses fresh random ids and
// emails, and both teachers end `rejected`, so nothing it leaves behind is pending or discoverable.
import { randomBytes } from 'node:crypto';
import { migrateDatabase, openDatabase, RepositoryError } from '@edmate/db';
import { NextRequest } from 'next/server';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createGuard, type CookieReader, type Principal } from '../../../../src/auth/guard';
import { createStaffVerificationHandlers } from './handlers';

const LOOKUP_PATH = '/api/staff/verifications/lookup';

const DB_URL = process.env.TEST_DATABASE_URL?.trim() ?? '';
const ORIGIN = 'http://localhost:8080';
const PATH = '/api/staff/verifications';

if (!DB_URL) {
  if (process.env.CI === 'true') {
    throw new Error('CI=true but TEST_DATABASE_URL is not set; the staff int test needs Postgres');
  }
  process.stderr.write(
    '[@edmate/web] staff verifications int test SKIPPED: TEST_DATABASE_URL is not set\n',
  );
}

describe.skipIf(!DB_URL)('staff verification over a real Postgres', () => {
  const tag = randomBytes(5).toString('hex');
  let db: ReturnType<typeof openDatabase>;
  const who: Record<string, Principal> = {};
  let staffId = '';
  let teacherA = '';
  let teacherB = '';

  async function user(name: string, role: 'staff' | 'teacher'): Promise<string> {
    const created = await db.identity.createStudent({
      email: `staff-int-${tag}-${name}@example.test`,
      emailVerifiedAt: new Date(),
      name: `Int ${name} ${tag}`,
    });
    await db.identity.grantRole({ userId: created.id, role, by: 'operator' });
    return created.id;
  }

  beforeAll(async () => {
    await migrateDatabase(DB_URL);
    db = openDatabase({ DATABASE_URL: DB_URL });
    staffId = await user('staff', 'staff');
    teacherA = await user('asha', 'teacher');
    teacherB = await user('ben', 'teacher');
    await db.repos.teacherProfiles.create(
      { teacherId: teacherA },
      { slug: `asha-${tag}`, displayName: 'Asha', subject: 'Math' },
    );
    await db.repos.teacherProfiles.create(
      { teacherId: teacherB },
      { slug: `ben-${tag}`, displayName: 'Ben', subject: 'Physics' },
    );
    who.staff = { userId: staffId, role: 'staff' };
    who.teacher = { userId: teacherA, role: 'teacher' };
  }, 120_000);

  afterAll(async () => {
    if (!db) return;
    // Leave nothing pending or verified behind (the database may be shared with the e2e run).
    for (const teacherId of [teacherA, teacherB]) {
      if (!teacherId) continue;
      await db.repos.teacherProfiles
        .setVerification({ teacherId }, { status: 'rejected', by: staffId, reason: 'int test cleanup' })
        .catch(() => undefined);
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
    const h = createStaffVerificationHandlers({ repos: () => db.repos, log: () => undefined });
    return {
      GET: guard.withRole(['staff'], h.list),
      POST: guard.withRole(['staff'], h.decide),
      LOOKUP: guard.withRole(['staff'], h.lookup),
    };
  }
  const call = (method: 'GET' | 'POST', as: string | null, body?: unknown) =>
    new NextRequest(`${ORIGIN}${PATH}`, {
      method,
      headers: {
        ...(as ? { cookie: `who=${as}` } : {}),
        ...(method === 'POST' ? { origin: ORIGIN, 'content-type': 'application/json' } : {}),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  const lookup = (as: string | null, slug: string) =>
    new NextRequest(`${ORIGIN}${LOOKUP_PATH}?slug=${encodeURIComponent(slug)}`, {
      method: 'GET',
      headers: as ? { cookie: `who=${as}` } : {},
    });
  const publish = (teacherId: string) =>
    db.repos.teacherProfiles.assertVerifiedForPublish({ teacherId });
  const verifyRows = async (teacherId: string) =>
    (await db.repos.audit.listForTeacher({ teacherId }, { limit: 20 })).filter(
      (r) => r.action === 'teacher.verify',
    );

  it('signed-out is 401; a teacher is 403 on GET and POST and changes nothing', async () => {
    const r = routes();
    expect((await r.GET(call('GET', null))).status).toBe(401);
    expect((await r.POST(call('POST', null, { teacherId: teacherA, status: 'verified' }))).status).toBe(401);
    expect((await r.GET(call('GET', 'teacher'))).status).toBe(403);
    expect(
      (await r.POST(call('POST', 'teacher', { teacherId: teacherA, status: 'verified' }))).status,
    ).toBe(403);
    expect(await verifyRows(teacherA)).toEqual([]);
    await expect(publish(teacherA)).rejects.toBeInstanceOf(RepositoryError);
  });

  it('staff see both new teachers pending, with declared name and email', async () => {
    const res = await routes().GET(call('GET', 'staff'));
    expect(res.status).toBe(200);
    const { teachers } = (await res.json()) as { teachers: { teacherId: string; name: string; email: string }[] };
    const mine = teachers.filter((t) => t.teacherId === teacherA || t.teacherId === teacherB);
    expect(mine.map((t) => t.teacherId)).toEqual([teacherA, teacherB]);
    expect(mine[0]).toMatchObject({ name: `Int asha ${tag}`, email: `staff-int-${tag}-asha@example.test` });
  });

  it('a pending teacher cannot publish', async () => {
    await expect(publish(teacherA)).rejects.toMatchObject({ kind: 'scope' });
  });

  it('staff reject: audited, still unpublishable, and gone from the queue', async () => {
    const r = routes();
    const res = await r.POST(
      call('POST', 'staff', { teacherId: teacherB, status: 'rejected', reason: 'name mismatch' }),
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ teacherId: teacherB, verificationStatus: 'rejected' });
    const rows = await verifyRows(teacherB);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      actor: staffId,
      actorRole: 'staff',
      action: 'teacher.verify',
      target: `teacher:${teacherB}`,
      reason: 'name mismatch',
      before: { verificationStatus: 'pending' },
      after: { verificationStatus: 'rejected' },
    });
    await expect(publish(teacherB)).rejects.toMatchObject({ kind: 'scope' });
    const { teachers } = (await (await r.GET(call('GET', 'staff'))).json()) as {
      teachers: { teacherId: string }[];
    };
    expect(teachers.map((t) => t.teacherId)).not.toContain(teacherB);
  });

  it('a safety rejection (9.3e) is rejected with no error and audited with the flag', async () => {
    // Teacher B has no agents here, so this proves only "rejected + audited"; the agent takedown
    // proof lives in packages/db (teacher-profiles / entitlement-store int tests).
    const before = await verifyRows(teacherB);
    const res = await routes().POST(
      call('POST', 'staff', {
        teacherId: teacherB,
        status: 'rejected',
        reason: 'safety concern',
        safety: true,
      }),
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ teacherId: teacherB, verificationStatus: 'rejected' });
    const rows = await verifyRows(teacherB);
    expect(rows).toHaveLength(before.length + 1);
    expect(rows.find((r) => r.reason === 'safety concern')).toMatchObject({
      actor: staffId,
      after: { verificationStatus: 'rejected', safety: true, takedowns: [] },
    });
    await expect(publish(teacherB)).rejects.toMatchObject({ kind: 'scope' });
  });

  it('staff approve: audited, and only now can the teacher publish', async () => {
    const res = await routes().POST(call('POST', 'staff', { teacherId: teacherA, status: 'verified' }));
    expect(res.status).toBe(200);
    const rows = await verifyRows(teacherA);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      actor: staffId,
      after: { verificationStatus: 'verified' },
    });
    await expect(publish(teacherA)).resolves.toBeUndefined();
  });

  it('9.3f: staff find the now-verified teacher A by slug, then safety-reject them (one real round trip)', async () => {
    // teacherA was verified in the previous test (listPendingForStaff would no longer show them,
    // which is exactly the console gap this lookup closes).
    const found = await routes().LOOKUP(lookup('staff', `asha-${tag}`));
    expect(found.status).toBe(200);
    expect(await found.json()).toMatchObject({
      teacher: { teacherId: teacherA, slug: `asha-${tag}`, verificationStatus: 'verified' },
    });
    const before = await verifyRows(teacherA);
    const res = await routes().POST(
      call('POST', 'staff', {
        teacherId: teacherA,
        status: 'rejected',
        reason: 'safety concern found via lookup',
        safety: true,
      }),
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ teacherId: teacherA, verificationStatus: 'rejected' });
    const rows = await verifyRows(teacherA);
    expect(rows).toHaveLength(before.length + 1);
    expect(rows.find((r) => r.reason === 'safety concern found via lookup')).toMatchObject({
      actor: staffId,
      after: { verificationStatus: 'rejected', safety: true },
    });
  });

  it('a signed-out or non-staff lookup is 401/403, nothing read', async () => {
    expect((await routes().LOOKUP(lookup(null, `asha-${tag}`))).status).toBe(401);
    expect((await routes().LOOKUP(lookup('teacher', `asha-${tag}`))).status).toBe(403);
  });

  it('an unknown slug is 200 with a null teacher', async () => {
    const res = await routes().LOOKUP(lookup('staff', `no-such-slug-${tag}`));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ teacher: null });
  });

  it("a staff user can't verify their own profile (fixed 403, no audit row)", async () => {
    // Teacher A promoted to staff: their own (now verified) profile can't be changed by them.
    await db.identity.grantRole({ userId: teacherA, role: 'staff', by: 'operator' });
    who.self = { userId: teacherA, role: 'staff' };
    const before = await verifyRows(teacherA);
    const res = await routes().POST(call('POST', 'self', { teacherId: teacherA, status: 'rejected' }));
    expect(res.status).toBe(403);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe('forbidden');
    expect(await verifyRows(teacherA)).toHaveLength(before.length);
  });
});
