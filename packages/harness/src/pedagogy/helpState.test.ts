import { LIMITS } from '@edmate/contracts';
import { describe, expect, it } from 'vitest';
import {
  copyHelp,
  INITIAL_HELP_STATE,
  parseSessionHelp,
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
    [
      'a missing lockedStopped (an old stored blob, before 4.6b)',
      { v: 1, rung: 2, stuckTurns: 0, attemptLogged: false, pendingCheck: false, answerKey: [] },
    ],
    ['an unknown key', { ...VALID, extra: true }],
  ])('%s → the default', (_label, raw) => {
    expect(parseSessionHelp(raw)).toEqual(DEFAULT);
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
