// Task 12.2a on Postgres: a student files a report on an agent or teacher reply in their own
// session (one per student per message, category only); staff list the open queue (no reporter
// id, name or email) and review a report once, audited. See test/pg.ts. All data is synthetic.
import pg from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { migrateDatabase } from '../src/migrate.js';
import { createDb, type DbHandle } from '../src/internal.js';
import {
  createRepositories,
  type ReportCategory,
  type Repositories,
  REPORTS_QUEUE_MAX_LIMIT,
  reportRowId,
  RepositoryError,
} from '../src/index.js';
import { ids, seed, studentId, teacherId } from './isolation-seed.js';
import {
  createDatabase,
  dropDatabase,
  postgresUp,
  SKIP_REASON,
  throwawayName,
  urlFor,
} from './pg.js';

const up = await postgresUp('reports tests');
const dbName = throwawayName();
const TEST_URL = urlFor(dbName);
let handle: DbHandle;
let repos: Repositories;
let raw: pg.Client;

const STAFF = 'stf_rp_1';
const S1A = { studentId: studentId('1'), teacherId: teacherId('A') };
const S2A = { studentId: studentId('2'), teacherId: teacherId('A') };
const S1B = { studentId: studentId('1'), teacherId: teacherId('B') };
/** The seed's agent reply in pair 1A's session, and its student question. */
const AGENT_MSG = 'msg_1a_2';
const STUDENT_MSG = 'msg_1a_1';
const TEACHER_MSG = 'msg_1a_t';

async function failure(p: Promise<unknown>): Promise<{ kind: string; method: string }> {
  const e = await p.then(
    () => new Error('resolved'),
    (x: unknown) => x,
  );
  expect(e).toBeInstanceOf(RepositoryError);
  const { kind, method } = e as RepositoryError;
  return { kind, method };
}

const count = async (table: 'reports' | 'audit_log') =>
  Number((await raw.query<{ n: string }>(`select count(*) as n from ${table}`)).rows[0]?.n);

