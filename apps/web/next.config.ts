import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  // `next dev` would otherwise write an AGENTS.md here; agent rules live in the repo's CLAUDE.md.
  agentRules: false,
};

export default nextConfig;
