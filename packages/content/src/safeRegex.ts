// Safe-regex check for locale-pack PII patterns (task 3.10). Runs when a pack is validated or
// loaded, never per turn. Two lines of defence, in order:
//   1. Structural (lead revision 2): parse the source and refuse the shapes that can backtrack
//      badly: a quantifier inside a repeated group, an alternation under a repeat whose branches
//      can start the same way, a backreference, and any lookbehind wider than one character.
//      It is deliberately strict: pack authors are trusted operators, and refusing a safe pattern
//      only means writing it out longhand.
//   2. Timing: run the compiled pattern over a few adversarial inputs, shortest first, and refuse
//      it if they take longer than a small budget (catches what the parser lets through, such as
//      polynomial blow-ups from adjacent quantifiers).
// Hand-rolled, no dependency (lead answer to Q1). The source is parsed with the `u`-flag grammar,
// so it is only checked after it compiles with exactly 'gu' (another rule reports that).

export const SAFE_REGEX_ISSUES = Object.freeze({
  nested: 'nests a quantifier inside a repeated group',
  overlap: 'repeats an alternation whose branches can start the same way',
  backref: 'uses a backreference',
  behind: 'has a lookbehind longer than one character',
} as const);

interface Quant {
  min: number;
  max: number;
}
type Atom =
  | { kind: 'char'; ch: string }
  | { kind: 'set' } // a class, `.`, `\d`, `\p{..}`: more than one possible character
  | { kind: 'assert' } // ^ $ \b \B
  | { kind: 'backref' }
  | { kind: 'group'; type: 'plain' | 'ahead' | 'behind'; alts: Term[][] };
interface Term {
  atom: Atom;
  quant: Quant | null;
}

const SIMPLE_CHAR_ESCAPES: Readonly<Record<string, string>> = {
  f: '\f',
  n: '\n',
  r: '\r',
  t: '\t',
  v: '\v',
  '0': '\0',
};

class Parser {
  private i = 0;

  constructor(private readonly s: string) {}

  parse(): Term[][] {
    return this.alternatives();
  }

  private peek(k = 0): string | undefined {
    return this.s[this.i + k];
  }

  /** Index of `ch` at or after the cursor (or the end), for `\p{..}`, `\u{..}`, `\k<..>`, `(?<..>`. */
  private skipPast(ch: string): void {
    const at = this.s.indexOf(ch, this.i);
    this.i = at === -1 ? this.s.length : at + 1;
  }

  private alternatives(): Term[][] {
    const alts: Term[][] = [[]];
    while (this.i < this.s.length && this.peek() !== ')') {
      if (this.peek() === '|') {
        this.i++;
        alts.push([]);
        continue;
      }
      const atom = this.atom();
      (alts.at(-1) as Term[]).push({ atom, quant: this.quantifier() });
    }
    return alts;
  }

  private atom(): Atom {
    const c = this.s[this.i++] as string;
    if (c === '\\') return this.escape();
    if (c === '[') {
      this.charClass();
      return { kind: 'set' };
    }
    if (c === '(') return this.group();
    if (c === '.') return { kind: 'set' };
    if (c === '^' || c === '$') return { kind: 'assert' };
    // A literal, possibly an astral code point (two UTF-16 units).
    const cp = this.s.codePointAt(this.i - 1) as number;
    if (cp > 0xffff) this.i++;
    return { kind: 'char', ch: String.fromCodePoint(cp) };
  }

  private escape(): Atom {
    const c = this.s[this.i++] ?? '';
    if (/[1-9]/.test(c)) {
      while (/[0-9]/.test(this.peek() ?? '')) this.i++;
      return { kind: 'backref' };
    }
    if (c === 'k') {
      this.skipPast('>');
      return { kind: 'backref' };
    }
    if (c === 'b' || c === 'B') return { kind: 'assert' };
    if ('dDwWsS'.includes(c)) return { kind: 'set' };
    if (c === 'p' || c === 'P') {
      this.skipPast('}');
      return { kind: 'set' };
    }
    if (c === 'u' && this.peek() === '{') {
      const end = this.s.indexOf('}', this.i);
      const ch = String.fromCodePoint(parseInt(this.s.slice(this.i + 1, end), 16));
      this.i = end + 1;
      return { kind: 'char', ch };
    }
    if (c === 'u' || c === 'x') {
      const n = c === 'u' ? 4 : 2;
      const ch = String.fromCharCode(parseInt(this.s.slice(this.i, this.i + n), 16));
      this.i += n;
      return { kind: 'char', ch };
    }
    if (c === 'c') {
      const letter = this.s[this.i++] as string;
      return { kind: 'char', ch: String.fromCharCode(letter.charCodeAt(0) % 32) };
    }
    return { kind: 'char', ch: SIMPLE_CHAR_ESCAPES[c] ?? c };
  }

  /** Skips a character class up to its closing `]` (escapes inside are skipped whole). */
  private charClass(): void {
    while (this.i < this.s.length) {
      const c = this.s[this.i++];
      if (c === '\\') this.i++;
      else if (c === ']') return;
    }
  }

  private group(): Atom {
    let type: 'plain' | 'ahead' | 'behind' = 'plain';
    if (this.peek() === '?') {
      const next = this.peek(1);
      if (next === ':') this.i += 2;
      else if (next === '=' || next === '!') {
        type = 'ahead';
        this.i += 2;
      } else if (this.peek(2) === '=' || this.peek(2) === '!') {
        type = 'behind';
        this.i += 3;
      } else {
        this.skipPast('>'); // (?<name>
      }
    }
    const alts = this.alternatives();
    this.i++; // ')'
    return { kind: 'group', type, alts };
  }