describe.skipIf(!up)(`reports on Postgres${up ? '' : ` (${SKIP_REASON})`}`, () => {
  beforeAll(async () => {
    await createDatabase(dbName);
    await migrateDatabase(TEST_URL);
    handle = createDb({ DATABASE_URL: TEST_URL });
    await seed(handle.db);
    repos = createRepositories(handle.db);
    raw = new pg.Client({ connectionString: TEST_URL });
    await raw.connect();
    await raw.query(
      `insert into users (id, name, email, locale, market, role) values
       ($1, 'Staff One', 'staff-one@example.test', 'en', 'test', 'staff')`,
      [STAFF],
    );
    await raw.query(
      `insert into messages (id, session_id, role, text, created_at)
       values ($1, $2, 'teacher', '[1A] teacher note', '2026-10-17T10:00:05Z')`,
      [TEACHER_MSG, ids.session('1A')],
    );
    await raw.query(
      `insert into teacher_profiles (id, user_id, slug, subject) values
       ('tp_a', $1, 'teacher-a', 'Maths')`,
      [teacherId('A')],
    );
    // Teacher A's document whose title the agent reply cites, one that it doesn't, and teacher
    // B's document with the same title (never shown on A's report).
    await raw.query(
      `insert into documents (id, teacher_id, module_id, kind, source_title, status) values
       ('doc_rp_a', $1, $2, 'material', '[1A] notes', 'ready'),
       ('doc_rp_a_other', $1, $2, 'material', 'Other notes', 'ready'),
       ('doc_rp_b', $3, $4, 'material', '[1A] notes', 'ready')`,
      [teacherId('A'), ids.module('A', 1), teacherId('B'), ids.module('B', 1)],
    );
  }, 60_000);

  afterAll(async () => {
    await raw?.end();
    await handle?.close();
    await dropDatabase(dbName);
  });

  beforeEach(async () => {
    await raw.query('delete from reports');
    await raw.query('delete from takedowns');
    await raw.query("delete from audit_log where target like 'report:%'");
  });

  describe('file', () => {
    it('files a report on an agent reply in the own session, once', async () => {
      const first = await repos.reports.file(S1A, {
        sessionId: ids.session('1A'),
        messageId: AGENT_MSG,
        category: 'harmful',
      });
      expect(first).toEqual({ id: reportRowId(S1A.studentId, AGENT_MSG), created: true });
      const again = await repos.reports.file(S1A, {
        sessionId: ids.session('1A'),
        messageId: AGENT_MSG,
        category: 'other',
      });
      expect(again).toEqual({ id: first.id, created: false });
      const { rows } = await raw.query(
        'select target, reason, status, reporter_id, staff_actions from reports',
      );
      expect(rows).toEqual([
        {
          target: `message:${AGENT_MSG}`,
          reason: 'harmful',
          status: 'open',
          reporter_id: S1A.studentId,
          staff_actions: [],
        },
      ]);
    });

    it('files on a teacher message too', async () => {
      const r = await repos.reports.file(S1A, {
        sessionId: ids.session('1A'),
        messageId: TEACHER_MSG,
        category: 'inappropriate',
      });
      expect(r.created).toBe(true);
    });

    it('a student message, another pair session or a missing message is not_found, nothing written', async () => {
      const attempts: [typeof S1A, string, string][] = [
        [S1A, ids.session('1A'), STUDENT_MSG],
        // Pair 2A's agent reply, through 2A's session id, by student 1.
        [S1A, ids.session('2A'), 'msg_2a_2'],
        // Pair 2A's reply named with 1A's own session id.
        [S1A, ids.session('1A'), 'msg_2a_2'],
        // Same student, other teacher's scope pointed at 1A's session.
        [S1B, ids.session('1A'), AGENT_MSG],
        // Another student of the same teacher.
        [S2A, ids.session('1A'), AGENT_MSG],
        [S1A, ids.session('1A'), 'msg_missing'],
        [S1A, 'ses_missing', AGENT_MSG],
      ];
      for (const [scope, sessionId, messageId] of attempts) {
        expect(
          await failure(repos.reports.file(scope, { sessionId, messageId, category: 'other' })),
          `${scope.studentId}/${scope.teacherId} ${sessionId} ${messageId}`,
        ).toEqual({ kind: 'not_found', method: 'reports.file' });
      }
      expect(await count('reports')).toBe(0);
    });

    it("a duplicate check never confirms another student's report", async () => {
      await repos.reports.file(S1A, {
        sessionId: ids.session('1A'),
        messageId: AGENT_MSG,
        category: 'harmful',
      });
      expect(
        (
          await failure(
            repos.reports.file(S2A, {
              sessionId: ids.session('1A'),
              messageId: AGENT_MSG,
              category: 'harmful',
            }),
          )
        ).kind,
      ).toBe('not_found');
      expect(await count('reports')).toBe(1);
    });
  });

  describe('listOpenForStaff', () => {
    it('a report reaches staff on the very next read (acceptance), without the reporter', async () => {
      await raw.query(
        `insert into takedowns (id, target, reason, status) values
         ('td_rp_1', 'document:doc_rp_a', 'copyright', 'active'),
         ('td_rp_2', 'document:doc_rp_a_other', 'copyright', 'lifted')`,
      );
      const { id } = await repos.reports.file(S1A, {
        sessionId: ids.session('1A'),
        messageId: AGENT_MSG,
        category: 'wrong_information',
      });
      const rows = await repos.reports.listOpenForStaff(STAFF);
      expect(rows).toHaveLength(1);
      const row = rows[0]!;
      expect(row).toEqual({
        id,
        category: 'wrong_information',
        status: 'open',
        createdAt: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/),
        messageId: AGENT_MSG,
        teacherId: teacherId('A'),
        agentId: ids.agent('A'),
        teacherSlug: 'teacher-a',
        message: {
          role: 'agent',
          text: '[1A] answer',
          sources: [{ title: '[1A] notes', locator: 'p. 1', kind: 'material' }],
          createdAt: '2026-10-17T10:00:02.000Z',
        },
        citedDocuments: [
          { id: 'doc_rp_a', title: '[1A] notes', kind: 'material', takenDown: true },
        ],
      });
      const json = JSON.stringify(rows);
      for (const secret of [
        S1A.studentId,
        '[1] student',
        'Staff One',
        'staff-one@example.test',
        ids.session('1A'),
      ]) {
        expect(json, secret).not.toContain(secret);
      }
    });

    it('a teacher message has no sources and no cited documents; a missing teacher profile is a null slug', async () => {
      await raw.query(
        `insert into messages (id, session_id, role, text, created_at)
         values ('msg_rp_b', $1, 'agent', '[1B] answer', now())`,
        [ids.session('1B')],
      );
      await repos.reports.file(S1A, {
        sessionId: ids.session('1A'),
        messageId: TEACHER_MSG,
        category: 'other',
      });
      await repos.reports.file(S1B, {
        sessionId: ids.session('1B'),
        messageId: 'msg_rp_b',
        category: 'other',
      });
      const rows = await repos.reports.listOpenForStaff(STAFF);
      expect(rows.map((r) => r.messageId)).toEqual([TEACHER_MSG, 'msg_rp_b']);
      expect(rows[0]!.message).toEqual({
        role: 'teacher',
        text: '[1A] teacher note',
        createdAt: '2026-10-17T10:00:05.000Z',
      });
      expect(rows[0]!.citedDocuments).toEqual([]);
      expect(rows[1]!.teacherSlug).toBeNull();
      expect(rows[1]!.teacherId).toBe(teacherId('B'));
    });

    it('lists open reports only, oldest first by (created_at, id), capped', async () => {
      const total = REPORTS_QUEUE_MAX_LIMIT + 5;
      for (let i = 0; i < total; i += 1) {
        await raw.query(
          `insert into reports (id, target, reason, status, created_at)
           values ($1, $2, 'other', $3, $4)`,
          [
            `rp_cap_${String(i).padStart(3, '0')}`,
            `message:${AGENT_MSG}`,
            i === 0 ? 'dismissed' : 'open',
            new Date(Date.UTC(2026, 9, 1, 0, 0, total - i)),
          ],
        );
      }
      // Two at the same instant: id breaks the tie.
      await raw.query(
        `update reports set created_at = '2026-09-01T00:00:00Z' where id in ('rp_cap_010', 'rp_cap_011')`,
      );
      const rows = await repos.reports.listOpenForStaff(STAFF);
      expect(rows).toHaveLength(REPORTS_QUEUE_MAX_LIMIT);
      expect(rows.every((r) => r.status === 'open')).toBe(true);
      expect(rows.slice(0, 3).map((r) => r.id)).toEqual(['rp_cap_010', 'rp_cap_011', 'rp_cap_054']);
      expect(rows.map((r) => r.id)).not.toContain('rp_cap_000');
    });

    it('a report on a missing message reads with message null and no session ids', async () => {
      await raw.query(
        `insert into reports (id, target, reason) values ('rp_orphan', 'message:msg_gone', 'other')`,
      );
      const [row] = await repos.reports.listOpenForStaff(STAFF);
      expect(row).toMatchObject({
        id: 'rp_orphan',
        messageId: 'msg_gone',
        message: null,
        teacherId: null,
        agentId: null,
        teacherSlug: null,
        citedDocuments: [],
      });
    });

    it('a stored row with an unknown category is integrity, never returned', async () => {
      await raw.query(
        `insert into reports (id, target, reason) values ('rp_bad', 'message:${AGENT_MSG}', 'free text')`,
      );
      expect(await failure(repos.reports.listOpenForStaff(STAFF))).toEqual({
        kind: 'integrity',
        method: 'reports.listOpenForStaff',
      });
    });

    it('a non-staff or unknown id is scope', async () => {
      for (const by of [teacherId('A'), studentId('1'), 'stf_ghost']) {
        expect(await failure(repos.reports.listOpenForStaff(by)), by).toEqual({
          kind: 'scope',
          method: 'reports.listOpenForStaff',
        });
      }
    });
  });

  describe('review', () => {
    async function fileOne(category: ReportCategory = 'harmful') {
      return (
        await repos.reports.file(S1A, {
          sessionId: ids.session('1A'),
          messageId: AGENT_MSG,
          category,
        })
      ).id;
    }

    it('staff dismiss a report once, audited; it leaves the queue', async () => {
      const id = await fileOne();
      const audits = await count('audit_log');
      const out = await repos.reports.review(STAFF, id, {
        decision: 'dismissed',
        note: '  not harmful  ',
      });
      expect(out).toEqual({ id, status: 'dismissed' });
      const {
        rows: [row],
      } = await raw.query('select status, staff_actions from reports where id = $1', [id]);
      expect(row.status).toBe('dismissed');
      expect(row.staff_actions).toEqual([
        { actor: STAFF, action: 'dismissed', note: 'not harmful', ts: expect.any(String) },
      ]);
      expect(await count('audit_log')).toBe(audits + 1);
      const {
        rows: [audit],
      } = await raw.query(
        `select actor, actor_role, action, target, teacher_id, student_id, reason, before, after
         from audit_log where target = $1`,
        [`report:${id}`],
      );
      expect(audit).toEqual({
        actor: STAFF,
        actor_role: 'staff',
        action: 'report.review',
        target: `report:${id}`,
        teacher_id: teacherId('A'),
        student_id: null,
        reason: 'not harmful',
        before: { status: 'open' },
        after: { status: 'dismissed' },
      });
      expect(await repos.reports.listOpenForStaff(STAFF)).toEqual([]);
      expect(await failure(repos.reports.review(STAFF, id, { decision: 'actioned' }))).toEqual({
        kind: 'not_found',
        method: 'reports.review',
      });
      expect(await count('audit_log')).toBe(audits + 1);
    });

    it('actioned without a note stores a null note and no audit reason', async () => {
      const id = await fileOne();
      await repos.reports.review(STAFF, id, { decision: 'actioned' });
      const {
        rows: [row],
      } = await raw.query('select status, staff_actions from reports where id = $1', [id]);
      expect(row.status).toBe('actioned');
      expect(row.staff_actions).toEqual([
        { actor: STAFF, action: 'actioned', note: null, ts: expect.any(String) },
      ]);
      const {
        rows: [audit],
      } = await raw.query('select reason from audit_log where target = $1', [`report:${id}`]);
      expect(audit.reason).toBeNull();
    });

    it('a non-staff reviewer is scope and writes nothing; a missing report is not_found', async () => {
      const id = await fileOne();
      const audits = await count('audit_log');
      for (const by of [teacherId('A'), studentId('1'), 'stf_ghost']) {
        expect((await failure(repos.reports.review(by, id, { decision: 'dismissed' }))).kind).toBe(
          'scope',
        );
      }
      expect(
        (await failure(repos.reports.review(STAFF, 'rp_missing', { decision: 'dismissed' }))).kind,
      ).toBe('not_found');
      const {
        rows: [row],
      } = await raw.query('select status, staff_actions from reports where id = $1', [id]);
      expect(row).toEqual({ status: 'open', staff_actions: [] });
      expect(await count('audit_log')).toBe(audits);
    });

    it('a report whose message is gone is integrity and stays open', async () => {
      await raw.query(
        `insert into reports (id, target, reason) values ('rp_orphan2', 'message:msg_gone', 'other')`,
      );
      expect(
        (await failure(repos.reports.review(STAFF, 'rp_orphan2', { decision: 'dismissed' }))).kind,
      ).toBe('integrity');
      const {
        rows: [row],
      } = await raw.query(`select status from reports where id = 'rp_orphan2'`);
      expect(row.status).toBe('open');
    });

    it('two staff reviewing at once: exactly one wins, one audit row', async () => {
      const id = await fileOne();
      const audits = await count('audit_log');
      const results = await Promise.allSettled([
        repos.reports.review(STAFF, id, { decision: 'dismissed' }),
        repos.reports.review(STAFF, id, { decision: 'actioned' }),
      ]);
      expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
      const rejected = results.find((r) => r.status === 'rejected') as PromiseRejectedResult;
      expect((rejected.reason as RepositoryError).kind).toBe('not_found');
      expect(await count('audit_log')).toBe(audits + 1);
    });
  });
});
