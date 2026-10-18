#!/usr/bin/env node
// Entry point for `pnpm --filter @edmate/db db:grant-role -- --email <e> --role <r> --by <id>`
// (run after `build`). See runGrantRoleCli in cli.ts.
import { runGrantRoleCli } from '../cli.js';

process.exitCode = await runGrantRoleCli(process.argv.slice(2), process.env, (line) =>
  console.log(line),
);
