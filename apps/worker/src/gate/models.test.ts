import type { ModelChunk, ModelRequest } from '@edmate/contracts';
import { loadBundledPrices, type ModelAdapter, type ProviderAdapterFactories } from '@edmate/gateway';
import { MODEL_MIX } from '@edmate/gateway';
import { describe, expect, it } from 'vitest';
import {
  gateGatewayFor,
  gateJudgeGateway,
  gateModelsFromEnv,
  gatePriceUsage,
  type GateModels,
} from './models.js';
import { gateUsageMeter } from './ports.js';

// Never a real key and never a real call: adapters are built but nothing is sent (rule 4).
const KEY = { EDMATE_ANTHROPIC_API_KEY: 'test-only-not-a-key' };
const JUDGE = { EDMATE_JUDGE_MODEL: 'anthropic:claude-sonnet-5' };

describe('gateModelsFromEnv (fails closed)', () => {
  it('a key and a pinned anthropic judge: available', async () => {
    const r = await gateModelsFromEnv({ ...KEY, ...JUDGE });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.models.judge).toEqual({ provider: 'anthropic', model: 'claude-sonnet-5' });
    expect(r.models.factories.anthropic?.('claude-haiku-4-5').model).toBe('claude-haiku-4-5');
  });

  it.each([
    ['EDMATE_DEV_MODEL=scripted', { ...KEY, ...JUDGE, EDMATE_DEV_MODEL: 'scripted' }, 'dev_model'],
    ['EDMATE_DEV_MODEL any value', { ...KEY, ...JUDGE, EDMATE_DEV_MODEL: 'x' }, 'dev_model'],
    ['no judge model', { ...KEY }, 'judge_model'],
    ['malformed judge model', { ...KEY, EDMATE_JUDGE_MODEL: 'sonnet' }, 'judge_model'],
    [
      'non-anthropic judge',
      { ...KEY, EDMATE_JUDGE_MODEL: 'openai-compatible:some-model' },
      'judge_provider',
    ],
    ['no key', { ...JUDGE }, 'provider_key'],
    ['an empty key', { ...JUDGE, EDMATE_ANTHROPIC_API_KEY: '' }, 'provider_key'],
  ])('%s: unavailable', async (_name, env, reason) => {
    expect(await gateModelsFromEnv(env)).toEqual({ ok: false, reason });
  });

  it('an empty EDMATE_DEV_MODEL is off', async () => {
    expect((await gateModelsFromEnv({ ...KEY, ...JUDGE, EDMATE_DEV_MODEL: ' ' })).ok).toBe(true);
  });
});

/** A fake provider adapter that streams one reply and reports usage for its model. */
function fakeAdapter(model: string, seen: string[]): ModelAdapter {
  return {
    id: 'anthropic',
    model,
    capabilities: {
      tools: false,
      streaming: true,
      json: true,
      vision: false,
      embeddings: false,
      maxContextTokens: 1000,
    },
    stream(req: ModelRequest): AsyncIterable<ModelChunk> {
      seen.push(`${req.tier}:${model}`);
      return (async function* stream(): AsyncGenerator<ModelChunk> {
        yield { type: 'text', text: 'ok' };
        yield {
          type: 'usage',
          usage: { model, tier: req.tier, inputTokens: 1000, outputTokens: 1000, costMicroUsd: 0 },
        };
      })();
    },
    generateObject: () => Promise.reject(new Error('unused')),
    embed: () => Promise.reject(new Error('unused')),
  };
}

function models(seen: string[]): GateModels {
  const factories: ProviderAdapterFactories = { anthropic: (m: string) => fakeAdapter(m, seen) };
  return { factories, judge: { provider: 'anthropic', model: 'claude-sonnet-5' }, prices: loadBundledPrices() };
}

async function drain(stream: AsyncIterable<ModelChunk>): Promise<void> {
  for await (const chunk of stream) {
    void chunk;
  }
}

const req = (tier: 'small' | 'main'): ModelRequest => ({
  tier,
  system: 's',
  messages: [{ role: 'user', content: 'hi' }],
  maxOutputTokens: 10,
});

describe('gate gateways', () => {
  it('turns follow the pinned policy (B-42 mix) and are metered into the run meter', async () => {
    const seen: string[] = [];
    const meter = gateUsageMeter();
    const turn = gateGatewayFor(models(seen), meter)({
      policy: MODEL_MIX.paid,
      billing: { teacherId: 't', packageId: 'p', studentId: 's', turnId: 'u', source: 'eval' },
    });
    expect(turn.metered).toBe(true);
    await drain(turn.gateway.stream(req('main')));
    await drain(turn.gateway.stream(req('small')));
    expect(seen).toEqual(['main:claude-sonnet-5', 'small:claude-haiku-4-5']);
    const totals = meter.totals();
    expect(totals.calls).toBe(2);
    expect(totals.costMicroUsd).toBeGreaterThan(0);
    expect(totals.unmetered).toBe(0);
  });

  it('an unpriced model is counted as unmetered, never as free', async () => {
    const seen: string[] = [];
    const meter = gateUsageMeter();
    const turn = gateGatewayFor(models(seen), meter)({
      policy: { tiers: { small: { provider: 'anthropic', model: 'no-price' }, main: { provider: 'anthropic', model: 'no-price' } } },
      billing: { teacherId: 't', packageId: 'p', studentId: 's', turnId: 'u', source: 'eval' },
    });
    await drain(turn.gateway.stream(req('main')));
    expect(meter.totals()).toEqual({
      calls: 0,
      costMicroUsd: 0,
      unmetered: 1,
      unmeteredReasons: ['unpriced_model:no-price'],
    });
  });

  it('the judge runs the pinned judge model on either tier, metered into the same meter', async () => {
    const seen: string[] = [];
    const meter = gateUsageMeter();
    const judge = gateJudgeGateway(models(seen), meter, { teacherId: 't', packageId: 'p' });
    await drain(judge.stream(req('small')));
    expect(seen).toEqual(['small:claude-sonnet-5']);
    expect(meter.totals().calls).toBe(1);
  });

  it('priceUsage prices a known model and leaves an unknown one unpriced', () => {
    const price = gatePriceUsage(models([]));
    const u = { model: 'claude-haiku-4-5', tier: 'small' as const, inputTokens: 10, outputTokens: 10, costMicroUsd: 0 };
    expect(price(u)).toBeGreaterThan(0);
    expect(price({ ...u, model: 'no-price' })).toBeUndefined();
  });
});
