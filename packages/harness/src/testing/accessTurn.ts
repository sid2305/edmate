// Runs turns through `runTurn` with the real admit and entitle, the in-memory access stores and
// `unusedPort` gateway, retrieval and profiles, then stops the turn at the scrub. Shows what
// admit and entitle decided and that no model call was made.
import type { Entitlement, ErrorCode, TurnEvent, TurnInput, TurnTrace } from '@edmate/contracts';
import { runTurn } from '../pipeline/runner.js';
import { admit } from '../pipeline/steps/admit.js';
import { entitle } from '../pipeline/steps/entitle.js';
import type { Entitled, PipelineDeps } from '../pipeline/types.js';
import { driveTurn } from './driveTurn.js';
import {
  type AccessOptions,
  type AccessWorld,
  type MemoryEntitlementStore,
  memoryEntitlementStore,
  type MemoryTurnConfigStore,
  memoryTurnConfigStore,
  twoTeacherWorld,
} from './memoryAccess.js';
import { unusedPort } from './memoryPorts.js';
import { type LoggedStep, type TestDeps, testDeps, testSteps } from './testSteps.js';

export interface AccessTurnOutcome {
  /** The error code, or `passed` when the turn got past entitle (it then stops at the scrub). */
  code: ErrorCode | 'passed';
  retryable: boolean | null;
  events: TurnEvent[];
  /** Steps that started, in order. */
  started: LoggedStep[];
  trace: TurnTrace | null;
  /** What entitle returned, when the turn passed. */
  entitled: Entitled | null;
}

export interface AccessTurns {
  world: AccessWorld;
  t: TestDeps;
  entitlements: MemoryEntitlementStore;
  turnConfig: MemoryTurnConfigStore;
  /** Calls to the gateway, retrieval and profile ports: must stay empty. */
  modelCalls: string[];
  run(input: TurnInput): Promise<AccessTurnOutcome>;
}

const stopAtScrub = (): Promise<never> => Promise.reject(new Error('stopped after entitle'));

export function accessTurns(
  o: {
    source?: Entitlement['source'];
    world?: AccessWorld;
    opts?: AccessOptions;
    overrides?: Partial<PipelineDeps>;
  } = {},
): AccessTurns {
  const world = o.world ?? twoTeacherWorld();
  const modelCalls: string[] = [];
  const entitlements = memoryEntitlementStore(world, o.opts ?? { market: 'IN' });
  const turnConfig = memoryTurnConfigStore(world);
  const t = testDeps({
    overrides: {
      gatewayFor: () => ({ gateway: unusedPort('gateway', modelCalls), metered: false }),
      retrieval: unusedPort('retrieval', modelCalls),
      profiles: unusedPort('profiles', modelCalls),
      entitlements,
      turnConfig,
      entitlementSource: o.source ?? 'subscription',
      ...o.overrides,
    },
  });
  return {
    world,
    t,
    entitlements,
    turnConfig,
    modelCalls,
    async run(input) {
      const steps = testSteps({ admit, entitle, scrub: stopAtScrub });
      const { events, result } = await driveTurn(runTurn(input, { deps: t.deps, steps }), t.clock);
      const started = steps.log.filter((l) => l.phase === 'start').map((l) => l.step);
      const last = events.at(-1);
      const passed = started.includes('scrub');
      return {
        code: passed ? 'passed' : last?.type === 'error' ? last.code : 'provider_error',
        retryable: last?.type === 'error' ? last.retryable : null,
        events,
        started,
        trace: result.trace,
        entitled: passed ? (steps.commits[0]?.entitled ?? null) : null,
      };
    },
  };
}
