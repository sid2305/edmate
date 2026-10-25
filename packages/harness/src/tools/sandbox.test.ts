import { describe, expect, it } from 'vitest';
import { HarnessError } from '../pipeline/errors.js';
import {
  ALLOWED_CONSTANTS,
  ALLOWED_FUNCTIONS,
  CalculatorError,
  evaluateExpression,
  CALCULATOR_MAX_EXPRESSION_LENGTH,
  getRestrictedMath,
  toResultString,
} from './sandbox.js';

const rejectedWith = (expression: string): string | undefined => {
  try {
    evaluateExpression(expression);
    return undefined;
  } catch (e) {
    expect(e).toBeInstanceOf(CalculatorError);
    return (e as CalculatorError).reason;
  }
};

describe('the restricted mathjs instance', () => {
  it.each([
    ['import', () => getRestrictedMath().import({ x: 1 }, { override: true })],
    ['createUnit', () => getRestrictedMath().createUnit('furlong')],
    ['evaluate', () => getRestrictedMath().evaluate('1+1')],
    ['parse', () => getRestrictedMath().parse('1+1')],
    ['compile', () => getRestrictedMath().compile('1+1')],
    ['simplify', () => getRestrictedMath().simplify('x+x')],
    ['derivative', () => getRestrictedMath().derivative('x^2', 'x')],
    ['resolve', () => getRestrictedMath().resolve('x', {})],
  ])('%s is disabled and throws a CalculatorError', (_name, call) => {
    expect(call).toThrow(new CalculatorError('disabled'));
  });

  it('is built once and reused across evaluations', () => {
    expect(evaluateExpression('1+1')).toBe('2');
    const first = getRestrictedMath();
    expect(evaluateExpression('2+2')).toBe('4');
    const second = getRestrictedMath();
    expect(second).toBe(first);
  });
});

describe('CalculatorError', () => {
  it('is a HarnessError with a fixed message naming only the reason', () => {
    const e = new CalculatorError('bad_character');
    expect(e).toBeInstanceOf(HarnessError);
    expect(e.name).toBe('CalculatorError');
    expect(e.reason).toBe('bad_character');
    expect(e.message).toBe('calculator: bad_character');
  });
});

describe('evaluateExpression: valid arithmetic', () => {
  it.each([
    ['1+2', '3'],
    ['2+3*4', '14'],
    ['(2+3)*4', '20'],
    ['2^10', '1024'],
    ['-2^2', '-4'],
    ['7 - -3', '10'],
    ['1/2 + 1/4', '0.75'],
    ['.5 * 4', '2'],
    ['10 % 3', '1'],
    ['sqrt(16)', '4'],
    ['abs(-3.5)', '3.5'],
    ['round(2.567, 2)', '2.57'],
    ['max(1, 9, 3) - min(4, 2)', '7'],
    ['floor(2.9) + ceil(2.1)', '5'],
    ['log(e)', '1'],
    ['log10(1000)', '3'],
    ['log2(8)', '3'],
    ['log(8, 2)', '3'],
    ['exp(0)', '1'],
    ['pow(2, 3)', '8'],
    ['mod(-7, 3)', '2'],
    ['gcd(12, 18) + lcm(4, 6)', '18'],
    ['sign(-4) + cbrt(27)', '2'],
    ['hypot(3, 4)', '5'],
    ['sin(0) + cos(0) + tan(0)', '1'],
    ['asin(0) + acos(1) + atan(0)', '0'],
    ['2 * pi / pi', '2'],
    ['(((1)))', '1'],
    // implicit multiplication is refused, but an explicit operator before `(` is fine (5.5a)
    ['(1)*(2)', '2'],
    ['-(2)', '-2'],
    ['2^(3)', '8'],
    ['  3\t*\t3  ', '9'],
    ['1/0', 'Infinity'],
    ['-1/0', '-Infinity'],
    ['0/0', 'NaN'],
    ['10^10^10', 'Infinity'],
    ['exp(1000)', 'Infinity'],
    // predictable mode: a non-real result is NaN, never a Complex value.
    ['sqrt(-1)', 'NaN'],
    ['log(-1)', 'NaN'],
  ])('%s = %s', (expression, value) => {
    expect(evaluateExpression(expression)).toBe(value);
  });

  it('every allowed function and constant is a real mathjs name (the lists are not stale)', () => {
    const math = getRestrictedMath();
    for (const f of ALLOWED_FUNCTIONS) {
      expect(typeof (math as unknown as Record<string, unknown>)[f]).toBe('function');
    }
    for (const c of ALLOWED_CONSTANTS) {
      expect(typeof (math as unknown as Record<string, unknown>)[c]).toBe('number');
    }
  });

  it(`accepts exactly ${CALCULATOR_MAX_EXPRESSION_LENGTH} characters`, () => {
    const exact = ('1+'.repeat(99) + '1').padEnd(CALCULATOR_MAX_EXPRESSION_LENGTH, ' ');
    expect(exact).toHaveLength(CALCULATOR_MAX_EXPRESSION_LENGTH);
    expect(evaluateExpression(exact)).toBe('100');
  });
});

