// The stream's locked check (task 4.6; build plan line 316: "answer and locked n-grams" are
// checked on sentence-sized chunks before sending). It sits after the answer gate: the pieces the
// answer gate releases are cut into sentences by the same rules (streamGate.ts).
//
// Fix round (4.6b, following the 4.6 safety review):
//   1. No short-phrase flash. A sentence that passes its check is not shown whole: the last 7
//      tokens of the checked text (8 when it ends inside a word, same rule as the carryover) are
//      held back (`pending`) rather than shown, and are checked again together with the next
//      batch. They are released only once the next batch's check also passes, or, if nothing more
//      comes, by `release()` once the attempt has ended cleanly. So a span that trips later was
//      never shown, not even in part: `pending` is simply dropped on a hit or a failed check.
//   2. One port call per batch, not per sentence (`check(sentences)` joins every sentence it is
//      given into one combined text with `pending` in front, and makes one `lockedCheck` call for
//      the whole thing). A hit holds the whole batch, `pending` included: nothing in it is ever
//      shown. This keeps a long reply (many sentences arriving in one model chunk, e.g. a 300-line
//      code answer) inside the attempt's latency budget even when a check call is itself slow,
//      and the batching is also what makes rule 1 correct: a span crossing a sentence boundary
//      inside one batch is still one contiguous run in the joined text, so it needs no special
//      case beyond the carryover across batches.
//   3. `holdAll` (ADR-0007 §8, session-wide stop after a session's first locked hit or failed
//      check): when set, every batch is held in full (as if its last 7 tokens were the whole
//      batch) and only `release()` at a clean end shows anything, so the reply streams as one
//      piece at the very end, the same as a non-streamed reply. The caller (generate.ts) builds
//      this with the session's saved `lockedStopped` flag; see guardrails/lockedLeak.ts for how a
//      hit here sets it for the rest of the session.
//
// A hit, a failed check (timeout, error, bad result) or text past a reply's maximum withholds the
// batch and everything after it for the attempt (`tripped`); postGuard then replaces the whole
// reply. A cancelled step rejects with TurnCancelled. Reports name the site or cause, never text.
import type { LockedCheck } from '../../guardrails/answerLeak.js';
import { LockedLeakDetected } from '../../guardrails/lockedLeak.js';
import { carryStart } from '../../guardrails/lockedMatch.js';
import type { CancelToken } from '../clock.js';
import { TurnCancelled } from '../errors.js';
import type { AnswerKeyMatcher } from './answerKey.js';
import { sentenceGate } from './streamGate.js';
import { raceCancel } from './streamReader.js';

export interface LockedStream {
  /**
   * Pieces the answer gate released, cut into whole sentences (synchronous: most pieces end no
   * sentence, so nothing waits). Held text stays held. Empty once tripped.
   */
  split(pieces: readonly string[]): string[];
  /** The attempt ended: every sentence still held. Empty once tripped. */
  rest(): string[];
  /**
   * Checks the whole batch in one call; resolves to what may now be shown (may be empty even on a
   * pass: the last ~7 tokens stay held for the next check). A hit or a failed check holds the
   * whole batch and trips the stream.
   */
  check(sentences: readonly string[]): Promise<string[]>;
  /**
   * What `check` held back after its last passing call, released now that the attempt has ended
   * cleanly (call once, after the final `check`). Empty once tripped, or with nothing held.
   */
  release(): string[];
  /** Why text was withheld: a locked hit, or a check that could not answer (or too much text). */
  readonly tripped: 'hit' | 'failed' | undefined;
}

export interface LockedStreamOptions {
  /**
   * Session-wide stop (ADR-0007 §8, 4.6b): hold every batch in full, releasing nothing until
   * `release()` at a clean end. Default false (the ordinary per-sentence stream).
   */
  holdAll?: boolean;
}

/** A matcher that never matches: the sentence gate then only cuts text into sentences. */
const SENTENCES_ONLY: AnswerKeyMatcher = {
  empty: false,
  reach: 0,
  leaks: () => false,
  tailStart: () => -1,
};

export function lockedStream(
  lockedCheck: LockedCheck,
  report: (error: unknown) => void,
  cancel: CancelToken,
  opts: LockedStreamOptions = {},
): LockedStream {
  const splitter = sentenceGate(SENTENCES_ONLY);
  const holdAll = opts.holdAll === true;
  /** Checked-and-passed text not yet shown: the carryover, or (holdAll) the whole reply so far. */
  let pending = '';
  let tripped: 'hit' | 'failed' | undefined;

  const check = async (sentences: readonly string[]): Promise<string[]> => {
    if (tripped !== undefined || sentences.length === 0) return [];
    const combined = pending + sentences.join('');
    let hit: boolean;
    try {
      hit = await raceCancel(lockedCheck([combined]), cancel);
    } catch (error) {
      if (error instanceof TurnCancelled) throw error;
      report(error);
      tripped = 'failed';
      return [];
    }
    if (hit) {
      report(new LockedLeakDetected('stream'));
      tripped = 'hit';
      return [];
    }
    const splitAt = holdAll ? 0 : carryStart(combined);
    pending = combined.slice(splitAt);
    const toShow = combined.slice(0, splitAt);
    return toShow === '' ? [] : [toShow];
  };

  /** Text past a reply's maximum trips the splitter: never shown, and counted as failed. */
  const tooLong = (sentences: string[]): string[] => {
    if (tripped === undefined && splitter.tripped === true) tripped = 'failed';
    return tripped === undefined ? sentences : [];
  };

  return {
    split(pieces) {
      if (tripped !== undefined) return [];
      return tooLong(pieces.flatMap((p) => splitter.push(p)));
    },
    rest() {
      if (tripped !== undefined) return [];
      return tooLong([...splitter.flush()]);
    },
    check,
    release() {
      if (tripped !== undefined || pending === '') return [];
      const out = pending;
      pending = '';
      return [out];
    },
    get tripped() {
      return tripped;
    },
  };
}
