// Task 2.3 accept: "a simulated 5xx fails over within one retry." Fake adapters only (rule 4).
import {
  scriptedEmbedPair,
  scriptedObjectIntent,
  scriptedStreamProviderError,
  scriptedStreamText,
} from '@edmate/harness/testing';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { GatewayError } from '../../src/adapters/errors.js';
import { missingCapability, Router } from '../../src/router/router.js';
import {
  collect,
  collectUntilError,
  failingAdapter,
  fakeAdapter,
  req,
  text,
} from './fake-adapter.js';

const intentSchema = z.object({ intent: z.string() });
const tool = { name: 'check_answer', description: 'Check an answer', inputSchema: {} };

const http5xx = () =>
  new GatewayError('provider_error', true, 'anthropic', 'anthropic: provider error (HTTP 503)');
const stopped = (reason: 'truncated' | 'content_filter') =>
  new GatewayError('provider_error', false, 'anthropic', `anthropic: ${reason}`, reason);

const backupStream = () =>
  fakeAdapter({
    id: 'openai-compatible',
    model: 'backup',
    script: { stream: [{ steps: [text('from backup')] }] },
  });

describe('Router: tier selection', () => {
  it('sends tier small to the small adapter and main to the main adapter', async () => {
    const small = fakeAdapter({ script: { stream: [{ steps: [text('small')] }] } });
    const main = fakeAdapter({ script: { stream: [{ steps: [text('main')] }] } });
    const router = new Router({ tiers: { small, main } });

    expect(await collect(router.stream(req({ tier: 'small' })))).toEqual([text('small')]);
    expect(main.calls.stream).toBe(0);
    expect(await collect(router.stream(req({ tier: 'main' })))).toEqual([text('main')]);
    expect(small.calls.stream).toBe(1);
    expect(main.calls.stream).toBe(1);
  });

  it('per-agent override: two policies route the same tier to their own adapters', async () => {
    const a = fakeAdapter({ script: { stream: [{ steps: [text('agent A')] }] } });
    const b = fakeAdapter({ script: { stream: [{ steps: [text('agent B')] }] } });
    const shared = fakeAdapter();
    const routerA = new Router({ tiers: { small: shared, main: a } });
    const routerB = new Router({ tiers: { small: shared, main: b } });

    expect(await collect(routerA.stream(req()))).toEqual([text('agent A')]);
    expect(await collect(routerB.stream(req()))).toEqual([text('agent B')]);
    expect([a.calls.stream, b.calls.stream, shared.calls.stream]).toEqual([1, 1, 0]);
  });

  it('passes every chunk through unchanged, usage included', async () => {
    const main = fakeAdapter({ script: { stream: [scriptedStreamText] } });
    const router = new Router({ tiers: { small: fakeAdapter(), main } });
    expect(await collect(router.stream(req()))).toEqual(scriptedStreamText.steps);
  });

  it('is deterministic: the same policy and scripts give the same chunks', async () => {
    const run = () => {
      const main = failingAdapter(http5xx());
      const fallback = fakeAdapter({ script: { stream: [scriptedStreamText] } });
      return collect(new Router({ tiers: { small: main, main }, fallback }).stream(req()));
    };
    expect(await run()).toEqual(await run());
  });
});

