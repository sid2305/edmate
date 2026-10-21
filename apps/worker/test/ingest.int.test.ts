// Task 8.2 Phase 2 (deferred to 8.2c): the ingest worker on real Postgres and Redis. A fake
// in-memory storage stands in for S3 and a scripted embedder stands in for the model gateway (rule
// 4: no real model, S3 or network calls). Covers: enqueue -> process -> ready with chunks that a
// scoped search finds; an unsupported/corrupt file -> failed with a fixed reason; a replace racing
// a still-running job for the old file; a job for a document already deleted.
//
// Locally:
//   docker compose -f docker/compose.yaml -f packages/db/test/compose.port.yaml \
//     -f apps/worker/test/compose.port.yaml up -d postgres redis
// CI provides both services. Without them the suite skips locally and fails in CI.
import { randomBytes } from 'node:crypto';
import { migrateDatabase, openDatabase, type Repositories } from '@edmate/db';
import { createIngestQueue, enqueueIngest, type IngestJob } from '@edmate/queue';
import { Queue } from 'bullmq';
import { Redis } from 'ioredis';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createIngestWorker } from '../src/ingest/workers.js';
import type { IngestGateway } from '../src/ingest/gateway.js';
import { ingestProcessor } from '../src/ingest/processor.js';
import type { StorageClient } from '../src/storage/client.js';
import type { LogLine } from '../src/log.js';

const PG_URL =
  process.env.TEST_DATABASE_URL ?? 'postgres://edmate:edmate-dev@127.0.0.1:55432/edmate';
const REDIS_URL = process.env.TEST_REDIS_URL ?? 'redis://127.0.0.1:56379';

async function reachable(): Promise<boolean> {
  const client = new pg.Client({ connectionString: PG_URL, connectionTimeoutMillis: 2_000 });
  const redis = new Redis(REDIS_URL, {
    lazyConnect: true,
    maxRetriesPerRequest: 0,
    retryStrategy: () => null,
  });
  try {
    await client.connect();
    await redis.connect();
    return (await redis.ping()) === 'PONG';
  } catch {
    return false;
  } finally {
    await client.end().catch(() => undefined);
    redis.disconnect();
  }
}

const up = await reachable();
if (!up && process.env.CI === 'true') {
  throw new Error(
    'CI=true but Postgres (TEST_DATABASE_URL) or Redis (TEST_REDIS_URL) is unreachable',
  );
}
const SKIP = 'SKIPPED: no Postgres or Redis; see the header for the compose command';
if (!up) process.stderr.write(`[@edmate/worker] ingest integration ${SKIP}\n`);

const dbName = `edmate_test_${randomBytes(6).toString('hex')}`;
const prefix = `edmate-test-ingest-${randomBytes(4).toString('hex')}`;
const dbUrl = (() => {
  const u = new URL(PG_URL);
  u.pathname = `/${dbName}`;
  return u.toString();
})();

const scope = { teacherId: 'tch_ing_01' };
let admin: pg.Client;
let raw: pg.Client;
let db: ReturnType<typeof openDatabase>;
let connection: Redis;
let deadLetter: Queue;
let n = 0;

/** An in-memory stand-in for the worker's S3 access: no network, no real bucket. */
function fakeStorage(): StorageClient & {
  put(key: string, bytes: Uint8Array): void;
  /** Delays `getObjectBytes(key)` until `release()` is called; resolves what's already stored. */
  gate(key: string): { release: () => void; started: Promise<void> };
} {
  const files = new Map<string, Uint8Array>();
  const gates = new Map<string, { resolve: () => void; promise: Promise<void> }>();
  const startedResolvers = new Map<string, () => void>();
  return {
    put(key, bytes) {
      files.set(key, bytes);
    },
    gate(key) {
      let resolve = () => undefined as void;
      const promise = new Promise<void>((r) => (resolve = r));
      gates.set(key, { resolve, promise });
      let startedResolve = () => undefined as void;
      const started = new Promise<void>((r) => (startedResolve = r));
      startedResolvers.set(key, startedResolve);
      return { release: resolve, started };
    },
    async getObjectBytes(key) {
      startedResolvers.get(key)?.();
      const gate = gates.get(key);
      if (gate) await gate.promise;
      const bytes = files.get(key);
      if (!bytes) throw new Error(`fakeStorage: no object at ${key}`);
      return bytes;
    },
    async getSignedDownloadUrl() {
      throw new Error('fakeStorage: no video/audio fixtures in this suite');
    },
    async deleteObject() {
      // Best effort in the real client; a no-op double is enough here.
    },
  };
}

/** The embedding column's fixed width (pgvector, task 5.1); duplicated as a literal since this
 * package has no dependency on @edmate/db's internal schema exports. */
const EMBEDDING_DIMENSIONS = 1536;

