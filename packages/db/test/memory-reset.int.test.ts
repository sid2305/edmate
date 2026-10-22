// Task 6.5 on a real Postgres 16 + pgvector (see test/pg.ts): learnerProfiles.reset and
// evidenceEvents.list. Cross-scope isolation of the two methods also runs in
// repositories.int.test.ts (the CASES grid); this suite has its own throwaway database (via
// isolation-seed.ts's own `seed`, reused as-is) and proves the acceptance in depth: the lock
// order, the counts-only audit row, and the race with appendAndFold / sessions.end.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import pg from 'pg';
import { migrateDatabase } from '../src/migrate.js';
import { createDb, type DbHandle } from '../src/internal.js';
import { createRepositories, EVIDENCE_LIST_MAX, type Repositories } from '../src/index.js';
import { ids, seed, studentId, teacherId } from './isolation-seed.js';
import {
  createDatabase,
  dropDatabase,
  postgresUp,
  SKIP_REASON,
  throwawayName,
  urlFor,
} from './pg.js';

const up = await postgresUp('memory reset integration tests');
const dbName = throwawayName();
const TEST_URL = urlFor(dbName);
let handle: DbHandle;
let repos: Repositories;
let raw: pg.Client;

const sc1A = { studentId: studentId('1'), teacherId: teacherId('A') };
const sc1B = { studentId: studentId('1'), teacherId: teacherId('B') };
const sc2A = { studentId: studentId('2'), teacherId: teacherId('A') };
const sc2B = { studentId: studentId('2'), teacherId: teacherId('B') };

async function profileId(sc: { studentId: string; teacherId: string }): Promise<string> {
  const res = await raw.query<{ id: string }>(
    'select id from learner_profiles where student_id = $1 and teacher_id = $2',
    [sc.studentId, sc.teacherId],
  );
  return res.rows[0]!.id;
}

async function evidenceCount(sc: { studentId: string; teacherId: string }): Promise<number> {
  const res = await raw.query<{ n: number }>(
    'select count(*)::int as n from evidence_events where student_id = $1 and teacher_id = $2',
    [sc.studentId, sc.teacherId],
  );
  return res.rows[0]!.n;
}

async function sessionEndedAt(id: string): Promise<string | null> {
  const res = await raw.query<{ ended_at: string | null }>(
    'select ended_at from sessions where id = $1',
    [id],
  );
  return res.rows[0]?.ended_at ?? null;
}

