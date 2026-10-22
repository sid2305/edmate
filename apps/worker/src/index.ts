// Worker process entrypoint: opens Redis and the database, then runs the no-op worker, the turn
// queues' workers (meter, commit; task 3.8), the scheduled cost alarm (2.5, scheduled in 3.8) and
// the safety-alert worker (4.3: trust team, then on-call every 15 minutes until acknowledged;
// 12.5b: the DB (`safety_alerts`, via `dbAlertStore`) is the ack source of truth, not Redis -- the
// staff console acknowledges through the repository, not this worker) and
// the safety-event worker (4.4: moderationIn and jailbreak blocks become safety_events rows) and
// the publish-gate worker (8.7: one gate run at a time; models, content and suites from the
// environment, failing closed per run when any is missing).
// REDIS_URL and DATABASE_URL come from the environment (docker/compose.yaml sets both).
import { S3Client } from '@aws-sdk/client-s3';
import { openDatabase } from '@edmate/db';
import { ALERT_QUEUE, DEAD_LETTER_QUEUE } from '@edmate/queue';
import { Queue } from 'bullmq';
import { Redis } from 'ioredis';
import { createCostAlarmWorker, logCostAlarmSink, scheduleCostAlarm } from './alarms/index.js';
import {
  createAlertWorker,
  createSafetyEventWorker,
  dbAlertStore,
  logAlertNotifier,
} from './alerts/index.js';
import { COST_ALARM_QUEUE } from './alarms/schedule.js';
import { createTurnWorkers, pruneDeadLetters } from './commit/index.js';
import { createGateWorker, livePrepareGate } from './gate/workers.js';
import { createIngestGateway, createIngestWorker } from './ingest/index.js';
import { createWorkerWebFetcher, WebLinkConfigError } from './webLink/index.js';
import type { WebFetcher } from '@edmate/ingest';
import { describeError, jsonLog } from './log.js';
import { storageConfigFromEnv } from './storage/roundtrip.js';
import { createStorageClient } from './storage/client.js';
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
  store: dbAlertStore(db.repos.safetyAlerts),
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

// The publish-gate worker (task 8.7 Phase C): always started; a run whose models, content or suites
// are missing ends `error` with a reason (never a skipped gate, never a publish).
const gate = createGateWorker({
  connection,
  deadLetter,
  log,
  autorun: true,
  deps: {
    repos: db.repos,
    log,
    prepare: livePrepareGate({ env: process.env, repos: db.repos, log }),
  },
});

// The ingest worker (task 8.2 Phase 2) needs the OpenAI key; without one it is skipped, same as a
// dev box with no provider keys configured for the turn-side adapters.
let ingest: ReturnType<typeof createIngestWorker> | undefined;
try {
  // Task 9.0 D3: explicit, never a silent fallback -- logged once, distinct from the
  // ingest.worker_disabled path below (which fires on a real config/key failure).
  if (process.env.EDMATE_INGEST_EMBEDDINGS === 'off') {
    log({ level: 'info', event: 'ingest.embeddings_off' });
  }
  const gateway = await createIngestGateway(process.env);
  const storageConfig = storageConfigFromEnv(process.env);
  const s3Client = new S3Client({
    endpoint: storageConfig.endpoint,
    region: storageConfig.region,
    credentials: {
      accessKeyId: storageConfig.accessKeyId,
      secretAccessKey: storageConfig.secretAccessKey,
    },
    forcePathStyle: storageConfig.forcePathStyle,
  });
  const storage = createStorageClient(s3Client, storageConfig.bucket);
  // Task 8.2e: web links (ADR-0014). A malformed EDMATE_WEB_LINK_HOSTS turns off web links only
  // (they then fail as unsupported); the code is logged, never the value.
  let webFetcher: WebFetcher | undefined;
  try {
    webFetcher = createWorkerWebFetcher(process.env);
  } catch (error) {
    const code = error instanceof WebLinkConfigError ? error.code : 'web_link_setup_failed';
    log({ level: 'error', event: 'ingest.web_links_disabled', code });
  }
  ingest = createIngestWorker({
    connection,
    deps: { repos: db.repos, storage, gateway, ...(webFetcher ? { webFetcher } : {}) },
    deadLetter,
    log,
    autorun: true,
  });
} catch (error) {
  log({ level: 'error', event: 'ingest.worker_disabled', error: describeError(error) });
}

const workers = [
  noop,
  turn.meter,
  turn.commit,
  costAlarm,
  alert,
  safetyEvent,
  gate,
  ...(ingest ? [ingest] : []),
];

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
