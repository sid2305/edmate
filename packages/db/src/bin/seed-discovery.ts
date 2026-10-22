#!/usr/bin/env node
// Entry point for `pnpm --filter @edmate/db db:seed-discovery -- --fake-teachers <n>` (run after
// `build`; dev/test only). See runSeedDiscoveryCli in cli.ts.
import { runSeedDiscoveryCli } from '../cli.js';

process.exitCode = await runSeedDiscoveryCli(process.argv.slice(2), process.env, (line) =>
  console.log(line),
);
