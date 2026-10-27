import { EventEmitter } from 'node:events';
import type { StaleProcessingDocument } from '@edmate/db';
import { jobId } from '@edmate/queue';
import { describe, expect, it, vi } from 'vitest';
import type { LogLine } from '../log.js';
import {
  createIngestSweepWorker,
  ingestSweepJob,
  INGEST_SWEEP_FAILURE_REASON,
  INGEST_SWEEP_JOB,
  INGEST_SWEEP_JOB_OPTIONS,
  INGEST_SWEEP_PATTERN,
  INGEST_SWEEP_QUEUE,
  INGEST_SWEEP_SCHEDULER_ID,
  type IngestSweepDeps,
  scheduleIngestSweep,
  STUCK_PROCESSING_MINUTES,
} from './sweep.js';

const NOW = new Date('2026-10-27T10:00:00.000Z');

const ROW = (over: Partial<StaleProcessingDocument> = {}): StaleProcessingDocument => ({
  id: 'doc_1',
  teacherId: 'tch_1',
  storageKey: 'uploads/tch_1/f1.pdf',
  ...over,
});

function deps(overrides: Partial<IngestSweepDeps> = {}): IngestSweepDeps {
  return {
    staleProcessing: () => Promise.resolve([]),
    documents: { failIfStorageKey: () => Promise.resolve({ updated: true }) },
    ingestJobState: () => Promise.resolve(undefined),
    now: () => NOW,
    log: () => undefined,
    ...overrides,
  };
}

