# Plan: 8.7i — 8.7a review follow-ups (LOW)

## Acceptance (verbatim)
"each item fixed or recorded, with tests where behaviour changes."

How shown: handoff.md lists each of the 5 LOW items from `docs/tasks/8.7a/review.md` as
do-now (with the diff) or wontfix (with a one-line reason); `packages/db` typecheck/lint/test
stay green; no new migration.

## The 5 items and their disposal
1. **recordResults never bumps `eval_runs.updated_at`, so "stale" means "since markRunning", not
   "since the last result" — reword, don't change behaviour.** DO NOW. Bumping `updated_at` on
   every `recordResults` batch adds a write to a hot, lock-held path for no pilot-scale benefit
   (runs finish in minutes). Reword the two comments that say "no progress" (publish.ts line ~67,
   README.md's `startRun` bullet) and the test name at publish.int.test.ts:416 to say "since
   markRunning" — accurate today, since only `startRun`/`markRunning` ever update that column
   while a run is open.
2. **`latestRun` takes no `agentId`.** WONTFIX. PRD §Roadmap: MVP is "one course and one agent
   per teacher" (docs/edmate-prd.md:322), so a teacher-scoped `latestRun` already returns the
   only agent's run; an `agentId` param is dead code until multi-agent ships post-MVP.
3. **`RunShape` doesn't validate `createdAt`; `toRun` casts `row.createdAt as Date`.** DO NOW.
   Add `createdAt: z.date()` to `RunShape` and read the parsed value instead of casting, matching
   every other field's `stored()` validation. The column is `NOT NULL`, so this can't change
   behaviour on real rows; mark the now-impossible non-Date branch `/* v8 ignore next */` like the
   file's other unreachable branches. No new test (nothing reachable to assert).
4. **No `(teacher_id, created_at)` index; `latestRun`/`getRun` use only the `teacher_id` index.**
   WONTFIX at pilot scale (about 20 teachers, one agent each, a handful of gate runs apiece); the
   review itself says "when runs grow". If it's ever needed: the next free migration number is
   0037 (0035 is 9.6f's, 0036 is 12.1c's, both still open), and it must merge after both.
5. **Migration 0021's FK/partial index were added without `NOT VALID`/`CONCURRENTLY`; harmless on
   an empty column, but later migrations on a populated `eval_runs` must use both.** RECORD only
   — nothing to fix in 0021. Add one sentence to `packages/db/src/repositories/README.md`'s
   publish section so whoever writes 0037+ against `eval_runs` sees the rule.

## Files to modify (3, all in packages/db)
- `packages/db/src/repositories/publish.ts` — reword the `STALE_RUN_GRACE_MS` comment; add
  `createdAt: z.date()` to `RunShape` and drop the cast in `toRun`.
- `packages/db/test/publish.int.test.ts` — rename the `it(...)` string at line ~416 only; no
  assertion changes.
- `packages/db/src/repositories/README.md` — reword the `startRun` stale-run bullet; add one
  sentence recording item 5's NOT VALID/CONCURRENTLY rule for future `eval_runs` migrations.

## Files out of bounds
- `packages/db/migrations/**` — no new migration (item 4 is wontfix).
- `packages/db/src/repositories/{messages,sessions,subscriptions,teacher-profiles,migrate}.ts`
  and `packages/db/test/retrieval-leak.int.test.ts` — other builders own these; if any turn out
  to need a touch, stop and flag the overlap instead of editing.
- `packages/contracts/**` — no contract shape changes.

## Tests first
Run `packages/db`'s existing suite (incl. `publish.int.test.ts`) green before touching anything,
to get a clean baseline; then make the 3 edits above and re-run the same suite — it must still be
green with no new cases needed (items 1 and 3 are reword/defensive-validation only, not behaviour
changes on reachable inputs).

## Risk paths touched (.claude/skills/merge-gate/risk-paths.txt)
- `packages/db/src/repositories/**` matches `publish.ts` and `README.md` — reviewers:
  security-reviewer.
- No other glob matched (the test file is under `packages/db/test/`, not `src/repositories/`).
- This PR logs a `risk: high` decision at merge (non-negotiable 6), naming security-reviewer.

## Open questions
None — every item above is a judgement call the review already flagged as LOW and deferred to
this task; disposals follow the MVP-first / lean-to-wontfix-at-scale instruction.

## Budget
Budget: 40 tool calls (1 phase, packages/db)

## Allowed tools
Read, Grep, Glob, Edit, Bash (pnpm typecheck/lint/test --filter=@edmate/db, and
`.githooks/secret-scan.py --all`, only)

## Exit conditions
Status: DONE once the 3 files are edited, `packages/db` typecheck/lint/test are green, the secret
scan is clean, and handoff.md records all 5 dispositions (2 do-now with diffs, 3 wontfix with
one-line reasons) plus the risk: high decision line. Status: PARTIAL past ~40 tool calls, or if a
fix turns out to need a file outside this plan (especially the other builders' files above).
