// Task 4.3 integration test on the compose Redis: a distressed student's turn raises a SafetyAlert
// through @edmate/queue's alert sink; the alert worker tells the trust team (in under 5 minutes,
// even when delivery fails 6 times with the production backoff), pages on-call every escalation
// interval until the alert is acknowledged, and keeps at most one pending check per alert. No log
// line carries the excerpt.
//
// Locally:
//   docker compose -f docker/compose.yaml -f packages/db/test/compose.port.yaml \
//     -f apps/worker/test/compose.port.yaml up -d postgres redis
// CI provides Redis. Without it the suite skips locally and fails in CI.
import { randomBytes } from 'node:crypto';
import type { SafetyAlert, TurnEvent } from '@edmate/contracts';
import { demoSafetyAlert, demoTurnInput } from '@edmate/contracts/fixtures';
import { defaultSteps, hasDistressKeyword, runTurn } from '@edmate/harness';
import { memoryTranscriptStore, testDeps, testSteps } from '@edmate/harness/testing';
import {
  ALERT_QUEUE,
  DEAD_LETTER_QUEUE,
  JOB,
  jobId,
  queuedAlertSink,
} from '@edmate/queue';
import { type Job, Queue, type Worker } from 'bullmq';
import { Redis } from 'ioredis';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type AckStore, createAlertWorker, redisAckStore } from '../src/alerts/index.js';
import type { AlertAudience, AlertNotifier } from '../src/alerts/types.js';
import type { LogLine } from '../src/log.js';

const REDIS_URL = process.env.TEST_REDIS_URL ?? 'redis://127.0.0.1:56379';

async function reachable(): Promise<boolean> {
  const redis = new Redis(REDIS_URL, {
    lazyConnect: true,
    maxRetriesPerRequest: 0,
    retryStrategy: () => null,
  });
  try {
    await redis.connect();
    return (await redis.ping()) === 'PONG';
  } catch {
    return false;
  } finally {
    redis.disconnect();
  }
}

const up = await reachable();
if (!up && process.env.CI === 'true') {
  throw new Error('CI=true but Redis (TEST_REDIS_URL) is unreachable');
}
const SKIP = 'SKIPPED: no Redis; see the header for the compose command';
if (!up) process.stderr.write(`[@edmate/worker] alert integration ${SKIP}\n`);

const CANARY = 'EXCERPT-CANARY-7f3a';
const tag = randomBytes(4).toString('hex');
const prodPrefix = `edmate-test-alert-prod-${tag}`;
const fastPrefix = `edmate-test-alert-fast-${tag}`;
const FAST_ESCALATE_MS = 300;

interface Delivery {
  alertId: string;
  audience: AlertAudience;
  at: number;
}

/** Records successful deliveries; fails the first `failFirst[alertId]` attempts for an alert. */
function recordingNotifier(failFirst: Record<string, number> = {}) {
  const delivered: Delivery[] = [];
  const attempts: Record<string, number> = {};
  const notifier: AlertNotifier = {
    notify(a, audience) {
      const key = `${a.id}/${audience}`;
      attempts[key] = (attempts[key] ?? 0) + 1;
      if (audience === 'trust_team' && (attempts[key] ?? 0) <= (failFirst[a.id] ?? 0)) {
        return Promise.reject(new Error(`notifier down (attempt ${attempts[key]})`));
      }
      delivered.push({ alertId: a.id, audience, at: Date.now() });
      return Promise.resolve();
    },
  };
  return { notifier, delivered, attempts };
}

