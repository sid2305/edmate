import type {
  ModelChunk,
  PedagogyDecision,
  SourceRef,
  TurnContext,
  TurnEvent,
  Usage,
} from '@edmate/contracts';
import { LIMITS, TurnEventSchema } from '@edmate/contracts';
import { demoTurnInput, turnContextFull, usageMain } from '@edmate/contracts/fixtures';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { buildModelRequest } from '../../pedagogy/modelRequest.js';
import { resolvePromptPackSet } from '../../pedagogy/promptPacks.js';
import { memoryToolRegistry, testTool } from '../../testing/memoryToolRegistry.js';
import {
  FIXTURE_PROMPT_PACK_VERSION,
  fixturePromptPackLibrary,
} from '../../testing/promptPackFixtures.js';
import { type StreamStep, ScriptedGateway } from '../../testing/scriptedGateway.js';
import { spyGateway } from '../../testing/spyGateway.js';
import { testDeps } from '../../testing/testSteps.js';
import { virtualClock } from '../../testing/virtualClock.js';
import { cancelSource } from '../clock.js';
import { TurnAbort } from '../errors.js';
import { generate } from '../steps/generate.js';
import type { RegisteredTool } from '../tools.js';
import type { StepEnv, UsageRecorder } from '../types.js';
import { SkillEventDropped } from './skillEvent.js';
import type { StreamGateFactory } from './streamGate.js';

const KEY = 'ANSWER_KEY_3_7';
const ctx: TurnContext = {
  ...turnContextFull,
  agent: { ...turnContextFull.agent, promptPackVersion: FIXTURE_PROMPT_PACK_VERSION },
};
const decision: PedagogyDecision = {
  move: 'hint',
  rung: 2,
  mustNotReveal: [KEY],
  systemPrompt: 'SYSTEM PROMPT [1] [2]',
  tools: ['calculator'],
  maxOutputTokens: 300,
};
const src = (n: number): SourceRef => ({ title: `Doc ${n}`, locator: `p. ${n}`, kind: 'material' });
const sources = [src(1), src(2)];

const say = (text: string) => ({ type: 'text', text }) satisfies ModelChunk;
const used = { type: 'usage', usage: usageMain } satisfies ModelChunk;
const callCalc = {
  type: 'tool_call',
  id: 'c1',
  name: 'calculator',
  args: { expression: '1/2+1/3' },
} satisfies ModelChunk;

function presenting(payload: unknown): RegisteredTool {
  return testTool({
    name: 'calculator',
    skill: 'coach',
    input: z.strictObject({ expression: z.string() }),
    run: () => Promise.resolve({ value: '5/6' }),
    present: () => ({ skill: 'coach', payload }),
  });
}

function setup(
  streams: StreamStep[][],
  o: {
    decision?: Partial<PedagogyDecision>;
    ctx?: TurnContext;
    tools?: RegisteredTool[];
    usage?: Partial<UsageRecorder>;
    gate?: StreamGateFactory;
  } = {},
) {
  const clock = virtualClock();
  const spy = spyGateway(
    new ScriptedGateway({ stream: streams.map((steps) => ({ steps })) }, clock),
  );
  const registry = memoryToolRegistry(o.tools ?? [presenting({ shown: 'ok' })]);
  const { deps } = testDeps({
    clock,
    overrides: { tools: registry, ...(o.gate === undefined ? {} : { streamGate: o.gate }) },
  });
  const events: TurnEvent[] = [];
  const reported: unknown[] = [];
  const recorded: Usage[] = [];
  const env: StepEnv = {
    input: demoTurnInput,
    deps,
    cancel: cancelSource().token,
    turnId: 'turn_x',
    gateway: spy,
    usage: {
      record: o.usage?.record ?? ((u) => void recorded.push(u)),
      checkBeforeCall: o.usage?.checkBeforeCall ?? (() => undefined),
    },
    report: (e) => void reported.push(e),
  };
  const d = { ...decision, ...o.decision };
  const c = o.ctx ?? ctx;
  return {
    spy,
    registry,
    events,
    reported,
    recorded,
    run: () =>
      clock.drive(
        generate(env, { ctx: c, decision: d, sources, attempt: 'primary' }, (e) => {
          // The runner's emitter rejects what fails the schema; so does this one.
          events.push(TurnEventSchema.parse(e));
        }),
      ),
  };
}

const types = (events: TurnEvent[]) => events.map((e) => e.type);

describe('generate: the request', () => {
  it('is buildModelRequest plus the entitled tool schemas', async () => {
    const s = setup([[say('Hi.'), used]]);
    await s.run();
    const set = resolvePromptPackSet(fixturePromptPackLibrary, FIXTURE_PROMPT_PACK_VERSION);
    expect(s.spy.requests[0]).toEqual({
      ...buildModelRequest({ ctx, decision, input: demoTurnInput, set }),
      tools: [
        {
          name: 'calculator',
          description: 'Test tool calculator.',
          inputSchema: expect.objectContaining({ type: 'object' }),
        },
      ],
    });
  });

  it('a tool the decision names but the entitlement lacks is never offered or run', async () => {
    const s = setup([[callCalc, used]], {
      tools: [testTool({ name: 'calculator', skill: 'mock_interview' })],
    });
    await expect(s.run()).rejects.toThrow(/offered no tools/);
    expect(s.spy.requests[0]).not.toHaveProperty('tools');
    expect(s.registry.runs).toEqual([]);
  });

  it('a registry tool the decision did not name is not offered', async () => {
    const s = setup([[say('Hi.'), used]], { decision: { tools: [] } });
    await s.run();
    expect(s.spy.requests[0]).not.toHaveProperty('tools');
  });

  it('a turn at its ceiling shows nothing and makes no call', async () => {
    const s = setup([[say('Hi.'), used]], {
      usage: {
        checkBeforeCall: () => {
          throw new TurnAbort('turn_cost_exceeded');
        },
      },
    });
    await expect(s.run()).rejects.toBeInstanceOf(TurnAbort);
    expect(s.events).toEqual([]);
    expect(s.spy.requests).toEqual([]);
  });
});

