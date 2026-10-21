import { LIMITS } from '@edmate/contracts';
import { describe, expect, it } from 'vitest';
import {
  copyHelp,
  holdsPracticeKey,
  INITIAL_HELP_STATE,
  PRACTICE_SERVED_MAX,
  practiceFields,
  loadSessionHelp,
  PERSONA_ID_MAX,
  PERSONA_QUESTIONS_MAX,
  parseSessionHelp,
  personaFields,
  withPersonaCount,
  personaQuestionsAsked,
  serializeSessionHelp,
  SessionHelpSchema,
  PRACTICE_ID_MAX,
  PRACTICE_KEYS_MAX_JSON,
} from './helpState.js';

const VALID = {
  v: 1,
  rung: 3,
  stuckTurns: 1,
  attemptLogged: true,
  pendingCheck: false,
  answerKey: ['42'],
  lockedStopped: false,
};

const DEFAULT = { rung: 0, help: { ...INITIAL_HELP_STATE, answerKey: [] } };

describe('parseSessionHelp (ADR-0005: invalid → rung 0 / INITIAL_HELP_STATE)', () => {
  it('parses a valid stored blob into rung and help', () => {
    expect(parseSessionHelp(VALID)).toEqual({
      rung: 3,
      help: {
        stuckTurns: 1,
        attemptLogged: true,
        pendingCheck: false,
        answerKey: ['42'],
        lockedStopped: false,
      },
    });
  });

  it('parses lockedStopped true (4.6b: set for the rest of a session after a locked hit)', () => {
    expect(parseSessionHelp({ ...VALID, lockedStopped: true }).help.lockedStopped).toBe(true);
  });

  it.each([
    ['undefined', undefined],
    ['null', null],
    ['the db default {}', {}],
    ['a string', 'rung 3'],
    ['a number', 3],
    ['an array', [VALID]],
    ['no version', { ...VALID, v: undefined }],
    ['a future version', { ...VALID, v: 2 }],
    ['rung above 4', { ...VALID, rung: 5 }],
    ['rung below 0', { ...VALID, rung: -1 }],
    ['a fractional rung', { ...VALID, rung: 1.5 }],
    ['a string rung', { ...VALID, rung: '2' }],
    ['stuckTurns 2', { ...VALID, stuckTurns: 2 }],
    ['a non-boolean flag', { ...VALID, attemptLogged: 'yes' }],
    ['a non-string answer key', { ...VALID, answerKey: [42] }],
    ['a non-boolean lockedStopped', { ...VALID, lockedStopped: 'yes' }],
    [
      'a missing field',
      { v: 1, rung: 2, stuckTurns: 0, attemptLogged: false, pendingCheck: false },
    ],
    ['an unknown key', { ...VALID, extra: true }],
  ])('%s → the default', (_label, raw) => {
    expect(parseSessionHelp(raw)).toEqual(DEFAULT);
  });

  it('keeps the grounding escalation count when there is one, next to 4.6b’s stop flag (task 4.7)', () => {
    expect(parseSessionHelp({ ...VALID, lockedStopped: true, groundingAsks: 2 })).toEqual({
      rung: 3,
      help: {
        stuckTurns: 1,
        attemptLogged: true,
        pendingCheck: false,
        answerKey: ['42'],
        lockedStopped: true,
        groundingAsks: 2,
      },
    });
    for (const bad of [-1, 1.5, '2', 1_001]) {
      expect(parseSessionHelp({ ...VALID, groundingAsks: bad })).toEqual(DEFAULT);
    }
    const s = {
      rung: 1 as const,
      help: { ...INITIAL_HELP_STATE, answerKey: [], groundingAsks: 3 },
    };
    expect(parseSessionHelp(serializeSessionHelp(s))).toEqual(s);
  });

  it('keeps the persona question count next to the 4.6b and 4.7 fields (task 3.11d)', () => {
    const raw = { ...VALID, lockedStopped: true, groundingAsks: 1, personaQuestionsAsked: 4 };
    expect(parseSessionHelp(raw)).toEqual({
      rung: 3,
      help: {
        stuckTurns: 1,
        attemptLogged: true,
        pendingCheck: false,
        answerKey: ['42'],
        lockedStopped: true,
        groundingAsks: 1,
        personaQuestionsAsked: 4,
      },
    });
    for (const bad of [-1, 1.5, '2', PERSONA_QUESTIONS_MAX + 1, null]) {
      expect(parseSessionHelp({ ...VALID, personaQuestionsAsked: bad })).toEqual(DEFAULT);
    }
    const s = {
      rung: 2 as const,
      help: { ...INITIAL_HELP_STATE, answerKey: [], personaQuestionsAsked: 7 },
    };
    expect(parseSessionHelp(serializeSessionHelp(s))).toEqual(s);
  });

  it('an old blob without personaQuestionsAsked (before 3.11d) keeps its rung; the count reads as 0', () => {
    const old = { ...VALID, groundingAsks: 2 };
    const parsed = parseSessionHelp(old);
    expect(parsed.rung).toBe(3);
    expect(parsed.help).toEqual({
      stuckTurns: 1,
      attemptLogged: true,
      pendingCheck: false,
      answerKey: ['42'],
      lockedStopped: false,
      groundingAsks: 2,
    });
    expect(personaQuestionsAsked(parsed.help)).toBe(0);
    expect(loadSessionHelp(old).unreadable).toBe(false);
  });

  it('an old blob from before 4.6b, 4.7 and 3.11d alike still keeps its rung', () => {
    const old = {
      v: 1,
      rung: 4,
      stuckTurns: 0,
      attemptLogged: true,
      pendingCheck: true,
      answerKey: [],
    };
    expect(parseSessionHelp(old).rung).toBe(4);
    expect(personaQuestionsAsked(parseSessionHelp(old).help)).toBe(0);
  });

  it('an old blob without lockedStopped (before 4.6b) parses with its rung intact (absent = false)', () => {
    const old = {
      v: 1,
      rung: 2,
      stuckTurns: 1,
      attemptLogged: true,
      pendingCheck: false,
      answerKey: ['7'],
    };
    const parsed = parseSessionHelp(old);
    expect(parsed).toEqual({
      rung: 2,
      help: { stuckTurns: 1, attemptLogged: true, pendingCheck: false, answerKey: ['7'] },
    });
    expect(parsed.help.lockedStopped === true).toBe(false);
  });
});

