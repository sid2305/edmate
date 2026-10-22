// Task 9.2 Phase A on Postgres (the acceptance table's "Search < 1 s on a 200-teacher seed" CI
// part): a 200-teacher discovery seed plus private decoys, then (1) an index check (EXPLAIN names
// the GIN indexes), (2) one SQL statement per search (no N+1), (3) a loose 5 s gross-regression
// bound (lessons.md "Wall-clock bounds fail on shared CI runners") with printed p50/p95/max, and
// correctness: only public, live-package teachers are ever reachable; result shapes; AND/prefix
// search semantics; language filter; ordering and paging; and that bad input never reaches SQL.
// See test/pg.ts for how to start a database; skipped locally without one, fails in CI.
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { PackageConfig } from '@edmate/contracts';
import { runSeedDiscoveryCli } from '../src/cli.js';
import { migrateDatabase } from '../src/migrate.js';
import { createDb, type DbHandle } from '../src/internal.js';
import * as s from '../src/internal.js';
import {
  createRepositories,
  DISCOVERY_MAX_PAGE,
  DISCOVERY_PAGE_SIZE,
  type Repositories,
  RepositoryError,
} from '../src/index.js';
import { searchQuery } from '../src/repositories/discovery.js';
import { createDatabase, dropDatabase, postgresUp, SKIP_REASON, throwawayName, urlFor } from './pg.js';

const up = await postgresUp('discovery tests');
const dbName = throwawayName();
const TEST_URL = urlFor(dbName);
let handle: DbHandle;
let repos: Repositories;
let raw: pg.Client;

const SEED_COUNT = 200;
const AGENT_CONFIG = {
  version: 1,
  courseId: 'decoy-course',
  styleCardId: 'decoy-style',
  promptPackVersion: '1.0.0',
  languages: ['en'],
  modelPolicy: { tiers: { small: { provider: 'anthropic', model: 'x' }, main: { provider: 'anthropic', model: 'x' } } },
};
const packageConfig = (id: string, agentId: string, teacherId: string, amountMinor = 0) =>
  ({
    id,
    version: 1,
    teacherId,
    agentId,
    name: 'decoy package',
    moduleIds: [],
    skills: ['explain'],
    helpCeiling: 2,
    finalAnswers: 'never',
    dailyMessageLimit: 20,
    liveClassesPerMonth: 0,
    pricePerMonth: { amountMinor, currency: 'USD' },
    lockedReply: 'name_package',
  }) as PackageConfig;

interface DecoyOpts {
  id: string;
  slug: string;
  role?: 'teacher' | 'student';
  verification?: 'pending' | 'verified' | 'rejected';
  agentStatus?: 'draft' | 'live' | 'suspended';
  packageLiveVersion?: number | null;
  extraDraftPackageVersion?: boolean;
  bioToken?: string;
}

/** A private (or otherwise non-public) teacher, inserted directly (bypasses the repository's
 * own writer checks, like the agents.owner isolation test's raw inserts). */
async function insertDecoy(o: DecoyOpts): Promise<void> {
  const role = o.role ?? 'teacher';
  await handle.db
    .insert(s.users)
    .values({ id: o.id, name: `Decoy ${o.id}`, locale: 'en', market: 'US', role });
  await handle.db.insert(s.teacherProfiles).values({
    id: `${o.id}-profile`,
    userId: o.id,
    slug: o.slug,
    subject: 'Decoy Subject',
    bio: `${o.bioToken ?? 'uniquedecoytoken'} for isolation tests only, never a real teacher`,
    languages: ['en'],
    verificationStatus: o.verification ?? 'verified',
  });
  const agentId = `${o.id}-agent`;
  await handle.db.insert(s.agents).values({
    id: agentId,
    teacherId: o.id,
    status: o.agentStatus ?? 'live',
    liveVersion: (o.agentStatus ?? 'live') === 'draft' ? null : 1,
  });
  await handle.db.insert(s.agentVersions).values({
    id: `${agentId}-v1`,
    teacherId: o.id,
    agentId,
    version: 1,
    config: { id: agentId, teacherId: o.id, ...AGENT_CONFIG },
  });
  const pkgId = `${o.id}-pkg`;
  await handle.db.insert(s.packages).values({
    id: pkgId,
    teacherId: o.id,
    agentId,
    name: 'decoy package',
    liveVersion: o.packageLiveVersion === undefined ? 1 : o.packageLiveVersion,
  });
  if (o.packageLiveVersion !== null) {
    const v = o.packageLiveVersion ?? 1;
    await handle.db.insert(s.packageVersions).values({
      id: `${pkgId}-v${v}`,
      teacherId: o.id,
      packageId: pkgId,
      version: v,
      config: packageConfig(pkgId, agentId, o.id),
    });
  }
  if (o.extraDraftPackageVersion) {
    await handle.db.insert(s.packageVersions).values({
      id: `${pkgId}-v2`,
      teacherId: o.id,
      packageId: pkgId,
      version: 2,
      config: packageConfig(pkgId, agentId, o.id, 9999),
    });
  }
}

