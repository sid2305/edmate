// Task 12.2d end to end over a real Postgres -- the real handlers, the real guard and
// ROUTE_POLICY: a student reports an agent reply through the student route (12.2c), the staff
// reports GET lists it (12.2a); independently, a document takedown through the staff takedowns
// POST (12.2b) removes its chunk from `retrievalIndexFor` search at once, and a lift restores it.
//
// Runs only when TEST_DATABASE_URL is set explicitly (CI sets it for the whole job; locally, point
// it at your own disposable Postgres -- never the dev compose database). Unset, it says so on
// stderr and skips; with CI=true it fails instead. Like `apps/web/app/api/staff/alerts/route.int.
// test.ts`, this never imports `@edmate/db/internal`: it migrates and seeds through the built CLI
// binaries (the same demo teacher, agent and package every other @edmate/db consumer uses), then
// uses only the public repositories and the real route handlers. Every row this test creates uses
// a fresh random tag; the document it creates is deleted again, and the report it files is left
// dismissed, so nothing is left open or discoverable.
import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { openDatabase, retrievalIndexFor } from '@edmate/db';
import { NextRequest } from 'next/server';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createGuard, type CookieReader, type Principal } from '../../../../src/auth/guard';
import { createSessionReportsHandlers } from '../../sessions/[id]/reports/handlers';
import { createStaffTakedownsHandlers } from '../takedowns/handlers';
import { createStaffReportsHandlers } from './handlers';

const DB_URL = process.env.TEST_DATABASE_URL?.trim() ?? '';
const ORIGIN = 'http://localhost:8080';

if (!DB_URL) {
  if (process.env.CI === 'true') {
    throw new Error('CI=true but TEST_DATABASE_URL is not set; the staff reports int test needs Postgres');
  }
  process.stderr.write(
    '[@edmate/web] staff reports/takedowns int test SKIPPED: TEST_DATABASE_URL is not set\n',
  );
}

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, '../../../../../..');
const DB_DIST = resolve(REPO_ROOT, 'packages', 'db', 'dist', 'bin');

/** `packages/db/src/seed.ts`'s own fixed ids (not importable here: that file is internal-only). */
const DEMO = {
  teacher: 'demo-teacher',
  agent: 'demo-agent',
  packageFree: 'demo-package-free',
  module: 'values-variables',
};

function run(script: string): void {
  const result = spawnSync(process.execPath, [resolve(DB_DIST, script)], {
    env: { ...process.env, DATABASE_URL: DB_URL },
    stdio: 'inherit',
  });
  if (result.status !== 0) {
    throw new Error(`staff reports int test: ${script} exited with ${String(result.status)}`);
  }
}

