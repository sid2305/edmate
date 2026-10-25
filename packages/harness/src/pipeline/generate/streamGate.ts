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
//     of the attempt, never between tool rounds;
//   - the ruling-out check (design 3) holds across the whole reply, not just the reach window
//     (fix round 1): a per-item record of which wrong options released text has already named is
//     kept for the attempt; a newly released piece that would complete the set (every wrong
//     option named, not the correct one) is held back as a leak exactly as a single-piece
//     ruling-out is, even when the two mentions are pushed more than `reach` apart; the check
//     (and its commit) judges the same window plus piece `keys.leaks` judges, not the bare piece
//     (5.6g), so a mention split by a cap-forced cut is still caught live;
//   - a possible re-show of an active practice item (5.6b) is held back: text that is a prefix of
//     an item's prompt or of its option listing (compared in the matcher's compact folded form)
//     waits until the restatement is complete, then is judged as one piece (sentence ends inside
//     it are skipped), so the matcher sees the whole span and exempts it; once it stops matching
//     it is judged as normal. One KMP cursor per item per span, advanced once per pushed unit, so
//     the work stays linear; the hold is bounded by the item caps (HOLD_MAX).
// `passThroughGate` shows every piece as it comes (tests that need exact chunks use it).
import { LIMITS, type PedagogyDecision, type TurnContext } from '@edmate/contracts';
import { isFormatChar } from '../../guardrails/textFold.js';
import { type AnswerKeyMatcher, compileAnswerKeys, namedOptionsIn, normaliseForMatch } from './answerKey.js';
import { correctIndex, type ItemContext } from './itemContext.js';
import { foldLabels } from './labelKeys.js';

export interface StreamGate {
  /** Text the model streamed; returns the pieces to show now, in order (maybe none). */
  push(text: string): readonly string[];
  /** The attempt ended: returns any held text that is safe to show now. */
  flush(): readonly string[];
  /** True once the gate withheld text as a leak; postGuard then replaces the reply (4.5). */
  readonly tripped?: boolean;
  /**
   * Adds answer keys mid-attempt (5.6, ADR-0010 §4): a practice item's key, the moment the tool
   * that issued it returns. Text still held is judged with them; text already shown is kept as
   * the window in front. Optional: a gate without it leaves the new key to postGuard.
   * `items` (5.6b): the issued items, taken even when `keys` is empty (a second item with the
   * same key): their re-shows are held back and exempt, their own keys guarded.
   */
  addKeys?(keys: readonly string[], items?: readonly ItemContext[]): void;
}