/** A scripted embedder (rule 4): a fixed, deterministic vector per call, no provider traffic. */
function fakeGateway(): IngestGateway {
  return {
    embedder: {
      embed: (texts: string[]) =>
        Promise.resolve(texts.map(() => Array.from({ length: EMBEDDING_DIMENSIONS }, () => 0.1))),
    },
    transcriber: {
      transcribe: () => Promise.reject(new Error('fakeGateway: no transcriber configured')),
    },
  };
}

async function seed(c: pg.Client): Promise<void> {
  await c.query(`insert into users (id, name, locale, market, role) values
    ('tch_ing_01', 'T', 'en', 'test', 'teacher')`);
  await c.query(`insert into courses (id, teacher_id, title, "order")
    values ('crs_ing_01', 'tch_ing_01', 'C', 0)`);
  await c.query(`insert into modules (id, teacher_id, course_id, title, "order")
    values ('mod_ing_01', 'tch_ing_01', 'crs_ing_01', 'M', 0)`);
}

async function createDocument(
  repos: Repositories,
  storageKey: string,
): Promise<{ id: string; storageKey: string }> {
  n += 1;
  const id = `doc_ing_${n}`;
  await repos.documents.create(scope, {
    id,
    moduleId: 'mod_ing_01',
    kind: 'material',
    sourceTitle: `${id} title`,
    storageKey,
  });
  return { id, storageKey };
}

const md = (text: string) => new TextEncoder().encode(text);

async function until<T>(read: () => Promise<T>, ok: (v: T) => boolean, ms = 15_000): Promise<T> {
  const end = Date.now() + ms;
  for (;;) {
    const v = await read();
    if (ok(v)) return v;
    if (Date.now() > end) throw new Error(`timed out waiting; last value ${JSON.stringify(v)}`);
    await new Promise((r) => setTimeout(r, 50));
  }
}

const chunkCount = async (documentId: string): Promise<number> =>
  Number(
    (
      await raw.query<{ n: string }>(`select count(*) as n from chunks where document_id = $1`, [
        documentId,
      ])
    ).rows[0]?.n,
  );

