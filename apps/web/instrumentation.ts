import type * as NodeStartup from './instrumentation.node';

// Next.js instrumentation convention (task 9.0c): `register()` runs once, when the server
// process starts -- before any request is routed. The 9.0 finding: a fresh container's *first*
// chat turn can log `turn.background_failed` from `preGuard`'s session-history read
// (`packages/harness/src/pipeline/steps/preGuard.ts`, `HISTORY_TIMEOUT_MS = 50`), because
// node-postgres connects lazily and that read can be the pool's first-ever query -- a cold TCP
// connect + auth handshake racing a 50ms budget. preGuard already fails safe on that timeout (it
// reports the error name and carries on with no history); the warm-up in `instrumentation.node.ts`
// removes the *cause* instead of widening that guard's budget, by forcing one real round trip
// through the same shared pool before any request can arrive.
//
// Edge note (task 0.20j): all Node-only work (the pool warm-up, the guard-pattern warm-up) lives
// in `./instrumentation.node`, required here only on the Node.js runtime. This is Next's own
// documented shape for keeping Node-only code out of the Edge bundle (`instrumentation.md`,
// "Specifying the runtime"): a literal `require(...)` behind a compile-time
// `if (NEXT_RUNTIME === 'edge')` branch, which Next eliminates per build target *before*
// Edge-compatibility checking runs. The previous shape here -- an `if/return` guard followed by a
// dynamic `import()` of Node-only code -- is not that documented shape: in `next dev` (no
// minification, so no generic dead-code elimination either) the Edge-targeted compile still
// traced through the dynamic imports into `@edmate/content`'s `safeRegexGuard.ts`, whose static,
// top-level `import { ... } from 'node:worker_threads'` the Edge compiler flags. That flag became
// a dev-overlay that ate clicks (0.20h/0.20j). `require()` of a file whose own top-level imports
// are all dynamic has no such static trace for the Edge compiler to follow.
//
// Fire-and-forget: `register()` never awaits the warm-up (enforced inside `instrumentation.node`'s
// `runNodeStartup`). A DB outage (or no `DATABASE_URL` at all, e.g. a build step) must never delay
// or block server startup or `/api/health`; the warm-up only logs the error's name, never a
// message (it can quote a connection string or an email).
export function register(): void {
  if (process.env.NEXT_RUNTIME === 'edge') {
    return;
  }
  // Literal `require(...)` behind the branch above is Next's documented shape for excluding
  // Node-only code from the Edge bundle; a dynamic `import()` here would defeat the point (see
  // the comment above).
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  (require('./instrumentation.node') as typeof NodeStartup).runNodeStartup();
}
