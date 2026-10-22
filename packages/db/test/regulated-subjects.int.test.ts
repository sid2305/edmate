// Task 12.4a on Postgres: staff flag an agent's regulated subject and approve it. Only a current
// staff user reads or writes; every change writes one audit row (actorRole staff, before and
// after) in the same transaction; a no-op writes nothing; a subject change clears the approval.
// All data is synthetic. See test/pg.ts.
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { migrateDatabase } from '../src/migrate.js';
import { createDb, type DbHandle } from '../src/internal.js';
import {
  createRepositories,
  REGULATED_LIST_MAX,
  type Repositories,
  RepositoryError,
} from '../src/index.js';
import { ids, seed, teacherId } from './isolation-seed.js';
import {
  createDatabase,
  dropDatabase,
  postgresUp,
  SKIP_REASON,
  throwawayName,
  urlFor,
} from './pg.js';

const up = await postgresUp('regulated subject tests');
const dbName = throwawayName();
const TEST_URL = urlFor(dbName);
let handle: DbHandle;
let second: DbHandle;
let repos: Repositories;
let repos2: Repositories;
let raw: pg.Client;

const STAFF = 'stf_rs_1';
const STAFF_2 = 'stf_rs_2';
const NOT_STAFF = 'stf_rs_3';
const AGENT = ids.agent('A');
const AGENT_B = ids.agent('B');

async function kind(p: Promise<unknown>): Promise<string> {
  const e = await p.then(
    () => null,
    (x: unknown) => x,
  );
  expect(e).toBeInstanceOf(RepositoryError);
  return (e as RepositoryError).kind;
}

const flags = async (id: string) =>
  (
    await raw.query<{
      regulated_subject: string | null;
      regulated_approved_at: Date | null;
      regulated_approved_by: string | null;
    }>(
      `select regulated_subject, regulated_approved_at, regulated_approved_by from agents where id = $1`,
      [id],
    )
  ).rows[0]!;
const audits = async (id: string) =>
  (
    await raw.query<{
      actor: string;
      actor_role: string;
      action: string;
      teacher_id: string;
      student_id: string | null;
      reason: string | null;
      before: Record<string, unknown>;
      after: Record<string, unknown>;
    }>(
      `select actor, actor_role, action, teacher_id, student_id, reason, before, after
         from audit_log where target = $1 order by created_at, id`,
      [`agent:${id}`],
    )
  ).rows;
const reset = (id: string) =>
  raw.query(
    `update agents set regulated_subject = null, regulated_approved_at = null,
       regulated_approved_by = null where id = $1`,
    [id],
  );