describe.skipIf(!DB_URL)('staff reports and takedowns over a real Postgres', () => {
  const tag = randomBytes(5).toString('hex');
  let db: ReturnType<typeof openDatabase>;
  const who: Record<string, Principal> = {};
  let staffId = '';
  let studentId = '';
  let sessionId = '';
  const docId = `doc-int-${tag}`;
  const messageId = `msg-int-${tag}`;
  const DOC_TEXT = `the gizmoflange${tag} absorbs stray photons in a quiet beaker`;
  let reportId = '';
  let takedownId = '';

  beforeAll(async () => {
    run('migrate.js');
    run('seed.js');
    db = openDatabase({ DATABASE_URL: DB_URL });

    const staff = await db.identity.createStudent({
      email: `staff-int-rp-${tag}@example.test`,
      emailVerifiedAt: new Date(),
      name: `Int Staff ${tag}`,
    });
    staffId = (await db.identity.grantRole({ userId: staff.id, role: 'staff', by: 'operator' })).id;
    const student = await db.identity.createStudent({
      email: `student-int-rp-${tag}@example.test`,
      emailVerifiedAt: new Date(),
      name: `Int Student ${tag}`,
    });
    studentId = student.id;

    const session = await db.repos.sessions.create(
      { studentId, teacherId: DEMO.teacher },
      { agentId: DEMO.agent, agentVersion: 1, packageId: DEMO.packageFree, packageVersion: 1 },
    );
    sessionId = session.id;
    await db.repos.messages.append({ studentId, teacherId: DEMO.teacher }, sessionId, {
      id: messageId,
      role: 'agent',
      text: `Reported reply ${tag}`,
      createdAt: new Date().toISOString(),
    });

    await db.repos.documents.create(
      { teacherId: DEMO.teacher },
      { id: docId, moduleId: DEMO.module, kind: 'material', sourceTitle: `Int notes ${tag}` },
    );
    await db.repos.chunks.insertMany({ teacherId: DEMO.teacher }, docId, [
      { ord: 0, text: DOC_TEXT, locator: 'p1' },
    ]);
    await db.repos.documents.updateStatus({ teacherId: DEMO.teacher }, docId, 'processing');
    await db.repos.documents.updateStatus({ teacherId: DEMO.teacher }, docId, 'ready');

    who.staff = { userId: staffId, role: 'staff' };
    who.student = { userId: studentId, role: 'student' };
  }, 120_000);

  afterAll(async () => {
    if (!db) return;
    // Leaves nothing open, suspended or extra behind.
    if (reportId) {
      await db.repos.reports
        .review(staffId, reportId, { decision: 'dismissed', note: 'int test cleanup' })
        .catch(() => undefined);
    }
    if (takedownId) {
      await db.repos.takedowns.lift(staffId, takedownId, { note: 'int test cleanup' }).catch(() => undefined);
    }
    await db.repos.documents.delete({ teacherId: DEMO.teacher }, docId).catch(() => undefined);
    await db.close();
  });

  function guard() {
    return createGuard(
      () => ({
        getPrincipal: async (c: CookieReader) => who[c.get('who')?.value ?? ''] ?? null,
        learnerStatus: async () => 'clear',
        allowedOrigin: ORIGIN,
      }),
      () => {
        throw new Error('not a page');
      },
    );
  }

  function studentRoutes() {
    const g = guard();
    const h = createSessionReportsHandlers({
      agents: db.repos.agents,
      repos: () => db.repos,
      log: { error: () => undefined },
    });
    return { POST: g.withRole(['student'], h.file) };
  }

  function staffReportsRoutes() {
    const g = guard();
    const h = createStaffReportsHandlers({ repos: () => db.repos, log: () => undefined });
    return { GET: g.withRole(['staff'], h.list), POST: g.withRole(['staff'], h.review) };
  }

  function staffTakedownsRoutes() {
    const g = guard();
    const h = createStaffTakedownsHandlers({ repos: () => db.repos, log: () => undefined });
    return { GET: g.withRole(['staff'], h.list), POST: g.withRole(['staff'], h.act) };
  }

  const postAs = (path: string, who2: string, body: unknown) =>
    new NextRequest(`${ORIGIN}${path}`, {
      method: 'POST',
      headers: { cookie: `who=${who2}`, origin: ORIGIN, 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
  const getAs = (path: string, who2: string) =>
    new NextRequest(`${ORIGIN}${path}`, { method: 'GET', headers: { cookie: `who=${who2}` } });

  it('a student files a report, and the staff GET lists it on the very next read', async () => {
    const student = studentRoutes();
    const res = await student.POST(
      postAs(`/api/sessions/${sessionId}/reports`, 'student', {
        agentId: DEMO.agent,
        messageId,
        category: 'harmful',
      }),
      { params: Promise.resolve({ id: sessionId }) },
    );
    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({ ok: true });

    const staff = staffReportsRoutes();
    const listed = await staff.GET(getAs('/api/staff/reports', 'staff'));
    expect(listed.status).toBe(200);
    const { reports } = (await listed.json()) as {
      reports: { id: string; messageId: string; status: string }[];
    };
    const mine = reports.find((r) => r.messageId === messageId);
    expect(mine).toBeDefined();
    expect(mine?.status).toBe('open');
    reportId = mine!.id;

    // No reporter id, student name, email or session id anywhere in the staff payload.
    const text = JSON.stringify(reports);
    expect(text).not.toContain(studentId);
    expect(text).not.toContain(sessionId);
    expect(text).not.toContain('@example.test');
  });

  it('staff dismiss the report; it leaves the open queue', async () => {
    const staff = staffReportsRoutes();
    const res = await staff.POST(postAs('/api/staff/reports', 'staff', { reportId, decision: 'dismissed' }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ id: reportId, status: 'dismissed' });
    const listed = (await (await staff.GET(getAs('/api/staff/reports', 'staff'))).json()) as {
      reports: { id: string }[];
    };
    expect(listed.reports.map((r) => r.id)).not.toContain(reportId);
    reportId = ''; // already closed: afterAll's cleanup has nothing left to do
  });

  it('the document is found by search before a takedown', async () => {
    const index = retrievalIndexFor(db.repos);
    const hits = await index.search(`gizmoflange${tag}`, {
      teacherId: DEMO.teacher,
      allowedModuleIds: [DEMO.module],
    }, 5);
    expect(hits.map((c) => c.documentId)).toContain(docId);
  });

  it('a document takedown through the staff POST removes it from search at once; a lift restores it', async () => {
    const staff = staffTakedownsRoutes();
    const created = await staff.POST(
      postAs('/api/staff/takedowns', 'staff', {
        action: 'create',
        kind: 'document',
        targetId: docId,
        category: 'copyright',
      }),
    );
    expect(created.status).toBe(200);
    const { id } = (await created.json()) as { id: string };
    takedownId = id;

    const index = retrievalIndexFor(db.repos);
    const scope = { teacherId: DEMO.teacher, allowedModuleIds: [DEMO.module] };
    const gone = await index.search(`gizmoflange${tag}`, scope, 5);
    expect(gone.map((c) => c.documentId)).not.toContain(docId);

    const active = (await (await staff.GET(getAs('/api/staff/takedowns', 'staff'))).json()) as {
      takedowns: { id: string; targetId: string }[];
    };
    expect(active.takedowns.map((t) => t.id)).toContain(takedownId);

    const lifted = await staff.POST(postAs('/api/staff/takedowns', 'staff', { action: 'lift', takedownId }));
    expect(lifted.status).toBe(200);
    expect(await lifted.json()).toEqual({ id: takedownId, status: 'lifted' });
    takedownId = ''; // already lifted: afterAll's cleanup has nothing left to do

    const back = await index.search(`gizmoflange${tag}`, scope, 5);
    expect(back.map((c) => c.documentId)).toContain(docId);
  });

  it('a non-staff user is 403 on both staff GETs, and 401 signed out', async () => {
    const reportsRoutes = staffReportsRoutes();
    const takedownsRoutes = staffTakedownsRoutes();
    expect((await reportsRoutes.GET(getAs('/api/staff/reports', 'student'))).status).toBe(403);
    expect((await takedownsRoutes.GET(getAs('/api/staff/takedowns', 'student'))).status).toBe(403);
    expect(
      (await reportsRoutes.GET(new NextRequest(`${ORIGIN}/api/staff/reports`, { method: 'GET' }))).status,
    ).toBe(401);
  });
});
