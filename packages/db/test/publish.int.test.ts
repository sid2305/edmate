// Task 8.7 Phase A on Postgres: the publish repository. A run is started (a fresh agent version
// and a snapshot of every package's newest version), its case results are recorded, and it ends
// failed / error, or goes live in one transaction that re-checks the teacher is verified (FOR
// SHARE). Every read is teacher-scoped except `publicScorecard`. See test/pg.ts.
import { demoAgentConfig } from '@edmate/contracts/fixtures';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { migrateDatabase } from '../src/migrate.js';
import { createDb, type DbHandle } from '../src/internal.js';
import {
  createRepositories,
  type GateCaseResult,
  type GateRunSummary,
  PublishRefusedError,
  type PublishPins,
  type Repositories,
  RepositoryError,
  type StoredScorecard,
} from '../src/index.js';
import {
  createDatabase,
  dropDatabase,
  postgresUp,
  SKIP_REASON,
  throwawayName,
  urlFor,
} from './pg.js';

const up = await postgresUp('publish repository tests');
const dbName = throwawayName();
const TEST_URL = urlFor(dbName);
let handle: DbHandle;
let repos: Repositories;
let raw: pg.Client;

let n = 0;
const STAFF = 'stf_pub_1';

interface T {
  teacherId: string;
  agentId: string;
  pkgId: string;
  courseId: string;
  styleCardId: string;
}

/** A fresh teacher: user, profile (verified unless told), course, card, agent v1, package v1. */
async function makeTeacher(
  opts: {
    verified?: boolean;
    status?: 'draft' | 'live' | 'suspended';
    pkgVersion?: boolean;
    regulatedSubject?: 'investing' | 'health' | 'law';
  } = {},
): Promise<T> {
  const k = ++n;
  const t: T = {
    teacherId: `tch_pub${k}`,
    agentId: `agt_pub${k}`,
    pkgId: `pkg_pub${k}`,
    courseId: `crs_pub${k}`,
    styleCardId: `sty_pub${k}_1`,
  };
  await raw.query(
    `insert into users (id, name, locale, market, role) values ($1, 'Pub Teacher', 'en', 'test', 'teacher')`,
    [t.teacherId],
  );
  await raw.query(
    `insert into teacher_profiles (id, user_id, slug, subject, verification_status)
     values ($1, $2, $3, 'maths', $4)`,
    [
      `tp_pub${k}`,
      t.teacherId,
      `pub-teacher-${k}`,
      opts.verified === false ? 'pending' : 'verified',
    ],
  );
  await raw.query(
    `insert into courses (id, teacher_id, title, "order") values ($1, $2, 'Course', 0)`,
    [t.courseId, t.teacherId],
  );
  await raw.query(
    `insert into modules (id, teacher_id, course_id, title, "order") values ($1, $2, $3, 'M', 0)`,
    [`mod_pub${k}`, t.teacherId, t.courseId],
  );
  await raw.query(
    `insert into style_cards (id, teacher_id, version, text) values ($1, $2, 1, 'card')`,
    [t.styleCardId, t.teacherId],
  );
  await raw.query(`insert into agents (id, teacher_id, status) values ($1, $2, $3)`, [
    t.agentId,
    t.teacherId,
    opts.status ?? 'draft',
  ]);
  await raw.query(
    `insert into agent_versions (id, teacher_id, agent_id, version, config) values ($1, $2, $3, 1, $4)`,
    [
      `av_pub${k}`,
      t.teacherId,
      t.agentId,
      JSON.stringify({
        ...demoAgentConfig,
        id: t.agentId,
        version: 1,
        teacherId: t.teacherId,
        courseId: t.courseId,
        styleCardId: t.styleCardId,
        ...(opts.regulatedSubject ? { regulatedSubject: opts.regulatedSubject } : {}),
      }),
    ],
  );
  await raw.query(
    `insert into packages (id, teacher_id, agent_id, name) values ($1, $2, $3, 'P')`,
    [t.pkgId, t.teacherId, t.agentId],
  );
  if (opts.pkgVersion !== false) await addPackageVersion(t, 1);
  return t;
}

async function addPackageVersion(t: T, version: number, pkgId = t.pkgId): Promise<void> {
  await raw.query(
    `insert into package_versions (id, teacher_id, package_id, version, config) values ($1, $2, $3, $4, '{}'::jsonb)`,
    [`pv_${pkgId}_${version}`, t.teacherId, pkgId, version],
  );
}

const scope = (t: T) => ({ teacherId: t.teacherId });
const pins = (t: T, extra: Partial<PublishPins> = {}): PublishPins => ({
  agentId: t.agentId,
  courseId: t.courseId,
  styleCardId: t.styleCardId,
  promptPackVersion: '1.0.0',
  modelPolicy: demoAgentConfig.modelPolicy,
  judgeModel: 'judge-test',
  ...extra,
});

async function failure(p: Promise<unknown>): Promise<RepositoryError> {
  const e = await p.then(
    () => new Error('resolved'),
    (x: unknown) => x,
  );
  expect(e).toBeInstanceOf(RepositoryError);
  return e as RepositoryError;
}
async function refusal(p: Promise<unknown>): Promise<PublishRefusedError> {
  const e = await failure(p);
  expect(e).toBeInstanceOf(PublishRefusedError);
  return e as PublishRefusedError;
}

const count = async (sql: string, values: unknown[] = []) =>
  Number((await raw.query<{ n: string }>(sql, values)).rows[0]?.n);
const agentRow = async (t: T) =>
  (
    await raw.query<{ status: string; live_version: number | null }>(
      'select status, live_version from agents where id = $1',
      [t.agentId],
    )
  ).rows[0]!;
const pkgLive = async (pkgId: string) =>
  (
    await raw.query<{ v: number | null }>('select live_version as v from packages where id = $1', [
      pkgId,
    ])
  ).rows[0]!.v;

const summary = (extra: Partial<GateRunSummary> = {}): GateRunSummary => ({
  groups: [
    { origin: 'platform', group: 'accuracy', total: 2, passed: 2, minPercent: 99, pass: true },
  ],
  stats: { cases: 2, notRun: 0, deadlinePassed: false },
  costMicroUsd: 1234,
  ...extra,
});

function scorecard(measured: ('hints_before_answers' | 'locked_content' | 'accuracy')[]) {
  const keys = ['hints_before_answers', 'locked_content', 'accuracy'] as const;
  return {
    pass: true,
    changes: ['first_publish'],
    categories: keys.map((key) =>
      measured.includes(key)
        ? {
            key,
            measured: true,
            total: 4,
            passed: 4,
            percent: 100,
            pass: true,
            byOrigin: [{ origin: 'platform', total: 4, passed: 4 }],
          }
        : { key, measured: false, total: 0, passed: 0, percent: null, pass: false, byOrigin: [] },
    ),
  } satisfies StoredScorecard;
}

