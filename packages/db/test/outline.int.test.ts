// Task 8.3 Phase A on Postgres: the studio outline. Reorder and rename round-trip; merge and split
// rewrite topics and their source links; every successful edit bumps outline_version by exactly 1
// with one audit row, and a rejected edit writes nothing; a document delete drops its chunks'
// links without a version bump; courses.ensureDefault is idempotent; chunks.listForModule reads
// ready documents only. See test/pg.ts for how to start a database; skipped locally without one,
// fails in CI.
import pg from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { migrateDatabase } from '../src/migrate.js';
import { createDb, type DbHandle } from '../src/internal.js';
import {
  chunkId,
  createRepositories,
  DEFAULT_COURSE_TITLE,
  DEFAULT_MODULE_TITLE,
  MODULE_CHUNKS_MAX,
  type Outline,
  type OutlineInput,
  type Repositories,
  RepositoryError,
} from '../src/index.js';
import { ids, seed, teacherId } from './isolation-seed.js';
import {
  createDatabase,
  dropDatabase,
  postgresUp,
  SKIP_REASON,
  throwawayName,
  urlFor,
} from './pg.js';

const up = await postgresUp('outline tests');
const dbName = throwawayName();
const TEST_URL = urlFor(dbName);
let handle: DbHandle;
let repos: Repositories;
let raw: pg.Client;

const A = { teacherId: teacherId('A') };
const B = { teacherId: teacherId('B') };
const M1 = ids.module('A', 1);
const M2 = ids.module('A', 2);
/** Teacher A's seeded topic: it has student evidence, so every edit below keeps it. */
const STUDIED = ids.topic('A');

/** Teacher A's ready documents in module 1: doc_o1 (3 chunks), doc_o2 (2 chunks). */
const c1 = chunkId('doc_o1', 0);
const c2 = chunkId('doc_o1', 1);
const c3 = chunkId('doc_o1', 2);
const c4 = chunkId('doc_o2', 0);
const c5 = chunkId('doc_o2', 1);
const bChunk = chunkId('doc_ob', 0);

async function failure(p: Promise<unknown>): Promise<RepositoryError> {
  const e = await p.then(
    () => null,
    (x: unknown) => x,
  );
  expect(e).toBeInstanceOf(RepositoryError);
  return e as RepositoryError;
}

async function addDoc(
  scope: { teacherId: string },
  id: string,
  moduleId: string,
  texts: string[],
  ready = true,
) {
  await repos.documents.create(scope, { id, moduleId, kind: 'material', sourceTitle: `${id}.pdf`, rightsDeclared: true });
  await repos.chunks.insertMany(
    scope,
    id,
    texts.map((text, ord) => ({ ord, text, locator: `p${ord + 1}` })),
  );
  if (ready) {
    await repos.documents.updateStatus(scope, id, 'processing');
    await repos.documents.updateStatus(scope, id, 'ready');
  }
}

/** Everything a rejected edit must leave alone. */
async function state() {
  const q = async (text: string) =>
    JSON.stringify((await raw.query(text, [teacherId('A')])).rows);
  return [
    await q(`select id, outline_version, updated_at from courses where teacher_id = $1 order by id`),
    await q(`select id, title, "order", updated_at from modules where teacher_id = $1 order by id`),
    await q(
      `select id, module_id, title, "order", updated_at from topics where teacher_id = $1 order by id`,
    ),
    await q(
      `select topic_id, chunk_id, "order" from topic_chunks where teacher_id = $1 order by topic_id, "order"`,
    ),
    await q(`select count(*) from audit_log where teacher_id = $1`),
  ].join('\n');
}

const links = (o: Outline | null, topicId: string) =>
  o?.modules.flatMap((m) => m.topics).find((t) => t.id === topicId)?.chunkIds.map((c) => c.chunkId);

/** A one-module edit of module 1, always keeping the studied topic first with `studiedLinks`. */
function edit(
  rest: OutlineInput['modules'][number]['topics'],
  studiedLinks: string[] = [],
): OutlineInput {
  return {
    modules: [
      {
        id: M1,
        title: '[A] module 1',
        order: 1,
        topics: [{ id: STUDIED, title: '[A] topic', order: 0, chunkIds: studiedLinks }, ...rest],
      },
    ],
  };
}

async function version(): Promise<number> {
  return (await repos.courses.get(A))!.outlineVersion;
}

