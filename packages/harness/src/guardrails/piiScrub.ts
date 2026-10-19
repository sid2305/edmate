// The piiScrub guard (task 4.2): regex-only, no model call, the one guard of the scrub phase.
// It rewrites the student's input so phone numbers, emails, card data, OTP-like codes, the
// student's own name and the locale pack's patterns never reach a model, a trace or history.
//
// It never blocks or escalates. Its reason names categories only, never matched text. A locale
// pattern that does not compile with 'gu' makes `run` throw, so the chain fails and the turn
// blocks (fail closed). Its output always scrubs clean, so the chain's verification pass accepts it.
import type { LocalePack } from '@edmate/contracts';
import type { Guard, GuardRun } from './guard.js';
import { compileLocalePatterns, scrubPii } from './piiPatterns.js';

export interface PiiScrubCtx {
  readonly locale: LocalePack;
}

/** Compiled patterns per pack array: packs are loaded once and reused across turns. */
const compiled = new WeakMap<readonly string[], RegExp[]>();

function patternsOf(locale: LocalePack): RegExp[] {
  const sources = locale.piiPatterns;
  let res = compiled.get(sources);
  if (res === undefined) {
    res = compileLocalePatterns(sources);
    compiled.set(sources, res);
  }
  return res;
}

export function createPiiScrubGuard(): Guard<PiiScrubCtx> {
  return {
    name: 'piiScrub',
    phase: 'scrub',
    run(text, ctx): Promise<GuardRun> {
      try {
        const { text: out, categories } = scrubPii(text, patternsOf(ctx.locale));
        if (categories.length === 0) return Promise.resolve({ result: { ok: true }, usage: [] });
        return Promise.resolve({
          result: {
            ok: false,
            action: 'rewrite',
            text: out,
            reason: `redacted: ${categories.join(', ')}`,
          },
          usage: [],
        });
      } catch (e) {
        return Promise.reject(e as Error);
      }
    },
  };
}
