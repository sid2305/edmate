// dbAlertStore (task 12.5b), on a fake safetyAlertsRepo (no Postgres): a thin adapter over
// safetyAlertsRepo, and the worker's own refusal to acknowledge (that is the staff console's job).
import type { SafetyAlert } from '@edmate/contracts';
import { demoSafetyAlert } from '@edmate/contracts/fixtures';
import { describe, expect, it } from 'vitest';
import { dbAlertStore, type SafetyAlertsRepo } from './dbStore.js';

const alert: SafetyAlert = { ...demoSafetyAlert, id: 'alert_1' };

function fakeRepo(o: {
  record?: (a: SafetyAlert) => Promise<unknown>;
  markEscalated?: (a: SafetyAlert, round: number) => Promise<unknown>;
  isAcknowledged?: (id: string) => Promise<boolean>;
} = {}): SafetyAlertsRepo {
  return {
    record: o.record ?? (() => Promise.resolve({ written: true })),
    markEscalated: o.markEscalated ?? ((_a, round) => Promise.resolve({ round })),
    isAcknowledged: o.isAcknowledged ?? (() => Promise.resolve(false)),
  };
}

describe('dbAlertStore', () => {
  it('record delegates to the repository', async () => {
    const calls: SafetyAlert[] = [];
    const store = dbAlertStore(
      fakeRepo({
        record: (a) => {
          calls.push(a);
          return Promise.resolve({ written: true });
        },
      }),
    );
    await store.record(alert);
    expect(calls).toEqual([alert]);
  });

  it('record propagates a repository failure (the processor decides what to do)', async () => {
    const store = dbAlertStore(fakeRepo({ record: () => Promise.reject(new Error('db down')) }));
    await expect(store.record(alert)).rejects.toThrow('db down');
  });

  it('markEscalated delegates alert and round', async () => {
    const calls: { alert: SafetyAlert; round: number }[] = [];
    const store = dbAlertStore(
      fakeRepo({
        markEscalated: (a, round) => {
          calls.push({ alert: a, round });
          return Promise.resolve({ round });
        },
      }),
    );
    await store.markEscalated(alert, 2);
    expect(calls).toEqual([{ alert, round: 2 }]);
  });

  it('markEscalated propagates a repository failure', async () => {
    const store = dbAlertStore(
      fakeRepo({ markEscalated: () => Promise.reject(new Error('db down')) }),
    );
    await expect(store.markEscalated(alert, 0)).rejects.toThrow('db down');
  });

  it('isAcknowledged delegates to the repository', async () => {
    const store = dbAlertStore(fakeRepo({ isAcknowledged: () => Promise.resolve(true) }));
    expect(await store.isAcknowledged('alert_1')).toBe(true);
  });

  it('isAcknowledged propagates a repository failure', async () => {
    const store = dbAlertStore(fakeRepo({ isAcknowledged: () => Promise.reject(new Error('db down')) }));
    await expect(store.isAcknowledged('alert_1')).rejects.toThrow('db down');
  });

  it('acknowledge always rejects: the worker never acknowledges, only the staff console does', async () => {
    const store = dbAlertStore(fakeRepo());
    await expect(store.acknowledge('alert_1')).rejects.toThrow('use the staff console');
  });
});
