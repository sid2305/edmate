// The gate's models (task 8.7 Phase B). The agent's turns use the model policy pinned on the
// candidate agent version (B-42: Sonnet for teaching replies, Haiku for router, guards and
// classifiers); the judge is the pinned release judge from `EDMATE_JUDGE_MODEL` (decision log,
// 18 Oct 2026; no default). Keys come only from the environment and stay in `Secret`s.
//
// Fails closed: `EDMATE_DEV_MODEL` set to anything (the scripted dev model answers every
// classifier "all clear", so a gate over it would pass by default), no judge model, a non-Anthropic
// judge or no Anthropic key gives `unavailable` with a reason, and the run ends `error`.
import type { ModelGateway, ModelPolicy } from '@edmate/contracts';
import { JUDGE_MODEL_VARIABLE, resolveJudgeModel, type JudgeModelConfig } from '@edmate/evals';
import {
  computeCostMicroUsd,
  createAnthropicAdapter,
  createRouter,
  envKeySource,
  loadBundledPrices,
  loadProviderKeys,
  meterRouter,
  type MeterContext,
  type PriceTable,
  type ProviderAdapterFactories,
} from '@edmate/gateway';
import type { PriceUsage, TurnGateway, TurnGatewaySpec } from '@edmate/harness';
import type { GateUnavailableReason } from './input.js';
import type { GateUsageMeter } from './ports.js';

export type Env = Readonly<Record<string, string | undefined>>;

export interface GateModels {
  /** Provider adapters for the agent's turns and the judge. */
  factories: ProviderAdapterFactories;
  judge: JudgeModelConfig;
  prices: PriceTable;
}

export type GateModelsResult =
  | { ok: true; models: GateModels }
  | { ok: false; reason: GateUnavailableReason };

export async function gateModelsFromEnv(env: Env): Promise<GateModelsResult> {
  if ((env.EDMATE_DEV_MODEL ?? '').trim() !== '') return { ok: false, reason: 'dev_model' };
  let judge: JudgeModelConfig;
  try {
    judge = resolveJudgeModel({ [JUDGE_MODEL_VARIABLE]: env[JUDGE_MODEL_VARIABLE] });
  } catch {
    return { ok: false, reason: 'judge_model' };
  }
  if (judge.provider !== 'anthropic') return { ok: false, reason: 'judge_provider' };
  let factories: ProviderAdapterFactories;
  try {
    const keys = await loadProviderKeys({ source: envKeySource(env), required: ['anthropic'] });
    factories = {
      anthropic: (model: string) => createAnthropicAdapter(keys.get('anthropic'), { model }),
    };
  } catch {
    // The error is dropped: it may name the variable's problem, never the value, but no need.
    return { ok: false, reason: 'provider_key' };
  }
  return { ok: true, models: { factories, judge, prices: loadBundledPrices() } };
}

/** `PipelineDeps.gatewayFor`: one metered router per turn spec, metered into the run's meter. */
export function gateGatewayFor(
  models: GateModels,
  meter: GateUsageMeter,
): (spec: TurnGatewaySpec) => TurnGateway {
  return (spec) => ({
    gateway: meterRouter(createRouter(spec.policy, models.factories), meter, spec.billing, models.prices),
    metered: true,
  });
}

/** `PipelineDeps.priceUsage` over the gate's price table. */
export function gatePriceUsage(models: GateModels): PriceUsage {
  return (u) => computeCostMicroUsd(models.prices, u.model, u.inputTokens, u.outputTokens);
}

/** The judge gateway, metered into the same meter (judge calls are billed to Edmate as `eval`). */
export function gateJudgeGateway(
  models: GateModels,
  meter: GateUsageMeter,
  ctx: { teacherId: string; packageId: string },
): ModelGateway {
  const target = { provider: 'anthropic' as const, model: models.judge.model };
  const policy: ModelPolicy = { tiers: { small: target, main: target } };
  const meterCtx: MeterContext = {
    teacherId: ctx.teacherId,
    packageId: ctx.packageId,
    studentId: 'gate_judge',
    turnId: 'gate_judge',
    source: 'eval',
  };
  return meterRouter(createRouter(policy, models.factories), meter, meterCtx, models.prices);
}
