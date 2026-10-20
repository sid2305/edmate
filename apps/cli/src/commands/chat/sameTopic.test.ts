// Task 3.4c repro + fix proof: a multi-turn same-topic conversation on allowed content must climb
// the help ladder and never fall to `locked` (3.9 report). `buildChatDeps` composes the real
// `PipelineDeps` over the real demo-teacher content; one session carries several turns through the
// real `defaultSteps` pipeline (rule 4: the gateway is scripted, never a real model call).
//
// `edmate chat`'s composition saves help state (`memorySessionStateStore`) but never reloads it
// (`memoryTurnConfigStore(world)` reads the world's fixed session, task 3.9a finding): this test
// wraps `setup.deps.turnConfig.load` to return the last saved help state, in-test plumbing only
// (out of bounds for this task: `apps/cli/src/commands/chat/deps.ts` is unchanged).
import type { TurnEvent, TurnInput } from '@edmate/contracts';
import { defaultSteps, runTurn, type PipelineDeps } from '@edmate/harness';
import {
  adviceJudgeGateway,
  CLEAN_ADVICE_VERDICT,
  GROUNDED_VERDICT,
  judgeGateway,
  ScriptedGateway,
} from '@edmate/harness/testing';
import { describe, expect, it } from 'vitest';
import { buildChatDeps } from './deps.js';

const say = (text: string) => ({ type: 'text' as const, text });
const used = {
  type: 'usage' as const,
  usage: { model: 'claude-haiku-4-5', tier: 'main' as const, inputTokens: 10, outputTokens: 10, costMicroUsd: 1 },
};

/** `n` copies of a predicate entry: route's classifiers run once per turn, so one entry per turn
 * is not enough across a multi-turn conversation. */
function repeat<T>(n: number, entry: T): T[] {
  return Array.from({ length: n }, () => entry);
}

function scriptedChatGateway(replies: string[]) {
  const scripted = new ScriptedGateway(
    {
      generateObject: [
        ...repeat(replies.length, {
          match: (req: { system: string }) => req.system.includes('thoughts of suicide or self-harm'),
          value: { distress: false },
        }),
        ...repeat(replies.length, {
          match: (req: { system: string }) =>
            req.system.includes('self_harm (wants to hurt themselves)'),
          value: { category: 'none' },
        }),
        ...repeat(replies.length, {
          match: (req: { system: string }) => req.system.includes('jailbreak_override'),
          value: { category: 'none' },
        }),
        // route's small-model fallback (3.3), only reached when no rule is confident.
        ...repeat(replies.length, {
          match: (req: { system: string }) =>
            req.system.includes('You sort messages a student sent to an AI tutor'),
          value: { intent: 'on_task' },
        }),
      ],
      stream: replies.map((text) => ({ steps: [say(text), used] })),
    },
    { sleep: () => Promise.resolve() },
  );
  const judged = judgeGateway(scripted, () => GROUNDED_VERDICT);
  return adviceJudgeGateway(judged, () => CLEAN_ADVICE_VERDICT);
}

async function collect(events: AsyncIterable<TurnEvent>): Promise<TurnEvent[]> {
  const out: TurnEvent[] = [];
  for await (const e of events) out.push(e);
  return out;
}

/** Reloads the saved help state (3.9a gap, in-test plumbing only). */
function withHelpStateReload(deps: PipelineDeps): PipelineDeps {
  const saved = (
    deps.sessionState as unknown as { saved: { sessionId: string; helpState: unknown }[] }
  ).saved;
  const inner = deps.turnConfig;
  return {
    ...deps,
    turnConfig: {
      load: async (e, sessionId) => {
        const base = await inner.load(e, sessionId);
        if (base === null) return base;
        const last = [...saved].reverse().find((s) => s.sessionId === sessionId);
        return last === undefined ? base : { ...base, helpState: last.helpState };
      },
    },
  };
}

async function runOneTurn(
  deps: PipelineDeps,
  setup: { agentId: string; sessionId: string; studentId: string },
  text: string,
) {
  const input: TurnInput = {
    agentId: setup.agentId,
    sessionId: setup.sessionId,
    studentId: setup.studentId,
    kind: 'message',
    text,
    lang: 'en',
    clientTs: new Date().toISOString(),
  };
  const run = runTurn(input, { deps, steps: defaultSteps });
  const events = await collect(run.events);
  const result = await run.finished;
  return { events, result };
}

describe('same-topic turns climb the help ladder and never fall to locked (3.4c)', () => {
  it(
    'three same-topic allowed turns: never locked, the saved help rung climbs above 0',
    async () => {
      const allowedTurns = [
        'What is a variable?',
        'Is a variable a name for a value?',
        'So is a variable just a name for a value?',
      ];
      const lockedTurns = ['Teach me loops please', 'Explain while loops'];
      const replies = [
        'A variable is a name that refers to a value.',
        'Yes, a variable names a value so your program can use it again.',
        "That's right: a variable is a name for a value.",
      ];

      const gateway = scriptedChatGateway(replies);
      const setup = await buildChatDeps({
        env: {},
        market: 'global',
        packageId: 'free',
        source: 'teacher_preview',
        gateway,
      });
      const deps = withHelpStateReload(setup.deps);

      let sawRungAboveZero = false;
      for (const text of allowedTurns) {
        const { events, result } = await runOneTurn(deps, setup, text);
        expect(events.some((e) => e.type === 'locked')).toBe(false);
        expect(result.trace?.move).not.toBe('locked');
        expect(events.at(-1)?.type).toBe('done');
        const rung = events.find((e) => e.type === 'hint_rung');
        if (rung !== undefined && rung.type === 'hint_rung' && rung.rung > 0) {
          sawRungAboveZero = true;
        }
      }
      const saved = (
        deps.sessionState as unknown as { saved: { sessionId: string; helpState: unknown }[] }
      ).saved;
      const last = saved.at(-1);
      expect(last).toBeDefined();
      const lastHelpState = last?.helpState as { rung?: number } | undefined;
      expect((lastHelpState?.rung ?? 0) > 0 || sawRungAboveZero).toBe(true);

      // Locked content still returns locked, even with an allowed-topic history behind it.
      const lockedGateway = scriptedChatGateway([...replies, 'placeholder', 'placeholder']);
      const lockedSetup = await buildChatDeps({
        env: {},
        market: 'global',
        packageId: 'free',
        source: 'teacher_preview',
        gateway: lockedGateway,
      });
      const lockedDeps = withHelpStateReload(lockedSetup.deps);
      for (const text of allowedTurns) {
        await runOneTurn(lockedDeps, lockedSetup, text);
      }
      for (const text of lockedTurns) {
        const { events, result } = await runOneTurn(lockedDeps, lockedSetup, text);
        expect(events.some((e) => e.type === 'locked')).toBe(true);
        expect(result.trace?.move).toBe('locked');
        expect(events.at(-1)?.type).toBe('done');
      }
    },
    20000,
  );
});
