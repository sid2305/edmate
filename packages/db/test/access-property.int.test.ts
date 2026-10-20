// Task 5.4 Phase B: the access-filter property on a real Postgres 16 + pgvector (build plan
// § Access filter; ADR-0003). Seeded PRNG (1.2 decision), no fast-check, no model call (the
// scripted embedder from retrieval-seed.ts).
//
// A three-teacher world (A has six modules, B two, C three). Every chunk carries a unique chunk
// marker and its module's marker in its text, and its document title carries the module marker
// too, so any result field that holds out-of-scope text shows it.
//   (a) 300 random scopes: a random teacher (or an unknown one), a random allowed list (other
//       teachers' and unknown ids, duplicates), random queries (markers of any module, shared
//       words, stop words, unusual Unicode), full text or hybrid. Every result is the teacher's,
//       in allowed ∩ owned, and holds no marker of any other module; a marker-only query finds its
//       chunk exactly when the chunk is in scope. probe passes on only { hit, score }.
//   (b) Random package versions of A's package resolved through entitlementStoreFor (preview at
//       the newest version, eval at a pinned one): results stay within that version's moduleIds,
//       and leakCheck under the entitlement hits a locked module's text and not an allowed one's.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Entitlement, RetrievalIndex } from '@edmate/contracts';
import { prng } from '@edmate/harness/testing';
import { migrateDatabase } from '../src/migrate.js';
import { createDb, type DbHandle } from '../src/internal.js';
import * as s from '../src/internal.js';
import {
  createRepositories,
  entitlementStoreFor,
  type Repositories,
  retrievalIndexFor,
  SEARCH_MAX_K,
} from '../src/index.js';
import { EVAL_STUDENT, packMarket, seedAccess } from './access-seed.js';
import { ids, packageConfig, teacherId } from './isolation-seed.js';
import { scriptedVector } from './retrieval-seed.js';
import {
  createDatabase,
  dropDatabase,
  postgresUp,
  SKIP_REASON,
  throwawayName,
  urlFor,
} from './pg.js';

const up = await postgresUp('access property tests');
const dbName = throwawayName();
const TEST_URL = urlFor(dbName);
let handle: DbHandle;
let repos: Repositories;

const SEED = 20261020;
const ITERATIONS = 300;
const AT = '2026-10-18T10:00:00.000Z';

const A = teacherId('A');
const B = teacherId('B');
const C = 'tch_c';
const UNKNOWN_TEACHER = 'tch_nobody';
const MODULES: Record<string, string[]> = {
  [A]: [ids.module('A', 1), ids.module('A', 2), 'mod_a3', 'mod_a4', 'mod_a5', 'mod_a6'],
  [B]: [ids.module('B', 1), ids.module('B', 2)],
  [C]: ['mod_c1', 'mod_c2', 'mod_c3'],
};
const ALL_MODULES = Object.values(MODULES).flat();
const OWNER = new Map(Object.entries(MODULES).flatMap(([t, ms]) => ms.map((m) => [m, t])));
const CHUNKS_PER_MODULE = 3;

/** Markers are letters and digits only, and none is a prefix of another (`z`/`q` end them). */
const moduleMark = (m: string) => `mt${ALL_MODULES.indexOf(m)}q`;
const chunkMark = (m: string, k: number) => `mk${ALL_MODULES.indexOf(m)}c${k}z`;
const MODULE_MARKS = ALL_MODULES.map(moduleMark);

/** Shared words (some on the scripted embedder's axes), so queries cross modules. */
const VOCAB = [
  'photosynthesis',
  'sunlight',
  'roots',
  'water',
  'volcano',
  'magma',
  'fractions',
  'harbour',
  'lantern',
  'meadow',
  'granite',
  'orbit',
  'copper',
  'kettle',
  'river',
  'delta',
  'glacier',
  'prism',
  'quartz',
  'thunder',
];
const UNICODE = [
  'ǅungla ß İstanbul',
  'ⅷ ² ١٢٣ ४५ 𝟙𝟚 ⓐ ᵃ ª',
  'ㅤ ﾠ 日本語 नमस्ते مرحبا Ελληνικά',
  'áé x‍y ‮abc ﻿bom 𐐨',
  "it's & | ! :* ( ) < \\",
  '  　 \t',
];
const STOP = ['the of and', '', '   '];

