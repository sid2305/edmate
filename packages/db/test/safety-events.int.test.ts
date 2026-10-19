// Task 4.4 on Postgres (ADR-0006): safetyEvents.record writes one safety_events row per
// (turn, guard) on the scope's own session, ids and a fixed code only; a replay writes nothing new;
// listForSession reads them back for that student x teacher only. See test/pg.ts.
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { migrateDatabase } from '../src/migrate.js';
import { createDb, type DbHandle } from '../src/internal.js';
import {
  createRepositories,
  type Repositories,
  RepositoryError,
  safetyEventRowId,
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

const up = await postgresUp('safety event tests');
const dbName = throwawayName();
const TEST_URL = urlFor(dbName);
let handle: DbHandle;
let repos: Repositories;
let raw: pg.Client;

const own = { studentId: studentId('1'), teacherId: teacherId('A') };
const event = (o: Record<string, unknown> = {}) => ({
  sessionId: ids.session('1A'),
  turnId: 'trn_se_1',
  guard: 'jailbreak' as const,
  code: 'jailbreak_override' as const,
  source: 'rule' as const,
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

describe.skipIf(!up)(`safetyEvents on Postgres${up ? '' : ` (${SKIP_REASON})`}`, () => {
  beforeAll(async () => {
    await createDatabase(dbName);
    await migrateDatabase(TEST_URL);
    handle = createDb({ DATABASE_URL: TEST_URL });
    await seed(handle.db);
    repos = createRepositories(handle.db);
    raw = new pg.Client({ connectionString: TEST_URL });
    await raw.connect();
  }, 60_000);

  afterAll(async () => {
    await raw?.end();
    await handle?.close();
    await dropDatabase(dbName);
  }, 60_000);

  it('writes one row: target session:<id>, reason <guard>:<code>:<source>, id from (turn, guard)', async () => {
    const r = await repos.safetyEvents.record(own, event());
    expect(r).toEqual({ id: safetyEventRowId('trn_se_1', 'jailbreak'), written: true });
    const { rows } = await raw.query(
      'select id, target, reason, status from safety_events where id = $1',
      [r.id],
    );
    expect(rows).toEqual([
      {
        id: r.id,
        target: `session:${ids.session('1A')}`,
        reason: 'jailbreak:jailbreak_override:rule',
        status: 'open',
      },
    ]);
  }, 10_000);

  it('a replay of the same (turn, guard) writes nothing new', async () => {
    const before = await raw.query('select count(*)::int as n from safety_events');
    const r = await repos.safetyEvents.record(own, event());
    expect(r.written).toBe(false);
    const after = await raw.query('select count(*)::int as n from safety_events');
    expect(after.rows[0].n).toBe(before.rows[0].n);
  }, 10_000);

  it('the same turn, the other guard, is its own row', async () => {
    const r = await repos.safetyEvents.record(
      own,
      event({ guard: 'moderationIn', code: 'hate', source: 'classifier' }),
    );
    expect(r.written).toBe(true);
    expect(r.id).not.toBe(safetyEventRowId('trn_se_1', 'jailbreak'));
  }, 10_000);

  it('listForSession reads them back as typed rows, own scope only', async () => {
    const rows = await repos.safetyEvents.listForSession(own, ids.session('1A'));
    expect(rows.map((x) => [x.guard, x.code, x.source])).toEqual(
      expect.arrayContaining([
        ['jailbreak', 'jailbreak_override', 'rule'],
        ['moderationIn', 'hate', 'classifier'],
      ]),
    );
    for (const x of rows) {
      expect(x).toMatchObject({ ...own, sessionId: ids.session('1A') });
      expect(typeof x.createdAt).toBe('string');
    }
    const other = { studentId: studentId('2'), teacherId: teacherId('A') };
    expect(await repos.safetyEvents.listForSession(other, ids.session('1A'))).toEqual([]);
  }, 10_000);

  it("another student's or teacher's session is not_found; nothing is written", async () => {
    const before = await raw.query('select count(*)::int as n from safety_events');
    expect(await kind(repos.safetyEvents.record(own, event({ sessionId: ids.session('2A'), turnId: 'trn_x1' })))).toBe('not_found');
    expect(await kind(repos.safetyEvents.record(own, event({ sessionId: ids.session('1B'), turnId: 'trn_x2' })))).toBe('not_found');
    expect(await kind(repos.safetyEvents.record(own, event({ sessionId: 'ses_missing', turnId: 'trn_x3' })))).toBe('not_found');
    const after = await raw.query('select count(*)::int as n from safety_events');
    expect(after.rows[0].n).toBe(before.rows[0].n);
  }, 10_000);

  it('free text, an unknown code or guard, or an extra field is invalid', async () => {
    for (const bad of [
      event({ code: 'student said something' }),
      event({ guard: 'answerLeak' }),
      event({ source: 'model' }),
      event({ excerpt: 'x' }),
      event({ turnId: 'bad id!' }),
    ]) {
      expect(await kind(repos.safetyEvents.record(own, bad as never))).toBe('invalid');
    }
    expect(await kind(repos.safetyEvents.record({ studentId: '', teacherId: 'x' }, event()))).toBe(
      'scope',
    );
  }, 10_000);

  it('a stored reason that no longer parses is integrity, not a silent drop', async () => {
    await raw.query(
      "insert into safety_events (id, target, reason) values ('se_corrupt', $1, 'free text here')",
      [`session:${ids.session('1A')}`],
    );
    expect(await kind(repos.safetyEvents.listForSession(own, ids.session('1A')))).toBe('integrity');
    await raw.query("delete from safety_events where id = 'se_corrupt'");
  }, 10_000);
});
