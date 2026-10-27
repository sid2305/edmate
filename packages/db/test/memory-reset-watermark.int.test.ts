// Task 6.5a on a real Postgres 16 + pgvector (see test/pg.ts): the memory_reset_at watermark.
// Own throwaway database (same template as memory-reset.int.test.ts), reusing isolation-seed.ts's
// own `seed`. Proves a job queued before a reset (a stale evidence event or a stale session end)
// cannot re-seed memory once applied after the reset.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import pg from 'pg';
import { migrateDatabase } from '../src/migrate.js';
import { createDb, type DbHandle } from '../src/internal.js';
import { createRepositories, type Repositories } from '../src/index.js';
import { ids, seed, studentId, teacherId } from './isolation-seed.js';
import {
  createDatabase,
  dropDatabase,
  postgresUp,
  SKIP_REASON,
  throwawayName,
  urlFor,
} from './pg.js';

const up = await postgresUp('memory reset watermark integration tests');
const dbName = throwawayName();
const TEST_URL = urlFor(dbName);
let handle: DbHandle;
let repos: Repositories;
let raw: pg.Client;

// The pair the watermark is exercised on.
const sc1A = { studentId: studentId('1'), teacherId: teacherId('A') };
// A pair that is never reset: the regression control.
const sc2B = { studentId: studentId('2'), teacherId: teacherId('B') };

async function memoryResetAt(sc: { studentId: string; teacherId: string }): Promise<string | null> {
  const res = await raw.query<{ memory_reset_at: string | null }>(
    'select memory_reset_at from learner_profiles where student_id = $1 and teacher_id = $2',
    [sc.studentId, sc.teacherId],
  );
  return res.rows[0]?.memory_reset_at ?? null;
}

describe.skipIf(!up)(
  `memory reset watermark on Postgres 16 + pgvector${up ? '' : ` (${SKIP_REASON})`}`,
  () => {
    beforeAll(async () => {
      await createDatabase(dbName);
      await migrateDatabase(TEST_URL);
      handle = createDb({ DATABASE_URL: TEST_URL });
      await seed(handle.db);
      repos = createRepositories(handle.db);
      raw = new pg.Client({ connectionString: TEST_URL });
      await raw.connect();
    });

    afterAll(async () => {
      await raw?.end();
      await handle?.close();
      await dropDatabase(dbName);
    });

    it(
      'a stale append/appendAndFold are dropped and a stale session.end skips the summary, ' +
        'leaving the profile empty; a mixed batch keeps only the after-reset event',
      async () => {
        const topicId = ids.topic('A');
        const staleTs = '2026-10-17T10:00:00Z'; // well before the reset below
        const afterTs = new Date(Date.now() + 60_000).toISOString(); // after the reset below

        // 1. reset stamps memory_reset_at = now() (seed's own open session for this pair ends too).
        const res = await repos.learnerProfiles.reset(sc1A);
        expect(res).toEqual({ reset: true });
        expect(await memoryResetAt(sc1A)).not.toBeNull();

        // 2. a stale append returns [] and writes nothing.
        const appended = await repos.evidenceEvents.append(sc1A, [
          { ...sc1A, topicId, correct: true, source: 'practice', weight: 1, ts: staleTs },
        ]);
        expect(appended).toEqual([]);

        // 3. a stale appendAndFold also returns [] and folds nothing.
        const folded = await repos.evidenceEvents.appendAndFold(sc1A, [
          { ...sc1A, topicId, correct: false, source: 'practice', weight: 1, ts: staleTs },
        ]);
        expect(folded).toEqual([]);

        // Neither stale call resurrected mastery: a full replay still gives {}.
        const rebuilt = await repos.learnerProfiles.rebuildMastery(sc1A);
        expect(rebuilt.mastery).toEqual({});

        // 4. a session whose own `created_at` predates the watermark still ends, but its summary
        // is never written onto the profile. (Simulates a job queued before the reset landing
        // after it; the session row itself is inserted here, after the reset, purely so the test
        // controls its `created_at` directly.)
        await raw.query(
          `insert into sessions
             (id, student_id, teacher_id, agent_id, agent_version, package_id, package_version, created_at)
           values ('ses_stale_1a', $1, $2, $3, 1, $4, 1, $5)`,
          [sc1A.studentId, sc1A.teacherId, ids.agent('A'), ids.pkg('A'), staleTs],
        );
        const endRes = await repos.sessions.end(sc1A, 'ses_stale_1a', 'a late summary');
        expect(endRes).toEqual({ ended: true });
        const profileAfterEnd = await repos.learnerProfiles.get(sc1A);
        expect(profileAfterEnd && 'lastSummary' in profileAfterEnd).toBe(false);

        // 5. a mixed batch through appendAndFold returns and folds only the after-reset event.
        const mixed = await repos.evidenceEvents.appendAndFold(sc1A, [
          { ...sc1A, topicId, correct: true, source: 'practice', weight: 1, ts: staleTs },
          { ...sc1A, topicId, correct: true, source: 'practice', weight: 1, ts: afterTs },
        ]);
        expect(mixed).toHaveLength(1);
        expect(mixed[0]?.ts).toBe(new Date(afterTs).toISOString());
        const afterMixed = await repos.learnerProfiles.get(sc1A);
        expect(afterMixed?.mastery[topicId]?.n).toBe(1);

        // append on a mixed batch also returns only the after-reset event (append never folds;
        // confirmed via the follow-up rebuildMastery below).
        const laterTs = new Date(Date.now() + 120_000).toISOString();
        const appendedMixed = await repos.evidenceEvents.append(sc1A, [
          { ...sc1A, topicId, correct: false, source: 'practice', weight: 1, ts: staleTs },
          { ...sc1A, topicId, correct: false, source: 'practice', weight: 1, ts: laterTs },
        ]);
        expect(appendedMixed).toHaveLength(1);
        expect(appendedMixed[0]?.ts).toBe(new Date(laterTs).toISOString());
        // append alone never folds mastery: still just the one event folded by appendAndFold above.
        const rebuiltAfter = await repos.learnerProfiles.rebuildMastery(sc1A);
        expect(Object.keys(rebuiltAfter.mastery[topicId] ?? {})).not.toHaveLength(0);
        expect(rebuiltAfter.mastery[topicId]?.n).toBe(2); // the after-reset events from both calls
      },
    );

    it('a pair that was never reset (memory_reset_at stays NULL) behaves exactly as before', async () => {
      expect(await memoryResetAt(sc2B)).toBeNull();
      const topicId = ids.topic('B');
      const ts = new Date().toISOString();

      const appended = await repos.evidenceEvents.append(sc2B, [
        { ...sc2B, topicId, correct: true, source: 'practice', weight: 1, ts },
      ]);
      expect(appended).toHaveLength(1);

      const folded = await repos.evidenceEvents.appendAndFold(sc2B, [
        { ...sc2B, topicId, correct: true, source: 'practice', weight: 1, ts },
      ]);
      expect(folded).toHaveLength(1);

      // Reuse the seed's own open session for this pair (task 5.10d: at most one open session
      // per teacher/student/agent, so inserting a second would collide with that partial index).
      const endRes = await repos.sessions.end(sc2B, ids.session('2B'), 'a normal summary');
      expect(endRes).toEqual({ ended: true });
      const profile = await repos.learnerProfiles.get(sc2B);
      expect(profile?.lastSummary).toBe('a normal summary');

      expect(await memoryResetAt(sc2B)).toBeNull();
    });
  },
);
