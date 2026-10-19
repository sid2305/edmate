// Task 3.8 acceptance: reply latency is unaffected when the DB is slow (injected delay). The real
// harness `meter` and `commit` steps run on the queue-backed ports; the fake queue hands each job
// to a "worker" whose database write takes 5 s (real time). The turn's `done` event and its
// `finished` promise (where meter and commit report ok or failed) both arrive long before that,
// because the steps only enqueue.
import { demoTurnInput } from '@edmate/contracts/fixtures';
import { defaultSteps, runTurn } from '@edmate/harness';
import { driveTurn, testDeps, testSteps } from '@edmate/harness/testing';
import { afterEach, describe, expect, it } from 'vitest';
import { queuedTurnPorts } from '../src/index.js';
import { type AddedJob, fakeQueue } from './fakeQueue.js';

const DB_DELAY_MS = 5_000;
const BOUND_MS = 500;

const timers: ReturnType<typeof setTimeout>[] = [];
afterEach(() => {
  for (const t of timers.splice(0)) clearTimeout(t);
});

describe('reply latency with a slow database', () => {
  it('done and finished arrive well before the slow writes complete', async () => {
    const written: string[] = [];
    // The worker side: each enqueued job's db write takes DB_DELAY_MS; nothing awaits it.
    const slowWorker = (job: AddedJob) => {
      timers.push(setTimeout(() => written.push(job.name), DB_DELAY_MS));
    };
    const meter = fakeQueue({ onAdd: slowWorker });
    const commit = fakeQueue({ onAdd: slowWorker });
    const ports = queuedTurnPorts(
      { meter, commit },
      { studentId: 'stu_test_01', teacherId: 'tch_test_01' },
      { history: () => Promise.resolve([]) },
    );
    const t = testDeps({ overrides: ports });
    const happy = testSteps();
    const steps = { ...happy, meter: defaultSteps.meter, commit: defaultSteps.commit };

    const started = performance.now();
    const { events, result } = await driveTurn(
      runTurn(demoTurnInput, { deps: t.deps, steps }),
      t.clock,
    );
    const elapsed = performance.now() - started;

    expect(events.at(-1)?.type).toBe('done');
    expect(result.background).toEqual([]);
    expect(result.trace?.steps.filter((s) => s.name === 'meter' || s.name === 'commit')).toEqual([
      { name: 'meter', ms: 0, outcome: 'ok' },
      { name: 'commit', ms: 0, outcome: 'ok' },
    ]);
    expect(elapsed).toBeLessThan(BOUND_MS);
    // Every write was enqueued, none had reached the database yet.
    expect(meter.added.map((j) => j.name)).toEqual(['usage.record']);
    expect(commit.added.map((j) => j.name)).toEqual([
      'message.append',
      'message.append',
      'session.help_state',
      'trace.record',
    ]);
    expect(written).toEqual([]);
  });
});
