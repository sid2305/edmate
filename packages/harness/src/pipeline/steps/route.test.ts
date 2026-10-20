// route (task 3.3): rules first, the small model only for an inconclusive intent.
import type { TurnInput } from '@edmate/contracts';
import {
  demoAgentConfig,
  demoEntitlementSubscription,
  demoLocalePack,
  demoPackagePaid,
  demoStyleCard,
  demoTurnInput,
} from '@edmate/contracts/fixtures';
import { describe, expect, it } from 'vitest';
import { scriptedObjectRouteIntent } from '../../testing/gatewayFixtures.js';
import { ScriptedGateway, type GatewayScript } from '../../testing/scriptedGateway.js';
import { stepEnvExtras, testDeps } from '../../testing/testSteps.js';
import { cancelSource } from '../clock.js';
import { RouteResultSchema } from '../results.js';
import type { Entitled, PipelineDeps, StepEnv } from '../types.js';
import { defaultSteps } from './index.js';
import { route } from './route.js';

const helpState = (answerKey: string[]) => ({
  v: 1,
  rung: 1,
  stuckTurns: 0,
  attemptLogged: false,
  pendingCheck: false,
  answerKey,
});

const entitled = (raw?: unknown): Entitled => ({
  entitlement: demoEntitlementSubscription,
  agent: demoAgentConfig,
  pkg: demoPackagePaid,
  locale: demoLocalePack,
  styleCard: demoStyleCard,
  ...(raw === undefined ? {} : { helpState: raw }),
});

function envWith(
  input: Partial<TurnInput>,
  script?: GatewayScript,
  overrides: Partial<PipelineDeps> = {},
) {
  const t = testDeps({ overrides });
  const gateway = script === undefined ? undefined : new ScriptedGateway(script, t.clock);
  const env: StepEnv = {
    input: { ...demoTurnInput, ...input },
    deps: t.deps,
    cancel: cancelSource().token,
    turnId: 'turn_1',
    ...stepEnvExtras(),
    ...(gateway === undefined ? {} : { gateway }),
  };
  return { env, gateway };
}

describe('route.run', () => {
  it('is the default step', () => {
    expect(defaultSteps.route).toBe(route);
  });

  it('a confident rule makes no model call (the env gateway refuses every call)', async () => {
    const { env } = envWith({ kind: 'message', text: 'I got 5/6' });
    const r = await route.run(env, entitled(helpState(['5/6'])));
    expect(r).toEqual({ intent: 'on_task', attempt: 'correct', usage: [] });
    expect(RouteResultSchema.safeParse(r).success).toBe(true);
  });

  it('reads the attempt against the stored answer key', async () => {
    const { env } = envWith({ kind: 'message', text: 'x = 2, y = 5' });
    await expect(route.run(env, entitled(helpState(['2', '3'])))).resolves.toMatchObject({
      attempt: 'partial',
    });
  });

  it('never credits an answer with no readable key', async () => {
    const { env } = envWith({ kind: 'message', text: '5/6' });
    await expect(route.run(env, entitled({ v: 7 }))).resolves.toMatchObject({ attempt: 'wrong' });
  });

  it('asks the model once for an inconclusive intent; attempt stays rules-only', async () => {
    const { env, gateway } = envWith(
      { kind: 'message', text: 'my teacher said something weird about this' },
      { generateObject: [scriptedObjectRouteIntent] },
    );
    const r = await route.run(env, entitled(helpState(['5/6'])));
    expect(r).toEqual({ intent: 'off_topic', attempt: 'none', usage: [] });
    expect(RouteResultSchema.safeParse(r).success).toBe(true);
    expect(gateway?.usage).toHaveLength(1);
  });

  it('a distress keyword is distress without a model call', async () => {
    const { env } = envWith({ kind: 'message', text: 'i want to die' });
    await expect(route.run(env, entitled())).resolves.toMatchObject({ intent: 'distress' });
  });

  it('a skill action with no text is on_task / none', async () => {
    const input: Partial<TurnInput> = { kind: 'skill_action', skill: 'practice' };
    const { env } = envWith(input);
    delete (env.input as { text?: string }).text;
    await expect(route.run(env, entitled())).resolves.toEqual({
      intent: 'on_task',
      attempt: 'none',
      usage: [],
    });
  });

  it('rejects when the model fails, so the runner fallback applies', async () => {
    const { env } = envWith(
      { kind: 'message', text: 'my teacher said something weird about this' },
      {},
    );
    await expect(route.run(env, entitled())).rejects.toThrow();
  });
});

describe('route.onFailure', () => {
  it('is on_task / none by default', () => {
    const { env } = envWith({ kind: 'message', text: 'tell me a joke' });
    expect(route.onFailure(env, entitled())).toEqual({ intent: 'on_task', attempt: 'none' });
  });

  it('distress keywords still escalate (the injected check)', () => {
    const seen: string[] = [];
    const { env } = envWith(
      { kind: 'message', text: 'anything' },
      undefined,
      {
        distressCheck: (t) => {
          seen.push(t);
          return true;
        },
      },
    );
    expect(route.onFailure(env, entitled())).toEqual({ intent: 'distress', attempt: 'none' });
    expect(seen).toEqual(['anything']);
  });

  it('checks an empty text when the input has none', () => {
    const seen: string[] = [];
    const { env } = envWith({ kind: 'skill_action', skill: 'practice' }, undefined, {
      distressCheck: (t) => {
        seen.push(t);
        return false;
      },
    });
    delete (env.input as { text?: string }).text;
    expect(route.onFailure(env, entitled())).toEqual({ intent: 'on_task', attempt: 'none' });
    expect(seen).toEqual(['']);
  });
});