describe('loadSessionHelp: whether a stored blob could be read (4.6b fix round 1)', () => {
  it.each([
    ['undefined (no row value)', undefined],
    ['null', null],
    ['the db default {}', {}],
    ['a valid blob', VALID],
  ])('%s → readable', (_label, raw) => {
    expect(loadSessionHelp(raw)).toEqual({ ...parseSessionHelp(raw), unreadable: false });
  });

  it.each([
    ['a future version', { ...VALID, v: 2 }],
    ['an unknown key', { ...VALID, extra: true }],
    ['a string', 'rung 3'],
    ['an array', [VALID]],
    ['a non-boolean lockedStopped', { ...VALID, lockedStopped: 'yes' }],
    [
      'an object that throws when read',
      new Proxy(
        {},
        {
          ownKeys() {
            throw new Error('boom');
          },
          get() {
            throw new Error('boom');
          },
        },
      ),
    ],
  ])('%s → unreadable, with the default state', (_label, raw) => {
    expect(loadSessionHelp(raw)).toEqual({ ...DEFAULT, unreadable: true });
  });

  it('the default never aliases the frozen INITIAL_HELP_STATE', () => {
    const a = parseSessionHelp(undefined);
    a.help.answerKey.push('x');
    expect(INITIAL_HELP_STATE.answerKey).toEqual([]);
    expect(parseSessionHelp(undefined).help.answerKey).toEqual([]);
  });

  it('a getter that throws while parsing still gives the default', () => {
    const raw = {
      ...VALID,
      get rung(): number {
        throw new Error('boom');
      },
    };
    expect(parseSessionHelp(raw)).toEqual(DEFAULT);
  });
});

