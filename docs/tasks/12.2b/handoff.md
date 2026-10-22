# 12.2b handoff: takedowns repository and the retrieval filter (12.2 Phase B, packages/db)

Status: DONE

- Branch: `m12/12.2b-takedowns-repo` (built locally as `work-122b`)
- Worktree: `.claude/worktrees/agent-a7a60c395d19bffdb` (under the repo root)

## Summary
Staff take down one teacher document or a whole agent, and lift it again. A document takedown is
a filter, not a delete: the chunk is gone from the very next retrieval read and comes back on
lift. No migration, no schema change, no contracts change; `subscriptions.ts`, `publish.ts` and
`apps/` untouched.

- `notTakenDown(column)` (`takedowns.ts`) is the only place the predicate is written. It is in
  `rank()`'s single scope fragment in `retrieval.ts` (full text, vector and term stats, so `search`
  and `probe`), in `retrieval.material` (leakCheck's locked index) and in `chunks.listForModule`
  (outline drafter). `reports.ts`'s `takenDown` flag now uses it too (12.2a's left-to-do). It
  qualifies every column by hand, so the outer column can never bind to a takedowns column.
- `takedowns.create(by, { kind, targetId, category, reportId?, note? })`: staff only (`lockRole`,
  else `scope`); target locked `FOR UPDATE` (missing `not_found`); an active takedown already on the
  target is `invalid`; the row is written `active` with its first staff action; agent →
  `suspended`; document → `bumpRevision` (now exported from `chunks.ts`); `reportId` must be an
  open report about the same teacher (else `invalid`, nothing written), set `actioned` with a staff
  action and a `report.review` audit row; audit `takedown.create`.
- `takedowns.lift(by, takedownId, { note? })`: staff only; reads the target, locks it, then the
  takedown `FOR UPDATE` and re-checks `active` (else `not_found`); sets `lifted`; agent → `live`
  when `live_version` is set, else `draft`; document → `bumpRevision`; audit `takedown.lift`. A
  stored target that is malformed or gone is `integrity`.
- `takedowns.listActiveForStaff(by)`: active, newest first by `(created_at, id)`, capped at 200,
  with kind, target id, teacher id, teacher slug, category, createdAt.
- Lock order (file header): staff role row `FOR SHARE`, target row `FOR UPDATE`, takedown row,
  then the report. publish takes advisory, profile, agent, run; the agent is the only row both
  lock, and neither holds anything the other wants while waiting on it.

