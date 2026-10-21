// Task 3.8 on Postgres: traceSinkFor stores the whole TurnTrace (migration 0007), one per turn,
// on the scope's own session only; listForSession returns it as the contract. See test/pg.ts.
import { type TurnTrace, TurnTraceSchema } from '@edmate/contracts';
import { demoTurnTrace } from '@edmate/contracts/fixtures';
import { computeHealthMetrics } from '@edmate/harness';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { migrateDatabase } from '../src/migrate.js';
import { createDb, type DbHandle } from '../src/internal.js';
import {
  createRepositories,
  type Repositories,
  RepositoryError,
  traceSinkFor,
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

const up = await postgresUp('trace sink tests');
const dbName = throwawayName();
const TEST_URL = urlFor(dbName);
let handle: DbHandle;
let repos: Repositories;
let raw: pg.Client;

const own = { studentId: studentId('1'), teacherId: teacherId('A') };
const trace = (o: Partial<TurnTrace> = {}): TurnTrace => ({
  ...demoTurnTrace,
  sessionId: ids.session('1A'),
  ...o,
});

async function kind(p: Promise<unknown>): Promise<string> {
  const e = await p.then(
    () => null,
    (x: unknown) => x,
  );
  expect(e).toBeInstanceOf(RepositoryError);
  return (e as RepositoryError).kind;
}

describe.skipIf(!up)(`traceSinkFor on Postgres${up ? '' : ` (${SKIP_REASON})`}`, () => {
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

  it('stores the whole trace and reads it back as the contract, with the usage summary', async () => {
    await traceSinkFor(repos, own).record(trace());
    const rows = await repos.turnTraces.listForSession(own, ids.session('1A'));
    const row = rows.find((r) => r.turnId === demoTurnTrace.turnId);
    expect(row).toBeDefined();
    const { id, model, inputTokens, outputTokens, costMicroUsd, createdAt, ...contract } = row!;
    expect(TurnTraceSchema.parse(contract)).toEqual(trace());
    expect(id).toMatch(/^[0-9a-f-]{36}$/);
    expect(createdAt).toMatch(/Z$/);
    const u = demoTurnTrace.usage;
    expect({ model, inputTokens, outputTokens, costMicroUsd }).toEqual({
      model: [...new Set(u.map((x) => x.model))].join(','),
      inputTokens: u.reduce((n, x) => n + x.inputTokens, 0),
      outputTokens: u.reduce((n, x) => n + x.outputTokens, 0),
      costMicroUsd: u.reduce((n, x) => n + x.costMicroUsd, 0),
    });
  });

  it('a turn with no model call stores an empty model and zero figures', async () => {
    await traceSinkFor(repos, own).record(trace({ turnId: 'trn_empty', usage: [] }));
    const rows = await repos.turnTraces.listForSession(own, ids.session('1A'));
    expect(rows.find((r) => r.turnId === 'trn_empty')).toMatchObject({
      model: '',
      inputTokens: 0,
      outputTokens: 0,
      costMicroUsd: 0,
      usage: [],
    });
  });

  it('a second trace for the same turn is invalid (a retried job never writes two)', async () => {
    const sink = traceSinkFor(repos, own);
    await sink.record(trace({ turnId: 'trn_once' }));
    expect(await kind(sink.record(trace({ turnId: 'trn_once' })))).toBe('invalid');
    const n = await raw.query<{ n: string }>(
      `select count(*)::text as n from turn_traces where turn_id = 'trn_once'`,
    );
    expect(n.rows[0]?.n).toBe('1');
  });

  it('another scope’s session is not_found; a malformed trace is invalid', async () => {
    const sink = traceSinkFor(repos, own);
    expect(await kind(sink.record(trace({ turnId: 'trn_x', sessionId: ids.session('2A') })))).toBe(
      'not_found',
    );
    expect(await kind(sink.record(trace({ turnId: 'trn_y', sessionId: ids.session('1B') })))).toBe(
      'not_found',
    );
    expect(await kind(sink.record({ ...trace(), turnId: 'bad id!' }))).toBe('invalid');
    expect(() => traceSinkFor(repos, { studentId: 'x', teacherId: '' })).toThrow(RepositoryError);
  });

  it('findForTurn reads one turn’s trace on the scope’s session; else null or invalid', async () => {
    await traceSinkFor(repos, own).record(trace({ turnId: 'trn_find' }));
    const ref = { sessionId: ids.session('1A'), turnId: 'trn_find' };
    expect((await repos.turnTraces.findForTurn(own, ref))?.turnId).toBe('trn_find');
    expect(
      await repos.turnTraces.findForTurn(own, { ...ref, sessionId: ids.session('2A') }),
    ).toBeNull();
    expect(
      await repos.turnTraces.findForTurn(
        { studentId: studentId('2'), teacherId: teacherId('A') },
        ref,
      ),
    ).toBeNull();
    expect(await repos.turnTraces.findForTurn(own, { ...ref, turnId: 'trn_none' })).toBeNull();
    expect(await kind(repos.turnTraces.findForTurn(own, { ...ref, turnId: 'bad id!' }))).toBe(
      'invalid',
    );
  });

  it('a stored trace whose jsonb no longer parses is an integrity error, never returned', async () => {
    await traceSinkFor(repos, own).record(trace({ turnId: 'trn_corrupt' }));
    await raw.query(
      `update turn_traces set guards = '"nope"'::jsonb where turn_id = 'trn_corrupt'`,
    );
    expect(await kind(repos.turnTraces.listForSession(own, ids.session('1A')))).toBe('integrity');
    expect(
      await kind(
        repos.turnTraces.findForTurn(own, { sessionId: ids.session('1A'), turnId: 'trn_corrupt' }),
      ),
    ).toBe('integrity');
    await raw.query(`delete from turn_traces where turn_id = 'trn_corrupt'`);
  });

  // Task 7.7: listForTeacherSince reads across a teacher's sessions for a window, capped, and
  // another teacher's traces never appear (CASE 'turnTraces.listForTeacherSince' in
  // repositories.int.test.ts covers the full isolation grid; this is the window/cap/compose
  // demonstration).
  it('listForTeacherSince bounds by time, caps rows, and never returns another teacher’s traces', async () => {
    const teacherA = { teacherId: teacherId('A') };
    const other = { studentId: studentId('2'), teacherId: teacherId('A') };
    await traceSinkFor(repos, own).record(trace({ turnId: 'trn_window_old' }));
    await traceSinkFor(repos, other).record(
      trace({ turnId: 'trn_window_new', sessionId: ids.session('2A') }),
    );
    await raw.query(
      `update turn_traces set created_at = '2020-01-01T00:00:00Z' where turn_id = 'trn_window_old'`,
    );
    await raw.query(
      `update turn_traces set created_at = '2026-06-01T00:00:00Z' where turn_id = 'trn_window_new'`,
    );

    const windowed = await repos.turnTraces.listForTeacherSince(teacherA, '2025-01-01T00:00:00Z');
    const windowedIds = windowed.map((r) => r.turnId);
    expect(windowedIds).toContain('trn_window_new');
    expect(windowedIds).not.toContain('trn_window_old');
    // Another teacher's (B's) traces, seeded on sessions '1B'/'2B', never appear for teacher A.
    expect(windowed.every((r) => r.sessionId === ids.session('1A') || r.sessionId === ids.session('2A'))).toBe(
      true,
    );

    const capped = await repos.turnTraces.listForTeacherSince(
      teacherA,
      '2000-01-01T00:00:00Z',
      1,
    );
    expect(capped).toHaveLength(1);

    const unlimited = await repos.turnTraces.listForTeacherSince(teacherA, '2000-01-01T00:00:00Z');
    expect(unlimited.length).toBeGreaterThan(1);
    expect(unlimited.map((r) => r.turnId)).toContain('trn_window_old');

    await raw.query(
      `delete from turn_traces where turn_id in ('trn_window_old', 'trn_window_new')`,
    );
  });

  it('listForTeacherSince’s output round-trips through computeHealthMetrics to a sane report', async () => {
    const teacherA = { teacherId: teacherId('A') };
    await traceSinkFor(repos, own).record(trace({ turnId: 'trn_health' }));
    const rows = await repos.turnTraces.listForTeacherSince(teacherA, '2000-01-01T00:00:00Z');
    expect(rows.length).toBeGreaterThan(0);

    const metrics = computeHealthMetrics(rows);
    expect(metrics.turns).toBe(rows.length);
    expect(metrics.errorRate).toBeGreaterThanOrEqual(0);
    expect(metrics.errorRate).toBeLessThanOrEqual(1);
    expect(metrics.guardRate).toBeGreaterThanOrEqual(0);
    expect(metrics.guardRate).toBeLessThanOrEqual(1);
    expect(Object.keys(metrics.stepLatencyMs).length).toBeGreaterThan(0);

    await raw.query(`delete from turn_traces where turn_id = 'trn_health'`);
  });
});
