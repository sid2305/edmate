// Task 12.5c: the staff alert inbox API end to end over a real Postgres -- the real handlers, the
// real guard and ROUTE_POLICY, and 12.5a's real `safetyAlerts` repository. It proves the
// acceptance line: staff see an alert, a non-staff user gets 401/403, and an acknowledgement
// writes one `safety_alert.ack` audit row and stops the alert from showing as open.
//
// Runs only when TEST_DATABASE_URL is set explicitly (CI sets it for the whole job; locally, point
// it at your own disposable Postgres -- never the dev compose database). Unset, it says so on
// stderr and skips; with CI=true it fails instead. Like `apps/web/e2e/global-setup.ts`, this never
// imports `@edmate/db/internal`: it migrates and seeds through the built CLI binaries (the same
// demo teacher, agent and package every other @edmate/db consumer uses), then opens a real
// student session and a synthetic alert through the public repositories only. Every row uses a
// fresh random tag, and the one alert this test creates ends acknowledged.
import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { openDatabase } from '@edmate/db';
import { NextRequest } from 'next/server';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createGuard, type CookieReader, type Principal } from '../../../../src/auth/guard';
import { createStaffAlertHandlers } from './handlers';

const DB_URL = process.env.TEST_DATABASE_URL?.trim() ?? '';
const ORIGIN = 'http://localhost:8080';
const PATH = '/api/staff/alerts';

if (!DB_URL) {
  if (process.env.CI === 'true') {
    throw new Error('CI=true but TEST_DATABASE_URL is not set; the staff alerts int test needs Postgres');
  }
  process.stderr.write('[@edmate/web] staff alerts int test SKIPPED: TEST_DATABASE_URL is not set\n');
}

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, '../../../../../..');
const DB_DIST = resolve(REPO_ROOT, 'packages', 'db', 'dist', 'bin');

/** `packages/db/src/seed.ts`'s own fixed ids (not importable here: that file is internal-only). */
const DEMO = {
  teacher: 'demo-teacher',
  agent: 'demo-agent',
  packageFree: 'demo-package-free',
};

function run(script: string): void {
  const result = spawnSync(process.execPath, [resolve(DB_DIST, script)], {
    env: { ...process.env, DATABASE_URL: DB_URL },
    stdio: 'inherit',
  });
  if (result.status !== 0) {
    throw new Error(`staff alerts int test: ${script} exited with ${String(result.status)}`);
  }
}

describe.skipIf(!DB_URL)('staff alert inbox over a real Postgres', () => {
  const tag = randomBytes(5).toString('hex');
  let db: ReturnType<typeof openDatabase>;
  const who: Record<string, Principal> = {};
  let staffId = '';
  let studentId = '';
  let sessionId = '';
  const alertId = `alr-int-${tag}`;

  beforeAll(async () => {
    run('migrate.js');
    run('seed.js');
    db = openDatabase({ DATABASE_URL: DB_URL });
    const staff = await db.identity.createStudent({
      email: `staff-int-${tag}@example.test`,
      emailVerifiedAt: new Date(),
      name: `Int Staff ${tag}`,
    });
    staffId = (await db.identity.grantRole({ userId: staff.id, role: 'staff', by: 'operator' })).id;
    const student = await db.identity.createStudent({
      email: `student-int-${tag}@example.test`,
      emailVerifiedAt: new Date(),
      name: `Int Student ${tag}`,
    });
    studentId = student.id;
    const session = await db.repos.sessions.create(
      { studentId, teacherId: DEMO.teacher },
      {
        agentId: DEMO.agent,
        agentVersion: 1,
        packageId: DEMO.packageFree,
        packageVersion: 1,
      },
    );
    sessionId = session.id;
    await db.repos.safetyAlerts.record({
      id: alertId,
      level: 'critical',
      kind: 'distress',
      studentId,
      teacherId: DEMO.teacher,
      sessionId,
      excerptRedacted: 'synthetic distress excerpt',
      createdAt: new Date().toISOString(),
    });
    who.staff = { userId: staffId, role: 'staff' };
    who.student = { userId: studentId, role: 'student' };
  }, 120_000);

  afterAll(async () => {
    if (!db) return;
    // Leaves nothing unacknowledged behind.
    await db.repos.safetyAlerts
      .acknowledge(staffId, { alertId, note: 'int test cleanup' })
      .catch(() => undefined);
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
    const h = createStaffAlertHandlers({ repos: () => db.repos, log: () => undefined });
    return { GET: guard.withRole(['staff'], h.list), POST: guard.withRole(['staff'], h.acknowledge) };
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
  // The ack audit entry is written for the alert's teacher *and* student (never the excerpt), so
  // it is a student-scoped row (`audit.listForStudent`), not a teacher-only one.
  const auditRows = async () =>
    (
      await db.repos.audit.listForStudent({ teacherId: DEMO.teacher, studentId }, { limit: 50 })
    ).filter((r) => r.target === `safety_alert:${alertId}`);

  it('signed-out is 401; a student is 403 on GET and POST and changes nothing', async () => {
    const r = routes();
    expect((await r.GET(call('GET', null))).status).toBe(401);
    expect((await r.POST(call('POST', null, { alertId }))).status).toBe(401);
    expect((await r.GET(call('GET', 'student'))).status).toBe(403);
    expect((await r.POST(call('POST', 'student', { alertId }))).status).toBe(403);
    expect(await auditRows()).toEqual([]);
  });

  it('staff see the open alert, not yet escalated or overdue (just raised)', async () => {
    const res = await routes().GET(call('GET', 'staff'));
    expect(res.status).toBe(200);
    const { alerts } = (await res.json()) as {
      alerts: { id: string; overdue: boolean; escalatedAt: string | null; teacherSlug: string | null }[];
    };
    const mine = alerts.find((a) => a.id === alertId);
    expect(mine).toMatchObject({ overdue: false, escalatedAt: null });
  });

  it('staff acknowledge: audited, and the alert leaves the open list', async () => {
    const r = routes();
    const res = await r.POST(call('POST', 'staff', { alertId, note: 'followed up with the student' }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ alertId, acknowledged: true });
    const rows = await auditRows();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      actor: staffId,
      actorRole: 'staff',
      action: 'safety_alert.ack',
      target: `safety_alert:${alertId}`,
      reason: 'followed up with the student',
    });
    const { alerts } = (await (await r.GET(call('GET', 'staff'))).json()) as { alerts: { id: string }[] };
    expect(alerts.map((a) => a.id)).not.toContain(alertId);
  });

  it('a second acknowledge is a no-op and writes no second audit row', async () => {
    const res = await routes().POST(call('POST', 'staff', { alertId }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ alertId, acknowledged: false });
    expect(await auditRows()).toHaveLength(1);
  });

  it('an unknown alert is 404', async () => {
    const res = await routes().POST(call('POST', 'staff', { alertId: `alr-int-${tag}-missing` }));
    expect(res.status).toBe(404);
  });

  it('a former staff user is 403 (role changed after sign-in)', async () => {
    await db.identity.grantRole({ userId: staffId, role: 'student', by: 'operator' });
    const res = await routes().GET(call('GET', 'staff'));
    expect(res.status).toBe(403);
    await db.identity.grantRole({ userId: staffId, role: 'staff', by: 'operator' });
  });
});