describe('generate: events in order', () => {
  it('hint_rung → tokens and skill in stream order → sources; returns the shown draft', async () => {
    const s = setup([
      [say('Look at [2]. '), callCalc, used],
      [say('Now try it.'), used],
    ]);
    const out = await s.run();
    expect(out).toEqual({ draft: 'Look at [2]. Now try it.' });
    expect(s.events).toEqual([
      { type: 'hint_rung', rung: 2 },
      { type: 'token', text: 'Look at [2]. ' },
      { type: 'skill', skill: 'coach', payload: { shown: 'ok' } },
      { type: 'token', text: 'Now try it.' },
      { type: 'sources', items: [src(2)] },
    ]);
    expect(s.recorded).toEqual([usageMain, usageMain]);
  });

  it.each(['hint', 'worked_example', 'solution'] as const)(
    '%s sends hint_rung first',
    async (move) => {
      const s = setup([[say('x'), used]], { decision: { move } });
      await s.run();
      expect(s.events[0]).toEqual({ type: 'hint_rung', rung: 2 });
    },
  );

  it.each(['ask', 'explain', 'check', 'redirect', 'ask_teacher'] as const)(
    '%s sends no hint_rung',
    async (move) => {
      const s = setup([[say('x'), used]], { decision: { move } });
      await s.run();
      expect(types(s.events)).toEqual(['token']);
    },
  );

  it('no sources event when nothing is cited, or only out-of-range numbers', async () => {
    const s = setup([[say('See [7] and [0].'), used]], { decision: { move: 'ask' } });
    await s.run();
    expect(types(s.events)).toEqual(['token']);
  });

  it('locked: names the package only when the teacher chose name_package', async () => {
    const named = setup([[say('That is in another package.'), used]], {
      decision: { move: 'locked', tools: [] },
      ctx: { ...ctx, pkg: { ...ctx.pkg, lockedReply: 'name_package' } },
    });
    await named.run();
    expect(named.events.at(-1)).toEqual({ type: 'locked', packageName: ctx.pkg.name });

    const generic = setup([[say('Not here.'), used]], {
      decision: { move: 'locked', tools: [] },
      ctx: { ...ctx, pkg: { ...ctx.pkg, lockedReply: 'generic' } },
    });
    await generic.run();
    expect(generic.events.at(-1)).toEqual({ type: 'locked' });
  });

  it('sources come before locked', async () => {
    const s = setup([[say('From [1].'), used]], { decision: { move: 'locked', tools: [] } });
    await s.run();
    expect(types(s.events)).toEqual(['token', 'sources', 'locked']);
  });
});

describe('generate: skill payloads (fail closed)', () => {
  const twoRounds = () =>
    [
      [callCalc, used],
      [say('ok'), used],
    ] as StreamStep[][];

  it('a payload holding the answer key is dropped and reported; the turn goes on', async () => {
    const s = setup(twoRounds(), { tools: [presenting({ answer: KEY.toLowerCase() })] });
    await s.run();
    expect(types(s.events)).toEqual(['hint_rung', 'token']);
    expect(s.reported).toHaveLength(1);
    expect(s.reported[0]).toBeInstanceOf(SkillEventDropped);
    expect((s.reported[0] as SkillEventDropped).reason).toBe('answer_key');
    expect(JSON.stringify(s.events)).not.toContain(KEY.toLowerCase());
  });

  it(`a payload over ${LIMITS.skillPayloadMaxJsonLength} JSON characters is dropped`, async () => {
    const s = setup(twoRounds(), {
      tools: [presenting('x'.repeat(LIMITS.skillPayloadMaxJsonLength + 1))],
    });
    await s.run();
    expect(types(s.events)).toEqual(['hint_rung', 'token']);
    expect((s.reported[0] as SkillEventDropped).reason).toBe('too_large');
  });
});

describe('generate: the stream gate seam', () => {
  it('shows only what the gate releases, and the draft is what was shown', async () => {
    const holding: StreamGateFactory = () => {
      let held = '';
      return {
        push: (t) => {
          held += t;
          return [];
        },
        flush: () => {
          const out = held === '' ? [] : [held.toUpperCase()];
          held = '';
          return out;
        },
      };
    };
    const s = setup([[say('a'), say('b'), used]], { gate: holding, decision: { move: 'ask' } });
    expect(await s.run()).toEqual({ draft: 'AB' });
    expect(s.events).toEqual([{ type: 'token', text: 'AB' }]);
  });
});
