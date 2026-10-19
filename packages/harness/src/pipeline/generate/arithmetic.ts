// A tiny, bounded arithmetic evaluator for the answer-leak checks (task 4.5): "print(8*2)" or
// f"{5+3}" names a number as surely as "16" does. Numbers, + - * / // % ** × ÷ and parentheses
// only: no names, no calls, no library evaluator, so model text can never run anything. Inputs
// are capped in length, tokens and nesting; anything else is "not an expression" (undefined).

/** Longest expression text looked at, in UTF-16 units. */
export const MAX_EXPRESSION_LENGTH = 64;
const MAX_TOKENS = 31;
const MAX_DEPTH = 8;

type Tok = { n: number } | { op: string };

const TOKEN = /\s*(\d+(?:\.\d+)?|\*\*|\/\/|[-+*/%×÷()])/y;

function tokens(s: string): Tok[] | undefined {
  const out: Tok[] = [];
  TOKEN.lastIndex = 0;
  let at = 0;
  while (at < s.length) {
    if (/^\s*$/.test(s.slice(at))) break;
    TOKEN.lastIndex = at;
    const m = TOKEN.exec(s);
    if (m === null) return undefined;
    const t = m[1] as string;
    out.push(/\d/.test(t) ? { n: Number(t) } : { op: t === '×' ? '*' : t === '÷' ? '/' : t });
    at = TOKEN.lastIndex;
  }
  return out.length <= MAX_TOKENS ? out : undefined;
}

const PREC: Record<string, number> = { '+': 1, '-': 1, '*': 2, '/': 2, '//': 2, '%': 2, '**': 3 };

function apply(op: string, a: number, b: number): number {
  switch (op) {
    case '+':
      return a + b;
    case '-':
      return a - b;
    case '*':
      return a * b;
    case '/':
      return a / b;
    case '//':
      return Math.floor(a / b);
    case '%':
      return a - b * Math.floor(a / b);
    default:
      return a ** b;
  }
}

/**
 * The value of `text` when it is an arithmetic expression with at least one binary operator,
 * else undefined (also for division by zero, overflow or anything past the caps).
 */
export function evaluateArithmetic(text: string): number | undefined {
  if (text.length > MAX_EXPRESSION_LENGTH) return undefined;
  const toks = tokens(text);
  if (toks === undefined || toks.length < 3) return undefined;
  let i = 0;
  let binary = 0;
  const peekOp = (): string | undefined => {
    const t = toks[i];
    return t !== undefined && 'op' in t ? t.op : undefined;
  };

  const primary = (depth: number): number | undefined => {
    if (depth > MAX_DEPTH) return undefined;
    const t = toks[i++];
    if (t === undefined) return undefined;
    if ('n' in t) return t.n;
    if (t.op === '-' || t.op === '+') {
      const v = primary(depth + 1);
      return v === undefined ? undefined : t.op === '-' ? -v : v;
    }
    if (t.op !== '(') return undefined;
    const v = expr(0, depth + 1);
    if (v === undefined || peekOp() !== ')') return undefined;
    i++;
    return v;
  };

  const expr = (minPrec: number, depth: number): number | undefined => {
    let left = primary(depth);
    for (;;) {
      if (left === undefined) return undefined;
      const op = peekOp();
      const p = op === undefined ? undefined : PREC[op];
      if (op === undefined || p === undefined || p < minPrec) {
        return left;
      }
      i++;
      // `**` is right-associative; the rest are left-associative.
      const right = expr(op === '**' ? p : p + 1, depth + 1);
      if (right === undefined) return undefined;
      binary++;
      left = apply(op, left, right);
    }
  };

  const v = expr(0, 0);
  if (v === undefined || i !== toks.length || binary === 0 || !Number.isFinite(v)) return undefined;
  return v;
}

/** Runs of expression-looking characters in a folded text, with their start index. */
const RUN = /(?:[\d+\-*/%×÷()\s]|(?<=\d)\.(?=\d)){3,}/g;

/** Every arithmetic expression in `text` with its value and span (folded text, ASCII digits). */
export function arithmeticSpans(text: string): { value: number; start: number; end: number }[] {
  const out: { value: number; start: number; end: number }[] = [];
  const count = (a: number, b: number, ch: string): number => text.slice(a, b).split(ch).length - 1;
  const space = (i: number): boolean => /\s/.test(text.charAt(i));
  for (const m of text.matchAll(RUN)) {
    let a = m.index;
    let b = a + m[0].length;
    while (a < b && space(a)) a++;
    while (b > a && space(b - 1)) b--;
    // Drop parentheses the run caught from the text around it, e.g. the call in "print(8*2)".
    while (count(a, b, '(') > count(a, b, ')') && text.charAt(a) === '(') {
      a++;
      while (a < b && space(a)) a++;
    }
    while (count(a, b, ')') > count(a, b, '(') && text.charAt(b - 1) === ')') {
      b--;
      while (b > a && space(b - 1)) b--;
    }
    const value = evaluateArithmetic(text.slice(a, b));
    if (value !== undefined) out.push({ value, start: a, end: b });
  }
  return out;
}
