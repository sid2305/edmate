import { PedagogyDecisionSchema } from '@edmate/contracts';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { HelpStateSchema, INITIAL_HELP_STATE } from './helpState.js';
import { decidePolicy, fallbackPolicy, type PolicyInput, type PolicyResult } from './policy.js';
import { type CtxOverrides, ctxWith, deepFreeze, helpWith, turnOf } from './testing.js';

const TOOLS = [
  { name: 'calculator', skill: 'coach' },
  { name: 'grapher', skill: 'coach' },
  { name: 'calculator', skill: 'coach' },
  { name: 'flashcards', skill: 'revision' },
  { name: 'interview_timer', skill: 'mock_interview' },
] as const satisfies PolicyInput['tools'];

function base(o: Partial<PolicyInput> = {}): PolicyInput {
  return { ctx: ctxWith(), turn: turnOf(), help: helpWith(), tools: TOOLS, ...o };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('intents', () => {
  it.each([
    ['off_topic', 'redirect', 'off_topic'],
    ['misuse', 'redirect', 'misuse'],
    ['meta', 'redirect', 'meta'],
    ['distress', 'redirect', 'distress'],
    ['on_task', 'ask', 'no_progress_once'],
    ['answer_seeking', 'hint', 'climb'],
  ] as const)('%s → %s', (intent, move, reason) => {
    const r = decidePolicy(base({ ctx: ctxWith({ intent }) }));
    expect([r.move, r.reason]).toEqual([move, reason]);
    if (move === 'redirect') {
      expect(r.tools).toEqual([]);
      expect(r.skill).toBeNull();
    }
  });

  it('distress wins over a missing entitlement and over coverage', () => {
    const r = decidePolicy(
      base({ ctx: ctxWith({ intent: 'distress', retrieved: [], entitlement: { skills: [] } }) }),
    );
    expect([r.move, r.reason]).toEqual(['redirect', 'distress']);
  });

  it('a locked skill wins over off_topic', () => {
    const r = decidePolicy(
      base({ ctx: ctxWith({ intent: 'off_topic' }), turn: turnOf('skill_action', 'study_plan') }),
    );
    expect(r.move).toBe('locked');
  });

  it('off_topic wins over coverage', () => {
    const r = decidePolicy(base({ ctx: ctxWith({ intent: 'off_topic', retrieved: [] }) }));
    expect(r.move).toBe('redirect');
  });
});

describe('tools', () => {
  it('offers the turn skill tools only, deduplicated, in order', () => {
    expect(decidePolicy(base()).tools).toEqual(['calculator', 'grapher']);
  });

  it('offers none when tools are omitted', () => {
    const noTools: PolicyInput = { ctx: ctxWith(), turn: turnOf(), help: helpWith() };
    expect(decidePolicy(noTools).tools).toEqual([]);
  });

  it('a tool for another skill is not offered', () => {
    const r = decidePolicy(base({ turn: turnOf('skill_action', 'revision') }));
    expect(r.tools).toEqual(['flashcards']);
  });

  it('mock_interview without a persona falls back to coach tools, not interview tools', () => {
    const r = decidePolicy(
      base({
        ctx: ctxWith({ entitlement: { skills: ['coach', 'mock_interview'] } }),
        turn: turnOf('skill_action', 'mock_interview'),
      }),
    );
    expect(r.tools).toEqual(['calculator', 'grapher']);
  });

  it('coach tools are not offered when coach itself is not entitled', () => {
    const r = decidePolicy(
      base({
        ctx: ctxWith({ entitlement: { skills: ['mock_interview'] } }),
        turn: turnOf('skill_action', 'mock_interview'),
      }),
    );
    expect(r.skill).toBe('coach');
    expect(r.tools).toEqual([]);
  });

  it.each<[string, CtxOverrides]>([
    ['locked', { entitlement: { skills: [] } }],
    ['ask_teacher', { retrieved: [] }],
    ['locked', { retrieved: [], lockedHit: true }],
    ['redirect', { intent: 'meta' }],
  ])('%s gets no tools', (move, o) => {
    const r = decidePolicy(base({ ctx: ctxWith(o) }));
    expect(r.move).toBe(move);
    expect(r.tools).toEqual([]);
    expect(r.skill).toBeNull();
  });
});

describe('mustNotReveal', () => {
  const key = ['5/6', 'five sixths'];

  it('holds the answer key for every move except solution', () => {
    const r = decidePolicy(base({ help: helpWith({ answerKey: key }) }));
    expect(r.mustNotReveal).toEqual(key);
    expect(r.mustNotReveal).not.toBe(key);
  });

  it('is empty for a solution', () => {
    const r = decidePolicy(
      base({
        ctx: ctxWith({ helpRung: 3, pkg: { finalAnswers: 'allowed' } }),
        turn: turnOf('hint_request'),
        help: helpWith({ answerKey: key }),
      }),
    );
    expect(r.move).toBe('solution');
    expect(r.mustNotReveal).toEqual([]);
  });

  it('holds the answer key on redirect, locked and ask_teacher', () => {
    for (const o of [{ intent: 'misuse' as const }, { retrieved: [] }]) {
      const r = decidePolicy(base({ ctx: ctxWith(o), help: helpWith({ answerKey: key }) }));
      expect(r.mustNotReveal).toEqual(key);
    }
  });
});

describe('purity and determinism', () => {
  it('reads deep-frozen inputs without mutating them and returns fresh state', () => {
    const input = deepFreeze(base({ help: helpWith({ answerKey: ['a'], stuckTurns: 1 }) }));
    const r = decidePolicy(input);
    expect(r.next.help).not.toBe(input.help);
    expect(Object.isFrozen(r.next.help)).toBe(false);
    expect(() => fallbackPolicy(input.ctx, input.help)).not.toThrow();
  });

  it('the same input twice gives deep-equal output', () => {
    const a = decidePolicy(base({ ctx: ctxWith({ helpRung: 2, attempt: 'wrong' }) }));
    const b = decidePolicy(base({ ctx: ctxWith({ helpRung: 2, attempt: 'wrong' }) }));
    expect(a).toEqual(b);
  });

  it('never touches the clock or randomness', () => {
    const now = vi.spyOn(Date, 'now');
    const rand = vi.spyOn(Math, 'random');
    decidePolicy(base({ turn: turnOf('hint_request') }));
    fallbackPolicy(ctxWith());
    expect(now).not.toHaveBeenCalled();
    expect(rand).not.toHaveBeenCalled();
  });

  it('a result plus a test-only systemPrompt parses as a PedagogyDecision', () => {
    const inputs: PolicyResult[] = [
      decidePolicy(base()),
      decidePolicy(base({ ctx: ctxWith({ retrieved: [] }) })),
      decidePolicy(base({ ctx: ctxWith({ helpRung: 4 }), help: helpWith({ pendingCheck: true }) })),
      fallbackPolicy(ctxWith({ helpRung: 4 })),
    ];
    for (const r of inputs) {
      const decision = {
        move: r.move,
        rung: r.rung,
        mustNotReveal: r.mustNotReveal,
        systemPrompt: 'test only',
        tools: r.tools,
        maxOutputTokens: r.maxOutputTokens,
      };
      expect(PedagogyDecisionSchema.parse(decision)).toEqual(decision);
      expect(HelpStateSchema.parse(r.next.help)).toEqual(r.next.help);
    }
  });
});

describe('fallbackPolicy', () => {
  it('asks, clamps the rung to the package ceiling, offers no tools and keeps state', () => {
    const r = fallbackPolicy(
      ctxWith({ helpRung: 4, pkg: { helpCeiling: 4, finalAnswers: 'never' } }),
    );
    expect(r).toEqual({
      move: 'ask',
      rung: 3,
      skill: null,
      mustNotReveal: [],
      tools: [],
      maxOutputTokens: 200,
      next: { helpRung: 4, help: INITIAL_HELP_STATE },
      reason: 'fallback',
    });
  });

  it('keeps the answer key out of the reply when the help state is known', () => {
    const help = helpWith({ answerKey: ['42'] });
    const r = fallbackPolicy(ctxWith(), help);
    expect(r.mustNotReveal).toEqual(['42']);
    expect(r.next.help).toEqual(help);
    expect(r.next.help).not.toBe(help);
  });
});

describe('help state', () => {
  it('INITIAL_HELP_STATE is valid and frozen', () => {
    expect(HelpStateSchema.parse(INITIAL_HELP_STATE)).toEqual(helpWith());
    expect(Object.isFrozen(INITIAL_HELP_STATE)).toBe(true);
    expect(Object.isFrozen(INITIAL_HELP_STATE.answerKey)).toBe(true);
  });

  it.each([
    ['stuckTurns 2', { ...helpWith(), stuckTurns: 2 }],
    ['an extra key', { ...helpWith(), rung: 1 }],
    ['a missing key', { stuckTurns: 0, attemptLogged: false, pendingCheck: false }],
  ])('rejects %s', (_n, v) => {
    expect(HelpStateSchema.safeParse(v).success).toBe(false);
  });
});
