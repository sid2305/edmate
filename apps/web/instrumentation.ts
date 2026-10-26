// Next.js instrumentation convention (task 9.0c): `register()` runs once, when the server
// process starts -- before any request is routed. The 9.0 finding: a fresh container's *first*
// chat turn can log `turn.background_failed` from `preGuard`'s session-history read
// (`packages/harness/src/pipeline/steps/preGuard.ts`, `HISTORY_TIMEOUT_MS = 50`), because
// node-postgres connects lazily and that read can be the pool's first-ever query -- a cold TCP
// connect + auth handshake racing a 50ms budget. preGuard already fails safe on that timeout (it
// reports the error name and carries on with no history); this file removes the *cause* instead
// of widening that guard's budget, by forcing one real round trip through the same shared pool
// before any request can arrive.
//
// Edge note: only the Node.js runtime needs this (Edge never talks to Postgres), and `pg` must
// never be pulled into the Edge bundle. The `serverDatabase` import is therefore dynamic and
// gated on `NEXT_RUNTIME`, not a static top-level import. (This file also avoids a static import
// of anything under `src/turn/**`, which would pull in the whole turn runtime -- and its
// `@edmate/harness`/`@edmate/gateway`/`@edmate/queue` dependency graph -- just for a one-line
// helper; `errorName` is reimplemented locally instead.)
//
// Fire-and-forget: `register()` never awaits the warm-up. A DB outage (or no `DATABASE_URL` at
// all, e.g. a build step) must never delay or block server startup or `/api/health`; the warm-up
// only logs the error's name, never a message (it can quote a connection string or an email).
function errorName(error: unknown): string {
  return error instanceof Error ? error.name : typeof error;
}

/** Runs once per process (and once per route in `next dev`, which this file does not special-case
 * -- a second cheap read on dev reload is harmless). */
export function register(): void {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return;
  // `warmPool` never rejects (it catches internally); `void` just makes the "not awaited" intent
  // explicit to readers and lint.
  void warmPool();
  // Task 3.9c (found by 3.9b): a fresh process's first preGuard call pays to lazily compile its
  // guard pattern tables (~150 ms cold vs 1-8 ms warm) against preGuard's 300 ms-per-guard / step
  // 3's 400 ms budget. Synchronous CPU work, no network: runs directly, not `void`-fired. A
  // separate, independently-failing block from `warmPool` above -- a throw here must never block
  // `register()` or `/api/health`, same as a DB outage must not.
  warmGuardPatterns();
}

async function warmPool(): Promise<void> {
  try {
    const { serverDatabase } = await import('./src/auth');
    const { repos } = serverDatabase();
    // An existing, already-public, parameterless-friendly read (9.2's discovery search) -- no new
    // database surface, no raw pool handle (`@edmate/db`'s public entry has none by design).
    await repos.discovery.search({});
  } catch (error) {
    console.error(`[instrumentation] warm-up failed: ${errorName(error)}`);
  }
}

function warmGuardPatterns(): void {
  import('@edmate/harness')
    .then(({ warmPreGuardPatterns }) => warmPreGuardPatterns())
    .catch((error: unknown) => {
      console.error(`[instrumentation] guard warm-up failed: ${errorName(error)}`);
    });
}
