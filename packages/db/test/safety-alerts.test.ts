// Unit (no database, task 12.5a): safetyAlerts rejects bad input as `invalid` before any SQL. The
// pool points at an unreachable host, so a call that reached the database would fail differently.
import { afterAll, describe, expect, it } from 'vitest';
import { createDb } from '../src/client.js';
import {
  createRepositories,
  RepositoryError,
  SAFETY_ALERT_LIST_MAX_LIMIT,
  SAFETY_ALERT_NOTE_MAX_LENGTH,
} from '../src/index.js';

const handle = createDb({ DATABASE_URL: 'postgres://u:p@127.0.0.1:1/none' });
const repos = createRepositories(handle.db);
afterAll(() => handle.close());

const alert = (o: Record<string, unknown> = {}) => ({
  id: 'alr_unit_1',
  level: 'critical',
  kind: 'distress',
  studentId: 'stu_unit_1',
  teacherId: 'tch_unit_1',
  sessionId: 'ses_unit_1',
  excerptRedacted: 'synthetic excerpt',
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

describe('safetyAlerts input validation', () => {
  it('exports the caps', () => {
    expect(SAFETY_ALERT_LIST_MAX_LIMIT).toBe(50);
    expect(SAFETY_ALERT_NOTE_MAX_LENGTH).toBe(500);
  });

  it('record and markEscalated: an alert that does not match the contract is invalid', async () => {
    const bad = [
      alert({ level: 'panic' }),
      alert({ kind: 'nope' }),
      alert({ id: 'has space' }),
      alert({ sessionId: '' }),
      alert({ createdAt: 'yesterday' }),
      alert({ excerptRedacted: 'x'.repeat(8_001) }),
      alert({ extra: 1 }),
      null,
      undefined,
      'alr_1',
    ];
    for (const a of bad) {
      expect(await kind(repos.safetyAlerts.record(a as never))).toBe('invalid');
      expect(await kind(repos.safetyAlerts.markEscalated(a as never, 0))).toBe('invalid');
    }
  });

  it('markEscalated: a bad round is invalid', async () => {
    for (const r of [-1, 1.5, Number.NaN, '1', null, 2_000_000_000]) {
      expect(await kind(repos.safetyAlerts.markEscalated(alert() as never, r as never))).toBe(
        'invalid',
      );
    }
  });

  it('isAcknowledged: a bad id is invalid', async () => {
    for (const id of ['', 'a b', 'x'.repeat(129), null, 7]) {
      expect(await kind(repos.safetyAlerts.isAcknowledged(id as never))).toBe('invalid');
    }
  });

  it('listForStaff: a bad by or bad options are invalid', async () => {
    expect(await kind(repos.safetyAlerts.listForStaff('a b', { status: 'open', limit: 10 }))).toBe(
      'invalid',
    );
    for (const o of [
      { status: 'closed', limit: 10 },
      { status: 'open', limit: 0 },
      { status: 'open', limit: SAFETY_ALERT_LIST_MAX_LIMIT + 1 },
      { status: 'open' },
      { status: 'open', limit: 10, teacherId: 'tch_1' },
      null,
    ]) {
      expect(await kind(repos.safetyAlerts.listForStaff('stf_1', o as never))).toBe('invalid');
    }
  });

  it('acknowledge: a bad by, a bad alert id, a note over the cap or an extra key is invalid', async () => {
    const bad: [unknown, unknown][] = [
      ['a b', { alertId: 'alr_1' }],
      [null, { alertId: 'alr_1' }],
      ['stf_1', { alertId: 'has space' }],
      ['stf_1', {}],
      ['stf_1', { alertId: 'alr_1', note: 'x'.repeat(SAFETY_ALERT_NOTE_MAX_LENGTH + 1) }],
      ['stf_1', { alertId: 'alr_1', note: '   ' }],
      ['stf_1', { alertId: 'alr_1', note: 5 }],
      ['stf_1', { alertId: 'alr_1', by: 'stf_2' }],
      ['stf_1', null],
    ];
    for (const [by, input] of bad) {
      expect(await kind(repos.safetyAlerts.acknowledge(by as never, input as never))).toBe(
        'invalid',
      );
    }
  });

  it('acknowledge: a note at the cap is accepted (it reaches the database)', async () => {
    const e = await repos.safetyAlerts
      .acknowledge('stf_1', { alertId: 'alr_1', note: 'x'.repeat(SAFETY_ALERT_NOTE_MAX_LENGTH) })
      .catch((x: unknown) => x);
    expect((e as RepositoryError).kind).toBe('failed');
  });
});