describe('evaluateExpression: rejected before mathjs sees it', () => {
  it.each([
    // empty and length
    ['', 'empty'],
    ['   ', 'empty'],
    ['1'.repeat(CALCULATOR_MAX_EXPRESSION_LENGTH + 1), 'too_long'],
    // identifiers not on the list
    ['x + 1', 'unknown_name'],
    ['constructor', 'unknown_name'],
    ['__proto__', 'unknown_name'],
    ['globalThis', 'unknown_name'],
    ['process', 'unknown_name'],
    ['require("fs")', 'unknown_name'],
    ['import("fs")', 'unknown_name'],
    ['createUnit("x")', 'unknown_name'],
    ['eval("1")', 'unknown_name'],
    ['Function("1")', 'unknown_name'],
    ['evaluate("1")', 'unknown_name'],
    ['SQRT(4)', 'unknown_name'],
    ['factorial(170)', 'unknown_name'],
    ['true', 'unknown_name'],
    ['Infinity', 'unknown_name'],
    // member access
    ['sqrt.constructor', 'bad_name_use'],
    ['pi.e', 'bad_character'],
    ['(1).toString', 'bad_character'],
    ['sqrt["constructor"]', 'bad_name_use'],
    ['1.2.3', 'bad_character'],
    // function used as a value, constant called
    ['sqrt', 'bad_name_use'],
    ['sqrt + 1', 'bad_name_use'],
    ['pi(2)', 'bad_name_use'],
    ['e (2)', 'bad_name_use'],
    // a name glued to a number (implicit multiplication or scientific notation)
    ['2pi', 'bad_name_use'],
    ['1e10', 'unknown_name'],
    ['1e+5', 'bad_name_use'],
    ['1.5e3', 'unknown_name'],
    ['2.e', 'bad_name_use'],
    // implicit multiplication across a space or a `)`, not only when glued (5.5a)
    ['1 e 2', 'bad_name_use'],
    ['2 pi', 'bad_name_use'],
    ['sqrt(4)pi', 'bad_name_use'],
    ['(1)(2)', 'bad_character'],
    ['(1)(2)(3)', 'bad_character'],
    ['sin(1)(2)', 'bad_character'],
    ['2 3', 'bad_character'],
    ['2 (3)', 'bad_character'],
    ['pi e', 'bad_name_use'],
    // strings, matrices, objects, assignment, statements, other operators
    ['"1"', 'bad_character'],
    ["'1'", 'bad_character'],
    ['`1`', 'bad_character'],
    ['[1, 2]', 'bad_character'],
    ['{a: 1}', 'bad_character'],
    ['1 = 1', 'bad_character'],
    ['1; 2', 'bad_character'],
    ['1\n2', 'bad_character'],
    ['1 == 1', 'bad_character'],
    ['1 < 2', 'bad_character'],
    ['5!', 'bad_character'],
    ['1 ? 2 : 3', 'bad_character'],
    ['1 & 2', 'bad_character'],
    ['~1', 'bad_character'],
    ["2'", 'bad_character'],
    ['1:3', 'bad_character'],
    ['@', 'bad_character'],
    ['$1', 'bad_character'],
    ['a_b', 'unknown_name'],
    ['_x', 'unknown_name'],
    // Unicode homoglyphs and invisible characters
    ['ѕqrt(4)', 'bad_character'], // Cyrillic s
    ['1​+1', 'bad_character'], // zero-width space
    ['１+1', 'bad_character'], // full-width digit
    ['1 + 1', 'bad_character'], // no-break space
  ])('%j → %s', (expression, reason) => {
    expect(rejectedWith(expression)).toBe(reason);
  });

  it('a non-string input is rejected (the tool schema should stop it first)', () => {
    expect(rejectedWith(42 as unknown as string)).toBe('not_a_string');
  });
});

describe('evaluateExpression: evaluation errors are fixed-text', () => {
  it.each([
    ['1 +', 'evaluation_failed'],
    ['(1', 'evaluation_failed'],
    ['1)', 'evaluation_failed'],
    ['sqrt()', 'evaluation_failed'],
    ['sqrt(1, 2, 3)', 'evaluation_failed'],
    ['1, 2', 'evaluation_failed'],
    ['gcd(1.5, 2)', 'evaluation_failed'],
    ['round(1, 1000)', 'evaluation_failed'],
    // gcd/lcm silently give a wrong answer above the safe integer range (5.5a); refuse instead
    ['gcd(2^1000, 3)', 'evaluation_failed'],
    ['lcm(2^1000, 3)', 'evaluation_failed'],
  ])('%j → %s, with no mathjs message', (expression, reason) => {
    let caught: unknown;
    try {
      evaluateExpression(expression);
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(CalculatorError);
    expect((caught as CalculatorError).reason).toBe(reason);
    expect((caught as CalculatorError).message).toBe(`calculator: ${reason}`);
  });
});

describe('toResultString: only a plain number becomes a value', () => {
  it.each([
    [3, '3'],
    [-0.5, '-0.5'],
    [Infinity, 'Infinity'],
    [Number.NaN, 'NaN'],
  ])('%s → %s', (n, out) => {
    expect(toResultString(n)).toBe(out);
  });

  it.each([
    ['a boolean', true],
    ['a string', '1'],
    ['a function', () => 1],
    ['an object', { entries: [1] }],
    ['an array', [1]],
    ['a bigint', 1n],
    ['undefined', undefined],
    ['null', null],
  ])('%s is unsupported_result (fails closed)', (_label, value) => {
    expect(() => toResultString(value)).toThrow(new CalculatorError('unsupported_result'));
  });
});
