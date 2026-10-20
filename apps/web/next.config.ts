import type { NextConfig } from 'next';

// `next build` runs with `--webpack` (package.json), not Turbopack. 1.7 fix round 1 traced
// Turbopack's failure here to the same root cause webpack had (1.7b): `safeRegexGuard.ts`'s
// `new URL(<literal>, import.meta.url)` worker-path expression, which both bundlers' "URL asset"
// convention misparses. 1.7b removed that expression (now a plain string path, built with
// `fileURLToPath` + `path.join`), which fixed `next build --webpack`. A `next build` trial after
// that fix (no `--webpack`) still fails, but for a different reason now: Turbopack's build-time
// page-data collection still somehow reaches apps/web/vitest.config.ts -> this workspace's own
// Vite -> lightningcss's native addon, which Turbopack can't place in an ESM chunk. Kept on
// `--webpack` for 1.7b (lead's call); a second look at Turbopack is a follow-up task, not this one.
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
const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  // `next dev` would otherwise write an AGENTS.md here; agent rules live in the repo's CLAUDE.md.
  agentRules: false,
  // Self-contained server bundle for the Docker image (apps/web/Dockerfile, task 0.2).
  output: 'standalone',
  serverExternalPackages: ['@edmate/content'],
  outputFileTracingIncludes: {
    '/**': ['../../packages/content/dist/**'],
  },
};

export default nextConfig;
