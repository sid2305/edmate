// The calculator's sandbox (task 5.5): one restricted mathjs instance and `evaluateExpression`.
//
// Declared scope: parse and evaluate ONE arithmetic expression over plain numbers and return the
// result as a string; nothing else. No variables or other identifiers, no units, no matrices or
// objects, no strings, no assignment, no comparison or logic, no multiple statements, no member
// access, no filesystem, network, process or global access. Input is capped at
// CALCULATOR_MAX_EXPRESSION_LENGTH characters; output is a single number's string. Anything outside that
// scope throws a `CalculatorError` with a fixed reason, never mathjs's own message.
//
// Defences, in order:
// 1. A tokenizer allow-list runs before mathjs ever sees the text (see `checkExpression`).
// 2. mathjs runs with `predictable: true` and plain `number`s (not BigNumber): overflow is
//    `Infinity` in O(1) and a non-real result is `NaN`, never a Complex value or a slow loop.
// 3. mathjs's documented sandbox recipe: `import`, `createUnit`, `evaluate`, `parse`, `compile`,
//    `simplify`, `derivative` and `resolve` are overridden to throw, so even an expression that
//    slipped past step 1 could not reach them.
// 4. Only a `number` result is returned (`toResultString`); anything else fails closed.
//
// mathjs's `evaluate` is synchronous, so the tool loop's TOOL_TIMEOUT_MS race cannot preempt it
// once started (5.5 Q2, lead answer 20 Oct 2026). The length cap and the short function list are
// what keep a call fast; the fuzz test's per-call wall-clock bound is a backstop.
import { all, create, type FactoryFunctionMap } from 'mathjs';
import { HarnessError } from '../pipeline/errors.js';

/** The longest expression the calculator accepts (5.5 Q2: 200 characters). */
export const CALCULATOR_MAX_EXPRESSION_LENGTH = 200;

/**
 * Functions a numeric check or grounding step plausibly needs, each O(1) on plain numbers.
 * Deliberately left out: anything slow or unbounded on a large argument (`factorial`, `gamma`,
 * `combinations`, `permutations`, `isPrime`, `primeFactors`), anything that builds a matrix, unit,
 * string or function, and anything that parses or evaluates text.
 */
export const ALLOWED_FUNCTIONS: ReadonlySet<string> = new Set([
  'abs',
  'acos',
  'asin',
  'atan',
  'cbrt',
  'ceil',
  'cos',
  'exp',
  'floor',
  'gcd',
  'hypot',
  'lcm',
  'log',
  'log10',
  'log2',
  'max',
  'min',
  'mod',
  'pow',
  'round',
  'sign',
  'sin',
  'sqrt',
  'tan',
]);

/** Named constants. Scientific notation (`1e10`) is unsupported by design (5.5 Q1): use `10^10`. */
export const ALLOWED_CONSTANTS: ReadonlySet<string> = new Set(['pi', 'e']);

/** Why the calculator refused or failed. Fixed text only: never the expression or a mathjs message. */
export type CalculatorErrorReason =
  | 'not_a_string'
  | 'empty'
  | 'too_long'
  | 'bad_character'
  | 'unknown_name'
  | 'bad_name_use'
  | 'evaluation_failed'
  | 'unsupported_result'
  | 'disabled';

export class CalculatorError extends HarnessError {
  override readonly name = 'CalculatorError';

  constructor(readonly reason: CalculatorErrorReason) {
    super(`calculator: ${reason}`);
  }
}

const disabled = (): never => {
  throw new CalculatorError('disabled');
};

/** The restricted instance. Exported for its own tests only; the barrel does not re-export it. */
export const restrictedMath = create(all as FactoryFunctionMap, {
  number: 'number',
  predictable: true,
});
const limitedEvaluate = restrictedMath.evaluate.bind(restrictedMath);
restrictedMath.import(
  {
    import: disabled,
    createUnit: disabled,
    evaluate: disabled,
    parse: disabled,
    compile: disabled,
    simplify: disabled,
    derivative: disabled,
    resolve: disabled,
  },
  { override: true },
);

// Tokens, matched at the current position (sticky). Only ASCII; anything else is rejected.
const SPACE = /[ \t]+/y;
const NUMBER = /\d+\.?\d*|\.\d+/y;
const NAME = /[A-Za-z_][A-Za-z0-9_]*/y;
const OPERATOR = /[+\-*/^%(),]/y;

function matchAt(re: RegExp, s: string, at: number): string | undefined {
  re.lastIndex = at;
  return re.exec(s)?.[0];
}

/** The next non-space character at or after `at`, or '' at the end. */
function nextNonSpace(s: string, at: number): string {
  return s.slice(at).trimStart().charAt(0);
}

/**
 * The allow-list: the expression must be numbers, the operators `+ - * / ^ % ( ) ,`, spaces and
 * tabs, and allowed names. A function name must be followed by `(`; a constant must not be. A name
 * may not directly follow a number (`2pi`, `1e5`) and a number may not directly follow a `.`.
 */
function checkExpression(s: string): void {
  let at = 0;
  let afterNumber = false;
  while (at < s.length) {
    const space = matchAt(SPACE, s, at);
    if (space !== undefined) {
      at += space.length;
      afterNumber = false;
      continue;
    }
    const num = matchAt(NUMBER, s, at);
    if (num !== undefined) {
      at += num.length;
      if (s.charAt(at) === '.') throw new CalculatorError('bad_character');
      afterNumber = true;
      continue;
    }
    const name = matchAt(NAME, s, at);
    if (name !== undefined) {
      const isFunction = ALLOWED_FUNCTIONS.has(name);
      if (!isFunction && !ALLOWED_CONSTANTS.has(name)) throw new CalculatorError('unknown_name');
      at += name.length;
      const calls = nextNonSpace(s, at) === '(';
      if (afterNumber || isFunction !== calls) throw new CalculatorError('bad_name_use');
      afterNumber = false;
      continue;
    }
    if (matchAt(OPERATOR, s, at) === undefined) throw new CalculatorError('bad_character');
    at += 1;
    afterNumber = false;
  }
}

/** A plain number as a string (`Infinity`, `NaN` included); anything else fails closed. */
export function toResultString(result: unknown): string {
  if (typeof result !== 'number') throw new CalculatorError('unsupported_result');
  return String(result);
}

/** Evaluates one arithmetic expression inside the declared scope (see the file comment). */
export function evaluateExpression(expression: string): string {
  if (typeof expression !== 'string') throw new CalculatorError('not_a_string');
  if (expression.length > CALCULATOR_MAX_EXPRESSION_LENGTH) throw new CalculatorError('too_long');
  if (expression.trim() === '') throw new CalculatorError('empty');
  checkExpression(expression);
  let result: unknown;
  try {
    result = limitedEvaluate(expression);
  } catch {
    throw new CalculatorError('evaluation_failed');
  }
  return toResultString(result);
}