/** A chunk's text: twelve shared words, then its own and its module's marker. */
function chunkText(rand: ReturnType<typeof prng>, m: string, k: number): string {
  const words = Array.from({ length: 12 }, () => rand.pick(VOCAB)).join(' ');
  return `Lesson ${words} ${chunkMark(m, k)} ${moduleMark(m)}.`;
}

async function seedWorld(): Promise<Map<string, string[]>> {
  await seedAccess(handle.db);
  await handle.db.insert(s.users).values({
    id: C,
    name: '[C] teacher',
    locale: 'en',
    market: 'test',
    role: 'teacher',
  });
  await handle.db.insert(s.courses).values({ id: 'crs_c', teacherId: C, title: '[C]', order: 0 });
  const extra = [
    ...['mod_a3', 'mod_a4', 'mod_a5', 'mod_a6'].map((id) => ({
      id,
      teacherId: A,
      courseId: ids.course('A'),
    })),
    ...MODULES[C]!.map((id) => ({ id, teacherId: C, courseId: 'crs_c' })),
  ];
  await handle.db
    .insert(s.modules)
    .values(extra.map((m, i) => ({ ...m, title: `module ${m.id}`, order: 10 + i })));

  const rand = prng(SEED + 1);
  const texts = new Map<string, string[]>();
  for (const m of ALL_MODULES) {
    const scope = { teacherId: OWNER.get(m)! };
    const docId = `doc_${m}`;
    await repos.documents.create(scope, {
      id: docId,
      moduleId: m,
      kind: 'material',
      sourceTitle: `Notes ${moduleMark(m)}`,
    });
    const own = Array.from({ length: CHUNKS_PER_MODULE }, (_, k) => chunkText(rand, m, k));
    const { ids: chunkIds } = await repos.chunks.insertMany(
      scope,
      docId,
      own.map((text, ord) => ({ ord, text, locator: `p${ord + 1} ${moduleMark(m)}` })),
    );
    await repos.chunks.setEmbeddings(
      scope,
      chunkIds.map((id, i) => ({ id, embedding: scriptedVector(own[i]!) })),
    );
    texts.set(m, own);
  }
  return texts;
}

/** A random allowed list: any modules (any teacher), sometimes unknown ids and repeats. */
function randomAllowed(rand: ReturnType<typeof prng>): string[] {
  const out = ALL_MODULES.filter(() => rand.chance(0.35));
  if (rand.chance(0.3)) out.push('mod_unknown_1');
  if (out.length > 0 && rand.chance(0.3)) out.push(rand.pick(out));
  return rand.chance(0.5) ? out : [...out].reverse();
}

function randomQuery(rand: ReturnType<typeof prng>): string {
  switch (rand.int(5)) {
    case 0:
      return Array.from({ length: 1 + rand.int(5) }, () => rand.pick(VOCAB)).join(' ');
    case 1:
      return `${rand.pick(MODULE_MARKS)} ${rand.pick(VOCAB)}`;
    case 2:
      return `${rand.pick(VOCAB)} ${rand.pick(UNICODE)} ${rand.pick(VOCAB)}`;
    case 3:
      return rand.pick(STOP);
    default:
      return Array.from({ length: 1 + rand.int(4) }, () =>
        rand.chance(0.5)
          ? rand.pick(MODULE_MARKS)
          : chunkMark(rand.pick(ALL_MODULES), rand.int(CHUNKS_PER_MODULE)),
      ).join(' ');
  }
}

/** Every marker of a module outside `inScope` that appears in `value`'s JSON. */
function strayMarks(value: unknown, inScope: ReadonlySet<string>): string[] {
  const json = JSON.stringify(value);
  return ALL_MODULES.filter((m) => !inScope.has(m)).flatMap((m) =>
    [moduleMark(m), ...Array.from({ length: CHUNKS_PER_MODULE }, (_, k) => chunkMark(m, k))].filter(
      (mark) => json.includes(mark),
    ),
  );
}