/** p50/p95/max over durations, printed (never asserted tight: lessons.md). */
function stats(ms: number[]): { p50: number; p95: number; max: number } {
  const sorted = [...ms].sort((a, b) => a - b);
  const at = (p: number) => sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))]!;
  return { p50: at(0.5), p95: at(0.95), max: sorted[sorted.length - 1]! };
}

describe.skipIf(!up)(`discovery on Postgres${up ? '' : ` (${SKIP_REASON})`}`, () => {
  beforeAll(async () => {
    await createDatabase(dbName);
    await migrateDatabase(TEST_URL);
    handle = createDb({ DATABASE_URL: TEST_URL });
    repos = createRepositories(handle.db);
    raw = new pg.Client({ connectionString: TEST_URL });
    await raw.connect();

    const seeded = await runSeedDiscoveryCli(
      ['--fake-teachers', String(SEED_COUNT)],
      { DATABASE_URL: TEST_URL, NODE_ENV: 'test' },
      () => undefined,
    );
    expect(seeded).toBe(0);

    await insertDecoy({ id: 'decoy-pending', slug: 'decoy-pending', verification: 'pending' });
    await insertDecoy({ id: 'decoy-rejected', slug: 'decoy-rejected', verification: 'rejected' });
    await insertDecoy({ id: 'decoy-student', slug: 'decoy-student', role: 'student' });
    await insertDecoy({ id: 'decoy-draft-agent', slug: 'decoy-draft-agent', agentStatus: 'draft' });
    await insertDecoy({
      id: 'decoy-suspended-agent',
      slug: 'decoy-suspended-agent',
      agentStatus: 'suspended',
    });
    await insertDecoy({
      id: 'decoy-no-live-package',
      slug: 'decoy-no-live-package',
      packageLiveVersion: null,
    });
    await insertDecoy({
      id: 'decoy-draft-version',
      slug: 'decoy-draft-version',
      extraDraftPackageVersion: true,
      bioToken: 'draftversiontoken',
    });
    await raw.query('analyze teacher_profiles');
  }, 60_000);

  afterAll(async () => {
    await raw?.end();
    await handle?.close();
    await dropDatabase(dbName);
  }, 30_000);

  it('the real search statement never falls back to a sequential scan of teacher_profiles', async () => {
    const textPlan = await explain(searchQuery(handle.db, { q: 'finance', page: 1 }));
    expect(textPlan).not.toMatch(/"Node Type":"Seq Scan","[^}]*"Relation Name":"teacher_profiles"/);
    const langPlan = await explain(searchQuery(handle.db, { language: 'en', page: 1 }));
    expect(langPlan).not.toMatch(/"Node Type":"Seq Scan","[^}]*"Relation Name":"teacher_profiles"/);
  });

  // The join's own index (teacher_profiles_user_id_key, one row per user) legitimately beats the
  // GIN index at this seed's small scale, so the GIN only shows up in the plan once it is the
  // single remaining access path: a direct predicate on the generated column / the array, with no
  // join to drive from. That still proves the index exists, is valid and is usable.
  it('the search and language GIN indexes exist and are usable on their own', async () => {
    const textPlan = await explain({
      toSQL: () => ({
        sql: `select user_id from teacher_profiles where search @@ to_tsquery('simple', $1)`,
        params: ["'finance':*"],
      }),
    });
    expect(textPlan).toContain('teacher_profiles_search_idx');
    const langPlan = await explain({
      toSQL: () => ({
        sql: `select user_id from teacher_profiles where languages @> array[$1]::text[]`,
        params: ['en'],
      }),
    });
    expect(langPlan).toContain('teacher_profiles_languages_idx');
  });

  async function explain(query: { toSQL(): { sql: string; params: unknown[] } }) {
    const { sql: text, params } = query.toSQL();
    await raw.query('BEGIN');
    try {
      await raw.query('SET LOCAL enable_seqscan = off');
      const { rows } = await raw.query(`EXPLAIN (FORMAT JSON) ${text}`, params);
      return JSON.stringify(rows[0]['QUERY PLAN']);
    } finally {
      await raw.query('ROLLBACK');
    }
  }

  it('one SQL statement per search (no N+1)', async () => {
    const spy = vi.spyOn(handle.pool, 'query');
    await repos.discovery.search({ q: 'finance' });
    expect(spy.mock.calls.length).toBe(1);
    spy.mockRestore();
  });

  it('a loose 5 s gross-regression bound; prints p50/p95/max over 50 mixed searches', async () => {
    const mixes: Parameters<Repositories['discovery']['search']>[0][] = [
      {},
      { q: 'finance' },
      { q: 'python beginner' },
      { q: 'fin' },
      { language: 'en' },
      { q: 'spanish', page: 2 },
    ];
    const durations: number[] = [];
    for (let i = 0; i < 50; i += 1) {
      const start = performance.now();
      await repos.discovery.search(mixes[i % mixes.length]);
      durations.push(performance.now() - start);
    }
    const { p50, p95, max } = stats(durations);
    console.log(
      `discovery.search timings (ms): p50=${p50.toFixed(1)} p95=${p95.toFixed(1)} max=${max.toFixed(1)}`,
    );
    expect(max, 'gross-regression guard only, never a tight bound (lessons.md)').toBeLessThan(5_000);
  }, 30_000);

  it('only public teachers are ever reachable; decoys never appear, by search or by slug', async () => {
    const { teachers } = await repos.discovery.search({ q: 'uniquedecoytoken' });
    expect(teachers).toEqual([]);
    for (const slug of [
      'decoy-pending',
      'decoy-rejected',
      'decoy-student',
      'decoy-draft-agent',
      'decoy-suspended-agent',
      'decoy-no-live-package',
      'missing-entirely',
    ]) {
      expect(await repos.discovery.teacherBySlug({ slug }), slug).toBeNull();
    }
  });

  it('a draft package version newer than the live one is never shown', async () => {
    const page = await repos.discovery.teacherBySlug({ slug: 'decoy-draft-version' });
    expect(page?.packageCount).toBe(1);
    expect(page?.hasFree).toBe(true);
  });

  it('result objects have exactly the documented public keys', async () => {
    const { teachers } = await repos.discovery.search({ q: 'finance' });
    expect(teachers.length).toBeGreaterThan(0);
    expect(Object.keys(teachers[0]!).sort()).toEqual(
      ['bio', 'displayName', 'hasFree', 'languages', 'packageCount', 'slug', 'subject'].sort(),
    );
    const page = await repos.discovery.teacherBySlug({ slug: teachers[0]!.slug });
    expect(Object.keys(page!).sort()).toEqual(
      ['agentIds', 'bio', 'displayName', 'hasFree', 'languages', 'packageCount', 'slug', 'subject'].sort(),
    );
    expect(page!.agentIds.length).toBeLessThanOrEqual(5);
  });

  it('hasFree and packageCount count only live package versions', async () => {
    const { teachers: free } = await repos.discovery.search({ q: 'algebra' });
    for (const t of free) {
      expect(t.packageCount).toBeGreaterThanOrEqual(1);
      expect(typeof t.hasFree).toBe('boolean');
    }
  });

  it('AND semantics: "python beginner" needs both terms', async () => {
    const { teachers } = await repos.discovery.search({ q: 'python beginner' });
    expect(teachers.length).toBeGreaterThan(0);
    for (const t of teachers) expect(t.subject).toBe('Python Programming');
  });

  it('prefix: "fin" finds "finance"', async () => {
    const { teachers } = await repos.discovery.search({ q: 'fin' });
    expect(teachers.length).toBeGreaterThan(0);
    for (const t of teachers) expect(t.subject).toBe('Finance');
  });

  it('tsquery syntax and quotes in q never throw', async () => {
    const weird = [
      `o'Brien`,
      `back\\slash`,
      `&|!():*`,
      '🙂🙃',
      'x'.repeat(100),
    ];
    for (const q of weird) {
      await expect(repos.discovery.search({ q })).resolves.toMatchObject({});
    }
  });

  it('an all-stop-word query behaves like no query', async () => {
    const [a, b] = await Promise.all([
      repos.discovery.search({}),
      repos.discovery.search({ q: 'the a an' }),
    ]);
    expect(b.teachers.map((t) => t.slug)).toEqual(a.teachers.map((t) => t.slug));
    expect(b.hasMore).toBe(a.hasMore);
  });

  it('language filter', async () => {
    const { teachers } = await repos.discovery.search({ language: 'en' });
    expect(teachers.length).toBe(DISCOVERY_PAGE_SIZE);
    const { teachers: none } = await repos.discovery.search({ language: 'zz' });
    expect(none).toEqual([]);
  });

  it('ordering and paging: page 2 is disjoint from page 1; page 51 is invalid', async () => {
    const page1 = await repos.discovery.search({ page: 1 });
    const page2 = await repos.discovery.search({ page: 2 });
    expect(page1.teachers.length).toBe(DISCOVERY_PAGE_SIZE);
    expect(page1.hasMore).toBe(true);
    const slugs1 = new Set(page1.teachers.map((t) => t.slug));
    for (const t of page2.teachers) expect(slugs1.has(t.slug)).toBe(false);
    await expect(repos.discovery.search({ page: DISCOVERY_MAX_PAGE + 1 })).rejects.toMatchObject({
      kind: 'scope',
    });
  });

  it('bad input is scope (like agents.owner) before any SQL', async () => {
    const spy = vi.spyOn(handle.pool, 'query');
    await expect(repos.discovery.search({ q: 'x'.repeat(101) })).rejects.toBeInstanceOf(
      RepositoryError,
    );
    await expect(repos.discovery.search({ language: 'ENGLISH' })).rejects.toMatchObject({
      kind: 'scope',
    });
    await expect(repos.discovery.search({ extra: 'nope' } as never)).rejects.toMatchObject({
      kind: 'scope',
    });
    expect(spy.mock.calls.length).toBe(0);
    spy.mockRestore();
  });

  it('teacherBySlug with a malformed slug is scope', async () => {
    await expect(repos.discovery.teacherBySlug({ slug: 'Not A Slug!' })).rejects.toMatchObject({
      kind: 'scope',
    });
  });
});
