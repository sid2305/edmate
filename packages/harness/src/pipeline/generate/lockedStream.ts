// The stream's locked check (task 4.6; build plan line 316: "answer and locked n-grams" are
// checked on sentence-sized chunks before sending). It sits after the answer gate: the pieces the
// answer gate releases are cut into sentences by the same rules (streamGate.ts), and each sentence
// is checked, with the last 7 tokens already shown in front of it (8 when the shown text ends
// inside a word), before it is shown. So a span of 8 tokens is caught wherever it ends, even across
// sentences, chunks or tool rounds; at most 7 of its tokens can be shown first, which is under the
// leak definition.
//
// A hit, a failed check (timeout, error, bad result) or text past a reply's maximum withholds the
// sentence and everything after it for the attempt (`tripped`); postGuard then replaces the whole
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
  /** Checks sentences in order; resolves to those that passed, stopping at the first that didn't. */
  check(sentences: readonly string[]): Promise<string[]>;
  /** Why text was withheld: a locked hit, or a check that could not answer (or too much text). */
  readonly tripped: 'hit' | 'failed' | undefined;
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
): LockedStream {
  const splitter = sentenceGate(SENTENCES_ONLY);
  /** The shown text's last tokens, checked again with the next sentence. */
  let carry = '';
  let tripped: 'hit' | 'failed' | undefined;

  const check = async (sentences: readonly string[]): Promise<string[]> => {
    const out: string[] = [];
    if (tripped !== undefined) return out;
    // Every trip breaks out of the loop.
    for (const s of sentences) {
      let hit: boolean;
      try {
        hit = await raceCancel(lockedCheck([carry + s]), cancel);
      } catch (error) {
        if (error instanceof TurnCancelled) throw error;
        report(error);
        tripped = 'failed';
        break;
      }
      if (hit) {
        report(new LockedLeakDetected('stream'));
        tripped = 'hit';
        break;
      }
      out.push(s);
      const shown = carry + s;
      carry = shown.slice(carryStart(shown));
    }
    return out;
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
    get tripped() {
      return tripped;
    },
  };
}