describe('ingestSweepJob', () => {
  it('no stale documents: a clean no-op summary, one info log line', async () => {
    const lines: LogLine[] = [];
    const staleProcessing = vi.fn(() => Promise.resolve([]));
    const summary = await ingestSweepJob(deps({ staleProcessing, log: (l) => lines.push(l) }))();
    expect(summary).toEqual({
      marked: 0,
      skipped: 0,
      cutoff: new Date(NOW.getTime() - STUCK_PROCESSING_MINUTES * 60_000).toISOString(),
      pages: 1,
    });
    expect(lines).toEqual([expect.objectContaining({ level: 'info', event: 'ingest_sweep.run' })]);
    expect(staleProcessing).toHaveBeenCalledWith(
      new Date(NOW.getTime() - STUCK_PROCESSING_MINUTES * 60_000),
      expect.any(Number),
    );
  });

  it('marks only rows where failIfStorageKey returns updated: true; a false result is logged skipped, not an error', async () => {
    const calls: unknown[] = [];
    const failIfStorageKey = vi.fn((scope: unknown, id: string) => {
      calls.push({ scope, id });
      return Promise.resolve({ updated: id !== 'doc_moved_on' });
    });
    const lines: LogLine[] = [];
    const rows = [ROW({ id: 'doc_1' }), ROW({ id: 'doc_moved_on', teacherId: 'tch_2' })];
    const summary = await ingestSweepJob(
      deps({
        staleProcessing: vi.fn().mockResolvedValueOnce(rows),
        documents: { failIfStorageKey },
        log: (l) => lines.push(l),
      }),
    )();
    expect(summary).toEqual({
      marked: 1,
      skipped: 1,
      cutoff: expect.any(String),
      pages: 1,
    });
    expect(calls).toEqual([
      { scope: { teacherId: 'tch_1' }, id: 'doc_1' },
      { scope: { teacherId: 'tch_2' }, id: 'doc_moved_on' },
    ]);
    expect(failIfStorageKey).toHaveBeenNthCalledWith(
      1,
      { teacherId: 'tch_1' },
      'doc_1',
      'uploads/tch_1/f1.pdf',
      INGEST_SWEEP_FAILURE_REASON,
    );
    expect(lines.some((l) => l.event === 'ingest_sweep.candidate_skipped')).toBe(true);
    expect(lines.at(-1)).toEqual(
      expect.objectContaining({ level: 'warn', event: 'ingest_sweep.run', marked: 1, skipped: 1 }),
    );
  });

  it('a per-row failIfStorageKey throw is logged, the run continues to the rest of the page, but the job still rejects', async () => {
    const lines: LogLine[] = [];
    const rows = [ROW({ id: 'doc_bad' }), ROW({ id: 'doc_ok' })];
    const failIfStorageKey = vi.fn((_scope: unknown, id: string) =>
      id === 'doc_bad' ? Promise.reject(new Error('db down')) : Promise.resolve({ updated: true }),
    );
    const job = ingestSweepJob(
      deps({
        staleProcessing: () => Promise.resolve(rows),
        documents: { failIfStorageKey },
        log: (l) => lines.push(l),
      }),
    );
    await expect(job()).rejects.toThrow(/ingest_sweep/);
    expect(failIfStorageKey).toHaveBeenCalledTimes(2);
    expect(lines.some((l) => l.event === 'ingest_sweep.candidate_failed')).toBe(true);
    expect(lines.find((l) => l.event === 'ingest_sweep.candidate_failed')).toEqual(
      expect.objectContaining({ level: 'error', documentId: 'doc_bad' }),
    );
  });

  // Task 8.2q: ingestSweepRepo.staleProcessing now also returns stale `uploading` rows (a
  // create whose cleanup delete also failed, 8.2q item 4); no code change in this file was
  // expected -- failIfStorageKey's own from-state list already accepts `uploading`
  // (`STATUS_FROM.failed`, packages/db/src/repositories/chunks.ts) -- this test just confirms
  // the job loop treats a stale uploading row exactly like a stale processing one.
  it('a stale uploading row (not just processing) is marked failed by one run (task 8.2q)', async () => {
    const lines: LogLine[] = [];
    const failIfStorageKey = vi.fn(() => Promise.resolve({ updated: true }));
    const row = ROW({ id: 'doc_stale_uploading' }); // the row's own prior status doesn't reach
    // this file; staleProcessing already filtered to processing+uploading before returning it.
    const summary = await ingestSweepJob(
      deps({
        staleProcessing: () => Promise.resolve([row]),
        documents: { failIfStorageKey },
        log: (l) => lines.push(l),
      }),
    )();
    expect(summary).toEqual({ marked: 1, skipped: 0, cutoff: expect.any(String), pages: 1 });
    expect(failIfStorageKey).toHaveBeenCalledWith(
      { teacherId: 'tch_1' },
      'doc_stale_uploading',
      'uploads/tch_1/f1.pdf',
      INGEST_SWEEP_FAILURE_REASON,
    );
  });

  it('a row whose own ingest job is still active or waiting is skipped, not failed (8.2i fix round 1)', async () => {
    const lines: LogLine[] = [];
    const rows = [ROW({ id: 'doc_active' }), ROW({ id: 'doc_waiting' })];
    const failIfStorageKey = vi.fn(() => Promise.resolve({ updated: true }));
    const ingestJobState = vi.fn((id: string) =>
      Promise.resolve(
        id === jobId.ingest('doc_active', rows[0]?.storageKey ?? '') ? 'active' : 'waiting',
      ),
    );
    const summary = await ingestSweepJob(
      deps({
        staleProcessing: () => Promise.resolve(rows),
        documents: { failIfStorageKey },
        ingestJobState,
        log: (l) => lines.push(l),
      }),
    )();
    expect(summary).toEqual({ marked: 0, skipped: 2, cutoff: expect.any(String), pages: 1 });
    expect(failIfStorageKey).not.toHaveBeenCalled();
    expect(ingestJobState).toHaveBeenCalledWith(jobId.ingest('doc_active', 'uploads/tch_1/f1.pdf'));
    expect(ingestJobState).toHaveBeenCalledWith(
      jobId.ingest('doc_waiting', 'uploads/tch_1/f1.pdf'),
    );
    const stillQueued = lines.filter((l) => l.event === 'ingest_sweep.still_queued');
    expect(stillQueued).toEqual([
      expect.objectContaining({ documentId: 'doc_active', state: 'active' }),
      expect.objectContaining({ documentId: 'doc_waiting', state: 'waiting' }),
    ]);
  });

  it('a row whose own ingest job is missing, completed or failed is still failed as today (8.2i fix round 1)', async () => {
    const rows = [ROW({ id: 'doc_missing' }), ROW({ id: 'doc_done' }), ROW({ id: 'doc_dead' })];
    const failIfStorageKey = vi.fn(() => Promise.resolve({ updated: true }));
    const ingestJobState = vi.fn((id: string) => {
      if (id === jobId.ingest('doc_done', rows[1]?.storageKey ?? ''))
        return Promise.resolve('completed');
      if (id === jobId.ingest('doc_dead', rows[2]?.storageKey ?? ''))
        return Promise.resolve('failed');
      return Promise.resolve(undefined);
    });
    const summary = await ingestSweepJob(
      deps({
        staleProcessing: () => Promise.resolve(rows),
        documents: { failIfStorageKey },
        ingestJobState,
        log: () => undefined,
      }),
    )();
    expect(summary.marked).toBe(3);
    expect(failIfStorageKey).toHaveBeenCalledTimes(3);
  });

  it('a job-state lookup that throws is logged per row and the run still rejects (8.2i fix round 1)', async () => {
    const lines: LogLine[] = [];
    const rows = [ROW({ id: 'doc_bad' }), ROW({ id: 'doc_ok' })];
    const failIfStorageKey = vi.fn(() => Promise.resolve({ updated: true }));
    const ingestJobState = vi.fn((id: string) =>
      id === jobId.ingest('doc_bad', rows[0]?.storageKey ?? '')
        ? Promise.reject(new Error('redis down'))
        : Promise.resolve(undefined),
    );
    const job = ingestSweepJob(
      deps({
        staleProcessing: () => Promise.resolve(rows),
        documents: { failIfStorageKey },
        ingestJobState,
        log: (l) => lines.push(l),
      }),
    );
    await expect(job()).rejects.toThrow(/ingest_sweep/);
    expect(failIfStorageKey).toHaveBeenCalledTimes(1);
    expect(lines.find((l) => l.event === 'ingest_sweep.candidate_failed')).toEqual(
      expect.objectContaining({ level: 'error', documentId: 'doc_bad' }),
    );
  });

  it('loops while a full page comes back, stopping once a page is short', async () => {
    const fullPage = Array.from({ length: 1000 }, (_, i) => ROW({ id: `doc_${i}` }));
    const staleProcessing = vi
      .fn()
      .mockResolvedValueOnce(fullPage)
      .mockResolvedValueOnce([ROW({ id: 'doc_last' })]);
    const failIfStorageKey = vi.fn(() => Promise.resolve({ updated: true }));
    const summary = await ingestSweepJob(
      deps({ staleProcessing, documents: { failIfStorageKey }, log: () => undefined }),
    )();
    expect(summary.pages).toBe(2);
    expect(summary.marked).toBe(1001);
    expect(staleProcessing).toHaveBeenCalledTimes(2);
  });
});

