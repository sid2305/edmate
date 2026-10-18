// Task 2.4: every provider attempt is metered once (a failed-over primary too), unknown usage is
// never free, metering never changes what the caller sees. Scripted gateways and fake adapters
// only (rule 4).
import type { Entitlement, ModelChunk, ModelGateway, Usage } from '@edmate/contracts';
import { manualClock, ScriptedGateway, type GatewayScript } from '@edmate/harness/testing';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { GatewayError } from '../../src/adapters/errors.js';
import type { ModelAdapter } from '../../src/adapters/types.js';
import {
  createMeter,
  meterAdapter,
  meterRouter,
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
  FULL_CAPABILITIES,
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

/** A gateway as a provider adapter bound to `model`. */
function asAdapter(inner: ModelGateway, model = 'priced-model'): ModelAdapter {
  return {
    id: 'anthropic',
    model,
    capabilities: FULL_CAPABILITIES,
    stream: (r) => inner.stream(r),
    generateObject: (r, schema) => inner.generateObject(r, schema),
    embed: (texts) => inner.embed(texts),
  };
}

/** Plain gateways are served as one adapter on both tiers. */
function routerOf(inner: ModelGateway | Router): Router {
  if (inner instanceof Router) return inner;
  const a = asAdapter(inner);
  return new Router({ tiers: { small: a, main: a } });
}

function setup(inner: ModelGateway | Router, opts: { fail?: boolean; ctx?: MeterContext } = {}) {
  const sink = recordingSink(opts.fail);
  const warnings: MeteringWarning[] = [];
  const gw = meterRouter(routerOf(inner), sink, opts.ctx ?? CTX, PRICES, {
    warn: (w) => warnings.push(w),
  });
  return { gw, sink, warnings };
}

const unknownRow = (tier: Usage['tier'], model: string) => ({
  ...CTX,
  reason: 'no_usage_reported',
  tier,
  model,
});

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
    expect(sink.flagged).toEqual([unknownRow('main', 'fake-model')]);
    expect(sink.flagged[0]).not.toHaveProperty('tokens');
  });

  it('records a flagged unknown row when the stream completes with no usage chunk', async () => {
    const { gw, sink } = setup(scripted({ stream: [{ steps: [text('hi')] }] }));
    expect(await collect(gw.stream(req({ tier: 'small' })))).toEqual([text('hi')]);
    await gw.settled();
    expect(sink.recorded).toEqual([]);
    expect(sink.flagged).toEqual([unknownRow('small', 'priced-model')]);
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
    const gw = meterRouter(
      routerOf(
        scripted({ stream: [{ steps: [{ type: 'usage', usage: usage({ model: 'nope' }) }] }] }),
      ),
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

  it('a router failover meters both attempts: the failed primary as unknown, the fallback priced', async () => {
    const http5xx = new GatewayError('provider_error', true, 'anthropic', 'anthropic: HTTP 503');
    const fallback = fakeAdapter({
      id: 'openai-compatible',
      model: 'backup-model',
      script: { stream: [{ steps: [text('ok'), { type: 'usage', usage: usage() }] }] },
    });
    const primary = failingAdapter(http5xx, { model: 'primary-model' });
    const router = new Router({ tiers: { small: primary, main: primary }, fallback });
    const { gw, sink } = setup(router);
    expect(await collect(gw.stream(request))).toEqual([
      text('ok'),
      { type: 'usage', usage: usage() },
    ]);
    await gw.settled();
    expect(sink.flagged).toEqual([unknownRow('main', 'primary-model')]);
    expect(sink.recorded).toEqual([{ u: { ...usage(), costMicroUsd: 33_000 }, ctx: CTX }]);
  });

  it('a primary that streamed usage and then failed over keeps its priced row', async () => {
    // The router only fails over before any chunk; a usage chunk is a chunk, so this is one row.
    const err = new GatewayError('provider_error', true, 'anthropic', 'anthropic: reset');
    const primary = asAdapter(
      {
        async *stream() {
          yield { type: 'usage', usage: usage({ inputTokens: 1, outputTokens: 1 }) };
          throw err;
        },
        generateObject: () => Promise.reject(new Error('unused')),
        embed: () => Promise.reject(new Error('unused')),
      },
      'priced-model',
    );
    const fallback = fakeAdapter({ model: 'backup-model', script: { stream: [{ steps: [] }] } });
    const { gw, sink } = setup(new Router({ tiers: { small: primary, main: primary }, fallback }));
    const { err: got } = await collectUntilError(gw.stream(request));
    await gw.settled();
    expect(got).toBe(err);
    expect(sink.recorded).toHaveLength(1);
    expect(sink.recorded[0]?.u.costMicroUsd).toBe(18);
    expect(sink.flagged).toEqual([]);
    expect(fallback.calls.stream).toBe(0);
  });

  it('generateObject and embed failovers meter both attempts', async () => {
    const http5xx = new GatewayError('provider_error', true, 'anthropic', 'anthropic: HTTP 503');
    const primary = failingAdapter(http5xx, { model: 'primary-model' });
    const fallback = fakeAdapter({
      model: 'backup-model',
      script: { generateObject: [{ value: { intent: 'q' } }], embed: [{ vectors: [[1]] }] },
    });
    const { gw, sink } = setup(new Router({ tiers: { small: primary, main: primary }, fallback }));
    expect(
      await gw.generateObject(req({ tier: 'small' }), z.object({ intent: z.string() })),
    ).toEqual({
      intent: 'q',
    });
    expect(await gw.embed(['x'])).toEqual([[1]]);
    await gw.settled();
    expect(sink.flagged).toEqual([
      unknownRow('small', 'primary-model'),
      unknownRow('small', 'backup-model'),
      unknownRow('main', 'primary-model'),
      unknownRow('main', 'backup-model'),
    ]);
  });

  it('a request the router refuses before any provider call writes no row', async () => {
    const noTools = fakeAdapter({ capabilities: { tools: false } });
    const { gw, sink } = setup(new Router({ tiers: { small: noTools, main: noTools } }));
    const tool = { name: 'check_answer', description: 'Check', inputSchema: {} };
    const { err } = await collectUntilError(gw.stream(req({ tools: [tool] })));
    await gw.settled();
    expect(err).toBeInstanceOf(GatewayError);
    expect(noTools.calls.stream).toBe(0);
    expect(sink.flagged).toEqual([]);
    expect(sink.recorded).toEqual([]);
  });

  it('meterAdapter and createMeter compose by hand, sharing one settled()', async () => {
    const sink = recordingSink();
    const meter = createMeter(sink, CTX, PRICES, { warn: () => undefined });
    const a = meterAdapter(
      fakeAdapter({ model: 'm1', script: { stream: [{ steps: [text('x')] }] } }),
      meter,
    );
    expect(a.model).toBe('m1');
    expect(a.id).toBe('anthropic');
    expect(a.capabilities).toEqual(FULL_CAPABILITIES);
    await collect(a.stream(request));
    await meter.settled();
    expect(sink.flagged).toEqual([unknownRow('main', 'm1')]);
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
    expect(sink.flagged).toEqual([unknownRow('small', 'priced-model')]);
  });

  it('generateObject: a failing call is recorded as unknown and its error is unchanged', async () => {
    const err = new GatewayError('provider_error', false, 'anthropic', 'anthropic: bad');
    const { gw, sink } = setup(
      new Router({ tiers: { small: failingAdapter(err), main: failingAdapter(err) } }),
    );
    await expect(gw.generateObject(request, schema)).rejects.toBe(err);
    await gw.settled();
    expect(sink.flagged).toEqual([unknownRow('main', 'fake-model')]);
  });

  it('embed: returns vectors unchanged and records unknown usage on the main tier', async () => {
    const vectors = [[0.1, 0.2]];
    const { gw, sink } = setup(scripted({ embed: [{ vectors }] }));
    expect(await gw.embed(['some chunk'])).toEqual(vectors);
    await gw.settled();
    expect(sink.flagged).toEqual([unknownRow('main', 'priced-model')]);
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
    const gw = meterRouter(
      routerOf(
        scripted({ stream: [{ steps: [{ type: 'usage', usage: usage() }] }, { steps: [] }] }),
      ),
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
    expect(sink.flagged).toEqual([unknownRow('main', 'priced-model')]);
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
    const gw = meterRouter(
      routerOf(scripted({ stream: [{ steps: [{ type: 'usage', usage: usage() }] }] })),
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
