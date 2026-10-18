// Task 2.4: every call is metered once, unknown usage is never free, metering never changes what
// the caller sees. Scripted gateways and fake adapters only (rule 4).
import type { Entitlement, ModelChunk, ModelGateway, Usage } from '@edmate/contracts';
import { manualClock, ScriptedGateway, type GatewayScript } from '@edmate/harness/testing';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { GatewayError } from '../../src/adapters/errors.js';
import {
  createMeteredGateway,
  type MeterContext,
  type MeteringWarning,
  type MeterSink,
  type UnmeteredUsage,
} from '../../src/metering/index.js';
import { parsePriceTable } from '../../src/pricing/index.js';
import { Router } from '../../src/router/router.js';
import {
  collect,
  collectUntilError,
  failingAdapter,
  fakeAdapter,
  req,
} from '../router/fake-adapter.js';

const PRICES = parsePriceTable(`
priced-model:
  inputUsdPerMillion: 3
  outputUsdPerMillion: 15
`);

const CTX: MeterContext = {
  teacherId: 'tch_a',
  packageId: 'pkg_a',
  studentId: 'stu_a',
  turnId: 'turn_1',
  source: 'subscription',
};

// Prompt text that must never reach a sink.
const SECRET_SYSTEM = 'SYSTEM-PROMPT-zebra-7731';
const SECRET_MESSAGE = 'student wrote: my name is Priya Q and I live at 12 Elm';

const request = req({
  system: SECRET_SYSTEM,
  messages: [{ role: 'user', content: SECRET_MESSAGE }],
});

const usage = (over: Partial<Usage> = {}): Usage => ({
  model: 'priced-model',
  tier: 'main',
  inputTokens: 1_000,
  outputTokens: 2_000,
  costMicroUsd: 0,
  ...over,
});

interface Recorded {
  recorded: { u: Usage; ctx: MeterContext }[];
  flagged: UnmeteredUsage[];
}

function recordingSink(fail = false): MeterSink & Recorded {
  const out: Recorded = { recorded: [], flagged: [] };
  return {
    ...out,
    record(u, ctx) {
      out.recorded.push({ u, ctx });
      return fail ? Promise.reject(new Error(`db down ${SECRET_MESSAGE}`)) : Promise.resolve();
    },
    recordUnmetered(u) {
      out.flagged.push(u);
      return fail ? Promise.reject(new Error('db down')) : Promise.resolve();
    },
  };
}

function scripted(script: GatewayScript): ModelGateway {
  return new ScriptedGateway(script, manualClock());
}

function setup(inner: ModelGateway, opts: { fail?: boolean; ctx?: MeterContext } = {}) {
  const sink = recordingSink(opts.fail);
  const warnings: MeteringWarning[] = [];
  const gw = createMeteredGateway(inner, sink, opts.ctx ?? CTX, PRICES, {
    warn: (w) => warnings.push(w),
  });
  return { gw, sink, warnings };
}

const text = (t: string): ModelChunk => ({ type: 'text', text: t });

afterEach(() => {
  vi.restoreAllMocks();
});