const result = (
  caseId: string,
  passed: boolean,
  extra: Partial<GateCaseResult['details']> = {},
) => ({
  caseId,
  passed,
  details: {
    origin: 'platform' as const,
    group: 'accuracy' as const,
    suite: 'accuracy-core',
    failedChecks: passed ? [] : ['cites_source'],
    ...extra,
  },
});

/** Starts, marks running and publishes a run for t; returns the run id. */
async function publish(t: T, p: Partial<PublishPins> = {}, card = scorecard(['accuracy'])) {
  const run = await repos.publish.startRun(scope(t), pins(t, p));
  expect(await repos.publish.markRunning(scope(t), run.id)).toBe(true);
  await repos.publish.goLive(scope(t), {
    runId: run.id,
    passRate: 1,
    summary: summary(),
    scorecard: card,
  });
  return run.id;
}

/** Staff set the agent's regulated subject (12.4a repo) and optionally approve it. */
async function flag(
  t: T,
  subject: 'investing' | 'health' | 'law' | null,
  approved = false,
): Promise<void> {
  await repos.regulatedSubjects.setSubject(STAFF, { agentId: t.agentId, subject });
  if (approved) await repos.regulatedSubjects.setApproval(STAFF, { agentId: t.agentId, approved });
}

const versions = (t: T) =>
  count('select count(*) n from agent_versions where agent_id = $1', [t.agentId]);
const runs = (t: T) => count('select count(*) n from eval_runs where agent_id = $1', [t.agentId]);
const publishAudits = (t: T) =>
  count(`select count(*) n from audit_log where target = $1 and action = 'agent.publish'`, [
    `agent:${t.agentId}`,
  ]);

