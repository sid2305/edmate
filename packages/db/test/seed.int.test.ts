// Task 1.5 on Postgres: the demo seed writes the demo teacher, its live agent, both packages and
// 20 students with mixed subscriptions; running it again inserts nothing and changes no id. The
// seeded rows are usable by the entitlement store (3.9's CLI chat demo depends on that).
//
// Locally: docker compose -f docker/compose.yaml -f packages/db/test/compose.port.yaml up -d postgres
import { eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AgentConfigSchema, PackageConfigSchema } from '@edmate/contracts';
import { createIdentityStore, createRepositories, entitlementStoreFor } from '../src/index.js';
import { createDb, type DbHandle } from '../src/internal.js';
import * as s from '../src/internal.js';
import { runSeedCli } from '../src/cli.js';
import { migrateDatabase } from '../src/migrate.js';
import { DEMO_IDS, SEED_TABLES, seedDemoTeacher, type SeedResult } from '../src/seed.js';
import {
  createDatabase,
  dropDatabase,
  postgresUp,
  SKIP_REASON,
  throwawayName,
  urlFor,
} from './pg.js';

const up = await postgresUp('seed integration tests');
const dbName = throwawayName();
const TEST_URL = urlFor(dbName);
let handle: DbHandle;

const EXPECTED = {
  users: 21,
  teacherProfiles: 1,
  courses: 1,
  modules: 5,
  styleCards: 1,
  agents: 1,
  agentVersions: 1,
  packages: 2,
  packageVersions: 2,
  subscriptions: 20,
} as const;

/** Every row id in each table the seed writes (the throwaway database holds only seed rows). */
async function snapshot(): Promise<Record<string, string[]>> {
  const { db } = handle;
  const out: Record<string, string[]> = {};
  for (const table of SEED_TABLES) {
    const t = s[table];
    const rows = await db.select({ id: t.id }).from(t).orderBy(t.id);
    out[table] = rows.map((r) => r.id);
  }
  return out;
}

