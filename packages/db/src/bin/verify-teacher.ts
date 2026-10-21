#!/usr/bin/env node
// Entry point for `pnpm --filter @edmate/db db:verify-teacher -- --email <e> --status
// <verified|rejected> --by <staff-user-id>` (run after `build`). See runVerifyTeacherCli in cli.ts.
import { runVerifyTeacherCli } from '../cli.js';

process.exitCode = await runVerifyTeacherCli(process.argv.slice(2), process.env, (line) =>
  console.log(line),
);