/** What a gate is built from: the turn, the decision and the student's (scrubbed) message. */
export interface StreamGateInput {
  ctx: TurnContext;
  decision: PedagogyDecision;
  studentText?: string;
  /** The active practice items (5.6b): their re-shows are exempt and held back until whole. */
  items?: readonly ItemContext[];
  /** Practice keys (5.6b, design 4): never quoted back as the student's own code. */
  practiceKeys?: readonly string[];
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

/**
 * The longest compact span the gate holds back for (5.6b). Items are capped far below it (a
 * 600-unit prompt, six 160-unit options); a longer target is never held, only judged as normal.
 */
export const HOLD_MAX = 2_048;

/** The KMP failure function of `t`. */
function failure(t: string): number[] {
  const f = new Array<number>(t.length).fill(0);
  for (let i = 1, q = 0; i < t.length; i++) {
    while (q > 0 && t[i] !== t[q]) q = f[q - 1] as number;
    if (t[i] === t[q]) q++;
    f[i] = q;
  }
  return f;
}

interface Cursor {
  readonly target: string;
  readonly fail: readonly number[];
  state: number;
}

/** One item's re-show tracker: a cursor per span (its prompt, its listing). */
interface ReShow {
  /** Feeds pushed text that starts at stream offset `offset`. */
  feed(text: string, offset: number): void;
  /** The stream offset where the longest unfinished match starts, else Infinity. */
  pending(): number;
}

/**
 * A tracker for `item`. Each unit is folded alone, as the matcher folds text (look-alikes to their
 * letter, then the compact form), and every compact unit fed records its stream offset. A complete
 * match is reported to `onSpan` as [start, end) stream offsets. A high surrogate at the end of a
 * piece waits for its pair.
 */
function reShow(item: ItemContext, onSpan: (s: number, e: number) => void): ReShow {
  const cursors: Cursor[] = [item.prompt, (item.options ?? []).join('\n')]
    .map((t) => normaliseForMatch(foldLabels(t)))
    .filter((t) => t !== '' && t.length <= HOLD_MAX)
    .map((target) => ({ target, fail: failure(target), state: 0 }));
  const at: number[] = [];
  let carry = '';
  const step = (c: Cursor, u: string, end: number) => {
    let q = c.state;
    while (q > 0 && c.target[q] !== u) q = c.fail[q - 1] as number;
    if (c.target[q] === u) q++;
    if (q === c.target.length) {
      onSpan(at[at.length - q] as number, end);
      q = c.fail[q - 1] as number;
    }
    c.state = q;
  };
  return {
    feed(text, offset) {
      let s = carry + text;
      let o = offset - carry.length;
      carry = '';
      const last = s.charCodeAt(s.length - 1);
      if (last >= 0xd800 && last <= 0xdbff) {
        carry = s.slice(-1);
        s = s.slice(0, -1);
      }
      for (const ch of s) {
        for (const u of normaliseForMatch(foldLabels(ch))) {
          at.push(o);
          for (const c of cursors) step(c, u, o + ch.length);
        }
        o += ch.length;
      }
    },
    pending() {
      let p = Infinity;
      for (const c of cursors) if (c.state > 0) p = Math.min(p, at[at.length - c.state] as number);
      return p;
    },
  };
}

/**
 * The gate over one matcher; with no keys it shows every piece as it comes. `grow` (5.6) rebuilds
 * the matcher with keys and items added mid-attempt; without it, `addKeys` is absent. `items`
 * (5.6b): the active practice items whose re-show is held back until whole.
 */
export function sentenceGate(
  initial: AnswerKeyMatcher,
  cap: number = SENTENCE_GATE_CAP,
  grow?: (extra: readonly string[], items: readonly ItemContext[]) => AnswerKeyMatcher,
  items: readonly ItemContext[] = [],
): StreamGate {
  if (initial.empty && grow === undefined) {
    return { push: (t) => (t === '' ? [] : [t]), flush: () => [], tripped: false };
  }
  let keys = initial;
  const extra: string[] = [];
  const extraItems: ItemContext[] = [];
  /** Completed re-shows still held or within the window in front, as [start, end) offsets. */
  let spans: [number, number][] = [];
  const onSpan = (s: number, e: number) => {
    spans.push([s, e]);
  };
  const holds = items.map((it) => reShow(it, onSpan));
  /**
   * Per-item record of which wrong options have been named by released text so far (fix round 1):
   * the ruling-out check must hold across the whole reply, not only the reach-bounded window.
   */
  const ruledOut = new Map<ItemContext, Set<number>>();
  const itemsWithKey = (): ItemContext[] =>
    [...items, ...extraItems].filter((it) => correctIndex(it) !== undefined);
  /**
   * Whether releasing the window plus `piece` now would complete an item's wrong-option set
   * (the MEDIUM, 5.6g): the same window `keys.leaks` judges, not the bare piece, so a mention
   * split across a cap-forced cut (half in the already-released text, half in the new piece) is
   * still caught here instead of only by postGuard's whole-draft check.
   */
  const ruleOutCompletes = (windowPlusPiece: string): boolean =>
    itemsWithKey().some((it) => {
      const k = correctIndex(it) as number;
      const options = it.options ?? [];
      const now = namedOptionsIn(windowPlusPiece, it);
      const have = ruledOut.get(it);
      const total = have === undefined ? now : new Set([...have, ...now]);
      return !total.has(k) && options.every((_, j) => j === k || total.has(j));
    });
  /** Records the wrong options the window plus `piece` names, once it is actually released. */
  const commitRuledOut = (windowPlusPiece: string) => {
    for (const it of itemsWithKey()) {
      const now = namedOptionsIn(windowPlusPiece, it);
      if (now.size === 0) continue;
      const have = ruledOut.get(it);
      if (have === undefined) ruledOut.set(it, new Set(now));
      else for (const j of now) have.add(j);
    }
  };
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
    /**
     * `keys.reach` units back from `released` (span-adjusted, same window `keys.leaks` judges):
     * shared by `safeUpTo` (the matcher check) and `release` (the ruling-out commit), so both
     * see the same window.
     */
    const windowFrom = (): number => {
      let from = windowStart(released, keys.reach);
      spans = spans.filter(([, e]) => e > from);
      for (const [s] of spans) if (s < from) from = s;
      return from;
    };
    const release = (n: number) => {
      const piece = buf.slice(0, n);
      // The window plus the piece about to be released (before `released` grows): a wrong-option
      // mention split across an earlier cap-forced cut still completes the set here.
      const from = windowFrom();
      commitRuledOut(released.slice(from) + piece);
      buf = buf.slice(n);
      released += piece;
      scanned -= n;
      ends = ends.filter((e) => e > n).map((e) => e - n);
      out.push(piece);
    };
    /** Where a possible re-show starts in `buf` (held back), else `buf.length`. */
    const holdAt = (): number => {
      if (final) return buf.length;
      let p = Infinity;
      for (const h of holds) p = Math.min(p, h.pending());
      return p === Infinity ? buf.length : Math.max(0, p - released.length);
    };
    /** The completed re-show that `i` (a cut or a sentence end in `buf`) falls strictly inside. */
    const spanAround = (i: number): [number, number] | undefined =>
      spans.find(([s, e]) => s - released.length < i && i < e - released.length);
    /** The next sentence end, skipping ends inside a completed re-show (judged as one piece). */
    const nextEnd = (): number | undefined => {
      while (ends.length > 0 && spanAround(ends[0] as number) !== undefined) ends.shift();
      return ends[0];
    };
    /**
     * How much of the first `end` units may be shown; -1 when they leak. Checked with the shown
     * text in front, from windowStart: a match can't start earlier than that.
     */
    const safeUpTo = (end: number, atFinalEnd: boolean): number => {
      // A window that starts inside a shown re-show starts at its start instead: a cut-off
      // listing would read as the bare option text (5.6b). Spans wholly before it are dropped.
      const from = windowFrom();
      const whole = released.slice(from) + buf.slice(0, end);
      if (keys.leaks(whole)) return -1;
      let ok = end;
      if (!atFinalEnd) {
        const tail = keys.tailStart(whole);
        ok = tail < 0 ? end : Math.max(0, tail - (released.length - from));
      }
      // The ruling-out check (5.6g): the same window plus the piece, not the bare piece, so a
      // mention split across an earlier cap-forced cut (half already released) is still caught.
      if (ok > 0 && ruleOutCompletes(released.slice(from) + buf.slice(0, ok))) return -1;
      return ok;
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
      const hold = holdAt();
      const next = nextEnd();
      const end = next !== undefined && next <= hold ? next : undefined;
      // Sentences within the cap are judged one by one, each with only the held text before it.
      if (end !== undefined && end <= cap) {
        ends.shift();
        if (!judge(end)) break;
        continue;
      }
      if (Math.min(buf.length, hold) >= cap) {
        // Never cut inside a completed re-show: cut before it instead (or not at all).
        let cut = capCut(buf, cap);
        const inside = spanAround(cut);
        if (inside !== undefined) cut = Math.max(0, inside[0] - released.length);
        const ok = cut > 0 ? safeUpTo(cut, false) : 0;
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

  const gate: StreamGate = {
    push(text) {
      if (tripped || text === '') return [];
      pushed += text.length;
      // No keys yet (a growable gate before its first addKeys): shown as it comes, as above, but
      // kept as the window in front of what a later key judges.
      if (keys.empty) {
        released += text;
        return [text];
      }
      // More than a reply may hold: never judged piece by piece (bounded work), never shown.
      if (pushed > LIMITS.modelTextMaxLength) {
        trip();
        return [];
      }
      buf += text;
      for (const h of holds) h.feed(text, released.length + buf.length - text.length);
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
  if (grow !== undefined) {
    gate.addKeys = (more, newItems = []) => {
      extra.push(...more);
      extraItems.push(...newItems);
      keys = grow(extra, extraItems);
      // Text still held may be the start of a new item's re-show.
      for (const it of newItems) {
        const h = reShow(it, onSpan);
        if (!tripped && buf !== '') h.feed(buf, released.length);
        holds.push(h);
      }
    };
  }
  return gate;
}

/**
 * The default gate: the turn's do-not-say list, with the student's own code allowed back, and
 * (5.6b) the active items' re-shows exempt. Keys added mid-attempt are practice keys (design 4).
 */
export const answerLeakStreamGate: StreamGateFactory = ({
  decision,
  studentText,
  items = [],
  practiceKeys = [],
}) => {
  const opts = (extra: readonly string[], more: readonly ItemContext[]) => ({
    ...(studentText === undefined ? {} : { studentText }),
    items: [...items, ...more],
    practiceKeys: [...practiceKeys, ...extra],
  });
  return sentenceGate(
    compileAnswerKeys(decision.mustNotReveal, opts([], [])),
    SENTENCE_GATE_CAP,
    (extra, more) => compileAnswerKeys([...decision.mustNotReveal, ...extra], opts(extra, more)),
    items,
  );
};