describe('serializeSessionHelp (for 3.8 commit)', () => {
  it('round-trips through parseSessionHelp', () => {
    const s = parseSessionHelp(VALID);
    const out = serializeSessionHelp(s);
    expect(out).toEqual(VALID);
    expect(SessionHelpSchema.parse(out)).toEqual(VALID);
    expect(parseSessionHelp(JSON.parse(JSON.stringify(out)))).toEqual(s);
  });

  it('copies, so the stored value never aliases the live help state', () => {
    const s = { rung: 1 as const, help: copyHelp({ ...INITIAL_HELP_STATE, answerKey: ['a'] }) };
    const out = serializeSessionHelp(s);
    s.help.answerKey.push('b');
    expect(out.answerKey).toEqual(['a']);
  });

  it('refuses an invalid state instead of storing it', () => {
    expect(() =>
      serializeSessionHelp({ rung: 9 as 0, help: copyHelp(INITIAL_HELP_STATE) }),
    ).toThrow();
  });

  it(`refuses a state over LIMITS.helpStateMaxJsonLength (${LIMITS.helpStateMaxJsonLength})`, () => {
    const big = 'x'.repeat(LIMITS.helpStateMaxJsonLength);
    expect(() =>
      serializeSessionHelp({ rung: 0, help: { ...INITIAL_HELP_STATE, answerKey: [big] } }),
    ).toThrow(/helpStateMaxJsonLength/);
  });
});

describe('personaQuestionsAsked (3.11d: the server counts, absent = 0)', () => {
  it('reads the stored count, or 0 when absent', () => {
    expect(personaQuestionsAsked(INITIAL_HELP_STATE)).toBe(0);
    expect(personaQuestionsAsked({ ...INITIAL_HELP_STATE, personaQuestionsAsked: 3 })).toBe(3);
  });
});

describe('personaId and withPersonaCount (3.11e)', () => {
  it('parses, copies and round-trips the persona id', () => {
    const raw = { ...VALID, personaQuestionsAsked: 2, personaId: 'per_test_01' };
    const parsed = parseSessionHelp(raw);
    expect(parsed.help.personaId).toBe('per_test_01');
    expect(copyHelp(parsed.help).personaId).toBe('per_test_01');
    expect(parseSessionHelp(serializeSessionHelp(parsed))).toEqual(parsed);
    for (const bad of ['', 'p'.repeat(PERSONA_ID_MAX + 1), 3, null]) {
      expect(parseSessionHelp({ ...VALID, personaId: bad })).toEqual(DEFAULT);
    }
  });

  it('copies the count and the id from `from`, or removes them', () => {
    const next = {
      rung: 1 as const,
      help: { ...INITIAL_HELP_STATE, answerKey: [], personaQuestionsAsked: 3, personaId: 'a' },
    };
    const from = { ...INITIAL_HELP_STATE, answerKey: [], personaQuestionsAsked: 2, personaId: 'b' };
    expect(withPersonaCount(next, from)).toEqual({
      rung: 1,
      help: { ...next.help, personaQuestionsAsked: 2, personaId: 'b' },
    });
    const bare = withPersonaCount(next, INITIAL_HELP_STATE);
    expect(bare.help).not.toHaveProperty('personaQuestionsAsked');
    expect(bare.help).not.toHaveProperty('personaId');
    expect(next.help.personaQuestionsAsked).toBe(3);
  });
});

