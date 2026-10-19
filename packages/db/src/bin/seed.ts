#!/usr/bin/env node
// Entry point for `corepack pnpm seed` / `pnpm --filter @edmate/db db:seed` (run after `build`).
import { runSeedCli } from '../cli.js';

process.exitCode = await runSeedCli(process.env, (line) => console.log(line));
