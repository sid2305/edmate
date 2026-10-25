// Task 8.6b on Postgres: agents.ensureDraft makes a teacher's one draft agent (v1 pinned to their
// course and style card), and the packages repository creates, versions and lists that teacher's
// packages. Every write is scoped to the teacher: a foreign course, style card, agent, module or
// package fails closed and writes nothing. See test/pg.ts to start Postgres.
import {
  AgentConfigSchema,
  type ModelPolicy,
  PackageConfigSchema,
  type PackageConfig,
} from '@edmate/contracts';
import { demoAgentConfig, demoPackageFree, demoPackagePaid } from '@edmate/contracts/fixtures';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { migrateDatabase } from '../src/migrate.js';
import { createDb, type DbHandle } from '../src/internal.js';
import * as s from '../src/internal.js';
import {
  createRepositories,
  PACKAGES_MAX,
  type PackageDraft,
  type Repositories,
  RepositoryError,
} from '../src/index.js';
import { seedAccess } from './access-seed.js';
import { ids, teacherId } from './isolation-seed.js';
import {
  createDatabase,
  dropDatabase,
  postgresUp,
  SKIP_REASON,
  throwawayName,
  urlFor,
} from './pg.js';

const up = await postgresUp('packages tests');
const dbName = throwawayName();
const TEST_URL = urlFor(dbName);
let handle: DbHandle;
let repos: Repositories;
let raw: pg.Client;

const A = { teacherId: teacherId('A') };
const B = { teacherId: teacherId('B') };
const FRESH = { teacherId: 'tch_pk_fresh' };
const RACE = { teacherId: 'tch_pk_race' };
const BARE = { teacherId: 'tch_pk_bare' };
const MANY = { teacherId: 'tch_pk_many' };
const BROKEN = { teacherId: 'tch_pk_broken' };
const TEACHERS = [FRESH, RACE, BARE, MANY, BROKEN];

const POLICY: ModelPolicy = demoAgentConfig.modelPolicy;
const PACK = '1.2.0';

/** What each fresh teacher owns once set up: their default course, module and a style card. */
const owned: Record<string, { courseId: string; moduleId: string; styleCardId: string }> = {};

async function failure(p: Promise<unknown>): Promise<{ kind: string; method: string }> {
  const e = await p.then(
    () => new Error('resolved'),
    (x: unknown) => x,
  );
  expect(e).toBeInstanceOf(RepositoryError);
  const { kind, method } = e as RepositoryError;
  return { kind, method };
}

const count = async (sqlText: string, args: unknown[]) =>
  Number((await raw.query<{ n: string }>(sqlText, args)).rows[0]?.n);
const agentCount = (tid: string) =>
  count('select count(*) as n from agents where teacher_id = $1', [tid]);
const agentVersionCount = (tid: string) =>
  count('select count(*) as n from agent_versions where teacher_id = $1', [tid]);
const packageCount = (tid: string) =>
  count('select count(*) as n from packages where teacher_id = $1', [tid]);
const versionCount = (tid: string) =>
  count('select count(*) as n from package_versions where teacher_id = $1', [tid]);

/** A package config minus the ids the repository fills in. */
const withoutIds = (c: PackageConfig): PackageDraft =>
  Object.fromEntries(
    Object.entries(c).filter(([k]) => !['id', 'version', 'teacherId', 'agentId'].includes(k)),
  ) as PackageDraft;

function draft(moduleIds: string[], extra: Partial<PackageDraft> = {}): PackageDraft {
  return { ...withoutIds(demoPackagePaid), moduleIds, ...extra };
}

const ensure = (scope: { teacherId: string }) =>
  repos.agents.ensureDraft(scope, {
    courseId: owned[scope.teacherId]!.courseId,
    styleCardId: owned[scope.teacherId]!.styleCardId,
    promptPackVersion: PACK,
    modelPolicy: POLICY,
  });

