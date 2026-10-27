import { PedagogyDecisionSchema } from '@edmate/contracts';
import { demoChunkScored, demoPersona } from '@edmate/contracts/fixtures';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { type HelpState, HelpStateSchema, INITIAL_HELP_STATE } from './helpState.js';
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

  it('mock_interview as the only skill, no persona → locked, never the coach ladder', () => {
    for (const helpRung of [0, 3, 4] as const) {
      const r = decidePolicy(
        base({
          ctx: ctxWith({
            entitlement: { skills: ['mock_interview'] },
            helpRung,
            intent: 'answer_seeking',
            pkg: { finalAnswers: 'allowed' },
          }),
          turn: turnOf('hint_request', 'mock_interview'),
          help: helpWith({ answerKey: ['5/6'], attemptLogged: true }),
        }),
      );
      expect([r.move, r.skill, r.reason]).toEqual(['locked', null, 'no_persona']);
      expect(r.tools).toEqual([]);
      expect(r.mustNotReveal).toEqual(['5/6']);
      expect(r.next.helpRung).toBe(helpRung);
    }
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

  it('a practice item: a forced solution move is capped at the worked example, key held (5.6)', () => {
    // The same turn as above (coach skill, finalAnswers allowed, rung 3, hint request), which
    // reaches the solution rung, but the help state holds a practice item's key.
    const r = decidePolicy(
      base({
        ctx: ctxWith({ helpRung: 3, pkg: { finalAnswers: 'allowed' } }),
        turn: turnOf('hint_request'),
        help: helpWith({ answerKey: ['7'], practiceItemId: 'item-1' }),
      }),
    );
    expect(r.skill).toBe('coach');
    expect(r.move).toBe('worked_example');
    expect(r.rung).toBe(3);
    expect(r.reason).toBe('at_ceiling');
    expect(r.mustNotReveal).toEqual(['7']);
  });

  it('an active practice item with no key left (solved) no longer caps coach', () => {
    const r = decidePolicy(
      base({
        ctx: ctxWith({ helpRung: 3, pkg: { finalAnswers: 'allowed' } }),
        turn: turnOf('hint_request'),
        help: helpWith({ answerKey: [], practiceItemId: 'item-1' }),
      }),
    );
    expect(r.move).toBe('solution');
  });

  it('holds the answer key on redirect, locked and ask_teacher', () => {
    for (const o of [{ intent: 'misuse' as const }, { retrieved: [] }]) {
      const r = decidePolicy(base({ ctx: ctxWith(o), help: helpWith({ answerKey: key }) }));
      expect(r.mustNotReveal).toEqual(key);
    }
  });
});

