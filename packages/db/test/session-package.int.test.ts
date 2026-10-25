// Task 3.16 on Postgres: sessions follow the package. A session is pinned to the package version
// its entitlement resolved to; when the student's package or its version changes, the next load
// ends that session and clears the pair's last summary, so no history, sources or summary from
// the lapsed package reach the model. The real harness `entitle` runs on top (no model calls).
// See test/pg.ts to start Postgres.
import type { Entitlement, Message, TurnInput } from '@edmate/contracts';
import { demoTurnInput } from '@edmate/contracts/fixtures';
import { cancelSource, defaultSteps, TurnRejection } from '@edmate/harness';
import { stepEnvExtras, testDeps } from '@edmate/harness/testing';
import pg from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { migrateDatabase } from '../src/migrate.js';
import { createDb, type DbHandle } from '../src/internal.js';
import {
  createRepositories,
  entitlementStoreFor,
  type EntitlementStoreOptions,
  type Repositories,
  RepositoryError,
  type StudentScope,
  turnConfigStoreFor,
} from '../src/index.js';
import { EVAL_STUDENT, learnerClear, locales, packMarket, seedAccess, studentMarket } from './access-seed.js';
import { ids, packageConfig } from './isolation-seed.js';
import {
  createDatabase,
  dropDatabase,
  postgresUp,
  SKIP_REASON,
  throwawayName,
  urlFor,
} from './pg.js';

const up = await postgresUp('session package tests');
const dbName = throwawayName();
const TEST_URL = urlFor(dbName);
/** Each case does several round trips; CI's Postgres is slow. */
const CASE_MS = 30_000;
let handle: DbHandle;
let repos: Repositories;
let raw: pg.Client;

const AT = '2026-10-18T10:00:00.000Z';
const ONE_A: StudentScope = { studentId: 'stu_1', teacherId: 'tch_a' };
const SUB = { market: 'IN', packMarket, learnerClear, studentMarket } satisfies EntitlementStoreOptions;
const input: TurnInput = { ...demoTurnInput, studentId: 'stu_1', agentId: 'agt_a' };
type EntitlementSource = Entitlement['source'];

/** Points student 1's subscription with teacher A at a package version row. */
async function subscribe(packageVersionId: string): Promise<void> {
  await raw.query(`update subscriptions set package_version_id = $1 where id = 'sub_1a'`, [
    packageVersionId,
  ]);
}

async function entitlement(
  opts: EntitlementStoreOptions = SUB,
  studentId = 'stu_1',
  source: EntitlementSource = 'subscription',
): Promise<Entitlement> {
  const e = await entitlementStoreFor(repos, opts).resolve(
    { studentId, agentId: 'agt_a', source },
    AT,
  );
  if (e === null) throw new Error('fixture entitlement should resolve');
  return e;
}

/** The real entitle on the db adapters: 'ok' or the rejection code. */
async function entitleCode(
  sessionId: string,
  opts: EntitlementStoreOptions = SUB,
  extra: Partial<TurnInput> = {},
  source: EntitlementSource = 'subscription',
): Promise<string> {
  const t = testDeps({
    overrides: {
      entitlements: entitlementStoreFor(repos, opts),
      turnConfig: turnConfigStoreFor(repos, { locales }),
      entitlementSource: source,
    },
  });
  try {
    await defaultSteps.entitle({
      input: { ...input, ...extra, sessionId },
      deps: t.deps,
      cancel: cancelSource().token,
      turnId: 'turn_316',
      ...stepEnvExtras(),
    });
    return 'ok';
  } catch (e) {
    if (e instanceof TurnRejection) return e.code;
    throw e;
  }
}

/** A new session for student 1 with agt_a v1, pinned to what the entitlement resolves to now. */
async function openSession(): Promise<string> {
  const e = await entitlement();
  const { id } = await repos.sessions.create(ONE_A, {
    agentId: 'agt_a',
    agentVersion: 1,
    packageId: e.packageId,
    packageVersion: e.packageVersion,
  });
  return id;
}

