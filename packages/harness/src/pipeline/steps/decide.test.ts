import { PedagogyDecisionSchema, type TurnContext, type TurnInput } from '@edmate/contracts';
import {
  demoAgentConfig,
  demoChunk,
  demoChunkScored,
  demoPersona,
  demoTurnInput,
} from '@edmate/contracts/fixtures';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { composeSystemPrompt, LockedMaterialError } from '../../pedagogy/compose.js';
import { decidePolicy, fallbackPolicy } from '../../pedagogy/policy.js';
import {
  createPromptPackLibrary,
  parsePromptPackSet,
  UnknownPromptPackVersionError,
} from '../../pedagogy/promptPacks.js';
import { ctxWith, type CtxOverrides, deepFreeze, helpWith } from '../../pedagogy/testing.js';
import {
  FIXTURE_PROMPT_PACK_VERSION,
  fixturePromptPackRaw,
  fixturePromptPackSet,
} from '../../testing/promptPackFixtures.js';
import { memoryToolRegistry, testTool } from '../../testing/memoryToolRegistry.js';
import { stepEnvExtras, testDeps } from '../../testing/testSteps.js';
import { DecideResultSchema } from '../results.js';
import type { PipelineDeps, StepEnv } from '../types.js';
import { decide } from './decide.js';

const agent = { ...demoAgentConfig, promptPackVersion: FIXTURE_PROMPT_PACK_VERSION };
const ctx = (o: CtxOverrides = {}): TurnContext => ctxWith({ agent, ...o });