describe('personaPhase (5.8, ADR-0013 §1)', () => {
  const ROLEPLAY = { ...VALID, personaQuestionsAsked: 3, personaId: 'per_test_01' };

  it.each(['paused', 'ended'] as const)('parse keeps a stored %s phase', (phase) => {
    expect(parseSessionHelp({ ...ROLEPLAY, personaPhase: phase }).help.personaPhase).toBe(phase);
  });

  it('saves and loads: a paused and an ended role-play survive the round trip', () => {
    for (const phase of ['paused', 'ended'] as const) {
      const s = parseSessionHelp({ ...ROLEPLAY, personaPhase: phase });
      const saved = serializeSessionHelp(s);
      expect(saved.personaPhase).toBe(phase);
      const loaded = loadSessionHelp(JSON.parse(JSON.stringify(saved)));
      expect(loaded.unreadable).toBe(false);
      expect(loaded.help).toEqual(s.help);
      expect(loaded.help).toMatchObject({ personaQuestionsAsked: 3, personaPhase: phase });
    }
  });

  it('an old blob without personaPhase (before 5.8) parses with no phase and keeps its rung', () => {
    const s = parseSessionHelp(ROLEPLAY);
    expect(s.rung).toBe(3);
    expect(s.help).not.toHaveProperty('personaPhase');
    expect(serializeSessionHelp(s)).not.toHaveProperty('personaPhase');
  });

  it.each(['question', 'debrief', 'stopped', '', 'PAUSED', 1, null, true])(
    'an unknown phase %j is unreadable: rung 0 and the initial state',
    (bad) => {
      expect(parseSessionHelp({ ...ROLEPLAY, personaPhase: bad })).toEqual(DEFAULT);
      expect(loadSessionHelp({ ...ROLEPLAY, personaPhase: bad }).unreadable).toBe(true);
    },
  );

  it('serialise rejects an unknown phase, so it is never written', () => {
    const help = { ...INITIAL_HELP_STATE, answerKey: [], personaPhase: 'debrief' };
    expect(() => serializeSessionHelp({ rung: 0, help } as never)).toThrow();
  });

  it('copyHelp keeps it', () => {
    const h = { ...INITIAL_HELP_STATE, answerKey: [], personaPhase: 'ended' as const };
    expect(copyHelp(h).personaPhase).toBe('ended');
  });

  it('personaFields carries the phase with the count and the id', () => {
    const h = {
      ...INITIAL_HELP_STATE,
      answerKey: ['k'],
      personaQuestionsAsked: 2,
      personaId: 'a',
      personaPhase: 'paused' as const,
    };
    expect(personaFields(h)).toEqual({
      personaQuestionsAsked: 2,
      personaId: 'a',
      personaPhase: 'paused',
    });
    expect(personaFields(INITIAL_HELP_STATE)).toEqual({});
  });

  it('withPersonaCount takes the phase from `from`, or removes it', () => {
    const next = {
      rung: 0 as const,
      help: {
        ...INITIAL_HELP_STATE,
        answerKey: [],
        personaQuestionsAsked: 4,
        personaId: 'a',
        personaPhase: 'ended' as const,
      },
    };
    const paused = { ...INITIAL_HELP_STATE, answerKey: [], personaPhase: 'paused' as const };
    expect(withPersonaCount(next, paused).help.personaPhase).toBe('paused');
    // A failed debrief or stop turn: the loaded state had no phase, so no `ended` is kept.
    const none = withPersonaCount(next, { ...INITIAL_HELP_STATE, personaQuestionsAsked: 4 });
    expect(none.help).not.toHaveProperty('personaPhase');
    expect(next.help.personaPhase).toBe('ended');
  });
});

describe('practice fields (5.6, ADR-0010)', () => {
  const PRACTICE = {
    ...VALID,
    practiceItemId: 'item-2',
    practiceModuleId: 'mod-1',
    practiceServed: ['item-1', 'item-2'],
  };

  it('parse and serialise round-trip the active item, its module and the served ids', () => {
    const s = parseSessionHelp(PRACTICE);
    expect(s.help).toMatchObject({
      practiceItemId: 'item-2',
      practiceModuleId: 'mod-1',
      practiceServed: ['item-1', 'item-2'],
    });
    expect(serializeSessionHelp(s)).toEqual(PRACTICE);
  });

  it('a blob saved before 5.6 parses without them', () => {
    const s = parseSessionHelp(VALID);
    expect(s.help).not.toHaveProperty('practiceItemId');
    expect(s.help).not.toHaveProperty('practiceServed');
  });

  it(`refuses more than PRACTICE_SERVED_MAX (${PRACTICE_SERVED_MAX}) served ids or an empty id`, () => {
    const many = Array.from({ length: PRACTICE_SERVED_MAX + 1 }, (_, i) => `item-${i}`);
    expect(parseSessionHelp({ ...VALID, practiceServed: many })).toEqual(DEFAULT);
    expect(parseSessionHelp({ ...VALID, practiceItemId: '' })).toEqual(DEFAULT);
  });

  it('copyHelp copies the served list, so it never aliases', () => {
    const h = parseSessionHelp(PRACTICE).help;
    const c = copyHelp(h);
    expect(c.practiceServed).toEqual(h.practiceServed);
    expect(c.practiceServed).not.toBe(h.practiceServed);
  });

  it('holdsPracticeKey: an active item and a non-empty key', () => {
    const h = parseSessionHelp(PRACTICE).help;
    expect(holdsPracticeKey(h)).toBe(true);
    expect(holdsPracticeKey({ ...h, answerKey: [] })).toBe(false);
    expect(holdsPracticeKey(parseSessionHelp(VALID).help)).toBe(false);
  });

  it('practiceFields picks only the practice fields, copied', () => {
    const h = parseSessionHelp(PRACTICE).help;
    const f = practiceFields(h);
    expect(f).toEqual({
      practiceItemId: 'item-2',
      practiceModuleId: 'mod-1',
      practiceServed: ['item-1', 'item-2'],
    });
    expect(f.practiceServed).not.toBe(h.practiceServed);
    expect(practiceFields(parseSessionHelp(VALID).help)).toEqual({});
  });
});

