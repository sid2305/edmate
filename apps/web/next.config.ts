import createNextIntlPlugin from 'next-intl/plugin';
import type { NextConfig } from 'next';

// `next build` runs with Turbopack (package.json's `build` script, no `--webpack`) as of 1.7e.
// 1.7 fix round 1 traced Turbopack's original build failure to the same root cause webpack had
// (1.7b): `safeRegexGuard.ts`'s `new URL(<literal>, import.meta.url)` worker-path expression,
// which both bundlers' "URL asset" convention misparses. 1.7b removed that expression (now a
// plain string path, built with `fileURLToPath` + `path.join`), which fixed `next build --webpack`.
// A `next build` trial after that fix (no `--webpack`) still failed at the time with a *different*
// error: Turbopack's build-time page-data collection reaching apps/web/vitest.config.ts -> this
// workspace's own Vite -> lightningcss's native addon, which Turbopack couldn't place in an ESM
// chunk. 1.7b kept `--webpack` for that reason (lead's call). 1.7e re-ran the same `next build`
// (no `--webpack`) against today's `main` (Next 16.4.2) and that lightningcss/vitest.config.ts
// error no longer reproduces -- the build compiles and finishes cleanly (only pre-existing Edge
// Runtime "Node.js API used" warnings, same ones `--webpack` also prints, not build failures). No
// narrow fix was needed; the underlying Next.js/Turbopack bug this plan expected to work around
// appears to have already been fixed upstream between 1.7b and today. `build` now runs plain
// `next build` (Turbopack); `build-smoke` passed against that output (1.7e handoff).
//
// Fix round (security review of PR #76): removing the `new URL(...)` asset-URL shape stopped
// webpack from copying only the worker file's bytes, but webpack still *bundles* `@edmate/content`
// into the server chunk regardless of `serverExternalPackages` below -- that option's own "is this
// under node_modules" check runs on the *resolved* real path, and a pnpm workspace package's real
// path (`packages/content/dist/**`) sits outside any node_modules tree, so the check misses it (a
// known pnpm-monorepo gap, not something this config can close). `serverExternalPackages` is kept
// anyway as a harmless, correct declaration of intent in case a future Next/pnpm combination
// honours it. Bundled, `import.meta.url` is rewritten to the build machine's own absolute `file://`
// path -- correct only on that machine. Any relocated copy of the build (the Docker image: built
// in /repo, run from /app; any standalone output copied elsewhere) resolves a path that does not
// exist there, and `checkSafeRegexGuarded` needs `EDMATE_CONTENT_WORKER_DIR` (an explicit,
// env-set, correct location -- `apps/web/Dockerfile` sets it) to find the real worker file
// instead; a location it cannot find at all is reported unsafe, never run unbounded (see
// safeRegexGuard.ts's production fail-closed fix). `outputFileTracingIncludes` below makes sure
// the standalone output actually carries that package's `dist/**` (the worker's own file, plus its
// sibling `safeRegex.js` import) along, not just the entry file Next's default tracing would find
// from static imports -- `EDMATE_CONTENT_WORKER_DIR` only says where to look, not that anything is
// there to find.
// Task 13.3a: the three security headers that need no per-request data, set once here so a
// reviewer sees the full static policy in one array literal. The nonce-bearing
// `Content-Security-Policy` and production-only HSTS live in `./proxy.ts` instead: Next's own
// App Router hydration/RSC bootstrap emits inline `<script>` content that differs per request, so
// a build-time hash (static `headers()`) can never match it, and only `proxy.ts` can mint a nonce
// per request. See `proxy.ts`'s own comment for the full CSP.
const SECURITY_HEADERS = [
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
];

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  // `next dev` would otherwise write an AGENTS.md here; agent rules live in the repo's CLAUDE.md.
  agentRules: false,
  // Self-contained server bundle for the Docker image (apps/web/Dockerfile, task 0.2).
  output: 'standalone',
  // 1.7e, Phase B tried adding `@edmate/queue`/`bullmq`/`ioredis`/`pg` here to fix `next dev
  // --webpack`'s `/api/health` 500 (`instrumentation.ts` -> `src/auth/index.ts` ->
  // `rate-limit.ts` -> `@edmate/queue` -> `bullmq`, and separately -> `packages/db` -> `pg`). It
  // didn't work and was reverted: webpack dev's own log names the failing compile target
  // `/instrumentation` (distinct from any route/page bundle), and adding entries here only ever
  // moved which import in that same chain hit a wall next (first bullmq's `crypto` import, then --
  // once that was added too -- `pg`'s `fs` import); it never cleared it, which means
  // `serverExternalPackages` (documented as applying to server/route bundles) isn't reaching
  // whatever compiles `/instrumentation`. See `apps/web/playwright.config.ts`'s own comment and
  // `docs/tasks/1.7e/handoff.md` (Phase B) for the full finding; a real fix would need to touch
  // `instrumentation.ts` or `src/auth/*` (how `@edmate/queue`/`pg` get imported there), both out of
  // this task's scope.
  serverExternalPackages: ['@edmate/content'],
  // 0.20j: Next's dev-only tools badge is fixed bottom-left and intercepts clicks on any button
  // that lands there (e.g. the "Create package" button once Playwright scrolls to it); it never
  // renders in production, so disabling it only affects `next dev`.
  devIndicators: false,
  outputFileTracingIncludes: {
    '/**': ['../../packages/content/dist/**'],
  },
  async headers() {
    return [{ source: '/(.*)', headers: SECURITY_HEADERS }];
  },
};

// Non-routing mode (task 9.1): reads `./src/i18n/request.ts` (next-intl's default path), no
// `[locale]` segment, no middleware. English-only pilot; see that file's own comment.
const withNextIntl = createNextIntlPlugin();

export default withNextIntl(nextConfig);
