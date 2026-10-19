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
//      check): when set, nothing streams and nothing is checked per batch; `release()` at a clean
//      end checks the whole reply once and shows it as one piece, the same as a non-streamed
//      reply (fix round 1: per-batch checks re-sent the whole reply so far every time). The
//      caller (generate.ts) sets it from the session's saved `lockedStopped` flag (or when the
//      help state could not be read); `onTrip` tells the runner, which saves the flag.
//   4. Fix round 1: the held-back text never starts inside an unfinished tag, comment or entity
//      at the end of the checked text (`heldFrom`): the rest of it may still arrive and change
//      how the text before it is read, so the post guard could see a span the stream did not.
//
// A hit, a failed check (timeout, error, bad result) or text past a reply's maximum withholds the
// batch and everything after it for the attempt (`tripped`); postGuard then replaces the whole
// reply. A cancelled step rejects with TurnCancelled. Reports name the site or cause, never text.
import type { LockedCheck } from '../../guardrails/answerLeak.js';
import { LockedLeakDetected } from '../../guardrails/lockedLeak.js';
import { carryStart, unfinishedMarkupStart } from '../../guardrails/lockedMatch.js';
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
   * cleanly (call once, after the final `check`). Empty once tripped, or with nothing held. Under
   * `holdAll` this makes the reply's only check (the whole reply), so it may trip.
   */
  release(): Promise<string[]>;
  /** Why text was withheld: a locked hit, or a check that could not answer (or too much text). */
  readonly tripped: 'hit' | 'failed' | undefined;
}

export interface LockedStreamOptions {
  /**
   * Session-wide stop (ADR-0007 §8, 4.6b): hold every batch in full, releasing nothing until
   * `release()` at a clean end. Default false (the ordinary per-sentence stream).
   */
  holdAll?: boolean;
  /**
   * Called once when the stream trips (a hit, a failed check, or text past the maximum), so the
   * runner can record it for the session even if the attempt then fails (4.6b fix round 1).
   */
  onTrip?: () => void;
}

/**
 * Where the held-back text starts in checked text: the carryover (`carryStart`), but never later
 * than 7 tokens before an unfinished tag, comment or entity at the very end (4.6b fix round 1).
 * The rest of one may still arrive and change how everything before it is read (a tag that
 * closes later is padded away in the rendered reading), so the text around it is checked again.
 */
function heldFrom(checked: string): number {
  const at = carryStart(checked);
  const open = unfinishedMarkupStart(checked);
  return open < 0 ? at : Math.min(at, carryStart(checked.slice(0, open)));
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

  const trip = (kind: 'hit' | 'failed') => {
    tripped = kind;
    opts.onTrip?.();
  };

  /** One locked check of `text`; false (and tripped) on a hit or a failed check. */
  const passes = async (text: string): Promise<boolean> => {
    let hit: boolean;
    try {
      hit = await raceCancel(lockedCheck([text]), cancel);
    } catch (error) {
      if (error instanceof TurnCancelled) throw error;
      report(error);
      trip('failed');
      return false;
    }
    if (hit) {
      report(new LockedLeakDetected('stream'));
      trip('hit');
      return false;
    }
    return true;
  };

  const check = async (sentences: readonly string[]): Promise<string[]> => {
    if (tripped !== undefined || sentences.length === 0) return [];
    const combined = pending + sentences.join('');
    // holdAll: nothing streams, so nothing is checked until release() checks the whole reply once.
    if (holdAll) {
      pending = combined;
      return [];
    }
    if (!(await passes(combined))) return [];
    const splitAt = heldFrom(combined);
    pending = combined.slice(splitAt);
    const toShow = combined.slice(0, splitAt);
    return toShow === '' ? [] : [toShow];
  };

  /** Text past a reply's maximum trips the splitter: never shown, and counted as failed. */
  const tooLong = (sentences: string[]): string[] => {
    if (tripped === undefined && splitter.tripped === true) trip('failed');
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
    async release() {
      if (tripped !== undefined || pending === '') return [];
      const out = pending;
      pending = '';
      // Under holdAll this is the reply's one and only check (the whole reply); otherwise the
      // held tail was already checked with the batch it came from.
      if (holdAll && !(await passes(out))) return [];
      return [out];
    },
    get tripped() {
      return tripped;
    },
  };
}
