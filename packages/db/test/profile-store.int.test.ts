// Task 3.17 on Postgres: profileStoreFor's `get` default for a never-seen student, `applyEvidence`
// updating named topics' mastery idempotently (BKT), mistakes/lastSummary untouched, and scope
// isolation (another student or teacher, an unowned topic). See test/pg.ts for how to start one.
import { type EvidenceEvent } from '@edmate/contracts';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { migrateDatabase } from '../src/migrate.js';
import { foldMastery } from '../src/mastery.js';
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
    'learnerProfiles.applyMastery with an empty patch writes nothing',
    async () => {
      const before = await repos.learnerProfiles.get(own);
      await repos.learnerProfiles.applyMastery(own, {});
      expect(await repos.learnerProfiles.get(own)).toEqual(before);
    },
    15_000,
  );
});
