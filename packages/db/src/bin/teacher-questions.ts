#!/usr/bin/env node
// Entry point for `pnpm --filter @edmate/db db:questions -- list --teacher <id>` and
// `db:questions -- answer --teacher <id> --question <id> --module <id> --answer-file <path>
// [--note-question <text>]` (run after `build`). See runTeacherQuestionsCli in cli.ts.
import { runTeacherQuestionsCli } from '../cli.js';

process.exitCode = await runTeacherQuestionsCli(process.argv.slice(2), process.env, (line) =>
  console.log(line),
);
