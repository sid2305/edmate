// Router: tiers, per-agent override (a different ModelPolicy), one fallback retry (task 2.3).
export { Router, type CapabilityNeeds, type RouterOptions } from './router.js';
export { createRouter, type AdapterFactory, type ProviderAdapterFactories } from './factory.js';
export { DEFAULT_MODEL_POLICY } from './default-policy.js';
