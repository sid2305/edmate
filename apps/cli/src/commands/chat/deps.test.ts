// Phase A acceptance (task 3.9): one full student turn through the real `defaultSteps` pipeline,
// composed entirely by `buildChatDeps` over the real demo-teacher content — no database, no real
// model call (rule 4). The gateway is scripted: preGuard's three classifiers (distressDetect,
// moderationIn, jailbreak) are scripted directly by their fixed system prompts; postGuard's
// grounding and adviceGuard judges are intercepted by the harness's own `judgeGateway`/
// `adviceJudgeGateway` test wrappers (the same technique `testDeps()` uses), so only the turn's one
// real reply needs a scripted stream entry.
import type { TurnEvent, TurnInput } from '@edmate/contracts';
import { cancelSource, defaultSteps, runTurn } from '@edmate/harness';
import {
  adviceJudgeGateway,
  CLEAN_ADVICE_VERDICT,
  GROUNDED_VERDICT,
  judgeGateway,
  ScriptedGateway,
} from '@edmate/harness/testing';
import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { buildChatDeps, memoryProfileStore, slackClock } from './deps.js';

// Task 3.9b: on a loaded CI runner the cold first turn overran preGuard's 400 ms budget on the real
// clock and ended in an `error` event. Tests widen every step budget 10x; production is unchanged.
const STEP_BUDGET_SLACK = 10;

const say = (text: string) => ({ type: 'text' as const, text });
const used = {
  type: 'usage' as const,
  usage: { model: 'claude-haiku-4-5', tier: 'main' as const, inputTokens: 10, outputTokens: 10, costMicroUsd: 1 },
};

function scriptedChatGateway() {
  const scripted = new ScriptedGateway(
    {
      generateObject: [
        {
          match: (req) => req.system.includes('thoughts of suicide or self-harm'),
          value: { distress: false },
        },
        {
          match: (req) => req.system.includes('self_harm (wants to hurt themselves)'),
          value: { category: 'none' },
        },
        {
          match: (req) => req.system.includes('jailbreak_override'),
          value: { category: 'none' },
        },
      ],
      stream: [{ steps: [say('A variable stores a value so your program can use it later.'), used] }],
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

describe('buildChatDeps personas (5.8a)', () => {
  it.each(['teacher_preview', 'eval'] as const)(
    'wires the real persona library as deps.personas for --source %s',
    async (source) => {
      const setup = await buildChatDeps({
        env: {},
        market: 'global',
        packageId: 'paid',
        source,
        gateway: scriptedChatGateway(),
      });
      expect([...(setup.deps.personas?.keys() ?? [])].sort()).toEqual(['job-interview', 'viva']);
      expect(setup.personasSource).toBe('real');
    },
  );
});

describe('buildChatDeps + defaultSteps (Phase A acceptance)', () => {
  it(
    'runs one teacher_preview turn over the real demo-teacher content to done',
    // Real demo-teacher content + a full harness turn; on CI the first-import cost of the
    // harness (mathjs, access) can eat most of the default 5000ms budget. See 5.5a follow-up.
    async () => {
      const gateway = scriptedChatGateway();
      const setup = await buildChatDeps({
        env: {},
        market: 'global',
        packageId: 'free',
        source: 'teacher_preview',
        gateway,
        clock: slackClock(STEP_BUDGET_SLACK),
      });

      const input: TurnInput = {
        agentId: setup.agentId,
        sessionId: setup.sessionId,
        studentId: setup.studentId,
        kind: 'message',
        text: 'What is a variable?',
        lang: 'en',
        clientTs: new Date().toISOString(),
      };

      const run = runTurn(input, { deps: setup.deps, steps: defaultSteps });
      const events = await collect(run.events);
      const result = await run.finished;

      // On failure, print the error event (code, retryable) and the trace's step outcomes (3.9b).
      expect(
        events.filter((e) => e.type === 'error'),
        JSON.stringify(result.trace?.steps),
      ).toEqual([]);
      expect(events.at(-1)?.type).toBe('done');
      expect(result.background).toEqual([]);
      expect(result.trace?.steps.some((s) => s.name === 'generate' && s.outcome === 'ok')).toBe(true);
    },
    20000,
  );

  it('locks a module outside the free package (no model call reaches generate)', async () => {
    const gateway = scriptedChatGateway();
    const setup = await buildChatDeps({
      env: {},
      market: 'global',
      packageId: 'free',
      source: 'teacher_preview',
      gateway,
      clock: slackClock(STEP_BUDGET_SLACK),
    });

    const input: TurnInput = {
      agentId: setup.agentId,
      sessionId: setup.sessionId,
      studentId: setup.studentId,
      kind: 'message',
      text: 'Teach me loops please',
      lang: 'en',
      clientTs: new Date().toISOString(),
    };

    const run = runTurn(input, { deps: setup.deps, steps: defaultSteps });
    const events = await collect(run.events);
    const result = await run.finished;

    expect(events.some((e) => e.type === 'locked')).toBe(true);
    expect(result.trace?.move).toBe('locked');
    expect(events.at(-1)?.type).toBe('done');
  });

  it('builds the real (unmetered-by-step) gateway path when no test gateway is injected', async () => {
    const setup = await buildChatDeps({
      env: { EDMATE_ANTHROPIC_API_KEY: `fake-${randomBytes(16).toString('hex')}` },
      market: 'global',
      packageId: 'free',
      source: 'teacher_preview',
    });
    const tg = setup.deps.gatewayFor({
      policy: { tiers: { small: { provider: 'anthropic', model: 'm1' }, main: { provider: 'anthropic', model: 'm2' } } },
      billing: { teacherId: setup.teacherId, packageId: 'p', studentId: setup.studentId, turnId: 'turn_1', source: 'teacher_preview' },
    });
    expect(tg.metered).toBe(true);
    expect(typeof tg.gateway.stream).toBe('function');
  });
});

describe('slackClock (3.9b)', () => {
  it('slows sleep and now() together by the factor, and still cancels early', async () => {
    const clock = slackClock(10);
    expect(Math.abs(clock.now() - Date.now())).toBeLessThan(1000);

    const t0 = Date.now();
    const c0 = clock.now();
    await clock.sleep(5);
    const real = Date.now() - t0;
    expect(real).toBeGreaterThanOrEqual(45);
    // now() moved about a tenth of the real time: a budget minus a now() delta stays consistent.
    // Loose bound (docs/lessons.md "Wall-clock bounds fail on shared CI runners"): a shared,
    // loaded runner can add real ms between this sleep resolving and the Date.now()/clock.now()
    // reads just below, so the margin stays generous rather than tight.
    const virtual = clock.now() - c0;
    expect(virtual).toBeGreaterThanOrEqual(4);
    expect(virtual).toBeLessThanOrEqual(Math.ceil(real / 10) + 5);

    const source = cancelSource();
    const t1 = Date.now();
    const slept = clock.sleep(60_000, source.token);
    source.cancel();
    await slept;
    expect(Date.now() - t1).toBeLessThan(1000);
  });
});

describe('memoryProfileStore', () => {
  it('starts every student x teacher pair empty and keeps applyEvidence safe with no events', async () => {
    const store = memoryProfileStore();
    const first = await store.get('student-1', 'teacher-1');
    expect(first).toEqual({
      studentId: 'student-1',
      teacherId: 'teacher-1',
      lang: 'en',
      mastery: {},
      mistakes: [],
    });
    const after = await store.applyEvidence([]);
    expect(after).toEqual({ studentId: '', teacherId: '', lang: 'en', mastery: {}, mistakes: [] });
  });
});
