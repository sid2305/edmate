// Task 13.4 (Phase A), on a real Postgres 16 (see test/pg.ts; skipped locally without one, fails
// in CI). Each method's dry run reports a count and changes nothing; its live run purges only
// past-cutoff rows, and only the three tables this task covers — never safety_alerts.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import pg from 'pg';
import { migrateDatabase } from '../src/migrate.js';
import { createDb, type DbHandle } from '../src/internal.js';
import { retentionRepo, type RetentionRepo } from '../src/index.js';
import { createDatabase, dropDatabase, postgresUp, SKIP_REASON, throwawayName, urlFor } from './pg.js';

const up = await postgresUp('retention integration tests');
const dbName = throwawayName();
const TEST_URL = urlFor(dbName);

const OLD = new Date('2020-01-01T00:00:00Z');
const RECENT = new Date('2026-10-01T00:00:00Z');
const CUTOFF = new Date('2025-01-01T00:00:00Z');
const NOTHING_OLDER_CUTOFF = new Date('2000-01-01T00:00:00Z');

let n = 0;
const uid = (p: string) => `${p}_${(n += 1)}`;

describe.skipIf(!up)(`retention jobs on Postgres 16${up ? '' : ` (${SKIP_REASON})`}`, () => {
  let handle: DbHandle;
  let retention: RetentionRepo;
  let raw: pg.Client;

  beforeAll(async () => {
    await createDatabase(dbName);
    await migrateDatabase(TEST_URL);
    handle = createDb({ DATABASE_URL: TEST_URL });
    retention = retentionRepo(handle.db);
    raw = new pg.Client({ connectionString: TEST_URL });
    await raw.connect();
  });

  afterAll(async () => {
    await raw?.end();
    await handle?.close();
    await dropDatabase(dbName);
  });

  /** A teacher, agent and one ended session of theirs with a student, `at` old. */
  async function seedSession(at: Date) {
    const tid = uid('tch');
    const stid = uid('stu');
    const agentId = uid('agt');
    const sessionId = uid('ses');
    await raw.query(`insert into users (id, name, locale, market, role) values ($1,'T','en','US','teacher')`, [tid]);
    await raw.query(`insert into users (id, name, locale, market, role) values ($1,'S','en','US','student')`, [stid]);
    await raw.query(`insert into agents (id, teacher_id) values ($1,$2)`, [agentId, tid]);
    await raw.query(
      `insert into sessions (id, student_id, teacher_id, agent_id, agent_version, ended_at, created_at, updated_at)
       values ($1,$2,$3,$4,1,$5,$5,$5)`,
      [sessionId, stid, tid, agentId, at],
    );
    await raw.query(
      `insert into messages (id, session_id, role, text) values ($1,$2,'student','q')`,
      [uid('msg'), sessionId],
    );
    return { tid, stid, agentId, sessionId };
  }

  describe('purgeOldSessions', () => {
    it('a dry run reports the count and deletes nothing', async () => {
      const { sessionId } = await seedSession(OLD);
      const result = await retention.purgeOldSessions(CUTOFF, true);
      expect(result.dryRun).toBe(true);
      expect(result.count).toBeGreaterThanOrEqual(1);
      const { rows } = await raw.query('select 1 from sessions where id = $1', [sessionId]);
      expect(rows).toHaveLength(1);
    });

    it('a future-dated cutoff changes nothing', async () => {
      const { sessionId } = await seedSession(OLD);
      const result = await retention.purgeOldSessions(NOTHING_OLDER_CUTOFF, false);
      expect(result.count).toBe(0);
      const { rows } = await raw.query('select 1 from sessions where id = $1', [sessionId]);
      expect(rows).toHaveLength(1);
    });

    it('a live run deletes only past-cutoff ended sessions and their messages', async () => {
      const oldOne = await seedSession(OLD);
      const recentOne = await seedSession(RECENT);
      const result = await retention.purgeOldSessions(CUTOFF, false);
      expect(result.dryRun).toBe(false);
      expect(result.count).toBeGreaterThanOrEqual(1);

      const { rows: oldSession } = await raw.query('select 1 from sessions where id = $1', [oldOne.sessionId]);
      expect(oldSession).toHaveLength(0);
      const { rows: oldMsgs } = await raw.query('select 1 from messages where session_id = $1', [oldOne.sessionId]);
      expect(oldMsgs).toHaveLength(0);

      const { rows: recentSession } = await raw.query('select 1 from sessions where id = $1', [
        recentOne.sessionId,
      ]);
      expect(recentSession).toHaveLength(1);
    });

    it('skips a past-cutoff session that still has a turn_traces or safety_alerts row (restrict FKs)', async () => {
      const withTrace = await seedSession(OLD);
      await raw.query(
        `insert into turn_traces (id, session_id, steps, model, input_tokens, output_tokens, cost_micro_usd, turn_id, agent_version, package_version, intent, move, guards, usage)
         values ($1,$2,'[]','scripted',0,0,0,$3,1,1,'other','answer','{}','{}')`,
        [uid('tt'), withTrace.sessionId, uid('trn')],
      );
      const withAlert = await seedSession(OLD);
      await raw.query(
        `insert into safety_alerts (id, level, kind, student_id, teacher_id, session_id, excerpt_redacted)
         values ($1,'info','other',$2,$3,$4,'x')`,
        [uid('alr'), withAlert.stid, withAlert.tid, withAlert.sessionId],
      );
      await retention.purgeOldSessions(CUTOFF, false);
      const { rows: r1 } = await raw.query('select 1 from sessions where id = $1', [withTrace.sessionId]);
      expect(r1).toHaveLength(1);
      const { rows: r2 } = await raw.query('select 1 from sessions where id = $1', [withAlert.sessionId]);
      expect(r2).toHaveLength(1);
    });

    it('with a limit of 2 and 5 old sessions, one call deletes 2 and repeated calls finish the rest', async () => {
      const seeded = [];
      for (let i = 0; i < 5; i += 1) seeded.push(await seedSession(OLD));

      const dry = await retention.purgeOldSessions(CUTOFF, true, 2);
      // The dry run's own count is unlimited: it reports every eligible row, not just `limit`.
      expect(dry.count).toBeGreaterThanOrEqual(5);

      const first = await retention.purgeOldSessions(CUTOFF, false, 2);
      expect(first).toEqual({ count: 2, dryRun: false });
      const second = await retention.purgeOldSessions(CUTOFF, false, 2);
      expect(second).toEqual({ count: 2, dryRun: false });
      const third = await retention.purgeOldSessions(CUTOFF, false, 2);
      expect(third).toEqual({ count: 1, dryRun: false });
      const fourth = await retention.purgeOldSessions(CUTOFF, false, 2);
      expect(fourth).toEqual({ count: 0, dryRun: false });

      for (const s of seeded) {
        const { rows } = await raw.query('select 1 from sessions where id = $1', [s.sessionId]);
        expect(rows).toHaveLength(0);
      }
    });
  });

  describe('purgeOldTraces', () => {
    async function seedTrace(at: Date) {
      const { sessionId } = await seedSession(RECENT);
      const id = uid('tt');
      await raw.query(
        `insert into turn_traces (id, session_id, steps, model, input_tokens, output_tokens, cost_micro_usd, turn_id, agent_version, package_version, intent, move, guards, usage, created_at, updated_at)
         values ($1,$2,'[]','scripted',0,0,0,$3,1,1,'other','answer','{}','{}',$4,$4)`,
        [id, sessionId, uid('trn'), at],
      );
      return id;
    }

    it('a dry run reports the count and deletes nothing; a live run deletes only past-cutoff traces', async () => {
      const oldId = await seedTrace(OLD);
      const recentId = await seedTrace(RECENT);
      const dry = await retention.purgeOldTraces(CUTOFF, true);
      expect(dry.dryRun).toBe(true);
      expect(dry.count).toBeGreaterThanOrEqual(1);
      let rows = (await raw.query('select 1 from turn_traces where id = $1', [oldId])).rows;
      expect(rows).toHaveLength(1);

      const live = await retention.purgeOldTraces(CUTOFF, false);
      expect(live.count).toBeGreaterThanOrEqual(1);
      rows = (await raw.query('select 1 from turn_traces where id = $1', [oldId])).rows;
      expect(rows).toHaveLength(0);
      rows = (await raw.query('select 1 from turn_traces where id = $1', [recentId])).rows;
      expect(rows).toHaveLength(1);
    });

    it("uses turn_traces_created_at_idx for the cutoff scan, not a sequential scan", async () => {
      // A bulk insert (one round trip) of enough rows that the planner has a real choice between
      // a seq scan and the index, mostly after CUTOFF (so the past-cutoff slice is selective
      // enough for the index to win); ANALYZE so its row-count estimate reflects the seed, not
      // the table's state when it was last planned.
      const { sessionId } = await seedSession(RECENT);
      await raw.query(
        `insert into turn_traces (id, session_id, steps, model, input_tokens, output_tokens,
           cost_micro_usd, turn_id, agent_version, package_version, intent, move, guards, usage,
           created_at, updated_at)
         select 'tt_explain_' || g, $1, '[]', 'scripted', 0, 0, 0, 'trn_explain_' || g, 1, 1,
           'other', 'answer', '{}', '{}',
           case when g < 1000 then $2::timestamptz else $3::timestamptz end,
           case when g < 1000 then $2::timestamptz else $3::timestamptz end
         from generate_series(1, 20000) g`,
        [sessionId, OLD, RECENT],
      );
      await raw.query('ANALYZE turn_traces');
      const { rows } = await raw.query(`explain select id from turn_traces where created_at < $1`, [
        CUTOFF,
      ]);
      const plan = rows.map((r: { 'QUERY PLAN': string }) => r['QUERY PLAN']).join('\n');
      expect(plan).toContain('turn_traces_created_at_idx');
    });
  });

  describe('purgeOldTranscriptChunks', () => {
    async function seedChunk(kind: 'transcript' | 'material', at: Date) {
      const tid = uid('tch');
      const docId = uid('doc');
      const courseId = uid('crs');
      const moduleId = uid('mod');
      const chunkId = uid('chk');
      await raw.query(`insert into users (id, name, locale, market, role) values ($1,'T','en','US','teacher')`, [tid]);
      await raw.query(`insert into courses (id, teacher_id, title, "order") values ($1,$2,'C',0)`, [courseId, tid]);
      await raw.query(`insert into modules (id, teacher_id, course_id, title, "order") values ($1,$2,$3,'M',0)`, [
        moduleId,
        tid,
        courseId,
      ]);
      await raw.query(
        `insert into documents (id, teacher_id, module_id, kind, source_title) values ($1,$2,$3,$4,'D')`,
        [docId, tid, moduleId, kind],
      );
      await raw.query(
        `insert into chunks (id, teacher_id, document_id, module_id, kind, text, source_title, locator, created_at, updated_at)
         values ($1,$2,$3,$4,$5,'text','D','loc',$6,$6)`,
        [chunkId, tid, docId, moduleId, kind, at],
      );
      return chunkId;
    }

    it('purges only past-cutoff transcript chunks, never material', async () => {
      const oldTranscript = await seedChunk('transcript', OLD);
      const recentTranscript = await seedChunk('transcript', RECENT);
      const oldMaterial = await seedChunk('material', OLD);

      const dry = await retention.purgeOldTranscriptChunks(CUTOFF, true);
      expect(dry.dryRun).toBe(true);
      expect(dry.count).toBeGreaterThanOrEqual(1);

      const live = await retention.purgeOldTranscriptChunks(CUTOFF, false);
      expect(live.count).toBeGreaterThanOrEqual(1);

      const gone = (await raw.query('select 1 from chunks where id = $1', [oldTranscript])).rows;
      expect(gone).toHaveLength(0);
      const keptRecent = (await raw.query('select 1 from chunks where id = $1', [recentTranscript])).rows;
      expect(keptRecent).toHaveLength(1);
      const keptMaterial = (await raw.query('select 1 from chunks where id = $1', [oldMaterial])).rows;
      expect(keptMaterial).toHaveLength(1);
    });
  });
});
