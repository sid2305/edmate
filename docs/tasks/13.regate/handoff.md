# Handoff: 13.regate, Phase A

Status: DONE (Phase A)

## Summary

Added the regate sweep's candidate list, a system (unscoped) read like
`usageLedger.teacherIdsWithUsageSince` / `subscriptions.activeCountByPackage`:

- `packages/db/src/repositories/publish.ts`: `REGATE_SWEEP_MAX = 200` and a new standalone
  `regateRepo(db)` factory exporting `liveAgentsWithMaterialChange(limit?)`. It returns
  `{teacherId, agentId}` for every live agent whose teacher's current material revision differs
  from the newest passed/published run's `basis.materialRevision`, excluding one with an open
  (`queued`/`running`) run and one that already has a run of *any* outcome started at the current
  revision (lead answer Q2: one automatic attempt per material revision), oldest-changed-first,
  capped at `limit`.
- `packages/db/src/repositories/index.ts`: re-exports `regateRepo`, `REGATE_SWEEP_MAX`,
  `RegateRepo`.
- `packages/db/src/index.ts`: a comment next to `openDatabase` explaining `regate` is
  deliberately *not* wired into its return (see Decisions below).
- `packages/db/test/publish.int.test.ts`: a new `describe('liveAgentsWithMaterialChange', ...)`
  with 7 cases (empty, changed-vs-unchanged, open-run exclusion, draft/suspended exclusion,
  cross-teacher unscoped read, one-attempt-per-revision, cap+ordering).

Red-then-green: wrote the 7 int-test cases and the `regateRepo` export first; `pnpm vitest run
test/publish.int.test.ts` failed (method didn't exist, then logic bugs below) before the final
green run (`51 passed`).

## Decisions

### 26 Oct 2026 · 13.regate standalone regate repo, not a `publishRepo` method · decided by builder · risk: high

- Decided: `liveAgentsWithMaterialChange` is exported as a standalone `regateRepo(db)` factory
  (same shape as `repositories/retention.ts`'s `retentionRepo`), not a method on the object
  `publishRepo` returns, and `openDatabase`'s return type is **not** extended with a `regate`
  field in this phase.
- Why: the plan asked for "one method on the existing publish repo" (`repos.publish.…`). Adding
  it there makes it part of `Repositories`/`RepositoryMethod`, which forces two edits to files
  explicitly off-limits this phase (owned by the concurrent 9.2g builder): `scope.test.ts`'s
  bad-scope grid would need a no-argument exemption (like `subscriptions.activeCountByPackage`),
  and — the one that actually can't be worked around — `test/repositories.int.test.ts`'s
  `CASES: Record<RepositoryMethod, IsolationCase>` fails `tsc` without a new entry for the
  method, and that file is explicitly off-limits (shared with 9.2g). `retention.ts` hit the same
  tension in task 13.4 and resolved it the same way: a cross-account scheduled-job read, kept out
  of `createRepositories` entirely, exported standalone, wired into `openDatabase` only. I
  followed that precedent for the method itself, but stopped short of the `openDatabase` wiring
  because that return object's *shape* is also pinned by an exhaustive-keys assertion in the same
  off-limits `repositories.int.test.ts` (`expect(Object.keys(opened).sort()).toEqual([...])`) —
  adding a `regate` key breaks that assertion too. Phase B (apps/worker) needs the live `db`
  handle either way to call `enqueueGate`'s queue, so it is better placed to decide how it
  constructs `regateRepo(db)` (directly, or by extending `openDatabase` once 9.2g's edits to that
  file have landed and the key list can be updated in the same PR). Logged `risk: high` per the
  plan's own risk-paths note for this unscoped cross-teacher read (same reviewer set as 13.5:
  **security-reviewer** required, **code-reviewer** plus, **database-reviewer**/
  **typescript-reviewer** recommended).

## Gate

- `TEST_DATABASE_URL=postgres://edmate:edmate-dev@127.0.0.1:55432/edmate corepack pnpm turbo run typecheck lint test --filter=@edmate/db`
  → green (`8 successful, 8 total`). `publish.ts` coverage: 100% stmts/funcs/lines, 98.83% branch.
  Db int suite: **397 tests passed**, 0 skipped, in the 3 files touched by this change
  (`publish.int.test.ts`, `repositories.int.test.ts`, `scope.test.ts`); the full package run
  (`@edmate/db:test`) passed with `1784+ passed` and only the pre-existing unrelated skips.
- `corepack pnpm exec prettier --check` on the 4 changed files → clean (after one `--write`
  pass on `src/index.ts` and `test/publish.int.test.ts`).
- `python3 .githooks/secret-scan.py --all` → clean (no output).

## Budget

Phase A tool calls used: 55

## State after this phase

The regate sweep's candidate list can be read (`regateRepo(db).liveAgentsWithMaterialChange()`);
nothing calls it yet. Phase B (apps/worker) needs: wiring a `db`/`regateRepo` instance for the
sweep job (directly, or via an `openDatabase` extension coordinated with 9.2g's
`repositories.int.test.ts` changes), `pins.ts`, `sweep.ts`, `schedule.ts`, and the
`apps/worker/src/index.ts` wiring the plan describes.
