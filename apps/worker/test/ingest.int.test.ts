// Task 8.2 Phase 2 (deferred to 8.2c): the ingest worker on real Postgres and Redis. A fake
// in-memory storage stands in for S3 and a scripted embedder stands in for the model gateway (rule
// 4: no real model, S3 or network calls). Covers: enqueue -> process -> ready with chunks that a
// scoped search finds; an unsupported/corrupt file -> failed with a fixed reason; a replace racing
// a still-running job for the old file; a job for a document already deleted. Task 8.2e adds web
// links: ready, refused, not HTML, and a site failing every attempt (failed, and the URL is gone
// from Redis), through the real fetcher with a fake resolver and transport, or a recorded page.
//
// Locally:
//   docker compose -f docker/compose.yaml -f packages/db/test/compose.port.yaml \
//     -f apps/worker/test/compose.port.yaml up -d postgres redis
// CI provides both services. Without them the suite skips locally and fails in CI.
import { randomBytes } from 'node:crypto';
import { migrateDatabase, openDatabase, type Repositories } from '@edmate/db';
import { createWebFetcher, type WebFetcher } from '@edmate/ingest';
import { stubWebFetcher } from '@edmate/ingest/testing';
import {
  createIngestQueue,
  enqueueIngest,
  INGEST_QUEUE,
  type IngestJob,
  type JobQueue,
} from '@edmate/queue';
import { Queue } from 'bullmq';
import { Redis } from 'ioredis';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createIngestWorker } from '../src/ingest/workers.js';
import type { IngestGateway } from '../src/ingest/gateway.js';
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
    rightsDeclared: true,
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
    const { id, storageKey } = await createDocument(
      db.repos,
      `ingest/${randomBytes(4).toString('hex')}.md`,
    );
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
      await enqueueIngest(
        queue,
        { teacherId: scope.teacherId, documentId: id, fileKind: 'markdown' } satisfies IngestJob,
        storageKey,
      );

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

  it('enqueue -> process: a synthetic .vtt caption reaches ready and a scoped search hits a chunk with a timestamp locator (task 8.2c Phase B)', async () => {
    const storage = fakeStorage();
    const { id, storageKey } = await createDocument(
      db.repos,
      `ingest/${randomBytes(4).toString('hex')}.vtt`,
    );
    storage.put(
      storageKey,
      md(
        'WEBVTT\n\n00:00:00.000 --> 00:00:02.000\nINGEST-INT-CANARY-caption content.\n\n00:00:05.000 --> 00:00:07.000\nMore of the lesson.\n',
      ),
    );
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
      await enqueueIngest(
        queue,
        { teacherId: scope.teacherId, documentId: id, fileKind: 'vtt' } satisfies IngestJob,
        storageKey,
      );

      const row = await until(
        () => db.repos.documents.get(scope, id),
        (r) => r?.status === 'ready',
      );
      expect(row?.status).toBe('ready');
      expect(await chunkCount(id)).toBeGreaterThan(0);

      const hits = await until(
        () =>
          db.repos.retrieval.search(scope, {
            q: 'INGEST-INT-CANARY-caption',
            allowedModuleIds: ['mod_ing_01'],
            k: 10,
          }),
        (hs) => hs.length > 0,
      );
      const hit = hits.find((h) => h.documentId === id);
      expect(hit).toBeDefined();
      expect(hit?.source.locator).toBe('0:00');
    } finally {
      await worker.close();
      await queue.close();
    }
  });

  it('EDMATE_INGEST_EMBEDDINGS=off: a markdown job reaches ready with no embedder, and full text finds it', async () => {
    const storage = fakeStorage();
    const { id, storageKey } = await createDocument(
      db.repos,
      `ingest/${randomBytes(4).toString('hex')}.md`,
    );
    storage.put(storageKey, md('# Off canary\n\nINGEST-INT-CANARY-off-mode content.'));
    await db.repos.documents.updateStatus(scope, id, 'processing');

    const lines: LogLine[] = [];
    const queue = createIngestQueue(connection, { prefix });
    const worker = createIngestWorker({
      connection,
      deps: { repos: db.repos, storage, gateway: {} },
      deadLetter,
      log: (l) => lines.push(l),
      prefix,
      autorun: true,
    });
    try {
      await enqueueIngest(
        queue,
        { teacherId: scope.teacherId, documentId: id, fileKind: 'markdown' } satisfies IngestJob,
        storageKey,
      );

      const row = await until(
        () => db.repos.documents.get(scope, id),
        (r) => r?.status === 'ready',
      );
      expect(row?.status).toBe('ready');
      expect(await chunkCount(id)).toBeGreaterThan(0);

      const hits = await until(
        () =>
          db.repos.retrieval.search(scope, {
            q: 'INGEST-INT-CANARY-off-mode',
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
    const { id, storageKey } = await createDocument(
      db.repos,
      `ingest/${randomBytes(4).toString('hex')}.md`,
    );
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
      await enqueueIngest(
        queue,
        { teacherId: scope.teacherId, documentId: id, fileKind: 'markdown' } satisfies IngestJob,
        storageKey,
      );

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

  it(
    'a replace while the old job is still in flight, through the real queue: the old job is ' +
      'skipped as stale, the new job reaches ready, and enqueuing the replacement never hangs',
    async () => {
      const storage = fakeStorage();
      const oldKey = `ingest/${randomBytes(4).toString('hex')}-old.md`;
      const newKey = `ingest/${randomBytes(4).toString('hex')}-new.md`;
      const { id } = await createDocument(db.repos, oldKey);
      storage.put(oldKey, md('# Old\n\nINGEST-INT-CANARY-old content, never stored.'));
      storage.put(newKey, md('# New\n\nINGEST-INT-CANARY-new content.'));
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
        // The old job's storage read is gated: it starts, we replace the document mid-flight
        // (giving the new job its own queue job id, see jobId.ingest), then release it so it
        // resumes against a storageKey that is no longer the row's current one.
        const { release, started } = storage.gate(oldKey);
        await enqueueIngest(
          queue,
          { teacherId: scope.teacherId, documentId: id, fileKind: 'markdown' } satisfies IngestJob,
          oldKey,
        );
        await started;

        const { previousStorageKey } = await db.repos.documents.startReplace(scope, id, {
          storageKey: newKey,
          rightsDeclared: true,
        });
        expect(previousStorageKey).toBe(oldKey);

        // The key fix under test: enqueuing the replacement job (a distinct id, derived from
        // newKey) does not hang even while the old job for oldKey is still active on the queue.
        await db.repos.documents.updateStatus(scope, id, 'processing');
        await enqueueIngest(
          queue,
          { teacherId: scope.teacherId, documentId: id, fileKind: 'markdown' } satisfies IngestJob,
          newKey,
        );

        release();

        // The old job finishes (stale_skipped, nothing written) and the new job runs it to ready.
        const row = await until(
          () => db.repos.documents.get(scope, id),
          (r) => r?.status === 'ready',
        );
        expect(row?.status).toBe('ready');
        expect(row?.storageKey).toBe(newKey);

        const rows = await raw.query<{ text: string }>(
          `select text from chunks where document_id = $1`,
          [id],
        );
        expect(rows.rows.length).toBeGreaterThan(0);
        expect(rows.rows.some((r) => r.text.includes('INGEST-INT-CANARY-new'))).toBe(true);
        expect(rows.rows.some((r) => r.text.includes('INGEST-INT-CANARY-old'))).toBe(false);
      } finally {
        await worker.close();
        await queue.close();
      }
    },
    20_000,
  );

  it('a job for a deleted document is a no-op', async () => {
    const storage = fakeStorage();
    const { id, storageKey } = await createDocument(
      db.repos,
      `ingest/${randomBytes(4).toString('hex')}.md`,
    );
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
      await enqueueIngest(
        queue,
        { teacherId: scope.teacherId, documentId: id, fileKind: 'markdown' } satisfies IngestJob,
        storageKey,
      );

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

  // ---- web links (task 8.2e, ADR-0014) -------------------------------------------------------

  const LEAK = 'leak-marker-qz';
  const linkKey = (): string =>
    `teachers/${scope.teacherId}/documents/x/${randomBytes(4).toString('hex')}.link`;

  /** The real fetcher, with a fake resolver and a scripted transport (no socket, rule 4). */
  function scriptedFetcher(reply: { status: number; type: string; body: string }) {
    let calls = 0;
    const fetcher = createWebFetcher({
      allowedHosts: 'any-public',
      resolveHost: () => Promise.resolve(['93.184.216.34']),
      transport: () => {
        calls += 1;
        const bytes = new TextEncoder().encode(reply.body);
        return Promise.resolve({
          status: reply.status,
          header: (name: string) => (name === 'content-type' ? reply.type : undefined),
          body: (async function* () {
            await Promise.resolve();
            yield bytes;
          })(),
          cancel: () => undefined,
        });
      },
    });
    return { fetcher, calls: () => calls };
  }

  /** Every value under this suite's Redis prefix, as one string (to look for the URL). */
  async function redisDump(): Promise<string> {
    const out: string[] = [];
    for (const key of await connection.keys(`${prefix}:*`)) {
      const type = await connection.type(key);
      if (type === 'string') out.push((await connection.get(key)) ?? '');
      else if (type === 'hash') out.push(JSON.stringify(await connection.hgetall(key)));
      else if (type === 'list') out.push(JSON.stringify(await connection.lrange(key, 0, -1)));
      else if (type === 'zset') out.push(JSON.stringify(await connection.zrange(key, '0', '-1')));
      else if (type === 'set') out.push(JSON.stringify(await connection.smembers(key)));
      else if (type === 'stream') out.push(JSON.stringify(await connection.xrange(key, '-', '+')));
    }
    return out.join('\n');
  }

  async function runWebJob(
    url: string,
    webFetcher: WebFetcher,
    opts: { attempts?: number } = {},
  ): Promise<{ id: string; lines: LogLine[] }> {
    const { id, storageKey } = await createDocument(db.repos, linkKey());
    await db.repos.documents.updateStatus(scope, id, 'processing');
    const lines: LogLine[] = [];
    const queue = createIngestQueue(connection, { prefix });
    const counts = new Queue(INGEST_QUEUE, { connection, prefix });
    const worker = createIngestWorker({
      connection,
      deps: { repos: db.repos, storage: fakeStorage(), gateway: fakeGateway(), webFetcher },
      deadLetter,
      log: (l) => lines.push(l),
      prefix,
      autorun: true,
    });
    // enqueueIngest's own options, with fewer and faster retries so the suite stays quick.
    const fast: JobQueue = {
      add: (name, data, o) =>
        queue.add(name, data, {
          ...o,
          ...(opts.attempts === undefined
            ? {}
            : { attempts: opts.attempts, backoff: { type: 'fixed', delay: 10 } }),
        }),
    };
    try {
      await enqueueIngest(
        fast,
        { teacherId: scope.teacherId, documentId: id, fileKind: 'web', url } satisfies IngestJob,
        storageKey,
      );
      await until(
        () => db.repos.documents.get(scope, id),
        (r) => r?.status === 'ready' || r?.status === 'failed',
      );
      // Let the failed handler finish (dead-letter copy, removeOnFail) before looking at Redis.
      await until(
        () => counts.getJobCounts('active', 'waiting', 'delayed'),
        (c) => (c.active ?? 0) + (c.waiting ?? 0) + (c.delayed ?? 0) === 0,
      );
    } finally {
      await worker.close();
      await counts.close();
      await queue.close();
    }
    return { id, lines };
  }

  it('a web link reaches ready, and a scoped search finds its chunks', async () => {
    const url = `https://lessons.example.org/unit/1?key=${LEAK}`;
    const fetcher = stubWebFetcher({
      [url]:
        '<html><head><title>T</title></head><body><h1>Web canary</h1><p>INGEST-INT-CANARY-web page text.</p></body></html>',
    });
    const { id, lines } = await runWebJob(url, fetcher);
    expect((await db.repos.documents.get(scope, id))?.status).toBe('ready');
    expect(fetcher.requests).toEqual([url]);
    const hits = await until(
      () =>
        db.repos.retrieval.search(scope, {
          q: 'INGEST-INT-CANARY-web',
          allowedModuleIds: ['mod_ing_01'],
          k: 10,
        }),
      (hs) => hs.length > 0,
    );
    expect(hits.some((h) => h.documentId === id)).toBe(true);
    expect(JSON.stringify(lines)).not.toContain(LEAK);
  });

  it('a refused address fails as forbidden, with nothing fetched', async () => {
    const s = scriptedFetcher({ status: 200, type: 'text/html', body: '<p>x</p>' });
    const { id } = await runWebJob(`https://10.0.0.1/a?key=${LEAK}`, s.fetcher);
    const row = await db.repos.documents.get(scope, id);
    expect([row?.status, row?.failureReason]).toEqual(['failed', 'forbidden']);
    expect(s.calls()).toBe(0);
    expect(await chunkCount(id)).toBe(0);
  });

  it('a page that is not HTML fails as unsupported', async () => {
    const s = scriptedFetcher({ status: 200, type: 'application/pdf', body: '%PDF-1.7' });
    const { id } = await runWebJob(`https://lessons.example.org/a.pdf?key=${LEAK}`, s.fetcher);
    const row = await db.repos.documents.get(scope, id);
    expect([row?.status, row?.failureReason]).toEqual(['failed', 'unsupported']);
  });

  it('a site that fails on every attempt ends failed/provider_error, and no copy of the URL stays in Redis', async () => {
    const s = scriptedFetcher({ status: 503, type: 'text/html', body: 'down' });
    const { id, lines } = await runWebJob(`https://lessons.example.org/b?key=${LEAK}`, s.fetcher, {
      attempts: 2,
    });
    const row = await db.repos.documents.get(scope, id);
    expect([row?.status, row?.failureReason]).toEqual(['failed', 'provider_error']);
    expect(s.calls()).toBe(2);
    const dead = await until(
      async () => (await deadLetter.getJobs(['waiting'])).map((j) => j.data as { refs?: object }),
      (ds) => ds.some((d) => JSON.stringify(d).includes(id)),
    );
    expect(JSON.stringify(dead)).not.toContain(LEAK);
    expect(JSON.stringify(dead)).not.toContain('lessons.example.org');
    // The failed job itself is gone (removeOnFail), so its payload's URL is not in Redis at all.
    expect(await redisDump()).not.toContain(LEAK);
    expect(JSON.stringify(lines)).not.toContain(LEAK);
  });
});
