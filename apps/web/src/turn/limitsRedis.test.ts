// Task 9.4d: the limits Redis client's options make a black-holed Redis (a socket that accepts
// and never answers) reject the session-start take within `commandTimeout`, so POST /api/sessions
// fails closed with 503 instead of hanging. The "Redis" here is a local TCP socket that never
// replies (no real Redis; rule 4).
import { createServer, type Server, type Socket } from 'node:net';
import { Redis } from 'ioredis';
import { afterEach, describe, expect, it } from 'vitest';
import { LIMITS_REDIS_OPTIONS } from './runtime';
import { redisSessionRateLimiter } from './sessionRateLimit';

let server: Server | undefined;
const sockets: Socket[] = [];
let client: Redis | undefined;

afterEach(async () => {
  client?.disconnect();
  client = undefined;
  for (const s of sockets.splice(0)) s.destroy();
  const open = server;
  server = undefined;
  if (open) await new Promise<void>((done) => open.close(() => done()));
});

async function blackHole(): Promise<number> {
  const s = createServer((socket) => {
    sockets.push(socket);
    socket.on('data', () => undefined); // read and never reply
  });
  server = s;
  await new Promise<void>((done) => s.listen(0, '127.0.0.1', done));
  const address = s.address();
  if (address === null || typeof address === 'string') throw new Error('no port');
  return address.port;
}

describe('limits Redis client options', () => {
  it('bounds every command and the connect', () => {
    expect(LIMITS_REDIS_OPTIONS.commandTimeout).toBeGreaterThan(0);
    expect(LIMITS_REDIS_OPTIONS.commandTimeout).toBeLessThanOrEqual(5_000);
    expect(LIMITS_REDIS_OPTIONS.connectTimeout).toBeGreaterThan(0);
    expect(LIMITS_REDIS_OPTIONS.maxRetriesPerRequest).toBe(1);
  });

  it('a black-holed Redis rejects take() within the command timeout instead of hanging', async () => {
    const port = await blackHole();
    client = new Redis(`redis://127.0.0.1:${port}`, { ...LIMITS_REDIS_OPTIONS, commandTimeout: 200 });
    client.on('error', () => undefined);
    const limiter = redisSessionRateLimiter(client);
    const started = Date.now();
    await expect(limiter.take('stu_1')).rejects.toThrow(/timed out/i);
    // A gross-regression guard only (lessons: wall-clock bounds): far under the 5 s test timeout.
    expect(Date.now() - started).toBeLessThan(4_000);
  });
});