describe('Router.stream: fallback', () => {
  it('a simulated 5xx before any chunk fails over within one retry', async () => {
    const primary = failingAdapter(http5xx());
    const fallback = backupStream();
    const router = new Router({ tiers: { small: fakeAdapter(), main: primary }, fallback });

    expect(await collect(router.stream(req()))).toEqual([text('from backup')]);
    expect(primary.calls.stream).toBe(1);
    expect(fallback.calls.stream).toBe(1);
  });

  it('a scripted retryable error with nothing streamed also fails over', async () => {
    const primary = fakeAdapter({
      script: { stream: [{ steps: [{ type: 'error', code: 'rate_limited' }] }] },
      retryableOnError: true,
    });
    const fallback = backupStream();
    const router = new Router({ tiers: { small: primary, main: primary }, fallback });

    expect(await collect(router.stream(req({ tier: 'small' })))).toEqual([text('from backup')]);
    expect(fallback.calls.stream).toBe(1);
  });

  it('never falls back once a chunk reached the caller, even on a retryable error', async () => {
    const primary = fakeAdapter({
      script: { stream: [scriptedStreamProviderError] },
      retryableOnError: true,
    });
    const fallback = backupStream();
    const router = new Router({ tiers: { small: fakeAdapter(), main: primary }, fallback });

    const { seen, err } = await collectUntilError(router.stream(req()));
    expect(seen).toEqual([text('Partial')]);
    expect(err).toBeInstanceOf(GatewayError);
    expect((err as GatewayError).retryable).toBe(true);
    expect(fallback.calls.stream).toBe(0);
  });

  it.each(['truncated', 'content_filter'] as const)(
    'never falls back on %s, even with nothing streamed',
    async (reason) => {
      const failure = stopped(reason);
      const fallback = backupStream();
      const router = new Router({
        tiers: { small: fakeAdapter(), main: failingAdapter(failure) },
        fallback,
      });

      const { seen, err } = await collectUntilError(router.stream(req()));
      expect(seen).toEqual([]);
      expect(err).toBe(failure);
      expect(fallback.calls.stream).toBe(0);
    },
  );

  it('never falls back on a truncated stream after partial output', async () => {
    const primary = fakeAdapter({
      script: { stream: [scriptedStreamProviderError] },
      retryableOnError: false,
      reason: 'truncated',
    });
    const fallback = backupStream();
    const router = new Router({ tiers: { small: fakeAdapter(), main: primary }, fallback });

    const { seen, err } = await collectUntilError(router.stream(req()));
    expect(seen).toEqual([text('Partial')]);
    expect((err as GatewayError).reason).toBe('truncated');
    expect(fallback.calls.stream).toBe(0);
  });

  it('never falls back on an error that is not a GatewayError', async () => {
    const failure = new Error('bug');
    const fallback = backupStream();
    const router = new Router({
      tiers: { small: fakeAdapter(), main: failingAdapter(failure) },
      fallback,
    });
    expect((await collectUntilError(router.stream(req()))).err).toBe(failure);
    expect(fallback.calls.stream).toBe(0);
  });

  it('with no fallback configured, a retryable failure propagates unchanged', async () => {
    const failure = http5xx();
    const router = new Router({ tiers: { small: fakeAdapter(), main: failingAdapter(failure) } });
    expect((await collectUntilError(router.stream(req()))).err).toBe(failure);
  });

  it('when the fallback also fails, its error propagates and there is no third attempt', async () => {
    const primary = failingAdapter(http5xx());
    const second = new GatewayError('rate_limited', true, 'openai-compatible', 'backup: 429');
    const fallback = failingAdapter(second, { id: 'openai-compatible' });
    const router = new Router({ tiers: { small: fakeAdapter(), main: primary }, fallback });

    expect((await collectUntilError(router.stream(req()))).err).toBe(second);
    expect(primary.calls.stream).toBe(1);
    expect(fallback.calls.stream).toBe(1);
  });

  it('when the fallback also fails, both errors are visible: the primary is its cause', async () => {
    const first = http5xx();
    const second = new GatewayError('rate_limited', true, 'openai-compatible', 'backup: 429');
    const router = new Router({
      tiers: { small: fakeAdapter(), main: failingAdapter(first) },
      fallback: failingAdapter(second, { id: 'openai-compatible' }),
    });

    const { err } = await collectUntilError(router.stream(req()));
    expect(err).toBe(second);
    expect((err as Error).cause).toBe(first);
    // Both are scrubbed GatewayErrors; toJSON still carries only the fallback's own fields.
    expect(JSON.stringify(err)).not.toContain('cause');
  });

  it('a fallback error that already has a cause keeps it', async () => {
    const own = new Error('inner');
    const second = new Error('backup broke', { cause: own });
    const router = new Router({
      tiers: { small: fakeAdapter(), main: failingAdapter(http5xx()) },
      fallback: failingAdapter(second),
    });
    const { err } = await collectUntilError(router.stream(req()));
    expect(err).toBe(second);
    expect((err as Error).cause).toBe(own);
  });

  it('a fallback that throws a non-Error value propagates it as is', async () => {
    const fallback = fakeAdapter();
    const router = new Router({
      tiers: { small: fakeAdapter(), main: failingAdapter(http5xx()) },
      fallback: {
        ...fallback,
        stream: () => ({
          [Symbol.asyncIterator]: () => ({ next: () => Promise.reject('plain string') }),
        }),
      },
    });
    expect((await collectUntilError(router.stream(req()))).err).toBe('plain string');
  });

  it('the same error object from both adapters never becomes its own cause', async () => {
    const shared = http5xx();
    const router = new Router({
      tiers: { small: fakeAdapter(), main: failingAdapter(shared) },
      fallback: failingAdapter(shared),
    });
    const { err } = await collectUntilError(router.stream(req()));
    expect(err).toBe(shared);
    expect((err as Error).cause).toBeUndefined();
  });

  it('a lone primary failure gets no cause added', async () => {
    const failure = http5xx();
    const router = new Router({ tiers: { small: fakeAdapter(), main: failingAdapter(failure) } });
    const { err } = await collectUntilError(router.stream(req()));
    expect(err).toBe(failure);
    expect((err as Error).cause).toBeUndefined();
  });

  it('skips a fallback that lacks a needed capability and rethrows the primary error', async () => {
    const failure = http5xx();
    const fallback = fakeAdapter({ capabilities: { tools: false } });
    const router = new Router({
      tiers: { small: fakeAdapter(), main: failingAdapter(failure) },
      fallback,
    });
    expect((await collectUntilError(router.stream(req({ tools: [tool] })))).err).toBe(failure);
    expect(fallback.calls.stream).toBe(0);
  });
});

