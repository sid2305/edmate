// Task 3.2 on Postgres: entitlementStoreFor resolves all three sources server-side. Paused is
// returned (entitle refuses it), ended gives null; preview and eval need no subscription; locked
// = the teacher's modules minus the package's; an unknown market maps to `global`.
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { migrateDatabase } from '../src/migrate.js';
import { createDb, type DbHandle } from '../src/internal.js';
import {
  createRepositories,
  entitlementStoreFor,
  type EntitlementStoreOptions,
  RepositoryError,
  type Repositories,
} from '../src/index.js';
import { EVAL_STUDENT, learnerClear, packMarket, seedAccess, studentMarket } from './access-seed.js';
import {
  createDatabase,
  dropDatabase,
  postgresUp,
  SKIP_REASON,
  throwawayName,
  urlFor,
} from './pg.js';

const up = await postgresUp('entitlement store tests');
const dbName = throwawayName();
const TEST_URL = urlFor(dbName);
let handle: DbHandle;
let repos: Repositories;
let raw: pg.Client;

const AT = '2026-10-18T10:00:00.000Z';
// `market` is the preview market only (9.4a): a subscription reads the student's own market.
const OPTS: EntitlementStoreOptions = { market: 'IN', packMarket, learnerClear, studentMarket };
const PREVIEW: EntitlementStoreOptions = { ...OPTS, preview: { packageId: 'pkg_a' } };
const EVAL: EntitlementStoreOptions = {
  ...OPTS,
  eval: { teacherId: 'tch_a', packageId: 'pkg_a', version: 1, market: 'US' },
};

const EVAL_ONLY = { eval: { teacherId: 'tch_a', packageId: 'pkg_a', version: 1, market: 'US' } };

const sub = (studentId: string, agentId: string, opts = OPTS) =>
  entitlementStoreFor(repos, opts).resolve({ studentId, agentId, source: 'subscription' }, AT);
const preview = (studentId: string, agentId: string, opts = PREVIEW) =>
  entitlementStoreFor(repos, opts).resolve({ studentId, agentId, source: 'teacher_preview' }, AT);
const evalRun = (agentId: string, opts = EVAL) =>
  entitlementStoreFor(repos, opts).resolve(
    { studentId: EVAL_STUDENT, agentId, source: 'eval' },
    AT,
  );

