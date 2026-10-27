// Task 3.17 on Postgres: profileStoreFor's `get` default for a never-seen student, `applyEvidence`
// updating named topics' mastery idempotently (BKT), mistakes/lastSummary untouched, and scope
// isolation (another student or teacher, an unowned topic). See test/pg.ts for how to start one.
import { type EvidenceEvent } from '@edmate/contracts';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { migrateDatabase } from '../src/migrate.js';
import { applyBkt, foldMastery } from '../src/mastery.js';
import { createDb, type DbHandle } from '../src/internal.js';
import {
  createRepositories,
  profileStoreFor,
  type Repositories,
  RepositoryError,
} from '../src/index.js';
import {
  MAX_MISTAKES_ENTRIES,
  MAX_MISTAKES_PATCH_LENGTH,
  REBUILD_PAGE_SIZE,
} from '../src/repositories/learner.js';
import { ids, seed, studentId, teacherId } from './isolation-seed.js';
import {
  createDatabase,
  dropDatabase,
  postgresUp,
  SKIP_REASON,
  throwawayName,
  urlFor,
} from './pg.js';

const up = await postgresUp('profile store tests');
const dbName = throwawayName();
const TEST_URL = urlFor(dbName);
let handle: DbHandle;
let repos: Repositories;

const own = { studentId: studentId('1'), teacherId: teacherId('A') };
const topicId = ids.topic('A');

const event = (o: Partial<EvidenceEvent> = {}): EvidenceEvent => ({
  studentId: own.studentId,
  teacherId: own.teacherId,
  topicId,
  correct: true,
  source: 'practice',
  weight: 1,
  ts: '2026-10-19T10:00:00.000Z',
  ...o,
});

async function kind(p: Promise<unknown>): Promise<string> {
  const e = await p.then(
    () => null,
    (x: unknown) => x,
  );
  expect(e).toBeInstanceOf(RepositoryError);
  return (e as RepositoryError).kind;
}

