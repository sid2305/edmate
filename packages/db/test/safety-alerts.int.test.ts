// Task 12.5a on Postgres: the safety alert inbox table. The worker records an alert and marks its
// escalations through the alert's own session; only a current staff user lists or acknowledges
// alerts; an ack is audited once, even under two concurrent acks. Excerpts here are synthetic.
// See test/pg.ts.
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { migrateDatabase } from '../src/migrate.js';
import { createDb, type DbHandle } from '../src/internal.js';
import {
  createRepositories,
  type Repositories,
  RepositoryError,
  SAFETY_ALERT_LIST_MAX_LIMIT,
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

const up = await postgresUp('safety alert tests');
const dbName = throwawayName();
const TEST_URL = urlFor(dbName);
let handle: DbHandle;
let second: DbHandle;
let repos: Repositories;
let repos2: Repositories;
let raw: pg.Client;

const STAFF = 'stf_sa_1';
const STAFF_2 = 'stf_sa_2';
const FORMER_STAFF = 'stf_sa_3';
let n = 0;

const alert = (o: Record<string, unknown> = {}) => ({
  id: `alr_sa_${++n}`,
  level: 'critical' as const,
  kind: 'distress' as const,
  studentId: studentId('1'),
  teacherId: teacherId('A'),
  sessionId: ids.session('1A'),
  excerptRedacted: 'synthetic distress excerpt',
  createdAt: '2026-10-22T10:00:00.000Z',
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

const row = async (id: string) =>
  (
    await raw.query<Record<string, unknown>>(
      `select escalation_round, escalated_at, last_paged_at, acknowledged_at, acknowledged_by,
              ack_note, created_at, received_at
         from safety_alerts where id = $1`,
      [id],
    )
  ).rows[0];
const count = async (sql: string, args: unknown[] = []) =>
  (await raw.query<{ n: number }>(sql, args)).rows[0]!.n;
const audits = (id: string) =>
  count(`select count(*)::int as n from audit_log where target = $1`, [`safety_alert:${id}`]);

describe.skipIf(!up)(`safetyAlerts on Postgres${up ? '' : ` (${SKIP_REASON})`}`, () => {
  beforeAll(async () => {
    await createDatabase(dbName);
    await migrateDatabase(TEST_URL);
    handle = createDb({ DATABASE_URL: TEST_URL });
    second = createDb({ DATABASE_URL: TEST_URL });
    await seed(handle.db);
    repos = createRepositories(handle.db);
    repos2 = createRepositories(second.db);
    raw = new pg.Client({ connectionString: TEST_URL });
    await raw.connect();
    await raw.query(
      `insert into users (id, name, locale, market, role) values
       ($1, 'Staff One', 'en', 'test', 'staff'), ($2, 'Staff Two', 'en', 'test', 'staff'),
       ($3, 'Staff Three', 'en', 'test', 'teacher')`,
      [STAFF, STAFF_2, FORMER_STAFF],
    );
    await raw.query(
      `insert into teacher_profiles (id, user_id, slug, subject) values ('tp_sa_a', $1, 'teacher-a', 'Math')`,
      [teacherId('A')],
    );
  }, 60_000);

  afterAll(async () => {
    await raw?.end();
    await handle?.close();
    await second?.close();
    await dropDatabase(dbName);
  }, 60_000);

  describe('record', () => {
    it('stores the alert once; a replay writes nothing new', async () => {
      const a = alert();
      expect(await repos.safetyAlerts.record(a)).toEqual({ written: true });
      expect(await repos.safetyAlerts.record(a)).toEqual({ written: false });
      expect(await count('select count(*)::int as n from safety_alerts where id = $1', [a.id])).toBe(1);
      const r = await row(a.id);
      expect((r!.created_at as Date).toISOString()).toBe(a.createdAt);
      expect(r!.received_at).toBeInstanceOf(Date);
      expect(r!.escalation_round).toBe(0);
      expect(r!.acknowledged_at).toBeNull();
    });

    it("a session that is not the alert's own is not_found and writes nothing", async () => {
      const before = await count('select count(*)::int as n from safety_alerts');
      for (const a of [
        alert({ sessionId: ids.session('1B') }),
        alert({ sessionId: ids.session('2A') }),
        alert({ studentId: studentId('2') }),
        alert({ teacherId: teacherId('B') }),
        alert({ sessionId: 'ses_missing' }),
      ]) {
        expect(await kind(repos.safetyAlerts.record(a))).toBe('not_found');
      }
      expect(await count('select count(*)::int as n from safety_alerts')).toBe(before);
    });

    it("an id already taken by another scope's alert is not_found", async () => {
      const a = alert();
      await repos.safetyAlerts.record(a);
      const other = { ...a, studentId: studentId('2'), sessionId: ids.session('2A') };
      expect(await kind(repos.safetyAlerts.record(other))).toBe('not_found');
      expect(await kind(repos.safetyAlerts.markEscalated(other, 0))).toBe('not_found');
      expect((await row(a.id))!.escalation_round).toBe(0);
    });
  });

  describe('markEscalated', () => {
    it('creates the row when record never ran, and raises the round monotonically', async () => {
      const a = alert();
      expect(await repos.safetyAlerts.markEscalated(a, 0)).toEqual({ round: 1 });
      const first = await row(a.id);
      expect(first!.escalation_round).toBe(1);
      expect(first!.escalated_at).toBeInstanceOf(Date);
      expect(first!.last_paged_at).toBeInstanceOf(Date);
      expect(await repos.safetyAlerts.markEscalated(a, 2)).toEqual({ round: 3 });
      // A late, lower round never lowers it.
      expect(await repos.safetyAlerts.markEscalated(a, 0)).toEqual({ round: 3 });
      const later = await row(a.id);
      expect(later!.escalation_round).toBe(3);
      // escalated_at keeps the first escalation's time; last_paged_at moves.
      expect(later!.escalated_at).toEqual(first!.escalated_at);
      expect((later!.last_paged_at as Date).getTime()).toBeGreaterThanOrEqual(
        (first!.last_paged_at as Date).getTime(),
      );
      // record after markEscalated is a replay.
      expect(await repos.safetyAlerts.record(a)).toEqual({ written: false });
    });

    it("leaves an acknowledged row's ack fields alone", async () => {
      const a = alert();
      await repos.safetyAlerts.record(a);
      await repos.safetyAlerts.acknowledge(STAFF, { alertId: a.id, note: 'called the school' });
      const acked = await row(a.id);
      await repos.safetyAlerts.markEscalated(a, 0);
      const after = await row(a.id);
      expect(after!.acknowledged_at).toEqual(acked!.acknowledged_at);
      expect(after!.acknowledged_by).toBe(STAFF);
      expect(after!.ack_note).toBe('called the school');
    });

    it("a session that is not the alert's own is not_found and writes nothing", async () => {
      const a = alert({ sessionId: ids.session('2B') });
      expect(await kind(repos.safetyAlerts.markEscalated(a, 0))).toBe('not_found');
      expect(await count('select count(*)::int as n from safety_alerts where id = $1', [a.id])).toBe(0);
    });
  });

  describe('isAcknowledged', () => {
    it('is false for a missing row, false while open, true once acknowledged', async () => {
      const a = alert();
      expect(await repos.safetyAlerts.isAcknowledged(a.id)).toBe(false);
      await repos.safetyAlerts.record(a);
      expect(await repos.safetyAlerts.isAcknowledged(a.id)).toBe(false);
      await repos.safetyAlerts.acknowledge(STAFF, { alertId: a.id });
      expect(await repos.safetyAlerts.isAcknowledged(a.id)).toBe(true);
    });
  });

  describe('acknowledge', () => {
    it('non-staff are scope and nothing is written', async () => {
      const a = alert();
      await repos.safetyAlerts.record(a);
      for (const by of [teacherId('A'), studentId('1'), FORMER_STAFF, 'stf_ghost']) {
        expect(await kind(repos.safetyAlerts.acknowledge(by, { alertId: a.id }))).toBe('scope');
      }
      expect((await row(a.id))!.acknowledged_at).toBeNull();
      expect(await audits(a.id)).toBe(0);
    });

    it('an unknown alert id is not_found', async () => {
      expect(await kind(repos.safetyAlerts.acknowledge(STAFF, { alertId: 'alr_missing' }))).toBe(
        'not_found',
      );
      expect(await audits('alr_missing')).toBe(0);
    });

    it('a first ack writes one audit row; a second ack is a no-op', async () => {
      const a = alert();
      await repos.safetyAlerts.record(a);
      expect(
        await repos.safetyAlerts.acknowledge(STAFF, { alertId: a.id, note: '  spoke to parent  ' }),
      ).toEqual({ acknowledged: true });
      const r = await row(a.id);
      expect(r!.acknowledged_by).toBe(STAFF);
      expect(r!.ack_note).toBe('spoke to parent');
      const { rows } = await raw.query(
        `select actor, actor_role, action, teacher_id, student_id, reason, before, after
           from audit_log where target = $1`,
        [`safety_alert:${a.id}`],
      );
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        actor: STAFF,
        actor_role: 'staff',
        action: 'safety_alert.ack',
        teacher_id: teacherId('A'),
        student_id: studentId('1'),
        reason: 'spoke to parent',
        before: { acknowledgedAt: null },
      });
      expect(rows[0].after).toMatchObject({ acknowledgedBy: STAFF });
      expect(JSON.stringify(rows[0])).not.toContain('synthetic distress excerpt');

      expect(await repos.safetyAlerts.acknowledge(STAFF_2, { alertId: a.id })).toEqual({
        acknowledged: false,
      });
      expect((await row(a.id))!.acknowledged_by).toBe(STAFF);
      expect(await audits(a.id)).toBe(1);
    });

    it('two concurrent acks on two connections give exactly one audit row', async () => {
      for (let i = 0; i < 5; i += 1) {
        const a = alert();
        await repos.safetyAlerts.record(a);
        const results = await Promise.all([
          repos.safetyAlerts.acknowledge(STAFF, { alertId: a.id, note: 'first' }),
          repos2.safetyAlerts.acknowledge(STAFF_2, { alertId: a.id, note: 'second' }),
        ]);
        expect(results.filter((r) => r.acknowledged)).toHaveLength(1);
        expect(await audits(a.id)).toBe(1);
      }
    }, 20_000);
  });

  describe('listForStaff', () => {
    it('non-staff are scope', async () => {
      for (const by of [teacherId('A'), studentId('1'), FORMER_STAFF, 'stf_ghost']) {
        expect(await kind(repos.safetyAlerts.listForStaff(by, { status: 'all', limit: 10 }))).toBe(
          'scope',
        );
      }
    });

    it('open first, escalated before unescalated, oldest first; status filters; no personal columns', async () => {
      await raw.query('delete from audit_log where target like $1', ['safety_alert:%']);
      await raw.query('delete from safety_alerts');
      const old = alert({ createdAt: '2026-10-22T09:00:00.000Z' });
      const mid = alert({ createdAt: '2026-10-22T09:30:00.000Z', teacherId: teacherId('B'), sessionId: ids.session('1B') });
      const esc = alert({ createdAt: '2026-10-22T09:45:00.000Z', kind: 'abuse', level: 'alert' });
      const done = alert({ createdAt: '2026-10-22T08:00:00.000Z' });
      for (const a of [old, mid, esc, done]) await repos.safetyAlerts.record(a);
      await repos.safetyAlerts.markEscalated(esc, 0);
      await repos.safetyAlerts.acknowledge(STAFF, { alertId: done.id, note: 'resolved' });

      const open = await repos.safetyAlerts.listForStaff(STAFF, { status: 'open', limit: 50 });
      expect(open.map((r) => r.id)).toEqual([esc.id, old.id, mid.id]);
      const all = await repos.safetyAlerts.listForStaff(STAFF, { status: 'all', limit: 50 });
      expect(all.map((r) => r.id)).toEqual([esc.id, old.id, mid.id, done.id]);

      const first = open[0]!;
      expect(Object.keys(first).sort()).toEqual(
        [
          'id',
          'level',
          'kind',
          'studentId',
          'teacherId',
          'sessionId',
          'teacherSlug',
          'excerptRedacted',
          'createdAt',
          'receivedAt',
          'escalatedAt',
          'escalationRound',
          'lastPagedAt',
          'acknowledgedAt',
          'acknowledgedBy',
          'ackNote',
        ].sort(),
      );
      expect(first).toMatchObject({
        kind: 'abuse',
        level: 'alert',
        teacherSlug: 'teacher-a',
        escalationRound: 1,
        createdAt: esc.createdAt,
        acknowledgedAt: null,
      });
      expect(typeof first.escalatedAt).toBe('string');
      expect(open.find((r) => r.id === mid.id)?.teacherSlug).toBeNull();
      const acked = all.find((r) => r.id === done.id)!;
      expect(acked).toMatchObject({ acknowledgedBy: STAFF, ackNote: 'resolved' });
      const text = JSON.stringify(all);
      for (const personal of ['[A] teacher', '[B] teacher', '[1] student', 'Staff One', '@']) {
        expect(text).not.toContain(personal);
      }
    });

    it('caps the page at the limit', async () => {
      for (let i = 0; i < SAFETY_ALERT_LIST_MAX_LIMIT + 2; i += 1) {
        await repos.safetyAlerts.record(alert());
      }
      expect(
        await repos.safetyAlerts.listForStaff(STAFF, { status: 'open', limit: SAFETY_ALERT_LIST_MAX_LIMIT }),
      ).toHaveLength(SAFETY_ALERT_LIST_MAX_LIMIT);
      expect(await repos.safetyAlerts.listForStaff(STAFF, { status: 'all', limit: 2 })).toHaveLength(2);
    }, 20_000);
  });
});
