// Which answer keys check retrieved material, and whether a chunk shows one (5.6a). Moved here from
// `pipeline/steps/buildContext.ts` in 5.6c, so the practice tool no longer imports a pipeline
// step; behaviour is unchanged.
import type { Chunk } from '@edmate/contracts';
import type { AnswerKeyMatcher } from './answerKey.js';
import { numericKey } from './numbers.js';

/** A whole number key with fewer digits than this is too short to drop context (5.6a). */
const SHORT_NUMBER_DIGITS = 3;
/** A short whole number: the canonical value of a key with fewer than SHORT_NUMBER_DIGITS digits. */
const SHORT_NUMBER = new RegExp(`^\\d{1,${String(SHORT_NUMBER_DIGITS - 1)}}$`);

/**
 * The keys used to check retrieved material (lead answer, 20 Oct 2026): every key except a short
 * whole number ("1", "7", "42", or the same number in words, "one"). Such a key would drop almost
 * every chunk, and a chunk that happens to hold "7" does not give an item's answer away. The stream
 * gate and postGuard still hold every key on what the model says.
 */
export function contextAnswerKeys(keys: readonly string[]): string[] {
  return keys.filter((k) => {
    const n = numericKey(k);
    return n === undefined || !SHORT_NUMBER.test(n.value);
  });
}

/** True when any field the composer shows the model (text, source title, locator) leaks a key. */
export function chunkLeaks(c: Chunk, m: AnswerKeyMatcher): boolean {
  return m.leaks(c.text) || m.leaks(c.source.title) || m.leaks(c.source.locator);
}
