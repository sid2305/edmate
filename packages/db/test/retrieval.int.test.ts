// Task 5.3 Phase A: chunk writes, the material revision, hybrid search and probe on a real
// Postgres 16 + pgvector (see test/pg.ts; skipped locally without one, fails in CI).
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ChunkSchema } from '@edmate/contracts';
import pg from 'pg';
import { migrateDatabase } from '../src/migrate.js';
import { createDb, type DbHandle } from '../src/internal.js';
import {
  createRepositories,
  type Repositories,
  RepositoryError,
  retrievalIndexFor,
  type EmbedFallback,
} from '../src/index.js';
import { ftsQuery, PER_SIGNAL, tsTerm } from '../src/repositories/retrieval.js';
import * as s from '../src/schema/index.js';
import { EMBEDDING_DIMENSIONS } from '../src/schema/index.js';
import { everything, expectScrubbed } from './scrub.js';
import {
  MOD,
  RA,
  RB,
  scriptedEmbedder,
  scriptedVector,
  seedRetrievalWorld,
} from './retrieval-seed.js';
import {
  createDatabase,
  dropDatabase,
  postgresUp,
  SKIP_REASON,
  throwawayName,
  urlFor,
} from './pg.js';

const up = await postgresUp('retrieval tests');
const dbName = throwawayName();
const TEST_URL = urlFor(dbName);
let handle: DbHandle;
let repos: Repositories;
let raw: pg.Client;

const A = { teacherId: RA };
const B = { teacherId: RB };

/** Repositories over a handle that throws if any SQL is attempted. */
function noSqlRepos(): Repositories {
  const db = new Proxy(
    {},
    {
      get() {
        throw new Error('SQL attempted');
      },
    },
  );
  return createRepositories(db as never);
}

async function rejection(p: Promise<unknown>): Promise<RepositoryError> {
  const err = await p.then(
    () => new Error('resolved'),
    (e: unknown) => e,
  );
  expect(err).toBeInstanceOf(RepositoryError);
  return err as RepositoryError;
}

/** Writes a document and its chunks for `scope`; embeds them unless `embed` is false. */
async function material(
  scope: { teacherId: string },
  docId: string,
  moduleId: string,
  kind: 'material' | 'teacher_note' | 'transcript',
  texts: string[],
  embed = true,
): Promise<string[]> {
  await repos.documents.create(scope, {
    id: docId,
    moduleId,
    kind,
    sourceTitle: `${docId} title`,
    rightsDeclared: true,
  });
  const { ids } = await repos.chunks.insertMany(
    scope,
    docId,
    texts.map((text, ord) => ({ ord, text, locator: `p${ord + 1}` })),
  );
  if (embed) {
    await repos.chunks.setEmbeddings(
      scope,
      ids.map((id, i) => ({ id, embedding: scriptedVector(texts[i]!) })),
    );
  }
  return ids;
}

const ALLOWED = [MOD.allowed];

