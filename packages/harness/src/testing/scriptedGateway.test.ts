import type { ModelChunk, ModelRequest } from '@edmate/contracts';
import {
  modelChunkText,
  modelChunkToolCall,
  modelChunkUsage,
  modelRequestMinimal,
  usageSmall,
} from '@edmate/contracts/fixtures';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { manualClock } from './clock.js';
import { scriptedStreamText, scriptedStreamToolCall } from './gatewayFixtures.js';
import {
  type GatewayScript,
  ScriptedGateway,
  ScriptedGatewayError,
  ScriptedProviderError,
} from './scriptedGateway.js';

const req = (over: Partial<ModelRequest> = {}): ModelRequest => ({
  ...modelRequestMinimal,
  ...over,
});

async function collect(stream: AsyncIterable<ModelChunk>): Promise<ModelChunk[]> {
  const out: ModelChunk[] = [];
  for await (const c of stream) out.push(c);
  return out;
}

async function catchError(fn: () => Promise<unknown>): Promise<unknown> {
  try {
    await fn();
  } catch (e) {
    return e;
  }
  throw new Error('expected a throw');
}

const text = (t: string): ModelChunk => ({ type: 'text', text: t });

describe('ScriptedGateway.stream', () => {
  it('is deterministic: the same script through two instances gives identical chunks', async () => {
    const script: GatewayScript = { stream: [scriptedStreamToolCall, scriptedStreamText] };
    const run = async () => {
      const gw = new ScriptedGateway(script, manualClock());
      return [...(await collect(gw.stream(req()))), ...(await collect(gw.stream(req())))];
    };
    const a = await run();
    const b = await run();
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    expect(a.map((c) => c.type)).toEqual(['tool_call', 'text', 'usage', 'text', 'text', 'usage']);
  });

  it('replays text and usage chunks unchanged', async () => {
    const steps: ModelChunk[] = [modelChunkText, text('?'), modelChunkUsage];
    const gw = new ScriptedGateway({ stream: [{ steps }] }, manualClock());
    expect(await collect(gw.stream(req()))).toEqual(steps);
  });

  it('replays tool calls with id, name and args intact', async () => {
    const gw = new ScriptedGateway({ stream: [{ steps: [modelChunkToolCall] }] }, manualClock());
    const [chunk] = await collect(gw.stream(req()));
    expect(chunk).toEqual({
      type: 'tool_call',
      id: 'call_test_01',
      name: 'calculator',
      args: { expression: '1/2 + 1/3' },
    });
  });

  it('honours delay steps through the injected clock, not a real timer', async () => {
    const clock = manualClock();
    const gw = new ScriptedGateway(
      { stream: [{ steps: [modelChunkText, { type: 'delay', ms: 5000 }, modelChunkUsage] }] },
      clock,
    );
    const started = Date.now();
    const chunks = await collect(gw.stream(req()));
    expect(Date.now() - started).toBeLessThan(1_000);
    expect(clock.sleeps).toEqual([5000]);
    expect(chunks).toEqual([modelChunkText, modelChunkUsage]);
  });

  it('yields earlier chunks and then throws on an error step', async () => {
    const gw = new ScriptedGateway(
      {
        stream: [
          { steps: [modelChunkText, { type: 'error', code: 'provider_error' }, modelChunkUsage] },
        ],
      },
      manualClock(),
    );
    const seen: ModelChunk[] = [];
    const err = await catchError(async () => {
      for await (const c of gw.stream(req())) seen.push(c);
    });
    expect(seen).toEqual([modelChunkText]);
    expect(err).toBeInstanceOf(ScriptedProviderError);
    expect((err as ScriptedProviderError).code).toBe('provider_error');
    expect((err as Error).message).toContain('provider_error');
  });

  it('uses a scripted error message when given', async () => {
    const gw = new ScriptedGateway(
      {
        stream: [
          { steps: [{ type: 'error', code: 'rate_limited', message: '429 from provider' }] },
        ],
      },
      manualClock(),
    );
    const err = await catchError(() => collect(gw.stream(req())));
    expect((err as ScriptedProviderError).code).toBe('rate_limited');
    expect((err as Error).message).toBe('429 from provider');
  });

  it('consumes plain entries in order', async () => {
    const gw = new ScriptedGateway(
      { stream: [{ steps: [text('one')] }, { steps: [text('two')] }] },
      manualClock(),
    );
    expect(await collect(gw.stream(req()))).toEqual([text('one')]);
    expect(await collect(gw.stream(req()))).toEqual([text('two')]);
  });

  it('matches by predicate regardless of concurrent call order', async () => {
    const gw = new ScriptedGateway(
      {
        stream: [
          { match: (r) => r.tier === 'small', steps: [text('small')] },
          { match: (r) => r.tier === 'main', steps: [text('main')] },
        ],
      },
      manualClock(),
    );
    const [main, small] = await Promise.all([
      collect(gw.stream(req({ tier: 'main' }))),
      collect(gw.stream(req({ tier: 'small' }))),
    ]);
    expect(main).toEqual([text('main')]);
    expect(small).toEqual([text('small')]);
  });

  it('mixes predicate and plain entries deterministically', async () => {
    const gw = new ScriptedGateway(
      {
        stream: [
          { steps: [text('plain-1')] },
          { match: (r) => r.tier === 'small', steps: [text('small')] },
          { steps: [text('plain-2')] },
        ],
      },
      manualClock(),
    );
    expect(await collect(gw.stream(req({ tier: 'small' })))).toEqual([text('small')]);
    expect(await collect(gw.stream(req({ tier: 'main' })))).toEqual([text('plain-1')]);
    expect(await collect(gw.stream(req({ tier: 'main' })))).toEqual([text('plain-2')]);
  });

  it('matches a stream call when stream() is called, not when it is first iterated', async () => {
    const gw = new ScriptedGateway(
      { stream: [{ steps: [text('first')] }, { steps: [text('second')] }] },
      manualClock(),
    );
    const s1 = gw.stream(req());
    const s2 = gw.stream(req());
    expect(await collect(s2)).toEqual([text('second')]);
    expect(await collect(s1)).toEqual([text('first')]);
  });

  it('throws ScriptedGatewayError naming the method and index when the queue is exhausted', async () => {
    const gw = new ScriptedGateway(
      { stream: [scriptedStreamText, scriptedStreamText] },
      manualClock(),
    );
    await collect(gw.stream(req()));
    await collect(gw.stream(req()));
    const err = await catchError(() => collect(gw.stream(req())));
    expect(err).toBeInstanceOf(ScriptedGatewayError);
    const e = err as ScriptedGatewayError;
    expect(e.method).toBe('stream');
    expect(e.callIndex).toBe(2);
    expect(e.request).toBeUndefined();
    expect(e.message).toContain('stream');
    expect(e.message).toContain('call 2');
  });

  it('throws with a redacted request snapshot when no predicate matches', async () => {
    const gw = new ScriptedGateway(
      { stream: [{ match: (r) => r.tier === 'small', steps: [] }] },
      manualClock(),
    );
    const err = await catchError(() =>
      collect(
        gw.stream(
          req({
            tier: 'main',
            system: 'S'.repeat(200),
            messages: [{ role: 'user', content: 'secret-ish' }],
          }),
        ),
      ),
    );
    expect(err).toBeInstanceOf(ScriptedGatewayError);
    const e = err as ScriptedGatewayError;
    expect(e.callIndex).toBe(0);
    expect(e.request).toEqual({ tier: 'main', system: 'S'.repeat(80), messageCount: 1 });
    expect(e.message).not.toContain('secret-ish');
  });

  it('works with a script that omits stream entirely', async () => {
    const gw = new ScriptedGateway({}, manualClock());
    const err = await catchError(() => collect(gw.stream(req())));
    expect((err as ScriptedGatewayError).method).toBe('stream');
  });

  it('does not let a later mutation of the script change replay', async () => {
    const args = { expression: '1+1', nested: [1, { deep: true }] };
    const steps: ModelChunk[] = [
      text('orig'),
      { type: 'tool_call', id: 'c1', name: 'calculator', args },
    ];
    const gw = new ScriptedGateway({ stream: [{ steps }] }, manualClock());
    steps.push(text('added'));
    args.expression = 'changed';
    (args.nested[1] as { deep: boolean }).deep = false;
    expect(await collect(gw.stream(req()))).toEqual([
      text('orig'),
      {
        type: 'tool_call',
        id: 'c1',
        name: 'calculator',
        args: { expression: '1+1', nested: [1, { deep: true }] },
      },
    ]);
  });

  it('keeps non-plain values (for example a Date in args) as they are', async () => {
    const when = new Date(0);
    const gw = new ScriptedGateway(
      { stream: [{ steps: [{ type: 'tool_call', id: 'c1', name: 'clock', args: when }] }] },
      manualClock(),
    );
    const [chunk] = await collect(gw.stream(req()));
    expect(chunk).toMatchObject({ args: when });
  });
});

