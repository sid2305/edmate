// Step 6 helper: trims the session history to a character budget. Pure and deterministic.
// Size is counted in UTF-16 units of message text: harness purity rules out a tokenizer, so the
// budget is a conservative character count (3.4 decision, recalibrated at 7.6).
import type { Message } from '@edmate/contracts';

/** UTF-16 units of all message text. */
export function historyChars(history: readonly Message[]): number {
  let n = 0;
  for (const m of history) n += m.text.length;
  return n;
}

/** The last `max` UTF-16 units of `text`, never starting on the second half of a surrogate pair. */
function tail(text: string, max: number): string {
  const cut = text.slice(text.length - max);
  const first = cut.charCodeAt(0);
  return first >= 0xdc00 && first <= 0xdfff ? cut.slice(1) : cut;
}

/**
 * The newest messages whose text fits in `budgetChars`, oldest first. Messages are dropped
 * oldest first and the result is a contiguous newest run (no gaps). The newest message is always
 * kept when the budget is positive: if it alone is over the budget, it is cut to its last
 * `budgetChars` units. Returns copies; the input is not mutated.
 */
export function historyTrim(history: readonly Message[], budgetChars: number): Message[] {
  const newest = history.at(-1);
  if (newest === undefined || budgetChars <= 0) return [];
  if (newest.text.length > budgetChars) {
    return [{ ...newest, text: tail(newest.text, budgetChars) }];
  }
  let used = 0;
  let start = history.length;
  while (start > 0) {
    const len = (history[start - 1] as Message).text.length;
    if (used + len > budgetChars) break;
    used += len;
    start -= 1;
  }
  return history.slice(start).map((m) => ({ ...m }));
}
