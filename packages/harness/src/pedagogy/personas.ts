// The persona source (task 5.8, ADR-0013 §2). The composition root builds a `PersonaLibrary` from
// the signed persona templates (`readPersonaLibrary` in @edmate/content) and passes it in as
// `deps.personas`; `buildContext` resolves this turn's persona with `resolvePersona`. Pure.
//
// The client only ever picks a persona by its bare id on the start turn. No client text reaches
// the persona's name, style or `must_not` list, which come only from signed template files.
import { type Persona, PersonaSchema, type TurnInput } from '@edmate/contracts';
import { z } from 'zod';
import { FrozenMap } from './frozenMap.js';
import type { HelpState } from './helpState.js';

/** Persona id → persona. Built once at start-up; read-only and deep-frozen. */
export type PersonaLibrary = ReadonlyMap<string, Readonly<Persona>>;

/**
 * The start turn's payload: a bare persona id and nothing else (the server picks the version).
 * Strict, so a payload with any other field fails closed to no persona.
 */
export const PersonaStartPayloadSchema = z.strictObject({ persona: PersonaSchema.shape.id });

function deepFreeze<T>(value: T): T {
  if (typeof value === 'object' && value !== null && !Object.isFrozen(value)) {
    for (const v of Object.values(value)) deepFreeze(v);
    Object.freeze(value);
  }
  return value;
}

/**
 * Builds the library from `[id, persona]` entries. Each persona is checked against the contracts
 * `PersonaSchema` (and copied by it), its key must equal its id, and an id may appear once. Error
 * messages name the key only, never template text.
 */
export function createPersonaLibrary(
  entries: readonly (readonly [string, Persona])[],
): PersonaLibrary {
  const out: (readonly [string, Readonly<Persona>])[] = [];
  const seen = new Set<string>();
  for (const [key, value] of entries) {
    const parsed = PersonaSchema.safeParse(value);
    if (!parsed.success) {
      throw new Error(`persona library: persona ${JSON.stringify(key)} is invalid`);
    }
    if (parsed.data.id !== key) {
      throw new Error(
        `persona library: key ${JSON.stringify(key)} is not the persona id ${JSON.stringify(parsed.data.id)}`,
      );
    }
    if (seen.has(key))
      throw new Error(`persona library: duplicate persona id ${JSON.stringify(key)}`);
    seen.add(key);
    out.push([key, deepFreeze(parsed.data)]);
  }
  return new FrozenMap(out, 'the persona library');
}

/** What `resolvePersona` reads of the loaded help state (`loadSessionHelp`'s result). */
export interface LoadedPersonaHelp {
  readonly help: Readonly<Pick<HelpState, 'personaId'>>;
  readonly unreadable: boolean;
}

/**
 * This turn's persona, or undefined (no persona: the policy falls back to coach, or to locked
 * `no_persona`). Only a `mock_interview` turn has one. A start (`skill_action`) takes the id from
 * its payload (`PersonaStartPayloadSchema`); every other turn uses the stored `personaId`. An
 * unknown id, a missing or wrong-shaped payload, an unreadable help state, a non-start turn with
 * no stored id, or no library all mean no persona. There is never a default persona.
 */
export function resolvePersona(
  input: Pick<TurnInput, 'kind' | 'skill' | 'skillPayload'>,
  loaded: LoadedPersonaHelp,
  library: PersonaLibrary | undefined,
): Readonly<Persona> | undefined {
  if (library === undefined || input.skill !== 'mock_interview' || loaded.unreadable) {
    return undefined;
  }
  let id: string | undefined;
  if (input.kind === 'skill_action') {
    const payload = PersonaStartPayloadSchema.safeParse(input.skillPayload);
    id = payload.success ? payload.data.persona : undefined;
  } else {
    id = loaded.help.personaId;
  }
  return id === undefined ? undefined : library.get(id);
}
