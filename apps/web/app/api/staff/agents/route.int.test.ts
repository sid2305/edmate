// Task 12.4c: the staff regulated-subject API end to end over a real Postgres -- the real handlers,
// the real guard and ROUTE_POLICY, and 12.4a's real repository. It proves the staff side of the
// acceptance: staff flag and approve an agent, the flag and approval are stored on the agent and
// audited (`agent.regulated_flag` / `agent.regulated_approval`), and a teacher can do neither.
// The publish refusal itself (12.4b) is asserted in 12.4d's int test, once 12.4b has merged.
//
// Runs only when TEST_DATABASE_URL is set explicitly (CI sets it for the whole job; locally, point
// it at your own disposable Postgres -- never the dev compose database). Unset, it says so on
// stderr and skips; with CI=true it fails instead. Every row it writes uses fresh random ids and
// emails, and the agent ends unflagged, so nothing it leaves behind is flagged or approved.
import { randomBytes } from 'node:crypto';
import { demoAgentConfig, demoPackageFree } from '@edmate/contracts/fixtures';
import { migrateDatabase, openDatabase, type RegulatedAgentRow } from '@edmate/db';
import { NextRequest } from 'next/server';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createGuard, type CookieReader, type Principal } from '../../../../src/auth/guard';
import { createStaffAgentHandlers } from './handlers';

const DB_URL = process.env.TEST_DATABASE_URL?.trim() ?? '';
const ORIGIN = 'http://localhost:8080';
const PATH = '/api/staff/agents';

if (!DB_URL) {
  if (process.env.CI === 'true') {
    throw new Error('CI=true but TEST_DATABASE_URL is not set; the staff int test needs Postgres');
  }
  process.stderr.write('[@edmate/web] staff agents int test SKIPPED: TEST_DATABASE_URL is not set\n');
}