describe('Router: capability pre-check', () => {
  it('tools: throws validation on iteration without calling an adapter that cannot use tools', async () => {
    const main = fakeAdapter({ model: 'no-tools', capabilities: { tools: false } });
    const fallback = backupStream();
    const router = new Router({ tiers: { small: fakeAdapter(), main }, fallback });

    // Same convention as every adapter: stream() never throws at call time.
    const iterable = router.stream(req({ tools: [tool] }));
    expect(main.calls.stream).toBe(0);
    const { seen, err } = await collectUntilError(iterable);
    expect(seen).toEqual([]);
    expect(err).toBeInstanceOf(GatewayError);
    expect((err as GatewayError).code).toBe('validation');
    expect((err as GatewayError).retryable).toBe(false);
    expect((err as GatewayError).message).toBe(
      'anthropic/no-tools: no tools support for this request',
    );
    expect(main.calls.stream).toBe(0);
    expect(fallback.calls.stream).toBe(0);
  });

  it('tools: a request without tools, or with an empty list, is unaffected', async () => {
    const main = fakeAdapter({
      capabilities: { tools: false },
      script: { stream: [{ steps: [text('a')] }, { steps: [text('b')] }] },
    });
    const router = new Router({ tiers: { small: fakeAdapter(), main } });
    expect(await collect(router.stream(req()))).toEqual([text('a')]);
    expect(await collect(router.stream(req({ tools: [] })))).toEqual([text('b')]);
  });

  it('json: generateObject rejects without calling an adapter without json', async () => {
    const main = fakeAdapter({ capabilities: { json: false } });
    const router = new Router({ tiers: { small: fakeAdapter(), main } });
    await expect(router.generateObject(req(), intentSchema)).rejects.toMatchObject({
      code: 'validation',
      message: 'anthropic/fake-model: no json support for this request',
    });
    expect(main.calls.generateObject).toBe(0);
  });

  it('tools: generateObject with tools also needs tool support', async () => {
    const main = fakeAdapter({ capabilities: { tools: false } });
    const router = new Router({ tiers: { small: fakeAdapter(), main } });
    await expect(router.generateObject(req({ tools: [tool] }), intentSchema)).rejects.toMatchObject(
      { code: 'validation' },
    );
    expect(main.calls.generateObject).toBe(0);
  });

  it('embeddings: embed rejects without calling an adapter without embeddings', async () => {
    const main = fakeAdapter({ capabilities: { embeddings: false } });
    const fallback = fakeAdapter({ script: { embed: [scriptedEmbedPair] } });
    const router = new Router({ tiers: { small: fakeAdapter(), main }, fallback });
    await expect(router.embed(['a', 'b'])).rejects.toMatchObject({
      code: 'validation',
      message: 'anthropic/fake-model: no embeddings support for this request',
    });
    expect(main.calls.embed).toBe(0);
    expect(fallback.calls.embed).toBe(0);
  });
});

