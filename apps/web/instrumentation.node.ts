// Node-only startup work for `instrumentation.ts`'s `register()`. Split out (task 0.20j) so this
// file's own top-level imports -- reached only through the dynamic `import('./src/auth')` /
// `import('@edmate/harness')` calls inside `warmPool`/`warmGuardPatterns` below, which themselves
// trace through `@edmate/content`'s `safeRegexGuard.ts` (a static `import { ... } from
// 'node:worker_threads'`) -- are never part of the Edge-targeted compile of `instrumentation.ts`.
// Next's own `instrumentation.md` doc says the documented way to keep Node-only code out of the
// Edge bundle is a literal `require(...)` behind an `if (NEXT_RUNTIME === 'edge')` branch in
// `instrumentation.ts`, which `require`s this file only on the Node.js runtime -- see that file.
//
// Everything below is unchanged from the old `register()` body (task 9.0c / 3.9c); only the file
// boundary moved.
export function errorName(error: unknown): string {
  return error instanceof Error ? error.name : typeof error;
}

/** Runs once per process (and once per route in `next dev`, which this file does not
 * special-case -- a second cheap read on dev reload is harmless). Called by
 * `instrumentation.ts`'s `register()` on the Node.js runtime only. */
export function runNodeStartup(): void {
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
    .then(({ warmPreGuardPatterns }) => {
      // Task 3.9e (3.9c review LOW): warmPreGuardPatterns() never throws -- it returns the names
      // of any matchers that failed instead, so a failure that would otherwise leave no trace is
      // logged here (names only, never the sample text or an error).
      const failedMatchers = warmPreGuardPatterns();
      if (failedMatchers.length > 0) {
        console.error(
          `[instrumentation] guard warm-up matcher failed: ${failedMatchers.join(',')}`,
        );
      }
    })
    .catch((error: unknown) => {
      console.error(`[instrumentation] guard warm-up failed: ${errorName(error)}`);
    });
}