describe('practice key release on a correct attempt (5.6f)', () => {
  const key = ['B'];

  it('drops the solved item key from mustNotReveal when the attempt grades correct', () => {
    const r = decidePolicy(
      base({
        ctx: ctxWith({ attempt: 'correct' }),
        help: helpWith({ answerKey: key, practiceItemId: 'item-1' }),
      }),
    );
    expect(r.mustNotReveal).toEqual([]);
  });

  it('a carried key from an unrelated skipped item stays guarded even on a correct attempt', () => {
    const r = decidePolicy(
      base({
        ctx: ctxWith({ attempt: 'correct' }),
        help: helpWith({
          answerKey: key,
          practiceItemId: 'item-1',
          practiceCarriedKey: ['4321'],
        }),
      }),
    );
    expect(r.mustNotReveal).toEqual(['4321']);
  });

  it.each(['wrong', 'partial', 'none'] as const)(
    'an attempt graded %s keeps the key guarded (regression)',
    (attempt) => {
      const r = decidePolicy(
        base({
          ctx: ctxWith({ attempt }),
          help: helpWith({ answerKey: key, practiceItemId: 'item-1' }),
        }),
      );
      expect(r.mustNotReveal).toEqual(key);
    },
  );

  it.each([['distress' as const], ['misuse' as const], ['off_topic' as const], ['meta' as const]])(
    'a closed path (%s) never releases the key even if attempt reads correct',
    (intent) => {
      const r = decidePolicy(
        base({
          ctx: ctxWith({ intent, attempt: 'correct' }),
          help: helpWith({ answerKey: key, practiceItemId: 'item-1' }),
        }),
      );
      expect(r.mustNotReveal).toEqual(key);
    },
  );

  it('a locked skill never releases the key even if attempt reads correct', () => {
    const r = decidePolicy(
      base({
        ctx: ctxWith({ entitlement: { skills: [] }, attempt: 'correct' }),
        help: helpWith({ answerKey: key, practiceItemId: 'item-1' }),
      }),
    );
    expect(r.move).toBe('locked');
    expect(r.mustNotReveal).toEqual(key);
  });

  it('not_covered never releases the key even if attempt reads correct', () => {
    const r = decidePolicy(
      base({
        ctx: ctxWith({ retrieved: [], attempt: 'correct' }),
        help: helpWith({ answerKey: key, practiceItemId: 'item-1' }),
      }),
    );
    expect(r.move).toBe('ask_teacher');
    expect(r.mustNotReveal).toEqual(key);
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

describe('promptKeys and the carried key (5.6c, ADR-0011)', () => {
  const key = ['5/6', 'five sixths'];
  const practice = { answerKey: ['7'], practiceItemId: 'item-2' };
  const carried = { practiceCarriedKey: ['4321'] };
  const solutionTurn = {
    ctx: ctxWith({ helpRung: 3, pkg: { finalAnswers: 'allowed' } }),
    turn: turnOf('hint_request'),
  } as const;

  it('a non-practice key is in both lists (the 3.6 behaviour)', () => {
    const r = decidePolicy(base({ help: helpWith({ answerKey: key }) }));
    expect(r.mustNotReveal).toEqual(key);
    expect(r.promptKeys).toEqual(key);
    expect(r.promptKeys).not.toBe(r.mustNotReveal);
  });

  it('a held practice key and a carried key are guarded, never prompted', () => {
    const r = decidePolicy(base({ help: helpWith({ ...practice, ...carried }) }));
    expect(r.mustNotReveal).toEqual(['7', '4321']);
    expect(r.promptKeys).toEqual([]);
  });

  it('a held practice key alone: guarded, never prompted', () => {
    const r = decidePolicy(base({ help: helpWith(practice) }));
    expect(r.mustNotReveal).toEqual(['7']);
    expect(r.promptKeys).toEqual([]);
  });

  it('any carried key empties promptKeys, even next to a non-practice key', () => {
    const r = decidePolicy(base({ help: helpWith({ answerKey: key, ...carried }) }));
    expect(r.mustNotReveal).toEqual([...key, '4321']);
    expect(r.promptKeys).toEqual([]);
  });

  it('a carried key already in answerKey is listed once', () => {
    const r = decidePolicy(base({ help: helpWith({ ...practice, practiceCarriedKey: ['7'] }) }));
    expect(r.mustNotReveal).toEqual(['7']);
  });

  it('a solution move releases a non-practice key but keeps a carried key', () => {
    const r = decidePolicy(
      base({ ...solutionTurn, help: helpWith({ answerKey: key, ...carried }) }),
    );
    expect(r.move).toBe('solution');
    expect(r.mustNotReveal).toEqual(['4321']);
    expect(r.promptKeys).toEqual([]);
  });

  it('closed moves keep the carried key too', () => {
    for (const o of [
      { intent: 'misuse' as const },
      { retrieved: [] },
      { intent: 'distress' as const },
    ]) {
      const r = decidePolicy(base({ ctx: ctxWith(o), help: helpWith(carried) }));
      expect(r.mustNotReveal).toEqual(['4321']);
      expect(r.promptKeys).toEqual([]);
    }
  });

  it('fallbackPolicy keeps the carried key on both branches, distress included', () => {
    for (const intent of ['on_task', 'distress'] as const) {
      const r = fallbackPolicy(ctxWith({ intent }), helpWith({ ...practice, ...carried }));
      expect(r.mustNotReveal).toEqual(['7', '4321']);
      expect(r.promptKeys).toEqual([]);
    }
    const plain = fallbackPolicy(ctxWith(), helpWith({ answerKey: key }));
    expect(plain.promptKeys).toEqual(key);
  });

  it('promptKeys is always a subset of mustNotReveal', () => {
    const helps = [
      helpWith(),
      helpWith({ answerKey: key }),
      helpWith(practice),
      helpWith(carried),
      helpWith({ ...practice, ...carried }),
    ];
    for (const help of helps) {
      for (const r of [
        decidePolicy(base({ help })),
        decidePolicy(base({ ...solutionTurn, help })),
        fallbackPolicy(ctxWith(), help),
      ]) {
        for (const k of r.promptKeys) expect(r.mustNotReveal).toContain(k);
      }
    }
  });
});

describe('fallbackPolicy', () => {
  it('a distress turn falls back to redirect with the distress reason, not ask', () => {
    const help = helpWith({ answerKey: ['42'] });
    const r = fallbackPolicy(ctxWith({ intent: 'distress', helpRung: 2 }), help);
    expect(r).toEqual({
      move: 'redirect',
      rung: 0,
      skill: null,
      mustNotReveal: ['42'],
      promptKeys: ['42'],
      tools: [],
      maxOutputTokens: 150,
      next: { helpRung: 2, help },
      reason: 'distress',
    });
  });

  it('asks, clamps the rung to the package ceiling, offers no tools and keeps state', () => {
    const r = fallbackPolicy(
      ctxWith({ helpRung: 4, pkg: { helpCeiling: 4, finalAnswers: 'never' } }),
    );
    expect(r).toEqual({
      move: 'ask',
      rung: 3,
      skill: null,
      mustNotReveal: [],
      promptKeys: [],
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

describe('rolePlay passes through decidePolicy (5.8, ADR-0013 §1)', () => {
  const skills = ['coach' as const, 'mock_interview' as const];
  const M = demoPersona.endAfterQuestions;

  it('a mock_interview turn with a persona carries this turn’s rolePlay', () => {
    const r = decidePolicy(
      base({
        ctx: ctxWith({ entitlement: { skills }, persona: demoPersona }),
        turn: turnOf('message', 'mock_interview'),
        help: helpWith({ personaQuestionsAsked: M, personaId: demoPersona.id }),
      }),
    );
    expect(r.rolePlay).toEqual({ phase: 'debrief', total: M });
    expect(r.next.help.personaPhase).toBe('ended');
    expect(r.move).toBe('ask');
    expect(r.maxOutputTokens).toBe(350);
  });

  it('a non-persona turn, a closed move and the fallback carry none', () => {
    const results = [
      decidePolicy(base()),
      decidePolicy(
        base({
          ctx: ctxWith({ entitlement: { skills }, persona: demoPersona, intent: 'off_topic' }),
          turn: turnOf('message', 'mock_interview'),
        }),
      ),
      fallbackPolicy(ctxWith({ entitlement: { skills }, persona: demoPersona })),
    ];
    for (const r of results) expect(r).not.toHaveProperty('rolePlay');
  });
});

describe('role-play turns and the coverage gate (5.8, open question 6: lead default, pending B-37)', () => {
  const skills = ['coach' as const, 'mock_interview' as const];
  const M = demoPersona.endAfterQuestions;
  const id = demoPersona.id;
  const uncovered = (o: CtxOverrides = {}) =>
    ctxWith({ entitlement: { skills }, persona: demoPersona, retrieved: [], ...o });
  const run = (
    help: Partial<HelpState>,
    control?: PolicyInput['control'],
    kind: 'message' | 'skill_action' = 'message',
    ctx = uncovered(),
  ) =>
    decidePolicy(
      base({
        ctx,
        turn: turnOf(kind, 'mock_interview'),
        help: helpWith(help),
        ...(control === undefined ? {} : { control }),
      }),
    );

  it('an uncovered start opens question 1 (it asks which topic) and never asks the teacher', () => {
    const r = run({}, 'start', 'skill_action');
    expect([r.move, r.reason]).toEqual(['ask', 'mock_interview']);
    expect(r.rolePlay).toEqual({ phase: 'question', question: 1, total: M });
    expect(r.next.help.personaQuestionsAsked).toBe(1);
  });

  it('an uncovered start with a locked hit still opens the role-play', () => {
    const r = run({}, 'start', 'skill_action', uncovered({ lockedHit: true }));
    expect(r.rolePlay).toEqual({ phase: 'question', question: 1, total: M });
  });

  it.each([
    ['pause', { personaQuestionsAsked: 2, personaId: id }, 'pause', 'paused'],
    ['stopped', { personaQuestionsAsked: 2, personaId: id }, 'stop', 'ended'],
    [
      'resume',
      { personaQuestionsAsked: 2, personaId: id, personaPhase: 'paused' },
      undefined,
      undefined,
    ],
    ['debrief', { personaQuestionsAsked: M, personaId: id }, undefined, 'ended'],
  ] as const)('an uncovered %s turn passes the gate (skipped)', (phase, help, control, stored) => {
    const r = run(help, control);
    expect([r.move, r.reason]).toEqual(['ask', 'mock_interview']);
    expect(r.rolePlay?.phase).toBe(phase);
    expect(r.next.help.personaPhase).toBe(stored);
    expect(r.rolePlayGateSkipped).toBe(true);
  });

  it('an uncovered answer to question N (a question turn) now skips the gate (B-37 reversal)', () => {
    const r = run({ personaQuestionsAsked: 2, personaId: id });
    expect([r.move, r.reason]).toEqual(['ask', 'mock_interview']);
    expect(r.rolePlay?.phase).toBe('question');
    expect(r.rolePlayGateSkipped).toBe(true);
    expect(r.next.help.personaQuestionsAsked).toBe(3);
  });

  it('an uncovered ended turn still meets the gate (B-37 final rule)', () => {
    const help = { personaQuestionsAsked: M, personaId: id, personaPhase: 'ended' as const };
    const r = run(help);
    expect([r.move, r.reason]).toEqual(['ask_teacher', 'not_covered']);
    expect(r).not.toHaveProperty('rolePlay');
    expect(r.next.help.personaPhase).toBe('ended');
  });

  it('an ended turn with a locked hit is locked (the gate still applies)', () => {
    const help = { personaQuestionsAsked: M, personaId: id, personaPhase: 'ended' as const };
    const r = run(help, undefined, 'message', uncovered({ lockedHit: true }));
    expect([r.move, r.reason]).toEqual(['locked', 'locked_module']);
  });

  it('a /pause with extra text meets the gate; a bare /pause skips it (B-37 q8)', () => {
    const help = { personaQuestionsAsked: 2, personaId: id };
    const bare = decidePolicy(
      base({
        ctx: uncovered(),
        turn: turnOf('message', 'mock_interview'),
        help: helpWith(help),
        control: 'pause',
      }),
    );
    expect([bare.move, bare.reason]).toEqual(['ask', 'mock_interview']);
    expect(bare.rolePlayGateSkipped).toBe(true);

    const withText = decidePolicy(
      base({
        ctx: uncovered(),
        turn: turnOf('message', 'mock_interview'),
        help: helpWith(help),
        control: 'pause',
        pauseHasExtraText: true,
      }),
    );
    expect([withText.move, withText.reason]).toEqual(['ask_teacher', 'not_covered']);
    expect(withText).not.toHaveProperty('rolePlay');
  });

  it('an uncovered question turn with a locked hit still skips the gate (B-37 reversal)', () => {
    const help = { personaQuestionsAsked: 2, personaId: id };
    const r = run(help, undefined, 'message', uncovered({ lockedHit: true }));
    expect([r.move, r.reason]).toEqual(['ask', 'mock_interview']);
    expect(r.rolePlayGateSkipped).toBe(true);
  });

  it.each([
    ['meta', 'stop', 'stopped', 'ended'],
    ['off_topic', 'stop', 'stopped', 'ended'],
    ['meta', 'pause', 'pause', 'paused'],
    ['off_topic', 'pause', 'pause', 'paused'],
  ] as const)(
    'a %s-routed `%s` during an active role-play still changes the phase (fix round 1)',
    (intent, control, phase, stored) => {
      const help = { personaQuestionsAsked: 2, personaId: id };
      const r = run(help, control, 'message', uncovered({ intent }));
      expect([r.move, r.reason]).toEqual(['ask', 'mock_interview']);
      expect(r.rolePlay?.phase).toBe(phase);
      expect(r.next.help.personaPhase).toBe(stored);
    },
  );

  it('distress and misuse still close before a role-play control (safety first)', () => {
    const help = { personaQuestionsAsked: 2, personaId: id };
    for (const control of ['stop', 'pause', 'start'] as const) {
      for (const intent of ['distress', 'misuse'] as const) {
        const r = run(help, control, 'message', uncovered({ intent }));
        expect([r.move, r.reason]).toEqual(['redirect', intent]);
        expect(r).not.toHaveProperty('rolePlay');
        expect(r.next.help.personaPhase).toBeUndefined();
        expect(r.next.help.personaQuestionsAsked).toBe(2);
      }
    }
  });

  it('a meta or off_topic turn with no control, or with no active role-play, still redirects', () => {
    const active = { personaQuestionsAsked: 2, personaId: id };
    const ended = { ...active, personaPhase: 'ended' as const };
    const cases = [
      run(active, undefined, 'message', uncovered({ intent: 'meta' })),
      run(ended, 'stop', 'message', uncovered({ intent: 'off_topic' })),
      run({}, 'stop', 'message', uncovered({ intent: 'meta' })),
      run(
        { personaQuestionsAsked: 2, personaId: 'other' },
        'pause',
        'message',
        uncovered({ intent: 'meta' }),
      ),
    ];
    for (const r of cases) {
      expect(r.move).toBe('redirect');
      expect(r).not.toHaveProperty('rolePlay');
    }
  });

  it.each(['meta', 'off_topic'] as const)(
    'a /pause with extra text during an active role-play gets the ordinary %s redirect (B-37 q8, steersRolePlay fix)',
    (intent) => {
      const help = { personaQuestionsAsked: 2, personaId: id };
      const r = decidePolicy(
        base({
          ctx: uncovered({ intent }),
          turn: turnOf('message', 'mock_interview'),
          help: helpWith(help),
          control: 'pause',
          pauseHasExtraText: true,
        }),
      );
      expect([r.move, r.reason]).toEqual(['redirect', intent]);
      expect(r).not.toHaveProperty('rolePlay');
      // The phase is left exactly as it was: a redirected /pause<text> never pauses the role-play.
      expect(r.next.help.personaPhase).toBeUndefined();
      expect(r.next.help.personaQuestionsAsked).toBe(2);
    },
  );

  it('a bare /pause during an active role-play still steers past the redirect (no extra text)', () => {
    const help = { personaQuestionsAsked: 2, personaId: id };
    const r = decidePolicy(
      base({
        ctx: uncovered({ intent: 'meta' }),
        turn: turnOf('message', 'mock_interview'),
        help: helpWith(help),
        control: 'pause',
      }),
    );
    expect([r.move, r.reason]).toEqual(['ask', 'mock_interview']);
    expect(r.rolePlay?.phase).toBe('pause');
  });

  it('a covered role-play turn is unchanged by the gate rule', () => {
    const help = { personaQuestionsAsked: 2, personaId: id };
    const r = run(help, undefined, 'message', uncovered({ retrieved: [demoChunkScored] }));
    expect(r.rolePlay).toEqual({ phase: 'question', question: 3, total: M });
  });

  it('without a persona the gate runs as before (no role-play exemption)', () => {
    const r = run({}, 'stop', 'message', ctxWith({ entitlement: { skills }, retrieved: [] }));
    expect(r.move).toBe('ask_teacher');
  });
});
