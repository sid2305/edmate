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
  RETRY,
  SAFETY_EVENT_QUEUE,
  WEB_INGEST_ATTEMPTS,
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

describe('IngestJobSchema: caption files (task 8.2c, B-47)', () => {
  const base = { teacherId: 'tch_1', documentId: 'doc_1' };

  it.each(['vtt', 'srt'] as const)('accepts a %s caption job with no mimeType and no url', (fileKind) => {
    expect(IngestJobSchema.safeParse({ ...base, fileKind }).success).toBe(true);
  });

  it.each(['vtt', 'srt'] as const)('refuses a %s caption job that carries a mimeType', (fileKind) => {
    expect(
      IngestJobSchema.safeParse({ ...base, fileKind, mimeType: 'text/vtt' }).success,
    ).toBe(false);
  });

  it.each(['vtt', 'srt'] as const)('refuses a %s caption job that carries a url', (fileKind) => {
    expect(
      IngestJobSchema.safeParse({ ...base, fileKind, url: 'https://a.example.org/' }).success,
    ).toBe(false);
  });

  it.each(['vtt', 'srt'] as const)(
    'a %s caption job gets the file-job attempts (5), not WEB_INGEST_ATTEMPTS',
    async (fileKind) => {
      const add = vi.fn(async (_name: string, _data: unknown, _opts: object) => undefined);
      await enqueueIngest({ add }, { ...base, fileKind }, `ingest/a.${fileKind}`);
      const opts = add.mock.calls[0]?.[2] as { attempts?: number; removeOnFail?: unknown };
      expect(opts.attempts).toBe(RETRY.attempts);
      expect(opts.removeOnFail).toEqual({ age: 7 * 24 * 60 * 60, count: 1_000 });
    },
  );
});

describe('IngestJobSchema: web links (task 8.2e)', () => {
  const base = { teacherId: 'tch_1', documentId: 'doc_1' };
  const url = 'https://lessons.example.org/unit/1?key=abc';

  it('a web job carries its https URL', () => {
    expect(IngestJobSchema.safeParse({ ...base, fileKind: 'web', url }).success).toBe(true);
  });

  it('a web job without a URL, or with a mime type, is refused', () => {
    expect(IngestJobSchema.safeParse({ ...base, fileKind: 'web' }).success).toBe(false);
    expect(
      IngestJobSchema.safeParse({ ...base, fileKind: 'web', url, mimeType: 'video/mp4' }).success,
    ).toBe(false);
  });

  it('a file job with a URL is refused', () => {
    expect(IngestJobSchema.safeParse({ ...base, fileKind: 'pdf', url }).success).toBe(false);
    expect(
      IngestJobSchema.safeParse({ ...base, fileKind: 'video', mimeType: 'video/mp4', url }).success,
    ).toBe(false);
  });

  it.each([
    ['plain http', 'http://lessons.example.org/a'],
    ['not a URL', 'https://'],
    ['free text', 'lessons.example.org/a'],
    ['over 2048 characters', `https://lessons.example.org/${'a'.repeat(2048)}`],
    ['an empty string', ''],
  ])('a web job with %s is refused', (_label, bad) => {
    expect(IngestJobSchema.safeParse({ ...base, fileKind: 'web', url: bad }).success).toBe(false);
  });
});