describe.skipIf(!up)(
  `access property on Postgres 16 + pgvector${up ? '' : ` (${SKIP_REASON})`}`,
  () => {
    let texts: Map<string, string[]>;
    let fts: RetrievalIndex;
    let hybrid: RetrievalIndex;

    beforeAll(async () => {
      await createDatabase(dbName);
      await migrateDatabase(TEST_URL);
      handle = createDb({ DATABASE_URL: TEST_URL });
      repos = createRepositories(handle.db);
      texts = await seedWorld();
      fts = retrievalIndexFor(repos);
      hybrid = retrievalIndexFor(repos, {
        embedder: { embed: async (t) => t.map(scriptedVector) },
      });
    });

    afterAll(async () => {
      await handle?.close();
      await dropDatabase(dbName);
    });

    it(`(a) ${ITERATIONS} random scopes: results within allowed ∩ owned, no stray text, probe is { hit, score }`, async () => {
      const rand = prng(SEED);
      const tally: Record<string, number> = {};
      const count = (k: string) => {
        tally[k] = (tally[k] ?? 0) + 1;
      };
      for (let i = 0; i < ITERATIONS; i += 1) {
        const teacher = rand.chance(0.1) ? UNKNOWN_TEACHER : rand.pick([A, A, B, C]);
        const allowed = randomAllowed(rand);
        const inScope = new Set(allowed.filter((m) => OWNER.get(m) === teacher));
        const index = rand.chance(0.5) ? hybrid : fts;
        const q = randomQuery(rand);
        const k = 1 + rand.int(SEARCH_MAX_K);
        const at = `seed ${SEED} iteration ${i}`;

        const got = await index.search(q, { teacherId: teacher, allowedModuleIds: allowed }, k);
        expect(got.length, at).toBeLessThanOrEqual(k);
        for (const c of got) {
          expect(c.teacherId, at).toBe(teacher);
          expect(inScope.has(c.moduleId), at).toBe(true);
          // The text and title are this row's own: its module marker, and no other module's.
          expect(c.text, at).toContain(moduleMark(c.moduleId));
          expect(c.source.title, at).toContain(moduleMark(c.moduleId));
        }
        expect(strayMarks(got, inScope), at).toEqual([]);
        count(got.length > 0 ? 'search:results' : 'search:empty');

        // Two-sided: a single chunk marker is found exactly when its chunk is in scope.
        const m = rand.pick(ALL_MODULES);
        const ck = rand.int(CHUNKS_PER_MODULE);
        const byMark = await fts.search(
          chunkMark(m, ck),
          { teacherId: teacher, allowedModuleIds: allowed },
          5,
        );
        const expected = inScope.has(m) ? [texts.get(m)![ck]] : [];
        expect(
          byMark.map((c) => c.text),
          at,
        ).toEqual(expected);
        count(inScope.has(m) ? 'marker:found' : 'marker:hidden');

        const locked = rand.chance(0.2)
          ? ['mod_unknown_2']
          : ALL_MODULES.filter(() => rand.chance(0.3));
        const probe = await index.probe(q, { teacherId: teacher, moduleIds: locked });
        expect(Object.keys(probe), at).toEqual(['hit', 'score']);
        expect(typeof probe.hit, at).toBe('boolean');
        expect(Number.isFinite(probe.score) && probe.score >= 0 && probe.score <= 1, at).toBe(true);
        expect(strayMarks(probe, new Set()), at).toEqual([]);
        count(probe.hit ? 'probe:hit' : 'probe:miss');
      }
      process.stderr.write(`access property (a), seed ${SEED}: ${JSON.stringify(tally)}\n`);
      expect(tally['search:results']).toBeGreaterThan(50);
      expect(tally['marker:found']).toBeGreaterThan(20);
      expect(tally['probe:hit']).toBeGreaterThan(5);
    });

    it('(b) random package versions through entitlementStoreFor: results within pkg.moduleIds', async () => {
      const rand = prng(SEED + 2);
      const tally: Record<string, number> = {};
      const count = (k: string) => {
        tally[k] = (tally[k] ?? 0) + 1;
      };
      const versions = new Map<number, string[]>([
        [1, [ids.module('A', 1)]],
        [2, [ids.module('A', 1), ids.module('A', 2)]],
      ]);
      const leak = retrievalIndexFor(repos, { leakTimeoutMs: 5_000 });
      const preview = entitlementStoreFor(repos, {
        market: 'IN',
        packMarket,
        preview: { packageId: ids.pkg('A') },
      });

      for (let v = 3; v <= 22; v += 1) {
        let moduleIds = MODULES[A]!.filter(() => rand.chance(0.5));
        if (moduleIds.length === 0) moduleIds = [rand.pick(MODULES[A]!)];
        await handle.db.insert(s.packageVersions).values({
          id: `pv_a_prop_${v}`,
          teacherId: A,
          packageId: ids.pkg('A'),
          version: v,
          config: packageConfig('A', v, moduleIds),
        });
        versions.set(v, moduleIds);

        const pinned = 1 + rand.int(v);
        const evalStore = entitlementStoreFor(repos, {
          market: 'IN',
          packMarket,
          eval: { teacherId: A, packageId: ids.pkg('A'), version: pinned, market: 'US' },
        });
        const resolved: [string, Entitlement | null, number][] = [
          [
            'preview',
            await preview.resolve(
              { studentId: A, agentId: ids.agent('A'), source: 'teacher_preview' },
              AT,
            ),
            v,
          ],
          [
            'eval',
            await evalStore.resolve(
              { studentId: EVAL_STUDENT, agentId: ids.agent('A'), source: 'eval' },
              AT,
            ),
            pinned,
          ],
        ];
        for (const [source, e, version] of resolved) {
          const at = `seed ${SEED + 2} version ${v} ${source}`;
          expect(e, at).not.toBeNull();
          const ent = e!;
          const pkgModules = new Set(versions.get(version)!);
          expect(ent.packageVersion, at).toBe(version);
          expect(new Set(ent.allowedModuleIds), at).toEqual(pkgModules);
          expect(new Set([...ent.allowedModuleIds, ...ent.lockedModuleIds]), at).toEqual(
            new Set(MODULES[A]),
          );

          const scope = { teacherId: ent.teacherId, allowedModuleIds: ent.allowedModuleIds };
          for (let j = 0; j < 5; j += 1) {
            const got = await rand
              .pick([fts, hybrid])
              .search(randomQuery(rand), scope, SEARCH_MAX_K);
            for (const c of got) {
              expect(c.teacherId, at).toBe(A);
              expect(pkgModules.has(c.moduleId), at).toBe(true);
            }
            expect(strayMarks(got, pkgModules), at).toEqual([]);
            count(got.length > 0 ? `${source}:results` : `${source}:empty`);
          }
          // leakCheck under the same entitlement: a locked module's chunk is a leak, an allowed one's
          // and another teacher's are not.
          const lockedM = ent.lockedModuleIds[0];
          if (lockedM !== undefined) {
            expect(await leak.leakCheck([texts.get(lockedM)![0]!], scope), at).toEqual({
              hit: true,
            });
            count('leak:locked');
          }
          const allowedM = rand.pick(ent.allowedModuleIds);
          expect(await leak.leakCheck([texts.get(allowedM)![0]!], scope), at).toEqual({
            hit: false,
          });
          expect(await leak.leakCheck([texts.get('mod_c1')![0]!], scope), at).toEqual({
            hit: false,
          });
        }
      }
      process.stderr.write(`access property (b), seed ${SEED + 2}: ${JSON.stringify(tally)}\n`);
      expect(tally['preview:results']).toBeGreaterThan(10);
      expect(tally['eval:results']).toBeGreaterThan(10);
      expect(tally['leak:locked']).toBeGreaterThan(5);
    });
  },
);
