import type {
  ModelChunk,
  PedagogyDecision,
  SourceRef,
  TurnContext,
  TurnEvent,
  Usage,
} from '@edmate/contracts';
import { LIMITS, TurnEventSchema } from '@edmate/contracts';
import {
  demoChunk,
  demoChunkScored,
  demoTurnInput,
  turnContextFull,
  usageMain,
} from '@edmate/contracts/fixtures';
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
import { createGenerate, generate, HOLD_MARGIN, holdsReply } from '../steps/generate.js';
import type { RegisteredTool } from '../tools.js';
import type { StepEnv, Steps, UsageRecorder } from '../types.js';
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
    lockedStopped?: boolean;
    onLockedTrip?: () => void;
    step?: Steps['generate'];
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
    track: () => undefined,
  };
  const d = { ...decision, ...o.decision };
  const c = o.ctx ?? ctx;
  return {
    spy,
    registry,
    events,
    reported,
    recorded,
    run: (extra: { fromFallback?: true } = {}) =>
      clock.drive(
        (o.step ?? generate)(
          env,
          {
            ctx: c,
            decision: d,
            sources,
            attempt: 'primary',
            ...(o.lockedStopped === undefined ? {} : { lockedStopped: o.lockedStopped }),
            ...(o.onLockedTrip === undefined ? {} : { onLockedTrip: o.onLockedTrip }),
            ...extra,
          },
          (e) => {
            // The runner's emitter rejects what fails the schema; so does this one.
            events.push(TurnEventSchema.parse(e));
          },
        ),
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
    expect(out).toEqual({
      draft: 'Look at [2]. Now try it.',
      raw: 'Look at [2]. Now try it.',
      withheld: false,
    });
    // 4.6b: under 8 tokens total, the locked stream holds both sentences back until the attempt
    // ends cleanly, so they arrive as one token event (release()), after the skill event.
    expect(s.events).toEqual([
      { type: 'hint_rung', rung: 2 },
      { type: 'skill', skill: 'coach', payload: { shown: 'ok' } },
      { type: 'token', text: 'Look at [2]. Now try it.' },
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

  it.each(['ask', 'explain', 'check', 'redirect'] as const)(
    '%s sends no hint_rung',
    async (move) => {
      const s = setup([[say('x'), used]], { decision: { move } });
      await s.run();
      expect(types(s.events)).toEqual(['token']);
    },
  );

  it('ask_teacher sends no hint_rung and holds its text for postGuard (4.7)', async () => {
    const s = setup([[say('It has gone '), say('to your teacher.'), used]], {
      decision: { move: 'ask_teacher' },
    });
    const r = await s.run();
    expect(types(s.events)).toEqual([]);
    expect(r).toMatchObject({ draft: 'It has gone to your teacher.', held: true });
  });

  it('a teaching turn near the coverage threshold is held; a well-covered one streams (4.7)', async () => {
    const near = setup([[say('x'), used]], {
      decision: { move: 'explain' },
      ctx: { ...ctx, retrieved: [{ ...demoChunkScored, score: 0.55 }] },
    });
    expect(await near.run()).toMatchObject({ held: true });
    expect(types(near.events)).toEqual([]);
    const far = setup([[say('x'), used]], { decision: { move: 'explain' } });
    expect(await far.run()).not.toHaveProperty('held');
    expect(types(far.events)).toEqual(['token']);
  });
});

describe('holdsReply (4.7, lead answer 13)', () => {
  const at = (...scores: (number | undefined)[]) => ({
    retrieved: scores.map((score) =>
      score === undefined ? demoChunk : { ...demoChunkScored, score },
    ),
  });

  it('holds ask_teacher always', () => {
    expect(holdsReply(at(), 'ask_teacher')).toBe(true);
    expect(holdsReply(at(0.99), 'ask_teacher')).toBe(true);
  });

  it('holds a teaching move whose best scored chunk is under the threshold plus the margin', () => {
    expect(HOLD_MARGIN).toBe(0.1);
    expect(holdsReply(at(0.59, 0.2), 'hint')).toBe(true);
    expect(holdsReply(at(0.3), 'ask')).toBe(true);
    expect(holdsReply(at(0.6), 'hint')).toBe(false);
    expect(holdsReply(at(0.82, 0.55), 'solution')).toBe(false);
    expect(holdsReply(at(0.65), 'explain', 0.6)).toBe(true);
  });

  it('streams teaching turns whose chunks are all unscored, and redirect or locked turns', () => {
    expect(holdsReply(at(undefined), 'check')).toBe(false);
    expect(holdsReply(at(0.1), 'redirect')).toBe(false);
    expect(holdsReply(at(0.1), 'locked')).toBe(false);
    expect(holdsReply(at(), 'redirect')).toBe(false);
  });

  it('holds a teaching turn with nothing retrieved, or one decide.fallback chose (fix round 1)', () => {
    expect(holdsReply(at(), 'explain')).toBe(true);
    expect(holdsReply(at(), 'ask')).toBe(true);
    expect(holdsReply(at(0.9), 'ask', undefined, true)).toBe(true);
    expect(holdsReply(at(undefined), 'ask', undefined, true)).toBe(true);
    expect(holdsReply(at(0.9), 'redirect', undefined, true)).toBe(false);
  });

  it('a decide.fallback turn is held by the step (fromFallback)', async () => {
    const s = setup([[say('What have you tried?'), used]], { decision: { move: 'ask' } });
    const r = await s.run({ fromFallback: true });
    expect(r).toMatchObject({ held: true });
    expect(types(s.events)).toEqual([]);
  });

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
    expect(await s.run()).toEqual({ draft: 'AB', raw: 'ab', withheld: false });
    expect(s.events).toEqual([{ type: 'token', text: 'AB' }]);
  });
});

