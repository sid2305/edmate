import { EventEmitter } from 'node:events';
import type { Job } from 'bullmq';
import { describe, expect, it, vi } from 'vitest';
import { createNoopWorker, NOOP_QUEUE_NAME, noopProcessor } from './worker.js';

/**
 * A stand-in Redis client that never opens a socket (rule 4: no real external calls in tests).
 * It stays in "connecting" forever, so BullMQ never sends a command to it. Every client,
 * including the duplicates BullMQ makes for blocking reads, is recorded in `clients`.
 */
function fakeRedisFactory() {
  const clients: FakeRedis[] = [];
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
    constructor() {
      super();
      clients.push(this);
    }
  }
  return { redis: new FakeRedis(), clients };
}

describe('no-op worker', () => {
  it('builds on an injected connection without connecting or running', async () => {
    const { redis, clients } = fakeRedisFactory();
    const worker = createNoopWorker(redis as never);
    try {
      expect(worker.name).toBe(NOOP_QUEUE_NAME);
      expect(worker.isRunning()).toBe(false);
      for (const client of clients) expect(client.connect).not.toHaveBeenCalled();
    } finally {
      await worker.close();
    }
  });

  it('closes cleanly, releasing the connections it made and never connecting', async () => {
    const { redis, clients } = fakeRedisFactory();
    const worker = createNoopWorker(redis as never);
    await expect(worker.close()).resolves.toBeUndefined();
    const duplicates = clients.filter((c) => c !== redis);
    expect(duplicates.length).toBeGreaterThan(0);
    for (const client of duplicates) expect(client.disconnect).toHaveBeenCalled();
    for (const client of clients) expect(client.connect).not.toHaveBeenCalled();
  });

  it('processes a job by doing nothing', async () => {
    await expect(
      noopProcessor({ id: '1', name: 'noop', data: {} } as Job),
    ).resolves.toBeUndefined();
  });
});
