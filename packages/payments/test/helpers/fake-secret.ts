// Fake webhook secrets for tests. Built at runtime so no key-shaped string is ever committed, and
// prefixed `fake-` so it matches no real provider format the secret scan looks for.
import { randomBytes } from 'node:crypto';

export function fakeSecret(): string {
  return 'fake-' + randomBytes(24).toString('hex');
}

/** Every 8-character window of `value`: finding none of them in a text means no fragment leaked. */
export function fragments(value: string, size = 8): string[] {
  const out: string[] = [];
  for (let i = 0; i + size <= value.length; i += 1) out.push(value.slice(i, i + size));
  return out;
}

/**
 * True when `text` holds the value or any 8-character fragment of it. Tests assert on this
 * boolean (never `toContain`), so a failure never prints the value in CI logs.
 */
export function leaks(text: string, value: string): boolean {
  return fragments(value).some((f) => text.includes(f));
}