describe('jobId.ingest', () => {
  it('is stable per document id and storage key', () => {
    expect(jobId.ingest('doc_1', 'ingest/a.pdf')).toBe(jobId.ingest('doc_1', 'ingest/a.pdf'));
  });

  it('differs when the storage key differs (a replace must not collide with the old job)', () => {
    expect(jobId.ingest('doc_1', 'ingest/a.pdf')).not.toBe(jobId.ingest('doc_1', 'ingest/b.pdf'));
  });

  it('contains no colon and is not a plain integer', () => {
    const id = jobId.ingest('doc_1', 'ingest/a.pdf');
    expect(id).not.toContain(':');
    expect(Number.isInteger(Number(id))).toBe(false);
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

  it('adds a job named ingest.process, keyed by document id and storage key, so a replay of the same file replaces it', async () => {
    const add = vi.fn(async () => undefined);
    await enqueueIngest(
      { add },
      { teacherId: 'tch_1', documentId: 'doc_1', fileKind: 'pdf' },
      'ingest/a.pdf',
    );
    expect(add).toHaveBeenCalledTimes(1);
    const [name, data, opts] = add.mock.calls[0] as unknown as [
      string,
      unknown,
      { jobId?: string },
    ];
    expect(name).toBe('ingest.process');
    expect(data).toEqual({ teacherId: 'tch_1', documentId: 'doc_1', fileKind: 'pdf' });
    expect(opts.jobId).toBe(jobId.ingest('doc_1', 'ingest/a.pdf'));
  });

  it('gives a replace (a new storage key) a different job id than the original', async () => {
    const add = vi.fn(async (_name: string, _data: unknown, _opts: { jobId?: string }) => undefined);
    await enqueueIngest(
      { add },
      { teacherId: 'tch_1', documentId: 'doc_1', fileKind: 'pdf' },
      'ingest/old.pdf',
    );
    await enqueueIngest(
      { add },
      { teacherId: 'tch_1', documentId: 'doc_1', fileKind: 'pdf' },
      'ingest/new.pdf',
    );
    const ids = add.mock.calls.map((c) => (c[2] as { jobId?: string }).jobId);
    expect(ids[0]).not.toBe(ids[1]);
  });

  it('a web job carries the URL and is removed from Redis when it fails for the last time', async () => {
    const add = vi.fn(async (_name: string, _data: unknown, _opts: object) => undefined);
    const url = 'https://lessons.example.org/unit/1?key=abc';
    await enqueueIngest(
      { add },
      { teacherId: 'tch_1', documentId: 'doc_1', fileKind: 'web', url },
      'teachers/tch_1/documents/doc_1/u.link',
    );
    const [, data, opts] = add.mock.calls[0] as unknown as [
      string,
      unknown,
      { jobId?: string; removeOnFail?: unknown; removeOnComplete?: unknown; attempts?: number },
    ];
    expect(data).toEqual({ teacherId: 'tch_1', documentId: 'doc_1', fileKind: 'web', url });
    expect(opts.jobId).toBe(jobId.ingest('doc_1', 'teachers/tch_1/documents/doc_1/u.link'));
    expect(opts.removeOnFail).toBe(true);
    expect(opts.removeOnComplete).toBe(true);
  });

  it('a web job gets only WEB_INGEST_ATTEMPTS tries so a slow site cannot hold the ingest slot', async () => {
    const add = vi.fn(async (_name: string, _data: unknown, _opts: object) => undefined);
    await enqueueIngest(
      { add },
      { teacherId: 'tch_1', documentId: 'doc_1', fileKind: 'web', url: 'https://a.example.org/' },
      'teachers/tch_1/documents/doc_1/u.link',
    );
    const opts = add.mock.calls[0]?.[2] as { attempts?: number; backoff?: unknown };
    expect(WEB_INGEST_ATTEMPTS).toBe(2);
    expect(opts.attempts).toBe(WEB_INGEST_ATTEMPTS);
    expect(opts.backoff).toEqual(RETRY.backoff);
  });

  it('a file job keeps its failed copy for the usual time and every retry', async () => {
    const add = vi.fn(async (_name: string, _data: unknown, _opts: object) => undefined);
    await enqueueIngest(
      { add },
      { teacherId: 'tch_1', documentId: 'doc_1', fileKind: 'pdf' },
      'ingest/a.pdf',
    );
    const opts = add.mock.calls[0]?.[2] as { removeOnFail?: unknown; attempts?: number };
    expect(opts.removeOnFail).toEqual({ age: 7 * 24 * 60 * 60, count: 1_000 });
    expect(opts.attempts).toBe(RETRY.attempts);
  });

  it('refuses a malformed job before calling add', async () => {
    const add = vi.fn(async () => undefined);
    await expect(
      enqueueIngest(
        { add },
        { teacherId: 'tch_1', documentId: 'doc_1', fileKind: 'video' } as never,
        'ingest/a.pdf',
      ),
    ).rejects.toThrow();
    expect(add).not.toHaveBeenCalled();
  });
});