describe('Router.generateObject: fallback', () => {
  it('serves from the tier adapter when it succeeds', async () => {
    const small = fakeAdapter({ script: { generateObject: [scriptedObjectIntent] } });
    const router = new Router({ tiers: { small, main: fakeAdapter() } });
    expect(await router.generateObject(req({ tier: 'small' }), intentSchema)).toEqual({
      intent: 'question',
    });
  });

  it('a retryable failure fails over within one retry', async () => {
    const primary = failingAdapter(http5xx());
    const fallback = fakeAdapter({ script: { generateObject: [scriptedObjectIntent] } });
    const router = new Router({ tiers: { small: primary, main: primary }, fallback });
    expect(await router.generateObject(req(), intentSchema)).toEqual({ intent: 'question' });
    expect(primary.calls.generateObject).toBe(1);
    expect(fallback.calls.generateObject).toBe(1);
  });

  it.each(['truncated', 'content_filter'] as const)(
    'a non-retryable %s failure propagates; no fallback',
    async (reason) => {
      const failure = stopped(reason);
      const fallback = fakeAdapter({ script: { generateObject: [scriptedObjectIntent] } });
      const router = new Router({
        tiers: { small: fakeAdapter(), main: failingAdapter(failure) },
        fallback,
      });
      await expect(router.generateObject(req(), intentSchema)).rejects.toBe(failure);
      expect(fallback.calls.generateObject).toBe(0);
    },
  );

  it('with no fallback configured, a retryable failure propagates', async () => {
    const failure = http5xx();
    const router = new Router({ tiers: { small: fakeAdapter(), main: failingAdapter(failure) } });
    await expect(router.generateObject(req(), intentSchema)).rejects.toBe(failure);
  });

  it('when the fallback also fails, its error propagates', async () => {
    const second = http5xx();
    const fallback = failingAdapter(second);
    const router = new Router({
      tiers: { small: fakeAdapter(), main: failingAdapter(http5xx()) },
      fallback,
    });
    await expect(router.generateObject(req(), intentSchema)).rejects.toBe(second);
    expect(fallback.calls.generateObject).toBe(1);
  });

  it('when the fallback also fails, the primary error is kept as its cause', async () => {
    const first = http5xx();
    const second = http5xx();
    const router = new Router({
      tiers: { small: fakeAdapter(), main: failingAdapter(first) },
      fallback: failingAdapter(second),
    });
    const err = await router.generateObject(req(), intentSchema).catch((e: unknown) => e);
    expect(err).toBe(second);
    expect((err as Error).cause).toBe(first);
  });

  it('skips a fallback without json support', async () => {
    const failure = http5xx();
    const fallback = fakeAdapter({ capabilities: { json: false } });
    const router = new Router({
      tiers: { small: fakeAdapter(), main: failingAdapter(failure) },
      fallback,
    });
    await expect(router.generateObject(req(), intentSchema)).rejects.toBe(failure);
    expect(fallback.calls.generateObject).toBe(0);
  });
});