describe('scheduleIngestSweep', () => {
  it('upserts one scheduler, every 15 minutes UTC, for the ingest.sweep job', async () => {
    const upsert = vi.fn(() => Promise.resolve());
    await scheduleIngestSweep({ upsertJobScheduler: upsert });
    expect(upsert).toHaveBeenCalledWith(
      INGEST_SWEEP_SCHEDULER_ID,
      { pattern: INGEST_SWEEP_PATTERN, tz: 'UTC' },
      { name: INGEST_SWEEP_JOB, data: {}, opts: INGEST_SWEEP_JOB_OPTIONS },
    );
    await scheduleIngestSweep({ upsertJobScheduler: upsert }, '*/5 * * * *');
    expect(upsert).toHaveBeenLastCalledWith(
      INGEST_SWEEP_SCHEDULER_ID,
      { pattern: '*/5 * * * *', tz: 'UTC' },
      expect.anything(),
    );
  });
});

/** A Redis stand-in that never opens a socket (rule 4), as in worker.test.ts. */
class FakeRedis extends EventEmitter {
  status = 'connecting';
  options = {};
  connect = vi.fn(async () => undefined);
  quit = vi.fn(async () => 'OK');
  disconnect = vi.fn(() => {
    this.status = 'end';
    this.emit('close');
    this.emit('end');
  });
  duplicate = vi.fn(() => new FakeRedis());
}

describe('createIngestSweepWorker', () => {
  it('builds the worker without connecting; failed and error events are logged', async () => {
    const lines: LogLine[] = [];
    const dead: unknown[] = [];
    const worker = createIngestSweepWorker({
      connection: new FakeRedis() as never,
      prefix: 'edmate-test',
      now: () => NOW,
      deadLetter: { add: (_n, d) => Promise.resolve(dead.push(d)) },
      deps: deps({ log: (l) => lines.push(l) }),
    });
    try {
      expect(worker.name).toBe(INGEST_SWEEP_QUEUE);
      expect(worker.isRunning()).toBe(false);
      worker.emit(
        'failed',
        {
          id: 'j1',
          name: INGEST_SWEEP_JOB,
          queueName: INGEST_SWEEP_QUEUE,
          data: {},
          attemptsMade: 3,
          opts: { attempts: 3 },
        } as never,
        new Error('db down'),
        'active',
      );
      worker.emit('error', new Error('redis gone'));
      await vi.waitFor(() => expect(dead).toHaveLength(1));
      expect(lines.map((l) => l.event)).toEqual(['worker.error', 'job.dead_lettered']);
    } finally {
      await worker.close();
    }
  });

  it('defaults: no prefix, the real clock', async () => {
    const worker = createIngestSweepWorker({
      connection: new FakeRedis() as never,
      deadLetter: { add: () => Promise.resolve() },
      deps: deps(),
    });
    await worker.close();
  });
});