describe.skipIf(!up)(`demo seed on Postgres${up ? '' : ` (${SKIP_REASON})`}`, () => {
  let firstIds: Record<string, string[]>;

  beforeAll(async () => {
    await createDatabase(dbName);
    await migrateDatabase(TEST_URL);
    handle = createDb({ DATABASE_URL: TEST_URL });
  });

  afterAll(async () => {
    await handle?.close();
    await dropDatabase(dbName);
  });

  it('first run inserts every row', async () => {
    const first: SeedResult = await seedDemoTeacher(handle.db);
    expect(first.inserted).toEqual(EXPECTED);
    expect(first.drift).toEqual([]);
    firstIds = await snapshot();
    for (const [table, n] of Object.entries(EXPECTED)) expect(firstIds[table]).toHaveLength(n);
  });

  it('writes a live agent and live packages that pass the frozen contracts', async () => {
    const { db } = handle;
    const [agent] = await db.select().from(s.agents).where(eq(s.agents.id, DEMO_IDS.agent));
    expect(agent).toMatchObject({ teacherId: DEMO_IDS.teacher, status: 'live', liveVersion: 1 });
    const [av] = await db.select().from(s.agentVersions);
    expect(av?.version).toBe(1);
    expect(AgentConfigSchema.parse(av?.config).courseId).toBe('python-basics-demo');

    const pkgs = await db.select().from(s.packages).orderBy(s.packages.id);
    expect(pkgs.map((p) => [p.id, p.liveVersion, p.agentId])).toEqual([
      [DEMO_IDS.packageFree, 1, DEMO_IDS.agent],
      [DEMO_IDS.packagePaid, 1, DEMO_IDS.agent],
    ]);
    const moduleIds = new Set(firstIds.modules);
    for (const pv of await db.select().from(s.packageVersions)) {
      const cfg = PackageConfigSchema.parse(pv.config);
      expect(cfg.moduleIds.every((m) => moduleIds.has(m))).toBe(true);
      expect(pv.version).toBe(1);
    }
    expect([...moduleIds].sort()).toEqual(
      ['conditions', 'functions', 'lists-dicts', 'loops', 'values-variables'].sort(),
    );
  });

  it('writes 20 fictional students with a 5/5/5/5 subscription split, all on this teacher', async () => {
    const { db } = handle;
    const students = await db.select().from(s.users).where(eq(s.users.role, 'student'));
    expect(students).toHaveLength(20);
    for (const st of students) {
      expect(st.email).toMatch(/@example\.invalid$/);
      expect(st.market).toBe('global');
      expect(st.ageConfirmedAt).not.toBeNull();
      expect(st.birthYear).toBe(1990);
    }
    // Past the age gate (1.7), so the demo learners can use the agent.
    const identity = createIdentityStore(db);
    expect(await identity.learnerStatus('demo-student-01')).toBe('clear');
    const split = await db
      .select({
        price: sql<number>`(${s.packageVersions.config}->'pricePerMonth'->>'amountMinor')::int`,
        status: s.subscriptions.status,
        owner: s.packageVersions.teacherId,
        n: sql<number>`count(*)::int`,
      })
      .from(s.subscriptions)
      .innerJoin(s.packageVersions, eq(s.packageVersions.id, s.subscriptions.packageVersionId))
      .groupBy(sql`1`, s.subscriptions.status, s.packageVersions.teacherId);
    const by = (free: boolean, status: string) =>
      split
        .filter((r) => (r.price === 0) === free && r.status === status)
        .reduce((a, r) => a + r.n, 0);
    expect(by(true, 'active')).toBe(5);
    expect(by(false, 'active')).toBe(5);
    expect(by(false, 'paused')).toBe(5);
    expect(by(true, 'ended') + by(false, 'ended')).toBe(5);
    expect(new Set(split.map((r) => r.owner))).toEqual(new Set([DEMO_IDS.teacher]));
  });

  it('second run inserts nothing and keeps every id', async () => {
    const second = await seedDemoTeacher(handle.db);
    expect(Object.values(second.inserted).every((n) => n === 0)).toBe(true);
    expect(second.drift).toEqual([]);
    expect(await snapshot()).toEqual(firstIds);
  });

  it('the CLI on the same database says "already seeded"', async () => {
    const lines: string[] = [];
    expect(await runSeedCli({ DATABASE_URL: TEST_URL }, (l) => lines.push(l))).toBe(0);
    expect(lines[0]).toBe('seed: already seeded (inserted 0 rows)');
    expect(await snapshot()).toEqual(firstIds);
  });

  it('reports drift when a seeded config no longer matches the content, and leaves it alone', async () => {
    const { db } = handle;
    const [pv] = await db
      .select()
      .from(s.packageVersions)
      .where(eq(s.packageVersions.id, DEMO_IDS.packageVersionPaid));
    const [card] = await db
      .select()
      .from(s.styleCards)
      .where(eq(s.styleCards.id, DEMO_IDS.styleCard));
    const edited = { ...pv!.config, dailyMessageLimit: 7 };
    await db
      .update(s.packageVersions)
      .set({ config: edited })
      .where(eq(s.packageVersions.id, DEMO_IDS.packageVersionPaid));
    await db
      .update(s.styleCards)
      .set({ text: 'edited' })
      .where(eq(s.styleCards.id, DEMO_IDS.styleCard));
    try {
      const run = await seedDemoTeacher(handle.db);
      expect(run.drift).toEqual([
        `styleCards ${DEMO_IDS.styleCard}`,
        `packageVersions ${DEMO_IDS.packageVersionPaid}`,
      ]);
      const [after] = await db
        .select()
        .from(s.packageVersions)
        .where(eq(s.packageVersions.id, DEMO_IDS.packageVersionPaid));
      expect(after?.config.dailyMessageLimit).toBe(7);
    } finally {
      await db
        .update(s.packageVersions)
        .set({ config: pv!.config })
        .where(eq(s.packageVersions.id, DEMO_IDS.packageVersionPaid));
      await db
        .update(s.styleCards)
        .set({ text: card!.text })
        .where(eq(s.styleCards.id, DEMO_IDS.styleCard));
    }
  });

  it('the entitlement store resolves the seeded students', async () => {
    const repos = createRepositories(handle.db);
    const store = entitlementStoreFor(repos, {
      market: 'global',
      packMarket: () => 'global',
      learnerClear: async () => true,
    });
    const at = '2026-10-18T10:00:00.000Z';
    const resolve = (studentId: string) =>
      store.resolve({ studentId, agentId: DEMO_IDS.agent, source: 'subscription' }, at);

    const free = await resolve('demo-student-01');
    expect(free).toMatchObject({
      packageId: DEMO_IDS.packageFree,
      status: 'active',
      allowedModuleIds: ['values-variables', 'conditions'],
    });
    expect(free?.lockedModuleIds.sort()).toEqual(['functions', 'lists-dicts', 'loops']);
    expect(await resolve('demo-student-06')).toMatchObject({
      packageId: DEMO_IDS.packagePaid,
      status: 'active',
      lockedModuleIds: [],
    });
    expect(await resolve('demo-student-11')).toMatchObject({
      packageId: DEMO_IDS.packagePaid,
      status: 'paused',
    });
    expect(await resolve('demo-student-16')).toBeNull();
  });
});