describe('practiceCarriedKey: a skipped item key, guarded one more turn (5.6c, ADR-0011)', () => {
  const CARRIED = {
    ...VALID,
    practiceItemId: 'item-2',
    practiceServed: ['item-1', 'item-2'],
    practiceCarriedKey: ['7', 'seven'],
  };

  it('parses and round-trips through serialise', () => {
    const s = parseSessionHelp(CARRIED);
    expect(s.help.practiceCarriedKey).toEqual(['7', 'seven']);
    expect(serializeSessionHelp(s)).toEqual(CARRIED);
    expect(loadSessionHelp(CARRIED).unreadable).toBe(false);
  });

  it('a blob saved before 5.6c parses without it', () => {
    const s = parseSessionHelp(VALID);
    expect(s.help).not.toHaveProperty('practiceCarriedKey');
    expect(loadSessionHelp(VALID).unreadable).toBe(false);
  });

  it('a non-string entry is unreadable; no entry cap of its own (5.6c fix round)', () => {
    expect(parseSessionHelp({ ...VALID, practiceCarriedKey: [7] })).toEqual(DEFAULT);
    expect(loadSessionHelp({ ...VALID, practiceCarriedKey: [7] }).unreadable).toBe(true);
    expect(parseSessionHelp({ ...VALID, practiceCarriedKey: undefined })).toEqual(DEFAULT);
    // As many entries as answerKey may hold: the JSON caps bound it, not an entry count.
    const many = Array.from({ length: 65 }, (_, i) => `k${i}`);
    expect(
      parseSessionHelp({ ...VALID, practiceCarriedKey: many }).help.practiceCarriedKey,
    ).toEqual(many);
    const saved = serializeSessionHelp({
      rung: 0,
      help: { ...parseSessionHelp(VALID).help, practiceCarriedKey: many },
    });
    expect(saved.practiceCarriedKey).toEqual(many);
  });

  it('copyHelp keeps it, copied, so it never aliases', () => {
    const h = parseSessionHelp(CARRIED).help;
    const c = copyHelp(h);
    expect(c.practiceCarriedKey).toEqual(['7', 'seven']);
    expect(c.practiceCarriedKey).not.toBe(h.practiceCarriedKey);
  });

  it('practiceFields leaves it out (the runner drops it explicitly too)', () => {
    const f = practiceFields(parseSessionHelp(CARRIED).help);
    expect(f).not.toHaveProperty('practiceCarriedKey');
  });

  it('holdsPracticeKey never reads it', () => {
    const h = parseSessionHelp({ ...CARRIED, answerKey: [] }).help;
    expect(holdsPracticeKey(h)).toBe(false);
  });
});

describe('practice limits fit the stored blob (5.6 review)', () => {
  it('a state at every practice limit, with a carried key, still serialises under LIMITS.helpStateMaxJsonLength', () => {
    const id = 'i'.repeat(PRACTICE_ID_MAX);
    // The JSON of answerKey plus practiceCarriedKey is exactly PRACTICE_KEYS_MAX_JSON long.
    const half = PRACTICE_KEYS_MAX_JSON / 2;
    const key = 'k'.repeat(half - 4);
    const carried = 'c'.repeat(half - 4);
    expect(JSON.stringify([key]).length + JSON.stringify([carried]).length).toBe(
      PRACTICE_KEYS_MAX_JSON,
    );
    const out = serializeSessionHelp({
      rung: 4,
      help: {
        stuckTurns: 1,
        attemptLogged: true,
        pendingCheck: true,
        answerKey: [key],
        lockedStopped: true,
        groundingAsks: 1_000,
        personaQuestionsAsked: PERSONA_QUESTIONS_MAX,
        personaId: 'p'.repeat(PERSONA_ID_MAX),
        personaPhase: 'paused',
        practiceItemId: id,
        practiceModuleId: id,
        practiceServed: Array.from({ length: PRACTICE_SERVED_MAX }, () => id),
        practiceCarriedKey: [carried],
      },
    });
    expect(JSON.stringify(out).length).toBeLessThanOrEqual(LIMITS.helpStateMaxJsonLength);
  });
});