describe.skipIf(!up)(`retrieval on Postgres 16 + pgvector${up ? '' : ` (${SKIP_REASON})`}`, () => {
  beforeAll(async () => {
    await createDatabase(dbName);
    await migrateDatabase(TEST_URL);
    handle = createDb({ DATABASE_URL: TEST_URL });
    await seedRetrievalWorld(handle.db);
    repos = createRepositories(handle.db);
    raw = new pg.Client({ connectionString: TEST_URL });
    await raw.connect();

    await material(A, 'doc_plants', MOD.allowed, 'material', [
      'Photosynthesis turns light energy into chemical energy in the leaf. Photosynthesis needs chlorophyll and photosynthesis makes sugar.',
      'Roots take up water and minerals from the soil.',
    ]);
    await material(A, 'doc_note', MOD.allowed, 'teacher_note', [
      'Teacher note: in my class we call photosynthesis the kitchen of the leaf.',
    ]);
    // Vector only: no query word in the text, but its vector is on the photosynthesis axis.
    await material(A, 'doc_vec', MOD.allowed, 'material', ['The green pigment captures sunlight.']);
    // Full text only: never embedded.
    await material(
      A,
      'doc_fts',
      MOD.allowed,
      'transcript',
      ['Quiz recap on photosynthesis.'],
      false,
    );
    await material(A, 'doc_locked', MOD.locked, 'material', [
      'LOCKEDA volcano magma photosynthesis chamber pressure.',
    ]);
    await material(A, 'doc_draft', MOD.draft, 'material', ['DRAFTA photosynthesis draft text.']);
    await material(B, 'doc_b', MOD.other, 'material', [
      'OTHERB photosynthesis from another teacher.',
    ]);
    await material(A, 'doc_tie', MOD.allowed, 'material', ['fractions halves', 'fractions halves']);
  });

  afterAll(async () => {
    await raw?.end();
    await handle?.close();
    await dropDatabase(dbName);
  });

  describe('scope and arguments are checked before any SQL', () => {
    const r = noSqlRepos();
    const ok = { q: 'photosynthesis', allowedModuleIds: ALLOWED, k: 5 };
    it.each([
      ['missing teacherId', {}, ok, 'scope'],
      ['extra scope key', { teacherId: RA, studentId: 'stu_1' }, ok, 'scope'],
      ['malformed teacherId', { teacherId: 'a b' }, ok, 'scope'],
      ['undefined scope', undefined, ok, 'scope'],
      ['allowed ids not an array', A, { ...ok, allowedModuleIds: 'mod_ra_allowed' }, 'scope'],
      ['malformed allowed id', A, { ...ok, allowedModuleIds: ['bad id'] }, 'scope'],
      ['input not an object', A, null, 'scope'],
      ['k zero', A, { ...ok, k: 0 }, 'invalid'],
      ['k fractional', A, { ...ok, k: 1.5 }, 'invalid'],
      ['q too long', A, { ...ok, q: 'x'.repeat(8001) }, 'invalid'],
      ['embedding wrong length', A, { ...ok, embedding: [1, 2, 3] }, 'invalid'],
      [
        'embedding not finite',
        A,
        { ...ok, embedding: new Array(EMBEDDING_DIMENSIONS).fill(Number.NaN) },
        'invalid',
      ],
    ])('search: %s -> %s', async (_label, scope, input, kind) => {
      const err = await rejection(r.retrieval.search(scope as never, input as never));
      expect(err.kind).toBe(kind);
    });

    it('probe, revision and the writes reject bad scopes and payloads without SQL', async () => {
      expect(
        (await rejection(r.retrieval.probe({} as never, { q: 'x', moduleIds: [] }))).kind,
      ).toBe('scope');
      expect((await rejection(r.retrieval.probe(A, { q: 'x', moduleIds: ['a b'] }))).kind).toBe(
        'scope',
      );
      expect((await rejection(r.retrieval.revision({ teacherId: '' }))).kind).toBe('scope');
      expect((await rejection(r.documents.create({} as never, {} as never))).kind).toBe('scope');
      expect(
        (
          await rejection(
            r.documents.create(A, {
              id: 'd',
              moduleId: 'm',
              kind: 'nope',
              sourceTitle: 't',
            } as never),
          )
        ).kind,
      ).toBe('invalid');
      expect(
        (await rejection(r.chunks.insertMany(A, 'bad id', [{ ord: 0, text: 't', locator: 'l' }])))
          .kind,
      ).toBe('invalid');
      expect((await rejection(r.chunks.insertMany(A, 'doc', []))).kind).toBe('invalid');
      expect(
        (
          await rejection(
            r.chunks.insertMany(A, 'doc', [
              { ord: 0, text: 't', locator: 'l' },
              { ord: 0, text: 'u', locator: 'l' },
            ]),
          )
        ).kind,
      ).toBe('invalid');
      expect(
        (
          await rejection(
            r.chunks.insertMany(A, 'd'.repeat(123), [{ ord: 0, text: 't', locator: 'l' }]),
          )
        ).kind,
      ).toBe('invalid');
      expect((await rejection(r.chunks.setEmbeddings(A, [{ id: 'c', embedding: [1] }]))).kind).toBe(
        'invalid',
      );
      expect((await rejection(r.chunks.setEmbeddings(A, []))).kind).toBe('invalid');
      const v = scriptedVector('water');
      expect(
        (
          await rejection(
            r.chunks.setEmbeddings(A, [
              { id: 'c', embedding: v },
              { id: 'c', embedding: v },
            ]),
          )
        ).kind,
      ).toBe('invalid');
      expect(
        (await rejection(r.chunks.setEmbeddings({ teacherId: 'x y' }, [{ id: 'c', embedding: v }])))
          .kind,
      ).toBe('scope');
    });

    it('the port rejects a malformed scope before embedding', async () => {
      let embeds = 0;
      const index = retrievalIndexFor(r, {
        embedder: {
          embed: async (t) => {
            embeds += 1;
            return t.map(scriptedVector);
          },
        },
      });
      for (const scope of [
        null,
        {},
        { teacherId: RA },
        { teacherId: RA, allowedModuleIds: ALLOWED, extra: 1 },
      ]) {
        expect((await rejection(index.search('photosynthesis', scope as never, 5))).kind).toBe(
          'scope',
        );
        expect((await rejection(index.probe('photosynthesis', scope as never))).kind).toBe('scope');
      }
      expect(embeds).toBe(0);
      const notText = await rejection(
        index.search(42 as never, { teacherId: RA, allowedModuleIds: ALLOWED }, 5),
      );
      expect(notText.kind).toBe('invalid');
      expect(embeds).toBe(0);
    });
  });

  describe('search', () => {
    const hybrid = () => retrievalIndexFor(repos, { embedder: scriptedEmbedder });
    const ftsOnly = () => retrievalIndexFor(repos);

    it("returns only the teacher's chunks in allowed modules; a foreign module id is ignored", async () => {
      for (const index of [hybrid(), ftsOnly()]) {
        const got = await index.search(
          'photosynthesis',
          { teacherId: RA, allowedModuleIds: [MOD.allowed, MOD.other] },
          20,
        );
        expect(got.length).toBeGreaterThan(0);
        for (const c of got) {
          expect(c.teacherId).toBe(RA);
          expect(c.moduleId).toBe(MOD.allowed);
          expect(c.text).not.toMatch(/LOCKEDA|DRAFTA|OTHERB/);
        }
      }
    });

    it("another teacher naming A's modules gets nothing", async () => {
      for (const index of [hybrid(), ftsOnly()]) {
        const got = await index.search(
          'photosynthesis',
          { teacherId: RB, allowedModuleIds: [MOD.allowed, MOD.locked, MOD.draft] },
          20,
        );
        expect(got).toEqual([]);
      }
    });

    it('a matching teacher note comes first even when a material chunk scores higher', async () => {
      const got = await ftsOnly().search(
        'photosynthesis',
        { teacherId: RA, allowedModuleIds: ALLOWED },
        5,
      );
      expect(got[0]?.kind).toBe('teacher_note');
      const best = Math.max(...got.slice(1).map((c) => c.score ?? 0));
      expect(got[0]!.score!).toBeLessThan(best);
      const hy = await hybrid().search(
        'photosynthesis',
        { teacherId: RA, allowedModuleIds: ALLOWED },
        5,
      );
      expect(hy[0]?.kind).toBe('teacher_note');
    });

    it('hybrid returns both a vector-only and a full-text-only chunk', async () => {
      const got = await hybrid().search(
        'photosynthesis',
        { teacherId: RA, allowedModuleIds: ALLOWED },
        10,
      );
      const texts = got.map((c) => c.text);
      expect(texts).toContain('The green pigment captures sunlight.');
      expect(texts).toContain('Quiz recap on photosynthesis.');
      const fts = await ftsOnly().search(
        'photosynthesis',
        { teacherId: RA, allowedModuleIds: ALLOWED },
        10,
      );
      expect(fts.map((c) => c.text)).not.toContain('The green pigment captures sunlight.');
    });

    it('returns contract chunks with a 0-1 score, at most k, in a deterministic order (ties by id)', async () => {
      for (const index of [hybrid(), ftsOnly()]) {
        for (const q of ['photosynthesis', 'roots water', 'fractions', 'sunlight pigment']) {
          const a = await index.search(q, { teacherId: RA, allowedModuleIds: ALLOWED }, 3);
          const b = await index.search(q, { teacherId: RA, allowedModuleIds: ALLOWED }, 3);
          expect(a.map((c) => c.id)).toEqual(b.map((c) => c.id));
          expect(a.length).toBeLessThanOrEqual(3);
          for (const c of a) {
            expect(ChunkSchema.parse(c)).toEqual(c);
            expect(c.score).toBeGreaterThanOrEqual(0);
            expect(c.score).toBeLessThanOrEqual(1);
          }
        }
      }
      const tie = await ftsOnly().search(
        'fractions',
        { teacherId: RA, allowedModuleIds: ALLOWED },
        5,
      );
      expect(tie.map((c) => c.id)).toEqual(['doc_tie-c0000', 'doc_tie-c0001']);
      const first = tie[0]!;
      expect(first.source).toEqual({ title: 'doc_tie title', locator: 'p1', kind: 'material' });
      expect(first.documentId).toBe('doc_tie');
    });

    it('prefix terms match longer words; stop words and empty queries match nothing', async () => {
      const index = ftsOnly();
      const pre = await index.search('photosynth', { teacherId: RA, allowedModuleIds: ALLOWED }, 5);
      expect(pre.length).toBeGreaterThan(0);
      expect(
        await index.search('the and of', { teacherId: RA, allowedModuleIds: ALLOWED }, 5),
      ).toEqual([]);
      expect(await index.search('   ', { teacherId: RA, allowedModuleIds: ALLOWED }, 5)).toEqual(
        [],
      );
      expect(
        await index.search("it's & | ! :* (", { teacherId: RA, allowedModuleIds: ALLOWED }, 5),
      ).toEqual([]);
      expect(
        await hybrid().search('photosynthesis', { teacherId: RA, allowedModuleIds: [] }, 5),
      ).toEqual([]);
    });

    it('ties in fused rank break by id; long queries keep the first 32 terms', async () => {
      // "quiz" matches one unembedded chunk by text; every query embeds to the sunlight axis, so
      // the top vector row ties with the top text row on reciprocal rank.
      const index = retrievalIndexFor(repos, {
        embedder: { embed: async (t) => t.map(() => scriptedVector('sunlight')) },
      });
      const got = await index.search('quiz', { teacherId: RA, allowedModuleIds: ALLOWED }, 4);
      expect(got.map((c) => c.id)).toEqual([
        'doc_note-c0000',
        'doc_fts-c0000',
        'doc_plants-c0000',
        'doc_vec-c0000',
      ]);
      const words = Array.from({ length: 40 }, (_, i) => `w${i}x`);
      expect(ftsQuery(words.join(' '))?.split(' | ')).toHaveLength(32);
      expect(ftsQuery('Photosynthesis, the LEAF 7 a')).toBe(
        "'photosynthesis':* | 'leaf':* | '7':*",
      );
    });

    it('unusual Unicode never raises: every term is a quoted tsquery literal (5.4)', async () => {
      // tsTerm quotes any text, so even tsquery syntax, spaces and quotes parse as a literal.
      expect(tsTerm("a'b\\c")).toBe("'a''b\\\\c':*");
      const hostile = ["it's", 'a b', '!', '&', '|', '(', ')', ':', '<', '\\', ' ', '\t', '　'];
      for (const t of hostile) {
        await expect(
          raw.query(`select to_tsquery('simple', $1)`, [
            hostile.map(tsTerm).join(' | ') + ` | ${tsTerm(t)}`,
          ]),
        ).resolves.toBeDefined();
      }
      // Letters and digits of many scripts and forms, through the whole search.
      const queries = [
        'ǅungla ǈubav ǋ ﬁsh ﬂow ŉ ǰ İstanbul ß straße',
        'ⅷ Ⅻ ² ³ ١٢٣ ४५ 𝟙𝟚 ⓐⓑ ᵃᵇ ª º µ',
        'ㅤ ﾠ ᅟ ⴰⵣ กข 日本語 नमस्ते مرحبا שלום Ελληνικά кириллица',
        'áé ö x‍y z​q ‮abc ﻿bom 𐐨𐐩',
        `${'é'.repeat(3000)} ${'a'.repeat(2100)} photosynthesis`,
      ];
      const index = ftsOnly();
      for (const q of queries) {
        const got = await index.search(q, { teacherId: RA, allowedModuleIds: ALLOWED }, 5);
        for (const c of got) expect(ALLOWED).toContain(c.moduleId);
        await index.probe(q, { teacherId: RA, moduleIds: [MOD.locked] });
      }
      const last = await index.search(queries[4]!, { teacherId: RA, allowedModuleIds: ALLOWED }, 5);
      expect(last.length).toBeGreaterThan(0);
    });

    it('CJK, Thai, Korean and a 60+ character term never raise (5.3a item 6)', async () => {
      // queryTerms restricts every term reaching to_tsquery to [\p{L}\p{N}]+ runs, so none of
      // these can carry a quote, backslash or tsquery punctuation; search and probe return
      // normally, proving the finding (to_tsquery could raise) is already closed in practice.
      const index = ftsOnly();
      const queries = [
        '日本語 文字', // CJK
        'ภาษาไทย ขอบคุณ', // Thai
        '한국어 안녕하세요', // Korean (Hangul)
        'a'.repeat(65), // one very long single term
      ];
      for (const q of queries) {
        const got = await index.search(q, { teacherId: RA, allowedModuleIds: ALLOWED }, 5);
        for (const c of got) expect(ALLOWED).toContain(c.moduleId);
        await expect(index.probe(q, { teacherId: RA, moduleIds: [MOD.locked] })).resolves.toEqual(
          expect.objectContaining({ hit: expect.any(Boolean) }),
        );
      }
    });

    it('a query of stop words only still searches by vector', async () => {
      const got = await hybrid().search(
        'the of and',
        { teacherId: RA, allowedModuleIds: ALLOWED },
        3,
      );
      expect(got.length).toBe(3);
      for (const c of got) expect(c.moduleId).toBe(MOD.allowed);
    });

    it('falls back to full text when the embedder throws, hangs or returns a bad vector', async () => {
      const cases: [string, (t: string[]) => Promise<number[][]>, EmbedFallback][] = [
        ['throws', async () => Promise.reject(new Error('photosynthesis secret')), 'embed_failed'],
        ['hangs', () => new Promise<number[][]>(() => undefined), 'embed_timeout'],
        ['bad vector', async () => [[1, 2]], 'embed_invalid'],
        ['no vector', async () => [], 'embed_invalid'],
      ];
      const expected = await ftsOnly().search(
        'photosynthesis',
        { teacherId: RA, allowedModuleIds: ALLOWED },
        10,
      );
      for (const [label, embed, code] of cases) {
        const seen: EmbedFallback[] = [];
        const index = retrievalIndexFor(repos, {
          embedder: { embed },
          embedTimeoutMs: 50,
          onEmbedFallback: (c) => seen.push(c),
        });
        const got = await index.search(
          'photosynthesis',
          { teacherId: RA, allowedModuleIds: ALLOWED },
          10,
        );
        expect(
          got.map((c) => c.id),
          label,
        ).toEqual(expected.map((c) => c.id));
        expect(seen, label).toEqual([code]);
      }
    });

    it('scrubs driver errors: no query text or ids leave', async () => {
      const closed = createDb({ DATABASE_URL: TEST_URL });
      await closed.close();
      const r = createRepositories(closed.db);
      const err = await r.retrieval
        .search(A, { q: 'secretword photosynthesis', allowedModuleIds: ALLOWED, k: 5 })
        .catch((e: unknown) => e);
      expectScrubbed(err, 'retrieval.search', ['secretword', MOD.allowed, RA]);
      const perr = await r.retrieval
        .probe(A, { q: 'secretword', moduleIds: [MOD.locked] })
        .catch((e: unknown) => e);
      expectScrubbed(perr, 'retrieval.probe', ['secretword', MOD.locked]);
      expect(everything(perr)).not.toContain('secretword');
    });

    it(
      '5.3a fix round: the vector signal keeps the lowest-id rows among more than PER_SIGNAL ' +
        'ties at the cut-off, spread around by a few clearly-farther decoys',
      async () => {
        // A teacher of its own, so this cannot change what any other test in this file sees
        // (search filters by module ownership, which is scoped to teacherId).
        const T = 'tch_vectie';
        const MOD_T = 'mod_vectie';
        await handle.db
          .insert(s.users)
          .values({ id: T, name: 'Tie teacher', locale: 'en', market: 'test', role: 'teacher' });
        await handle.db
          .insert(s.courses)
          .values({ id: 'crs_vectie', teacherId: T, title: 'Tie', order: 0 });
        await handle.db
          .insert(s.modules)
          .values({ id: MOD_T, teacherId: T, courseId: 'crs_vectie', title: 'Tie', order: 1 });
        const scopeT = { teacherId: T };
        await repos.documents.create(scopeT, {
          id: 'doc_vectie',
          moduleId: MOD_T,
          kind: 'material',
          sourceTitle: 'tie',
          rightsDeclared: true,
        });

        // More than PER_SIGNAL chunks, every one at exactly the same distance from the query
        // (identical embedding): the case the inner query's plain `ORDER BY distance` leaves
        // undefined, before the fix.
        const TIE_COUNT = PER_SIGNAL + 10;
        const tieAxis = EMBEDDING_DIMENSIONS - 2; // unused by the file's scripted axes (0-3, last)
        const tieVector = new Array<number>(EMBEDDING_DIMENSIONS).fill(0);
        tieVector[tieAxis] = 1;
        const { ids: tieIds } = await repos.chunks.insertMany(
          scopeT,
          'doc_vectie',
          Array.from({ length: TIE_COUNT }, (_, i) => ({
            ord: i,
            text: `tie chunk ${i}`,
            locator: `p${i}`,
          })),
        );
        await repos.chunks.setEmbeddings(
          scopeT,
          tieIds.map((id) => ({ id, embedding: tieVector })),
        );

        // A few decoys spread around the cut-off: clearly farther (orthogonal axis), so they
        // must never be chosen ahead of a tied row even though some get a lower id.
        const farAxis = EMBEDDING_DIMENSIONS - 3;
        const farVector = new Array<number>(EMBEDDING_DIMENSIONS).fill(0);
        farVector[farAxis] = 1;
        const { ids: farIds } = await repos.chunks.insertMany(
          scopeT,
          'doc_vectie',
          Array.from({ length: 5 }, (_, i) => ({
            ord: TIE_COUNT + i,
            text: `far chunk ${i}`,
            locator: `f${i}`,
          })),
        );
        await repos.chunks.setEmbeddings(
          scopeT,
          farIds.map((id) => ({ id, embedding: farVector })),
        );

        // Stop words only: queryTerms is empty, so this is a vector-only search (byText = []),
        // and the fused order equals the vector signal's order exactly (RRF is strictly
        // decreasing in rank, so there are no cross-signal ties to break).
        const got = await repos.retrieval.search(scopeT, {
          q: 'the and of',
          allowedModuleIds: [MOD_T],
          k: PER_SIGNAL,
          embedding: tieVector,
        });
        expect(got.map((c) => c.id)).toEqual(tieIds.slice(0, PER_SIGNAL));
        for (const id of farIds) expect(got.map((c) => c.id)).not.toContain(id);
      },
    );
  });

  describe('probe', () => {
    it("returns exactly { hit, score } for the teacher's own modules", async () => {
      const index = retrievalIndexFor(repos, { embedder: scriptedEmbedder });
      const hit = await index.probe('volcano magma', { teacherId: RA, moduleIds: [MOD.locked] });
      expect(Object.keys(hit).sort()).toEqual(['hit', 'score']);
      expect(hit.hit).toBe(true);
      expect(hit.score).toBeGreaterThan(0);
      expect(hit.score).toBeLessThanOrEqual(1);
      const miss = await index.probe('zebra quantum', { teacherId: RA, moduleIds: [MOD.locked] });
      expect(miss.hit).toBe(false);
      const fts = await retrievalIndexFor(repos).probe('magma', {
        teacherId: RA,
        moduleIds: [MOD.locked],
      });
      expect(fts.hit).toBe(true);
    });

    it("another teacher's modules never hit", async () => {
      const index = retrievalIndexFor(repos, { embedder: scriptedEmbedder });
      expect(
        await index.probe('photosynthesis', {
          teacherId: RB,
          moduleIds: [MOD.locked, MOD.allowed],
        }),
      ).toEqual({
        hit: false,
        score: 0,
      });
      expect(await index.probe('photosynthesis', { teacherId: RA, moduleIds: [] })).toEqual({
        hit: false,
        score: 0,
      });
    });

    // leakCheck has its own suite: retrieval-leak.int.test.ts (Phase B).
  });

  describe('writes', () => {
    it("every write bumps the teacher's material revision; failed writes and other teachers do not", async () => {
      const fresh = { teacherId: 'tch_none' };
      expect(await repos.retrieval.revision(fresh)).toBe(0);
      const a0 = await repos.retrieval.revision(A);
      const b0 = await repos.retrieval.revision(B);
      expect(a0).toBeGreaterThan(0);
      await repos.documents.create(A, {
        id: 'doc_rev',
        moduleId: MOD.allowed,
        kind: 'material',
        sourceTitle: 'rev',
        rightsDeclared: true,
      });
      expect(await repos.retrieval.revision(A)).toBe(a0 + 1);
      const { ids } = await repos.chunks.insertMany(A, 'doc_rev', [
        { ord: 0, text: 'roots', locator: 'p1' },
      ]);
      expect(ids).toEqual(['doc_rev-c0000']);
      expect(await repos.retrieval.revision(A)).toBe(a0 + 2);
      await repos.chunks.setEmbeddings(A, [{ id: ids[0]!, embedding: scriptedVector('roots') }]);
      expect(await repos.retrieval.revision(A)).toBe(a0 + 3);
      await rejection(repos.chunks.insertMany(A, 'doc_b', [{ ord: 9, text: 'x', locator: 'p' }]));
      await rejection(
        repos.chunks.insertMany(A, 'doc_rev', [{ ord: 0, text: 'again', locator: 'p1' }]),
      );
      expect(await repos.retrieval.revision(A)).toBe(a0 + 3);
      expect(await repos.retrieval.revision(B)).toBe(b0);
    });

    it('ownership failures are not_found without an existence oracle, and write nothing', async () => {
      const before = await raw.query('select count(*)::int as n from documents');
      const foreignModule = await rejection(
        repos.documents.create(A, {
          id: 'doc_x1',
          moduleId: MOD.other,
          kind: 'material',
          sourceTitle: 'x',
          rightsDeclared: true,
        }),
      );
      const missingModule = await rejection(
        repos.documents.create(A, {
          id: 'doc_x2',
          moduleId: 'mod_missing',
          kind: 'material',
          sourceTitle: 'x',
          rightsDeclared: true,
        }),
      );
      const takenId = await rejection(
        repos.documents.create(A, {
          id: 'doc_b',
          moduleId: MOD.allowed,
          kind: 'material',
          sourceTitle: 'x',
          rightsDeclared: true,
        }),
      );
      for (const e of [foreignModule, missingModule, takenId]) expect(e.kind).toBe('not_found');
      expect((await raw.query('select count(*)::int as n from documents')).rows).toEqual(
        before.rows,
      );

      expect(
        (
          await rejection(
            repos.chunks.insertMany(A, 'doc_b', [{ ord: 5, text: 'x', locator: 'p' }]),
          )
        ).kind,
      ).toBe('not_found');
      expect(
        (
          await rejection(
            repos.chunks.insertMany(A, 'doc_missing', [{ ord: 5, text: 'x', locator: 'p' }]),
          )
        ).kind,
      ).toBe('not_found');
      const v = scriptedVector('volcano');
      const mixed = await rejection(
        repos.chunks.setEmbeddings(A, [
          { id: 'doc_plants-c0001', embedding: v },
          { id: 'doc_b-c0000', embedding: v },
        ]),
      );
      expect(mixed.kind).toBe('not_found');
      // The own chunk kept its "roots" vector: the failed batch rolled back as a whole.
      const own = await raw.query<{ d: number }>(
        `select (embedding <=> $1::vector)::float8 as d from chunks where id = 'doc_plants-c0001'`,
        [`[${v.join(',')}]`],
      );
      expect(own.rows[0]?.d).toBeCloseTo(1, 5);
    });

    it('chunks are tagged teacher -> course -> module through their document', async () => {
      const res = await raw.query<{ n: number; bad: number }>(
        `select count(*)::int as n,
                count(*) filter (where c.teacher_id <> m.teacher_id or m.teacher_id <> co.teacher_id
                                 or c.teacher_id <> d.teacher_id or c.module_id <> d.module_id
                                 or c.kind <> d.kind or c.source_title <> d.source_title)::int as bad
           from chunks c join documents d on d.id = c.document_id
           join modules m on m.id = c.module_id join courses co on co.id = m.course_id`,
      );
      expect(res.rows[0]!.n).toBeGreaterThan(5);
      expect(res.rows[0]!.bad).toBe(0);
    });
  });
});
