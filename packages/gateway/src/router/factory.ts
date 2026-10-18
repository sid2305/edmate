// Resolves a ModelPolicy (an agent's AgentConfig.modelPolicy) into a Router. This is the only
// place policy strings become adapters; a per-agent override is just a different policy.
import type { ModelPolicy, ModelRequest } from '@edmate/contracts';
import type { ModelAdapter } from '../adapters/types.js';
import type { ProviderId } from '../keys/providers.js';
import { Router } from './router.js';

/** Builds an adapter bound to one model, for example `(m) => createAnthropicAdapter(keys, { model: m })`. */
export type AdapterFactory = (model: string) => ModelAdapter;
export type ProviderAdapterFactories = Partial<Readonly<Record<ProviderId, AdapterFactory>>>;

type Target = { provider: string; model: string };

const TIERS: readonly ModelRequest['tier'][] = ['small', 'main'];

/** Fails fast at construction on a policy it cannot serve: a config problem, not a call error. */
export function createRouter(policy: ModelPolicy, factories: ProviderAdapterFactories): Router {
  const built = new Map<string, ModelAdapter>();
  const resolve = (target: Target, where: string): ModelAdapter => {
    const key = `${target.provider}:${target.model}`;
    const cached = built.get(key);
    if (cached !== undefined) return cached;
    const factory = Object.hasOwn(factories, target.provider)
      ? factories[target.provider as ProviderId]
      : undefined;
    if (factory === undefined) {
      throw new Error(
        `createRouter: no adapter factory for provider '${target.provider}' (${where})`,
      );
    }
    const adapter = factory(target.model);
    built.set(key, adapter);
    return adapter;
  };

  const tierAdapter = (tier: ModelRequest['tier']): ModelAdapter => {
    const target = policy.tiers[tier] as Target | undefined;
    if (target === undefined) {
      throw new Error(`createRouter: policy has no target for tier '${tier}'`);
    }
    return resolve(target, `tier '${tier}'`);
  };

  const [small, main] = TIERS.map(tierAdapter) as [ModelAdapter, ModelAdapter];
  const fallback = policy.fallback === undefined ? undefined : resolve(policy.fallback, 'fallback');
  return new Router({ tiers: { small, main }, ...(fallback === undefined ? {} : { fallback }) });
}
