// Task 2.5 on a real Postgres 16 + pgvector (see test/pg.ts): the monthly per-teacher cost read
// (`usageLedger.sumForTeacherSince`) and the cost alarm's pause (`subscriptions.pauseFreeForTeacher`).
// Cross-scope isolation of both methods also runs in repositories.int.test.ts (the CASES grid);
// this suite has its own throwaway database and seeds a paid package next to the free one.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import pg from 'pg';
import { migrateDatabase } from '../src/migrate.js';
import { createDb, type DbHandle } from '../src/internal.js';
import * as s from '../src/internal.js';
import {
  COST_ALARM_ACTOR,
  COST_ALARM_PAUSE_ACTION,
  createRepositories,
  RepositoryError,
  type Repositories,
} from '../src/index.js';
import { ids, packageConfig, seed, studentId, teacherId } from './isolation-seed.js';
import {
  createDatabase,
  dropDatabase,
  postgresUp,
  SKIP_REASON,
  throwawayName,
  urlFor,
} from './pg.js';

const up = await postgresUp('cost alarm integration tests');
const dbName = throwawayName();
const TEST_URL = urlFor(dbName);
let handle: DbHandle;
let repos: Repositories;
let raw: pg.Client;

const A = { teacherId: teacherId('A') };
const B = { teacherId: teacherId('B') };
const PV_A_PAID = 'pv_a_paid';
const OCT = '2026-10-01T00:00:00.000Z';
const REASON = 'cost alarm: 2026-10 at or above 50000000 micro-USD';

/** Extra students for teacher A: paid, ended free, trial free, already paused free. */
const EXTRA = {
  paid: 'stu_paid',
  ended: 'stu_ended',
  trial: 'stu_trial',
  paused: 'stu_paused',
} as const;
const sub = (k: keyof typeof EXTRA) => `sub_${k}`;

async function status(id: string): Promise<string> {
  const res = await raw.query<{ status: string }>(
    'select status from subscriptions where id = $1',
    [id],
  );
  return res.rows[0]!.status;
}

async function setStatus(id: string, st: string): Promise<void> {
  await raw.query(`update subscriptions set status = $2 where id = $1`, [id, st]);
}

async function usage(row: {
  teacher: 'A' | 'B';
  student: string;
  source?: 'subscription' | 'teacher_preview' | 'eval';
  status?: 'recorded' | 'unknown' | 'unpriced';
  cost?: number | null;
  tokens?: [number, number] | null;
  at: string;
}): Promise<void> {
  const st = row.status ?? 'recorded';
  const tokens = st === 'unknown' ? null : (row.tokens ?? [10, 20]);
  await raw.query(
    `insert into usage_ledger (id, teacher_id, package_id, student_id, turn_id, source, status,
       reason, model, tier, input_tokens, output_tokens, cost_micro_usd, created_at)
     values (gen_random_uuid()::text, $1, $2, $3, 'turn_ca', $4, $5, $6, $7, 'main', $8, $9, $10, $11)`,
    [
      teacherId(row.teacher),
      ids.pkg(row.teacher),
      row.student,
      row.source ?? 'subscription',
      st,
      st === 'recorded' ? null : st === 'unknown' ? 'no_usage_reported' : 'unpriced_model:m',
      st === 'unknown' ? null : 'm',
      tokens?.[0] ?? null,
      tokens?.[1] ?? null,
      st === 'recorded' ? (row.cost ?? 0) : null,
      row.at,
    ],
  );
}