async function studyIn(sessionId: string, marker: string): Promise<void> {
  const m = (n: number, role: Message['role']): Message => ({
    id: `msg_${sessionId}_${n}`,
    role,
    text: `${marker} ${role}`,
    createdAt: `2026-10-18T09:00:0${n}Z`,
    ...(role === 'agent'
      ? { sources: [{ title: `${marker} notes`, locator: 'p. 1', kind: 'material' as const }] }
      : {}),
  });
  await repos.messages.append(ONE_A, sessionId, m(1, 'student'));
  await repos.messages.append(ONE_A, sessionId, m(2, 'agent'));
}

async function setSummary(text: string | null): Promise<void> {
  await raw.query(
    `update learner_profiles set last_summary = $1 where student_id = 'stu_1' and teacher_id = 'tch_a'`,
    [text],
  );
}
async function summary(): Promise<string | null | undefined> {
  const r = await raw.query<{ s: string | null }>(
    `select last_summary as s from learner_profiles where student_id = 'stu_1' and teacher_id = 'tch_a'`,
  );
  return r.rows[0]?.s;
}
async function endedAt(sessionId: string): Promise<string | null | undefined> {
  return (
    await raw.query<{ e: string | null }>(
      'select ended_at::text as e from sessions where id = $1',
      [sessionId],
    )
  ).rows[0]?.e;
}
async function messageCount(sessionId: string): Promise<number> {
  const r = await raw.query<{ n: string }>(
    'select count(*)::text as n from messages where session_id = $1',
    [sessionId],
  );
  return Number(r.rows[0]?.n);
}

async function kind(p: Promise<unknown>): Promise<string> {
  const e = await p.then(
    () => null,
    (x: unknown) => x,
  );
  expect(e).toBeInstanceOf(RepositoryError);
  return (e as RepositoryError).kind;
}

