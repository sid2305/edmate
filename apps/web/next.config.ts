import type { NextConfig } from 'next';

// `next build` runs with `--webpack` (package.json), not Turbopack (1.7 fix round 1): Turbopack's
// build-time page-data collection, reached once the age gate (task 1.7) imports the locale
// loader, misidentifies @edmate/content's `node:worker_threads` worker (safeRegexGuard.ts, task
// 3.10) as a browser "web worker" asset and tries to bundle it with this workspace's own Vite
// (via apps/web/vitest.config.ts), which then fails on lightningcss's native addon. Confirmed with
// `next build --webpack`: a clean build, so this is a Turbopack-only bug, not this app's code.
const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  // `next dev` would otherwise write an AGENTS.md here; agent rules live in the repo's CLAUDE.md.
  agentRules: false,
  // Self-contained server bundle for the Docker image (apps/web/Dockerfile, task 0.2).
  output: 'standalone',
};

export default nextConfig;
