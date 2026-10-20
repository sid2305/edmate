// Worker process entrypoint: opens Redis and the database, then runs the no-op worker, the turn
// queues' workers (meter, commit; task 3.8), the scheduled cost alarm (2.5, scheduled in 3.8) and
// the safety-alert worker (4.3: trust team, then on-call every 15 minutes until acknowledged) and
// the safety-event worker (4.4: moderationIn and jailbreak blocks become safety_events rows).
// REDIS_URL and DATABASE_URL come from the environment (docker/compose.yaml sets both).
import { openDatabase } from '@edmate/db';
import { ALERT_QUEUE, DEAD_LETTER_QUEUE } from '@edmate/queue';
import { Queue } from 'bullmq';
import { Redis } from 'ioredis';
import { createCostAlarmWorker, logCostAlarmSink, scheduleCostAlarm } from './alarms/index.js';
import {
  createAlertWorker,
  createSafetyEventWorker,
  logAlertNotifier,
  redisAckStore,
} from './alerts/index.js';
import { COST_ALARM_QUEUE } from './alarms/schedule.js';
import { createTurnWorkers, pruneDeadLetters } from './commit/index.js';
import { describeError, jsonLog } from './log.js';
import { createNoopWorker } from './worker.js';

const log = jsonLog();
const connection = new Redis(process.env.REDIS_URL ?? 'redis://localhost:6379', {
  maxRetriesPerRequest: null,
});
const db = openDatabase();
const deadLetter = new Queue(DEAD_LETTER_QUEUE, { connection });
const costAlarmQueue = new Queue(COST_ALARM_QUEUE, { connection });
const alertQueue = new Queue(ALERT_QUEUE, { connection });

const noop = createNoopWorker(connection, { autorun: true });
const turn = createTurnWorkers({ connection, repos: db.repos, deadLetter, log, autorun: true });
const costAlarm = createCostAlarmWorker({
  connection,
  deadLetter,
  autorun: true,
  deps: {
    teacherIds: (scope) => db.repos.usageLedger.teacherIdsWithUsageSince(scope),
    ports: {
      usage: db.repos.usageLedger,
      subscriptions: db.repos.subscriptions,
      sink: logCostAlarmSink(),
      now: () => new Date(),
    },
    log,
  },
});
const alert = createAlertWorker({
  connection,
  notifier: logAlertNotifier(),
  ackStore: redisAckStore(connection),
  queue: alertQueue,
  deadLetter,
  log,
  autorun: true,
});
const safetyEvent = createSafetyEventWorker({
  connection,
  repos: db.repos,
  deadLetter,
  log,
  autorun: true,
});
const workers = [noop, turn.meter, turn.commit, costAlarm, alert, safetyEvent];

noop.on('error', (error) => {
  log({ level: 'error', event: 'worker.error', queue: noop.name, error: describeError(error) });
});

scheduleCostAlarm(costAlarmQueue).catch((error: unknown) => {
  log({ level: 'error', event: 'cost_alarm.schedule_failed', error: describeError(error) });
  process.exitCode = 1;
});

// Dead-letter entries expire after 7 days (FAILED_JOB_TTL_SECONDS): prune at start, then hourly.
const PRUNE_EVERY_MS = 60 * 60 * 1_000;
void pruneDeadLetters(deadLetter, log);
const pruneTimer = setInterval(() => {
  void pruneDeadLetters(deadLetter, log);
}, PRUNE_EVERY_MS);

async function shutdown(signal: string): Promise<void> {
  log({ level: 'info', event: 'worker.shutdown', signal });
  clearInterval(pruneTimer);
  await Promise.all(workers.map((w) => w.close()));
  await Promise.all([deadLetter.close(), costAlarmQueue.close(), alertQueue.close()]);
  await db.close();
  await connection.quit();
}

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => {
    shutdown(signal).catch((error: unknown) => {
      log({ level: 'error', event: 'worker.shutdown_failed', error: describeError(error) });
      process.exitCode = 1;
    });
  });
}
