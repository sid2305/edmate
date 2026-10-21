// Task 5.8a: a mock-interview role-play through the real `defaultSteps` pipeline, composed by
// `buildChatDeps` over the demo paid package and the real persona library. No model call (rule
// 4): a scripted gateway answers, and a spy records every main-tier request so the test reads the
// composed system prompt. It pins the acceptance's "an answer without `skill` becomes coach": the
// role-play count lives in the session's help state, so a turn that drops the skill is coached,
// and the next turn that carries it again continues the count rather than restarting it.
import type { ModelRequest, TurnEvent, TurnInput } from '@edmate/contracts';
import { defaultSteps, runTurn } from '@edmate/harness';
import {
  adviceJudgeGateway,
  CLEAN_ADVICE_VERDICT,
  GROUNDED_VERDICT,
  judgeGateway,
  ScriptedGateway,
  spyGateway,
} from '@edmate/harness/testing';
import { describe, expect, it } from 'vitest';
import { buildChatDeps, slackClock } from './deps.js';

const say = (text: string) => ({ type: 'text' as const, text });
const used = {
  type: 'usage' as const,
  usage: { model: 'claude-haiku-4-5', tier: 'main' as const, inputTokens: 10, outputTokens: 10, costMicroUsd: 1 },
};
const TURNS = 6;

function capturingGateway() {
  const scripted = new ScriptedGateway(
    {
      generateObject: Array.from({ length: TURNS }, () => [
        { match: (r: { system: string }) => r.system.includes('thoughts of suicide or self-harm'), value: { distress: false } },
        { match: (r: { system: string }) => r.system.includes('self_harm (wants to hurt themselves)'), value: { category: 'none' } },
        { match: (r: { system: string }) => r.system.includes('jailbreak_override'), value: { category: 'none' } },
      ]).flat(),
      stream: Array.from({ length: TURNS }, () => ({
        match: (r: ModelRequest) => r.tier === 'main',
        steps: [say('Welcome. Here is your question: what does a variable hold in Python?'), used],
      })),
    },
    { sleep: () => Promise.resolve() },
  );
  const judged = adviceJudgeGateway(judgeGateway(scripted, () => GROUNDED_VERDICT), () => CLEAN_ADVICE_VERDICT);
  return spyGateway(judged);
}

async function session() {
  const spy = capturingGateway();
  const setup = await buildChatDeps({
    env: {},
    market: 'global',
    packageId: 'paid',
    source: 'teacher_preview',
    gateway: spy,
    clock: slackClock(10),
  });
  async function turn(extra: Partial<TurnInput>) {
    const before = spy.requests.length;
    const input: TurnInput = {
      agentId: setup.agentId,
      sessionId: setup.sessionId,
      studentId: setup.studentId,
      kind: 'message',
      lang: 'en',
      clientTs: new Date().toISOString(),
      ...extra,
    };
    const run = runTurn(input, { deps: setup.deps, steps: defaultSteps });
    const events: TurnEvent[] = [];
    for await (const e of run.events) events.push(e);
    const result = await run.finished;
    const system = spy.requests.slice(before).find((r) => r.tier === 'main')?.system ?? '';
    return { events, result, system };
  }
  return { turn };
}

const START = { kind: 'skill_action', skill: 'mock_interview', skillPayload: { persona: 'job-interview' } } as const;
const ANSWER = 'A variable is a name that points to a value.';
const ROLEPLAY = 'Skill: mock interview';
const COACH = 'Skill: coach.';
const PERSONA_NAME = 'Interviewer';
const PERSONA_SECTION = '[[PERSONA]]';

describe('role-play through buildChatDeps + defaultSteps (5.8a)', () => {
  it(
    'counts with the skill, coaches without it, and carries the count across the coached turn',
    async () => {
      const s = await session();

      const start = await s.turn(START);
      expect(start.events.filter((e) => e.type === 'error'), JSON.stringify(start.result.trace?.steps)).toEqual([]);
      expect(start.system).toContain(ROLEPLAY);
      expect(start.system).toContain(PERSONA_NAME);
      expect(start.system).toMatch(/question 1 of 6/u);

      const a1 = await s.turn({ text: ANSWER, skill: 'mock_interview' });
      expect(a1.system).toContain(ROLEPLAY);
      expect(a1.system).toContain(PERSONA_NAME);
      expect(a1.system).toMatch(/question 2 of 6/u);

      // The same answer without the skill: decided as coach, no persona section in the prompt.
      const bare = await s.turn({ text: ANSWER });
      expect(bare.events.filter((e) => e.type === 'error')).toEqual([]);
      expect(bare.system).toContain(COACH);
      expect(bare.system).not.toContain(ROLEPLAY);
      expect(bare.system).not.toContain(PERSONA_SECTION);
      expect(bare.system).not.toContain(PERSONA_NAME);
      expect(bare.system).not.toMatch(/question \d+ of 6/u);

      // Back in role-play: the count was carried, not lost or restarted.
      const a2 = await s.turn({ text: 'It can hold any object.', skill: 'mock_interview' });
      expect(a2.system).toContain(PERSONA_NAME);
      expect(a2.system).toMatch(/question 3 of 6/u);
    },
    30000,
  );

  it(
    'a start with an unknown persona id fails closed to coach',
    async () => {
      const s = await session();
      const start = await s.turn({ ...START, skillPayload: { persona: 'no-such-persona' } });
      expect(start.events.filter((e) => e.type === 'error')).toEqual([]);
      // No persona: the role-play skill is never used. With no text and no material, the coach
      // fallback routes the start to the teacher, so the prompt holds no persona section at all.
      expect(start.system).not.toBe('');
      expect(start.system).not.toContain(ROLEPLAY);
      expect(start.system).not.toContain(PERSONA_SECTION);
      expect(start.system).not.toContain(PERSONA_NAME);
    },
    20000,
  );
});
