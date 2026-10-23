// Task 8.4a on Postgres: styleCards.create stores a new immutable version per teacher (1, 2, 3,
// never colliding, even under concurrent saves), styleCards.latest reads the newest, and the
// acceptance proof: once an agent version names the new card, the turn config store (3.2/3.16)
// loads exactly that card on the next turn. See test/pg.ts to start Postgres.
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { migrateDatabase } from '../src/migrate.js';
import { createDb, type DbHandle } from '../src/internal.js';
import * as s from '../src/internal.js';
import {
  createRepositories,
  entitlementStoreFor,
  type Repositories,
  RepositoryError,
  turnConfigStoreFor,
} from '../src/index.js';
import { learnerClear, locales, packMarket, seedAccess, studentMarket } from './access-seed.js';
import { agentConfig, ids, studentId, teacherId } from './isolation-seed.js';
import {
  createDatabase,
  dropDatabase,
  postgresUp,
  SKIP_REASON,
  throwawayName,
  urlFor,
} from './pg.js';

const up = await postgresUp('style card tests');
const dbName = throwawayName();
const TEST_URL = urlFor(dbName);
let handle: DbHandle;
let repos: Repositories;
let raw: pg.Client;

const A = { teacherId: teacherId('A') };
const B = { teacherId: teacherId('B') };
const FRESH = { teacherId: 'tch_sc_fresh' };
const RACE = { teacherId: 'tch_sc_race' };
const AT = '2026-10-22T10:00:00.000Z';

async function failure(p: Promise<unknown>): Promise<{ kind: string; method: string }> {
  const e = await p.then(
    () => new Error('resolved'),
    (x: unknown) => x,
  );
  expect(e).toBeInstanceOf(RepositoryError);
  const { kind, method } = e as RepositoryError;
  return { kind, method };
}

const rowCount = async (tid: string) =>
  Number(
    (
      await raw.query<{ n: string }>('select count(*) as n from style_cards where teacher_id = $1', [
        tid,
      ])
    ).rows[0]?.n,
  );

describe.skipIf(!up)(`styleCards on Postgres${up ? '' : ` (${SKIP_REASON})`}`, () => {
  beforeAll(async () => {
    await createDatabase(dbName);
    await migrateDatabase(TEST_URL);
    handle = createDb({ DATABASE_URL: TEST_URL });
    await seedAccess(handle.db);
    await handle.db.insert(s.users).values(
      [FRESH, RACE].map((x) => ({
        id: x.teacherId,
        name: '[sc] teacher',
        locale: 'en',
        market: 'test',
        role: 'teacher' as const,
      })),
    );
    repos = createRepositories(handle.db);
    raw = new pg.Client({ connectionString: TEST_URL });
    await raw.connect();
  });

  afterAll(async () => {
    await raw?.end();
    await handle?.close();
    await dropDatabase(dbName);
  });

  it('latest is null for a teacher with no cards', async () => {
    expect(await repos.styleCards.latest(FRESH)).toBeNull();
  });

  it('create numbers versions 1, 2, 3 per teacher, independent of other teachers', async () => {
    const one = await repos.styleCards.create(FRESH, { text: '[F] one', mistakeTags: [] });
    const two = await repos.styleCards.create(FRESH, {
      text: '[F] two',
      mistakeTags: ['sign-error', 'units'],
    });
    const three = await repos.styleCards.create(FRESH, { text: '[F] three', mistakeTags: [] });
    expect([one.version, two.version, three.version]).toEqual([1, 2, 3]);
    expect(two).toMatchObject({
      teacherId: FRESH.teacherId,
      text: '[F] two',
      mistakeTags: ['sign-error', 'units'],
    });
    expect(new Set([one.id, two.id, three.id]).size).toBe(3);
    // Teacher B (seeded at v1) continues from its own max, untouched by FRESH's numbering.
    const b = await repos.styleCards.create(B, { text: '[B] next', mistakeTags: [] });
    expect(b.version).toBe(2);
    // Each version stays its own immutable row, readable by id.
    expect(await repos.styleCards.get(FRESH, one.id)).toEqual(one);
    expect(await repos.styleCards.latest(FRESH)).toEqual(three);
  });

  it('trims tags and drops duplicates before storing', async () => {
    const card = await repos.styleCards.create(FRESH, {
      text: '[F] tags',
      mistakeTags: [' units ', 'units', 'sign-error'],
    });
    expect(card.mistakeTags).toEqual(['units', 'sign-error']);
  });

  it('concurrent creates by one teacher get distinct consecutive versions', async () => {
    const results = await Promise.all(
      Array.from({ length: 6 }, (_, i) =>
        repos.styleCards.create(RACE, { text: `[R] ${i}`, mistakeTags: [] }),
      ),
    );
    expect(results.map((c) => c.version).sort((x, y) => x - y)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(await rowCount(RACE.teacherId)).toBe(6);
  });

  it('a student scope is `scope`; an unknown user is `not_found`; nothing is written', async () => {
    expect(
      await failure(
        repos.styleCards.create({ teacherId: studentId('1') }, { text: 'x', mistakeTags: [] }),
      ),
    ).toEqual({ kind: 'scope', method: 'styleCards.create' });
    expect(
      await failure(
        repos.styleCards.create({ teacherId: 'tch_nobody' }, { text: 'x', mistakeTags: [] }),
      ),
    ).toEqual({ kind: 'not_found', method: 'styleCards.create' });
    expect(await rowCount(studentId('1'))).toBe(0);
    expect(await rowCount('tch_nobody')).toBe(0);
  });

  it('latest never returns another teacher’s card', async () => {
    expect((await repos.styleCards.latest(A))?.teacherId).toBe(A.teacherId);
    expect((await repos.styleCards.latest(B))?.text).toBe('[B] next');
    expect(await repos.styleCards.latest({ teacherId: 'tch_nobody' })).toBeNull();
  });

  it('acceptance: the turn after a save loads the new card version', async () => {
    const e = await entitlementStoreFor(repos, { market: 'IN', packMarket, learnerClear, studentMarket }).resolve(
      { studentId: 'stu_1', agentId: ids.agent('A'), source: 'subscription' },
      AT,
    );
    if (e === null) throw new Error('fixture subscription should resolve');
    const store = turnConfigStoreFor(repos, { locales });
    expect((await store.load(e, 'ses_1a'))?.styleCard).toMatchObject({
      id: ids.styleCard('A'),
      version: 1,
    });

    // The teacher saves an edited card (v2 for teacher A), then a new agent version names it.
    const saved = await repos.styleCards.create(A, {
      text: '[A] edited: ask one question at a time.',
      mistakeTags: ['units'],
    });
    expect(saved.version).toBe(2);
    await handle.db.insert(s.agentVersions).values({
      id: 'av_a_sc',
      teacherId: A.teacherId,
      agentId: ids.agent('A'),
      version: 3,
      config: { ...agentConfig('A'), version: 3, styleCardId: saved.id },
    });
    await raw.query(`update sessions set agent_version = 3 where id = 'ses_1a'`);

    const next = await store.load(e, 'ses_1a');
    expect(next?.styleCard).toEqual(saved);
    expect(next?.agent.styleCardId).toBe(saved.id);
    await raw.query(`update sessions set agent_version = 1 where id = 'ses_1a'`);
  });
});