describe('Router.embed: fallback', () => {
  it('serves from the main tier adapter', async () => {
    const main = fakeAdapter({ script: { embed: [scriptedEmbedPair] } });
    const small = fakeAdapter();
    const router = new Router({ tiers: { small, main } });
    expect(await router.embed(['a', 'b'])).toEqual(scriptedEmbedPair.vectors);
    expect(small.calls.embed).toBe(0);
  });

  it('a retryable failure fails over within one retry', async () => {
    const primary = failingAdapter(http5xx());
    const fallback = fakeAdapter({ script: { embed: [scriptedEmbedPair] } });
    const router = new Router({ tiers: { small: fakeAdapter(), main: primary }, fallback });
    expect(await router.embed(['a', 'b'])).toEqual(scriptedEmbedPair.vectors);
    expect(primary.calls.embed).toBe(1);
    expect(fallback.calls.embed).toBe(1);
  });

  it('a non-retryable failure propagates; no fallback', async () => {
    const failure = new GatewayError('validation', false, 'anthropic', 'anthropic: rejected');
    const fallback = fakeAdapter({ script: { embed: [scriptedEmbedPair] } });
    const router = new Router({
      tiers: { small: fakeAdapter(), main: failingAdapter(failure) },
      fallback,
    });
    await expect(router.embed(['a'])).rejects.toBe(failure);
    expect(fallback.calls.embed).toBe(0);
  });

  it('with no fallback configured, a retryable failure propagates', async () => {
    const failure = http5xx();
    const router = new Router({ tiers: { small: fakeAdapter(), main: failingAdapter(failure) } });
    await expect(router.embed(['a'])).rejects.toBe(failure);
  });

  it('when the fallback also fails, the primary error is kept as its cause', async () => {
    const first = http5xx();
    const second = http5xx();
    const router = new Router({
      tiers: { small: fakeAdapter(), main: failingAdapter(first) },
      fallback: failingAdapter(second),
    });
    const err = await router.embed(['a']).catch((e: unknown) => e);
    expect(err).toBe(second);
    expect((err as Error).cause).toBe(first);
  });

  it('skips a fallback without embeddings', async () => {
    const failure = http5xx();
    const fallback = fakeAdapter({ capabilities: { embeddings: false } });
    const router = new Router({
      tiers: { small: fakeAdapter(), main: failingAdapter(failure) },
      fallback,
    });
    await expect(router.embed(['a'])).rejects.toBe(failure);
    expect(fallback.calls.embed).toBe(0);
  });
});

describe('missingCapability', () => {
  const none = { tools: false, json: false, embeddings: false, vision: false };

  it('vision: reports a missing vision capability (no call site needs it yet)', () => {
    const blind = fakeAdapter({ capabilities: { vision: false } });
    const sighted = fakeAdapter({ capabilities: { vision: true } });
    expect(missingCapability(blind, { ...none, vision: true })).toBe('vision');
    expect(missingCapability(sighted, { ...none, vision: true })).toBeUndefined();
  });

  it('nothing needed: any adapter can serve', () => {
    const bare = fakeAdapter({ capabilities: none });
    expect(missingCapability(bare, none)).toBeUndefined();
  });
});

describe('package entry', () => {
  it('exports the router from @edmate/gateway', async () => {
    const entry = await import('../../src/index.js');
    expect(entry.Router).toBe(Router);
    expect(typeof entry.createRouter).toBe('function');
    expect(entry.DEFAULT_MODEL_POLICY.tiers.main?.provider).toBe('anthropic');
  });
});

describe('Router.withAdapters (task 2.4: metering wraps each provider attempt)', () => {
  it('returns a new router over mapped adapters, mapping a shared adapter once', async () => {
    const shared = fakeAdapter({ model: 'shared', script: { stream: [{ steps: [text('a')] }] } });
    const backup = backupStream();
    const router = new Router({ tiers: { small: shared, main: shared }, fallback: backup });
    const seen: string[] = [];
    const mapped = router.withAdapters((a) => {
      seen.push(a.model);
      return a;
    });
    expect(mapped).not.toBe(router);
    expect(seen).toEqual(['shared', 'backup']);
    expect(await collect(mapped.stream(req()))).toEqual([text('a')]);
  });

  it('works without a fallback', () => {
    const seen: string[] = [];
    const small = fakeAdapter();
    const main = fakeAdapter({ model: 'other' });
    new Router({ tiers: { small, main } }).withAdapters((x) => {
      seen.push(x.model);
      return x;
    });
    expect(seen).toEqual(['fake-model', 'other']);
  });
});