describe.skipIf(!up)(`entitlementStoreFor on Postgres${up ? '' : ` (${SKIP_REASON})`}`, () => {
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

  describe('subscription', () => {
    it("resolves the student's live subscription with the teacher's locks", async () => {
      expect(await sub('stu_1', 'agt_a')).toEqual({
        source: 'subscription',
        subscriptionId: 'sub_1a',
        studentId: 'stu_1',
        teacherId: 'tch_a',
        agentId: 'agt_a',
        market: 'IN',
        packageId: 'pkg_a',
        packageVersion: 1,
        status: 'active',
        periodEnd: '2026-12-01T00:00:00.000Z',
        allowedModuleIds: ['mod_a1'],
        lockedModuleIds: ['mod_a2'],
        skills: ['explain', 'coach'],
      });
      expect((await sub('stu_2', 'agt_b'))?.teacherId).toBe('tch_b');
    });

    it('an unknown market maps to global', async () => {
      const zz = { ...OPTS, studentMarket: async () => 'ZZ' };
      expect((await sub('stu_1', 'agt_a', zz))?.market).toBe('global');
    });

    it('returns paused (entitle refuses it) and null for an ended subscription', async () => {
      expect((await sub('stu_2', 'agt_a'))?.status).toBe('paused');
      expect(await sub('stu_1', 'agt_b')).toBeNull();
    });

    it('draft, suspended and unknown agents give null', async () => {
      for (const agentId of ['agt_a_draft', 'agt_b_susp', 'agt_nowhere']) {
        expect(await sub('stu_1', agentId), agentId).toBeNull();
      }
    });

    it("a subscription to the teacher's other agent, or to another teacher's package, gives null", async () => {
      await raw.query(`update agents set status = 'live' where id = 'agt_a_draft'`);
      expect(await sub('stu_1', 'agt_a_draft')).toBeNull();
      await raw.query(`update agents set status = 'draft' where id = 'agt_a_draft'`);

      await raw.query(`update subscriptions set package_version_id = 'pv_b' where id = 'sub_1a'`);
      expect(await sub('stu_1', 'agt_a')).toBeNull();
      await raw.query(`update subscriptions set package_version_id = 'pv_a' where id = 'sub_1a'`);
    });

    it('an entitlement that cannot be valid throws integrity, never resolves', async () => {
      const bad = { ...OPTS, packMarket: () => 'not a market' };
      await expect(sub('stu_1', 'agt_a', bad)).rejects.toMatchObject({
        kind: 'integrity',
        method: 'entitlementStore.resolve',
      });
      await expect(sub('stu_1', 'agt_a', bad)).rejects.toBeInstanceOf(RepositoryError);
    });
  });

  describe('teacher preview and eval need no subscription', () => {
    it('preview: the teacher previews their own agent at the newest package version', async () => {
      const count = await raw.query<{ n: number }>(
        `select count(*)::int as n from subscriptions where student_id = 'tch_a'`,
      );
      expect(count.rows[0]?.n).toBe(0);
      const e = await preview('tch_a', 'agt_a');
      expect(e).toEqual({
        source: 'teacher_preview',
        studentId: 'tch_a',
        teacherId: 'tch_a',
        agentId: 'agt_a',
        market: 'IN',
        packageId: 'pkg_a',
        packageVersion: 2,
        status: 'active',
        periodEnd: AT,
        allowedModuleIds: ['mod_a1', 'mod_a2'],
        lockedModuleIds: [],
        skills: ['explain', 'coach'],
      });
      expect(
        (await preview('tch_a', 'agt_a_draft', { ...OPTS, preview: { packageId: 'pkg_a_draft' } }))
          ?.packageId,
      ).toBe('pkg_a_draft');
    });

    it("preview: a student, another teacher, another teacher's or agent's package give null", async () => {
      expect(await preview('stu_1', 'agt_a')).toBeNull();
      expect(await preview('tch_b', 'agt_a')).toBeNull();
      for (const packageId of ['pkg_b', 'pkg_a_draft']) {
        expect(await preview('tch_a', 'agt_a', { ...OPTS, preview: { packageId } })).toBeNull();
      }
      expect(await preview('tch_a', 'agt_a', OPTS)).toBeNull();
    });

    it('eval: the pinned version and the eval market, with no subscription', async () => {
      const e = await evalRun('agt_a');
      expect(e).toMatchObject({
        source: 'eval',
        studentId: EVAL_STUDENT,
        teacherId: 'tch_a',
        packageId: 'pkg_a',
        packageVersion: 1,
        market: 'global',
        status: 'active',
        periodEnd: AT,
      });
      expect(e && 'subscriptionId' in e).toBe(false);
    });

    it("eval: no eval config, another teacher, a missing version or another agent's package give null", async () => {
      const ev = EVAL.eval!;
      expect(await evalRun('agt_a', OPTS)).toBeNull();
      expect(await evalRun('agt_a', { ...OPTS, eval: { ...ev, teacherId: 'tch_b' } })).toBeNull();
      expect(await evalRun('agt_a', { ...OPTS, eval: { ...ev, version: 9 } })).toBeNull();
      expect(
        await evalRun('agt_a', { ...OPTS, eval: { ...ev, packageId: 'pkg_a_draft' } }),
      ).toBeNull();
    });
  });

  describe("studentMarket (9.4a): a subscription runs in the student's own market", () => {
    const perStudent = (calls: string[]): EntitlementStoreOptions => ({
      ...OPTS,
      market: 'ZZ',
      studentMarket: async (studentId) => {
        calls.push(studentId);
        return studentId === 'stu_1' ? 'IN' : 'global';
      },
    });

    it('asks for the resolving student, fresh each time, never the fixed market', async () => {
      const calls: string[] = [];
      expect((await sub('stu_1', 'agt_a', perStudent(calls)))?.market).toBe('IN');
      expect((await sub('stu_2', 'agt_b', perStudent(calls)))?.market).toBe('global');
      expect((await sub('stu_1', 'agt_a', perStudent(calls)))?.market).toBe('IN');
      expect(calls).toEqual(['stu_1', 'stu_2', 'stu_1']);
    });

    it('is not asked when there is no entitlement to build', async () => {
      const calls: string[] = [];
      expect(await sub('stu_1', 'agt_b', perStudent(calls))).toBeNull();
      expect(await sub('stu_1', 'agt_nowhere', perStudent(calls))).toBeNull();
      expect(calls).toEqual([]);
    });

    it('preview and eval keep their own market and do not ask', async () => {
      const calls: string[] = [];
      // The student market would say global for tch_a; preview keeps the fixed IN.
      const opts = { ...perStudent(calls), market: 'IN', preview: { packageId: 'pkg_a' } };
      expect((await preview('tch_a', 'agt_a', opts))?.market).toBe('IN');
      const evalIn = { eval: { ...EVAL_ONLY.eval, market: 'IN' } };
      expect((await evalRun('agt_a', { ...perStudent(calls), ...evalIn }))?.market).toBe('IN');
      expect(calls).toEqual([]);
    });

    it('left out, a subscription resolve fails loudly (integrity), never null or the fixed market (9.4d)', async () => {
      const without: EntitlementStoreOptions = { ...OPTS };
      delete without.studentMarket;
      const err = await sub('stu_1', 'agt_a', without).catch((e: unknown) => e);
      expect(err).toBeInstanceOf(RepositoryError);
      expect((err as RepositoryError).kind).toBe('integrity');
      // A wiring mistake, so it is loud for every student, even one with no subscription.
      await expect(sub('stu_1', 'agt_nowhere', without)).rejects.toBeInstanceOf(RepositoryError);
      // Preview and eval roots never need it.
      expect((await preview('tch_a', 'agt_a', { ...without, preview: { packageId: 'pkg_a' } }))?.market).toBe('IN');
    });

    it('an error from it fails the resolve', async () => {
      const failing = { ...OPTS, studentMarket: () => Promise.reject(new Error('identity down')) };
      await expect(sub('stu_1', 'agt_a', failing)).rejects.toThrow('identity down');
    });
  });

  describe('learnerClear (1.7): a learner held at the age gate has no subscription entitlement', () => {
    const held = (calls: string[], clear = false): EntitlementStoreOptions => ({
      ...OPTS,
      preview: { packageId: 'pkg_a' },
      eval: { teacherId: 'tch_a', packageId: 'pkg_a', version: 1, market: 'US' },
      learnerClear: async (studentId) => {
        calls.push(studentId);
        return clear;
      },
    });

    it('false: a live subscription resolves to null; asked fresh on every resolve', async () => {
      const calls: string[] = [];
      expect(await sub('stu_1', 'agt_a', held(calls))).toBeNull();
      expect(await sub('stu_1', 'agt_a', held(calls))).toBeNull();
      expect(calls).toEqual(['stu_1', 'stu_1']);
      expect(await sub('stu_1', 'agt_a', held(calls, true))).toMatchObject({
        subscriptionId: 'sub_1a',
      });
    });

    it('teacher preview and eval do not ask', async () => {
      const calls: string[] = [];
      expect(await preview('tch_a', 'agt_a', held(calls))).toMatchObject({ packageId: 'pkg_a' });
      expect(await evalRun('agt_a', held(calls))).toMatchObject({ packageId: 'pkg_a' });
      expect(calls).toEqual([]);
    });

    it('an error from it fails the resolve, never clears', async () => {
      const failing = { ...OPTS, learnerClear: () => Promise.reject(new Error('identity down')) };
      await expect(sub('stu_1', 'agt_a', failing)).rejects.toThrow('identity down');
    });
  });
});
