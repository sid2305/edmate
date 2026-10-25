#!/usr/bin/env node
// Entry point for `pnpm --filter @edmate/db db:health-report -- --teacher <id> --since <iso>
// [--limit <n>]` (run after `build`). See runHealthReportCli in cli.ts.
import { runHealthReportCli } from '../cli.js';

process.exitCode = await runHealthReportCli(process.argv.slice(2), process.env, (line) =>
  console.log(line),
);