describe('stream: one row per call', () => {
  it('records the reported usage once, priced, with the full context; chunks pass unchanged', async () => {
    const steps: ModelChunk[] = [text('a'), text('b'), { type: 'usage', usage: usage() }];
    const { gw, sink, warnings } = setup(scripted({ stream: [{ steps }] }));
    const seen = await collect(gw.stream(request));
    await gw.settled();
    expect(seen).toEqual(steps);
    expect(sink.recorded).toEqual([
      // 1,000 x $3/M + 2,000 x $15/M = 3,000 + 30,000 micro-USD.
      { u: { ...usage(), costMicroUsd: 33_000 }, ctx: CTX },
    ]);
    expect(sink.flagged).toEqual([]);
    expect(warnings).toEqual([]);
  });

  it('records usage of a stream that yields usage and then throws (stops early); the error is unchanged', async () => {
    const stopped = new GatewayError(
      'provider_error',
      false,
      'anthropic',
      'anthropic: truncated',
      'truncated',
    );
    const inner: ModelGateway = {
      async *stream() {
        yield text('partial');
        yield { type: 'usage', usage: usage({ inputTokens: 10, outputTokens: 20 }) };
        throw stopped;
      },
      generateObject: () => Promise.reject(new Error('unused')),
      embed: () => Promise.reject(new Error('unused')),
    };
    const { gw, sink } = setup(inner);
    const it = gw.stream(request)[Symbol.asyncIterator]();
    await it.next();
    await it.next();
    await expect(it.next()).rejects.toBe(stopped);
    // Recorded before the caller saw the error.
    expect(sink.recorded).toHaveLength(1);
    expect(sink.recorded[0]?.u.costMicroUsd).toBe(330); // 10 x 3 + 20 x 15
    expect(sink.flagged).toEqual([]);
  });

  it('records a flagged unknown row when the stream throws before any chunk', async () => {
    const err = new GatewayError('provider_error', true, 'anthropic', 'anthropic: network');
    const { gw, sink } = setup(
      new Router({ tiers: { small: failingAdapter(err), main: failingAdapter(err) } }),
    );
    const { seen, err: got } = await collectUntilError(gw.stream(request));
    await gw.settled();
    expect(seen).toEqual([]);
    expect(got).toBe(err);
    expect(sink.recorded).toEqual([]);
    expect(sink.flagged).toEqual([{ ...CTX, reason: 'no_usage_reported', tier: 'main' }]);
    expect(sink.flagged[0]).not.toHaveProperty('tokens');
  });

  it('records a flagged unknown row when the stream completes with no usage chunk', async () => {
    const { gw, sink } = setup(scripted({ stream: [{ steps: [text('hi')] }] }));
    expect(await collect(gw.stream(req({ tier: 'small' })))).toEqual([text('hi')]);
    await gw.settled();
    expect(sink.recorded).toEqual([]);
    expect(sink.flagged).toEqual([{ ...CTX, reason: 'no_usage_reported', tier: 'small' }]);
  });

  it('records an unpriced row with real tokens and logs the model once', async () => {
    const u = usage({ model: 'mystery-model', tier: 'small', inputTokens: 7, outputTokens: 9 });
    const { gw, sink, warnings } = setup(
      scripted({ stream: [{ steps: [text('x'), { type: 'usage', usage: u }] }] }),
    );
    await collect(gw.stream(request));
    await gw.settled();
    expect(sink.recorded).toEqual([]);
    expect(sink.flagged).toEqual([
      {
        ...CTX,
        reason: 'unpriced_model:mystery-model',
        tier: 'small',
        model: 'mystery-model',
        tokens: { inputTokens: 7, outputTokens: 9 },
      },
    ]);
    expect(warnings).toEqual([{ event: 'metering.unpriced_model', model: 'mystery-model' }]);
  });

  it('logs the unpriced model on stderr as one JSON line by default', async () => {
    const spy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const sink = recordingSink();
    const gw = createMeteredGateway(
      scripted({ stream: [{ steps: [{ type: 'usage', usage: usage({ model: 'nope' }) }] }] }),
      sink,
      CTX,
      PRICES,
    );
    await collect(gw.stream(request));
    await gw.settled();
    expect(spy).toHaveBeenCalledTimes(1);
    const line = String(spy.mock.calls[0]?.[0]);
    expect(JSON.parse(line)).toEqual({ event: 'metering.unpriced_model', model: 'nope' });
    expect(line).not.toContain(SECRET_MESSAGE);
    expect(line).not.toContain(CTX.studentId);
  });

  it('meters a stream the caller abandons with break, exactly once', async () => {
    const steps: ModelChunk[] = [{ type: 'usage', usage: usage() }, text('a'), text('b')];
    const { gw, sink } = setup(scripted({ stream: [{ steps }] }));
    for await (const c of gw.stream(request)) {
      if (c.type === 'text') break;
    }
    await gw.settled();
    expect(sink.recorded).toHaveLength(1);
    expect(sink.flagged).toEqual([]);

    const second = setup(scripted({ stream: [{ steps: [text('a'), text('b')] }] }));
    const seen: ModelChunk[] = [];
    for await (const c of second.gw.stream(request)) {
      seen.push(c);
      break;
    }
    expect(seen).toEqual([text('a')]);
    await second.gw.settled();
    expect(second.sink.flagged).toHaveLength(1);
    expect(second.sink.recorded).toEqual([]);
  });

  it('records every usage figure a stream reports (one row each)', async () => {
    const steps: ModelChunk[] = [
      { type: 'usage', usage: usage({ inputTokens: 1, outputTokens: 1 }) },
      { type: 'usage', usage: usage({ model: 'other', inputTokens: 2, outputTokens: 2 }) },
    ];
    const { gw, sink } = setup(scripted({ stream: [{ steps }] }));
    await collect(gw.stream(request));
    await gw.settled();
    expect(sink.recorded).toHaveLength(1);
    expect(sink.flagged).toHaveLength(1);
  });

  it('does not call the sink until the stream is iterated', async () => {
    const { gw, sink } = setup(scripted({ stream: [{ steps: [text('a')] }] }));
    gw.stream(request);
    await gw.settled();
    expect(sink.recorded).toEqual([]);
    expect(sink.flagged).toEqual([]);
  });

  it('a router failover inside one call is one call: only the fallback reports usage', async () => {
    const http5xx = new GatewayError('provider_error', true, 'anthropic', 'anthropic: HTTP 503');
    const fallback = fakeAdapter({
      id: 'openai-compatible',
      script: { stream: [{ steps: [text('ok'), { type: 'usage', usage: usage() }] }] },
    });
    const router = new Router({
      tiers: { small: failingAdapter(http5xx), main: failingAdapter(http5xx) },
      fallback,
    });
    const { gw, sink } = setup(router);
    await collect(gw.stream(request));
    await gw.settled();
    expect(sink.recorded).toHaveLength(1);
    expect(sink.flagged).toEqual([]);
  });
});