describe.skipIf(!up)(
  `memory reset and export on Postgres 16 + pgvector${up ? '' : ` (${SKIP_REASON})`}`,
  () => {
    beforeAll(async () => {
      await createDatabase(dbName);
      await migrateDatabase(TEST_URL);
      handle = createDb({ DATABASE_URL: TEST_URL });
      await seed(handle.db);
      repos = createRepositories(handle.db);
      raw = new pg.Client({ connectionString: TEST_URL });
      await raw.connect();

      // A fresh pair with an open session but no profile row at all (for the "no profile" case).
      await raw.query(
        `insert into users (id, name, locale, market, role) values ('stu_fresh', 'synthetic', 'en', 'test', 'student')`,
      );
      await raw.query(
        `insert into sessions (id, student_id, teacher_id, agent_id, agent_version, package_id, package_version)
         values ('ses_fresh', 'stu_fresh', $1, $2, 1, $3, 1)`,
        [teacherId('A'), ids.agent('A'), ids.pkg('A')],
      );
    });

    afterAll(async () => {
      await raw?.end();
      await handle?.close();
      await dropDatabase(dbName);
    });

    it('reset clears mastery, mistakes and the summary, deletes evidence, and audits counts only', async () => {
      const pid = await profileId(sc1A);
      expect(await evidenceCount(sc1A)).toBe(1);

      const res = await repos.learnerProfiles.reset(sc1A);
      expect(res).toEqual({ reset: true });

      const after = await repos.learnerProfiles.get(sc1A);
      expect(after).toMatchObject({ lang: 'en', mastery: {}, mistakes: [] });
      expect(after && 'lastSummary' in after).toBe(false);
      expect(await evidenceCount(sc1A)).toBe(0);

      // No resurrection: a rebuild over the now-empty history gives {}.
      const rebuilt = await repos.learnerProfiles.rebuildMastery(sc1A);
      expect(rebuilt.mastery).toEqual({});

      const audit = await repos.audit.listForStudent(sc1A, {
        target: `learner_profile:${pid}`,
        limit: 10,
      });
      expect(audit).toHaveLength(1);
      expect(audit[0]).toMatchObject({
        actor: sc1A.studentId,
        actorRole: 'student',
        action: 'profile.reset',
        teacherId: sc1A.teacherId,
        studentId: sc1A.studentId,
        before: { topics: 1, mistakes: 1, hadSummary: true, evidence: 1, sessionsEnded: 1 },
        after: { topics: 0, mistakes: 0, hadSummary: false, evidence: 0 },
      });
      // Never the summary text or the mistake tag, only counts.
      expect(JSON.stringify(audit)).not.toMatch(/last time|sign/);
    });

    it("every other pair (same student, another teacher; same teacher, another student) is unchanged", async () => {
      for (const sc of [sc1B, sc2A]) {
        const profile = await repos.learnerProfiles.get(sc);
        expect(profile?.mastery).not.toEqual({});
        expect(profile?.lastSummary).toBeDefined();
        expect(await evidenceCount(sc)).toBe(1);
      }
      expect(await sessionEndedAt(ids.session('1B'))).toBeNull();
    });

    it("ends the pair's open session; a later sessions.end can't re-seed the summary", async () => {
      expect(await sessionEndedAt(ids.session('1A'))).not.toBeNull();
      const res = await repos.sessions.end(sc1A, ids.session('1A'), 'a new summary');
      expect(res).toEqual({ ended: false });
      const profile = await repos.learnerProfiles.get(sc1A);
      expect(profile && 'lastSummary' in profile).toBe(false);
    });

    it('no profile row: `{ reset: false }`, nothing deleted, no audit row, but the open session still ends', async () => {
      const ghost = { studentId: 'stu_fresh', teacherId: teacherId('A') };
      expect(await evidenceCount(ghost)).toBe(0);
      const res = await repos.learnerProfiles.reset(ghost);
      expect(res).toEqual({ reset: false });
      expect(await sessionEndedAt('ses_fresh')).not.toBeNull();
      expect(await evidenceCount(ghost)).toBe(0);
      const audit = await raw.query('select 1 from audit_log where student_id = $1', ['stu_fresh']);
      expect(audit.rowCount).toBe(0);
    });

    it('a second reset writes a second audit row with zero counts (already empty, session already ended)', async () => {
      const pid = await profileId(sc1A);
      const res = await repos.learnerProfiles.reset(sc1A);
      expect(res).toEqual({ reset: true });
      const audit = await repos.audit.listForStudent(sc1A, {
        target: `learner_profile:${pid}`,
        limit: 10,
      });
      expect(audit).toHaveLength(2);
      expect(audit[0]).toMatchObject({
        before: { topics: 0, mistakes: 0, hadSummary: false, evidence: 0, sessionsEnded: 0 },
        after: { topics: 0, mistakes: 0, hadSummary: false, evidence: 0 },
      });
    });

    it('reset races appendAndFold for the same pair without a deadlock, ending in a consistent state', async () => {
      const sc = sc2B;
      const topicId = ids.topic('B');
      for (let i = 0; i < 20; i += 1) {
        const ts = new Date(Date.now() + i * 1000).toISOString();
        await expect(
          Promise.all([
            repos.learnerProfiles.reset(sc),
            repos.evidenceEvents.appendAndFold(sc, [
              { ...sc, topicId, correct: true, source: 'practice', weight: 1, ts },
            ]),
          ]),
        ).resolves.toBeDefined();
      }
      // Whatever evidence survived the race, the stored mastery agrees with a fresh replay of it
      // (evidence present implies mastery is folded from that evidence only; no stale fold left
      // over from a reset that raced an append).
      const stored = await repos.learnerProfiles.get(sc);
      const rebuilt = await repos.learnerProfiles.rebuildMastery(sc);
      expect(stored?.mastery).toEqual(rebuilt.mastery);
    });

    it('reset races sessions.end for the same pair without a deadlock', async () => {
      for (let i = 0; i < 10; i += 1) {
        const sid = `ses_race_${i}`;
        await raw.query(
          `insert into sessions (id, student_id, teacher_id, agent_id, agent_version, package_id, package_version)
           values ($1, $2, $3, $4, 1, $5, 1)`,
          [sid, sc1B.studentId, sc1B.teacherId, ids.agent('B'), ids.pkg('B')],
        );
        await expect(
          Promise.all([repos.learnerProfiles.reset(sc1B), repos.sessions.end(sc1B, sid, 'wrap')]),
        ).resolves.toBeDefined();
      }
    });

    describe('evidenceEvents.list', () => {
      it("own pair only, ordered by ts, truncated when cut, and rejects a limit over the max", async () => {
        const sc = sc2A;
        const topicId = ids.topic('A');
        const t0 = new Date('2026-10-20T10:00:00Z').toISOString();
        const t1 = new Date('2026-10-20T10:00:01Z').toISOString();
        await repos.evidenceEvents.append(sc, [
          { ...sc, topicId, correct: true, source: 'practice', weight: 1, ts: t0 },
          { ...sc, topicId, correct: false, source: 'practice', weight: 1, ts: t1 },
        ]);
        const full = await repos.evidenceEvents.list(sc, { limit: 10 });
        expect(full.truncated).toBe(false);
        expect(full.events).toHaveLength(3);
        const times = full.events.map((e) => Date.parse(e.ts));
        expect([...times].sort((a, b) => a - b)).toEqual(times);
        expect(full.events.every((e) => e.studentId === sc.studentId && e.teacherId === sc.teacherId)).toBe(
          true,
        );

        const cut = await repos.evidenceEvents.list(sc, { limit: 2 });
        expect(cut.truncated).toBe(true);
        expect(cut.events).toHaveLength(2);

        await expect(
          repos.evidenceEvents.list(sc, { limit: EVIDENCE_LIST_MAX + 1 }),
        ).rejects.toMatchObject({ kind: 'invalid' });
        await expect(repos.evidenceEvents.list(sc, { limit: 0 })).rejects.toMatchObject({
          kind: 'invalid',
        });
      });
    });
  },
);
