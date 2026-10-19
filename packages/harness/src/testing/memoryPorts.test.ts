import type { Message, ModelGateway } from '@edmate/contracts';
import { demoSafetyAlert, demoTurnTrace, usageMain } from '@edmate/contracts/fixtures';
import { describe, expect, it } from 'vitest';
import { EventQueue } from '../pipeline/events.js';
import {
  memoryAlertSink,
  memorySessionStateStore,
  memoryTraceSink,
  memoryTranscriptStore,
  memoryUsageMeter,
  UnusedPortError,
  unusedPort,
} from './memoryPorts.js';

const demoMessageAgent: Message = {
  id: 'msg_agent',
  role: 'agent',
  text: 'What do you notice?',
  createdAt: '2026-10-18T10:00:00.000Z',
};

describe('memory ports', () => {
  it('unusedPort throws and records each call; it is not a thenable', async () => {
    const calls: string[] = [];
    const port = unusedPort<ModelGateway>('gateway', calls);
    expect(() => port.embed(['x'])).toThrow(UnusedPortError);
    expect(calls).toEqual(['gateway.embed']);
    expect(await Promise.resolve(port)).toBe(port);
  });

  it('memoryTraceSink records and can fail', async () => {
    const ok = memoryTraceSink();
    await ok.record(demoTurnTrace);
    expect(ok.records).toEqual([demoTurnTrace]);
    await expect(memoryTraceSink({ fail: true }).record(demoTurnTrace)).rejects.toThrow('down');
  });

  it('memoryUsageMeter keeps rows; memoryAlertSink fails failTimes then delivers', async () => {
    const m = memoryUsageMeter();
    const ctx = {
      teacherId: 't',
      packageId: 'p',
      studentId: 's',
      turnId: 'u',
      source: 'eval' as const,
    };
    await m.record(usageMain, ctx);
    expect(m.rows).toEqual([{ usage: usageMain, ctx }]);
    const a = memoryAlertSink({ failTimes: 1 });
    await expect(a.raise(demoSafetyAlert)).rejects.toThrow('attempt 1');
    await a.raise(demoSafetyAlert);
    expect(a.attempts).toBe(2);
    expect(a.raised).toEqual([demoSafetyAlert]);
  });
});

describe('EventQueue', () => {
  it('ends a waiting consumer on close and drops pushes after close', async () => {
    const q = new EventQueue<number>();
    const it = q[Symbol.asyncIterator]();
    const pending = it.next();
    q.close();
    q.push(1);
    q.close();
    expect(await pending).toEqual({ value: undefined, done: true });
    expect(q.isClosed).toBe(true);
  });

  it('hands a push straight to a waiting consumer', async () => {
    const q = new EventQueue<number>();
    const it = q[Symbol.asyncIterator]();
    const pending = it.next();
    q.push(7);
    expect(await pending).toEqual({ value: 7, done: false });
  });

  it('memoryTranscriptStore appends per session and returns the newest `limit`, oldest first', async () => {
    const t = memoryTranscriptStore();
    const a = { ...demoMessageAgent, id: 'msg_a' };
    const b = { ...demoMessageAgent, id: 'msg_b' };
    await t.append('ses_1', a);
    await t.append('ses_2', { ...demoMessageAgent, id: 'msg_other' });
    await t.append('ses_1', b);
    expect(await t.history('ses_1', 1)).toEqual([b]);
    expect(await t.history('ses_1', 10)).toEqual([a, b]);
    expect(t.appended).toHaveLength(3);
    await expect(memoryTranscriptStore({ fail: true }).append('ses_1', a)).rejects.toThrow('down');
  });

  it('memorySessionStateStore records every save and can fail', async () => {
    const s = memorySessionStateStore();
    await s.saveHelpState('ses_1', { v: 1 });
    expect(s.saved).toEqual([{ sessionId: 'ses_1', helpState: { v: 1 } }]);
    await expect(
      memorySessionStateStore({ fail: true }).saveHelpState('ses_1', {}),
    ).rejects.toThrow('down');
  });
});
