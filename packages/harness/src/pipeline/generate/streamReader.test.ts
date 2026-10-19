import type { ModelChunk } from '@edmate/contracts';
import { describe, expect, it } from 'vitest';
import { cancelSource } from '../clock.js';
import { TurnCancelled } from '../errors.js';
import { InvalidChunkError, raceCancel, StreamCloseFailed, StreamReader } from './streamReader.js';

/** A hand-driven async iterator: each next() waits until the test pushes or ends it. */
function manualStream() {
  const waiters: ((r: IteratorResult<unknown>) => void)[] = [];
  let returns = 0;
  let returnImpl: () => Promise<IteratorResult<unknown>> = () =>
    Promise.resolve({ value: undefined, done: true });
  const iterator: AsyncIterator<unknown> = {
    next: () => new Promise((resolve) => waiters.push(resolve)),
    return: () => {
      returns++;
      return returnImpl();
    },
  };
  return {
    stream: { [Symbol.asyncIterator]: () => iterator } as AsyncIterable<unknown>,
    push(value: unknown) {
      waiters.shift()?.({ value, done: false });
    },
    end() {
      waiters.shift()?.({ value: undefined, done: true });
    },
    get returns() {
      return returns;
    },
    failReturn(error: unknown) {
      returnImpl = () => Promise.reject(error);
    },
  };
}

const flush = async () => {
  for (let i = 0; i < 10; i++) await Promise.resolve();
};

const text = (t: string): ModelChunk => ({ type: 'text', text: t });

describe('StreamReader', () => {
  it('yields valid chunks in order, then undefined at the end, without calling return()', async () => {
    const m = manualStream();
    const r = new StreamReader(m.stream, cancelSource().token, () => undefined);
    const a = r.next();
    m.push(text('a'));
    expect(await a).toEqual(text('a'));
    const b = r.next();
    m.end();
    expect(await b).toBeUndefined();
    r.close();
    await flush();
    expect(m.returns).toBe(0);
  });

  it('cancel during a pending next() rejects at once with TurnCancelled and calls return() once', async () => {
    const m = manualStream();
    const c = cancelSource();
    const r = new StreamReader(m.stream, c.token, () => undefined);
    const pending = r.next();
    c.cancel();
    await expect(pending).rejects.toBeInstanceOf(TurnCancelled);
    await flush();
    expect(m.returns).toBe(1);
    r.close();
    await flush();
    expect(m.returns).toBe(1);
  });

  it('ignores a chunk that arrives after the cancel', async () => {
    const m = manualStream();
    const c = cancelSource();
    const r = new StreamReader(m.stream, c.token, () => undefined);
    const pending = r.next();
    c.cancel();
    m.push(text('late'));
    await expect(pending).rejects.toBeInstanceOf(TurnCancelled);
    await expect(r.next()).rejects.toBeInstanceOf(TurnCancelled);
  });

  it('a next() after the cancel rejects without reading', async () => {
    const m = manualStream();
    const c = cancelSource();
    c.cancel();
    const r = new StreamReader(m.stream, c.token, () => undefined);
    await expect(r.next()).rejects.toBeInstanceOf(TurnCancelled);
    await flush();
    expect(m.returns).toBe(1);
  });

  it('swallows and reports a return() rejection', async () => {
    const m = manualStream();
    const reported: unknown[] = [];
    m.failReturn(new Error('return failed: SECRET_PROMPT'));
    const tracked: Promise<unknown>[] = [];
    const r = new StreamReader(
      m.stream,
      cancelSource().token,
      (e) => reported.push(e),
      (p) => tracked.push(p),
    );
    const pending = r.next();
    m.push(text('a'));
    await pending;
    r.close();
    // The close is handed over, and it settles (never rejects) once the report is in.
    expect(tracked).toHaveLength(1);
    await expect(tracked[0]).resolves.toBeUndefined();
    expect(m.returns).toBe(1);
    expect(reported).toHaveLength(1);
    expect(reported[0]).toBeInstanceOf(StreamCloseFailed);
    expect((reported[0] as StreamCloseFailed).causeName).toBe('Error');
    expect(String(reported[0])).not.toContain('SECRET_PROMPT');
  });

  it('reports a return() that throws synchronously', async () => {
    const reported: unknown[] = [];
    const iterator: AsyncIterator<unknown> = {
      next: () => Promise.resolve({ value: text('a'), done: false }),
      return: () => {
        throw new Error('sync return');
      },
    };
    const r = new StreamReader(
      { [Symbol.asyncIterator]: () => iterator },
      cancelSource().token,
      (e) => reported.push(e),
    );
    await r.next();
    r.close();
    await flush();
    expect(reported).toHaveLength(1);
  });

  it('closes an iterator without return() quietly', async () => {
    const reported: unknown[] = [];
    const iterator: AsyncIterator<unknown> = {
      next: () => Promise.resolve({ value: text('a'), done: false }),
    };
    const r = new StreamReader(
      { [Symbol.asyncIterator]: () => iterator },
      cancelSource().token,
      (e) => reported.push(e),
    );
    await r.next();
    r.close();
    await flush();
    expect(reported).toEqual([]);
  });

  it('an invalid chunk fails with InvalidChunkError that names no content, and closes the stream', async () => {
    const m = manualStream();
    const r = new StreamReader(m.stream, cancelSource().token, () => undefined);
    const pending = r.next();
    m.push({ type: 'text', text: 42, secret: 'SECRET_TEXT' });
    const err = await pending.catch((e: unknown) => e);
    expect(err).toBeInstanceOf(InvalidChunkError);
    expect(String(err)).not.toContain('SECRET_TEXT');
    await flush();
    expect(m.returns).toBe(1);
  });

  it('a rejected next() propagates its error and closes the stream', async () => {
    const iterator: AsyncIterator<unknown> = {
      next: () => Promise.reject(new Error('provider down')),
      return: () => Promise.resolve({ value: undefined, done: true }),
    };
    const r = new StreamReader(
      { [Symbol.asyncIterator]: () => iterator },
      cancelSource().token,
      () => undefined,
    );
    await expect(r.next()).rejects.toThrow('provider down');
  });

  it('a next() after the stream ended returns undefined again', async () => {
    const m = manualStream();
    const r = new StreamReader(m.stream, cancelSource().token, () => undefined);
    const p = r.next();
    m.end();
    await p;
    expect(await r.next()).toBeUndefined();
  });
});

describe('raceCancel', () => {
  it('resolves with the work when it finishes first', async () => {
    expect(await raceCancel(Promise.resolve(1), cancelSource().token)).toBe(1);
  });

  it('rejects with TurnCancelled at once when the token fires; a late rejection is caught', async () => {
    const c = cancelSource();
    let reject: (e: unknown) => void = () => undefined;
    const work = new Promise<number>((_res, rej) => {
      reject = rej;
    });
    const raced = raceCancel(work, c.token);
    c.cancel();
    await expect(raced).rejects.toBeInstanceOf(TurnCancelled);
    reject(new Error('late'));
    await flush();
  });

  it('rejects at once for an already-cancelled token', async () => {
    const c = cancelSource();
    c.cancel();
    await expect(raceCancel(new Promise(() => undefined), c.token)).rejects.toBeInstanceOf(
      TurnCancelled,
    );
  });

  it('passes on the work rejection', async () => {
    await expect(raceCancel(Promise.reject(new Error('x')), cancelSource().token)).rejects.toThrow(
      'x',
    );
  });
});