async function until<T>(read: () => T | Promise<T>, ok: (v: T) => boolean, ms: number): Promise<T> {
  const end = Date.now() + ms;
  for (;;) {
    const v = await read();
    if (ok(v)) return v;
    if (Date.now() > end) throw new Error(`timed out waiting; last value ${JSON.stringify(v)}`);
    await new Promise((r) => setTimeout(r, 25));
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const alertNamed = (id: string): SafetyAlert => ({
  ...demoSafetyAlert,
  id,
  excerptRedacted: `${CANARY} i want to kill myself`,
});

/** This alert's escalation-check jobs that are still to run (delayed or waiting). */
async function pendingChecks(queue: Queue, alertId: string): Promise<Job[]> {
  const jobs = await queue.getJobs(['delayed', 'waiting', 'prioritized']);
  return jobs.filter(
    (j) => j.name === JOB.alertEscalateCheck && (j.id ?? '').startsWith(`${alertId}.escalate.`),
  );
}

const lines: LogLine[] = [];
let connection: Redis;
let prodQueue: Queue;
let fastQueue: Queue;
let deadLetter: Queue;
let ackStore: AckStore;
const workers: Worker[] = [];
const prod = recordingNotifier({ alert_e2e: 6 });
const fast = recordingNotifier();

describe.skipIf(!up)(`safety alerts on Redis${up ? '' : ` (${SKIP})`}`, () => {
  beforeAll(async () => {
    connection = new Redis(REDIS_URL, { maxRetriesPerRequest: null });
    prodQueue = new Queue(ALERT_QUEUE, { connection, prefix: prodPrefix });
    fastQueue = new Queue(ALERT_QUEUE, { connection, prefix: fastPrefix });
    deadLetter = new Queue(DEAD_LETTER_QUEUE, { connection, prefix: prodPrefix });
    ackStore = redisAckStore(connection, { keyPrefix: `${fastPrefix}:` });
    const log = (l: LogLine) => lines.push(l);
    // Production settings: 1 s backoff doubling to 30 s, 15-minute escalation.
    workers.push(
      createAlertWorker({
        connection,
        notifier: prod.notifier,
        ackStore,
        queue: prodQueue,
        deadLetter,
        log,
        prefix: prodPrefix,
        autorun: true,
      }),
    );
    // A short escalation interval to watch the 15-minute loop run.
    workers.push(
      createAlertWorker({
        connection,
        notifier: fast.notifier,
        ackStore,
        queue: fastQueue,
        deadLetter,
        log,
        prefix: fastPrefix,
        escalateAfterMs: FAST_ESCALATE_MS,
        backoff: { startMs: 50, maxMs: 200 },
        autorun: true,
      }),
    );
  }, 30_000);

  afterAll(async () => {
    await Promise.all(workers.map((w) => w.close()));
    for (const q of [prodQueue, fastQueue, deadLetter]) {
      await q?.obliterate({ force: true }).catch(() => undefined);
      await q?.close();
    }
    for (const prefix of [prodPrefix, fastPrefix]) {
      const keys = await connection.keys(`${prefix}:*`);
      if (keys.length > 0) await connection.del(...keys);
    }
    await connection?.quit();
  }, 30_000);

  it('a distress turn → the trust team is told in < 5 min although delivery fails 6 times; the turn is saved', async () => {
    const realClock = {
      now: () => Date.now(),
      sleep: (ms: number) => new Promise<void>((r) => setTimeout(r, ms)),
    };
    const t = testDeps({
      overrides: {
        clock: realClock,
        ids: { next: (kind) => (kind === 'alert' ? 'alert_e2e' : `${kind}_e2e`) },
        alerts: queuedAlertSink(prodQueue),
        transcripts: memoryTranscriptStore(),
        distressCheck: hasDistressKeyword,
      },
    });
    const steps = testSteps({ preGuard: defaultSteps.preGuard, escalate: defaultSteps.escalate });
    const started = Date.now();
    const run = runTurn(
      { ...demoTurnInput, text: `i want to kill myself ${CANARY}` },
      { deps: t.deps, steps },
    );
    const events: TurnEvent[] = [];
    const [, result] = await Promise.all([
      (async () => {
        for await (const e of run.events) events.push(e);
      })(),
      run.finished,
    ]);
    expect(events[0]).toEqual({ type: 'safety', level: 'alert' });
    expect(result.background).toEqual([]);
    expect(steps.commits[0]).toMatchObject({ outcome: 'escalated', intent: 'distress' });

    const [first] = await until(
      () => prod.delivered.filter((d) => d.alertId === 'alert_e2e'),
      (d) => d.length === 1,
      5 * 60_000,
    );
    const elapsed = (first?.at ?? Infinity) - started;
    process.stderr.write(
      `[@edmate/worker] alert delivered to the trust team after ${elapsed} ms ` +
        `(${prod.attempts['alert_e2e/trust_team']} attempts)\n`,
    );
    expect(first?.audience).toBe('trust_team');
    expect(prod.attempts['alert_e2e/trust_team']).toBe(7);
    expect(elapsed).toBeLessThan(5 * 60_000);

    // The 15-minute check is waiting, exactly once.
    const checks = await pendingChecks(prodQueue, 'alert_e2e');
    expect(checks.map((j) => j.id)).toEqual([jobId.alertEscalate('alert_e2e', 0)]);
  }, 330_000);

  it('a replayed raise adds nothing: still one pending check, no second trust-team message', async () => {
    const sink = queuedAlertSink(prodQueue);
    await sink.raise(alertNamed('alert_e2e'));
    await sleep(500);
    expect((await pendingChecks(prodQueue, 'alert_e2e')).length).toBe(1);
    expect(prod.delivered.filter((d) => d.alertId === 'alert_e2e')).toHaveLength(1);
  }, 10_000);

  it('not acknowledged → on-call is paged every interval; acknowledging stops it', async () => {
    const id = 'alert_unacked';
    await queuedAlertSink(fastQueue, { escalateAfterMs: FAST_ESCALATE_MS }).raise(alertNamed(id));
    const pages = () => fast.delivered.filter((d) => d.alertId === id && d.audience === 'on_call');
    await until(pages, (p) => p.length >= 2, 10_000);
    expect(fast.delivered.find((d) => d.alertId === id)?.audience).toBe('trust_team');
    // At most one pending check at any time.
    expect((await pendingChecks(fastQueue, id)).length).toBeLessThanOrEqual(1);

    await ackStore.acknowledge(id);
    // The next check sees the ack and schedules nothing more.
    await until(() => pendingChecks(fastQueue, id), (j) => j.length === 0, 5_000);
    const after = pages().length;
    await sleep(FAST_ESCALATE_MS * 3);
    expect(pages().length).toBe(after);
  }, 20_000);

  it('acknowledged before the first check → on-call is never paged', async () => {
    const id = 'alert_acked';
    await ackStore.acknowledge(id);
    await queuedAlertSink(fastQueue, { escalateAfterMs: FAST_ESCALATE_MS }).raise(alertNamed(id));
    await until(
      () => fast.delivered.filter((d) => d.alertId === id),
      (d) => d.length === 1,
      5_000,
    );
    await until(() => pendingChecks(fastQueue, id), (j) => j.length === 0, 5_000);
    await sleep(FAST_ESCALATE_MS * 2);
    expect(fast.delivered.filter((d) => d.alertId === id).map((d) => d.audience)).toEqual([
      'trust_team',
    ]);
  }, 15_000);

  it('no log line carries the excerpt', () => {
    expect(lines.length).toBeGreaterThan(0);
    expect(JSON.stringify(lines)).not.toContain(CANARY);
  }, 1_000);
});