function env(
  input: TurnInput = demoTurnInput,
  deps: Partial<PipelineDeps> = {},
  reported: unknown[] = [],
): StepEnv {
  return {
    input,
    deps: { ...testDeps().deps, ...deps },
    cancel: { cancelled: false, onCancel: () => undefined },
    turnId: 'turn_test',
    ...stepEnvExtras(reported),
  };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('decide.run: tools (3.7)', () => {
  it('passes only the entitled registry tools to the policy; the fallback gets none', async () => {
    const tools = memoryToolRegistry([
      testTool({ name: 'calculator', skill: 'coach' }),
      testTool({ name: 'interview.next', skill: 'mock_interview' }),
    ]);
    const e = env(demoTurnInput, { tools });
    const x = { ctx: ctx(), help: helpWith({ stuckTurns: 1 }) };
    const r = await decide.run(e, x);
    expect(r.decision.move).toBe('hint');
    expect(r.decision.tools).toEqual(['calculator']);
    expect(decide.fallback(e, x).decision.tools).toEqual([]);
  });

  it('with no registry the decision names no tools', async () => {
    const r = await decide.run(env(), { ctx: ctx(), help: helpWith({ stuckTurns: 1 }) });
    expect(r.decision.tools).toEqual([]);
  });
});

describe('decide.run', () => {
  it('= decidePolicy + the composer → a DecideResult that parses', async () => {
    const c = ctx();
    const help = helpWith({ answerKey: ['5/6'] });
    const r = await decide.run(env(), { ctx: c, help });
    expect(DecideResultSchema.parse(r)).toEqual(r);
    expect(PedagogyDecisionSchema.parse(r.decision)).toEqual(r.decision);

    const p = decidePolicy({ ctx: c, turn: demoTurnInput, help });
    const composed = composeSystemPrompt({
      ctx: c,
      policy: p,
      lang: 'en',
      set: fixturePromptPackSet,
    });
    expect(r).toEqual({
      decision: {
        move: p.move,
        rung: p.rung,
        mustNotReveal: ['5/6'],
        systemPrompt: composed.systemPrompt,
        tools: p.tools,
        maxOutputTokens: p.maxOutputTokens,
      },
      next: { rung: p.next.helpRung, help: p.next.help },
      reason: p.reason,
      promptPack: composed.promptPack,
      sources: composed.sources,
    });
    expect(r.sources).toEqual([demoChunkScored.source]);
  });

  it('the help state reaches the policy (a second stuck turn climbs the ladder)', async () => {
    const stuck = await decide.run(env(), { ctx: ctx(), help: helpWith({ stuckTurns: 1 }) });
    const fresh = await decide.run(env(), { ctx: ctx(), help: helpWith() });
    expect(fresh.decision).toMatchObject({ move: 'ask', rung: 0 });
    expect(stuck.decision).toMatchObject({ move: 'hint', rung: 1 });
    expect(stuck.next).toEqual({ rung: 1, help: helpWith() });
  });

  it('reads the role-play control from the text and hands it to the policy (3.11e)', async () => {
    const c = ctx({ persona: demoPersona, entitlement: { skills: ['mock_interview'] } });
    const help = helpWith({ personaQuestionsAsked: 3, personaId: demoPersona.id });
    const turn = (o: Partial<TurnInput>): TurnInput => ({
      ...demoTurnInput,
      kind: 'message',
      skill: 'mock_interview',
      ...o,
    });
    const asked = async (i: TurnInput) =>
      (await decide.run(env(i), { ctx: c, help })).next.help.personaQuestionsAsked;
    expect(await asked(turn({ text: '/pause' }))).toBe(3);
    expect(await asked(turn({ text: 'Stop.' }))).toBe(3);
    expect(await asked(turn({ text: 'My answer is a hash map.' }))).toBe(4);
    expect(await asked(turn({ kind: 'skill_action' }))).toBe(1);
  });

  it('uses the input language and the input kind', async () => {
    // Pilot policy (3.11c): `demoAgentConfig` fixture is `['en', 'hi']`, so the reply is clamped
    // to English regardless of the input language (see compose.test.ts for the clamp itself).
    const r = await decide.run(env({ ...demoTurnInput, lang: 'hi' }), {
      ctx: ctx(),
      help: helpWith(),
    });
    expect(r.decision.systemPrompt).toContain('Reply in language en.');
    const hint = await decide.run(env({ ...demoTurnInput, kind: 'hint_request' }), {
      ctx: ctx(),
      help: helpWith(),
    });
    expect(hint.decision.move).toBe('hint');
  });

  it('uses exactly the set the agent pins', async () => {
    const raw = JSON.parse(JSON.stringify(fixturePromptPackRaw)) as typeof fixturePromptPackRaw;
    if (raw.packs.safety === undefined) throw new Error('fixture');
    raw.packs.safety.body = '[[SAFETY-V2]] Newer.';
    const v2 = parsePromptPackSet({ ...raw, version: '0.2.0-fixture' });
    const promptPacks = createPromptPackLibrary([fixturePromptPackSet, v2]);
    const e = env(demoTurnInput, { promptPacks });
    const a = await decide.run(e, { ctx: ctx(), help: helpWith() });
    const b = await decide.run(e, {
      ctx: ctx({ agent: { ...agent, promptPackVersion: '0.2.0-fixture' } }),
      help: helpWith(),
    });
    expect(a.promptPack.set).toBe(FIXTURE_PROMPT_PACK_VERSION);
    expect(a.decision.systemPrompt).not.toContain('[[SAFETY-V2]]');
    expect(b.promptPack.set).toBe('0.2.0-fixture');
    expect(b.decision.systemPrompt).toContain('[[SAFETY-V2]]');
  });

  it('an unknown prompt-pack version → run rejects and fallback throws', async () => {
    const c = ctx({ agent: { ...agent, promptPackVersion: '9.9.9' } });
    await expect(decide.run(env(), { ctx: c, help: helpWith() })).rejects.toBeInstanceOf(
      UnknownPromptPackVersionError,
    );
    expect(() => decide.fallback(env(), { ctx: c, help: helpWith() })).toThrow(
      UnknownPromptPackVersionError,
    );
  });

  it('reports a background warning when the agent is not pinned to English only (pilot policy)', async () => {
    const reported: unknown[] = [];
    await decide.run(env(demoTurnInput, {}, reported), { ctx: ctx(), help: helpWith() });
    expect(reported).toHaveLength(1);
    expect((reported[0] as Error).name).toBe('PilotLanguageClamped');
  });

  it('reports no background warning for an English-only agent', async () => {
    const reported: unknown[] = [];
    await decide.run(env(demoTurnInput, {}, reported), {
      ctx: ctx({ agent: { ...agent, languages: ['en'] } }),
      help: helpWith(),
    });
    expect(reported).toEqual([]);
  });

  it('distress → the distress pack; off_topic → the redirect pack', async () => {
    const d = await decide.run(env(), { ctx: ctx({ intent: 'distress' }), help: helpWith() });
    const o = await decide.run(env(), { ctx: ctx({ intent: 'off_topic' }), help: helpWith() });
    expect(d.reason).toBe('distress');
    expect(d.decision.move).toBe('redirect');
    expect(d.decision.systemPrompt).toContain(fixturePromptPackSet.packs.distress.body);
    expect(d.decision.systemPrompt).not.toContain(fixturePromptPackSet.packs.redirect.body);
    expect(o.decision.systemPrompt).toContain(fixturePromptPackSet.packs.redirect.body);
    expect(o.decision.systemPrompt).not.toContain(fixturePromptPackSet.packs.distress.body);
  });

  it('is pure: frozen inputs pass; no clock or randomness', async () => {
    const now = vi.spyOn(Date, 'now');
    const rnd = vi.spyOn(Math, 'random');
    const x = deepFreeze({ ctx: ctx(), help: helpWith({ answerKey: ['5/6'] }) });
    const e = env();
    const a = await decide.run(e, x);
    const b = await decide.run(e, x);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    expect(now).not.toHaveBeenCalled();
    expect(rnd).not.toHaveBeenCalled();
  });
});

describe('decide.fallback', () => {
  it('= fallbackPolicy + the composer: move ask, the fallback pack, no material', () => {
    const c = ctx();
    const help = helpWith({ answerKey: ['5/6'] });
    const r = decide.fallback(env(), { ctx: c, help });
    const p = fallbackPolicy(c, help);
    expect(DecideResultSchema.parse(r)).toEqual(r);
    expect(r.decision).toMatchObject({ move: 'ask', mustNotReveal: ['5/6'], tools: [] });
    // postGuard still gets the key; the fallback prompt does not (closed modes carry no key).
    expect(r.decision.systemPrompt).not.toContain('5/6');
    expect(r.reason).toBe('fallback');
    expect(r.next).toEqual({ rung: p.next.helpRung, help: p.next.help });
    expect(r.decision.systemPrompt).toContain(fixturePromptPackSet.packs.fallback.body);
    expect(r.decision.systemPrompt).not.toContain('[[MATERIAL]]');
    expect(r.sources).toEqual([]);
  });

  it('distress → redirect with the distress pack', () => {
    const r = decide.fallback(env(), { ctx: ctx({ intent: 'distress' }), help: helpWith() });
    expect(r.decision.move).toBe('redirect');
    expect(r.reason).toBe('distress');
    expect(r.decision.systemPrompt).toContain(fixturePromptPackSet.packs.distress.body);
  });
});

describe('locked text never included (ADR-0003)', () => {
  const CANARIES = ['CANARY_ALLOWED_91ab', 'CANARY_LOCKED_22cd', 'CANARY_OTHER_TEACHER_33ef'];

  function leaky(): TurnContext {
    return {
      ...ctx(),
      retrieved: [
        { ...demoChunkScored, text: CANARIES[0] as string },
        { ...demoChunk, id: 'chk_locked', moduleId: 'mod_test_04', text: CANARIES[1] as string },
        { ...demoChunk, id: 'chk_other', teacherId: 'tch_other', text: CANARIES[2] as string },
      ],
    };
  }

  it('run rejects with no canary in the error', async () => {
    const err: unknown = await decide
      .run(env(), { ctx: leaky(), help: helpWith() })
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(LockedMaterialError);
    for (const c of CANARIES) expect(String((err as Error).message)).not.toContain(c);
  });

  it('the fallback prompt has no canary and no material', () => {
    const r = decide.fallback(env(), { ctx: leaky(), help: helpWith() });
    const json = JSON.stringify(r);
    for (const c of CANARIES) expect(json).not.toContain(c);
    expect(r.decision.systemPrompt).not.toContain('[[MATERIAL]]');
  });
});
