// createRouter resolves a ModelPolicy into a Router over adapters built once per target.
import { ModelPolicySchema, type ModelPolicy } from '@edmate/contracts';
import { describe, expect, it } from 'vitest';
import { DEFAULT_MODEL_POLICY } from '../../src/router/default-policy.js';
import { createRouter, type ProviderAdapterFactories } from '../../src/router/factory.js';
import { collect, fakeAdapter, failingAdapter, req, text } from './fake-adapter.js';
import { GatewayError } from '../../src/adapters/errors.js';

function countingFactories(): {
  factories: ProviderAdapterFactories;
  built: string[];
} {
  const built: string[] = [];
  const factories: ProviderAdapterFactories = {
    anthropic: (model) => {
      built.push(`anthropic:${model}`);
      return fakeAdapter({
        id: 'anthropic',
        model,
        script: { stream: [{ steps: [text(`anthropic:${model}`)] }] },
      });
    },
    'openai-compatible': (model) => {
      built.push(`openai-compatible:${model}`);
      return fakeAdapter({
        id: 'openai-compatible',
        model,
        script: { stream: [{ steps: [text(`openai-compatible:${model}`)] }] },
      });
    },
  };
  return { factories, built };
}

describe('createRouter', () => {
  it('routes each tier to the adapter its policy target names', async () => {
    const { factories } = countingFactories();
    const router = createRouter(
      {
        tiers: {
          small: { provider: 'openai-compatible', model: 's' },
          main: { provider: 'anthropic', model: 'm' },
        },
      },
      factories,
    );
    expect(await collect(router.stream(req({ tier: 'small' })))).toEqual([
      text('openai-compatible:s'),
    ]);
    expect(await collect(router.stream(req({ tier: 'main' })))).toEqual([text('anthropic:m')]);
  });

  it('per-agent override: same factories, different policies, different adapters', async () => {
    const { factories } = countingFactories();
    const policyA: ModelPolicy = {
      tiers: {
        small: { provider: 'anthropic', model: 's' },
        main: { provider: 'anthropic', model: 'a' },
      },
    };
    const policyB: ModelPolicy = {
      tiers: {
        small: { provider: 'anthropic', model: 's' },
        main: { provider: 'openai-compatible', model: 'b' },
      },
    };
    expect(await collect(createRouter(policyA, factories).stream(req()))).toEqual([
      text('anthropic:a'),
    ]);
    expect(await collect(createRouter(policyB, factories).stream(req()))).toEqual([
      text('openai-compatible:b'),
    ]);
  });

  it('builds one adapter per provider and model, even when targets repeat', () => {
    const { factories, built } = countingFactories();
    createRouter(
      {
        tiers: {
          small: { provider: 'anthropic', model: 'm' },
          main: { provider: 'anthropic', model: 'm' },
        },
        fallback: { provider: 'anthropic', model: 'm' },
      },
      factories,
    );
    expect(built).toEqual(['anthropic:m']);
  });

  it('wires the policy fallback so a retryable failure fails over', async () => {
    const failure = new GatewayError('provider_error', true, 'anthropic', 'anthropic: 503');
    const router = createRouter(
      {
        tiers: {
          small: { provider: 'anthropic', model: 'm' },
          main: { provider: 'anthropic', model: 'm' },
        },
        fallback: { provider: 'openai-compatible', model: 'backup' },
      },
      {
        anthropic: () => failingAdapter(failure),
        'openai-compatible': (model) =>
          fakeAdapter({
            id: 'openai-compatible',
            model,
            script: { stream: [{ steps: [text('ok')] }] },
          }),
      },
    );
    expect(await collect(router.stream(req()))).toEqual([text('ok')]);
  });

  it('without a policy fallback, a retryable failure propagates', async () => {
    const failure = new GatewayError('provider_error', true, 'anthropic', 'anthropic: 503');
    const router = createRouter(
      {
        tiers: {
          small: { provider: 'anthropic', model: 'm' },
          main: { provider: 'anthropic', model: 'm' },
        },
      },
      { anthropic: () => failingAdapter(failure) },
    );
    await expect(collect(router.stream(req()))).rejects.toBe(failure);
  });

  it('throws at construction when a tier names a provider with no factory', () => {
    const { factories } = countingFactories();
    expect(() =>
      createRouter(
        {
          tiers: {
            small: { provider: 'anthropic', model: 's' },
            main: { provider: 'mystery', model: 'm' },
          },
        },
        factories,
      ),
    ).toThrow("createRouter: no adapter factory for provider 'mystery' (tier 'main')");
  });

  it('throws at construction when the fallback names a provider with no factory', () => {
    expect(() =>
      createRouter(
        {
          tiers: {
            small: { provider: 'anthropic', model: 's' },
            main: { provider: 'anthropic', model: 'm' },
          },
          fallback: { provider: 'openai-compatible', model: 'x' },
        },
        { anthropic: (model) => fakeAdapter({ model }) },
      ),
    ).toThrow("createRouter: no adapter factory for provider 'openai-compatible' (fallback)");
  });

  it('does not treat inherited object keys as providers', () => {
    expect(() =>
      createRouter(
        {
          tiers: {
            small: { provider: 'toString', model: 's' },
            main: { provider: 'anthropic', model: 'm' },
          },
        },
        { anthropic: (model) => fakeAdapter({ model }) },
      ),
    ).toThrow("no adapter factory for provider 'toString' (tier 'small')");
  });

  it('throws when a tier is missing from the policy', () => {
    expect(() =>
      createRouter(
        { tiers: { main: { provider: 'anthropic', model: 'm' } } } as unknown as ModelPolicy,
        { anthropic: (model) => fakeAdapter({ model }) },
      ),
    ).toThrow("createRouter: policy has no target for tier 'small'");
  });
});

describe('DEFAULT_MODEL_POLICY', () => {
  it('is a valid ModelPolicy that createRouter can resolve with an anthropic factory', () => {
    expect(ModelPolicySchema.parse(DEFAULT_MODEL_POLICY)).toEqual(DEFAULT_MODEL_POLICY);
    expect(() =>
      createRouter(DEFAULT_MODEL_POLICY, { anthropic: (model) => fakeAdapter({ model }) }),
    ).not.toThrow();
  });
});
