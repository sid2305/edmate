# 9.2e: 9.2a/9.2b review follow-ups

## Acceptance (verbatim)
> each item done or logged as wontfix; db typecheck, lint and test green.

How shown: a handoff table of the 8 review items (6 do-now, 2 wontfix, each with a one-line
reason) plus green `turbo run typecheck lint test` for **both** `@edmate/db` and `@edmate/web`
(this task touches both packages, so the acceptance line's "db ... green" is read as a floor, not
a ceiling — web must stay green too since Phase B edits it) and a clean secret scan.

## Scope: do now vs wontfix

1. **[do now, Phase A]** Discovery index test can't fail (`enable_seqscan = off` wraps every
   `EXPLAIN`, including the "real statement never Seq Scans" case). Split the test helper: keep
   the seqscan-off variant only for the "GIN indexes exist and are usable standalone" case; add a
   default-settings variant for the "real join-driven statement" case, asserting the actual access
   path it naturally picks (the join's own btree index, per the existing code comment) and no
   `Seq Scan` on `teacher_profiles` — this time because the planner really chose it, not because
   the alternative was switched off.
2. **[do now, Phase A]** `cli.ts`'s `.values(seed[table] as never)` hides schema/seed mismatches
   from `tsc`. Replace the generic loop over `DISCOVERY_SEED_TABLES` with one explicit branch per
   table (`users`, `teacherProfiles`, `agents`, `agentVersions`, `packages`, `packageVersions` —
   `discovery-seed.ts`'s own list), each typed directly from `discoverySchema.<table>` and
   `seed.<table>`, no cast.
3. **[wontfix]** Batched pattern for the generated-column migration (`0020_teacher_profile_search.sql`)
   on large tables. Reason: exactly the migration-on-a-large-table case the brief calls out as a
   wontfix candidate — there is no real teacher data yet (dev/seed only); revisit when
   `teacher_profiles` is large enough for an `ACCESS EXCLUSIVE` rewrite to matter.
4. **[wontfix]** One lateral join instead of the four near-identical correlated subqueries in
   `discovery.ts`. Reason: the int test's own measured p50/p95/max (2.7/4.4/7.3 ms on the
   200-teacher seed) is nowhere near the 1 s acceptance bound; this is a refactor of a risky,
   already-reviewed file for a scale problem that doesn't exist yet — revisit if teacher count or
   measured latency grows.
5. **[do now, Phase A]** Comment at `teacherBySlug` that the full, untruncated bio is intentional
   (the truncation the module doc already documents applies only to the search card).
6. **[do now, Phase B]** `rateLimit.ts`'s `INCR` then `PEXPIRE` isn't atomic (a process crash or a
   slow tick between the two calls can leave a key with no TTL). Make it one `EVAL` via
   `redis.defineCommand`, mirroring `packages/queue/src/turnLimits.ts`'s pattern (a Lua script,
   `now`/key passed in, no `redis.call('TIME')`) — here the script is just `INCR` + conditional
   `PEXPIRE` on the first hit, not a sliding-window ZSET (the fixed-window algorithm is unchanged).
   Also add `connectTimeout`/`commandTimeout` to the `new Redis(url, …)` options so `allow()` can't
   hang ~10 s before failing open.
