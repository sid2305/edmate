// The 5.5 acceptance line: "fuzz test shows no access outside declared scope." The declared scope
// is the sandbox's (tools/sandbox.ts): one arithmetic expression over numbers in, one number's
// string out, nothing else. Entitlement scope is 5.4's property tests and is not repeated here.
import { turnContextFull } from '@edmate/contracts/fixtures';
import { describe, expect, it } from 'vitest';
import { prng, type Prng } from '../testing/prng.js';
import { calculatorTool } from './calculator.js';
import {
  ALLOWED_CONSTANTS,
  ALLOWED_FUNCTIONS,
  CalculatorError,
  CALCULATOR_MAX_EXPRESSION_LENGTH,
  getRestrictedMath,
} from './sandbox.js';

/** Change the seed to explore; a failure prints it so the run can be replayed. */
const SEED = 0x5a5e_c41c;
const ITERATIONS = 2_000;
/**
 * Per-call wall-clock bound: a backstop that catches a regression making evaluate slow, not the
 * primary defence (5.5 Q2). A loose gross-regression guard only (docs/lessons.md "Wall-clock
 * bounds fail on shared CI runners"): shared, loaded CI runners are 8-12x slower than a laptop,
 * so this must stay far above any real per-call time; a real hang is seconds.
 */
const PER_CALL_MS = 2_000;

/** The harness lib has no DOM or Node types; vitest prints console output. */
function log(s: string): void {
  (globalThis as { console?: { log(s: string): void } }).console?.log(s);
}

const ATTACKS = [
  'constructor',
  '__proto__',
  'prototype',
  'globalThis',
  'process',
  'process.exit(1)',
  'require("child_process")',
  'import("fs")',
  'import({x: 1}, {override: true})',
  'createUnit("foo")',
  'eval("1")',
  'Function("return this")()',
  'evaluate("1+1")',
  'parse("1")',
  'compile("1").evaluate()',
  'simplify("x")',
  'resolve(x)',
  'sqrt.constructor("return process")()',
  'cos.constructor',
  'pi.constructor',
  '(1).constructor',
  'sqrt["constructor"]',
  'f(x) = x',
  'x = 1',
  'a.b = 1',
  '1; 2',
  '1\n2',
  '[1, 2, 3]',
  '{a: 1}',
  '"str"',
  "'str'",
  '`tpl`',
  '1e308 * 10',
  '1e-400',
  '1.5e3',
  '2pi',
  '9^9^9^9^9',
  '10^10^10',
  'exp(exp(exp(10)))',
  'factorial(1e9)',
  'gamma(170)',
  'isPrime(2^53 - 1)',
  'ones(1e6)',
  'range(1, 1e9)',
  'zeros(1000, 1000)',
  '5 cm to inch',
  'true or false',
  '1 == 1',
  '1 ? 2 : 3',
  '5!',
  "x'",
  '1:3',
  'ѕqrt(4)', // Cyrillic s
  'sqrt​(4)', // zero-width space
  '１＋１', // full-width
  'ⅼog(1)', // small roman numeral fifty
  'π',
  '\u0000',
  '\ud800',
  '(((((((((((((((((((((((((((((((((((((((((((((((((1)))))))))))))))))))))))))))))))))))))))))))))))',
  '-'.repeat(199) + '1',
  'gcd(9007199254740991, 9007199254740990)',
  'gcd(2^1000, 3)',
  // safe-integer inputs whose lcm result overflows safe-integer range (5.5a fix round)
  'lcm(9007199254740990, 9007199254740988)',
  'lcm(9007199254740881, 9007199254740879)',
  'round(1, 15)',
  'max(' + Array.from({ length: 60 }, () => '1').join(',') + ')',
  // implicit multiplication, not only when glued (5.5a)
  '1 e 2',
  '2 pi',
  'sqrt(4)pi',
  '(1)(2)',
  '(1)(2)(3)',
  'sin(1)(2)',
  '2 3',
  '2 (3)',
  'pi e',
];

const OPS = ['+', '-', '*', '/', '^', '%'];
const FUNCS = [...ALLOWED_FUNCTIONS];
const CONSTS = [...ALLOWED_CONSTANTS];
const TWO_ARGS = new Set(['gcd', 'lcm', 'mod', 'pow', 'hypot', 'max', 'min', 'round', 'log']);

function number(r: Prng): string {
  const whole = String(r.int(r.chance(0.2) ? 1_000_000 : 100));
  return r.chance(0.3) ? `${whole}.${String(r.int(1000))}` : whole;
}

/** A random well-formed arithmetic expression (it may still overflow or be NaN). */
function arithmetic(r: Prng, depth: number): string {
  const leaf = depth <= 0 || r.chance(0.3);
  if (leaf) return r.chance(0.15) ? r.pick(CONSTS) : number(r);
  switch (r.int(4)) {
    case 0:
      return `${arithmetic(r, depth - 1)} ${r.pick(OPS)} ${arithmetic(r, depth - 1)}`;
    case 1:
      return `(${arithmetic(r, depth - 1)})`;
    case 2:
      return `-${arithmetic(r, depth - 1)}`;
    default: {
      const f = r.pick(FUNCS);
      const args = TWO_ARGS.has(f)
        ? `${arithmetic(r, depth - 1)}, ${arithmetic(r, depth - 1)}`
        : arithmetic(r, depth - 1);
      return `${f}(${args})`;
    }
  }
}