## Files
- `packages/db/src/repositories/takedowns.ts` (new)
- `packages/db/src/repositories/retrieval.ts` (`notTakenDown` in `rank()`'s scope and `material()`)
- `packages/db/src/repositories/chunks.ts` (export `bumpRevision`; `notTakenDown` in `listForModule`)
- `packages/db/src/repositories/reports.ts` (inline takedown subquery replaced by `notTakenDown`)
- `packages/db/src/repositories/map.ts` (append: `TAKEDOWN_KINDS`, `StaffTakedownRow` schema)
- `packages/db/src/repositories/index.ts` (shared, append: import, `takedowns` entry, export block)
- `packages/db/src/repositories/README.md` ("Takedowns (task 12.2b)" section)
- `packages/db/test/takedowns.test.ts`, `packages/db/test/takedowns.int.test.ts` (new)
- `packages/db/test/repositories.int.test.ts` (shared, append: 3 `CASES` entries)
- `packages/db/test/scope.test.ts` (shared, append: grid exclusion for the `by`-first methods)

## Tests
Written first and run red (both files failed: `notTakenDown` / `repos.takedowns` missing), then
green. Int tests on a disposable `pgvector/pgvector:0.8.1-pg16` container (`edmate122b-pg-test`,
port 55822, removed afterwards).

- `TEST_DATABASE_URL=… corepack pnpm vitest run test/takedowns.test.ts test/takedowns.int.test.ts`
  → `Tests  58 passed (58)`; `takedowns.ts` 100% lines, branches, functions.
- Acceptance ("a takedown removes material from retrieval at once"): on one
  `retrievalIndexFor(repos)` instance, search returns document A's chunk; staff take A down; the
  next `search` and `probe` return nothing from A while another document still shows; full-text
  only search and term stats skip it; `listForModule` skips it; `retrieval.material` drops a
  locked-module document and `leakCheck` on its sentence goes from `hit: true` to `hit: false`
  (revision bumped, cache rebuilt); after `lift` all of it is back. A takedown survives the teacher
  replacing the same document id (`startReplace` + new chunks).
- Agent takedown: `agents.owner` is null while suspended, `publish.startRun` is refused
  `suspended`, lift restores `live` (or `draft` for a never-live agent). Students' entitlement,
  discovery and `subscriptions.start` all read through `status = 'live'` already (unchanged code),
  so they are covered by the owner check plus their own suites; not re-tested here.
- Two-connection lock test: a raw connection holds the agent row, then `publish.goLive` and
  `takedowns.create` queue on it in both orders, three rounds each. No deadlock; goLive first →
  both succeed and the agent ends `suspended`; takedown first → goLive refused `suspended`.
- EXPLAIN: with 5000 active takedowns (rolled back) and `analyze`, the plan for the predicate
  probes `takedowns_target_idx` (asserted). With a near-empty table the planner picks
  `takedowns_status_idx` instead, which is also an index probe.
- Full gate: `corepack pnpm turbo run typecheck lint test --filter=@edmate/db...` with
  `TEST_DATABASE_URL` → `Tasks: 26 successful, 26 total`; `@edmate/db` `Tests 1348 passed | 4 skipped (1352)`.
- `python3 .githooks/secret-scan.py --all` → clean.

## Decisions

### 22 Oct 2026 · 12.2b Staff takedowns of documents and agents, and the retrieval filter (risky path, security-reviewer, database-reviewer) · decided by builder · risk: high
- Decided: in `packages/db/src/repositories/takedowns.ts` only a user who is staff right now can take down a document or an agent, lift a takedown or list them; create and lift are audited (`takedown.create`, `takedown.lift`, plus `report.review` when a report is linked). A document takedown is one `notTakenDown` predicate added to retrieval's single scope fragment (text, vector and term stats), to `retrieval.material` (leakCheck) and to `chunks.listForModule`, with a material revision bump so leakCheck rebuilds. An agent takedown sets `suspended`. Every write locks the staff role row, then the target, then the takedown, then the report; publish never locks a role row, takedown or report, so the agent is the only shared row and a two-connection test shows no deadlock with `publish.goLive`. Reviewers required: security-reviewer and database-reviewer.
- Why: the plan's Phase B design and lead answers (Q4 filter not delete, Q5 leakCheck too); the 8.7a lesson on lock order.
- risk: high

### 22 Oct 2026 · 12.2b A linked report gets its own report.review audit row · decided by builder · risk: low
- Decided: when a takedown links an open report, the report is set `actioned`, gets a staff action naming the takedown id, and a `report.review` audit row is written next to `takedown.create`.
- Why: the plan only named the `takedown.create` audit; a report closed without its own audit row would look different from one closed by `reports.review`.
- risk: low

### 22 Oct 2026 · 12.2b Lift restores live or draft whatever the agent status was · decided by builder · risk: low
- Decided: lifting an agent takedown sets `live` when `live_version` is set, else `draft`, as the plan says; there is no other path that suspends an agent today, so no earlier status is stored. The `takedown.create` audit row records the status before the takedown.
- Why: the plan's rule; storing the previous status would need a schema change.
- risk: low

### 22 Oct 2026 · 12.2b two review LOWs left as is · decided by lead · risk: low
- Decided: the whitespace-only reformat in packages/db/test/repositories.int.test.ts and the import-order nit in packages/db/src/repositories/index.ts stay (security-reviewer LOWs, wontfix).
- Why: both are cosmetic; the branch merges cleanly with main and no running build edits those lines. Reverting would cost a build round for no behaviour change.
- risk: low

## Left to do
- Nothing for 12.2b. 12.2d builds the staff API on `takedowns.create`, `lift` and
  `listActiveForStaff` (errors: `scope`, `invalid`, `not_found`, `integrity`).

Tool calls used: 71 (harness count; the builder reported 46)
