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
  },
);