describe.skipIf(!up)(
  `cost alarm reads and writes on Postgres 16 + pgvector${up ? '' : ` (${SKIP_REASON})`}`,
  () => {
    beforeAll(async () => {
      await createDatabase(dbName);
      await migrateDatabase(TEST_URL);
      handle = createDb({ DATABASE_URL: TEST_URL });
      await seed(handle.db);
      repos = createRepositories(handle.db);
      raw = new pg.Client({ connectionString: TEST_URL });
      await raw.connect();

      await handle.db.insert(s.users).values(
        Object.values(EXTRA).map((id) => ({
          id,
          name: 'synthetic',
          locale: 'en',
          market: 'test',
          role: 'student' as const,
        })),
      );
      const paid = packageConfig('A', 2);
      await handle.db.insert(s.packageVersions).values({
        id: PV_A_PAID,
        teacherId: teacherId('A'),
        packageId: ids.pkg('A'),
        version: 2,
        config: { ...paid, pricePerMonth: { amountMinor: 49_900, currency: 'INR' } },
      });
      const rows: [keyof typeof EXTRA, string, 'active' | 'ended' | 'trial' | 'paused'][] = [
        ['paid', PV_A_PAID, 'active'],
        ['ended', ids.packageVersion('A'), 'ended'],
        ['trial', ids.packageVersion('A'), 'trial'],
        ['paused', ids.packageVersion('A'), 'paused'],
      ];
      await handle.db.insert(s.subscriptions).values(
        rows.map(([k, pv, st]) => ({
          id: sub(k),
          studentId: EXTRA[k],
          teacherId: teacherId('A'),
          packageVersionId: pv,
          status: st,
          periodEnd: new Date('2026-12-01T00:00:00Z'),
        })),
      );
      // Seeded usage rows are stamped now(); move them out of the months under test.
      await raw.query(`update usage_ledger set created_at = '2026-01-15T00:00:00Z'`);
    });

    afterAll(async () => {
      await raw?.end();
      await handle?.close();
      await dropDatabase(dbName);
    });

    describe('usageLedger.sumForTeacherSince', () => {
      it("sums one teacher's non-eval rows since the date, across students, keeping unknown apart", async () => {
        const at = '2026-10-10T12:00:00Z';
        // Teacher A, this month: two students, recorded + unknown + unpriced, preview counts.
        await usage({ teacher: 'A', student: studentId('1'), cost: 1_000_000, at });
        await usage({ teacher: 'A', student: studentId('2'), cost: 2_500_000, at });
        await usage({
          teacher: 'A',
          student: studentId('1'),
          source: 'teacher_preview',
          cost: 500,
          at,
        });
        await usage({ teacher: 'A', student: studentId('1'), status: 'unknown', at });
        await usage({ teacher: 'A', student: studentId('2'), status: 'unknown', at });
        await usage({ teacher: 'A', student: studentId('2'), status: 'unpriced', at });
        // Excluded: eval (billed to Edmate), last month, teacher B.
        await usage({ teacher: 'A', student: studentId('1'), source: 'eval', cost: 9e9, at });
        await usage({
          teacher: 'A',
          student: studentId('1'),
          cost: 7e9,
          at: '2026-09-30T23:59:59Z',
        });
        await usage({ teacher: 'B', student: studentId('1'), cost: 8e9, at });
        // The boundary is inclusive: a row exactly at the month start counts.
        await usage({ teacher: 'A', student: studentId('2'), cost: 1, at: OCT });

        const totals = await repos.usageLedger.sumForTeacherSince(A, OCT);
        expect(totals).toEqual({
          teacherId: teacherId('A'),
          since: OCT,
          calls: 7,
          recorded: 4,
          unknown: 2,
          unpriced: 1,
          costMicroUsd: 3_500_501,
          inputTokens: 50,
          outputTokens: 100,
        });

        const res = await raw.query<{ cost: string; n: string }>(
          `select coalesce(sum(cost_micro_usd), 0)::text as cost, count(*)::text as n
             from usage_ledger
            where teacher_id = $1 and created_at >= $2 and source <> 'eval'`,
          [teacherId('A'), OCT],
        );
        expect(totals.costMicroUsd).toBe(Number(res.rows[0]!.cost));
        expect(totals.calls).toBe(Number(res.rows[0]!.n));

        const b = await repos.usageLedger.sumForTeacherSince(B, OCT);
        expect(b).toMatchObject({ teacherId: teacherId('B'), calls: 1, costMicroUsd: 8e9 });
      });

      it('a teacher with no rows since the date has zero calls and zero unknown', async () => {
        expect(await repos.usageLedger.sumForTeacherSince(A, '2030-01-01T00:00:00Z')).toEqual({
          teacherId: teacherId('A'),
          since: '2030-01-01T00:00:00.000Z',
          calls: 0,
          recorded: 0,
          unknown: 0,
          unpriced: 0,
          costMicroUsd: 0,
          inputTokens: 0,
          outputTokens: 0,
        });
      });

      it.each([
        ['not a date', 'last month'],
        ['a date without time', '2026-10-01'],
        ['a number', 1_790_000_000_000],
        ['undefined', undefined],
      ])('rejects %s as `since` (invalid, before SQL)', async (_l, since) => {
        await expect(repos.usageLedger.sumForTeacherSince(A, since as never)).rejects.toMatchObject(
          { kind: 'invalid' },
        );
      });

      it('rejects a student scope (teacher scope only)', async () => {
        await expect(
          repos.usageLedger.sumForTeacherSince(
            { teacherId: teacherId('A'), studentId: studentId('1') } as never,
            OCT,
          ),
        ).rejects.toBeInstanceOf(RepositoryError);
      });
    });

    describe('subscriptions.pauseFreeForTeacher', () => {
      it("pauses only the teacher's live free subscriptions, audited, and returns them", async () => {
        const paused = await repos.subscriptions.pauseFreeForTeacher(A, {
          monthStart: OCT,
          reason: REASON,
        });
        expect(paused).toEqual([
          {
            subscriptionId: ids.subscription('1A'),
            packageId: ids.pkg('A'),
            previousStatus: 'active',
          },
          {
            subscriptionId: ids.subscription('2A'),
            packageId: ids.pkg('A'),
            previousStatus: 'active',
          },
          { subscriptionId: sub('trial'), packageId: ids.pkg('A'), previousStatus: 'trial' },
        ]);
        // No student id leaves in the result (the event goes to the teacher and staff).
        expect(JSON.stringify(paused)).not.toMatch(/stu_/);

        expect(await status(ids.subscription('1A'))).toBe('paused');
        expect(await status(ids.subscription('2A'))).toBe('paused');
        expect(await status(sub('trial'))).toBe('paused');
        // Paid students keep access; an ended subscription is not resurrected; already paused stays.
        expect(await status(sub('paid'))).toBe('active');
        expect(await status(sub('ended'))).toBe('ended');
        expect(await status(sub('paused'))).toBe('paused');
        // Another teacher's free subscriptions are untouched.
        expect(await status(ids.subscription('1B'))).toBe('active');
        expect(await status(ids.subscription('2B'))).toBe('active');

        const audit = await raw.query<Record<string, unknown>>(
          `select actor, actor_role, action, target, teacher_id, student_id, reason, before, after
             from audit_log where action = $1 order by target`,
          [COST_ALARM_PAUSE_ACTION],
        );
        expect(audit.rows).toEqual([
          {
            actor: COST_ALARM_ACTOR,
            actor_role: 'system',
            action: COST_ALARM_PAUSE_ACTION,
            target: `subscription:${ids.subscription('1A')}`,
            teacher_id: teacherId('A'),
            student_id: studentId('1'),
            reason: REASON,
            before: { status: 'active' },
            after: { status: 'paused' },
          },
          {
            actor: COST_ALARM_ACTOR,
            actor_role: 'system',
            action: COST_ALARM_PAUSE_ACTION,
            target: `subscription:${ids.subscription('2A')}`,
            teacher_id: teacherId('A'),
            student_id: studentId('2'),
            reason: REASON,
            before: { status: 'active' },
            after: { status: 'paused' },
          },
          {
            actor: COST_ALARM_ACTOR,
            actor_role: 'system',
            action: COST_ALARM_PAUSE_ACTION,
            target: `subscription:${sub('trial')}`,
            teacher_id: teacherId('A'),
            student_id: EXTRA.trial,
            reason: REASON,
            before: { status: 'trial' },
            after: { status: 'paused' },
          },
        ]);
        // The student reads their own audit row; the teacher's teacher-only list does not show it.
        const own = await repos.audit.listForStudent(
          { studentId: studentId('1'), teacherId: teacherId('A') },
          { target: `subscription:${ids.subscription('1A')}`, limit: 10 },
        );
        expect(own).toHaveLength(1);
        expect(own[0]).toMatchObject({ actorRole: 'system', actor: COST_ALARM_ACTOR });
      });

      it('a second run in the same month changes nothing, and a staff unpause is not re-paused', async () => {
        expect(
          await repos.subscriptions.pauseFreeForTeacher(A, { monthStart: OCT, reason: REASON }),
        ).toEqual([]);
        // Staff decide to unpause 1A (the override); the alarm keeps off it for the rest of October.
        await setStatus(ids.subscription('1A'), 'active');
        expect(
          await repos.subscriptions.pauseFreeForTeacher(A, { monthStart: OCT, reason: REASON }),
        ).toEqual([]);
        expect(await status(ids.subscription('1A'))).toBe('active');
        const n = await raw.query<{ n: string }>(
          `select count(*)::text as n from audit_log where action = $1`,
          [COST_ALARM_PAUSE_ACTION],
        );
        expect(Number(n.rows[0]!.n)).toBe(3);
      });

      it('the next month, the alarm may pause it again', async () => {
        // Audit rows are stamped now(); a month start in the future means "none this month yet".
        const later = new Date(Date.now() + 60_000).toISOString();
        expect(
          await repos.subscriptions.pauseFreeForTeacher(A, { monthStart: later, reason: REASON }),
        ).toEqual([
          {
            subscriptionId: ids.subscription('1A'),
            packageId: ids.pkg('A'),
            previousStatus: 'active',
          },
        ]);
        expect(await status(ids.subscription('1A'))).toBe('paused');
        expect(await status(sub('paid'))).toBe('active');
      });

      it('two concurrent runs pause each subscription once', async () => {
        await setStatus(ids.subscription('1B'), 'active');
        await setStatus(ids.subscription('2B'), 'active');
        const [x, y] = await Promise.all([
          repos.subscriptions.pauseFreeForTeacher(B, { monthStart: OCT, reason: REASON }),
          repos.subscriptions.pauseFreeForTeacher(B, { monthStart: OCT, reason: REASON }),
        ]);
        expect([...x, ...y].map((p) => p.subscriptionId).sort()).toEqual([
          ids.subscription('1B'),
          ids.subscription('2B'),
        ]);
        const n = await raw.query<{ n: string }>(
          `select count(*)::text as n from audit_log where action = $1 and teacher_id = $2`,
          [COST_ALARM_PAUSE_ACTION, teacherId('B')],
        );
        expect(Number(n.rows[0]!.n)).toBe(2);
      });

      it.each([
        ['a bad month start', { monthStart: 'october', reason: REASON }],
        ['an empty reason', { monthStart: OCT, reason: '' }],
        ['a 501-char reason', { monthStart: OCT, reason: 'x'.repeat(501) }],
        ['an extra key', { monthStart: OCT, reason: REASON, teacherId: teacherId('B') }],
        ['no options', undefined],
      ])('rejects %s (invalid) and writes nothing', async (_l, opts) => {
        const before = await raw.query('select id, status from subscriptions order by id');
        await expect(
          repos.subscriptions.pauseFreeForTeacher(A, opts as never),
        ).rejects.toMatchObject({ kind: 'invalid' });
        expect((await raw.query('select id, status from subscriptions order by id')).rows).toEqual(
          before.rows,
        );
      });
    });
  },
);