describe.skipIf(!up)(`profileStoreFor on Postgres${up ? '' : ` (${SKIP_REASON})`}`, () => {
  beforeAll(async () => {
    await createDatabase(dbName);
    await migrateDatabase(TEST_URL);
    handle = createDb({ DATABASE_URL: TEST_URL });
    await seed(handle.db);
    repos = createRepositories(handle.db);
  }, 30_000);

  afterAll(async () => {
    await handle?.close();
    await dropDatabase(dbName);
  }, 30_000);

  it('get on a never-seen pair defaults to lang en, empty mastery and mistakes', async () => {
    const fresh = { studentId: 'stu_never_seen', teacherId: own.teacherId };
    const store = profileStoreFor(repos, fresh);
    expect(await store.get(fresh.studentId, fresh.teacherId)).toEqual({
      ...fresh,
      lang: 'en',
      mastery: {},
      mistakes: [],
    });
  }, 15_000);

  it('get returns the seeded profile for a pair that already has one', async () => {
    const store = profileStoreFor(repos, own);
    const p = await store.get(own.studentId, own.teacherId);
    expect(p.mastery[topicId]).toBeDefined();
    expect(p.lastSummary).toBe('[1A] last time');
  }, 15_000);

  it('get rejects ids that are not the bound pair', async () => {
    const store = profileStoreFor(repos, own);
    expect(await kind(store.get('stu_other', own.teacherId))).toBe('scope');
    expect(await kind(store.get(own.studentId, 'tch_other'))).toBe('scope');
  }, 15_000);

  it('applyEvidence moves mastery for the named topic and leaves mistakes and lastSummary untouched', async () => {
    const store = profileStoreFor(repos, own);
    const before = await store.get(own.studentId, own.teacherId);
    const after = await store.applyEvidence([event({ ts: '2026-10-19T11:00:00.000Z' })]);
    expect(after.mastery[topicId]!.p).not.toBe(before.mastery[topicId]!.p);
    expect(after.mastery[topicId]!.n).toBe(before.mastery[topicId]!.n + 1);
    expect(after.mistakes).toEqual(before.mistakes);
    expect(after.lastSummary).toBe(before.lastSummary);
  }, 15_000);

  it('applying the same event twice (same id) changes mastery once — idempotent', async () => {
    const store = profileStoreFor(repos, own);
    const before = await store.get(own.studentId, own.teacherId);
    const e = event({ topicId, ts: '2026-10-19T12:00:00.000Z' });
    // The db adapter's own applyEvidence (ProfileStore) assigns no id (always fresh): simulate
    // the worker's idempotent path through the lower-level repos it is built on instead.
    const withId = { ...e, id: 'ev_fixed_test_01' };
    const first = await repos.evidenceEvents.append(own, [withId]);
    expect(first).toHaveLength(1);
    const profileAfterFirst = await repos.learnerProfiles.get(own);
    const patch1 = foldMastery(profileAfterFirst?.mastery ?? {}, first);
    await repos.learnerProfiles.applyMastery(own, patch1);
    const afterFirst = await store.get(own.studentId, own.teacherId);

    // Replay: same id, already exists -> append returns [], mastery untouched.
    const second = await repos.evidenceEvents.append(own, [withId]);
    expect(second).toEqual([]);
    const afterSecond = await store.get(own.studentId, own.teacherId);
    expect(afterSecond.mastery[topicId]).toEqual(afterFirst.mastery[topicId]);
    expect(afterFirst.mastery[topicId]!.n).toBe(before.mastery[topicId]!.n + 1);
  }, 15_000);

  it('scope violations are rejected: another student, another teacher, an unowned topic', async () => {
    const store = profileStoreFor(repos, own);
    expect(await kind(store.applyEvidence([event({ studentId: 'stu_other' })]))).toBe('scope');
    expect(await kind(store.applyEvidence([event({ teacherId: 'tch_other' })]))).toBe('scope');
    expect(await kind(store.applyEvidence([event({ topicId: ids.topic('B') })]))).toBe('scope');
  }, 15_000);

  it('an empty evidence array is a no-op that still returns the current profile', async () => {
    const store = profileStoreFor(repos, own);
    const before = await store.get(own.studentId, own.teacherId);
    const after = await store.applyEvidence([]);
    expect(after).toEqual(before);
  }, 15_000);

  it('applyEvidence on a never-seen pair creates the profile from scratch', async () => {
    const fresh = { studentId: 'stu_never_seen_evidence', teacherId: own.teacherId };
    // evidence_events.student_id references users: a real (if never-studied-with) student.
    await handle.db.execute(
      sql`insert into users (id, name, locale, market, role)
            values (${fresh.studentId}, 'Fresh', 'en', 'test', 'student')`,
    );
    const store = profileStoreFor(repos, fresh);
    // An empty call first: still no profile row, defaultProfile is returned.
    expect(await store.applyEvidence([])).toEqual({
      ...fresh,
      lang: 'en',
      mastery: {},
      mistakes: [],
    });
    const after = await store.applyEvidence([
      {
        ...fresh,
        topicId,
        correct: true,
        source: 'practice',
        weight: 1,
        ts: '2026-10-19T13:00:00.000Z',
      },
    ]);
    expect(after.lang).toBe('en');
    expect(after.mastery[topicId]!.n).toBe(1);
  }, 15_000);

  it(// Review fix round (3.17): applyEvidence used to read the profile, fold BKT in app code and
  // merge the result back — two concurrent calls for the same pair and topic could both read the
  // same prior mastery and the second would clobber the first's update (a lost update). It now
  // locks the row and folds inside one transaction (evidenceEvents.appendAndFold), so
  // running the same 10 events concurrently gives exactly the result of applying them one by one.
  'applyEvidence under concurrency: 10 identical events on one topic give the deterministic sequential result', async () => {
    const fresh = { studentId: 'stu_concurrent_evidence', teacherId: own.teacherId };
    await handle.db.execute(
      sql`insert into users (id, name, locale, market, role)
            values (${fresh.studentId}, 'Concurrent', 'en', 'test', 'student')`,
    );
    const store = profileStoreFor(repos, fresh);
    const events = Array.from({ length: 10 }, (_, i) =>
      event({
        ...fresh,
        ts: new Date(Date.UTC(2026, 9, 19, 14, 0, i)).toISOString(),
      }),
    );

    await Promise.all(events.map((e) => store.applyEvidence([e])));

    const after = await store.get(fresh.studentId, fresh.teacherId);
    expect(after.mastery[topicId]!.n).toBe(10);

    // The sequential reference: all 10 events are identical (same `correct`), so applying BKT
    // 10 times in any order composes the same function 10 times over — the expected `p` does
    // not depend on which concurrent call happened to run first.
    let expected: ReturnType<typeof applyBkt> | undefined;
    for (const e of events) expected = applyBkt(expected, e.correct, e.ts);
    expect(after.mastery[topicId]!.p).toBeCloseTo(expected!.p, 12);
  }, 20_000);

  it('evidenceEvents.appendAndFold with no events is a no-op that writes nothing', async () => {
    const before = await repos.learnerProfiles.get(own);
    expect(await repos.evidenceEvents.appendAndFold(own, [])).toEqual([]);
    expect(await repos.learnerProfiles.get(own)).toEqual(before);
  }, 15_000);

  it('evidenceEvents.appendAndFold replaying the same id a second time inserts nothing and folds nothing', async () => {
    const e = event({ topicId, ts: '2026-10-20T15:00:00.000Z' });
    const withId = { ...e, id: 'ev_fixed_appendandfold_01' };
    const first = await repos.evidenceEvents.appendAndFold(own, [withId]);
    expect(first).toHaveLength(1);
    const afterFirst = await repos.learnerProfiles.get(own);

    const second = await repos.evidenceEvents.appendAndFold(own, [withId]);
    expect(second).toEqual([]);
    expect(await repos.learnerProfiles.get(own)).toEqual(afterFirst);
  }, 15_000);

  it('learnerProfiles.applyEvidenceMastery with no events is a no-op that writes nothing', async () => {
    const before = await repos.learnerProfiles.get(own);
    await repos.learnerProfiles.applyEvidenceMastery(own, []);
    expect(await repos.learnerProfiles.get(own)).toEqual(before);
  }, 15_000);

  it('learnerProfiles.applyMastery with an empty patch writes nothing', async () => {
    const before = await repos.learnerProfiles.get(own);
    await repos.learnerProfiles.applyMastery(own, {});
    expect(await repos.learnerProfiles.get(own)).toEqual(before);
  }, 15_000);

  it(// Task 6.2: rebuildMastery discards stored mastery and replays the complete evidence_events
  // history, ordered ts ASC (not insertion order), reproducing the hand-computed plan values to
  // 3 decimals, and matches the pure foldMastery({}, events) fold for the same event history.
  'rebuildMastery replays the complete evidence_events history in ts order (not insertion order) and matches the pure fold', async () => {
    const scope = { studentId: 'stu_rebuild', teacherId: own.teacherId };
    await handle.db.execute(
      sql`insert into users (id, name, locale, market, role)
            values (${scope.studentId}, 'Rebuild', 'en', 'test', 'student')`,
    );
    // A second topic for own.teacherId (the seed gives each teacher only one topic): the plan's
    // "Topic B" needs its own id under the *same* teacher as "Topic A" (topicId).
    const topicB = 'top_rebuild_b';
    await handle.db.execute(
      sql`insert into topics (id, teacher_id, module_id, title, "order")
            values (${topicB}, ${own.teacherId}, ${ids.module('A', 1)}, 'rebuild topic B', 1)`,
    );
    // Stale/corrupted mastery, and a target row to prove the rebuild discards (not merges) it.
    await repos.learnerProfiles.save(scope, {
      ...scope,
      lang: 'en',
      mastery: { [topicB]: { p: 0.999, n: 999, updatedAt: '2000-01-01T00:00:00.000Z' } },
      mistakes: [],
      lastSummary: 'stale summary, must survive untouched',
    });

    // Topic A: 3 events (correct, correct, incorrect). Topic B: 1 event (incorrect).
    // Inserted out of chronological order to prove the rebuild sorts by ts, not insertion order.
    const rawEvents: { topicId: string; correct: boolean; ts: string }[] = [
      { topicId: topicId, correct: false, ts: '2026-10-19T10:10:00.000Z' },
      { topicId: topicB, correct: false, ts: '2026-10-19T09:00:00.000Z' },
      { topicId: topicId, correct: true, ts: '2026-10-19T10:00:00.000Z' },
      { topicId: topicId, correct: true, ts: '2026-10-19T10:05:00.000Z' },
    ];
    await repos.evidenceEvents.append(
      scope,
      rawEvents.map((e) => ({
        ...scope,
        topicId: e.topicId,
        correct: e.correct,
        source: 'practice',
        weight: 1,
        ts: e.ts,
      })),
    );

    const rebuilt = await repos.learnerProfiles.rebuildMastery(scope);

    const expected = foldMastery(
      {},
      [...rawEvents].sort((a, b) => a.ts.localeCompare(b.ts)),
    );
    expect(rebuilt.mastery[topicId]!.n).toBe(3);
    expect(rebuilt.mastery[topicId]!.p).toBeCloseTo(0.5781021897810219, 3);
    expect(rebuilt.mastery[topicId]!.p).toBeCloseTo(expected[topicId]!.p, 10);
    expect(rebuilt.mastery[topicB]!.n).toBe(1);
    expect(rebuilt.mastery[topicB]!.p).toBeCloseTo(0.17575757575757575, 3);
    expect(rebuilt.mastery[topicB]!.p).toBeCloseTo(expected[topicB]!.p, 10);

    // Stale value discarded, not merged: n is 1 (not 999), and mistakes/lastSummary untouched.
    expect(rebuilt.mastery[topicB]!.n).toBe(1);
    expect(rebuilt.mistakes).toEqual([]);
    expect(rebuilt.lastSummary).toBe('stale summary, must survive untouched');

    // Stored row matches the returned value.
    const stored = await repos.learnerProfiles.get(scope);
    expect(stored!.mastery).toEqual(rebuilt.mastery);

    // Fix round 1 (6.2, finding 2): the rebuild-vs-incremental agreement the plan promised was
    // never actually tested (the test above only compares rebuildMastery against the same
    // foldMastery helper it calls internally). On a second scope, replay the same ordered events
    // one by one through the incremental path (profileStoreFor.applyEvidence), and assert its
    // stored mastery equals this scope's rebuildMastery result.
    const agree = { studentId: 'stu_rebuild_agree', teacherId: own.teacherId };
    await handle.db.execute(
      sql`insert into users (id, name, locale, market, role)
            values (${agree.studentId}, 'Agree', 'en', 'test', 'student')`,
    );
    const agreeStore = profileStoreFor(repos, agree);
    const ordered = [...rawEvents].sort((a, b) => a.ts.localeCompare(b.ts));
    for (const e of ordered) {
      await agreeStore.applyEvidence([
        {
          ...agree,
          topicId: e.topicId,
          correct: e.correct,
          source: 'practice',
          weight: 1,
          ts: e.ts,
        },
      ]);
    }
    const agreed = await repos.learnerProfiles.get(agree);
    expect(agreed!.mastery[topicId]!.p).toBeCloseTo(rebuilt.mastery[topicId]!.p, 3);
    expect(agreed!.mastery[topicB]!.p).toBeCloseTo(rebuilt.mastery[topicB]!.p, 3);
    expect(agreed!.mastery[topicId]!.n).toBe(rebuilt.mastery[topicId]!.n);
    expect(agreed!.mastery[topicB]!.n).toBe(rebuilt.mastery[topicB]!.n);
  }, 15_000);

  it(// Task 6.2a (6.2 review deferral): rebuildMastery's replay is paged (REBUILD_PAGE_SIZE rows
  // per query, same transaction/lock). Bulk-insert N = 2 * REBUILD_PAGE_SIZE + 37 evidence_events
  // rows (deliberately not a multiple of the page size, so the replay spans 3 pages with a
  // partial last page) for one fresh scope, each with a distinct ts, via one raw SQL
  // insert ... select ... from generate_series (fast, no per-row JS insert). This bounds
  // correctness by count across page boundaries, not wall-clock: an off-by-one at a page edge
  // (a dropped or duplicated row at a cursor boundary) would show up as a wrong n or a wrong p.
  'rebuildMastery folds a history spanning multiple REBUILD_PAGE_SIZE pages identically to one unbounded fold', async () => {
    const scope = { studentId: 'stu_rebuild_paged', teacherId: own.teacherId };
    await handle.db.execute(
      sql`insert into users (id, name, locale, market, role)
            values (${scope.studentId}, 'Paged', 'en', 'test', 'student')`,
    );
    const n = 2 * REBUILD_PAGE_SIZE + 37;
    await handle.db.execute(sql`
        insert into evidence_events (id, student_id, teacher_id, topic_id, correct, source, weight, ts)
        select 'ev_paged_' || gs,
               ${scope.studentId},
               ${scope.teacherId},
               ${topicId},
               (gs % 3 != 0),
               'practice',
               1,
               now() + (gs * interval '1 millisecond')
        from generate_series(1, ${n}) gs
      `);

    const rebuilt = await repos.learnerProfiles.rebuildMastery(scope);

    const rows = await handle.db.execute<{ correct: boolean; ts: string | Date }>(
      sql`select correct, ts from evidence_events
            where student_id = ${scope.studentId} and teacher_id = ${scope.teacherId}
            order by ts asc, id asc`,
    );
    expect(rows.rows.length).toBe(n);
    const expected = foldMastery(
      {},
      rows.rows.map((r) => ({
        topicId,
        correct: r.correct,
        ts: new Date(r.ts).toISOString(),
      })),
    );

    expect(rebuilt.mastery[topicId]!.n).toBe(n);
    expect(rebuilt.mastery[topicId]!.n).toBe(expected[topicId]!.n);
    expect(rebuilt.mastery[topicId]!.p).toBeCloseTo(expected[topicId]!.p, 10);
  }, 30_000);

  it(// Fix round 1 (6.2, finding 1): applyEvidence's append and fold used to run as two separate
  // transactions; a rebuildMastery racing in the gap between them could read the just-committed
  // event and fold it into a full replay, while the incremental fold then folded the same event
  // again onto the old stored value — a double count. Now both run inside one transaction
  // (evidenceEventsRepo.appendAndFold), with the learner_profiles row locked before the event is
  // inserted, so a concurrent rebuildMastery (which locks the same row first) fully serialises
  // against it. Racing the two, many times, for the same scope must never double-count: the
  // stored mastery must always equal a fresh rebuildMastery over the complete history.
  'applyEvidence racing a concurrent rebuildMastery never double-counts an event', async () => {
    const scope = { studentId: 'stu_race_evidence', teacherId: own.teacherId };
    await handle.db.execute(
      sql`insert into users (id, name, locale, market, role)
            values (${scope.studentId}, 'Race', 'en', 'test', 'student')`,
    );
    const store = profileStoreFor(repos, scope);
    const correctness: boolean[] = [true, true, false, true, false];
    for (let i = 0; i < correctness.length; i++) {
      const e = event({
        ...scope,
        correct: correctness[i]!,
        ts: new Date(Date.UTC(2026, 9, 20, 10, 0, i)).toISOString(),
      });
      await Promise.all([
        store.applyEvidence([e]),
        repos.learnerProfiles.rebuildMastery(scope),
        repos.learnerProfiles.rebuildMastery(scope),
      ]);
    }
    const fresh = await repos.learnerProfiles.rebuildMastery(scope);
    const stored = await repos.learnerProfiles.get(scope);
    expect(stored!.mastery[topicId]!.n).toBe(correctness.length);
    expect(fresh.mastery[topicId]!.n).toBe(correctness.length);
    expect(stored!.mastery[topicId]!.p).toBeCloseTo(fresh.mastery[topicId]!.p, 10);
    // Hand-computed reference (plan.md's Topic A table, first 3 events: correct, correct,
    // incorrect, from pInit).
    const first3 = foldMastery(
      {},
      correctness.slice(0, 3).map((correct, i) => ({
        topicId,
        correct,
        ts: new Date(Date.UTC(2026, 9, 20, 10, 0, i)).toISOString(),
      })),
    );
    expect(first3[topicId]!.p).toBeCloseTo(0.5781021897810219, 3);
  }, 30_000);

  it('rebuildMastery rejects a malformed scope before any SQL', async () => {
    expect(
      await kind(
        repos.learnerProfiles.rebuildMastery({ studentId: 'a b', teacherId: own.teacherId }),
      ),
    ).toBe('scope');
    expect(
      await kind(repos.learnerProfiles.rebuildMastery({ studentId: own.studentId, teacherId: '' })),
    ).toBe('scope');
  }, 15_000);

  it(// Task 6.3: applyMistakes merges a known-only patch into mistakes (count/lastSeen merged, not
  // replaced), leaving mastery and lastSummary untouched -- same no-clobber invariant 6.2 and
  // 3.17 already guard for their own columns.
  'applyMistakes merges a patch into mistakes (count/lastSeen merged) and leaves mastery and lastSummary untouched', async () => {
    const fresh = { studentId: 'stu_mistakes', teacherId: own.teacherId };
    await handle.db.execute(
      sql`insert into users (id, name, locale, market, role)
            values (${fresh.studentId}, 'Mistakes', 'en', 'test', 'student')`,
    );
    await repos.learnerProfiles.save(fresh, {
      ...fresh,
      lang: 'en',
      mastery: { [topicId]: { p: 0.5, n: 1, updatedAt: '2026-10-19T10:00:00.000Z' } },
      mistakes: [{ tag: 'off-by-one-range', count: 1, lastSeen: '2026-10-19T10:00:00.000Z' }],
      lastSummary: 'seeded summary',
    });

    await repos.learnerProfiles.applyMistakes(
      fresh,
      [
        { tag: 'off-by-one-range', count: 2, lastSeen: '2026-10-20T10:00:00.000Z' },
        { tag: 'string-number-mix', count: 1, lastSeen: '2026-10-19T11:00:00.000Z' },
      ],
      ['off-by-one-range', 'string-number-mix'],
    );

    const after = await repos.learnerProfiles.get(fresh);
    expect(after!.mistakes).toEqual(
      expect.arrayContaining([
        { tag: 'off-by-one-range', count: 3, lastSeen: '2026-10-20T10:00:00.000Z' },
        { tag: 'string-number-mix', count: 1, lastSeen: '2026-10-19T11:00:00.000Z' },
      ]),
    );
    expect(after!.mistakes).toHaveLength(2);
    expect(after!.mastery).toEqual({
      [topicId]: { p: 0.5, n: 1, updatedAt: '2026-10-19T10:00:00.000Z' },
    });
    expect(after!.lastSummary).toBe('seeded summary');
  }, 15_000);

  it('applyMistakes rejects a malformed scope before any SQL, and is a no-op for an empty patch', async () => {
    expect(
      await kind(
        repos.learnerProfiles.applyMistakes(
          { studentId: 'a b', teacherId: own.teacherId },
          [{ tag: 'off-by-one-range', count: 1, lastSeen: '2026-10-19T10:00:00.000Z' }],
          ['off-by-one-range'],
        ),
      ),
    ).toBe('scope');
    expect(
      await kind(
        repos.learnerProfiles.applyMistakes(
          { studentId: own.studentId, teacherId: '' },
          [{ tag: 'off-by-one-range', count: 1, lastSeen: '2026-10-19T10:00:00.000Z' }],
          ['off-by-one-range'],
        ),
      ),
    ).toBe('scope');

    const before = await repos.learnerProfiles.get(own);
    await repos.learnerProfiles.applyMistakes(own, [], []);
    expect(await repos.learnerProfiles.get(own)).toEqual(before);
  }, 15_000);

  it(// Task 6.3b (6.3 review follow-up): 20 concurrent applyMistakes calls on the same scope and
  // the same tag (count 1 each, a fresh lastSeen per call) must never lose an update -- same
  // row-lock shape as 6.2a's own applyEvidence/rebuildMastery race test, new coverage for the
  // lock this file already had.
  'applyMistakes racing N concurrent calls on the same tag never loses an update', async () => {
    const scope = { studentId: 'stu_race_mistakes', teacherId: own.teacherId };
    await handle.db.execute(
      sql`insert into users (id, name, locale, market, role)
            values (${scope.studentId}, 'Race Mistakes', 'en', 'test', 'student')`,
    );
    const n = 20;
    await Promise.all(
      Array.from({ length: n }, (_, i) =>
        repos.learnerProfiles.applyMistakes(
          scope,
          [
            {
              tag: 'race-tag',
              count: 1,
              lastSeen: new Date(Date.UTC(2026, 9, 20, 10, 0, i)).toISOString(),
            },
          ],
          ['race-tag'],
        ),
      ),
    );
    const after = await repos.learnerProfiles.get(scope);
    expect(after!.mistakes).toEqual([
      {
        tag: 'race-tag',
        count: n,
        lastSeen: new Date(Date.UTC(2026, 9, 20, 10, 0, n - 1)).toISOString(),
      },
    ]);
  }, 30_000);

  it(// Task 6.3b: a patch over MAX_MISTAKES_PATCH_LENGTH is `invalid` before any row is touched.
  'applyMistakes rejects a patch longer than MAX_MISTAKES_PATCH_LENGTH before any row exists', async () => {
    const scope = { studentId: 'stu_mistakes_toolong', teacherId: own.teacherId };
    await handle.db.execute(
      sql`insert into users (id, name, locale, market, role)
            values (${scope.studentId}, 'Too Long', 'en', 'test', 'student')`,
    );
    const tags = Array.from({ length: MAX_MISTAKES_PATCH_LENGTH + 1 }, (_, i) => `tag-${i}`);
    const patch = tags.map((tag) => ({
      tag,
      count: 1,
      lastSeen: '2026-10-19T10:00:00.000Z',
    }));
    expect(await kind(repos.learnerProfiles.applyMistakes(scope, patch, tags))).toBe('invalid');
    expect(await repos.learnerProfiles.get(scope)).toBeNull();
  }, 15_000);

  it(// Task 6.3b: a write that would push the stored array past MAX_MISTAKES_ENTRIES is `limit`,
  // and the existing row is left unchanged (atomic, no partial write).
  'applyMistakes rejects a write that would exceed MAX_MISTAKES_ENTRIES, leaving the row unchanged', async () => {
    const scope = { studentId: 'stu_mistakes_capped', teacherId: own.teacherId };
    await handle.db.execute(
      sql`insert into users (id, name, locale, market, role)
            values (${scope.studentId}, 'Capped', 'en', 'test', 'student')`,
    );
    const existingTags = Array.from({ length: MAX_MISTAKES_ENTRIES }, (_, i) => `tag-${i}`);
    const allowedTags = [...existingTags, 'new-tag'];
    await repos.learnerProfiles.save(scope, {
      ...scope,
      lang: 'en',
      mastery: {},
      mistakes: existingTags.map((tag) => ({
        tag,
        count: 1,
        lastSeen: '2026-10-19T10:00:00.000Z',
      })),
    });

    expect(
      await kind(
        repos.learnerProfiles.applyMistakes(
          scope,
          [{ tag: 'new-tag', count: 1, lastSeen: '2026-10-20T10:00:00.000Z' }],
          allowedTags,
        ),
      ),
    ).toBe('limit');

    const after = await repos.learnerProfiles.get(scope);
    expect(after!.mistakes).toHaveLength(MAX_MISTAKES_ENTRIES);
    expect(after!.mistakes.some((m) => m.tag === 'new-tag')).toBe(false);
  }, 15_000);

  it(// Task 6.3b (6.3 review LOW): a patch naming a tag outside allowedTags is `scope` before any
  // row is touched -- defense in depth for a future caller that skips classifyMistakeTags.
  'applyMistakes rejects a tag not present in allowedTags before any row exists', async () => {
    const scope = { studentId: 'stu_mistakes_scope', teacherId: own.teacherId };
    await handle.db.execute(
      sql`insert into users (id, name, locale, market, role)
            values (${scope.studentId}, 'Scope Check', 'en', 'test', 'student')`,
    );
    expect(
      await kind(
        repos.learnerProfiles.applyMistakes(
          scope,
          [{ tag: 'off-list-tag', count: 1, lastSeen: '2026-10-19T10:00:00.000Z' }],
          ['allowed-tag'],
        ),
      ),
    ).toBe('scope');
    expect(await repos.learnerProfiles.get(scope)).toBeNull();
  }, 15_000);

  // Task 6.3d (6.3c Phase B): profileStoreFor.applyMistakes/recordProposedMistakes through the real
  // db adapter. A fresh style card + agent version + session per case (never mutating the seeded
  // sty_a / agent version 1 other tests in this file depend on).
  describe('profileStoreFor.applyMistakes / recordProposedMistakes', () => {
    // Each case needs its own agent_versions row (agent_id, version) is unique, so this starts
    // past the seed's version 1 and bumps every call -- never reusing a version across cases.
    let nextAgentVersion = 2;

    async function withSession(
      mistakeTags: string[],
      studentPostfix: string,
    ): Promise<{ scope: { studentId: string; teacherId: string }; sessionId: string }> {
      const scope = {
        studentId: `stu_mistakes_adapter_${studentPostfix}`,
        teacherId: own.teacherId,
      };
      const agentVersion = nextAgentVersion++;
      await handle.db.execute(
        sql`insert into users (id, name, locale, market, role)
              values (${scope.studentId}, 'Mistakes Adapter', 'en', 'test', 'student')`,
      );
      const card = await repos.styleCards.create(
        { teacherId: own.teacherId },
        { text: `[A] style for ${studentPostfix}`, mistakeTags },
      );
      const agentVersionId = `av_mistakes_${studentPostfix}`;
      const config = {
        ...(await repos.agentVersions.get(
          { teacherId: own.teacherId },
          { agentId: ids.agent('A'), version: 1 },
        ))!,
        version: agentVersion,
        styleCardId: card.id,
      };
      await handle.db.execute(sql`
        insert into agent_versions (id, teacher_id, agent_id, version, config)
        values (${agentVersionId}, ${own.teacherId}, ${ids.agent('A')}, ${agentVersion}, ${JSON.stringify(config)}::jsonb)
      `);
      const { id: sessionId } = await repos.sessions.create(scope, {
        agentId: ids.agent('A'),
        agentVersion,
        packageId: ids.pkg('A'),
        packageVersion: 1,
      });
      return { scope, sessionId };
    }

    it('a known tag on the style card lands on the profile through the real db adapter', async () => {
      const { scope, sessionId } = await withSession(['late_carry'], 'known');
      const store = profileStoreFor(repos, scope, sessionId);
      await store.applyMistakes!(
        scope,
        [{ tag: 'late_carry', count: 1, lastSeen: '2026-10-27T10:00:00.000Z' }],
        [],
      );
      const after = await repos.learnerProfiles.get(scope);
      expect(after!.mistakes).toEqual([
        { tag: 'late_carry', count: 1, lastSeen: '2026-10-27T10:00:00.000Z' },
      ]);
    }, 15_000);

    it('an off-list tag is a scope error and writes nothing', async () => {
      const { scope, sessionId } = await withSession(['late_carry'], 'offlist');
      const store = profileStoreFor(repos, scope, sessionId);
      expect(
        await kind(
          store.applyMistakes!(
            scope,
            [{ tag: 'not_on_card', count: 1, lastSeen: '2026-10-27T10:00:00.000Z' }],
            [],
          ),
        ),
      ).toBe('scope');
      expect(await repos.learnerProfiles.get(scope)).toBeNull();
    }, 15_000);

    it('a call naming another pair is a scope error', async () => {
      const { scope, sessionId } = await withSession(['late_carry'], 'otherpair');
      const store = profileStoreFor(repos, scope, sessionId);
      expect(
        await kind(
          store.applyMistakes!(
            { studentId: scope.studentId, teacherId: teacherId('B') },
            [{ tag: 'late_carry', count: 1, lastSeen: '2026-10-27T10:00:00.000Z' }],
            [],
          ),
        ),
      ).toBe('scope');
      expect(await repos.learnerProfiles.get(scope)).toBeNull();
    }, 15_000);

    it('recordProposedMistakes is a documented no-op for the bound pair, and a scope error for another', async () => {
      const { scope, sessionId } = await withSession(['late_carry'], 'proposed');
      const store = profileStoreFor(repos, scope, sessionId);
      await expect(
        store.recordProposedMistakes!(scope, [
          { tag: 'not_on_card', count: 1, lastSeen: '2026-10-27T10:00:00.000Z' },
        ]),
      ).resolves.toBeUndefined();
      expect(await repos.learnerProfiles.get(scope)).toBeNull();
      expect(
        await kind(
          store.recordProposedMistakes!({ studentId: scope.studentId, teacherId: teacherId('B') }, [
            { tag: 'not_on_card', count: 1, lastSeen: '2026-10-27T10:00:00.000Z' },
          ]),
        ),
      ).toBe('scope');
    }, 15_000);

    it('a missing/unresolvable session is an integrity error, not a silent drop', async () => {
      const scope = { studentId: 'stu_mistakes_adapter_missing', teacherId: own.teacherId };
      await handle.db.execute(
        sql`insert into users (id, name, locale, market, role)
              values (${scope.studentId}, 'Missing Session', 'en', 'test', 'student')`,
      );
      const store = profileStoreFor(repos, scope, 'session-does-not-exist');
      expect(
        await kind(
          store.applyMistakes!(
            scope,
            [{ tag: 'late_carry', count: 1, lastSeen: '2026-10-27T10:00:00.000Z' }],
            [],
          ),
        ),
      ).toBe('integrity');
    }, 15_000);

    it('no sessionId and a non-empty known array is also an integrity error', async () => {
      const scope = { studentId: 'stu_mistakes_adapter_nosession', teacherId: own.teacherId };
      await handle.db.execute(
        sql`insert into users (id, name, locale, market, role)
              values (${scope.studentId}, 'No Session', 'en', 'test', 'student')`,
      );
      const store = profileStoreFor(repos, scope);
      expect(
        await kind(
          store.applyMistakes!(
            scope,
            [{ tag: 'late_carry', count: 1, lastSeen: '2026-10-27T10:00:00.000Z' }],
            [],
          ),
        ),
      ).toBe('integrity');
    }, 15_000);

    it(// Task 6.3d fix round 1: the session resolves, but its agent version row is missing --
    // `resolveMistakeTagAllowList` throws `integrity` rather than defaulting the allow-list, and
    // the write never happens.
    'a session whose agent version does not exist is an integrity error, not a silent drop', async () => {
      const scope = { studentId: 'stu_mistakes_adapter_noagentversion', teacherId: own.teacherId };
      await handle.db.execute(
        sql`insert into users (id, name, locale, market, role)
              values (${scope.studentId}, 'No Agent Version', 'en', 'test', 'student')`,
      );
      const agentVersion = nextAgentVersion++;
      // A session naming a (agent_id, version) pair that has no row in agent_versions: insert
      // the session row directly (repos.sessions.create would need the agent_versions row to
      // already exist for other call sites, so this is built by hand for this case only).
      const sessionId = 'sess_mistakes_noagentversion';
      await handle.db.execute(sql`
          insert into sessions (id, student_id, teacher_id, agent_id, agent_version, package_id, package_version)
          values (${sessionId}, ${scope.studentId}, ${own.teacherId}, ${ids.agent('A')}, ${agentVersion}, ${ids.pkg('A')}, 1)
        `);
      const store = profileStoreFor(repos, scope, sessionId);
      expect(
        await kind(
          store.applyMistakes!(
            scope,
            [{ tag: 'late_carry', count: 1, lastSeen: '2026-10-27T10:00:00.000Z' }],
            [],
          ),
        ),
      ).toBe('integrity');
      expect(await repos.learnerProfiles.get(scope)).toBeNull();
    }, 15_000);

    it(// Task 6.3d fix round 1: the session and its agent version both resolve, but the agent
    // version's style card id points at a style card that does not exist -- same `integrity`
    // guard, not "allow everything".
    'an agent version whose style card does not exist is an integrity error, not a silent drop', async () => {
      const scope = { studentId: 'stu_mistakes_adapter_nostylecard', teacherId: own.teacherId };
      await handle.db.execute(
        sql`insert into users (id, name, locale, market, role)
              values (${scope.studentId}, 'No Style Card', 'en', 'test', 'student')`,
      );
      const agentVersion = nextAgentVersion++;
      const config = {
        ...(await repos.agentVersions.get(
          { teacherId: own.teacherId },
          { agentId: ids.agent('A'), version: 1 },
        ))!,
        version: agentVersion,
        styleCardId: 'sty_does_not_exist',
      };
      const agentVersionId = 'av_mistakes_nostylecard';
      await handle.db.execute(sql`
          insert into agent_versions (id, teacher_id, agent_id, version, config)
          values (${agentVersionId}, ${own.teacherId}, ${ids.agent('A')}, ${agentVersion}, ${JSON.stringify(config)}::jsonb)
        `);
      const { id: sessionId } = await repos.sessions.create(scope, {
        agentId: ids.agent('A'),
        agentVersion,
        packageId: ids.pkg('A'),
        packageVersion: 1,
      });
      const store = profileStoreFor(repos, scope, sessionId);
      expect(
        await kind(
          store.applyMistakes!(
            scope,
            [{ tag: 'late_carry', count: 1, lastSeen: '2026-10-27T10:00:00.000Z' }],
            [],
          ),
        ),
      ).toBe('integrity');
      expect(await repos.learnerProfiles.get(scope)).toBeNull();
    }, 15_000);

    it('an empty known array is a no-op even with no sessionId', async () => {
      const scope = { studentId: 'stu_mistakes_adapter_emptyknown', teacherId: own.teacherId };
      await handle.db.execute(
        sql`insert into users (id, name, locale, market, role)
              values (${scope.studentId}, 'Empty Known', 'en', 'test', 'student')`,
      );
      const store = profileStoreFor(repos, scope);
      await expect(store.applyMistakes!(scope, [], [])).resolves.toBeUndefined();
      expect(await repos.learnerProfiles.get(scope)).toBeNull();
    }, 15_000);

    // 6.3e: the adapter's third parameter (`proposed`) is accepted but ignored -- it does not
    // persist proposed tags yet (6.3a lands that; `recordProposedMistakes` is the separate port).
    it('a non-empty proposed array is ignored when known is empty', async () => {
      const scope = { studentId: 'stu_mistakes_adapter_proposedignored', teacherId: own.teacherId };
      await handle.db.execute(
        sql`insert into users (id, name, locale, market, role)
              values (${scope.studentId}, 'Proposed Ignored', 'en', 'test', 'student')`,
      );
      const store = profileStoreFor(repos, scope);
      await expect(
        store.applyMistakes!(
          scope,
          [],
          [{ tag: 'late_carry', count: 1, lastSeen: '2026-10-27T10:00:00.000Z' }],
        ),
      ).resolves.toBeUndefined();
      expect(await repos.learnerProfiles.get(scope)).toBeNull();
    }, 15_000);
  });
});
