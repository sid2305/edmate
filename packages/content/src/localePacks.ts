// Locale packs at runtime (task 3.10): what a composition root calls to load the packs once at
// start-up and pick one per turn. Both fail closed:
//   - `loadLocalePacks` throws on any file that does not load, a PII pattern that does not compile
//     with 'gu' or fails the safe-regex check, a missing default pack, or a default pack with an
//     unverified helpline; and it refuses (never serves) a market pack with any unverified helpline
//     (lead revision 4), so a `pending` helpline can never reach a crisis reply.
//   - `pickLocalePack` checks the same again for the pack it returns, and falls back to the
//     default pack, whose country-neutral wording ("contact local emergency services or someone
//     you trust", from the frame prompt pack's no-helplines line) serves until a person verifies
//     the market's helplines. The safety alert is raised either way: it never depends on the pack.
import type { LocalePack } from '@edmate/contracts';
import { readLocalePacksDir } from './localeLoader.js';
import {
  DEFAULT_LOCALE_MARKET,
  defaultPackPresent,
  type LocalePacks,
  piiPatternsCompileWithGu,
  piiPatternsSafeRegex,
  unverifiedHelplines,
} from './localeRules.js';

export { DEFAULT_LOCALE_MARKET };

export class LocalePackError extends Error {
  override readonly name = 'LocalePackError';
}

/** The default pack, or a throw: there is no safe reply without it. */
function defaultPack(packs: LocalePacks, market: string): LocalePack {
  const fallback = packs.get(DEFAULT_LOCALE_MARKET);
  if (fallback === undefined) {
    throw new LocalePackError(
      `no usable locale pack for market "${market}": the default pack (${DEFAULT_LOCALE_MARKET}) is missing`,
    );
  }
  const why = unverifiedHelplines(fallback);
  if (why.length > 0) {
    throw new LocalePackError(
      `the default locale pack (${DEFAULT_LOCALE_MARKET}) has an unverified helpline: ${why.join('; ')}`,
    );
  }
  return fallback;
}

/**
 * The pack for `market`: its own when present and every helpline is verified, else the default
 * pack (an unknown market, or a market whose helplines a person has not yet signed off).
 */
export function pickLocalePack(market: string, packs: LocalePacks): LocalePack {
  const fallback = defaultPack(packs, market);
  const own = packs.get(market);
  return own !== undefined && unverifiedHelplines(own).length === 0 ? own : fallback;
}

export interface LoadedLocalePacks {
  /** The packs that may be served, keyed by market; always holds the default pack. */
  packs: LocalePacks;
  /** Market packs left out because a helpline is unverified; their markets get the default pack. */
  refused: { market: string; reasons: string[] }[];
}

/** Loads every pack in `dir` for runtime use (see the header for what fails and what is refused). */
export function loadLocalePacks(dir: string): LoadedLocalePacks {
  const { packs, errors } = readLocalePacksDir(dir);
  const fatal = [
    ...errors.map((e) => e.message),
    ...defaultPackPresent(packs),
    ...piiPatternsCompileWithGu(packs),
    ...piiPatternsSafeRegex(packs),
  ];
  if (fatal.length > 0) {
    throw new LocalePackError(`locale packs in ${dir} failed to load:\n${fatal.join('\n')}`);
  }
  defaultPack(packs, DEFAULT_LOCALE_MARKET);
  const served = new Map<string, LocalePack>();
  const refused: LoadedLocalePacks['refused'] = [];
  for (const [market, pack] of packs) {
    const reasons = unverifiedHelplines(pack);
    if (reasons.length === 0) served.set(market, pack);
    else refused.push({ market, reasons });
  }
  return { packs: served, refused };
}