describe('generateObject and embed', () => {
  const schema = z.object({ intent: z.string() });

  it('generateObject: returns the value unchanged and records usage as unknown (the port carries none)', async () => {
    const { gw, sink } = setup(
      scripted({
        generateObject: [{ value: { intent: 'question' }, usage: usage({ tier: 'small' }) }],
      }),
    );
    expect(await gw.generateObject(req({ tier: 'small' }), schema)).toEqual({ intent: 'question' });
    await gw.settled();
    expect(sink.recorded).toEqual([]);
    expect(sink.flagged).toEqual([{ ...CTX, reason: 'no_usage_reported', tier: 'small' }]);
  });

  it('generateObject: a failing call is recorded as unknown and its error is unchanged', async () => {
    const err = new GatewayError('provider_error', false, 'anthropic', 'anthropic: bad');
    const { gw, sink } = setup(
      new Router({ tiers: { small: failingAdapter(err), main: failingAdapter(err) } }),
    );
    await expect(gw.generateObject(request, schema)).rejects.toBe(err);
    await gw.settled();
    expect(sink.flagged).toEqual([{ ...CTX, reason: 'no_usage_reported', tier: 'main' }]);
  });

  it('embed: returns vectors unchanged and records unknown usage on the main tier', async () => {
    const vectors = [[0.1, 0.2]];
    const { gw, sink } = setup(scripted({ embed: [{ vectors }] }));
    expect(await gw.embed(['some chunk'])).toEqual(vectors);
    await gw.settled();
    expect(sink.flagged).toEqual([{ ...CTX, reason: 'no_usage_reported', tier: 'main' }]);
  });

  it('embed: a failing call is recorded as unknown and its error is unchanged', async () => {
    const err = new Error('boom');
    const { gw, sink } = setup(
      new Router({ tiers: { small: failingAdapter(err), main: failingAdapter(err) } }),
    );
    await expect(gw.embed(['x'])).rejects.toBe(err);
    await gw.settled();
    expect(sink.flagged).toHaveLength(1);
  });
});

