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

  it(
    'get on a never-seen pair defaults to lang en, empty mastery and mistakes',
    async () => {
      const fresh = { studentId: 'stu_never_seen', teacherId: own.teacherId };
      const store = profileStoreFor(repos, fresh);
      expect(await store.get(fresh.studentId, fresh.teacherId)).toEqual({
        ...fresh,
        lang: 'en',
        mastery: {},
        mistakes: [],
      });
    },
    15_000,
  );

  it(
    'get returns the seeded profile for a pair that already has one',
    async () => {
      const store = profileStoreFor(repos, own);
      const p = await store.get(own.studentId, own.teacherId);
      expect(p.mastery[topicId]).toBeDefined();
      expect(p.lastSummary).toBe('[1A] last time');
    },
    15_000,
  );

  it(
    'get rejects ids that are not the bound pair',
    async () => {
      const store = profileStoreFor(repos, own);
      expect(await kind(store.get('stu_other', own.teacherId))).toBe('scope');
      expect(await kind(store.get(own.studentId, 'tch_other'))).toBe('scope');
    },
    15_000,
  );

  it(
    'applyEvidence moves mastery for the named topic and leaves mistakes and lastSummary untouched',
    async () => {
      const store = profileStoreFor(repos, own);
      const before = await store.get(own.studentId, own.teacherId);
      const after = await store.applyEvidence([event({ ts: '2026-10-19T11:00:00.000Z' })]);
      expect(after.mastery[topicId]!.p).not.toBe(before.mastery[topicId]!.p);
      expect(after.mastery[topicId]!.n).toBe(before.mastery[topicId]!.n + 1);
      expect(after.mistakes).toEqual(before.mistakes);
      expect(after.lastSummary).toBe(before.lastSummary);
    },
    15_000,
  );

  it(
    'applying the same event twice (same id) changes mastery once — idempotent',
    async () => {
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
    },
    15_000,
  );

  it(
    'scope violations are rejected: another student, another teacher, an unowned topic',
    async () => {
      const store = profileStoreFor(repos, own);
      expect(
        await kind(store.applyEvidence([event({ studentId: 'stu_other' })])),
      ).toBe('scope');
      expect(
        await kind(store.applyEvidence([event({ teacherId: 'tch_other' })])),
      ).toBe('scope');
      expect(
        await kind(store.applyEvidence([event({ topicId: ids.topic('B') })])),
      ).toBe('scope');
    },
    15_000,
  );

  it(
    'an empty evidence array is a no-op that still returns the current profile',
    async () => {
      const store = profileStoreFor(repos, own);
      const before = await store.get(own.studentId, own.teacherId);
      const after = await store.applyEvidence([]);
      expect(after).toEqual(before);
    },
    15_000,
  );

  it(
    'applyEvidence on a never-seen pair creates the profile from scratch',
    async () => {
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
    },
    15_000,
  );

  it(
    // Review fix round (3.17): applyEvidence used to read the profile, fold BKT in app code and
    // merge the result back — two concurrent calls for the same pair and topic could both read the
    // same prior mastery and the second would clobber the first's update (a lost update). It now
    // locks the row and folds inside one transaction (evidenceEvents.appendAndFold), so
    // running the same 10 events concurrently gives exactly the result of applying them one by one.
    'applyEvidence under concurrency: 10 identical events on one topic give the deterministic sequential result',
    async () => {
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
    },
    20_000,
  );

  it(
    'evidenceEvents.appendAndFold with no events is a no-op that writes nothing',
    async () => {
      const before = await repos.learnerProfiles.get(own);
      expect(await repos.evidenceEvents.appendAndFold(own, [])).toEqual([]);
      expect(await repos.learnerProfiles.get(own)).toEqual(before);
    },
    15_000,
  );

  it(
    'evidenceEvents.appendAndFold replaying the same id a second time inserts nothing and folds nothing',
    async () => {
      const e = event({ topicId, ts: '2026-10-20T15:00:00.000Z' });
      const withId = { ...e, id: 'ev_fixed_appendandfold_01' };
      const first = await repos.evidenceEvents.appendAndFold(own, [withId]);
      expect(first).toHaveLength(1);
      const afterFirst = await repos.learnerProfiles.get(own);

      const second = await repos.evidenceEvents.appendAndFold(own, [withId]);
      expect(second).toEqual([]);
      expect(await repos.learnerProfiles.get(own)).toEqual(afterFirst);
    },
    15_000,
  );

  it(
    'learnerProfiles.applyEvidenceMastery with no events is a no-op that writes nothing',
    async () => {
      const before = await repos.learnerProfiles.get(own);
      await repos.learnerProfiles.applyEvidenceMastery(own, []);
      expect(await repos.learnerProfiles.get(own)).toEqual(before);
    },
    15_000,
  );

  it(
    'learnerProfiles.applyMastery with an empty patch writes nothing',
    async () => {
      const before = await repos.learnerProfiles.get(own);
      await repos.learnerProfiles.applyMastery(own, {});
      expect(await repos.learnerProfiles.get(own)).toEqual(before);
    },
    15_000,
  );

  it(
    // Task 6.2: rebuildMastery discards stored mastery and replays the complete evidence_events
    // history, ordered ts ASC (not insertion order), reproducing the hand-computed plan values to
    // 3 decimals, and matches the pure foldMastery({}, events) fold for the same event history.
    'rebuildMastery replays the complete evidence_events history in ts order (not insertion order) and matches the pure fold',
    async () => {
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
          { ...agree, topicId: e.topicId, correct: e.correct, source: 'practice', weight: 1, ts: e.ts },
        ]);
      }
      const agreed = await repos.learnerProfiles.get(agree);
      expect(agreed!.mastery[topicId]!.p).toBeCloseTo(rebuilt.mastery[topicId]!.p, 3);
      expect(agreed!.mastery[topicB]!.p).toBeCloseTo(rebuilt.mastery[topicB]!.p, 3);
      expect(agreed!.mastery[topicId]!.n).toBe(rebuilt.mastery[topicId]!.n);
      expect(agreed!.mastery[topicB]!.n).toBe(rebuilt.mastery[topicB]!.n);
    },
    15_000,
  );

  it(
    // Fix round 1 (6.2, finding 1): applyEvidence's append and fold used to run as two separate
    // transactions; a rebuildMastery racing in the gap between them could read the just-committed
    // event and fold it into a full replay, while the incremental fold then folded the same event
    // again onto the old stored value — a double count. Now both run inside one transaction
    // (evidenceEventsRepo.appendAndFold), with the learner_profiles row locked before the event is
    // inserted, so a concurrent rebuildMastery (which locks the same row first) fully serialises
    // against it. Racing the two, many times, for the same scope must never double-count: the
    // stored mastery must always equal a fresh rebuildMastery over the complete history.
    'applyEvidence racing a concurrent rebuildMastery never double-counts an event',
    async () => {
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
      const first3 = foldMastery({}, correctness.slice(0, 3).map((correct, i) => ({
        topicId,
        correct,
        ts: new Date(Date.UTC(2026, 9, 20, 10, 0, i)).toISOString(),
      })));
      expect(first3[topicId]!.p).toBeCloseTo(0.5781021897810219, 3);
    },
    30_000,
  );

  it(
    'rebuildMastery rejects a malformed scope before any SQL',
    async () => {
      expect(await kind(repos.learnerProfiles.rebuildMastery({ studentId: 'a b', teacherId: own.teacherId }))).toBe(
        'scope',
      );
      expect(await kind(repos.learnerProfiles.rebuildMastery({ studentId: own.studentId, teacherId: '' }))).toBe(
        'scope',
      );
    },
    15_000,
  );
});