describe.skipIf(!up)(
  `sessions follow the package on Postgres${up ? '' : ` (${SKIP_REASON})`}`,
  () => {
    beforeAll(async () => {
      await createDatabase(dbName);
      await migrateDatabase(TEST_URL);
      handle = createDb({ DATABASE_URL: TEST_URL });
      await seedAccess(handle.db);
      repos = createRepositories(handle.db);
      raw = new pg.Client({ connectionString: TEST_URL });
      await raw.connect();
      // A smaller package of the same agent: only module 1 (the downgrade target).
      await raw.query(
        `insert into packages (id, teacher_id, agent_id, name, live_version)
       values ('pkg_a_small', 'tch_a', 'agt_a', '[A] small', 1)`,
      );
      await raw.query(
        `insert into package_versions (id, teacher_id, package_id, version, config)
       values ('pv_a_small', 'tch_a', 'pkg_a_small', 1, $1)`,
        [JSON.stringify({ ...packageConfig('A', 1, [ids.module('A', 1)]), id: 'pkg_a_small' })],
      );
    }, 60_000);

    afterAll(async () => {
      await raw?.end();
      await handle?.close();
      await dropDatabase(dbName);
    }, 60_000);

    // Task 5.10d: sessions.create reuses an existing open session for the same
    // (teacher, student, agent) triple. Each test here calls openSession() expecting a fresh
    // row, so end whatever a previous test left open on ONE_A/agt_a first.
    beforeEach(async () => {
      await raw.query(
        `update sessions set ended_at = now()
         where teacher_id = 'tch_a' and student_id = 'stu_1' and agent_id = 'agt_a' and ended_at is null`,
      );
    });

    it(
      'control: an unchanged package loads, the session stays open and the summary is kept',
      async () => {
        await subscribe('pv_a_2');
        const sid = await openSession();
        await setSummary('[1A] summary of modules 1 and 2');
        const cfg = await turnConfigStoreFor(repos, { locales }).load(await entitlement(), sid);
        expect(cfg?.pkg).toMatchObject({ id: 'pkg_a', version: 2 });
        expect(await entitleCode(sid)).toBe('ok');
        expect(await endedAt(sid)).toBeNull();
        expect(await summary()).toBe('[1A] summary of modules 1 and 2');
        expect(await repos.sessions.get(ONE_A, sid)).toMatchObject({
          packageId: 'pkg_a',
          packageVersion: 2,
        });
      },
      CASE_MS,
    );

    it(
      'downgrade: the bigger package lapses, so the session ends and nothing of it carries over',
      async () => {
        await subscribe('pv_a_2');
        const old = await openSession();
        await studyIn(old, '[module 2]');
        await setSummary('[module 2] summary');

        await subscribe('pv_a_small');
        const e = await entitlement();
        expect([e.packageId, e.packageVersion, e.allowedModuleIds]).toEqual([
          'pkg_a_small',
          1,
          ['mod_a1'],
        ]);
        expect(await turnConfigStoreFor(repos, { locales }).load(e, old)).toBeNull();
        expect(await endedAt(old)).not.toBeNull();
        expect(await summary()).toBeNull();
        expect(await entitleCode(old)).toBe('no_access');
        // The old session's messages are kept (ended, not deleted) for the retention job.
        expect(await messageCount(old)).toBe(2);

        // Start a fresh one: no history, no sources, no summary from the lapsed package.
        const fresh = await openSession();
        expect(await repos.messages.history(ONE_A, fresh, 200)).toEqual([]);
        const profile = await repos.learnerProfiles.get(ONE_A);
        expect(profile).not.toBeNull();
        expect(profile && 'lastSummary' in profile).toBe(false);
        expect(JSON.stringify(profile)).not.toContain('module 2');
        expect(await entitleCode(fresh)).toBe('ok');
        const cfg = await turnConfigStoreFor(repos, { locales }).load(e, fresh);
        expect(cfg?.pkg).toMatchObject({ id: 'pkg_a_small', version: 1, moduleIds: ['mod_a1'] });
      },
      CASE_MS,
    );

    it(
      'version change: the same package at a new version ends the session too',
      async () => {
        await subscribe('pv_a');
        const old = await openSession();
        expect(await repos.sessions.get(ONE_A, old)).toMatchObject({ packageVersion: 1 });
        await studyIn(old, '[v1]');
        await setSummary('[v1] summary');

        await subscribe('pv_a_2');
        expect(await entitleCode(old)).toBe('no_access');
        expect(await endedAt(old)).not.toBeNull();
        expect(await summary()).toBeNull();

        const fresh = await openSession();
        expect(await repos.sessions.get(ONE_A, fresh)).toMatchObject({
          packageId: 'pkg_a',
          packageVersion: 2,
          endedAt: null,
        });
        expect(await repos.messages.history(ONE_A, fresh, 200)).toEqual([]);
        expect(await entitleCode(fresh)).toBe('ok');
      },
      CASE_MS,
    );

    it(
      'a stale turn on an already-ended session never wipes a newer summary',
      async () => {
        await subscribe('pv_a');
        const old = await openSession();
        await subscribe('pv_a_2');
        expect(await entitleCode(old)).toBe('no_access');
        // A retry of the old turn, through the store: notices the stale pin and ends it (3.16),
        // the same way the real route would before any caller opens a fresh session on this
        // triple — task 5.10d, at most one open session per (teacher, student, agent).
        expect(
          await turnConfigStoreFor(repos, { locales }).load(await entitlement(), old),
        ).toBeNull();
        const fresh = await openSession();
        await setSummary('[newer] summary of the new session');

        expect(await entitleCode(old)).toBe('no_access');
        expect(await repos.sessions.endOnPackageChange(ONE_A, old)).toEqual({ ended: false });
        expect(await summary()).toBe('[newer] summary of the new session');
        expect(await endedAt(fresh)).toBeNull();
      },
      CASE_MS,
    );

    it(
      'endOnPackageChange ends once under concurrent calls and clears the summary only then',
      async () => {
        await subscribe('pv_a_2');
        const sid = await openSession();
        await setSummary('[race] summary');
        const results = await Promise.all(
          Array.from({ length: 5 }, () => repos.sessions.endOnPackageChange(ONE_A, sid)),
        );
        expect(results.filter((r) => r.ended)).toHaveLength(1);
        expect(await summary()).toBeNull();
        expect(await endedAt(sid)).not.toBeNull();
      },
      CASE_MS,
    );

    it(
      'turnConfigStoreFor(...).load ends the session exactly once under concurrent calls',
      async () => {
        await subscribe('pv_a');
        const sid = await openSession();
        await subscribe('pv_a_2');
        await setSummary('[race] summary');
        const e = await entitlement();
        const results = await Promise.all(
          Array.from({ length: 5 }, () => turnConfigStoreFor(repos, { locales }).load(e, sid)),
        );
        expect(results).toEqual(Array.from({ length: 5 }, () => null));
        expect(await summary()).toBeNull();
        expect(await endedAt(sid)).not.toBeNull();
      },
      CASE_MS,
    );

    it(
      'endOnPackageChange works with no profile row, and refuses a session outside the scope',
      async () => {
        const evalScope = { studentId: EVAL_STUDENT, teacherId: 'tch_a' };
        expect(await repos.learnerProfiles.get(evalScope)).toBeNull();
        expect(await repos.sessions.endOnPackageChange(evalScope, 'ses_eval_a')).toEqual({
          ended: true,
        });
        expect(await repos.learnerProfiles.get(evalScope)).toBeNull();
        // Another pair's session, a missing one, a bad id: refused, nothing written.
        const before = await summary();
        expect(await kind(repos.sessions.endOnPackageChange(ONE_A, ids.session('2A')))).toBe(
          'not_found',
        );
        expect(await endedAt(ids.session('2A'))).toBeNull();
        expect(await kind(repos.sessions.endOnPackageChange(ONE_A, 'ses_nowhere'))).toBe(
          'not_found',
        );
        expect(await kind(repos.sessions.endOnPackageChange(ONE_A, 'not an id'))).toBe('invalid');
        expect(await summary()).toBe(before);
      },
      CASE_MS,
    );

    it(
      'sessions.create refuses a package that is not the agent’s or the teacher’s, or a missing version',
      async () => {
        const count = async () =>
          Number(
            (await raw.query<{ n: string }>('select count(*)::text as n from sessions')).rows[0]?.n,
          );
        const before = await count();
        const create = (packageId: string, packageVersion: number) =>
          repos.sessions.create(ONE_A, {
            agentId: 'agt_a',
            agentVersion: 1,
            packageId,
            packageVersion,
          });
        expect(await kind(create('pkg_a_draft', 1))).toBe('not_found');
        expect(await kind(create('pkg_b', 1))).toBe('not_found');
        expect(await kind(create('pkg_a', 9))).toBe('not_found');
        expect(await kind(create('pkg_nowhere', 1))).toBe('not_found');
        expect(
          await kind(
            repos.sessions.create(ONE_A, {
              agentId: 'agt_a',
              agentVersion: 1,
              packageId: 'pkg_a',
              packageVersion: -1,
            }),
          ),
        ).toBe('invalid');
        expect(await count()).toBe(before);
      },
      CASE_MS,
    );

    it(
      'a teacher preview session follows the package too: a new version restarts it',
      async () => {
        const preview = { ...SUB, preview: { packageId: 'pkg_a' } };
        const extra = { studentId: 'tch_a' };
        expect(await entitleCode('ses_preview_a', preview, extra, 'teacher_preview')).toBe('ok');
        await raw.query(
          `insert into package_versions (id, teacher_id, package_id, version, config)
         values ('pv_a_3', 'tch_a', 'pkg_a', 3, $1)`,
          [JSON.stringify(packageConfig('A', 3, [ids.module('A', 1)]))],
        );
        expect(await entitleCode('ses_preview_a', preview, extra, 'teacher_preview')).toBe(
          'no_access',
        );
        expect(await endedAt('ses_preview_a')).not.toBeNull();
        const e = await entitlement(preview, 'tch_a', 'teacher_preview');
        expect([e.packageId, e.packageVersion]).toEqual(['pkg_a', 3]);
      },
      CASE_MS,
    );
  },
);
