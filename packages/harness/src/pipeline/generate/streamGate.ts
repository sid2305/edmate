// The sentence gate (task 3.7 seam, plan Q7; the real gate is task 4.5). Every streamed text piece
// passes through a gate before the student sees it.
//
// `answerLeakStreamGate` (the default) buffers the stream into sentences and checks each one, with
// all the text already shown in front of it, against the turn's answer keys (answerKey.ts, the
// same matcher the answerLeak post-guard uses). A clean sentence is shown. A leaking one is never
// shown, not even in part, and the gate then shows nothing more for that attempt (`tripped`), so
// postGuard replaces the reply with the hint. Rules:
//   - a sentence ends at a newline, or at . ! ? 。 । followed by whitespace (so "3.14" and
//     "x.lower()" do not end one); the text after the last end waits for more;
//   - a tail that could be the start of a key ("n % 2" before "== 0") is held until it is known;
//   - text with no sentence end is shown once CAP units are buffered (cut at a space where it can),
//     so unbroken text can't stall the reply; a possible key start (a key's first part, a number,
//     a run of number words) is still held back;
//   - each unit is scanned for sentence ends once, and each sentence judged once, with only the
//     shown text within reach in front (reach counts no whitespace or invisible units), so work
//     stays linear; more than LIMITS.modelTextMaxLength pushed trips the gate (fix round 1);
//   - held text is checked and shown only by `flush()`, which the tool loop calls once, at the end
//     of the attempt, never between tool rounds.
// `passThroughGate` shows every piece as it comes (tests that need exact chunks use it).
import { LIMITS, type PedagogyDecision, type TurnContext } from '@edmate/contracts';
import { isFormatChar } from '../../guardrails/textFold.js';
import { type AnswerKeyMatcher, compileAnswerKeys } from './answerKey.js';

export interface StreamGate {
  /** Text the model streamed; returns the pieces to show now, in order (maybe none). */
  push(text: string): readonly string[];
  /** The attempt ended: returns any held text that is safe to show now. */
  flush(): readonly string[];
  /** True once the gate withheld text as a leak; postGuard then replaces the reply (4.5). */
  readonly tripped?: boolean;
}

/** What a gate is built from: the turn, the decision and the student's (scrubbed) message. */
export interface StreamGateInput {
  ctx: TurnContext;
  decision: PedagogyDecision;
  studentText?: string;
}

/** One gate per generate attempt, built with what it needs to judge the text. */
export type StreamGateFactory = (x: StreamGateInput) => StreamGate;

export const passThroughGate: StreamGateFactory = () => ({
  push: (text) => (text === '' ? [] : [text]),
  flush: () => [],
});

/** Units buffered with no sentence end before text is shown anyway (latency bound). */
export const SENTENCE_GATE_CAP = 200;

const ENDS = new Set(['.', '!', '?', '。', '।']);
const SPACE = /\s/;

/** Where to cut unbroken text at the cap: after the last space, else at the cap (whole code points). */
function capCut(buf: string, cap: number): number {
  const head = buf.slice(0, cap);
  const space = Math.max(head.lastIndexOf(' '), head.lastIndexOf('\t'));
  if (space > 0) return space + 1;
  const hi = buf.charCodeAt(cap - 1);
  return hi >= 0xd800 && hi <= 0xdbff ? cap - 1 : cap;
}

/**
 * Where the checked window of the shown text starts: `reach` units back, counting only units
 * that are neither whitespace nor invisible (so padding can't push a key's start out of the
 * window), then back to the start of that word.
 */
function windowStart(released: string, reach: number): number {
  let i = released.length;
  let counted = 0;
  while (i > 0 && counted < reach) {
    i--;
    const c = released.charAt(i);
    if (!SPACE.test(c) && !isFormatChar(c)) counted++;
  }
  while (i > 0 && !SPACE.test(released.charAt(i - 1))) i--;
  return i;
}