describe('metering never changes the call', () => {
  it('a rejecting sink does not change chunks, values or errors; it is logged by class name only', async () => {
    const steps: ModelChunk[] = [text('a'), { type: 'usage', usage: usage() }];
    const err = new Error('provider gone');
    const { gw, warnings } = setup(
      scripted({ stream: [{ steps }], generateObject: [{ value: { intent: 'q' } }] }),
      { fail: true },
    );
    expect(await collect(gw.stream(request))).toEqual(steps);
    expect(await gw.generateObject(request, z.object({ intent: z.string() }))).toEqual({
      intent: 'q',
    });
    const failing = setup(
      new Router({ tiers: { small: failingAdapter(err), main: failingAdapter(err) } }),
      {
        fail: true,
      },
    );
    await expect(failing.gw.embed(['x'])).rejects.toBe(err);
    await gw.settled();
    await failing.gw.settled();
    expect(warnings).toEqual([
      { event: 'metering.failed', method: 'stream', error: 'Error' },
      { event: 'metering.failed', method: 'generateObject', error: 'Error' },
    ]);
    expect(failing.warnings).toEqual([
      { event: 'metering.failed', method: 'embed', error: 'Error' },
    ]);
    expect(JSON.stringify(warnings)).not.toContain(SECRET_MESSAGE);
  });

  it('a sink that throws synchronously, or rejects with a non-Error, is logged too', async () => {
    const warnings: MeteringWarning[] = [];
    const sink: MeterSink = {
      record: () => {
        throw new TypeError('sync');
      },
      recordUnmetered: () => Promise.reject('plain string'),
    };
    const gw = createMeteredGateway(
      scripted({ stream: [{ steps: [{ type: 'usage', usage: usage() }] }, { steps: [] }] }),
      sink,
      CTX,
      PRICES,
      { warn: (w) => warnings.push(w) },
    );
    await collect(gw.stream(request));
    await collect(gw.stream(request));
    await gw.settled();
    expect(warnings).toEqual([
      { event: 'metering.failed', method: 'stream', error: 'TypeError' },
      { event: 'metering.failed', method: 'stream', error: 'string' },
    ]);
  });

  it('usage with counts the price math rejects is recorded as unknown and logged, not thrown', async () => {
    const bad = { ...usage(), inputTokens: -5 } as Usage;
    const { gw, sink, warnings } = setup(
      scripted({ stream: [{ steps: [{ type: 'usage', usage: bad }] }] }),
    );
    await collect(gw.stream(request));
    await gw.settled();
    expect(sink.recorded).toEqual([]);
    expect(sink.flagged).toEqual([{ ...CTX, reason: 'no_usage_reported', tier: 'main' }]);
    expect(warnings).toEqual([{ event: 'metering.failed', method: 'stream', error: 'RangeError' }]);
  });

  it('settled() waits for slow sink writes', async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    let done = false;
    const sink: MeterSink = {
      record: async () => {
        await gate;
        done = true;
      },
      recordUnmetered: () => Promise.resolve(),
    };
    const gw = createMeteredGateway(
      scripted({ stream: [{ steps: [{ type: 'usage', usage: usage() }] }] }),
      sink,
      CTX,
      PRICES,
    );
    await collect(gw.stream(request)); // the call finished without waiting on the sink
    expect(done).toBe(false);
    const s = gw.settled();
    release();
    await s;
    expect(done).toBe(true);
  });
});

describe('context and privacy', () => {
  it.each<Entitlement['source']>(['subscription', 'teacher_preview', 'eval'])(
    'carries source %s unchanged',
    async (source) => {
      const ctx = { ...CTX, source };
      const { gw, sink } = setup(
        scripted({ stream: [{ steps: [{ type: 'usage', usage: usage() }] }, { steps: [] }] }),
        { ctx },
      );
      await collect(gw.stream(request));
      await collect(gw.stream(request));
      await gw.settled();
      expect(sink.recorded[0]?.ctx).toEqual(ctx);
      expect(sink.flagged[0]?.source).toBe(source);
    },
  );

  it('passes only the five billing fields, and never request text, to the sink', async () => {
    const ctx = { ...CTX, note: SECRET_MESSAGE } as MeterContext;
    const { gw, sink } = setup(
      scripted({
        stream: [
          { steps: [{ type: 'usage', usage: usage() }] },
          { steps: [{ type: 'usage', usage: usage({ model: 'unpriced' }) }] },
          { steps: [] },
        ],
      }),
      { ctx },
    );
    for (let i = 0; i < 3; i++) await collect(gw.stream(request));
    await gw.settled();
    expect(Object.keys(sink.recorded[0]?.ctx ?? {}).sort()).toEqual([
      'packageId',
      'source',
      'studentId',
      'teacherId',
      'turnId',
    ]);
    const everything = JSON.stringify({ recorded: sink.recorded, flagged: sink.flagged });
    expect(everything).not.toContain(SECRET_MESSAGE);
    expect(everything).not.toContain(SECRET_SYSTEM);
    expect(everything).not.toContain('note');
  });
});
