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
const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  // `next dev` would otherwise write an AGENTS.md here; agent rules live in the repo's CLAUDE.md.
  agentRules: false,
  // Self-contained server bundle for the Docker image (apps/web/Dockerfile, task 0.2).
  output: 'standalone',
};

export default nextConfig;
