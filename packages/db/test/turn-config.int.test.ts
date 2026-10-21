// Task 3.2 / ADR-0004 required tests on Postgres: turnConfigStoreFor never trusts a session id on
// its own, and loads the agent at exactly the session row's agent_version. The real harness
// `entitle` runs on top, so a refusal is shown as `no_access`. See test/pg.ts to start Postgres.
import type { Entitlement, TurnInput } from '@edmate/contracts';
import { demoTurnInput } from '@edmate/contracts/fixtures';
import { cancelSource, defaultSteps, TurnRejection } from '@edmate/harness';
import { stepEnvExtras, testDeps } from '@edmate/harness/testing';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { migrateDatabase } from '../src/migrate.js';
import { createDb, type DbHandle } from '../src/internal.js';
import {
  createRepositories,
  entitlementStoreFor,
  type Repositories,
  turnConfigStoreFor,
} from '../src/index.js';
import { learnerClear, locales, packMarket, seedAccess } from './access-seed.js';
import { packageConfig } from './isolation-seed.js';
import {
  createDatabase,
  dropDatabase,
  postgresUp,
  SKIP_REASON,
  throwawayName,
  urlFor,
} from './pg.js';

const up = await postgresUp('turn config store tests');
const dbName = throwawayName();
const TEST_URL = urlFor(dbName);
let handle: DbHandle;
let repos: Repositories;
let raw: pg.Client;

const AT = '2026-10-18T10:00:00.000Z';
const ONE_A = { studentId: 'stu_1', teacherId: 'tch_a' };
const input: TurnInput = {
  ...demoTurnInput,
  studentId: 'stu_1',
  agentId: 'agt_a',
  sessionId: 'ses_1a',
};

async function entitlementFor(studentId = 'stu_1', agentId = 'agt_a'): Promise<Entitlement> {
  const e = await entitlementStoreFor(repos, { market: 'IN', packMarket, learnerClear }).resolve(
    { studentId, agentId, source: 'subscription' },
    AT,
  );
  if (e === null) throw new Error('fixture subscription should resolve');
  return e;
}

/** The real entitle on the db adapters: 'ok' or the rejection code. */
async function entitleCode(
  sessionId: string,
  store = turnConfigStoreFor(repos, { locales }),
  clear: (studentId: string) => Promise<boolean> = learnerClear,
) {
  const t = testDeps({
    overrides: {
      entitlements: entitlementStoreFor(repos, { market: 'IN', packMarket, learnerClear: clear }),
      turnConfig: store,
      entitlementSource: 'subscription',
    },
  });
  try {
    const out = await defaultSteps.entitle({
      input: { ...input, sessionId },
      deps: t.deps,
      cancel: cancelSource().token,
      turnId: 'turn_1',
      ...stepEnvExtras(),
    });
    return { code: 'ok', out };
  } catch (e) {
    if (e instanceof TurnRejection) return { code: e.code, out: null };
    throw e;
  }
}