describe('ScriptedGateway.generateObject', () => {
  const Intent = z.object({ intent: z.enum(['question', 'answer']) });

  it('returns the scripted value parsed with the caller schema', async () => {
    const gw = new ScriptedGateway(
      { generateObject: [{ value: { intent: 'question' } }] },
      manualClock(),
    );
    await expect(gw.generateObject(req(), Intent)).resolves.toEqual({ intent: 'question' });
  });

  it('throws a Zod error when the scripted value does not fit the schema', async () => {
    const gw = new ScriptedGateway(
      { generateObject: [{ value: { intent: 'nope' } }] },
      manualClock(),
    );
    const err = await catchError(() => gw.generateObject(req(), Intent));
    expect(err).toBeInstanceOf(z.ZodError);
  });

  it('matches by predicate and throws when exhausted', async () => {
    const gw = new ScriptedGateway(
      { generateObject: [{ match: (r) => r.tier === 'small', value: { intent: 'answer' } }] },
      manualClock(),
    );
    const miss = await catchError(() => gw.generateObject(req({ tier: 'main' }), Intent));
    expect((miss as ScriptedGatewayError).method).toBe('generateObject');
    expect((miss as ScriptedGatewayError).request).toBeDefined();
    await expect(gw.generateObject(req({ tier: 'small' }), Intent)).resolves.toEqual({
      intent: 'answer',
    });
    const done = await catchError(() => gw.generateObject(req({ tier: 'small' }), Intent));
    expect((done as ScriptedGatewayError).callIndex).toBe(2);
  });

  it('records usage per call, from attached usage and stream usage chunks', async () => {
    const gw = new ScriptedGateway(
      {
        generateObject: [{ value: { intent: 'question' }, usage: usageSmall }],
        embed: [{ vectors: [[0]], usage: usageSmall }],
        stream: [{ steps: [modelChunkUsage] }],
      },
      manualClock(),
    );
    await gw.generateObject(req(), Intent);
    await gw.embed(['x']);
    await collect(gw.stream(req()));
    expect(gw.usage).toEqual([
      { method: 'generateObject', usage: usageSmall },
      { method: 'embed', usage: usageSmall },
      { method: 'stream', usage: modelChunkUsage.usage },
    ]);
  });
});

describe('ScriptedGateway.embed', () => {
  it('returns scripted vectors in order and by predicate', async () => {
    const gw = new ScriptedGateway(
      { embed: [{ match: (t) => t[0] === 'b', vectors: [[2, 2]] }, { vectors: [[1, 1]] }] },
      manualClock(),
    );
    await expect(gw.embed(['a'])).resolves.toEqual([[1, 1]]);
    await expect(gw.embed(['b'])).resolves.toEqual([[2, 2]]);
  });

  it('throws on a predicate miss with only a count, never the texts', async () => {
    const gw = new ScriptedGateway({ embed: [{ match: () => false, vectors: [] }] }, manualClock());
    const err = await catchError(() => gw.embed(['private text', 'b']));
    const e = err as ScriptedGatewayError;
    expect(e.method).toBe('embed');
    expect(e.request).toEqual({ textCount: 2 });
    expect(e.message).not.toContain('private text');
  });

  it('throws when exhausted', async () => {
    const gw = new ScriptedGateway({}, manualClock());
    const err = await catchError(() => gw.embed([]));
    expect((err as ScriptedGatewayError).callIndex).toBe(0);
  });
});
