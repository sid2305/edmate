// Task 2.4 on a real Postgres 16 + pgvector (see test/pg.ts): one usage row per call, unknown and
// unpriced calls never stored as free, cost per turn and per student computed from the rows, and
// no request text in what is written. Cross-scope isolation of every usageLedger method runs in
// repositories.int.test.ts (the shared CASES grid); this suite has its own throwaway database.
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { Entitlement } from '@edmate/contracts';
import pg from 'pg';
import { migrateDatabase } from '../src/migrate.js';
import { createDb, type DbHandle } from '../src/internal.js';
import {
  createRepositories,
  RepositoryError,
  type Repositories,
  type StudentScope,
  type UsageRow,
  usageMeterFor,
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

const up = await postgresUp('usage ledger integration tests');
const dbName = throwawayName();
const TEST_URL = urlFor(dbName);
let handle: DbHandle;
let repos: Repositories;
let raw: pg.Client;

const S1A: StudentScope = { studentId: studentId('1'), teacherId: teacherId('A') };
const S2A: StudentScope = { studentId: studentId('2'), teacherId: teacherId('A') };
const PKG_A = ids.pkg('A');
const PKG_B = ids.pkg('B');

let n = 0;
const turn = () => `turn_ul_${++n}`;

/** Per-pair totals straight from the table, to check sumForStudent against. */
async function rawTotals(sc: StudentScope) {
  const res = await raw.query<Record<string, string>>(
    `select count(*)::text as calls,
            count(*) filter (where status = 'recorded')::text as recorded,
            count(*) filter (where status = 'unknown')::text as unknown,
            count(*) filter (where status = 'unpriced')::text as unpriced,
            coalesce(sum(cost_micro_usd) filter (where status = 'recorded'), 0)::text as cost,
            coalesce(sum(input_tokens) filter (where status <> 'unknown'), 0)::text as input,
            coalesce(sum(output_tokens) filter (where status <> 'unknown'), 0)::text as output
       from usage_ledger where teacher_id = $1 and student_id = $2`,
    [sc.teacherId, sc.studentId],
  );
  const r = res.rows[0]!;
  return {
    ...sc,
    calls: Number(r.calls),
    recorded: Number(r.recorded),
    unknown: Number(r.unknown),
    unpriced: Number(r.unpriced),
    costMicroUsd: Number(r.cost),
    inputTokens: Number(r.input),
    outputTokens: Number(r.output),
  };
}

async function rowCount(): Promise<number> {
  const res = await raw.query<{ n: string }>('select count(*)::text as n from usage_ledger');
  return Number(res.rows[0]?.n);
}

describe.skipIf(!up)(
  `usage ledger on Postgres 16 + pgvector${up ? '' : ` (${SKIP_REASON})`}`,
  () => {
    beforeAll(async () => {
      await createDatabase(dbName);
      await migrateDatabase(TEST_URL);
      handle = createDb({ DATABASE_URL: TEST_URL });
      await seed(handle.db);
      repos = createRepositories(handle.db);
      raw = new pg.Client({ connectionString: TEST_URL });
      await raw.connect();
    });

    afterAll(async () => {
      await raw?.end();
      await handle?.close();
      await dropDatabase(dbName);
    });

    it('cost per turn and per active student are computed from the rows', async () => {
      const before = await repos.usageLedger.sumForStudent(S1A);
      const t = turn();
      const base = { turnId: t, source: 'subscription' } as const;
      // A turn whose first attempt was cut short (its spent tokens still metered), a retry, an
      // intent call with no usage reported and a call on an unpriced model.
      await repos.usageLedger.record(S1A, PKG_A, {
        ...base,
        usage: {
          model: 'priced',
          tier: 'main',
          inputTokens: 10,
          outputTokens: 20,
          costMicroUsd: 330,
        },
      });
      await repos.usageLedger.record(S1A, PKG_A, {
        ...base,
        usage: {
          model: 'priced',
          tier: 'main',
          inputTokens: 1_000,
          outputTokens: 2_000,
          costMicroUsd: 33_000,
        },
      });
      await repos.usageLedger.recordUnmetered(S1A, PKG_A, {
        ...base,
        tier: 'small',
        reason: 'no_usage_reported',
      });
      await repos.usageLedger.recordUnmetered(S1A, PKG_A, {
        ...base,
        tier: 'small',
        reason: 'unpriced_model:mystery',
        model: 'mystery',
        tokens: { inputTokens: 7, outputTokens: 9 },
      });

      const rows = await repos.usageLedger.listForTurn(S1A, t);
      expect(rows).toHaveLength(4);
      const costPerTurn = rows.reduce((s, r) => s + (r.costMicroUsd ?? 0), 0);
      expect(costPerTurn).toBe(33_330);
      expect(rows.map((r) => r.status).sort()).toEqual([
        'recorded',
        'recorded',
        'unknown',
        'unpriced',
      ]);
      for (const r of rows) {
        expect(r).toMatchObject({ ...S1A, packageId: PKG_A, turnId: t, source: 'subscription' });
        expect(r.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
      }

      const after = await repos.usageLedger.sumForStudent(S1A);
      expect({
        calls: after.calls - before.calls,
        recorded: after.recorded - before.recorded,
        unknown: after.unknown - before.unknown,
        unpriced: after.unpriced - before.unpriced,
        costMicroUsd: after.costMicroUsd - before.costMicroUsd,
        inputTokens: after.inputTokens - before.inputTokens,
        outputTokens: after.outputTokens - before.outputTokens,
      }).toEqual({
        calls: 4,
        recorded: 2,
        unknown: 1,
        unpriced: 1,
        costMicroUsd: 33_330,
        inputTokens: 1_017,
        outputTokens: 2_029,
      });
      expect(after).toEqual(await rawTotals(S1A));
      // Student 2 with the same teacher is unaffected.
      expect(await repos.usageLedger.sumForStudent(S2A)).toEqual(await rawTotals(S2A));
    });

    it('unknown usage reads back as null figures, never zero; unpriced keeps its tokens', async () => {
      const t = turn();
      await repos.usageLedger.recordUnmetered(S2A, PKG_A, {
        turnId: t,
        source: 'teacher_preview',
        tier: 'main',
        reason: 'no_usage_reported',
      });
      await repos.usageLedger.recordUnmetered(S2A, PKG_A, {
        turnId: t,
        source: 'teacher_preview',
        tier: 'small',
        reason: 'unpriced_model:x',
        model: 'x',
        tokens: { inputTokens: 5, outputTokens: 6 },
      });
      // An attempt that reached a known model but reported no usage keeps the model.
      await repos.usageLedger.recordUnmetered(S2A, PKG_A, {
        turnId: t,
        source: 'teacher_preview',
        tier: 'main',
        reason: 'no_usage_reported',
        model: 'attempted-model',
      });
      const rows = await repos.usageLedger.listForTurn(S2A, t);
      const unknown = rows.find((r) => r.status === 'unknown' && r.model === null) as UsageRow;
      const unpriced = rows.find((r) => r.status === 'unpriced') as UsageRow;
      expect(rows.find((r) => r.model === 'attempted-model')).toMatchObject({
        status: 'unknown',
        inputTokens: null,
        costMicroUsd: null,
      });
      // Stored as NULL, so a raw query can't read these calls as free.
      const stored = await raw.query<{ status: string; input: number | null; cost: string | null }>(
        `select status, input_tokens as input, cost_micro_usd as cost from usage_ledger
          where turn_id = $1 and status <> 'recorded'`,
        [t],
      );
      expect(stored.rows).toHaveLength(3);
      for (const r of stored.rows) expect(r.cost, r.status).toBeNull();
      expect(stored.rows.filter((r) => r.input === null)).toHaveLength(2);
      expect(unknown).toMatchObject({
        reason: 'no_usage_reported',
        model: null,
        tier: 'main',
        inputTokens: null,
        outputTokens: null,
        costMicroUsd: null,
      });
      expect(unpriced).toMatchObject({
        reason: 'unpriced_model:x',
        model: 'x',
        tier: 'small',
        inputTokens: 5,
        outputTokens: 6,
        costMicroUsd: null,
      });
    });

    it.each<Entitlement['source']>(['subscription', 'teacher_preview', 'eval'])(
      'stores source %s unchanged',
      async (source) => {
        const t = turn();
        await repos.usageLedger.record(S1A, PKG_A, {
          turnId: t,
          source,
          usage: {
            model: 'priced',
            tier: 'small',
            inputTokens: 1,
            outputTokens: 1,
            costMicroUsd: 1,
          },
        });
        const [row] = await repos.usageLedger.listForTurn(S1A, t);
        expect(row?.source).toBe(source);
      },
    );

    it("another teacher's package, or a student who is not a user, is not_found and writes nothing", async () => {
      const count = await rowCount();
      const usage = {
        model: 'priced',
        tier: 'main',
        inputTokens: 1,
        outputTokens: 1,
        costMicroUsd: 1,
      } as const;
      await expect(
        repos.usageLedger.record(S1A, PKG_B, { turnId: turn(), source: 'subscription', usage }),
      ).rejects.toMatchObject({ kind: 'not_found', method: 'usageLedger.record' });
      await expect(
        repos.usageLedger.recordUnmetered(S1A, PKG_B, {
          turnId: turn(),
          source: 'subscription',
          tier: 'main',
          reason: 'no_usage_reported',
        }),
      ).rejects.toMatchObject({ kind: 'not_found', method: 'usageLedger.recordUnmetered' });
      await expect(
        repos.usageLedger.record({ studentId: 'stu_ghost', teacherId: teacherId('A') }, PKG_A, {
          turnId: turn(),
          source: 'subscription',
          usage,
        }),
      ).rejects.toMatchObject({ kind: 'not_found' });
      expect(await rowCount()).toBe(count);
    });

    it('the database rejects a recorded row with a missing figure, and negative counts', async () => {
      type Figures = [
        model: string | null,
        input: number | null,
        output: number | null,
        cost: number | null,
      ];
      const insert = (status: string, [model, input, output, cost]: Figures) =>
        raw.query(
          `insert into usage_ledger (id, teacher_id, package_id, student_id, model, tier,
             input_tokens, output_tokens, cost_micro_usd, turn_id, source, status)
           values ($1, 'tch_a', 'pkg_a', 'stu_1', $2, 'main', $3, $4, $5, 'turn_x', 'subscription', $6)`,
          [`ul_bad_${++n}`, model, input, output, cost, status],
        );
      const violations: [string, Figures][] = [
        ['recorded', [null, 1, 1, 1]],
        ['recorded', ['m', null, 1, 1]],
        ['recorded', ['m', 1, null, 1]],
        ['recorded', ['m', 1, 1, null]],
        ['recorded', ['m', -1, 1, 1]],
        ['unpriced', ['m', 1, -1, null]],
        ['recorded', ['m', 1, 1, -1]],
      ];
      for (const [status, f] of violations) {
        await expect(insert(status, f), `${status} ${f.join(',')}`).rejects.toMatchObject({
          code: '23514',
        });
      }
      await expect(insert('recorded', ['m', 1, 1, 1])).resolves.toBeDefined();
      await expect(insert('unknown', [null, null, null, null])).resolves.toBeDefined();
      await expect(insert('unpriced', ['m', 1, 1, null])).resolves.toBeDefined();
    });

    it('writes carry only ids, the model, tier, counts and a reason code: no request text', async () => {
      const spy = vi.spyOn(pg.Client.prototype, 'query');
      try {
        const meter = usageMeterFor(repos, S1A);
        const ctx = {
          ...S1A,
          packageId: PKG_A,
          turnId: 'turn_privacy',
          source: 'subscription' as const,
        };
        await meter.record(
          { model: 'priced', tier: 'main', inputTokens: 1, outputTokens: 2, costMicroUsd: 3 },
          ctx,
        );
        await meter.recordUnmetered({ ...ctx, tier: 'small', reason: 'no_usage_reported' });
        await meter.recordUnmetered({
          ...ctx,
          tier: 'small',
          reason: 'unpriced_model:mystery',
          model: 'mystery',
          tokens: { inputTokens: 4, outputTokens: 5 },
        });
        const allowed = new Set<unknown>([
          S1A.studentId,
          S1A.teacherId,
          PKG_A,
          'turn_privacy',
          'subscription',
          'priced',
          'main',
          'small',
          'mystery',
          'unpriced_model:mystery',
          'no_usage_reported',
          null,
          1,
          2,
          3,
          4,
          5,
        ]);
        const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
        const params = spy.mock.calls
          .filter((_, i) => spy.mock.contexts[i] !== raw)
          .flatMap(([q, values]) => [
            ...((values as unknown[] | undefined) ?? []),
            ...((q as { values?: unknown[] }).values ?? []),
          ]);
        expect(params.length).toBeGreaterThan(0);
        for (const p of params) {
          expect(allowed.has(p) || (typeof p === 'string' && uuid.test(p)), String(p)).toBe(true);
        }
        expect(await repos.usageLedger.listForTurn(S1A, 'turn_privacy')).toHaveLength(3);
      } finally {
        spy.mockRestore();
      }
    });

    it('usageMeterFor refuses a context naming another pair, and writes nothing', async () => {
      const meter = usageMeterFor(repos, S1A);
      const count = await rowCount();
      const ctx = { ...S2A, packageId: PKG_A, turnId: turn(), source: 'subscription' as const };
      const usage = {
        model: 'priced',
        tier: 'main',
        inputTokens: 1,
        outputTokens: 1,
        costMicroUsd: 1,
      } as const;
      await expect(meter.record(usage, ctx)).rejects.toMatchObject({
        kind: 'scope',
        method: 'usageMeterFor.record',
      });
      await expect(
        meter.recordUnmetered({
          ...ctx,
          teacherId: teacherId('B'),
          studentId: S1A.studentId,
          tier: 'main',
          reason: 'no_usage_reported',
        }),
      ).rejects.toBeInstanceOf(RepositoryError);
      expect(await rowCount()).toBe(count);
    });

    it('a stored row that breaks the contract throws integrity, not data', async () => {
      // The checks keep figures consistent, but a turn id outside the contract format is caught on read.
      await raw.query(
        `insert into usage_ledger (id, teacher_id, package_id, student_id, model, tier,
           input_tokens, output_tokens, cost_micro_usd, turn_id, source)
         values ('ul_corrupt', 'tch_b', 'pkg_b', 'stu_2', 'm', 'main', 1, 1, 1, 'turn corrupt!', 'eval')`,
      );
      await expect(
        repos.usageLedger.listForTurn({ studentId: 'stu_2', teacherId: 'tch_b' }, 'turn corrupt!'),
      ).rejects.toMatchObject({ kind: 'invalid' });
      await raw.query(`update usage_ledger set turn_id = 'turn_corrupt' where id = 'ul_corrupt'`);
      await raw.query(`update usage_ledger set id = 'bad id!' where id = 'ul_corrupt'`);
      await expect(
        repos.usageLedger.listForTurn({ studentId: 'stu_2', teacherId: 'tch_b' }, 'turn_corrupt'),
      ).rejects.toMatchObject({ kind: 'integrity', method: 'usageLedger.listForTurn' });

      // Figures that disagree with the status (possible only by hand): never returned as either.
      const bad: [string, string, string | null, number | null, number | null][] = [
        ['ul_odd_1', 'unknown', 'no_usage_reported', 3, null], // unknown with tokens
        ['ul_odd_2', 'unpriced', 'unpriced_model:m', null, null], // unpriced without tokens
        ['ul_odd_3', 'recorded', 'no_usage_reported', 1, 1], // recorded with a reason
      ];
      for (const [id, status, reason, tokens, cost] of bad) {
        const turnId = `turn_${id}`;
        await raw.query(
          `insert into usage_ledger (id, teacher_id, package_id, student_id, model, tier,
             input_tokens, output_tokens, cost_micro_usd, turn_id, source, status, reason)
           values ($1, 'tch_b', 'pkg_b', 'stu_2', 'm', 'main', $2, $2, $3, $4, 'eval', $5, $6)`,
          [id, tokens, cost, turnId, status, reason],
        );
        await expect(
          repos.usageLedger.listForTurn({ studentId: 'stu_2', teacherId: 'tch_b' }, turnId),
          status,
        ).rejects.toMatchObject({ kind: 'integrity' });
      }
    });

    it('a caller-chosen row id (the worker queue, 3.8) is stored; the same id again is invalid', async () => {
      const turnId = turn();
      const usage = {
        model: 'm',
        tier: 'main',
        inputTokens: 1,
        outputTokens: 2,
        costMicroUsd: 3,
      } as const;
      const entry = { id: `ul_${turnId}_0`, turnId, source: 'subscription', usage } as const;
      await repos.usageLedger.record(S1A, PKG_A, entry);
      await expect(repos.usageLedger.record(S1A, PKG_A, entry)).rejects.toMatchObject({
        kind: 'invalid',
      });
      await repos.usageLedger.recordUnmetered(S1A, PKG_A, {
        id: `ul_${turnId}_1`,
        turnId,
        source: 'subscription',
        tier: 'small',
        reason: 'no_usage_reported',
      });
      const rows = await repos.usageLedger.listForTurn(S1A, turnId);
      expect(rows.map((r) => r.id)).toEqual([`ul_${turnId}_0`, `ul_${turnId}_1`]);
    });

    it('a total past 2^53 micro-USD is integrity, never a rounded number', async () => {
      const big = Number.MAX_SAFE_INTEGER;
      for (const id of ['ul_big_1', 'ul_big_2']) {
        await raw.query(
          `insert into usage_ledger (id, teacher_id, package_id, student_id, model, tier,
             input_tokens, output_tokens, cost_micro_usd, turn_id, source)
           values ($1, 'tch_b', 'pkg_b', 'stu_1', 'm', 'main', 1, 1, $2, 'turn_big', 'eval')`,
          [id, big],
        );
      }
      await expect(
        repos.usageLedger.sumForStudent({ studentId: 'stu_1', teacherId: 'tch_b' }),
      ).rejects.toMatchObject({ kind: 'integrity', method: 'usageLedger.sumForStudent' });
    });

    describe('task 13.5: costByPackageSince', () => {
      // Far from "now" (when the suite's beforeAll/seed rows default createdAt to now()), so the
      // window below only ever sees rows this describe block inserts with an explicit timestamp.
      const since = '2027-01-01T00:00:00.000Z';
      const until = '2027-02-01T00:00:00.000Z';
      const inWindow = '2027-01-15T00:00:00Z';
      const outOfWindow = '2026-12-31T00:00:00Z';

      async function insertRow(opts: {
        id: string;
        teacherId: string;
        packageId: string;
        studentId: string;
        turnId: string;
        source: 'subscription' | 'teacher_preview' | 'eval';
        status: 'recorded' | 'unknown' | 'unpriced';
        cost: number | null;
        createdAt: string;
      }): Promise<void> {
        const tokens = opts.status === 'unknown' ? [null, null] : [10, 20];
        await raw.query(
          `insert into usage_ledger (id, teacher_id, package_id, student_id, turn_id, source,
             status, reason, model, tier, input_tokens, output_tokens, cost_micro_usd, created_at)
           values ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'main', $10, $11, $12, $13)`,
          [
            opts.id,
            opts.teacherId,
            opts.packageId,
            opts.studentId,
            opts.turnId,
            opts.source,
            opts.status,
            opts.status === 'recorded'
              ? null
              : opts.status === 'unknown'
                ? 'no_usage_reported'
                : 'unpriced_model:m',
            opts.status === 'unknown' ? null : 'm',
            tokens[0],
            tokens[1],
            opts.cost,
            opts.createdAt,
          ],
        );
      }

      it('groups sums, counts and distinct turns by (teacherId, packageId), excluding eval rows and rows outside the window', async () => {
        const t1 = turn();
        const t2 = turn();
        const t3 = turn();
        // Teacher A / pkg A, in window: two recorded calls on t1, one unknown on t1, one unpriced
        // on t2 -> calls 4, recorded 2, unknown 1, unpriced 1, cost 300, distinctTurns 2.
        await insertRow({
          id: `cbp_${t1}_1`,
          teacherId: teacherId('A'),
          packageId: PKG_A,
          studentId: studentId('1'),
          turnId: t1,
          source: 'subscription',
          status: 'recorded',
          cost: 100,
          createdAt: inWindow,
        });
        await insertRow({
          id: `cbp_${t1}_2`,
          teacherId: teacherId('A'),
          packageId: PKG_A,
          studentId: studentId('1'),
          turnId: t1,
          source: 'subscription',
          status: 'recorded',
          cost: 200,
          createdAt: inWindow,
        });
        await insertRow({
          id: `cbp_${t1}_3`,
          teacherId: teacherId('A'),
          packageId: PKG_A,
          studentId: studentId('1'),
          turnId: t1,
          source: 'subscription',
          status: 'unknown',
          cost: null,
          createdAt: inWindow,
        });
        await insertRow({
          id: `cbp_${t2}_1`,
          teacherId: teacherId('A'),
          packageId: PKG_A,
          studentId: studentId('2'),
          turnId: t2,
          source: 'subscription',
          status: 'unpriced',
          cost: null,
          createdAt: inWindow,
        });
        // Teacher B / pkg B, in window: one recorded call on t3 -> calls 1, cost 50.
        await insertRow({
          id: `cbp_${t3}_1`,
          teacherId: teacherId('B'),
          packageId: PKG_B,
          studentId: studentId('1'),
          turnId: t3,
          source: 'subscription',
          status: 'recorded',
          cost: 50,
          createdAt: inWindow,
        });
        // Excluded: outside the window, and an eval row inside it.
        await insertRow({
          id: 'cbp_outside',
          teacherId: teacherId('A'),
          packageId: PKG_A,
          studentId: studentId('1'),
          turnId: turn(),
          source: 'subscription',
          status: 'recorded',
          cost: 999_999,
          createdAt: outOfWindow,
        });
        await insertRow({
          id: 'cbp_eval',
          teacherId: teacherId('A'),
          packageId: PKG_A,
          studentId: studentId('1'),
          turnId: turn(),
          source: 'eval',
          status: 'recorded',
          cost: 777_777,
          createdAt: inWindow,
        });

        const rows = await repos.usageLedger.costByPackageSince({ since, until });
        const a = rows.find((r) => r.teacherId === teacherId('A') && r.packageId === PKG_A);
        const b = rows.find((r) => r.teacherId === teacherId('B') && r.packageId === PKG_B);
        expect(a).toEqual({
          teacherId: teacherId('A'),
          packageId: PKG_A,
          calls: 4,
          recorded: 2,
          unknown: 1,
          unpriced: 1,
          costMicroUsd: 300,
          distinctTurns: 2,
        });
        expect(b).toEqual({
          teacherId: teacherId('B'),
          packageId: PKG_B,
          calls: 1,
          recorded: 1,
          unknown: 0,
          unpriced: 0,
          costMicroUsd: 50,
          distinctTurns: 1,
        });

        // task 13.5a finding 2: cross-check teacher B / PKG_B's row directly off the table,
        // the same way cost-alarm.int.test.ts's activeCountByPackage test checks teacher A.
        const hand = await raw.query<{
          calls: string;
          recorded: string;
          unknown: string;
          unpriced: string;
          cost: string;
          turns: string;
        }>(
          `select count(*)::text as calls,
                  count(*) filter (where status = 'recorded')::text as recorded,
                  count(*) filter (where status = 'unknown')::text as unknown,
                  count(*) filter (where status = 'unpriced')::text as unpriced,
                  coalesce(sum(cost_micro_usd) filter (where status = 'recorded'), 0)::text as cost,
                  count(distinct turn_id)::text as turns
             from usage_ledger
            where teacher_id = $1 and package_id = $2
              and created_at >= $3 and created_at < $4
              and source <> 'eval'`,
          [teacherId('B'), PKG_B, since, until],
        );
        const row = hand.rows[0]!;
        expect(b).toEqual({
          teacherId: teacherId('B'),
          packageId: PKG_B,
          calls: Number(row.calls),
          recorded: Number(row.recorded),
          unknown: Number(row.unknown),
          unpriced: Number(row.unpriced),
          costMicroUsd: Number(row.cost),
          distinctTurns: Number(row.turns),
        });
      });

      it('an unbounded window (no until) still excludes rows before since', async () => {
        const rows = await repos.usageLedger.costByPackageSince({ since });
        const a = rows.find((r) => r.teacherId === teacherId('A') && r.packageId === PKG_A);
        // From the previous test: 4 calls in-window, not the 999_999-cost row before `since`.
        expect(a?.calls).toBe(4);
        expect(a?.costMicroUsd).toBe(300);
      });

      it('rejects a malformed scope', async () => {
        await expect(
          repos.usageLedger.costByPackageSince({ since: 'not-a-date' } as never),
        ).rejects.toMatchObject({ kind: 'scope' });
      });

      it('rejects a swapped window (until before since)', async () => {
        await expect(
          repos.usageLedger.costByPackageSince({ since: until, until: since }),
        ).rejects.toMatchObject({ kind: 'invalid' });
      });

      it('rejects a zero-width window (until equal to since)', async () => {
        await expect(
          repos.usageLedger.costByPackageSince({ since, until: since }),
        ).rejects.toMatchObject({ kind: 'invalid' });
      });

      it('a row exactly at `since` is included, a row exactly at `until` is excluded', async () => {
        // Teacher B / pkg B already has one in-window row from the first test in this describe
        // (calls 1, recorded 1, cost 50, distinctTurns 1) -- this test adds to that baseline.
        await insertRow({
          id: 'cbp_at_since',
          teacherId: teacherId('B'),
          packageId: PKG_B,
          studentId: studentId('1'),
          turnId: turn(),
          source: 'subscription',
          status: 'recorded',
          cost: 10,
          createdAt: since,
        });
        await insertRow({
          id: 'cbp_at_until',
          teacherId: teacherId('B'),
          packageId: PKG_B,
          studentId: studentId('1'),
          turnId: turn(),
          source: 'subscription',
          status: 'recorded',
          cost: 999_999,
          createdAt: until,
        });

        const rows = await repos.usageLedger.costByPackageSince({ since, until });
        const b = rows.find((r) => r.teacherId === teacherId('B') && r.packageId === PKG_B);
        expect(b).toEqual({
          teacherId: teacherId('B'),
          packageId: PKG_B,
          calls: 2,
          recorded: 2,
          unknown: 0,
          unpriced: 0,
          costMicroUsd: 60,
          distinctTurns: 2,
        });
      });
    });
  },
);