describe.skipIf(!up)(`turnConfigStoreFor on Postgres${up ? '' : ` (${SKIP_REASON})`}`, () => {
  beforeAll(async () => {
    await createDatabase(dbName);
    await migrateDatabase(TEST_URL);
    handle = createDb({ DATABASE_URL: TEST_URL });
    await seedAccess(handle.db);
    repos = createRepositories(handle.db);
    raw = new pg.Client({ connectionString: TEST_URL });
    await raw.connect();
  });

  afterAll(async () => {
    await raw?.end();
    await handle?.close();
    await dropDatabase(dbName);
  });

  it('1.7: a learner held at the age gate (learnerClear false) is refused as no_access', async () => {
    expect((await entitleCode('ses_1a')).code).toBe('ok');
    const { code, out } = await entitleCode('ses_1a', undefined, async () => false);
    expect(code).toBe('no_access');
    expect(out).toBeNull();
  });

  it('(b) loads the agent at the session row version while a newer one is live', async () => {
    const e = await entitlementFor();
    const cfg = await turnConfigStoreFor(repos, { locales }).load(e, 'ses_1a');
    expect(cfg?.agent).toMatchObject({ id: 'agt_a', version: 1, teacherId: 'tch_a' });
    expect(cfg?.pkg).toMatchObject({ id: 'pkg_a', version: 1 });
    expect(cfg?.styleCard).toMatchObject({ id: 'sty_a', teacherId: 'tch_a', version: 1 });
    expect(cfg?.locale.market).toBe('IN');
    const { code, out } = await entitleCode('ses_1a');
    expect(code).toBe('ok');
    expect(out?.agent.version).toBe(1);

    // The version follows the row, never the agent's live version.
    await raw.query(`update sessions set agent_version = 2 where id = 'ses_1a'`);
    expect((await turnConfigStoreFor(repos, { locales }).load(e, 'ses_1a'))?.agent.version).toBe(2);
    await raw.query(`update sessions set agent_version = 1 where id = 'ses_1a'`);
  });

  it('returns the session row help_state as stored, unvalidated (ADR-0005)', async () => {
    const e = await entitlementFor();
    const store = turnConfigStoreFor(repos, { locales });
    expect((await store.load(e, 'ses_1a'))?.helpState).toEqual({});
    const stored = { v: 1, rung: 2, anything: ['kept', 'as', 'is'] };
    await raw.query(`update sessions set help_state = $1 where id = 'ses_1a'`, [
      JSON.stringify(stored),
    ]);
    expect((await store.load(e, 'ses_1a'))?.helpState).toEqual(stored);
    await raw.query(`update sessions set help_state = '{}'::jsonb where id = 'ses_1a'`);
  });

  it.each([
    ['another student', 'ses_2a'],
    ['another teacher', 'ses_1b'],
    ['another agent', 'ses_1a_draft'],
    ['an ended session', 'ses_1a_ended'],
    ['an unknown session', 'ses_nowhere'],
  ])('(a) %s: load gives null and entitle gives no_access', async (_label, sessionId) => {
    const e = await entitlementFor();
    expect(await turnConfigStoreFor(repos, { locales }).load(e, sessionId)).toBeNull();
    expect((await entitleCode(sessionId)).code).toBe('no_access');
  });

  it('(b) an agent whose id or teacherId differs from the entitlement gives no_access', async () => {
    const real = turnConfigStoreFor(repos, { locales });
    for (const patch of [{ id: 'agt_b' }, { teacherId: 'tch_b' }]) {
      const { code } = await entitleCode('ses_1a', {
        async load(e, sid) {
          const cfg = await real.load(e, sid);
          return cfg && { ...cfg, agent: { ...cfg.agent, ...patch } };
        },
      });
      expect(code, JSON.stringify(patch)).toBe('no_access');
    }
  });

  it('a pinned version that is gone, a missing style card, package or locale give null', async () => {
    const e = await entitlementFor();
    expect(await turnConfigStoreFor(repos, { locales: () => null }).load(e, 'ses_1a')).toBeNull();
    // A package version row that is not the entitlement teacher's (corrupt data): null. (An
    // entitlement naming another version than the session's pin ends the session: task 3.16,
    // session-package.int.test.ts.)
    await raw.query(
      `insert into package_versions (id, teacher_id, package_id, version, config) values ('pv_a_foreign', 'tch_b', 'pkg_a', 5, $1)`,
      [JSON.stringify(packageConfig('A', 5))],
    );
    await raw.query(`update sessions set package_version = 5 where id = 'ses_1a'`);
    expect(
      await turnConfigStoreFor(repos, { locales }).load({ ...e, packageVersion: 5 }, 'ses_1a'),
    ).toBeNull();
    await raw.query(`update sessions set package_version = 1 where id = 'ses_1a'`);
    expect((await repos.sessions.get(ONE_A, 'ses_1a'))?.endedAt).toBeNull();
    await raw.query(`update sessions set agent_version = 7 where id = 'ses_1a'`);
    expect(await turnConfigStoreFor(repos, { locales }).load(e, 'ses_1a')).toBeNull();
    await raw.query(`update sessions set agent_version = 1 where id = 'ses_1a'`);
    // An agent version naming a style card that is not its teacher's.
    await raw.query(
      `insert into agent_versions (id, teacher_id, agent_id, version, config) values ('av_a_3', 'tch_a', 'agt_a', 3, $1)`,
      [
        JSON.stringify({
          ...(await repos.agentVersions.get(
            { teacherId: 'tch_a' },
            { agentId: 'agt_a', version: 1 },
          )),
          version: 3,
          styleCardId: 'sty_b',
        }),
      ],
    );
    await raw.query(`update sessions set agent_version = 3 where id = 'ses_1a'`);
    expect(await turnConfigStoreFor(repos, { locales }).load(e, 'ses_1a')).toBeNull();
    await raw.query(`update sessions set agent_version = 1 where id = 'ses_1a'`);
  });

  it('the style card is the exact row agent.styleCardId names (rows are immutable versions)', async () => {
    await raw.query(
      `insert into style_cards (id, teacher_id, version, text) values ('sty_a_v2', 'tch_a', 2, '[A] style v2')`,
    );
    const e = await entitlementFor();
    const cfg = await turnConfigStoreFor(repos, { locales }).load(e, 'ses_1a');
    expect(cfg?.styleCard).toMatchObject({ id: 'sty_a', version: 1 });
  });
});
