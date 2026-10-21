// Task 5.8 Phase B (ADR-0013 §2): the persona library and resolution. Signed templates only; the
// client sends a bare id on the start turn and nothing else ever selects a persona.
import type { Persona, TurnInput } from '@edmate/contracts';
import { demoPersona } from '@edmate/contracts/fixtures';
import { describe, expect, it } from 'vitest';
import { copyHelp, INITIAL_HELP_STATE } from './helpState.js';
import {
  createPersonaLibrary,
  type PersonaLibrary,
  PersonaStartPayloadSchema,
  resolvePersona,
} from './personas.js';

const viva: Persona = {
  id: 'viva',
  name: 'Viva examiner',
  style: 'Calm and fair.',
  mustNot: ['give a grade'],
  endAfterQuestions: 5,
};
const lib: PersonaLibrary = createPersonaLibrary([
  [demoPersona.id, { ...demoPersona, mustNot: [...demoPersona.mustNot] }],
  [viva.id, viva],
]);

type Input = Pick<TurnInput, 'kind' | 'skill' | 'skillPayload'>;
const start = (skillPayload?: unknown): Input => ({
  kind: 'skill_action',
  skill: 'mock_interview',
  ...(skillPayload === undefined ? {} : { skillPayload }),
});
const message: Input = { kind: 'message', skill: 'mock_interview' };
const stored = (personaId?: string, unreadable = false) => ({
  help: { ...copyHelp(INITIAL_HELP_STATE), ...(personaId === undefined ? {} : { personaId }) },
  unreadable,
});

describe('createPersonaLibrary', () => {
  it('maps each id to its persona, deep-frozen, in a read-only map', () => {
    expect([...lib.keys()]).toEqual([demoPersona.id, 'viva']);
    const p = lib.get('viva');
    expect(p).toEqual(viva);
    expect(Object.isFrozen(p)).toBe(true);
    expect(Object.isFrozen(p?.mustNot)).toBe(true);
    expect(Object.isFrozen(lib)).toBe(true);
    const m = lib as Map<string, Persona>;
    expect(() => m.set('x', viva)).toThrow('the persona library is read-only');
    expect(() => m.delete('viva')).toThrow(TypeError);
    expect(() => m.clear()).toThrow(TypeError);
    expect(lib.size).toBe(2);
  });

  it('copies each persona, so the caller’s object stays its own', () => {
    const mine: Persona = { ...viva, mustNot: ['a'] };
    const l = createPersonaLibrary([['viva', mine]]);
    mine.mustNot.push('b');
    expect(l.get('viva')?.mustNot).toEqual(['a']);
    expect(Object.isFrozen(mine)).toBe(false);
  });

  it('an empty library is fine', () => {
    expect(createPersonaLibrary([]).size).toBe(0);
  });

  it('rejects a key that differs from the persona id', () => {
    expect(() => createPersonaLibrary([['job-interview', viva]])).toThrow(
      'persona library: key "job-interview" is not the persona id "viva"',
    );
  });

  it('rejects a duplicate id', () => {
    expect(() =>
      createPersonaLibrary([
        ['viva', viva],
        ['viva', viva],
      ]),
    ).toThrow('persona library: duplicate persona id "viva"');
  });

  it('rejects a persona that fails the contracts schema, naming only the key', () => {
    const bad = { ...viva, endAfterQuestions: -1 };
    expect(() => createPersonaLibrary([['viva', bad]])).toThrow(
      'persona library: persona "viva" is invalid',
    );
    const extra = { ...viva, prompt: 'x' } as Persona;
    expect(() => createPersonaLibrary([['viva', extra]])).toThrow(/invalid/);
  });
});

describe('PersonaStartPayloadSchema', () => {
  it('is strict and takes a bare id only', () => {
    expect(PersonaStartPayloadSchema.safeParse({ persona: 'viva' }).success).toBe(true);
    for (const bad of [
      { persona: 'viva', topic: 'interest' },
      { persona: 'viva@1.0.0' },
      { persona: '' },
      { persona: 7 },
      { persona: 'a'.repeat(1_000) },
      'viva',
      null,
      [],
    ]) {
      expect(PersonaStartPayloadSchema.safeParse(bad).success, JSON.stringify(bad)).toBe(false);
    }
  });
});

describe('resolvePersona', () => {
  it('a start takes the id from the payload', () => {
    expect(resolvePersona(start({ persona: 'viva' }), stored(), lib)).toBe(lib.get('viva'));
  });

  it('a start ignores the stored id (it may switch persona)', () => {
    expect(resolvePersona(start({ persona: 'viva' }), stored(demoPersona.id), lib)?.id).toBe(
      'viva',
    );
  });

  it.each([
    ['no payload', undefined],
    ['an unknown id', { persona: 'recruiter' }],
    ['an extra field', { persona: 'viva', topic: 'x' }],
    ['a versioned id', { persona: 'viva@1.0.0' }],
    ['the wrong shape', ['viva']],
    ['a prototype key', { persona: '__proto__' }],
    ['a map method name', { persona: 'constructor' }],
  ])('a start with %s has no persona (no default, no stored id)', (_n, payload) => {
    expect(resolvePersona(start(payload), stored('viva'), lib)).toBeUndefined();
  });

  it('any other mock_interview turn uses the stored id', () => {
    expect(resolvePersona(message, stored('viva'), lib)?.id).toBe('viva');
    expect(resolvePersona({ ...message, kind: 'hint_request' }, stored('viva'), lib)?.id).toBe(
      'viva',
    );
  });

  it('a payload on a non-start turn is never read', () => {
    expect(
      resolvePersona({ ...message, skillPayload: { persona: 'viva' } }, stored(), lib),
    ).toBeUndefined();
  });

  it('a non-start turn with no stored id, or an id no longer in the library, has none', () => {
    expect(resolvePersona(message, stored(), lib)).toBeUndefined();
    expect(resolvePersona(message, stored('retired'), lib)).toBeUndefined();
  });

  it('an unreadable help state means no persona, even on a start', () => {
    expect(resolvePersona(message, stored('viva', true), lib)).toBeUndefined();
    expect(
      resolvePersona(start({ persona: 'viva' }), stored(undefined, true), lib),
    ).toBeUndefined();
  });

  it('only a mock_interview turn has a persona', () => {
    expect(resolvePersona({ kind: 'message' }, stored('viva'), lib)).toBeUndefined();
    expect(
      resolvePersona({ ...start({ persona: 'viva' }), skill: 'coach' }, stored('viva'), lib),
    ).toBeUndefined();
  });

  it('no library means no persona (today’s behaviour)', () => {
    expect(resolvePersona(start({ persona: 'viva' }), stored('viva'), undefined)).toBeUndefined();
    expect(resolvePersona(message, stored('viva'), undefined)).toBeUndefined();
  });
});