describe.skipIf(!up)(`regulatedSubjects on Postgres${up ? '' : ` (${SKIP_REASON})`}`, () => {
  beforeAll(async () => {
    await createDatabase(dbName);
    await migrateDatabase(TEST_URL);
    handle = createDb({ DATABASE_URL: TEST_URL });
    second = createDb({ DATABASE_URL: TEST_URL });
    await seed(handle.db);
    repos = createRepositories(handle.db);
    repos2 = createRepositories(second.db);
    raw = new pg.Client({ connectionString: TEST_URL });
    await raw.connect();
    await raw.query(
      `insert into users (id, name, locale, market, role) values
       ($1, 'Staff One', 'en', 'test', 'staff'), ($2, 'Staff Two', 'en', 'test', 'staff'),
       ($3, 'Not Staff', 'en', 'test', 'teacher')`,
      [STAFF, STAFF_2, NOT_STAFF],
    );
    await raw.query(
      `insert into teacher_profiles (id, user_id, slug, subject) values ('tp_rs_a', $1, 'teacher-a', 'Math')`,
      [teacherId('A')],
    );
  }, 60_000);

  afterAll(async () => {
    await raw?.end();
    await handle?.close();
    await second?.close();
    await dropDatabase(dbName);
  }, 60_000);

  describe('setSubject', () => {
    it('flags an agent and writes one staff audit row with before, after and the note', async () => {
      await reset(AGENT);
      const before = (await audits(AGENT)).length;
      expect(
        await repos.regulatedSubjects.setSubject(STAFF, {
          agentId: AGENT,
          subject: 'health',
          note: '  covers diet advice  ',
        }),
      ).toEqual({ changed: true });
      expect(await flags(AGENT)).toEqual({
        regulated_subject: 'health',
        regulated_approved_at: null,
        regulated_approved_by: null,
      });
      const rows = (await audits(AGENT)).slice(before);
      expect(rows).toEqual([
        {
          actor: STAFF,
          actor_role: 'staff',
          action: 'agent.regulated_flag',
          teacher_id: teacherId('A'),
          student_id: null,
          reason: 'covers diet advice',
          before: { regulatedSubject: null, approvedAt: null, approvedBy: null },
          after: { regulatedSubject: 'health', approvedAt: null, approvedBy: null },
        },
      ]);
    });

    it('the same subject again is a no-op: no audit row, the approval is kept', async () => {
      await repos.regulatedSubjects.setSubject(STAFF, { agentId: AGENT, subject: 'law' });
      await repos.regulatedSubjects.setApproval(STAFF, { agentId: AGENT, approved: true });
      const n = (await audits(AGENT)).length;
      const kept = await flags(AGENT);
      expect(
        await repos.regulatedSubjects.setSubject(STAFF_2, { agentId: AGENT, subject: 'law' }),
      ).toEqual({ changed: false });
      expect(await flags(AGENT)).toEqual(kept);
      expect(kept.regulated_approved_by).toBe(STAFF);
      expect(await audits(AGENT)).toHaveLength(n);
    });

    it('a subject change clears the approval and the audit row records the old approval', async () => {
      await repos.regulatedSubjects.setSubject(STAFF, { agentId: AGENT, subject: 'law' });
      await repos.regulatedSubjects.setApproval(STAFF, { agentId: AGENT, approved: true });
      const approvedAt = (await flags(AGENT)).regulated_approved_at!.toISOString();
      expect(
        await repos.regulatedSubjects.setSubject(STAFF_2, { agentId: AGENT, subject: 'investing' }),
      ).toEqual({ changed: true });
      expect(await flags(AGENT)).toEqual({
        regulated_subject: 'investing',
        regulated_approved_at: null,
        regulated_approved_by: null,
      });
      const last = (await audits(AGENT)).at(-1)!;
      expect(last.actor).toBe(STAFF_2);
      expect(last.reason).toBeNull();
      expect(last.before).toEqual({ regulatedSubject: 'law', approvedAt, approvedBy: STAFF });
      expect(last.after).toEqual({ regulatedSubject: 'investing', approvedAt: null, approvedBy: null });
    });

    it('clearing the subject (null) clears the approval too', async () => {
      await repos.regulatedSubjects.setSubject(STAFF, { agentId: AGENT, subject: 'law' });
      await repos.regulatedSubjects.setApproval(STAFF, { agentId: AGENT, approved: true });
      expect(
        await repos.regulatedSubjects.setSubject(STAFF, { agentId: AGENT, subject: null }),
      ).toEqual({ changed: true });
      expect(await flags(AGENT)).toEqual({
        regulated_subject: null,
        regulated_approved_at: null,
        regulated_approved_by: null,
      });
      expect((await audits(AGENT)).at(-1)!.after).toEqual({
        regulatedSubject: null,
        approvedAt: null,
        approvedBy: null,
      });
    });

    it('a non-staff or unknown caller is scope and writes nothing', async () => {
      await reset(AGENT);
      const n = (await audits(AGENT)).length;
      for (const by of [NOT_STAFF, teacherId('A'), 'stu_1', 'stf_ghost']) {
        expect(
          await kind(repos.regulatedSubjects.setSubject(by, { agentId: AGENT, subject: 'health' })),
        ).toBe('scope');
      }
      expect((await flags(AGENT)).regulated_subject).toBeNull();
      expect(await audits(AGENT)).toHaveLength(n);
    });

    it('an unknown agent is not_found', async () => {
      expect(
        await kind(repos.regulatedSubjects.setSubject(STAFF, { agentId: 'agt_missing', subject: 'law' })),
      ).toBe('not_found');
      expect(await audits('agt_missing')).toHaveLength(0);
    });
  });

  describe('setApproval', () => {
    it('approves a flagged agent, then revokes it, each with one staff audit row', async () => {
      await reset(AGENT);
      await repos.regulatedSubjects.setSubject(STAFF, { agentId: AGENT, subject: 'health' });
      const n = (await audits(AGENT)).length;
      expect(
        await repos.regulatedSubjects.setApproval(STAFF_2, {
          agentId: AGENT,
          approved: true,
          note: 'reviewed the sources',
        }),
      ).toEqual({ changed: true });
      const approved = await flags(AGENT);
      expect(approved.regulated_subject).toBe('health');
      expect(approved.regulated_approved_by).toBe(STAFF_2);
      expect(approved.regulated_approved_at).toBeInstanceOf(Date);
      const at = approved.regulated_approved_at!.toISOString();

      expect(
        await repos.regulatedSubjects.setApproval(STAFF, { agentId: AGENT, approved: false }),
      ).toEqual({ changed: true });
      expect(await flags(AGENT)).toEqual({
        regulated_subject: 'health',
        regulated_approved_at: null,
        regulated_approved_by: null,
      });

      const rows = (await audits(AGENT)).slice(n);
      expect(rows.map((r) => [r.actor, r.actor_role, r.action, r.reason])).toEqual([
        [STAFF_2, 'staff', 'agent.regulated_approval', 'reviewed the sources'],
        [STAFF, 'staff', 'agent.regulated_approval', null],
      ]);
      expect(rows[0]!.before).toEqual({ regulatedSubject: 'health', approvedAt: null, approvedBy: null });
      expect(rows[0]!.after).toEqual({ regulatedSubject: 'health', approvedAt: at, approvedBy: STAFF_2 });
      expect(rows[1]!.before).toEqual({ regulatedSubject: 'health', approvedAt: at, approvedBy: STAFF_2 });
      expect(rows[1]!.after).toEqual({ regulatedSubject: 'health', approvedAt: null, approvedBy: null });
    });

    it('approving twice, or revoking an unapproved agent, is a no-op with no audit row', async () => {
      await reset(AGENT);
      await repos.regulatedSubjects.setSubject(STAFF, { agentId: AGENT, subject: 'law' });
      const n = (await audits(AGENT)).length;
      expect(
        await repos.regulatedSubjects.setApproval(STAFF, { agentId: AGENT, approved: false }),
      ).toEqual({ changed: false });
      await repos.regulatedSubjects.setApproval(STAFF, { agentId: AGENT, approved: true });
      const first = await flags(AGENT);
      expect(
        await repos.regulatedSubjects.setApproval(STAFF_2, { agentId: AGENT, approved: true }),
      ).toEqual({ changed: false });
      expect(await flags(AGENT)).toEqual(first);
      expect(await audits(AGENT)).toHaveLength(n + 1);
    });

    it('approving an unflagged agent is invalid and writes nothing; revoking it is a no-op', async () => {
      await reset(AGENT);
      const n = (await audits(AGENT)).length;
      expect(
        await kind(repos.regulatedSubjects.setApproval(STAFF, { agentId: AGENT, approved: true })),
      ).toBe('invalid');
      expect(
        await repos.regulatedSubjects.setApproval(STAFF, { agentId: AGENT, approved: false }),
      ).toEqual({ changed: false });
      expect(await flags(AGENT)).toEqual({
        regulated_subject: null,
        regulated_approved_at: null,
        regulated_approved_by: null,
      });
      expect(await audits(AGENT)).toHaveLength(n);
    });

    it('a non-staff caller is scope and writes nothing; an unknown agent is not_found', async () => {
      await reset(AGENT);
      await repos.regulatedSubjects.setSubject(STAFF, { agentId: AGENT, subject: 'law' });
      const n = (await audits(AGENT)).length;
      for (const by of [NOT_STAFF, teacherId('A'), 'stf_ghost']) {
        expect(
          await kind(repos.regulatedSubjects.setApproval(by, { agentId: AGENT, approved: true })),
        ).toBe('scope');
      }
      expect((await flags(AGENT)).regulated_approved_at).toBeNull();
      expect(await audits(AGENT)).toHaveLength(n);
      expect(
        await kind(
          repos.regulatedSubjects.setApproval(STAFF, { agentId: 'agt_missing', approved: true }),
        ),
      ).toBe('not_found');
    });

    it('two concurrent approvals change the row once and write one audit row', async () => {
      await reset(AGENT_B);
      await repos.regulatedSubjects.setSubject(STAFF, { agentId: AGENT_B, subject: 'investing' });
      const n = (await audits(AGENT_B)).length;
      const results = await Promise.all([
        repos.regulatedSubjects.setApproval(STAFF, { agentId: AGENT_B, approved: true }),
        repos2.regulatedSubjects.setApproval(STAFF_2, { agentId: AGENT_B, approved: true }),
      ]);
      expect(results.map((r) => r.changed).sort()).toEqual([false, true]);
      expect(await audits(AGENT_B)).toHaveLength(n + 1);
    });

    it('a concurrent subject change and approval serialise on the agent row', async () => {
      await reset(AGENT_B);
      await repos.regulatedSubjects.setSubject(STAFF, { agentId: AGENT_B, subject: 'investing' });
      await Promise.all([
        repos.regulatedSubjects.setSubject(STAFF, { agentId: AGENT_B, subject: 'law' }),
        repos2.regulatedSubjects.setApproval(STAFF_2, { agentId: AGENT_B, approved: true }),
      ]);
      const f = await flags(AGENT_B);
      // Either order is valid; the check constraints hold in both.
      expect(f.regulated_subject).toBe('law');
      expect(f.regulated_approved_at === null).toBe(f.regulated_approved_by === null);
    });
  });

  describe('the check constraints', () => {
    it('reject an unknown subject, an approval without a subject and a half-set approval', async () => {
      await reset(AGENT);
      const bad = [
        [`update agents set regulated_subject = 'medicine' where id = $1`, [AGENT]],
        [
          `update agents set regulated_approved_at = now(), regulated_approved_by = $2 where id = $1`,
          [AGENT, STAFF],
        ],
        [
          `update agents set regulated_subject = 'law', regulated_approved_at = now() where id = $1`,
          [AGENT],
        ],
        [
          `update agents set regulated_subject = 'law', regulated_approved_by = $2 where id = $1`,
          [AGENT, STAFF],
        ],
        [`update agents set regulated_subject = 'law', regulated_approved_at = now(), regulated_approved_by = 'nobody' where id = $1`, [AGENT]],
      ] as const;
      for (const [q, args] of bad) {
        await expect(raw.query(q, [...args])).rejects.toThrow();
      }
      expect((await flags(AGENT)).regulated_subject).toBeNull();
    });
  });

  describe('listForStaff', () => {
    it('lists every agent newest first with ids, slug and flag columns only', async () => {
      await reset(AGENT);
      await repos.regulatedSubjects.setSubject(STAFF, { agentId: AGENT, subject: 'health' });
      await repos.regulatedSubjects.setApproval(STAFF, { agentId: AGENT, approved: true });
      const rows = await repos.regulatedSubjects.listForStaff(STAFF);
      const a = rows.find((r) => r.agentId === AGENT)!;
      const f = await flags(AGENT);
      expect(a).toEqual({
        agentId: AGENT,
        teacherSlug: 'teacher-a',
        status: 'live',
        liveVersion: 1,
        regulatedSubject: 'health',
        approvedAt: f.regulated_approved_at!.toISOString(),
        approvedBy: STAFF,
      });
      const b = rows.find((r) => r.agentId === AGENT_B)!;
      expect(b.teacherSlug).toBeNull();
      const text = JSON.stringify(rows);
      for (const personal of ['Staff One', 'Staff Two', 'Not Staff', '@', 'name', 'email', 'phone']) {
        expect(text).not.toContain(personal);
      }
    });

    it('a non-staff or unknown caller is scope', async () => {
      for (const by of [NOT_STAFF, teacherId('A'), 'stu_1', 'stf_ghost']) {
        expect(await kind(repos.regulatedSubjects.listForStaff(by))).toBe('scope');
      }
    });

    it('orders newest first and caps the list at REGULATED_LIST_MAX', async () => {
      await raw.query(
        `insert into agents (id, teacher_id, status, created_at)
           select 'agt_rs_' || lpad(g::text, 4, '0'), $1, 'draft',
                  timestamptz '2030-01-01' + g * interval '1 minute'
             from generate_series(1, $2::int) g`,
        [teacherId('B'), REGULATED_LIST_MAX + 5],
      );
      const rows = await repos.regulatedSubjects.listForStaff(STAFF);
      expect(rows).toHaveLength(REGULATED_LIST_MAX);
      expect(rows[0]!.agentId).toBe(`agt_rs_${String(REGULATED_LIST_MAX + 5).padStart(4, '0')}`);
      expect(rows[1]!.agentId).toBe(`agt_rs_${String(REGULATED_LIST_MAX + 4).padStart(4, '0')}`);
      expect(rows.every((r) => r.status === 'draft' && r.liveVersion === null)).toBe(true);
    });
  });
});
