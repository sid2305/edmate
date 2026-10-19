import { PedagogyDecisionSchema, type TurnContext, type TurnInput } from '@edmate/contracts';
import {
  demoAgentConfig,
  demoChunk,
  demoChunkScored,
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
import { testDeps } from '../../testing/testSteps.js';
import { DecideResultSchema } from '../results.js';
import type { PipelineDeps, StepEnv } from '../types.js';
import { decide } from './decide.js';

const agent = { ...demoAgentConfig, promptPackVersion: FIXTURE_PROMPT_PACK_VERSION };
const ctx = (o: CtxOverrides = {}): TurnContext => ctxWith({ agent, ...o });

function env(input: TurnInput = demoTurnInput, deps: Partial<PipelineDeps> = {}): StepEnv {
  return {
    input,
    deps: { ...testDeps().deps, ...deps },
    cancel: { cancelled: false, onCancel: () => undefined },
    turnId: 'turn_test',
  };
}

afterEach(() => {
  vi.restoreAllMocks();
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

  it('uses the input language and the input kind', async () => {
    const r = await decide.run(env({ ...demoTurnInput, lang: 'hi' }), {
      ctx: ctx(),
      help: helpWith(),
    });
    expect(r.decision.systemPrompt).toContain('Reply in language hi.');
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
