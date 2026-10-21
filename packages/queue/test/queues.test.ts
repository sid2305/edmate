import { EventEmitter } from 'node:events';
import { describe, expect, it, vi } from 'vitest';
import {
  ALERT_QUEUE,
  COMMIT_QUEUE,
  createIngestQueue,
  createTurnQueues,
  enqueueIngest,
  INGEST_QUEUE,
  IngestJobSchema,
  jobId,
  METER_QUEUE,
  SAFETY_EVENT_QUEUE,
} from '../src/index.js';

/** A Redis stand-in that never opens a socket (rule 4), as in apps/worker's worker.test.ts. */
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

describe('createTurnQueues', () => {
  it('builds the meter, commit, alert and safety-event queues on the caller’s connection without connecting', async () => {
    const redis = new FakeRedis();
    const queues = createTurnQueues(redis as never);
    expect((queues.meter as unknown as { name: string }).name).toBe(METER_QUEUE);
    expect((queues.commit as unknown as { name: string }).name).toBe(COMMIT_QUEUE);
    expect((queues.alert as unknown as { name: string }).name).toBe(ALERT_QUEUE);
    expect((queues.safetyEvent as unknown as { name: string }).name).toBe(SAFETY_EVENT_QUEUE);
    await expect(queues.close()).resolves.toBeUndefined();
    expect(redis.connect).not.toHaveBeenCalled();
  });

  it('takes a key prefix', async () => {
    const queues = createTurnQueues(new FakeRedis() as never, { prefix: 'edmate-test' });
    expect((queues.meter as unknown as { opts: { prefix: string } }).opts.prefix).toBe(
      'edmate-test',
    );
    await queues.close();
  });
});

describe('IngestJobSchema', () => {
  const base = { teacherId: 'tch_1', documentId: 'doc_1' };

  it('accepts a document file kind with no mimeType', () => {
    expect(IngestJobSchema.safeParse({ ...base, fileKind: 'pdf' }).success).toBe(true);
  });

  it('refuses a document file kind that carries a mimeType', () => {
    expect(
      IngestJobSchema.safeParse({ ...base, fileKind: 'pdf', mimeType: 'audio/mpeg' }).success,
    ).toBe(false);
  });

  it('accepts video/audio with a matching mimeType', () => {
    expect(
      IngestJobSchema.safeParse({ ...base, fileKind: 'video', mimeType: 'video/mp4' }).success,
    ).toBe(true);
    expect(
      IngestJobSchema.safeParse({ ...base, fileKind: 'audio', mimeType: 'audio/mpeg' }).success,
    ).toBe(true);
  });

  it('refuses video/audio with no mimeType', () => {
    expect(IngestJobSchema.safeParse({ ...base, fileKind: 'video' }).success).toBe(false);
  });

  it('refuses a malformed mimeType', () => {
    expect(
      IngestJobSchema.safeParse({ ...base, fileKind: 'video', mimeType: 'not-a-mime' }).success,
    ).toBe(false);
  });

  it('refuses an unknown field (strict)', () => {
    expect(
      IngestJobSchema.safeParse({ ...base, fileKind: 'pdf', extra: 'x' }).success,
    ).toBe(false);
  });

  it('refuses an unknown fileKind', () => {
    expect(IngestJobSchema.safeParse({ ...base, fileKind: 'zip' }).success).toBe(false);
  });
});

describe('jobId.ingest', () => {
  it('is stable per document id', () => {
    expect(jobId.ingest('doc_1')).toBe('doc_1.ingest');
    expect(jobId.ingest('doc_1')).toBe(jobId.ingest('doc_1'));
  });
});

describe('createIngestQueue / enqueueIngest', () => {
  it('builds the ingest queue on the caller’s connection without connecting', async () => {
    const redis = new FakeRedis();
    const queue = createIngestQueue(redis as never);
    expect((queue as unknown as { name: string }).name).toBe(INGEST_QUEUE);
    expect(redis.connect).not.toHaveBeenCalled();
    await queue.close();
  });

  it('takes a key prefix', async () => {
    const queue = createIngestQueue(new FakeRedis() as never, { prefix: 'edmate-test' });
    expect((queue as unknown as { opts: { prefix: string } }).opts.prefix).toBe('edmate-test');
    await queue.close();
  });

  it('adds a job named ingest.process, keyed by document id, so a replay replaces it', async () => {
    const add = vi.fn(async () => undefined);
    await enqueueIngest({ add }, { teacherId: 'tch_1', documentId: 'doc_1', fileKind: 'pdf' });
    expect(add).toHaveBeenCalledTimes(1);
    const [name, data, opts] = add.mock.calls[0] as unknown as [
      string,
      unknown,
      { jobId?: string },
    ];
    expect(name).toBe('ingest.process');
    expect(data).toEqual({ teacherId: 'tch_1', documentId: 'doc_1', fileKind: 'pdf' });
    expect(opts.jobId).toBe('doc_1.ingest');
  });

  it('refuses a malformed job before calling add', async () => {
    const add = vi.fn(async () => undefined);
    await expect(
      enqueueIngest({ add }, { teacherId: 'tch_1', documentId: 'doc_1', fileKind: 'video' } as never),
    ).rejects.toThrow();
    expect(add).not.toHaveBeenCalled();
  });
});