  private quantifier(): Quant | null {
    const c = this.peek();
    let q: Quant | null = null;
    if (c === '*') q = { min: 0, max: Infinity };
    else if (c === '+') q = { min: 1, max: Infinity };
    else if (c === '?') q = { min: 0, max: 1 };
    else if (c === '{') {
      const m = /^\{(\d+)(,(\d*))?\}/.exec(this.s.slice(this.i)) as RegExpExecArray;
      const min = Number(m[1]);
      const max = m[2] === undefined ? min : m[3] === '' ? Infinity : Number(m[3]);
      this.i += m[0].length - 1;
      q = { min, max };
    }
    if (q === null) return null;
    this.i++;
    if (this.peek() === '?') this.i++; // lazy
    return q;
  }
}

const repeats = (q: Quant | null): boolean => q !== null && q.max > 1;

function hasQuantifier(alts: readonly Term[][]): boolean {
  return alts.some((alt) =>
    alt.some((t) => t.quant !== null || (t.atom.kind === 'group' && hasQuantifier(t.atom.alts))),
  );
}

/** The one character every match of `alt` must start with, or null when that is not certain. */
function firstChar(alt: readonly Term[]): string | null {
  const first = alt[0];
  if (first === undefined || first.atom.kind !== 'char') return null;
  if (first.quant !== null && first.quant.min === 0) return null;
  return first.atom.ch;
}

function branchesOverlap(alts: readonly Term[][]): boolean {
  const firsts = alts.map(firstChar);
  return firsts.includes(null) || new Set(firsts).size !== firsts.length;
}

/** A lookbehind is allowed only when it looks at exactly one character. */
function oneCharWide(alts: readonly Term[][]): boolean {
  const only = alts.length === 1 ? alts[0] : undefined;
  const term = only?.length === 1 ? only[0] : undefined;
  return (
    term !== undefined &&
    term.quant === null &&
    (term.atom.kind === 'char' || term.atom.kind === 'set')
  );
}

function walk(alts: readonly Term[][], underRepeat: boolean, found: Set<string>): void {
  if (underRepeat && alts.length > 1 && branchesOverlap(alts)) found.add(SAFE_REGEX_ISSUES.overlap);
  for (const alt of alts) {
    for (const { atom, quant } of alt) {
      if (atom.kind === 'backref') found.add(SAFE_REGEX_ISSUES.backref);
      if (atom.kind !== 'group') continue;
      if (atom.type === 'behind' && !oneCharWide(atom.alts)) found.add(SAFE_REGEX_ISSUES.behind);
      if (repeats(quant) && hasQuantifier(atom.alts)) found.add(SAFE_REGEX_ISSUES.nested);
      walk(atom.alts, underRepeat || repeats(quant), found);
    }
  }
}

/** Plain-words structural problems with `source` (a pattern that compiles with 'gu'), in a fixed order. */
export function structuralIssues(source: string): string[] {
  const found = new Set<string>();
  walk(new Parser(source).parse(), false, found);
  return Object.values(SAFE_REGEX_ISSUES).filter((issue) => found.has(issue));
}

export interface TimingOptions {
  /** Milliseconds now; defaults to `performance.now`. Tests inject a fake clock. */
  now?: () => number;
  /** Total time allowed across every probe input, per attempt. Default 100 ms. */
  budgetMs?: number;
  /**
   * How many attempts must all go over the budget before the pattern is flagged. Default 3: a
   * slow pattern is slow every time, while a loaded machine (a parallel test run, a GC pause)
   * stalls one attempt, not three.
   */
  attempts?: number;
}

/** Characters a PII pattern is likely to loop on, alone and in pairs. */
const PROBE_UNITS = ['a', 'A', '1', ' ', '-', '.', '@', '_', '+', 'a1', 'a.', '1 ', 'a@', '1-'];
/**
 * Short inputs first, doubling, so a polynomial pattern is caught before an input long enough to
 * hang the check (each step multiplies its time by at most 2 to the power of its degree). 8,192
 * is past the 8,000-character text cap.
 */
const PROBE_LENGTHS = [32, 64, 128, 256, 512, 1_024, 2_048, 4_096, 8_192];

function probeInputs(): string[] {
  return PROBE_LENGTHS.flatMap((n) =>
    PROBE_UNITS.map((u) => u.repeat(Math.ceil(n / u.length)).slice(0, n) + '!'),
  );
}

/** One attempt: true when every probe input finished within the budget (stops at the first overrun). */
function attemptInTime(re: RegExp, now: () => number, budgetMs: number): boolean {
  const start = now();
  for (const input of probeInputs()) {
    input.replace(re, ''); // visits every match, as the scrub does
    if (now() - start > budgetMs) return false;
  }
  return true;
}

/**
 * Runs `re` over the probe inputs, shortest first. Returns an issue when every attempt goes over
 * the budget, or undefined as soon as one attempt finishes in time.
 */
export function probeTiming(re: RegExp, opts: TimingOptions = {}): string | undefined {
  const now = opts.now ?? (() => performance.now());
  const budgetMs = opts.budgetMs ?? 100;
  const attempts = opts.attempts ?? 3;
  for (let i = 0; i < attempts; i++) {
    if (attemptInTime(re, now, budgetMs)) return undefined;
  }
  return `took longer than ${budgetMs} ms on a probe input`;
}

/** Every safe-regex issue with `source`; the timing probe runs only when the structure is clean. */
export function checkSafeRegex(source: string, opts: TimingOptions = {}): string[] {
  let re: RegExp;
  try {
    re = new RegExp(source, 'gu');
  } catch {
    return [];
  }
  const structural = structuralIssues(source);
  if (structural.length > 0) return structural;
  const slow = probeTiming(re, opts);
  return slow === undefined ? [] : [slow];
}