7. **[do now, Phase B]** `searchParams.ts`'s `LANGUAGE_RE` is a hand-copied duplicate of
   `teacher-profiles.ts`'s `LanguageTag` regex (drift risk), and a `scope` error from
   `discovery.search` currently propagates and crashes `/teachers` instead of the 9.2a scope
   decision's "never distinguishable from not found." Fix: re-export `LanguageTag` from
   `packages/db/src/repositories/index.ts` (barrel only — **not** editing `teacher-profiles.ts`,
   which another builder owns right now) so `searchParams.ts` imports and uses it directly instead
   of a copy; and wrap `repos.discovery.search(...)` in `page.tsx` in a narrow catch for
   `RepositoryError` with `kind === 'scope'`, returning `{ teachers: [], hasMore: false }` (any
   other error still propagates — this isn't a blanket try/catch).
8. **[do now, Phase B]** `nav.ts`'s `ROLE_HOME` has no `staff` entry, so a signed-in staff
   principal gets the "Home" label linking to `/sign-in`. Add `staff: '/staff'` as a literal path
   (no new export from `src/auth/**`, same read-only-import convention 9.2b already used).

## Files

### Phase A — `packages/db` (4 files, 1 package)
- `packages/db/src/repositories/discovery.ts` — modify (item 5, comment only).
- `packages/db/src/repositories/index.ts` — modify (item 7's `LanguageTag` re-export; barrel only).
- `packages/db/src/cli.ts` — modify (item 2).
- `packages/db/test/discovery.int.test.ts` — modify (item 1: split `explain()` into two helpers;
  update/add the "real statement" and "GIN indexes usable" tests).

### Phase B — `apps/web` (depends on Phase A merging: needs the `LanguageTag` export)
- `apps/web/src/discovery/rateLimit.ts` — modify (item 6).
- `apps/web/src/discovery/rateLimit.test.ts` — modify (item 6: atomic-take and timeout-option
  assertions).
- `apps/web/src/discovery/searchParams.ts` — modify (item 7: import `LanguageTag` from
  `@edmate/db`, drop `LANGUAGE_RE`).
- `apps/web/src/discovery/searchParams.test.ts` — modify (item 7: keep green against the shared
  schema; no new case needed since behaviour is unchanged, but assert the import is used, not a
  local copy, if that's cheaply testable — otherwise rely on typecheck).
- `apps/web/app/teachers/page.tsx` — modify (item 7: catch `scope` → empty result).
- `apps/web/app/teachers/page.test.tsx` — modify (item 7: a case where `repos.discovery.search`
  rejects with `RepositoryError('scope', ...)` and the page still renders the empty state).
- `apps/web/src/discovery/nav.ts` — modify (item 8).
- `apps/web/src/discovery/nav.test.ts` — **new** (item 8: no test file exists for `nav.ts` today;
  cover anonymous → sign-in, student/teacher → their home, staff → `/staff`, each with/without a
  sign-out action).

8 files touched in Phase B, 4 in Phase A — two packages overall, hence two phases per the sizing
rule (>8 files or 2+ packages combined).

## Files out of bounds
- `packages/db/src/repositories/redact-json.ts`, `packages/db/src/repositories/teacher-profiles.ts`
  — other builders are editing these now; nothing in this plan touches either (item 7's export is
  added to `index.ts`, which only re-exports a symbol `teacher-profiles.ts` already exports).
- `apps/web/src/auth/**` — read-only, same convention 9.2b already set; item 8 uses a literal path,
  not a new auth export.
- No change to `packages/queue/**` (item 6 mirrors its Lua-script *pattern*, does not import it —
  avoids a new cross-package dependency from `apps/web` into `@edmate/queue`).

## Tests first
- Item 1: write the failing default-settings `EXPLAIN` test first (today it would pass trivially
  under the old helper — confirm it's exercising the new, unforced helper), then the split.
- Item 2: no behavioural change; the existing `discovery.int.test.ts` seed-insert path (via
  `runSeedDiscoveryCli`) is the regression test — confirm it still passes after the retype, don't
  add a new test.
- Item 6: new `rateLimit.test.ts` cases — a store that simulates two near-simultaneous `increment`
  calls (or a mock Redis multi/eval) still TTLs the key exactly once; `new Redis` is called with
  `connectTimeout`/`commandTimeout` set (mock the `Redis` constructor, assert the options object).
- Item 7: `page.test.tsx` — a mocked `repos.discovery.search` rejecting with
  `RepositoryError('scope', 'discovery.search')` renders the existing empty state, not a thrown
  error; a non-scope rejection still propagates (keep/add a case for that so the catch stays
  narrow).
- Item 8: new `nav.test.ts` — four principal shapes (`null`, student, teacher, staff) each asserted
  against `ROLE_HOME`'s actual destination.

## Risky paths touched (checked against `.claude/skills/merge-gate/risk-paths.txt`)
- `packages/db/src/repositories/discovery.ts` — matches `packages/db/src/repositories/**` →
  reviewers: **security-reviewer** (required by risk-paths.txt; following 9.2a's precedent,
  request database-reviewer, code-reviewer and typescript-reviewer too since this group's file
  also carries SQL and types).
- `packages/db/src/repositories/index.ts` — same group, same reviewers.
- All other files (`cli.ts`, both test files, everything under `apps/web/src/discovery/**` and
  `apps/web/app/teachers/**`) — no match in risk-paths.txt. None (checked against risk-paths.txt).
- Phase A plans a `risk: high` decision entry in its handoff (the group it touches requires one
  even for a comment-sized change, per the non-negotiables); Phase B is not risky on its own.

## Open questions / heads-up (non-blocking)
- `packages/db/src/repositories/index.ts` is a shared barrel; if the builder currently on
  `teacher-profiles.ts`/`redact-json.ts` also needs an `index.ts` export soon, the lead should
  sequence the two merges to avoid a diff conflict on the same file (not a reason to block this
  plan).
- Re-exporting `LanguageTag` is a small, read-only widening of `@edmate/db`'s public surface (not
  `packages/contracts`, so no ADR); flagging it for the lead's sign-off rather than treating it as
  automatically fine.

## Budget
Budget: 80 tool calls (2 phases, packages/db + apps/web)

## Allowed tools
Read, Grep, Glob, Edit, Write, Bash (tests, typecheck, lint and secret scan only — no new
dependencies, no schema/migration changes, no compose stack).

## Exit conditions
- Phase A: `Status: DONE` once items 1, 2 and 5 are committed, `turbo run typecheck lint test
  --filter=@edmate/db...` is green, and items 3/4 are logged as wontfix with their reasons above;
  otherwise `Status: PARTIAL` past ~40 tool calls or if a file outside this plan needs changes.
- Phase B: `Status: DONE` once items 6, 7 and 8 are committed, `turbo run typecheck lint test
  --filter=@edmate/web...` is green (built against Phase A's merged `@edmate/db` export), and the
  secret scan is clean; otherwise `Status: PARTIAL` past ~40 tool calls or if Phase A's export
  shape needs to change.

## Decision (for the lead's log)
- risk: high — Phase A touches `packages/db/src/repositories/**` (discovery.ts comment + index.ts
  barrel export); reviewed by security-reviewer (required) plus database-reviewer, code-reviewer,
  typescript-reviewer per 9.2a's precedent for this file group.

## Lead amendment (26 Oct 2026)
- **Phase order swapped.** 9.3m edits `packages/db/src/repositories/index.ts` and has not merged yet,
  so the build runs in this order:
  - **Phase 1 (now, apps/web only):** item 6 (rateLimit), item 8 (nav, plus the new nav.test.ts) and
    the `page.tsx` half of item 7 (catch only a `scope` RepositoryError and return an empty result,
    plus its page test). Don't touch `searchParams.ts` or anything under `packages/db` in this phase.
    Budget: 35 tool calls; stop with `Status: PARTIAL` past 50.
  - **Phase 2 (after 9.3m merges; a fresh builder merges main into the branch first):** items 1, 2
    and 5, the `LanguageTag` re-export in `repositories/index.ts`, and the `searchParams.ts` half of
    item 7 (import `LanguageTag` from `@edmate/db` and drop `LANGUAGE_RE`). Budget: 40 tool calls.
- **LanguageTag re-export: approved by the lead.** It is a read-only widening of `@edmate/db`, not
  `packages/contracts`, so no ADR is needed. Log it as a decision in Phase 2's handoff.
- Both phases write to the same `docs/tasks/9.2e/handoff.md`. Phase 2 appends to it.
