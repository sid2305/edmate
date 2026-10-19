// The turn's model gateways (task 3.7, lead answer Q1). After entitle, the runner asks the root
// for gateways billed to the entitlement, never to anything in the input:
//   guards  the agent's full policy (preGuard, route, postGuard; the router may fall back);
//   primary generate's first attempt, the policy without `fallback`, so the router does not fall
//           back as well as the runner's retry;
//   retry   generate's retry, "on the fallback model": `tiers.main` := `policy.fallback` (main
//           again when the agent has no fallback).
import type { Entitlement, ModelGateway, ModelPolicy } from '@edmate/contracts';
import type { PipelineDeps, TurnBilling, TurnGateway } from './types.js';

export function billingFor(e: Entitlement, turnId: string): TurnBilling {
  return {
    teacherId: e.teacherId,
    packageId: e.packageId,
    studentId: e.studentId,
    turnId,
    source: e.source,
  };
}

export function turnPolicies(p: ModelPolicy): {
  guards: ModelPolicy;
  primary: ModelPolicy;
  retry: ModelPolicy;
} {
  const primary: ModelPolicy = { tiers: { ...p.tiers } };
  const retry: ModelPolicy =
    p.fallback === undefined ? primary : { tiers: { ...p.tiers, main: { ...p.fallback } } };
  return { guards: p, primary, retry };
}

/** A gateway that refuses every call: before entitle, or when the turn gateway can't be built. */
export function refusingGateway(reason: string): ModelGateway {
  const refuse = () => new Error(`no model call: ${reason}`);
  return {
    stream: () => {
      throw refuse();
    },
    generateObject: () => Promise.reject(refuse()),
    embed: () => Promise.reject(refuse()),
  };
}

/** `deps.gatewayFor`, with its result checked: anything malformed throws (fail closed). */
export function buildTurnGateway(
  deps: Pick<PipelineDeps, 'gatewayFor'>,
  policy: ModelPolicy,
  billing: TurnBilling,
): TurnGateway {
  const tg: unknown = deps.gatewayFor({ policy, billing: { ...billing } });
  const g = (tg as Partial<TurnGateway> | undefined)?.gateway;
  if (
    typeof g?.stream !== 'function' ||
    typeof g.generateObject !== 'function' ||
    typeof g.embed !== 'function' ||
    typeof (tg as Partial<TurnGateway>).metered !== 'boolean'
  ) {
    throw new Error('gatewayFor returned no usable gateway');
  }
  return tg as TurnGateway;
}
