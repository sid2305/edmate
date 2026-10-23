// A fixed market for a caller that is not a signed-in student (task 8.5d): the studio test chat
// previews on one market, read once from the environment, rather than the real student turn's
// per-student `users.market` (9.4a). Kept out of `runtime.ts` on purpose: a stack-config test
// (9.0) asserts the student turn runtime's source never names `EDMATE_MARKET`, so no env var can
// ever pick a student's market by accident; this module is the one place that name may appear.
import type { Env } from './runtime';
import { TurnUnavailableError } from './routes';

/**
 * Production fails closed without a locale pack for the configured market; elsewhere an unset or
 * unknown market runs as `global`.
 */
export function configuredMarket(env: Env, packs: ReadonlyMap<string, unknown>): string {
  const market = env.EDMATE_MARKET?.trim() ?? '';
  if (env.NODE_ENV === 'production') {
    if (!packs.has(market)) throw new TurnUnavailableError('EDMATE_MARKET');
    return market;
  }
  return market || 'global';
}