/** The gate over one matcher; with no keys it shows every piece as it comes. */
export function sentenceGate(keys: AnswerKeyMatcher, cap: number = SENTENCE_GATE_CAP): StreamGate {
  if (keys.empty) return { push: (t) => (t === '' ? [] : [t]), flush: () => [], tripped: false };
  let released = '';
  let buf = '';
  /** Units of `buf` already scanned for sentence ends (never rescanned). */
  let scanned = 0;
  /** Sentence ends found in `buf` and not yet judged, ascending. */
  let ends: number[] = [];
  let pushed = 0;
  let tripped = false;

  const trip = () => {
    tripped = true;
    buf = '';
    ends = [];
    scanned = 0;
  };

  /** Finds the sentence ends in the new part of `buf`. */
  const scan = () => {
    let i = scanned;
    for (; i < buf.length; i++) {
      const ch = buf.charAt(i);
      if (ch === '\n') {
        ends.push(i + 1);
      } else if (ENDS.has(ch)) {
        // Whether it ends a sentence depends on the next unit: wait for it.
        if (i + 1 >= buf.length) break;
        if (SPACE.test(buf.charAt(i + 1))) {
          ends.push(i + 2);
          i++;
        }
      }
    }
    scanned = i;
  };

  const drain = (final: boolean): string[] => {
    const out: string[] = [];
    const release = (n: number) => {
      const piece = buf.slice(0, n);
      buf = buf.slice(n);
      released += piece;
      scanned -= n;
      ends = ends.filter((e) => e > n).map((e) => e - n);
      out.push(piece);
    };
    /**
     * How much of the first `end` units may be shown; -1 when they leak. Checked with the shown
     * text in front, from windowStart: a match can't start earlier than that.
     */
    const safeUpTo = (end: number, atFinalEnd: boolean): number => {
      const from = windowStart(released, keys.reach);
      const whole = released.slice(from) + buf.slice(0, end);
      if (keys.leaks(whole)) return -1;
      if (atFinalEnd) return end;
      const tail = keys.tailStart(whole);
      return tail < 0 ? end : Math.max(0, tail - (released.length - from));
    };
    /** Judges one sentence end: shown, held (its tail may start a key) or a leak. */
    const judge = (end: number): boolean => {
      const ok = safeUpTo(end, false);
      if (ok < 0) {
        trip();
        return false;
      }
      if (ok === end) release(end);
      return true;
    };

    scan();
    while (!tripped && buf !== '') {
      const end = ends[0];
      // Sentences within the cap are judged one by one, each with only the held text before it.
      if (end !== undefined && end <= cap) {
        ends.shift();
        if (!judge(end)) break;
        continue;
      }
      if (buf.length >= cap) {
        const ok = safeUpTo(capCut(buf, cap), false);
        if (ok < 0) {
          trip();
          break;
        }
        if (ok > 0) {
          release(ok);
          continue;
        }
      }
      // A long sentence whose head can't be shown: judge it whole.
      if (end !== undefined) {
        ends.shift();
        if (!judge(end)) break;
        continue;
      }
      break;
    }
    if (final && !tripped && buf !== '') {
      if (safeUpTo(buf.length, true) < 0) trip();
      else release(buf.length);
    }
    return out;
  };

  return {
    push(text) {
      if (tripped || text === '') return [];
      pushed += text.length;
      // More than a reply may hold: never judged piece by piece (bounded work), never shown.
      if (pushed > LIMITS.modelTextMaxLength) {
        trip();
        return [];
      }
      buf += text;
      return drain(false);
    },
    flush() {
      if (tripped) return [];
      return drain(true);
    },
    get tripped() {
      return tripped;
    },
  };
}

/** The default gate: the turn's do-not-say list, with the student's own code allowed back. */
export const answerLeakStreamGate: StreamGateFactory = ({ decision, studentText }) =>
  sentenceGate(
    compileAnswerKeys(decision.mustNotReveal, studentText === undefined ? {} : { studentText }),
  );
