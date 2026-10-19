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
//     so unbroken text can't stall the reply; a possible key start is still held back;
//   - held text is checked and shown only by `flush()`, which the tool loop calls once, at the end
//     of the attempt, never between tool rounds.
// `passThroughGate` shows every piece as it comes (tests that need exact chunks use it).
import type { PedagogyDecision, TurnContext } from '@edmate/contracts';
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

/** Ends of the complete sentences in `buf`, ascending; with `final`, the end of `buf` too. */
function sentenceEnds(buf: string, final: boolean): number[] {
  const out: number[] = [];
  for (let i = 0; i < buf.length; i++) {
    const ch = buf.charAt(i);
    if (ch === '\n') {
      out.push(i + 1);
    } else if (ENDS.has(ch) && SPACE.test(buf.charAt(i + 1))) {
      let j = i + 1;
      while (j < buf.length && SPACE.test(buf.charAt(j)) && buf.charAt(j) !== '\n') j++;
      out.push(j);
      i = j - 1;
    }
  }
  if (final && out.at(-1) !== buf.length) out.push(buf.length);
  return out;
}

/** Where to cut unbroken text at the cap: after the last space, else at the cap (whole code points). */
function capCut(buf: string, cap: number): number {
  const head = buf.slice(0, cap);
  const space = Math.max(head.lastIndexOf(' '), head.lastIndexOf('\t'));
  if (space > 0) return space + 1;
  const hi = buf.charCodeAt(cap - 1);
  return hi >= 0xd800 && hi <= 0xdbff ? cap - 1 : cap;
}

/** Where the checked window of the shown text starts: `reach` back, then back to a space. */
function windowStart(released: string, reach: number): number {
  if (released.length <= reach) return 0;
  const space = released.slice(0, released.length - reach + 1).search(/\s\S*$/);
  return space < 0 ? 0 : space;
}

/** The gate over one matcher; with no keys it shows every piece as it comes. */
export function sentenceGate(keys: AnswerKeyMatcher, cap: number = SENTENCE_GATE_CAP): StreamGate {
  if (keys.empty) return { push: (t) => (t === '' ? [] : [t]), flush: () => [], tripped: false };
  let released = '';
  let buf = '';
  let tripped = false;

  const drain = (final: boolean): string[] => {
    const out: string[] = [];
    const release = (n: number) => {
      if (n <= 0) return;
      const piece = buf.slice(0, n);
      buf = buf.slice(n);
      released += piece;
      out.push(piece);
    };
    const trip = () => {
      tripped = true;
      buf = '';
    };
    /**
     * How much of the first `end` units may be shown; -1 when they leak. Checked with the shown
     * text in front, from `keys.reach` back (widened to the start of a word, so a base64 run or a
     * number is never cut): a match can't start earlier than that.
     */
    const safeUpTo = (end: number, atFinalEnd: boolean): number => {
      const from = windowStart(released, keys.reach);
      const whole = released.slice(from) + buf.slice(0, end);
      if (keys.leaks(whole)) return -1;
      if (atFinalEnd) return end;
      const tail = keys.tailStart(whole);
      return tail < 0 ? end : Math.max(0, tail - (released.length - from));
    };

    while (!tripped && buf !== '') {
      let best = 0;
      for (const end of sentenceEnds(buf, final)) {
        const ok = safeUpTo(end, final && end === buf.length);
        if (ok < 0) {
          release(best);
          trip();
          return out;
        }
        if (ok === end) best = end;
      }
      if (best === 0 && buf.length >= cap) {
        const ok = safeUpTo(capCut(buf, cap), false);
        if (ok < 0) {
          trip();
          return out;
        }
        best = ok;
      }
      if (best === 0) break;
      release(best);
    }
    return out;
  };

  return {
    push(text) {
      if (tripped || text === '') return [];
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