describe.skipIf(!up)(`publish repository on Postgres${up ? '' : ` (${SKIP_REASON})`}`, () => {
  beforeAll(async () => {
    await createDatabase(dbName);
    await migrateDatabase(TEST_URL);
    handle = createDb({ DATABASE_URL: TEST_URL });
    repos = createRepositories(handle.db);
    raw = new pg.Client({ connectionString: TEST_URL });
    await raw.connect();
    await raw.query(
      `insert into users (id, name, locale, market, role) values ($1, 'Staff', 'en', 'test', 'staff')`,
      [STAFF],
    );
  });

  afterAll(async () => {
    await raw?.end();
    await handle?.close();
    await dropDatabase(dbName);
  });

  describe('startRun refusals', () => {
    it('a malformed scope is scope; malformed pins are invalid', async () => {
      const t = await makeTeacher();
      expect((await failure(repos.publish.startRun({ teacherId: '' }, pins(t)))).kind).toBe(
        'scope',
      );
      expect(
        (await failure(repos.publish.startRun(scope(t), { ...pins(t), teacherId: 'x' } as never)))
          .kind,
      ).toBe('invalid');
      expect(
        (await failure(repos.publish.startRun(scope(t), pins(t, { promptPackVersion: 'one' }))))
          .kind,
      ).toBe('invalid');
    });

    it('no package with a version is invalid / no_packages, nothing written', async () => {
      const t = await makeTeacher({ pkgVersion: false });
      const e = await refusal(repos.publish.startRun(scope(t), pins(t)));
      expect([e.kind, e.reason, e.code]).toEqual(['invalid', 'no_packages', 'validation']);
      expect(e.message).toBe('publish.startRun: invalid');
      expect(
        await count('select count(*) n from agent_versions where agent_id = $1', [t.agentId]),
      ).toBe(1);
      expect(await count('select count(*) n from eval_runs where agent_id = $1', [t.agentId])).toBe(
        0,
      );
    });

    it('an unverified teacher is scope, nothing written', async () => {
      const t = await makeTeacher({ verified: false });
      expect((await failure(repos.publish.startRun(scope(t), pins(t)))).kind).toBe('scope');
      expect(
        await count('select count(*) n from agent_versions where agent_id = $1', [t.agentId]),
      ).toBe(1);
      expect(await count('select count(*) n from eval_runs where agent_id = $1', [t.agentId])).toBe(
        0,
      );
    });

    it('a suspended agent is invalid / suspended', async () => {
      const t = await makeTeacher({ status: 'suspended' });
      const e = await refusal(repos.publish.startRun(scope(t), pins(t)));
      expect([e.kind, e.reason]).toEqual(['invalid', 'suspended']);
    });

    it('(a) a flagged, unapproved agent is invalid / regulated_unapproved, nothing written', async () => {
      const t = await makeTeacher();
      await flag(t, 'health');
      const e = await refusal(repos.publish.startRun(scope(t), pins(t)));
      expect([e.kind, e.reason, e.message]).toEqual([
        'invalid',
        'regulated_unapproved',
        'publish.startRun: invalid',
      ]);
      expect(await versions(t)).toBe(1);
      expect(await runs(t)).toBe(0);
    });

    it('(a) the refusal comes before a stale open run is touched', async () => {
      const t = await makeTeacher();
      const old = await repos.publish.startRun(scope(t), pins(t));
      await raw.query(
        `update eval_runs set updated_at = now() - interval '3 hours' where id = $1`,
        [old.id],
      );
      await flag(t, 'investing');
      const e = await refusal(repos.publish.startRun(scope(t), pins(t)));
      expect(e.reason).toBe('regulated_unapproved');
      expect((await repos.publish.getRun(scope(t), old.id))?.status).toBe('queued');
      expect(await versions(t)).toBe(2);
    });

    it('(b) staff approval lets the run start with the staff subject', async () => {
      const t = await makeTeacher();
      await flag(t, 'health');
      await refusal(repos.publish.startRun(scope(t), pins(t)));
      await repos.regulatedSubjects.setApproval(STAFF, { agentId: t.agentId, approved: true });
      const run = await repos.publish.startRun(scope(t), pins(t));
      const v = await repos.agentVersions.get(scope(t), {
        agentId: t.agentId,
        version: run.agentVersion,
      });
      expect(v?.regulatedSubject).toBe('health');
    });

    it('(e) changing the subject clears the approval, so start is refused again', async () => {
      const t = await makeTeacher();
      await flag(t, 'health', true);
      await flag(t, 'law');
      const e = await refusal(repos.publish.startRun(scope(t), pins(t)));
      expect(e.reason).toBe('regulated_unapproved');
      expect(await versions(t)).toBe(1);
      await repos.regulatedSubjects.setApproval(STAFF, { agentId: t.agentId, approved: true });
      const run = await repos.publish.startRun(scope(t), pins(t));
      const v = await repos.agentVersions.get(scope(t), {
        agentId: t.agentId,
        version: run.agentVersion,
      });
      expect(v?.regulatedSubject).toBe('law');
    });

    it("another teacher's agent, course or style card is not_found", async () => {
      const t = await makeTeacher();
      const o = await makeTeacher();
      for (const p of [
        { agentId: o.agentId },
        { courseId: o.courseId },
        { styleCardId: o.styleCardId },
        { agentId: 'agt_missing' },
      ]) {
        expect((await failure(repos.publish.startRun(scope(t), pins(t, p)))).kind).toBe(
          'not_found',
        );
      }
      expect(
        await count('select count(*) n from eval_runs where teacher_id = $1', [t.teacherId]),
      ).toBe(0);
    });

    it('a second start while a run is open is integrity / gate_running', async () => {
      const t = await makeTeacher();
      await repos.publish.startRun(scope(t), pins(t));
      const e = await refusal(repos.publish.startRun(scope(t), pins(t)));
      expect([e.kind, e.reason]).toEqual(['integrity', 'gate_running']);
      expect(
        await count('select count(*) n from agent_versions where agent_id = $1', [t.agentId]),
      ).toBe(2);
    });

    it('a stale open run is marked error (stale) and a new run starts', async () => {
      const t = await makeTeacher();
      const old = await repos.publish.startRun(scope(t), pins(t));
      // A full-scope run (first_publish): 2 h deadline + 15 min grace.
      await raw.query(
        `update eval_runs set updated_at = now() - interval '2 hours 10 minutes' where id = $1`,
        [old.id],
      );
      await refusal(repos.publish.startRun(scope(t), pins(t)));
      await raw.query(
        `update eval_runs set updated_at = now() - interval '2 hours 16 minutes' where id = $1`,
        [old.id],
      );
      const fresh = await repos.publish.startRun(scope(t), pins(t));
      expect(fresh.id).not.toBe(old.id);
      const stale = await repos.publish.getRun(scope(t), old.id);
      expect(stale?.status).toBe('error');
      expect(stale?.summary).toEqual({ groups: [], errorCode: 'stale' });
      expect(stale?.finishedAt).not.toBeNull();
    });

    it('a partial-scope run goes stale after 15 min + 15 min since markRunning', async () => {
      const t = await makeTeacher();
      await publish(t);
      await raw.query(
        `update teacher_material_revisions set revision = revision + 1 where teacher_id = $1`,
        [t.teacherId],
      );
      await raw.query(
        `insert into teacher_material_revisions (id, teacher_id, revision) values ($1, $2, 1)
         on conflict (teacher_id) do nothing`,
        [`tmr_${t.teacherId}`, t.teacherId],
      );
      const run = await repos.publish.startRun(scope(t), pins(t));
      expect(run.changes).toEqual(['material']);
      await raw.query(
        `update eval_runs set updated_at = now() - interval '25 minutes' where id = $1`,
        [run.id],
      );
      await refusal(repos.publish.startRun(scope(t), pins(t)));
      await raw.query(
        `update eval_runs set updated_at = now() - interval '31 minutes' where id = $1`,
        [run.id],
      );
      const next = await repos.publish.startRun(scope(t), pins(t));
      expect(next.changes).toEqual(['material']);
      expect((await repos.publish.getRun(scope(t), run.id))?.status).toBe('error');
    });
  });

  describe('startRun', () => {
    it('carries the staff-set regulated subject and languages into the new version', async () => {
      const t = await makeTeacher();
      await flag(t, 'health', true);
      const run = await repos.publish.startRun(scope(t), pins(t));
      const v = await repos.agentVersions.get(scope(t), {
        agentId: t.agentId,
        version: run.agentVersion,
      });
      expect(v).toMatchObject({ regulatedSubject: 'health', languages: demoAgentConfig.languages });
    });

    it('the staff column is the only source: a subject only in the old version is not copied', async () => {
      const t = await makeTeacher({ regulatedSubject: 'health' });
      const run = await repos.publish.startRun(scope(t), pins(t));
      const v = await repos.agentVersions.get(scope(t), {
        agentId: t.agentId,
        version: run.agentVersion,
      });
      expect(v).not.toHaveProperty('regulatedSubject');
      expect(v).toMatchObject({ languages: demoAgentConfig.languages });
    });

    it('cuts agent version N+1 with the pins and snapshots every package', async () => {
      const t = await makeTeacher();
      await addPackageVersion(t, 2);
      await raw.query(
        `insert into packages (id, teacher_id, agent_id, name) values ($1, $2, $3, 'Q')`,
        [`${t.pkgId}_b`, t.teacherId, t.agentId],
      );
      await addPackageVersion(t, 1, `${t.pkgId}_b`);
      // A package with no version yet is not part of the run.
      await raw.query(
        `insert into packages (id, teacher_id, agent_id, name) values ($1, $2, $3, 'R')`,
        [`${t.pkgId}_c`, t.teacherId, t.agentId],
      );
      const run = await repos.publish.startRun(scope(t), pins(t, { promptPackVersion: '1.2.3' }));
      expect(run).toMatchObject({
        agentId: t.agentId,
        agentVersion: 2,
        status: 'queued',
        changes: ['first_publish'],
        judgeModel: 'judge-test',
        passRate: null,
        summary: null,
        scorecard: null,
        finishedAt: null,
        publishedAt: null,
      });
      expect(Number.isNaN(Date.parse(run.createdAt))).toBe(false);
      expect(run.basis).toEqual({
        agentVersion: 2,
        courseId: t.courseId,
        styleCardId: t.styleCardId,
        promptPackVersion: '1.2.3',
        modelPolicy: demoAgentConfig.modelPolicy,
        materialRevision: 0,
        packageVersions: { [t.pkgId]: 2, [`${t.pkgId}_b`]: 1 },
      });
      const v2 = await repos.agentVersions.get(scope(t), { agentId: t.agentId, version: 2 });
      expect(v2).toEqual({
        ...demoAgentConfig,
        id: t.agentId,
        version: 2,
        teacherId: t.teacherId,
        courseId: t.courseId,
        styleCardId: t.styleCardId,
        promptPackVersion: '1.2.3',
      });
      const stored = (
        await raw.query<{ suite: string; model: string; teacher_id: string }>(
          'select suite, model, teacher_id from eval_runs where id = $1',
          [run.id],
        )
      ).rows[0];
      expect(stored).toEqual({ suite: 'gate', model: 'judge-test', teacher_id: t.teacherId });
      // Nothing goes live at start.
      expect(await agentRow(t)).toEqual({ status: 'draft', live_version: null });
    });

    it('derives change kinds from the last published run', async () => {
      const t = await makeTeacher();
      await publish(t);
      expect(await agentRow(t)).toEqual({ status: 'live', live_version: 2 });

      const same = await refusal(repos.publish.startRun(scope(t), pins(t)));
      expect([same.kind, same.reason]).toEqual(['invalid', 'nothing_to_publish']);

      const fail = async (p: Partial<PublishPins> = {}) => {
        const run = await repos.publish.startRun(scope(t), pins(t, p));
        await repos.publish.finishRun(scope(t), {
          runId: run.id,
          status: 'failed',
          summary: summary(),
        });
        return run.changes;
      };
      await raw.query(
        `insert into teacher_material_revisions (id, teacher_id, revision) values ($1, $2, 3)`,
        [`tmr_${t.teacherId}`, t.teacherId],
      );
      expect(await fail()).toEqual(['material']);
      await addPackageVersion(t, 2);
      // Still compared with the last *published* run, not the failed ones.
      expect(await fail()).toEqual(['material', 'packages']);
      await raw.query(
        `insert into style_cards (id, teacher_id, version, text) values ($1, $2, 2, 'c2')`,
        [`${t.styleCardId}_2`, t.teacherId],
      );
      expect(await fail({ styleCardId: `${t.styleCardId}_2` })).toEqual([
        'material',
        'packages',
        'style_card',
      ]);
      expect(await fail({ promptPackVersion: '1.0.1' })).toEqual([
        'prompt_pack_bump',
        'material',
        'packages',
      ]);
      // A model-policy change is a prompt_pack_bump (lead, Q6); key order does not matter.
      const reordered = {
        ...demoAgentConfig.modelPolicy,
        tiers: Object.fromEntries(Object.entries(demoAgentConfig.modelPolicy.tiers).reverse()),
      } as unknown as PublishPins['modelPolicy'];
      expect(await fail({ modelPolicy: reordered })).toEqual(['material', 'packages']);
      const tiers = demoAgentConfig.modelPolicy.tiers;
      const tier = Object.keys(tiers)[0]!;
      expect(
        await fail({
          modelPolicy: {
            ...demoAgentConfig.modelPolicy,
            tiers: {
              ...tiers,
              [tier]: { ...tiers[tier as keyof typeof tiers]!, model: 'other-model' },
            },
          },
        }),
      ).toEqual(['prompt_pack_bump', 'material', 'packages']);
      await raw.query(
        `insert into courses (id, teacher_id, title, "order") values ($1, $2, 'C2', 1)`,
        [`${t.courseId}_2`, t.teacherId],
      );
      await raw.query(`update teacher_material_revisions set revision = 0 where teacher_id = $1`, [
        t.teacherId,
      ]);
      await raw.query(`delete from package_versions where id = $1`, [`pv_${t.pkgId}_2`]);
      // A course change counts as material (the outline is material).
      expect(await fail({ courseId: `${t.courseId}_2` })).toEqual(['material']);
    });

    it('a published but no longer live agent with an unchanged basis is a full re-publish', async () => {
      const t = await makeTeacher();
      await publish(t);
      await raw.query(`update agents set status = 'draft' where id = $1`, [t.agentId]);
      const run = await repos.publish.startRun(scope(t), pins(t));
      expect(run.changes).toEqual(['first_publish']);
    });
  });

  describe('markRunning, recordResults, finishRun', () => {
    it('markRunning moves queued to running once; redelivery is a no-op', async () => {
      const t = await makeTeacher();
      const run = await repos.publish.startRun(scope(t), pins(t));
      expect(await repos.publish.markRunning(scope(t), run.id)).toBe(true);
      expect(await repos.publish.markRunning(scope(t), run.id)).toBe(false);
      expect((await repos.publish.getRun(scope(t), run.id))?.status).toBe('running');
      const o = await makeTeacher();
      expect((await failure(repos.publish.markRunning(scope(o), run.id))).kind).toBe('not_found');
      expect((await failure(repos.publish.markRunning(scope(t), ''))).kind).toBe('invalid');
    });

    it('recordResults writes one row per case, idempotent on (run, case)', async () => {
      const t = await makeTeacher();
      const run = await repos.publish.startRun(scope(t), pins(t));
      const first = [result('c1', true), result('c2', false, { errorCode: 'judge_failed' })];
      expect(
        (await failure(repos.publish.recordResults(scope(t), { runId: run.id, results: first })))
          .kind,
      ).toBe('invalid');
      await repos.publish.markRunning(scope(t), run.id);
      expect(
        await repos.publish.recordResults(scope(t), { runId: run.id, results: first }),
      ).toEqual({
        written: 2,
      });
      expect(
        await repos.publish.recordResults(scope(t), {
          runId: run.id,
          results: [
            result('c2', false),
            result('c3', false, { origin: 'agent', question: 'What is 2 + 2?' }),
          ],
        }),
      ).toEqual({ written: 1 });
      expect(await repos.publish.recordResults(scope(t), { runId: run.id, results: [] })).toEqual({
        written: 0,
      });
      expect(
        await count('select count(*) n from eval_results where eval_run_id = $1', [run.id]),
      ).toBe(3);
      const failed = await repos.publish.failedCases(scope(t), run.id);
      expect(failed.map((f) => f.caseId).sort()).toEqual(['c2', 'c3']);
      expect(failed.find((f) => f.caseId === 'c2')?.details).toEqual({
        origin: 'platform',
        group: 'accuracy',
        suite: 'accuracy-core',
        failedChecks: ['cites_source'],
        errorCode: 'judge_failed',
      });
      expect(failed.find((f) => f.caseId === 'c3')?.details.question).toBe('What is 2 + 2?');
    });

    it('recordResults rejects bad details and other scopes', async () => {
      const t = await makeTeacher();
      const run = await repos.publish.startRun(scope(t), pins(t));
      await repos.publish.markRunning(scope(t), run.id);
      for (const bad of [
        [result('p1', false, { question: 'platform cases carry no question' })],
        [{ ...result('p2', true), details: { ...result('p2', true).details, extra: 1 } }],
        [result('p3', true, { group: 'nope' as never })],
        [result('p1', true), result('p1', false)],
      ]) {
        expect(
          (
            await failure(
              repos.publish.recordResults(scope(t), { runId: run.id, results: bad as never }),
            )
          ).kind,
        ).toBe('invalid');
      }
      const o = await makeTeacher();
      expect(
        (
          await failure(
            repos.publish.recordResults(scope(o), { runId: run.id, results: [result('x', true)] }),
          )
        ).kind,
      ).toBe('not_found');
      expect(
        await count('select count(*) n from eval_results where eval_run_id = $1', [run.id]),
      ).toBe(0);
    });

    it('finishRun(failed | error) sets status, finished_at and summary; never touches agents or packages', async () => {
      const t = await makeTeacher({ status: 'live' });
      await raw.query(`update agents set live_version = 1 where id = $1`, [t.agentId]);
      await raw.query(`update packages set live_version = 1 where id = $1`, [t.pkgId]);
      await addPackageVersion(t, 2);
      const run = await repos.publish.startRun(scope(t), pins(t));
      await repos.publish.markRunning(scope(t), run.id);
      await repos.publish.finishRun(scope(t), {
        runId: run.id,
        status: 'failed',
        passRate: 0.5,
        summary: summary(),
        scorecard: scorecard(['accuracy']),
      });
      const got = await repos.publish.getRun(scope(t), run.id);
      expect(got).toMatchObject({
        status: 'failed',
        passRate: 0.5,
        summary: summary(),
        publishedAt: null,
      });
      expect(got?.scorecard).toEqual(scorecard(['accuracy']));
      expect(got?.finishedAt).not.toBeNull();
      expect(await agentRow(t)).toEqual({ status: 'live', live_version: 1 });
      expect(await pkgLive(t.pkgId)).toBe(1);
      // A finished run can't be finished again or go live.
      expect(
        (
          await failure(
            repos.publish.finishRun(scope(t), {
              runId: run.id,
              status: 'error',
              summary: summary(),
            }),
          )
        ).kind,
      ).toBe('invalid');
      // A queued run can end in error (for example the queue was down); no scorecard needed.
      const q = await repos.publish.startRun(scope(t), pins(t));
      await repos.publish.finishRun(scope(t), {
        runId: q.id,
        status: 'error',
        summary: { groups: [], errorCode: 'gate_unavailable' },
      });
      expect(await repos.publish.getRun(scope(t), q.id)).toMatchObject({
        status: 'error',
        passRate: null,
        scorecard: null,
        summary: { groups: [], errorCode: 'gate_unavailable' },
      });
      const o = await makeTeacher();
      expect(
        (
          await failure(
            repos.publish.finishRun(scope(o), { runId: q.id, status: 'error', summary: summary() }),
          )
        ).kind,
      ).toBe('not_found');
      for (const bad of [
        { runId: q.id, status: 'passed', summary: summary() },
        { runId: q.id, status: 'error', summary: { ...summary(), errorCode: 'Has Spaces' } },
        { runId: q.id, status: 'error', summary: summary(), passRate: 2 },
      ]) {
        expect((await failure(repos.publish.finishRun(scope(t), bad as never))).kind).toBe(
          'invalid',
        );
      }
    });
  });

  describe('goLive', () => {
    /** Waits until `want` sessions of this database wait on a lock. */
    async function lockWaiters(want: number): Promise<void> {
      for (let i = 0; i < 500; i++) {
        // pg_stat_activity is a per-transaction snapshot; `raw` is inside one.
        await raw.query('select pg_stat_clear_snapshot()');
        const got = await count(
          `select count(*)::int as n from pg_stat_activity
           where datname = current_database() and wait_event_type = 'Lock'`,
        );
        if (got >= want) return;
        await new Promise((r) => setTimeout(r, 10));
      }
      throw new Error(`fewer than ${want} lock waiters`);
    }

    it('takes the same lock order as startRun: a re-click during goLive never deadlocks', async () => {
      // The worst interleaving, forced: startRun waits on the agent row, then goLive starts. With
      // goLive locking the run before the agent, startRun (holding the agent) would wait on the
      // run and goLive on the agent: 40P01. One lock order (advisory, profile, agent, run) can't.
      for (let i = 0; i < 3; i++) {
        const t = await makeTeacher();
        const first = await repos.publish.startRun(scope(t), pins(t));
        expect(await repos.publish.markRunning(scope(t), first.id)).toBe(true);
        await raw.query('begin');
        await raw.query('select 1 from agents where id = $1 for update', [t.agentId]);
        const again = repos.publish.startRun(scope(t), pins(t)).then(
          (r) => r,
          (e: unknown) => e,
        );
        await lockWaiters(1);
        const live = repos.publish
          .goLive(scope(t), {
            runId: first.id,
            passRate: 1,
            summary: summary(),
            scorecard: scorecard(['accuracy']),
          })
          .then(
            (r) => r,
            (e: unknown) => e,
          );
        await lockWaiters(2);
        await raw.query('commit');
        const [startResult, liveResult] = await Promise.all([again, live]);
        expect(liveResult).toEqual({ agentVersion: 2, packageVersions: { [t.pkgId]: 1 } });
        // startRun went first: the open run refuses it cleanly.
        expect(startResult).toBeInstanceOf(PublishRefusedError);
        expect((startResult as PublishRefusedError).reason).toBe('gate_running');
        expect(await agentRow(t)).toEqual({ status: 'live', live_version: 2 });
      }
    });

    it('a reject racing a publish never leaves the agent live (8.1 review)', async () => {
      // Forces the TOCTOU window the 8.1 review flagged: goLive's lockVerified takes FOR SHARE on
      // the profile (publish.ts:390-397), the same row setVerification's reject path takes FOR
      // UPDATE on. A raw transaction stands in for that reject path's lock: it takes FOR UPDATE
      // first, so goLive's FOR SHARE blocks until the raw transaction's write and commit land.
      const t = await makeTeacher();
      const run = await repos.publish.startRun(scope(t), pins(t));
      await repos.publish.markRunning(scope(t), run.id);
      await raw.query('begin');
      await raw.query('select 1 from teacher_profiles where user_id = $1 for update', [
        t.teacherId,
      ]);
      const live = repos.publish
        .goLive(scope(t), {
          runId: run.id,
          passRate: 1,
          summary: summary(),
          scorecard: scorecard(['accuracy']),
        })
        .then(
          (r) => r,
          (e: unknown) => e,
        );
      await lockWaiters(1);
      await raw.query(
        `update teacher_profiles set verification_status = 'rejected' where user_id = $1`,
        [t.teacherId],
      );
      await raw.query('commit');
      const liveResult = await live;
      expect(liveResult).toBeInstanceOf(RepositoryError);
      expect((liveResult as RepositoryError).kind).toBe('scope');
      // The lock order closed the window: the agent never reached `live`.
      expect(await agentRow(t)).toEqual({ status: 'draft', live_version: null });
      expect((await repos.publish.getRun(scope(t), run.id))?.status).toBe('running');
    });

    it('publishes the agent version and every package version in one transaction, with audit rows', async () => {
      const t = await makeTeacher();
      await raw.query(
        `insert into packages (id, teacher_id, agent_id, name) values ($1, $2, $3, 'Q')`,
        [`${t.pkgId}_b`, t.teacherId, t.agentId],
      );
      await addPackageVersion(t, 1, `${t.pkgId}_b`);
      await addPackageVersion(t, 2, `${t.pkgId}_b`);
      const run = await repos.publish.startRun(scope(t), pins(t));
      // Not running yet: invalid.
      expect(
        (
          await failure(
            repos.publish.goLive(scope(t), {
              runId: run.id,
              passRate: 1,
              summary: summary(),
              scorecard: scorecard(['accuracy']),
            }),
          )
        ).kind,
      ).toBe('invalid');
      await repos.publish.markRunning(scope(t), run.id);
      // A version cut after the run started is not what the gate checked: not published.
      await addPackageVersion(t, 3, `${t.pkgId}_b`);
      expect(
        await repos.publish.goLive(scope(t), {
          runId: run.id,
          passRate: 1,
          summary: summary(),
          scorecard: scorecard(['accuracy']),
        }),
      ).toEqual({ agentVersion: 2, packageVersions: { [t.pkgId]: 1, [`${t.pkgId}_b`]: 2 } });
      expect(await agentRow(t)).toEqual({ status: 'live', live_version: 2 });
      expect(await pkgLive(t.pkgId)).toBe(1);
      expect(await pkgLive(`${t.pkgId}_b`)).toBe(2);
      const got = await repos.publish.getRun(scope(t), run.id);
      expect(got?.status).toBe('passed');
      expect(got?.publishedAt).not.toBeNull();
      expect(got?.finishedAt).not.toBeNull();
      expect(got?.scorecard).toEqual(scorecard(['accuracy']));
      const audits = (
        await raw.query<{
          action: string;
          target: string;
          actor: string;
          actor_role: string;
          after: unknown;
        }>(
          `select action, target, actor, actor_role, after from audit_log where teacher_id = $1 order by action, target`,
          [t.teacherId],
        )
      ).rows;
      expect(audits).toEqual([
        {
          action: 'agent.publish',
          target: `agent:${t.agentId}`,
          actor: t.teacherId,
          actor_role: 'teacher',
          after: { status: 'live', liveVersion: 2, runId: run.id },
        },
        {
          action: 'package.publish',
          target: `package:${t.pkgId}`,
          actor: t.teacherId,
          actor_role: 'teacher',
          after: { liveVersion: 1, runId: run.id },
        },
        {
          action: 'package.publish',
          target: `package:${t.pkgId}_b`,
          actor: t.teacherId,
          actor_role: 'teacher',
          after: { liveVersion: 2, runId: run.id },
        },
      ]);
      // Twice is invalid: the run is no longer running.
      expect(
        (
          await failure(
            repos.publish.goLive(scope(t), {
              runId: run.id,
              passRate: 1,
              summary: summary(),
              scorecard: scorecard(['accuracy']),
            }),
          )
        ).kind,
      ).toBe('invalid');
    });

    it('an unverified teacher at goLive time is scope and nothing changes', async () => {
      const t = await makeTeacher();
      const run = await repos.publish.startRun(scope(t), pins(t));
      await repos.publish.markRunning(scope(t), run.id);
      await repos.teacherProfiles.setVerification(scope(t), { status: 'rejected', by: STAFF });
      const audits = await count('select count(*) n from audit_log where teacher_id = $1', [
        t.teacherId,
      ]);
      const input = { runId: run.id, passRate: 1, summary: summary(), scorecard: scorecard([]) };
      expect((await failure(repos.publish.goLive(scope(t), input))).kind).toBe('scope');
      expect(await agentRow(t)).toEqual({ status: 'draft', live_version: null });
      expect(await pkgLive(t.pkgId)).toBeNull();
      expect((await repos.publish.getRun(scope(t), run.id))?.status).toBe('running');
      expect(
        await count('select count(*) n from audit_log where teacher_id = $1', [t.teacherId]),
      ).toBe(audits);
    });

    it('an agent suspended while the gate ran never goes live', async () => {
      const t = await makeTeacher();
      const run = await repos.publish.startRun(scope(t), pins(t));
      await repos.publish.markRunning(scope(t), run.id);
      await raw.query(`update agents set status = 'suspended' where id = $1`, [t.agentId]);
      const e = await refusal(
        repos.publish.goLive(scope(t), {
          runId: run.id,
          passRate: 1,
          summary: summary(),
          scorecard: scorecard([]),
        }),
      );
      expect([e.kind, e.reason]).toEqual(['invalid', 'suspended']);
      expect(await agentRow(t)).toEqual({ status: 'suspended', live_version: null });
    });

    describe('(c) the regulated re-check', () => {
      const input = (runId: string) => ({
        runId,
        passRate: 1,
        summary: summary(),
        scorecard: scorecard([]),
      });
      async function refusedAtGoLive(t: T, runId: string): Promise<void> {
        const e = await refusal(repos.publish.goLive(scope(t), input(runId)));
        expect([e.kind, e.reason, e.message]).toEqual([
          'invalid',
          'regulated_unapproved',
          'publish.goLive: invalid',
        ]);
        expect(await agentRow(t)).toEqual({ status: 'draft', live_version: null });
        expect(await pkgLive(t.pkgId)).toBeNull();
        expect(await publishAudits(t)).toBe(0);
        expect((await repos.publish.getRun(scope(t), runId))?.status).toBe('running');
      }

      it('a run started before the flag is refused at goLive', async () => {
        const t = await makeTeacher();
        const run = await repos.publish.startRun(scope(t), pins(t));
        await repos.publish.markRunning(scope(t), run.id);
        await flag(t, 'health');
        await refusedAtGoLive(t, run.id);
      });

      it('a run started before the flag is refused even once staff approve the flag', async () => {
        const t = await makeTeacher();
        const run = await repos.publish.startRun(scope(t), pins(t));
        await repos.publish.markRunning(scope(t), run.id);
        // Approved, but the run's version was cut with no subject.
        await flag(t, 'health', true);
        await refusedAtGoLive(t, run.id);
      });

      it('a run started before a revoke is refused at goLive', async () => {
        const t = await makeTeacher();
        await flag(t, 'law', true);
        const run = await repos.publish.startRun(scope(t), pins(t));
        await repos.publish.markRunning(scope(t), run.id);
        await repos.regulatedSubjects.setApproval(STAFF, { agentId: t.agentId, approved: false });
        await refusedAtGoLive(t, run.id);
      });

      it('a run whose version subject differs from the staff subject is refused', async () => {
        const t = await makeTeacher();
        await flag(t, 'health', true);
        const run = await repos.publish.startRun(scope(t), pins(t));
        await repos.publish.markRunning(scope(t), run.id);
        await flag(t, 'investing', true);
        await refusedAtGoLive(t, run.id);
      });

      it('a run cut with a subject staff later cleared is refused', async () => {
        const t = await makeTeacher();
        await flag(t, 'health', true);
        const run = await repos.publish.startRun(scope(t), pins(t));
        await repos.publish.markRunning(scope(t), run.id);
        await flag(t, null);
        await refusedAtGoLive(t, run.id);
      });

      it('an approved agent whose subject is unchanged goes live with one publish audit row', async () => {
        const t = await makeTeacher();
        await flag(t, 'health', true);
        const runId = await publish(t);
        expect(await agentRow(t)).toEqual({ status: 'live', live_version: 2 });
        expect(await publishAudits(t)).toBe(1);
        expect((await repos.publish.getRun(scope(t), runId))?.status).toBe('passed');
      });
    });

    it("another teacher's run is not_found; bad input is invalid", async () => {
      const t = await makeTeacher();
      const o = await makeTeacher();
      const run = await repos.publish.startRun(scope(t), pins(t));
      await repos.publish.markRunning(scope(t), run.id);
      const input = { runId: run.id, passRate: 1, summary: summary(), scorecard: scorecard([]) };
      expect((await failure(repos.publish.goLive(scope(o), input))).kind).toBe('not_found');
      expect(
        (
          await failure(
            repos.publish.goLive(scope(t), { ...input, scorecard: { pass: true } } as never),
          )
        ).kind,
      ).toBe('invalid');
      expect(await agentRow(t)).toEqual({ status: 'draft', live_version: null });
    });
  });

  describe('teacher-scoped reads', () => {
    it('latestRun and failedCases are the scope teacher’s only', async () => {
      const a = await makeTeacher();
      const b = await makeTeacher();
      expect(await repos.publish.latestRun(scope(a))).toBeNull();
      const first = await publish(a);
      await addPackageVersion(a, 2);
      const second = await repos.publish.startRun(scope(a), pins(a));
      await repos.publish.markRunning(scope(a), second.id);
      await repos.publish.recordResults(scope(a), {
        runId: second.id,
        results: [result('f1', false), result('ok', true)],
      });
      expect((await repos.publish.latestRun(scope(a)))?.id).toBe(second.id);
      expect(await repos.publish.latestRun(scope(b))).toBeNull();
      expect(await repos.publish.getRun(scope(b), second.id)).toBeNull();
      expect(await repos.publish.getRun(scope(a), 'run_missing')).toBeNull();
      expect(await repos.publish.failedCases(scope(b), second.id)).toEqual([]);
      expect((await repos.publish.failedCases(scope(a), second.id)).map((f) => f.caseId)).toEqual([
        'f1',
      ]);
      expect(await repos.publish.failedCases(scope(a), first)).toEqual([]);
      expect((await failure(repos.publish.latestRun({ teacherId: 'bad id!' }))).kind).toBe('scope');
      expect((await failure(repos.publish.failedCases(scope(a), ''))).kind).toBe('invalid');
    });

    it('failedCases returns at most 500, newest first', async () => {
      const t = await makeTeacher();
      const run = await repos.publish.startRun(scope(t), pins(t));
      await repos.publish.markRunning(scope(t), run.id);
      await repos.publish.recordResults(scope(t), {
        runId: run.id,
        results: Array.from({ length: 500 }, (_, i) => result(`old${i}`, false)),
      });
      await repos.publish.recordResults(scope(t), {
        runId: run.id,
        results: [result('newest', false)],
      });
      const got = await repos.publish.failedCases(scope(t), run.id);
      expect(got).toHaveLength(500);
      expect(got[0]?.caseId).toBe('newest');
    });

    it('a corrupted stored row is integrity, never returned', async () => {
      const t = await makeTeacher();
      const run = await repos.publish.startRun(scope(t), pins(t));
      await raw.query(`update eval_runs set summary = '{"bad": 1}'::jsonb where id = $1`, [run.id]);
      expect((await failure(repos.publish.getRun(scope(t), run.id))).kind).toBe('integrity');
      expect((await failure(repos.publish.latestRun(scope(t)))).kind).toBe('integrity');
      await raw.query(`update eval_runs set summary = null, status = 'error' where id = $1`, [
        run.id,
      ]);
      await raw.query(
        `insert into eval_results (id, eval_run_id, case_id, passed, details) values ('er_bad', $1, 'bad', false, '{"x":1}')`,
        [run.id],
      );
      expect((await failure(repos.publish.failedCases(scope(t), run.id))).kind).toBe('integrity');
    });

    it('offline eval_runs rows (no agent, no status) are never publish runs', async () => {
      const t = await makeTeacher();
      await raw.query(
        `insert into eval_runs (id, teacher_id, agent_version_id, suite, model) values ($1, $2, $3, 'accuracy', 'm')`,
        [`er_off_${t.teacherId}`, t.teacherId, `av_pub${t.teacherId.slice(7)}`],
      );
      expect(await repos.publish.latestRun(scope(t))).toBeNull();
      expect(await repos.publish.getRun(scope(t), `er_off_${t.teacherId}`)).toBeNull();
    });
  });

  describe('changedSinceLastPublish', () => {
    /** +1 on the teacher's material revision, the same upsert `chunks.ts`' `bumpRevision` uses
     * for every create, replace and delete, so a deleted upload counts as a change too. */
    async function bumpMaterial(t: T): Promise<void> {
      await raw.query(
        `insert into teacher_material_revisions (id, teacher_id, revision)
         values ($1, $2, 1)
         on conflict (teacher_id) do update set revision = teacher_material_revisions.revision + 1`,
        [`tmr_${t.teacherId}`, t.teacherId],
      );
    }

    // The schema has no course-delete path today (teacher.lifecycle never removes a course), so
    // this is a synthetic/defensive state, matching the file's house style for corrupted-row
    // defensiveness (see 'a corrupted stored row is integrity, never returned' above): it checks
    // the outline sub-select's NULL-safety directly rather than a state a product flow reaches.
    it('reads as not changed (false) when the teacher has no course row left', async () => {
      const t = await makeTeacher();
      await publish(t);
      // Delete modules first (course_id FK), then the course itself, leaving the outline
      // sub-select with zero rows -- NULL, not a definite true/false, pre-fix.
      await raw.query(`delete from modules where course_id = $1`, [t.courseId]);
      await raw.query(`delete from courses where id = $1`, [t.courseId]);
      // Every other basis signal still matches the last published run exactly.
      expect(await repos.publish.changedSinceLastPublish(scope(t))).toBe(false);
    });

    it('is false with no published run; true after each basis signal changes; false again once a republish picks them all up', async () => {
      const t = await makeTeacher();
      const other = await makeTeacher();
      expect(await repos.publish.changedSinceLastPublish(scope(t))).toBe(false);

      await publish(t);
      expect(await repos.publish.changedSinceLastPublish(scope(t))).toBe(false);

      // Style card edit: a new immutable row, a new id.
      const card = await repos.styleCards.create(scope(t), { text: 'v2 card', mistakeTags: [] });
      expect(await repos.publish.changedSinceLastPublish(scope(t))).toBe(true);

      // Outline edit: courses.updated_at moves past the last publish's published_at.
      await raw.query(`update courses set updated_at = now() where id = $1`, [t.courseId]);
      expect(await repos.publish.changedSinceLastPublish(scope(t))).toBe(true);

      // A new package version.
      await addPackageVersion(t, 2);
      expect(await repos.publish.changedSinceLastPublish(scope(t))).toBe(true);

      // A new upload (bumps teacher_material_revisions).
      await bumpMaterial(t);
      expect(await repos.publish.changedSinceLastPublish(scope(t))).toBe(true);

      // A deleted upload bumps the same counter (chunks.ts' documents.delete path; no new code).
      await bumpMaterial(t);
      expect(await repos.publish.changedSinceLastPublish(scope(t))).toBe(true);

      // A second goLive whose basis picks up every signal above resets the note.
      await publish(t, { styleCardId: card.id });
      expect(await repos.publish.changedSinceLastPublish(scope(t))).toBe(false);

      // Another teacher's edits never flip this teacher's flag (other never published, so its
      // own flag stays false too: nothing to compare).
      await repos.styleCards.create(scope(other), { text: 'other card', mistakeTags: [] });
      expect(await repos.publish.changedSinceLastPublish(scope(t))).toBe(false);
      expect(await repos.publish.changedSinceLastPublish(scope(other))).toBe(false);

      expect(
        (await failure(repos.publish.changedSinceLastPublish({ teacherId: 'bad id!' }))).kind,
      ).toBe('scope');
      expect((await failure(repos.publish.changedSinceLastPublish({ teacherId: '' }))).kind).toBe(
        'scope',
      );
    });
  });

  describe('publicScorecard', () => {
    it('is null for a draft, suspended, unknown agent or an unverified teacher', async () => {
      const t = await makeTeacher();
      expect(await repos.publish.publicScorecard({ agentId: t.agentId })).toBeNull();
      await publish(t, {}, scorecard(['accuracy', 'locked_content', 'hints_before_answers']));
      expect(await repos.publish.publicScorecard({ agentId: t.agentId })).not.toBeNull();
      await raw.query(
        `update teacher_profiles set verification_status = 'pending' where user_id = $1`,
        [t.teacherId],
      );
      expect(await repos.publish.publicScorecard({ agentId: t.agentId })).toBeNull();
      await raw.query(
        `update teacher_profiles set verification_status = 'verified' where user_id = $1`,
        [t.teacherId],
      );
      await raw.query(`update agents set status = 'suspended' where id = $1`, [t.agentId]);
      expect(await repos.publish.publicScorecard({ agentId: t.agentId })).toBeNull();
      await raw.query(`update agents set status = 'draft' where id = $1`, [t.agentId]);
      expect(await repos.publish.publicScorecard({ agentId: t.agentId })).toBeNull();
      expect(await repos.publish.publicScorecard({ agentId: 'agt_nobody' })).toBeNull();
      expect((await failure(repos.publish.publicScorecard({ agentId: '' }))).kind).toBe('scope');
      expect(
        (
          await failure(
            repos.publish.publicScorecard({ agentId: t.agentId, teacherId: 'x' } as never),
          )
        ).kind,
      ).toBe('scope');
    });

    it('a live agent with no passed run (seeded live) has no scorecard', async () => {
      const t = await makeTeacher({ status: 'live' });
      expect(await repos.publish.publicScorecard({ agentId: t.agentId })).toBeNull();
    });

    it('carries each category forward from the newest passed run that measured it', async () => {
      const t = await makeTeacher();
      const r1 = await publish(
        t,
        {},
        scorecard(['accuracy', 'locked_content', 'hints_before_answers']),
      );
      await raw.query(
        `update eval_runs set published_at = now() - interval '2 days' where id = $1`,
        [r1],
      );
      // A failed run is never on the public card.
      await addPackageVersion(t, 2);
      const failed = await repos.publish.startRun(scope(t), pins(t));
      await repos.publish.finishRun(scope(t), {
        runId: failed.id,
        status: 'failed',
        summary: summary(),
        scorecard: scorecard(['accuracy']),
      });
      const r2 = await publish(t, {}, scorecard(['accuracy']));
      const got = await repos.publish.publicScorecard({ agentId: t.agentId });
      const date = async (id: string) =>
        (
          await raw.query<{ d: Date }>('select published_at d from eval_runs where id = $1', [id])
        ).rows[0]!.d.toISOString();
      expect(got?.publishedAt).toBe(await date(r2));
      expect(got?.categories.map((c) => [c.key, c.measured, c.measuredAt])).toEqual([
        ['hints_before_answers', true, await date(r1)],
        ['locked_content', true, await date(r1)],
        ['accuracy', true, await date(r2)],
      ]);
      expect(Object.keys(got ?? {}).sort()).toEqual(['categories', 'publishedAt']);
    });

    it('a category no passed run measured stays unmeasured', async () => {
      const t = await makeTeacher();
      await publish(t, {}, scorecard(['accuracy']));
      const got = await repos.publish.publicScorecard({ agentId: t.agentId });
      expect(got?.categories.map((c) => [c.key, c.measured, c.measuredAt])).toEqual([
        ['hints_before_answers', false, null],
        ['locked_content', false, null],
        ['accuracy', true, got?.publishedAt],
      ]);
    });

    it('a corrupted stored scorecard is integrity', async () => {
      const t = await makeTeacher();
      const r = await publish(t);
      await raw.query(`update eval_runs set scorecard = '{"pass": "yes"}'::jsonb where id = $1`, [
        r,
      ]);
      expect((await failure(repos.publish.publicScorecard({ agentId: t.agentId }))).kind).toBe(
        'integrity',
      );
    });
  });
});