describe.skipIf(!DB_URL)('staff regulated-subject flag over a real Postgres', () => {
  const tag = randomBytes(5).toString('hex');
  let db: ReturnType<typeof openDatabase>;
  const who: Record<string, Principal> = {};
  let staffId = '';
  let teacherId = '';
  let agentId = '';
  let courseId = '';
  let styleCardId = '';

  async function user(name: string, role: 'staff' | 'teacher'): Promise<string> {
    const created = await db.identity.createStudent({
      email: `staff-agents-int-${tag}-${name}@example.test`,
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
    teacherId = await user('asha', 'teacher');
    await db.repos.teacherProfiles.create(
      { teacherId },
      { slug: `asha-${tag}`, displayName: 'Asha', subject: 'Math' },
    );
    await db.repos.teacherProfiles.setVerification(
      { teacherId },
      { status: 'verified', by: staffId, reason: 'int test setup' },
    );
    const course = await db.repos.courses.ensureDefault({ teacherId });
    const card = await db.repos.styleCards.create({ teacherId }, { text: '[int] card', mistakeTags: [] });
    courseId = course.id;
    styleCardId = card.id;
    ({ agentId } = await db.repos.agents.ensureDraft(
      { teacherId },
      {
        courseId: course.id,
        styleCardId: card.id,
        promptPackVersion: demoAgentConfig.promptPackVersion,
        modelPolicy: demoAgentConfig.modelPolicy,
      },
    ));
    const outline = await db.repos.outline.getOutline({ teacherId });
    const moduleId = outline!.modules[0]!.id;
    await db.repos.packages.create(
      { teacherId },
      {
        agentId,
        draft: {
          name: 'Int package',
          moduleIds: [moduleId],
          skills: demoPackageFree.skills,
          helpCeiling: demoPackageFree.helpCeiling,
          finalAnswers: demoPackageFree.finalAnswers,
          dailyMessageLimit: demoPackageFree.dailyMessageLimit,
          liveClassesPerMonth: demoPackageFree.liveClassesPerMonth,
          pricePerMonth: demoPackageFree.pricePerMonth,
          lockedReply: demoPackageFree.lockedReply,
        },
      },
    );
    who.staff = { userId: staffId, role: 'staff' };
    who.teacher = { userId: teacherId, role: 'teacher' };
  }, 120_000);

  afterAll(async () => {
    if (!db) return;
    // Leave the agent unflagged (the database may be shared with the e2e run).
    if (agentId) {
      await db.repos.regulatedSubjects
        .setSubject(staffId, { agentId, subject: null, note: 'int test cleanup' })
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
    const h = createStaffAgentHandlers({ repos: () => db.repos, log: () => undefined });
    return { GET: guard.withRole(['staff'], h.list), POST: guard.withRole(['staff'], h.update) };
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
  const mine = async (): Promise<RegulatedAgentRow | undefined> => {
    const res = await routes().GET(call('GET', 'staff'));
    expect(res.status).toBe(200);
    const { agents } = (await res.json()) as { agents: RegulatedAgentRow[] };
    return agents.find((a) => a.agentId === agentId);
  };
  const flagRows = async () =>
    (await db.repos.audit.listForTeacher({ teacherId }, { limit: 20 })).filter((r) =>
      r.action.startsWith('agent.regulated_'),
    );

  it('signed-out is 401; a teacher is 403 on GET and POST and changes nothing', async () => {
    const r = routes();
    const flag = { action: 'subject', agentId, subject: 'health' };
    expect((await r.GET(call('GET', null))).status).toBe(401);
    expect((await r.POST(call('POST', null, flag))).status).toBe(401);
    expect((await r.GET(call('GET', 'teacher'))).status).toBe(403);
    expect((await r.POST(call('POST', 'teacher', flag))).status).toBe(403);
    expect(
      (await r.POST(call('POST', 'teacher', { action: 'approval', agentId, approved: true }))).status,
    ).toBe(403);
    expect(await flagRows()).toEqual([]);
    expect(await mine()).toMatchObject({ regulatedSubject: null, approvedAt: null });
  });

  it('staff see the new agent with its public slug and no personal columns', async () => {
    const row = await mine();
    expect(row).toEqual({
      agentId,
      teacherSlug: `asha-${tag}`,
      status: 'draft',
      liveVersion: null,
      regulatedSubject: null,
      approvedAt: null,
      approvedBy: null,
    });
  });

  it('approving an unflagged agent is 400 and writes nothing', async () => {
    const res = await routes().POST(call('POST', 'staff', { action: 'approval', agentId, approved: true }));
    expect(res.status).toBe(400);
    expect(await flagRows()).toEqual([]);
  });

  it('a body `by` is 400 and writes nothing', async () => {
    const res = await routes().POST(
      call('POST', 'staff', { action: 'subject', agentId, subject: 'health', by: teacherId }),
    );
    expect(res.status).toBe(400);
    expect(await flagRows()).toEqual([]);
  });

  it('staff flag the agent: stored unapproved, audited with the note', async () => {
    const res = await routes().POST(
      call('POST', 'staff', { action: 'subject', agentId, subject: 'health', note: ' covers symptoms ' }),
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ agentId, changed: true });
    expect(await mine()).toMatchObject({ regulatedSubject: 'health', approvedAt: null, approvedBy: null });
    const rows = await flagRows();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      actor: staffId,
      actorRole: 'staff',
      action: 'agent.regulated_flag',
      target: `agent:${agentId}`,
      reason: 'covers symptoms',
    });
  });

  it('staff approve: stored with the session staff id, audited; again is a no-op', async () => {
    const r = routes();
    const res = await r.POST(call('POST', 'staff', { action: 'approval', agentId, approved: true }));
    expect(await res.json()).toEqual({ agentId, changed: true });
    const row = await mine();
    expect(row).toMatchObject({ regulatedSubject: 'health', approvedBy: staffId });
    expect(row?.approvedAt).toEqual(expect.any(String));
    const again = await r.POST(call('POST', 'staff', { action: 'approval', agentId, approved: true }));
    expect(await again.json()).toEqual({ agentId, changed: false });
    expect((await flagRows()).map((x) => x.action).sort()).toEqual([
      'agent.regulated_approval',
      'agent.regulated_flag',
    ]);
  });

  it('changing the subject clears the approval', async () => {
    const res = await routes().POST(call('POST', 'staff', { action: 'subject', agentId, subject: 'law' }));
    expect(res.status).toBe(200);
    expect(await mine()).toMatchObject({ regulatedSubject: 'law', approvedAt: null, approvedBy: null });
    expect(await flagRows()).toHaveLength(3);
  });

  it('a flagged, unapproved agent refuses publish.startRun; approving lets it start (12.4b)', async () => {
    const pins = {
      agentId,
      courseId,
      styleCardId,
      promptPackVersion: demoAgentConfig.promptPackVersion,
      modelPolicy: demoAgentConfig.modelPolicy,
      judgeModel: 'judge-test',
    };
    // Flagged above (subject: 'law'), still unapproved at this point.
    await expect(db.repos.publish.startRun({ teacherId }, pins)).rejects.toMatchObject({
      kind: 'invalid',
      reason: 'regulated_unapproved',
    });
    const res = await routes().POST(call('POST', 'staff', { action: 'approval', agentId, approved: true }));
    expect(res.status).toBe(200);
    const run = await db.repos.publish.startRun({ teacherId }, pins);
    expect(run.id).toEqual(expect.any(String));
  });
});
