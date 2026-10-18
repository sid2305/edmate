// The one check every key value goes through. Internal: not exported from the package.
// Problems are fixed codes; the loader writes its own messages and never passes on Zod
// issues, which can carry the input.
import { z } from 'zod';

export type KeyProblem =
  'missing' | 'empty' | 'whitespace' | 'quoted' | 'placeholder' | 'too_short';

export const MIN_KEY_LENGTH = 16;

// changeme, replace-me, todo, your-..., <...>, xxx... (case-insensitive).
const PLACEHOLDER = /^(?:change[-_]?me|replace[-_]?me|todo|your[-_].*|<.*>|x{3,}(?:[-_].*)?)$/is;
// The same quote character at both ends: a common env-file mistake.
const QUOTED = /^(["'`]).*\1$/s;

function problemIn(value: string): KeyProblem | undefined {
  if (value.trim() === '') return 'empty';
  if (/\s/.test(value)) return 'whitespace';
  if (QUOTED.test(value)) return 'quoted';
  if (PLACEHOLDER.test(value)) return 'placeholder';
  if (value.length < MIN_KEY_LENGTH) return 'too_short';
  return undefined;
}

export const keyValueSchema = z.string({ error: 'missing' }).superRefine((value, ctx) => {
  const problem = problemIn(value);
  if (problem !== undefined) ctx.addIssue({ code: 'custom', message: problem });
});

/** The first problem with a value, or undefined if it is a usable key. */
export function keyProblem(value: unknown): KeyProblem | undefined {
  const result = keyValueSchema.safeParse(value);
  return result.success ? undefined : (result.error.issues[0]!.message as KeyProblem);
}
