#!/usr/bin/env node
// Entry point for `pnpm --filter @edmate/db db:migrate` (run after `build`).
import { runMigrateCli } from '../cli.js';

process.exitCode = await runMigrateCli(process.env, (line) => console.log(line));