describe.skipIf(!up)(`ingest worker on Redis + Postgres${up ? '' : ` (${SKIP})`}`, () => {
  beforeAll(async () => {
    admin = new pg.Client({ connectionString: PG_URL });
    await admin.connect();
    await admin.query(`create database "${dbName}"`);
    await migrateDatabase(dbUrl);
    raw = new pg.Client({ connectionString: dbUrl });
    await raw.connect();
    await seed(raw);
    db = openDatabase({ DATABASE_URL: dbUrl });
    connection = new Redis(REDIS_URL, { maxRetriesPerRequest: null });
    deadLetter = new Queue('edmate-dead-letter', { connection, prefix });
  });

  afterAll(async () => {
    await deadLetter?.obliterate({ force: true }).catch(() => undefined);
    await deadLetter?.close();
    const keys = await connection?.keys(`${prefix}:*`);
    if (keys && keys.length > 0) await connection.del(...keys);
    await connection?.quit();
    await db?.close();
    await raw?.end();
    await admin?.query(`drop database if exists "${dbName}" with (force)`);
    await admin?.end();
  });

  it('enqueue -> process: a document reaches ready with chunks a scoped search finds', async () => {
    const storage = fakeStorage();
    const { id, storageKey } = await createDocument(db.repos, `ingest/${randomBytes(4).toString('hex')}.md`);
    storage.put(storageKey, md('# Ready canary\n\nINGEST-INT-CANARY-ready content.'));
    await db.repos.documents.updateStatus(scope, id, 'processing');

    const lines: LogLine[] = [];
    const queue = createIngestQueue(connection, { prefix });
    const worker = createIngestWorker({
      connection,
      deps: { repos: db.repos, storage, gateway: fakeGateway() },
      deadLetter,
      log: (l) => lines.push(l),
      prefix,
      autorun: true,
    });
    try {
      await enqueueIngest(queue, {
        teacherId: scope.teacherId,
        documentId: id,
        fileKind: 'markdown',
      } satisfies IngestJob);

      const row = await until(
        () => db.repos.documents.get(scope, id),
        (r) => r?.status === 'ready',
      );
      expect(row?.status).toBe('ready');
      expect(await chunkCount(id)).toBeGreaterThan(0);

      const hits = await until(
        () =>
          db.repos.retrieval.search(scope, {
            q: 'INGEST-INT-CANARY-ready',
            allowedModuleIds: ['mod_ing_01'],
            k: 10,
          }),
        (hs) => hs.length > 0,
      );
      expect(hits.some((h) => h.documentId === id)).toBe(true);
    } finally {
      await worker.close();
      await queue.close();
    }
  });

  it('an unsupported or corrupt file fails with a fixed reason', async () => {
    const storage = fakeStorage();
    const { id, storageKey } = await createDocument(db.repos, `ingest/${randomBytes(4).toString('hex')}.md`);
    // Zero bytes: parseDocument's own validation rejects an empty document before any parsing.
    storage.put(storageKey, md(''));
    await db.repos.documents.updateStatus(scope, id, 'processing');

    const lines: LogLine[] = [];
    const queue = createIngestQueue(connection, { prefix });
    const worker = createIngestWorker({
      connection,
      deps: { repos: db.repos, storage, gateway: fakeGateway() },
      deadLetter,
      log: (l) => lines.push(l),
      prefix,
      autorun: true,
    });
    try {
      await enqueueIngest(queue, {
        teacherId: scope.teacherId,
        documentId: id,
        fileKind: 'markdown',
      } satisfies IngestJob);

      const row = await until(
        () => db.repos.documents.get(scope, id),
        (r) => r?.status === 'failed',
      );
      expect(row?.status).toBe('failed');
      expect(row?.failureReason).toBe('validation');
      expect(await chunkCount(id)).toBe(0);
    } finally {
      await worker.close();
      await queue.close();
    }
  });

  it('a replace while the old job is still in flight: its chunks are never written, final chunks are the new file', async () => {
    const storage = fakeStorage();
    const oldKey = `ingest/${randomBytes(4).toString('hex')}-old.md`;
    const newKey = `ingest/${randomBytes(4).toString('hex')}-new.md`;
    const { id } = await createDocument(db.repos, oldKey);
    storage.put(oldKey, md('# Old\n\nINGEST-INT-CANARY-old content, never stored.'));
    storage.put(newKey, md('# New\n\nINGEST-INT-CANARY-new content.'));
    await db.repos.documents.updateStatus(scope, id, 'processing');

    const lines: LogLine[] = [];
    const deps = { repos: db.repos, storage, gateway: fakeGateway() };
    const processor = ingestProcessor(deps, (l) => lines.push(l));

    // The "old" job's storage read is gated: it starts, we replace the document mid-flight, then
    // release it so it resumes against a storageKey that is no longer the row's current one.
    const { release, started } = storage.gate(oldKey);
    const oldJob = processor({
      id: 'old',
      name: 'ingest.process',
      data: { teacherId: scope.teacherId, documentId: id, fileKind: 'markdown' },
    });
    await started;
    const { previousStorageKey } = await db.repos.documents.startReplace(scope, id, {
      storageKey: newKey,
    });
    expect(previousStorageKey).toBe(oldKey);
    release();

    expect(await oldJob).toBe('stale_skipped');
    expect(await chunkCount(id)).toBe(0);
    expect((await db.repos.documents.get(scope, id))?.status).toBe('uploading');

    // The new job (for the file the replace pointed at) runs to ready normally.
    await db.repos.documents.updateStatus(scope, id, 'processing');
    const newOutcome = await processor({
      id: 'new',
      name: 'ingest.process',
      data: { teacherId: scope.teacherId, documentId: id, fileKind: 'markdown' },
    });
    expect(newOutcome).toBe('ready');
    const row = await db.repos.documents.get(scope, id);
    expect(row?.status).toBe('ready');
    expect(await chunkCount(id)).toBeGreaterThan(0);

    const rows = await raw.query<{ text: string }>(`select text from chunks where document_id = $1`, [
      id,
    ]);
    expect(rows.rows.some((r) => r.text.includes('INGEST-INT-CANARY-new'))).toBe(true);
    expect(rows.rows.some((r) => r.text.includes('INGEST-INT-CANARY-old'))).toBe(false);
  });

  it('a job for a deleted document is a no-op', async () => {
    const storage = fakeStorage();
    const { id, storageKey } = await createDocument(db.repos, `ingest/${randomBytes(4).toString('hex')}.md`);
    storage.put(storageKey, md('# Gone\n\nnever read.'));
    await db.repos.documents.updateStatus(scope, id, 'processing');
    await db.repos.documents.delete(scope, id);

    const lines: LogLine[] = [];
    const queue = createIngestQueue(connection, { prefix });
    const worker = createIngestWorker({
      connection,
      deps: { repos: db.repos, storage, gateway: fakeGateway() },
      deadLetter,
      log: (l) => lines.push(l),
      prefix,
      autorun: true,
    });
    try {
      await enqueueIngest(queue, {
        teacherId: scope.teacherId,
        documentId: id,
        fileKind: 'markdown',
      } satisfies IngestJob);

      const dead = await until(
        async () =>
          (await deadLetter.getJobs(['waiting'])).map(
            (j) => j.data as { refs?: { documentId?: string } },
          ),
        (ds) => ds.some((d) => d.refs?.documentId === id),
      );
      expect(dead.some((d) => d.refs?.documentId === id)).toBe(true);
      expect(await chunkCount(id)).toBe(0);
      expect(await db.repos.documents.get(scope, id)).toBeNull();
    } finally {
      await worker.close();
      await queue.close();
    }
  });
});
