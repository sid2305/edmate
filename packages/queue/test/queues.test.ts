import { EventEmitter } from 'node:events';
import { describe, expect, it, vi } from 'vitest';
import { COMMIT_QUEUE, createTurnQueues, METER_QUEUE } from '../src/index.js';

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
  it('builds the meter and commit queues on the caller’s connection without connecting', async () => {
    const redis = new FakeRedis();
    const queues = createTurnQueues(redis as never);
    expect((queues.meter as unknown as { name: string }).name).toBe(METER_QUEUE);
    expect((queues.commit as unknown as { name: string }).name).toBe(COMMIT_QUEUE);
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