/** An attack string, alone or spliced into random arithmetic. */
function attack(r: Prng): string {
  const a = r.pick(ATTACKS);
  if (r.chance(0.5)) return a;
  const host = arithmetic(r, 3);
  const at = r.int(host.length + 1);
  return host.slice(0, at) + a + host.slice(at);
}

/** Random noise, biased to ASCII but with any BMP character (surrogates included). */
function noise(r: Prng): string {
  const n = 1 + r.int(2 * CALCULATOR_MAX_EXPRESSION_LENGTH);
  let s = '';
  for (let i = 0; i < n; i++) {
    s += String.fromCharCode(r.chance(0.7) ? 32 + r.int(95) : r.int(0x10000));
  }
  return s;
}

/** What a resolved value may look like: `String(number)`. */
const NUMERIC = /^(-?(\d+(\.\d+)?(e[+-]\d+)?|Infinity)|NaN)$/;

const protoKeys = (o: object): string => JSON.stringify(Reflect.ownKeys(o).map((k) => String(k)));

const WATCHED: [string, object][] = [
  ['Object.prototype', Object.prototype],
  ['Function.prototype', Function.prototype],
  ['Array.prototype', Array.prototype],
  ['Number.prototype', Number.prototype],
  ['String.prototype', String.prototype],
  ['globalThis', globalThis],
];

describe('calculator fuzz: no access outside the declared scope', () => {
  it('import and createUnit are disabled on the restricted instance', () => {
    expect(() => getRestrictedMath().import({ evil: () => 1 }, { override: true })).toThrow(
      CalculatorError,
    );
    expect(() => getRestrictedMath().createUnit('evil')).toThrow(CalculatorError);
  });

  it(
    `${String(ITERATIONS)} seeded inputs: a numeric value or a CalculatorError, each fast, prototypes untouched`,
    { timeout: 60_000 },
    async () => {
      const r = prng(SEED);
      const tally = { valid: 0, attack: 0, noise: 0, resolved: 0, rejected: 0 };
      const reasons: Record<string, number> = {};
      let slowest = 0;
      const before = WATCHED.map(([, o]) => protoKeys(o));
      for (let i = 0; i < ITERATIONS; i++) {
        const at = `seed ${String(SEED)} iteration ${String(i)}`;
        const kind = r.pick(['valid', 'attack', 'noise'] as const);
        tally[kind]++;
        const raw =
          kind === 'valid' ? arithmetic(r, 1 + r.int(5)) : kind === 'attack' ? attack(r) : noise(r);
        const expression = raw.slice(0, 1 + r.int(2 * CALCULATOR_MAX_EXPRESSION_LENGTH));

        const started = Date.now();
        let outcome: { ok: true; value: unknown } | { ok: false; error: unknown };
        try {
          outcome = {
            ok: true,
            value: await calculatorTool.tool.run({ expression }, turnContextFull),
          };
        } catch (error) {
          outcome = { ok: false, error };
        }
        const took = Date.now() - started;
        slowest = Math.max(slowest, took);
        expect(took, `${at}: took ${String(took)}ms`).toBeLessThan(PER_CALL_MS);

        if (outcome.ok) {
          tally.resolved++;
          expect(calculatorTool.tool.output.safeParse(outcome.value).success, at).toBe(true);
          const value = (outcome.value as { value: string }).value;
          expect(value, `${at}: ${JSON.stringify(expression)}`).toMatch(NUMERIC);
          expect(expression.length, at).toBeLessThanOrEqual(CALCULATOR_MAX_EXPRESSION_LENGTH);
        } else {
          tally.rejected++;
          expect(outcome.error, `${at}: ${JSON.stringify(expression)}`).toBeInstanceOf(
            CalculatorError,
          );
          const reason = (outcome.error as CalculatorError).reason;
          reasons[reason] = (reasons[reason] ?? 0) + 1;
        }

        WATCHED.forEach(([name, o], k) => {
          expect(protoKeys(o), `${at}: ${name} changed`).toBe(before[k]);
        });
      }
      // Every kind ran, and both outcomes happened: the fuzz is not trivially one-sided.
      expect(tally.valid).toBeGreaterThan(0);
      expect(tally.attack).toBeGreaterThan(0);
      expect(tally.noise).toBeGreaterThan(0);
      expect(tally.resolved).toBeGreaterThan(ITERATIONS / 10);
      expect(tally.rejected).toBeGreaterThan(ITERATIONS / 10);
      log(
        `calculator fuzz: seed ${String(SEED)}, ${JSON.stringify(tally)}, ` +
          `reasons ${JSON.stringify(reasons)}, slowest ${String(slowest)}ms`,
      );
    },
  );
});
