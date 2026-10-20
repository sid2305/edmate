import { LIMITS } from '@edmate/contracts';
import { describe, expect, it } from 'vitest';
import {
  copyHelp,
  INITIAL_HELP_STATE,
  loadSessionHelp,
  PERSONA_QUESTIONS_MAX,
  parseSessionHelp,
  personaQuestionsAsked,
  serializeSessionHelp,
  SessionHelpSchema,
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
