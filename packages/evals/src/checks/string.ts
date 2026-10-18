// String checks: phrases are matched case-insensitively, the way a student would read them.
import { result, type CheckResult } from './result.js';

const quoted = (items: readonly string[]) => items.map((s) => JSON.stringify(s)).join(', ');

export function checkMustContain(reply: string, phrases: readonly string[]): CheckResult {
  const text = reply.toLowerCase();
  const missing = phrases.filter((p) => !text.includes(p.toLowerCase()));
  return result('must_contain', missing.length === 0, `missing: ${quoted(missing)}`);
}

export function checkMustNotContain(reply: string, phrases: readonly string[]): CheckResult {
  const text = reply.toLowerCase();
  const found = phrases.filter((p) => text.includes(p.toLowerCase()));
  return result('must_not_contain', found.length === 0, `found: ${quoted(found)}`);
}

/** Patterns were validated at load time (schema.ts), so compiling here cannot throw. */
export function checkMatches(reply: string, patterns: readonly string[]): CheckResult {
  const failed = patterns.filter((p) => !new RegExp(p, 'i').test(reply));
  return result(
    'matches',
    failed.length === 0,
    `no match: ${failed.map((p) => `/${p}/`).join(', ')}`,
  );
}