describe.skipIf(!up)(
  `agents.ensureDraft and packages on Postgres${up ? '' : ` (${SKIP_REASON})`}`,
  () => {
    beforeAll(async () => {
      await createDatabase(dbName);
      await migrateDatabase(TEST_URL);
      handle = createDb({ DATABASE_URL: TEST_URL });
      await seedAccess(handle.db);
      await handle.db.insert(s.users).values(
        TEACHERS.map((x) => ({
          id: x.teacherId,
          name: '[pk] teacher',
          locale: 'en',
          market: 'test',
          role: 'teacher' as const,
        })),
      );
      repos = createRepositories(handle.db);
      for (const t of TEACHERS) {
        const course = await repos.courses.ensureDefault(t);
        const [moduleId] = await repos.modules.ids(t);
        const card = await repos.styleCards.create(t, { text: '[pk] card', mistakeTags: [] });
        owned[t.teacherId] = { courseId: course.id, moduleId: moduleId!, styleCardId: card.id };
      }
      raw = new pg.Client({ connectionString: TEST_URL });
      await raw.connect();
    });

    afterAll(async () => {
      await raw?.end();
      await handle?.close();
      await dropDatabase(dbName);
    });

    describe('agents.ensureDraft', () => {
      it('creates one draft agent and its v1 config, then returns the same agent again', async () => {
        const first = await ensure(FRESH);
        expect(first.version).toBe(1);
        expect(await repos.agents.get(FRESH, first.agentId)).toEqual({
          id: first.agentId,
          teacherId: FRESH.teacherId,
          status: 'draft',
          liveVersion: null,
        });
        const config = await repos.agentVersions.get(FRESH, { agentId: first.agentId, version: 1 });
        expect(AgentConfigSchema.parse(config)).toEqual({
          id: first.agentId,
          version: 1,
          teacherId: FRESH.teacherId,
          courseId: owned[FRESH.teacherId]!.courseId,
          styleCardId: owned[FRESH.teacherId]!.styleCardId,
          promptPackVersion: PACK,
          languages: ['en'],
          modelPolicy: POLICY,
        });
        // Idempotent: no second agent or version, even with another (still owned) style card.
        const card2 = await repos.styleCards.create(FRESH, {
          text: '[pk] card 2',
          mistakeTags: [],
        });
        const again = await repos.agents.ensureDraft(FRESH, {
          courseId: owned[FRESH.teacherId]!.courseId,
          styleCardId: card2.id,
          promptPackVersion: PACK,
          modelPolicy: POLICY,
        });
        expect(again).toEqual(first);
        expect(await agentCount(FRESH.teacherId)).toBe(1);
        expect(await agentVersionCount(FRESH.teacherId)).toBe(1);
      });

      it('two concurrent calls make one agent and one version', async () => {
        const [x, y] = await Promise.all([ensure(RACE), ensure(RACE)]);
        expect(x).toEqual(y);
        expect(await agentCount(RACE.teacherId)).toBe(1);
        expect(await agentVersionCount(RACE.teacherId)).toBe(1);
      });

      it("returns a teacher's existing agent with its newest version (the seeded live agent)", async () => {
        const got = await repos.agents.ensureDraft(A, {
          courseId: ids.course('A'),
          styleCardId: ids.styleCard('A'),
          promptPackVersion: PACK,
          modelPolicy: POLICY,
        });
        expect(got.agentId).toBe(ids.agent('A'));
        const newest = await count(
          'select max(version) as n from agent_versions where agent_id = $1',
          [ids.agent('A')],
        );
        expect(got.version).toBe(newest);
      });

      it("rejects another teacher's course or style card (not_found) and writes nothing", async () => {
        const own = owned[BARE.teacherId]!;
        const base = { promptPackVersion: PACK, modelPolicy: POLICY };
        expect(
          await failure(
            repos.agents.ensureDraft(BARE, {
              ...base,
              courseId: ids.course('A'),
              styleCardId: own.styleCardId,
            }),
          ),
        ).toEqual({ kind: 'not_found', method: 'agents.ensureDraft' });
        expect(
          await failure(
            repos.agents.ensureDraft(BARE, {
              ...base,
              courseId: own.courseId,
              styleCardId: ids.styleCard('B'),
            }),
          ),
        ).toEqual({ kind: 'not_found', method: 'agents.ensureDraft' });
        // Even a teacher who already has an agent can't name a foreign id.
        expect(
          await failure(
            repos.agents.ensureDraft(A, {
              ...base,
              courseId: ids.course('B'),
              styleCardId: ids.styleCard('A'),
            }),
          ),
        ).toMatchObject({ kind: 'not_found' });
        expect(await agentCount(BARE.teacherId)).toBe(0);
      });

      it('rejects a config that fails AgentConfigSchema or a smuggled teacherId (invalid)', async () => {
        const own = owned[BARE.teacherId]!;
        const good = { courseId: own.courseId, styleCardId: own.styleCardId, modelPolicy: POLICY };
        const bad: unknown[] = [
          { ...good, promptPackVersion: 'latest' },
          { ...good, promptPackVersion: PACK, modelPolicy: { tiers: { fast: 'x' } } },
          { ...good, promptPackVersion: PACK, teacherId: A.teacherId },
          { ...good, promptPackVersion: PACK, courseId: '' },
        ];
        for (const input of bad) {
          expect(await failure(repos.agents.ensureDraft(BARE, input as never))).toEqual({
            kind: 'invalid',
            method: 'agents.ensureDraft',
          });
        }
        expect(await failure(repos.agents.ensureDraft({ teacherId: '' }, good as never))).toEqual({
          kind: 'scope',
          method: 'agents.ensureDraft',
        });
        expect(await agentCount(BARE.teacherId)).toBe(0);
      });
    });

    describe('packages', () => {
      let agentId: string;
      let moduleId: string;
      const created: string[] = [];

      beforeAll(async () => {
        agentId = (await ensure(FRESH)).agentId;
        moduleId = owned[FRESH.teacherId]!.moduleId;
      });

      it('create writes the package and its version 1 in one go', async () => {
        const d = draft([moduleId], { name: 'Full course' });
        const res = await repos.packages.create(FRESH, { agentId, draft: d });
        expect(res.version).toBe(1);
        created.push(res.packageId);
        const stored = await repos.packageVersions.get(FRESH, {
          packageId: res.packageId,
          version: 1,
        });
        expect(stored).toEqual({
          ...d,
          id: res.packageId,
          version: 1,
          teacherId: FRESH.teacherId,
          agentId,
        } satisfies PackageConfig);
        const row = (
          await raw.query<{ name: string; live_version: number | null; agent_id: string }>(
            'select name, live_version, agent_id from packages where id = $1',
            [res.packageId],
          )
        ).rows[0];
        expect(row).toEqual({ name: 'Full course', live_version: null, agent_id: agentId });
      });

      it('saveVersion writes version 2 with every field and renames the package', async () => {
        const packageId = created[0]!;
        const d: PackageDraft = {
          name: 'Starter',
          moduleIds: [moduleId],
          skills: ['explain', 'practice'],
          helpCeiling: 4,
          finalAnswers: 'after_attempt',
          dailyMessageLimit: 10,
          liveClassesPerMonth: 1,
          pricePerMonth: { amountMinor: 1900, currency: 'USD' },
          trialDays: 7,
          lockedReply: 'generic',
        };
        expect(await repos.packages.saveVersion(FRESH, { packageId, agentId, draft: d })).toEqual({
          packageId,
          version: 2,
        });
        const v2 = await repos.packageVersions.latest(FRESH, packageId);
        expect(PackageConfigSchema.parse(v2)).toEqual({
          ...d,
          id: packageId,
          version: 2,
          teacherId: FRESH.teacherId,
          agentId,
        });
        // v1 is unchanged (immutable versions).
        expect((await repos.packageVersions.get(FRESH, { packageId, version: 1 }))?.name).toBe(
          'Full course',
        );
        const name = (
          await raw.query<{ name: string }>('select name from packages where id = $1', [packageId])
        ).rows[0]?.name;
        expect(name).toBe('Starter');
      });

      it('concurrent saves get consecutive versions', async () => {
        const packageId = created[0]!;
        const d = draft([moduleId]);
        const got = await Promise.all([
          repos.packages.saveVersion(FRESH, { packageId, agentId, draft: d }),
          repos.packages.saveVersion(FRESH, { packageId, agentId, draft: d }),
        ]);
        expect(got.map((g) => g.version).sort()).toEqual([3, 4]);
      });

      it('a module of another teacher is scope, and nothing is written (no orphan package)', async () => {
        const before = [await packageCount(FRESH.teacherId), await versionCount(FRESH.teacherId)];
        expect(
          await failure(
            repos.packages.create(FRESH, { agentId, draft: draft([moduleId, ids.module('B', 1)]) }),
          ),
        ).toEqual({ kind: 'scope', method: 'packages.create' });
        expect(
          await failure(repos.packages.create(FRESH, { agentId, draft: draft(['mod_nowhere']) })),
        ).toEqual({ kind: 'scope', method: 'packages.create' });
        expect(
          await failure(
            repos.packages.saveVersion(FRESH, {
              packageId: created[0]!,
              agentId,
              draft: draft([ids.module('A', 1)]),
            }),
          ),
        ).toEqual({ kind: 'scope', method: 'packages.saveVersion' });
        expect([await packageCount(FRESH.teacherId), await versionCount(FRESH.teacherId)]).toEqual(
          before,
        );
      });

      it("another teacher's agent or package, or another agent, is not_found and writes nothing", async () => {
        const before = [await packageCount(FRESH.teacherId), await versionCount(FRESH.teacherId)];
        const beforeA = await versionCount(A.teacherId);
        expect(
          await failure(
            repos.packages.create(FRESH, { agentId: ids.agent('A'), draft: draft([moduleId]) }),
          ),
        ).toEqual({ kind: 'not_found', method: 'packages.create' });
        expect(
          await failure(
            repos.packages.saveVersion(FRESH, {
              packageId: ids.pkg('A'),
              agentId,
              draft: draft([moduleId]),
            }),
          ),
        ).toEqual({ kind: 'not_found', method: 'packages.saveVersion' });
        expect(
          await failure(
            repos.packages.saveVersion(A, {
              packageId: ids.pkg('A'),
              agentId: ids.agent('B'),
              draft: draft([ids.module('A', 1)]),
            }),
          ),
        ).toEqual({ kind: 'not_found', method: 'packages.saveVersion' });
        expect(
          await failure(
            repos.packages.saveVersion(FRESH, {
              packageId: created[0]!,
              agentId: (await ensure(RACE)).agentId,
              draft: draft([moduleId]),
            }),
          ),
        ).toEqual({ kind: 'not_found', method: 'packages.saveVersion' });
        expect([await packageCount(FRESH.teacherId), await versionCount(FRESH.teacherId)]).toEqual(
          before,
        );
        expect(await versionCount(A.teacherId)).toBe(beforeA);
      });

      it('a draft with an id, version, teacherId or agentId, or a bad field, is invalid', async () => {
        const smuggled = [
          { ...draft([moduleId]), teacherId: A.teacherId },
          { ...draft([moduleId]), agentId: ids.agent('A') },
          { ...draft([moduleId]), id: ids.pkg('A') },
          { ...draft([moduleId]), version: 9 },
          { ...draft([moduleId]), helpCeiling: 5 },
          { ...draft([moduleId]), dailyMessageLimit: -1 },
        ];
        for (const d of smuggled) {
          expect(
            await failure(repos.packages.create(FRESH, { agentId, draft: d as never })),
          ).toEqual({ kind: 'invalid', method: 'packages.create' });
        }
        expect(
          await failure(
            repos.packages.create({ teacherId: 42 } as never, { agentId, draft: draft([]) }),
          ),
        ).toEqual({ kind: 'scope', method: 'packages.create' });
      });

      it('listForTeacher returns each package once, newest config, in creation order', async () => {
        const free = withoutIds(demoPackageFree);
        const res = await repos.packages.create(FRESH, {
          agentId,
          draft: { ...free, moduleIds: [moduleId], name: 'Free starter' },
        });
        created.push(res.packageId);
        const list = await repos.packages.listForTeacher(FRESH);
        expect(list.map((p) => p.packageId)).toEqual(created);
        expect(list[0]).toMatchObject({ agentId, liveVersion: null });
        expect(list[0]!.config.version).toBe(4);
        expect(list[1]!.config).toMatchObject({ version: 1, name: 'Free starter' });
        for (const p of list) expect(p.config.teacherId).toBe(FRESH.teacherId);
        // Another teacher sees only their own.
        const ofB = await repos.packages.listForTeacher(B);
        expect(ofB.map((p) => p.packageId)).toContain(ids.pkg('B'));
        for (const p of ofB) expect(p.config.teacherId).toBe(B.teacherId);
        expect(ofB.some((p) => created.includes(p.packageId))).toBe(false);
        expect(await repos.packages.listForTeacher(BARE)).toEqual([]);
      });

      it(`stops at PACKAGES_MAX (${PACKAGES_MAX}) packages per teacher`, async () => {
        const many = (await ensure(MANY)).agentId;
        const d = draft([owned[MANY.teacherId]!.moduleId]);
        for (let i = 0; i < PACKAGES_MAX; i += 1) {
          await repos.packages.create(MANY, { agentId: many, draft: { ...d, name: `p${i}` } });
        }
        expect(await failure(repos.packages.create(MANY, { agentId: many, draft: d }))).toEqual({
          kind: 'limit',
          method: 'packages.create',
        });
        expect(await packageCount(MANY.teacherId)).toBe(PACKAGES_MAX);
        const list = await repos.packages.listForTeacher(MANY);
        expect(list.map((p) => p.config.name)).toEqual(
          Array.from({ length: PACKAGES_MAX }, (_, i) => `p${i}`),
        );
        // Saving a version is not capped, and a package may unlock no module yet.
        const first = list[0]!.packageId;
        expect(
          await repos.packages.saveVersion(MANY, {
            packageId: first,
            agentId: many,
            draft: { ...d, name: 'p0', moduleIds: [] },
          }),
        ).toEqual({ packageId: first, version: 2 });
      });

      it(`PACKAGES_MAX + 1 concurrent creates resolve to exactly ${PACKAGES_MAX} successes and one 'limit' failure`, async () => {
        const racy = (await ensure(RACE)).agentId;
        const moduleId = owned[RACE.teacherId]!.moduleId;
        const d = draft([moduleId]);
        const results = await Promise.all(
          Array.from({ length: PACKAGES_MAX + 1 }, (_, i) =>
            repos.packages
              .create(RACE, { agentId: racy, draft: { ...d, name: `race${i}` } })
              .then(
                (v) => ({ ok: true as const, v }),
                (e: unknown) => ({ ok: false as const, e }),
              ),
          ),
        );
        const oks = results.filter((r) => r.ok);
        const fails = results.filter((r) => !r.ok);
        expect(oks).toHaveLength(PACKAGES_MAX);
        expect(fails).toHaveLength(1);
        for (const f of fails) {
          expect(f.e).toBeInstanceOf(RepositoryError);
          expect((f.e as RepositoryError).kind).toBe('limit');
        }
        expect(await packageCount(RACE.teacherId)).toBe(PACKAGES_MAX);
      });

      it('writes one package.save audit row per write: the package in target, only the version in after', async () => {
        const rows = (
          await raw.query<{
            actor: string;
            action: string;
            target: string;
            before: unknown;
            after: unknown;
          }>(
            `select actor, action, target, before, after from audit_log
            where teacher_id = $1 and action = 'package.save' order by ts, id`,
            [FRESH.teacherId],
          )
        ).rows;
        // create p1, save v2, save v3, save v4, create p2.
        expect(rows).toHaveLength(5);
        for (const r of rows) {
          expect(r.actor).toBe(FRESH.teacherId);
          expect(r.before).toBeNull();
          expect(Object.keys(r.after as object).sort()).toEqual(['packageId', 'version']);
          expect(created.map((id) => `package:${id}`)).toContain(r.target);
          expect(created).toContain((r.after as { packageId: string }).packageId);
          expect(`package:${(r.after as { packageId: string }).packageId}`).toBe(r.target);
          // The redactor (task 8.7h) carves UUID spans out of phone-candidate matching, so a
          // digit-led package id round-trips untouched -- never '[redacted]'.
          expect((r.after as { packageId: string }).packageId).not.toBe('[redacted]');
        }
        expect(rows.filter((r) => r.target === `package:${created[0]}`)).toHaveLength(4);
        expect(rows.map((r) => (r.after as { version: number }).version).sort()).toEqual([
          1, 1, 2, 3, 4,
        ]);
      });

      it('packages.saveVersion and packageVersions.create on the same package never deadlock (8.6f fix round)', async () => {
        // Both writers now take the package row lock before the module locks (package-write.ts),
        // so a concurrent pair on the same package with overlapping modules serialises instead of
        // deadlocking (docs/lessons.md: "Two writers that lock the same rows in different orders
        // deadlock").
        const packageId = created[0]!;
        const before = await versionCount(FRESH.teacherId);
        const d = draft([moduleId]);
        const config: PackageConfig = {
          ...d,
          id: packageId,
          version: 500,
          teacherId: FRESH.teacherId,
          agentId,
        };
        const [saved, made] = await Promise.all([
          repos.packages.saveVersion(FRESH, { packageId, agentId, draft: d }).then(
            (v) => ({ ok: true as const, v }),
            (e: unknown) => ({ ok: false as const, e }),
          ),
          repos.packageVersions.create(FRESH, config).then(
            () => ({ ok: true as const }),
            (e: unknown) => ({ ok: false as const, e }),
          ),
        ]);
        // Neither write may fail (a deadlock would surface as a thrown error here, never a
        // RepositoryError('failed', ...) -- there is no such kind in this repository).
        expect(saved.ok).toBe(true);
        expect(made.ok).toBe(true);
        expect(await repos.packageVersions.get(FRESH, { packageId, version: 500 })).not.toBeNull();
        expect(await versionCount(FRESH.teacherId)).toBe(before + 2);
      });
    });

    describe('stored rows that break the invariants are integrity errors, never guessed', () => {
      const AGENT = 'agt_pk_broken';
      const PKG = 'pkg_pk_broken';

      it('ensureDraft: an existing agent with no version', async () => {
        await raw.query(`insert into agents (id, teacher_id, status) values ($1, $2, 'draft')`, [
          AGENT,
          BROKEN.teacherId,
        ]);
        expect(await failure(ensure(BROKEN))).toEqual({
          kind: 'integrity',
          method: 'agents.ensureDraft',
        });
      });

      it('listForTeacher: a package with no version, then one whose config names another agent', async () => {
        await raw.query(
          'insert into packages (id, teacher_id, agent_id, name) values ($1, $2, $3, $4)',
          [PKG, BROKEN.teacherId, AGENT, 'broken'],
        );
        expect(await failure(repos.packages.listForTeacher(BROKEN))).toEqual({
          kind: 'integrity',
          method: 'packages.listForTeacher',
        });
        const config: PackageConfig = {
          ...demoPackageFree,
          id: PKG,
          version: 1,
          teacherId: BROKEN.teacherId,
          agentId: 'agt_somewhere_else',
          moduleIds: [],
        };
        await raw.query(
          `insert into package_versions (id, teacher_id, package_id, version, config)
           values ($1, $2, $3, 1, $4::jsonb)`,
          ['pv_pk_broken', BROKEN.teacherId, PKG, JSON.stringify(config)],
        );
        expect(await failure(repos.packages.listForTeacher(BROKEN))).toEqual({
          kind: 'integrity',
          method: 'packages.listForTeacher',
        });
      });
    });
  },
);