describe('generate: the answer-leak sentence gate is the default (4.5)', () => {
  it('a leaking sentence is never shown nor in the draft; raw keeps it; withheld is set', async () => {
    const s = setup([[say('Good. '), say(`It is ${KEY}`), say('. More. '), used]], {
      decision: { move: 'ask' },
    });
    expect(await s.run()).toEqual({
      draft: 'Good. ',
      raw: `Good. It is ${KEY}. More. `,
      withheld: true,
    });
    expect(s.events).toEqual([{ type: 'token', text: 'Good. ' }]);
  });

  it('a key split across tool rounds is still caught: no flush between rounds', async () => {
    const s = setup(
      [
        [say('See ANSWER_'), callCalc, used],
        [say('KEY_3_7 now.'), used],
      ],
      { decision: { move: 'ask' } },
    );
    const out = await s.run();
    expect(out).toMatchObject({ draft: '', withheld: true });
    expect(types(s.events)).toEqual(['skill']);
  });

  it('a cited source whose label holds the key is dropped and reported', async () => {
    const s = setup([[say('Look at [1] and [2].'), used]], {
      decision: { move: 'ask', mustNotReveal: ['p. 2'] },
    });
    await s.run();
    expect(s.events.at(-1)).toEqual({ type: 'sources', items: [src(1)] });
    expect(s.reported.map((e) => String(e))).toEqual([
      'SourceDropped: a cited source label held the answer key and was dropped',
    ]);
  });
});

describe('generate: lockedStopped (ADR-0007 §8, 4.6b)', () => {
  it('holds the whole reply until the attempt ends when the session already stopped streaming', async () => {
    const s = setup([[say('One two three four. '), say('Five six seven eight.'), used]], {
      decision: { move: 'ask', mustNotReveal: [] },
      lockedStopped: true,
    });
    const out = await s.run();
    // No per-sentence token events: the one token event is the whole reply, at the clean end.
    expect(s.events.filter((e) => e.type === 'token')).toEqual([
      { type: 'token', text: 'One two three four. Five six seven eight.' },
    ]);
    expect(out.draft).toBe('One two three four. Five six seven eight.');
    expect(out.locked).toBeUndefined();
  });

  it('passes onLockedTrip through: told once when the stream trips (4.6b fix round 1)', async () => {
    let told = 0;
    const s = setup([[say('One two three four five six seven eight. '), used]], {
      decision: { move: 'ask', mustNotReveal: [] },
      onLockedTrip: () => void told++,
      step: createGenerate({ lockedCheck: () => () => Promise.resolve(true) }),
    });
    const out = await s.run();
    expect(out.locked).toBe('hit');
    expect(told).toBe(1);
  });

  it('defaults to the ordinary per-sentence stream when unset', async () => {
    const s = setup([[say('One two three four five six seven eight. '), used]], {
      decision: { move: 'ask', mustNotReveal: [] },
    });
    await s.run();
    // 8 tokens: part of the sentence releases at once (not held for the whole attempt).
    expect(s.events.some((e) => e.type === 'token' && e.text === 'One ')).toBe(true);
  });
});