describe.skipIf(!up)(`studio outline on Postgres${up ? '' : ` (${SKIP_REASON})`}`, () => {
  beforeAll(async () => {
    await createDatabase(dbName);
    await migrateDatabase(TEST_URL);
    handle = createDb({ DATABASE_URL: TEST_URL });
    await seed(handle.db);
    repos = createRepositories(handle.db);
    raw = new pg.Client({ connectionString: TEST_URL });
    await raw.connect();
    await addDoc(A, 'doc_o1', M1, ['[A] one', '[A] two', '[A] three']);
    await addDoc(A, 'doc_o2', M1, ['[A] four', '[A] five']);
    await addDoc(A, 'doc_pending', M1, ['[A] not ready yet'], false);
    await addDoc(A, 'doc_m2', M2, ['[A] module two']);
    await addDoc(B, 'doc_ob', ids.module('B', 1), ['[B] secret']);
  }, 30_000);

  afterAll(async () => {
    await raw?.end();
    await handle?.close();
    await dropDatabase(dbName);
  }, 30_000);

  describe('chunks.listForModule', () => {
    it("returns the scope's ready chunks of one module, by document then chunk order", async () => {
      const rows = await repos.chunks.listForModule(A, M1);
      expect(rows.map((r) => r.id)).toEqual([c1, c2, c3, c4, c5]);
      expect(rows[0]).toEqual({ id: c1, text: '[A] one', locator: 'p1', sourceTitle: 'doc_o1.pdf' });
      expect(rows.map((r) => r.text)).not.toContain('[A] not ready yet');
      expect((await repos.chunks.listForModule(A, M2)).map((r) => r.id)).toEqual([
        chunkId('doc_m2', 0),
      ]);
    });

    it("gives [] for another teacher's module and for a missing one (no existence oracle)", async () => {
      expect(await repos.chunks.listForModule(A, ids.module('B', 1))).toEqual([]);
      expect(await repos.chunks.listForModule(B, M1)).toEqual([]);
      expect(await repos.chunks.listForModule(A, 'mod_missing')).toEqual([]);
    });

    it('rejects a malformed module id before any SQL', async () => {
      expect((await failure(repos.chunks.listForModule(A, 'bad id!'))).kind).toBe('invalid');
    });

    it('is invalid past MODULE_CHUNKS_MAX, never a cut list', async () => {
      const big = ids.module('B', 2);
      await repos.documents.create(B, { id: 'doc_big', moduleId: big, kind: 'material', sourceTitle: 'big', rightsDeclared: true });
      for (let from = 0; from <= MODULE_CHUNKS_MAX; from += 500) {
        const n = Math.min(500, MODULE_CHUNKS_MAX + 1 - from);
        await repos.chunks.insertMany(
          B,
          'doc_big',
          Array.from({ length: n }, (_, i) => ({ ord: from + i, text: `[B] ${from + i}`, locator: 'p' })),
        );
      }
      await repos.documents.updateStatus(B, 'doc_big', 'processing');
      await repos.documents.updateStatus(B, 'doc_big', 'ready');
      expect((await failure(repos.chunks.listForModule(B, big))).kind).toBe('invalid');
      await repos.documents.delete(B, 'doc_big');
      expect(await repos.chunks.listForModule(B, big)).toEqual([]);
    });
  });

  describe('courses.ensureDefault and courses.get', () => {
    it('bootstraps one course and one module for a new teacher, idempotently', async () => {
      const fresh = { teacherId: 'tch_fresh' };
      await raw.query(
        `insert into users (id, name, locale, market, role) values ($1, 'Fresh', 'en', 'test', 'teacher')`,
        [fresh.teacherId],
      );
      expect(await repos.courses.get(fresh)).toBeNull();
      expect(await repos.outline.getOutline(fresh)).toBeNull();
      const [x, y] = await Promise.all([
        repos.courses.ensureDefault(fresh),
        repos.courses.ensureDefault(fresh),
      ]);
      const z = await repos.courses.ensureDefault(fresh);
      expect(x).toEqual({ id: x.id, title: DEFAULT_COURSE_TITLE, outlineVersion: 1 });
      expect(y).toEqual(x);
      expect(z).toEqual(x);
      expect(await repos.courses.get(fresh)).toEqual(x);
      const counts = await raw.query<{ c: string; m: string }>(
        `select (select count(*) from courses where teacher_id = $1) as c,
                (select count(*) from modules where teacher_id = $1) as m`,
        [fresh.teacherId],
      );
      expect(counts.rows[0]).toEqual({ c: '1', m: '1' });
      const outline = await repos.outline.getOutline(fresh);
      expect(outline?.modules.map((m) => [m.title, m.order, m.topics])).toEqual([
        [DEFAULT_MODULE_TITLE, 0, []],
      ]);
    });

    it("leaves a teacher's existing course and modules alone", async () => {
      const before = await state();
      expect((await repos.courses.ensureDefault(A)).id).toBe(ids.course('A'));
      expect(await state()).toBe(before);
    });

    it('getOutline reads a course with no modules as an empty tree', async () => {
      const bare = { teacherId: 'tch_bare' };
      await raw.query(
        `insert into users (id, name, locale, market, role) values ($1, 'Bare', 'en', 'test', 'teacher')`,
        [bare.teacherId],
      );
      await raw.query(
        `insert into courses (id, teacher_id, title, "order") values ('crs_bare', $1, 'Bare', 0)`,
        [bare.teacherId],
      );
      expect(await repos.outline.getOutline(bare)).toEqual({
        courseId: 'crs_bare',
        outlineVersion: 1,
        modules: [],
      });
    });

    it('is not_found for a scope id that is not a user', async () => {
      const e = await failure(repos.courses.ensureDefault({ teacherId: 'tch_nobody' }));
      expect(e.kind).toBe('not_found');
    });
  });

  describe('outline.replaceOutline', () => {
    beforeEach(async () => {
      // Each case starts from: module 1 holds only the studied topic, with no links; module 2 is empty.
      await repos.outline.replaceOutline(A, {
        modules: [...edit([]).modules, { id: M2, title: '[A] module 2', order: 2, topics: [] }],
      });
    });

    it('reorders and renames, round-tripping through getOutline', async () => {
      await repos.outline.replaceOutline(A, {
        modules: [
          {
            id: M1,
            title: '[A] Algebra',
            order: 1,
            topics: [
              { id: STUDIED, title: '[A] Fractions', order: 1, chunkIds: [c2, c1] },
              { title: '[A] Ratios', order: 0, chunkIds: [c4] },
            ],
          },
          { id: M2, title: '[A] Geometry', order: 0, topics: [] },
        ],
      });
      const o = await repos.outline.getOutline(A);
      expect(o?.modules.map((m) => [m.id, m.title, m.order])).toEqual([
        [M2, '[A] Geometry', 0],
        [M1, '[A] Algebra', 1],
      ]);
      const m1 = o!.modules[1]!;
      expect(m1.topics.map((t) => t.title)).toEqual(['[A] Ratios', '[A] Fractions']);
      expect(m1.topics[1]).toEqual({
        id: STUDIED,
        title: '[A] Fractions',
        order: 1,
        chunkIds: [
          { chunkId: c2, sourceTitle: 'doc_o1.pdf', locator: 'p2' },
          { chunkId: c1, sourceTitle: 'doc_o1.pdf', locator: 'p1' },
        ],
      });
      // Source links carry display fields only, never the chunk text.
      expect(JSON.stringify(o)).not.toMatch(/\[A\] (one|two|four)/);
    });

    it('merges: one topic keeps the union of both link sets, the other is deleted', async () => {
      await repos.outline.replaceOutline(
        A,
        edit([
          { title: '[A] X', order: 1, chunkIds: [c1, c2] },
          { title: '[A] Y', order: 2, chunkIds: [c3] },
        ]),
      );
      const before = await repos.outline.getOutline(A);
      const [x, y] = before!.modules.find((m) => m.id === M1)!.topics.slice(1);
      await repos.outline.replaceOutline(
        A,
        edit([{ id: x!.id, title: '[A] X and Y', order: 1, chunkIds: [c1, c2, c3] }]),
      );
      const after = await repos.outline.getOutline(A);
      expect(links(after, x!.id)).toEqual([c1, c2, c3]);
      expect(links(after, y!.id)).toBeUndefined();
      const gone = await raw.query(
        `select (select count(*) from topics where id = $1) + (select count(*) from topic_chunks where topic_id = $1) as n`,
        [y!.id],
      );
      expect(gone.rows[0]).toEqual({ n: '0' });
    });

    it("splits: two topics whose links partition the original's", async () => {
      await repos.outline.replaceOutline(
        A,
        edit([{ title: '[A] Big', order: 1, chunkIds: [c1, c2, c3, c4] }]),
      );
      const big = (await repos.outline.getOutline(A))!.modules.find((m) => m.id === M1)!.topics[1]!;
      await repos.outline.replaceOutline(
        A,
        edit([
          { id: big.id, title: '[A] Big, part 1', order: 1, chunkIds: [c1, c3] },
          { title: '[A] Big, part 2', order: 2, chunkIds: [c2, c4] },
        ]),
      );
      const ts = (await repos.outline.getOutline(A))!.modules.find((m) => m.id === M1)!.topics;
      expect(ts.map((t) => t.title)).toEqual(['[A] topic', '[A] Big, part 1', '[A] Big, part 2']);
      const parts = ts.slice(1).map((t) => t.chunkIds.map((c) => c.chunkId));
      expect(parts).toEqual([
        [c1, c3],
        [c2, c4],
      ]);
      expect(parts.flat().sort()).toEqual([c1, c2, c3, c4].sort());
    });

    it('moves a topic between named modules, keeping its id and links', async () => {
      await repos.outline.replaceOutline(A, edit([{ title: '[A] Mover', order: 1, chunkIds: [c5] }]));
      const mover = (await repos.outline.getOutline(A))!.modules.find((m) => m.id === M1)!.topics[1]!;
      await repos.outline.replaceOutline(A, {
        modules: [
          ...edit([]).modules,
          {
            id: M2,
            title: '[A] module 2',
            order: 2,
            topics: [{ id: mover.id, title: '[A] Mover', order: 0, chunkIds: [c5] }],
          },
        ],
      });
      const o = await repos.outline.getOutline(A);
      expect(o!.modules.find((m) => m.id === M2)!.topics.map((t) => t.id)).toEqual([mover.id]);
      expect(links(o, mover.id)).toEqual([c5]);
    });

    it('creates topics in a module that had none, without touching unnamed modules', async () => {
      await repos.outline.replaceOutline(A, {
        modules: [
          {
            id: M2,
            title: '[A] module 2',
            order: 2,
            topics: [{ title: '[A] Shapes', order: 0, chunkIds: [chunkId('doc_m2', 0)] }],
          },
        ],
      });
      const o = await repos.outline.getOutline(A);
      const m2 = o!.modules.find((m) => m.id === M2)!;
      expect(m2.topics.map((t) => [t.title, t.chunkIds.map((c) => c.chunkId)])).toEqual([
        ['[A] Shapes', [chunkId('doc_m2', 0)]],
      ]);
      expect(o!.modules.find((m) => m.id === M1)!.topics.map((t) => t.id)).toEqual([STUDIED]);
    });

    it("refuses a module filed under a course that is not the scope's (bad data)", async () => {
      await raw.query(
        `insert into modules (id, teacher_id, course_id, title, "order") values ('mod_a_stray', $1, $2, '[A] stray', 9)`,
        [teacherId('A'), ids.course('B')],
      );
      const before = await state();
      const e = await failure(
        repos.outline.replaceOutline(A, {
          modules: [{ id: 'mod_a_stray', title: 'x', order: 0, topics: [] }],
        }),
      );
      expect(e.kind).toBe('not_found');
      expect(await state()).toBe(before);
    });

    it('bumps outline_version by exactly 1 per edit, with one counts-only audit row each', async () => {
      const v0 = await version();
      const r1 = await repos.outline.replaceOutline(A, edit([{ title: '[A] N', order: 1, chunkIds: [] }]));
      const r2 = await repos.outline.replaceOutline(A, edit([], [c1]));
      expect([r1.outlineVersion, r2.outlineVersion]).toEqual([v0 + 1, v0 + 2]);
      expect(r1.courseId).toBe(ids.course('A'));
      expect(await version()).toBe(v0 + 2);
      const rows = await repos.audit.listForTeacher(A, { target: `course:${ids.course('A')}`, limit: 2 });
      expect(rows.map((r) => [r.action, r.actor, r.before, r.after])).toEqual([
        [
          'outline.edit',
          teacherId('A'),
          { outlineVersion: v0 + 1, moduleCount: 2, topicCount: 2 },
          { outlineVersion: v0 + 2, moduleCount: 2, topicCount: 1 },
        ],
        [
          'outline.edit',
          teacherId('A'),
          { outlineVersion: v0, moduleCount: 2, topicCount: 1 },
          { outlineVersion: v0 + 1, moduleCount: 2, topicCount: 2 },
        ],
      ]);
    });

    it('a rejected edit writes nothing: no version bump, no audit row, no topic change', async () => {
      await repos.outline.replaceOutline(A, edit([{ title: '[A] Keep', order: 1, chunkIds: [c1] }]));
      const before = await state();
      const keep = (await repos.outline.getOutline(A))!.modules.find((m) => m.id === M1)!.topics[1]!;
      const cases: [string, unknown, string][] = [
        ['an unknown chunk id', edit([], ['doc_nope-c0000']), 'invalid'],
        ["another teacher's chunk id", edit([], [bChunk]), 'invalid'],
        [
          "another teacher's module",
          { modules: [{ id: ids.module('B', 1), title: 'x', order: 0, topics: [] }] },
          'not_found',
        ],
        ["another teacher's topic", edit([{ id: ids.topic('B'), title: 'x', order: 1, chunkIds: [] }]), 'not_found'],
        ['a missing module', { modules: [{ id: 'mod_missing', title: 'x', order: 0, topics: [] }] }, 'not_found'],
        [
          "a topic of a module the edit doesn't name",
          {
            modules: [
              { id: M2, title: 'x', order: 0, topics: [{ id: keep.id, title: 'x', order: 0, chunkIds: [] }] },
            ],
          },
          'not_found',
        ],
        ['dropping a topic with student evidence', { modules: [{ ...edit([]).modules[0]!, topics: [] }] }, 'invalid'],
        ['no modules', { modules: [] }, 'invalid'],
        ['a duplicate module id', { modules: [...edit([]).modules, ...edit([]).modules] }, 'invalid'],
        [
          'a duplicate topic id',
          edit([{ id: STUDIED, title: 'x', order: 1, chunkIds: [] }]),
          'invalid',
        ],
        ['a chunk id twice on one topic', edit([], [c1, c1]), 'invalid'],
        ['a blank title', edit([{ title: '   ', order: 1, chunkIds: [] }]), 'invalid'],
        ['a negative order', edit([{ title: 'x', order: -1, chunkIds: [] }]), 'invalid'],
        ['an unknown key', { ...edit([]), teacherId: teacherId('B') }, 'invalid'],
      ];
      for (const [label, input, kind] of cases) {
        const e = await failure(repos.outline.replaceOutline(A, input as OutlineInput));
        expect(e.kind, label).toBe(kind);
        expect(await state(), `${label}: nothing written`).toBe(before);
      }
    });

    it('refuses modules from two courses in one edit', async () => {
      await raw.query(
        `insert into courses (id, teacher_id, title, "order") values ('crs_a_two', $1, '[A] two', 1)`,
        [teacherId('A')],
      );
      await raw.query(
        `insert into modules (id, teacher_id, course_id, title, "order") values ('mod_a_two', $1, 'crs_a_two', '[A] other', 0)`,
        [teacherId('A')],
      );
      const before = await state();
      const e = await failure(
        repos.outline.replaceOutline(A, {
          modules: [...edit([]).modules, { id: 'mod_a_two', title: 'x', order: 0, topics: [] }],
        }),
      );
      expect(e.kind).toBe('invalid');
      expect(await state()).toBe(before);
      // The outline still reads the teacher's first course only.
      expect((await repos.outline.getOutline(A))!.courseId).toBe(ids.course('A'));
    });

    it("leaves another teacher's outline untouched", async () => {
      const before = JSON.stringify(await repos.outline.getOutline(B));
      await repos.outline.replaceOutline(A, edit([{ title: '[A] Z', order: 1, chunkIds: [c1] }]));
      expect(JSON.stringify(await repos.outline.getOutline(B))).toBe(before);
      expect(before).not.toContain('[A]');
    });
  });

  it("a document delete drops its chunks' links without bumping the version", async () => {
    await addDoc(A, 'doc_gone', M1, ['[A] going away']);
    const gone = chunkId('doc_gone', 0);
    await repos.outline.replaceOutline(A, edit([{ title: '[A] Mixed', order: 1, chunkIds: [c1, gone] }]));
    const mixed = (await repos.outline.getOutline(A))!.modules.find((m) => m.id === M1)!.topics[1]!;
    const v = await version();
    await repos.documents.delete(A, 'doc_gone');
    expect(links(await repos.outline.getOutline(A), mixed.id)).toEqual([c1]);
    expect(await version()).toBe(v);
  });
});
