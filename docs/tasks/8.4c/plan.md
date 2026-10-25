# Plan: 8.4c — 8.4a/8.4b follow-ups (LOWs deferred to M13)

## Acceptance (verbatim)
"studio drafting writes usage-ledger rows under a teacher scope; a test shows override phrases are
removed from a saved card's prompt text."

How shown: Phase A/B's evidence is a db test proving one row per studio draft attempt, scoped by
teacher id only (no student/package), plus the web test showing a style-card or outline draft call
writes that row. Phase C's evidence is a unit test on the new sanitize function and a routes test
showing a saved card's stored `text` no longer contains an override/role-play phrase that was in
the input, plus a `StyleCardView` test showing a draft response that resolves after a save is
discarded.

## Context read
- `docs/tasks/8.4a/review.md`, `docs/tasks/8.4a/handoff.md` (the three LOWs and the "drafting is
  not metered yet" decision: no teacher-side studio scope exists today; same gap in ingest's
  outline drafting).
- `docs/tasks/8.4b/review.md` (the stale-draft LOW).
- `docs/lessons.md` "UI state and server replies: trust neither, reset everything" — the same class
  of bug (an in-flight async response overwriting newer state) as 8.4b's two fixed HIGHs; this task
  is the deferred third instance.
- `packages/gateway/src/metering/meteredGateway.ts` and `types.ts`: the existing metering machinery
  (`createMeter`, `meterAdapter`, `MeterContext`, `MeterSink`) requires `teacherId`, `packageId`,
  `studentId` and `turnId` — all NOT NULL — because it writes into the existing `usage_ledger`
  table (`packages/db/src/schema/learning.ts`, FK'd to `packages`). Studio calls have none of
  those. The port comment in `meterAdapter` is explicit: `generateObject` never reports usage today
  ("until the port carries usage for them, a contracts change, ADR") — every attempt through it is
  metered as `unknown`/`no_usage_reported` with zero cost figures, by design, for every existing
  caller of `generateObject` too.

## Scope decision: no ADR, no contracts change
Item (1) does not touch `packages/contracts`: `Usage`/`UsageSchema` are reused unchanged. The gap
is that the *existing* `usage_ledger` table and `MeterContext` type assume a student x package x
turn — fields studio drafting has none of. The smallest closing change is a new, teacher-scoped
table and a parallel, much smaller metering path (every studio attempt recorded as `unknown`,
`no_usage_reported`, since `generateObject` cannot report usage yet — recording a cost estimate
would be fabricated). This is a builder-level schema/engineering decision, not a product decision:
it only changes how a cost that cannot yet be measured is logged, not what is measured. Flagged
under Questions for the lead to confirm, not blocking.

## Phase A — packages/db: a teacher-scoped studio usage ledger
Package: `packages/db` only.

Files to create:
- `packages/db/migrations/00NN_studio_usage_ledger.sql` — new table `studio_usage_ledger` (id,
  teacher_id not null, kind enum `'style_card_draft' | 'outline_draft'`, tier, model, status
  (reuse the existing `usage_status` enum: here always `'unknown'`), reason, created_at), indexed
  on `(teacher_id, created_at)`. No FK to `packages` or `students` — a studio call belongs to the
  teacher alone.
- `packages/db/src/schema/learning.ts` (or a new `schema/studio.ts`, builder's call) — the Drizzle
  table definition next to `usageLedger`, reusing its enums where they fit.
- `packages/db/src/repositories/studio-usage.ts` — `studioUsageRepo(db)` with one write,
  `recordAttempt(scope: TeacherScope, { kind, tier, model }): Promise<void>`, always inserting a
  `status: 'unknown', reason: 'no_usage_reported'` row scoped by `scope.teacherId`; and one read,
  `sumForTeacher(scope): Promise<{ calls: number }>` (count only — no cost figure exists to sum),
  mirroring `usage-ledger.ts`'s scope/parse conventions (`parseArg`, `teacherScope`, `checked`).
- `packages/db/src/repositories/index.ts` — export the repo and its input/row types.
- `packages/db/test/studio-usage.test.ts` (unit) and `.int.test.ts` (Postgres: one teacher's rows
  never appear under another's scope; `recordAttempt` never requires a package or student row).

Files out of bounds: `packages/db/src/repositories/packages*.ts`, `package-write.ts` (8.6f, running
now), the existing `usage-ledger.ts` and its schema table (untouched; this is a new, separate
table, not an edit to the student-billing one).

Risky paths touched: `packages/db/src/repositories/**` (new file `studio-usage.ts`, `index.ts`
edit) — reviewers: security-reviewer (required by risk-paths.txt's access-filter group). Recommend
database-reviewer too, by team precedent for every schema/migration change (8.4a, 8.5a, 8.6b), though
not named by risk-paths.txt itself.

Budget: Phase A ≤ 35 tool calls (1 package).

## Phase B — apps/web: meter the two drafting call sites
Package: `apps/web` only. Depends on Phase A's repo/types.

Files to create/modify:
- `apps/web/src/studio/studioMetering.ts` (new) — `meterStudioDrafts(gateway, ctx, studioUsage,
  log)` wraps only `generateObject` in a `try/finally`: the call's result/throw passes through
  unchanged, and `finally` fires `studioUsage.recordAttempt(...)` without awaiting it inline (log,
  don't throw, on a sink failure) — same "metering never changes what the caller sees" rule as
  `meteredGateway.ts`.
- `apps/web/src/studio/styleCardRuntime.ts` — wrap the built drafter with
  `meterStudioDrafts(..., kind: 'style_card_draft')` before returning it from `build()`.
- `apps/web/src/studio/runtime.ts` — wrap the outline backend's `gateway: createRouter(...)` the
  same way (`kind: 'outline_draft'`).
- `apps/web/src/studio/studioMetering.test.ts`, and updated tests for both runtime files (one row
  written per draft call, regardless of success or failure).

Files out of bounds: `apps/web/src/studio/packages.ts` (8.6f Phase B, running now); before editing
`runtime.ts`, the builder runs `git diff main -- apps/web/src/studio/runtime.ts` to check 8.6f
hasn't touched the same lines, since both tasks edit files in this directory.

Risky paths touched: none (`apps/web/src/studio/**` is not in risk-paths.txt).

Budget: Phase B ≤ 30 tool calls (1 package).

## Phase C — apps/web: strip override/role-play phrases; ignore a stale draft
Package: `apps/web` only. Independent of A/B — can build in parallel with either.

Files to create/modify:
- `apps/web/src/studio/styleCardSanitize.ts` (new) — `stripOverridePhrases(text: string): string`.
  A small, self-contained, purpose-built regex list for literal role-play phrases ("you are DAN",
  "act as [if you]...", "pretend you are/to be...", "developer/god/admin mode (enabled)", "no
  rules"/"unrestricted"/"unfiltered") and rule-override phrases ("ignore/disregard/forget/bypass
  (all/any) (previous/above) instructions/rules", "your rules don't apply", "override your
  rules") — matched case-insensitively on the raw text and replaced, then whitespace collapsed.
  Deliberately not a reuse of `packages/harness/src/guardrails/jailbreakPatterns.ts`'s `RULES`:
  those match on `normaliseForDistress`'s normalised forms (apostrophes dropped, leetspeak folded),
  with no span mapped back to the raw text to strip, and cover categories out of scope here
  (authority/package claims, encoded instructions, prompt leaks). Flagged under Questions.
- `apps/web/src/studio/styleCardRoutes.ts` — in `draft`, run `stripOverridePhrases` on each
  interview answer and sample explanation before they reach `draftStyleCard`; in `save`, run it on
  `text` before `SaveSchema` validation and `styleCards.create`, so a saved card's stored text is
  already clean and nothing later needs to re-check it before a turn prompt.
- `apps/web/app/teacher/style-card/StyleCardView.tsx` — a stale-draft guard: a `useRef` counter
  bumped on every successful `onSave`; `onDraft` reads the counter before its `await` and, after it
  resolves, only calls `setText`/`setTagsText` if the counter is unchanged (no save landed meanwhile).
- Tests: `styleCardSanitize.test.ts`; a `styleCardRoutes.test.ts` case (an override phrase in the
  draft/save input is absent from the output/stored text); a `StyleCardView.test.tsx` case (save
  resolves before a slower draft call → the draft's text is discarded, the saved text stays shown).

Files out of bounds: `packages/harness/src/pedagogy/**` (the turn-prompt composer) — not touched;
stripping happens at the two write boundaries (draft input, save input), so no composer change is
needed for the saved card's text to reach every future turn prompt clean. `packages/db` untouched.

Risky paths touched: none.

Budget: Phase C ≤ 30 tool calls (1 package).

## Out of scope for this task
- Backfilling or re-scrubbing style cards already saved under 8.4a/8.4b before this ships (teachers
  of record so far: none known in the pilot; MVP-first, no backfill planned).
- Pricing studio drafts (no cost figure can be computed until `generateObject` reports usage — a
  separate, contracts-level task).

## Questions (not blocking; plan proceeds)
1. Phase A: a new `studio_usage_ledger` table (teacher-only scope) instead of relaxing the existing
   `usage_ledger`'s NOT NULL `student_id`/`package_id` columns. Recommendation: keep them separate
   — relaxing the billing table's constraints to fit a scope it was never designed for is a bigger,
   riskier change than one small additive table, and keeps the student-billing path's invariants
   untouched. Decided at build time as `risk: medium` unless the lead says otherwise.
2. Phase C: a narrow, purpose-built phrase list instead of reusing/exporting the harness's jailbreak
   rule tables. Recommendation: keep them separate (see Phase C above); if drift between the two
   lists becomes a real problem later, unifying them is its own task with its own ADR-free
   refactor of `jailbreakPatterns.ts`'s exports.

## Risk
Every phase's handoff logs a `risk: high` decision (table 8.4c follows 8.4a/8.4b's own risk: high
precedent as a style-card-adjacent, repository-touching task) even though only Phase A touches a
named risky-path glob.

## Budget
Budget: 95 tool calls (3 phases: A 35, B 30, C 30; packages: @edmate/db (Phase A), @edmate/web
(Phases B, C))

## Allowed tools
Read, Grep, Glob, Edit, Write, Bash (migrations, tests, typecheck/lint, secret scan only)

## Exit conditions
Each phase: Status: DONE when its own files build/typecheck/lint/test green and the secret scan is
clean; Status: PARTIAL past ~35 (Phase A) / ~30 (Phase B, C) tool calls, or if a file outside that
phase's list needs changing (for example `runtime.ts` conflicts with 8.6f, or the composer in
`packages/harness/src/pedagogy/**` turns out to need its own change after all) — stop and hand back
rather than widening scope.

## Lead answers (25 Oct 2026)
- **Scope:** 8.4c builds **Phase C only** (apps/web: sanitizing style-card text and the stale-draft guard). Phases A and B move to the new board task 8.4d. With `generateObject` reporting no usage, the studio ledger would only hold rows saying "no usage reported". Build it alongside the contracts change that carries usage, since that is when it becomes useful (MVP first).
- **Q1:** moot for 8.4c. Q1 goes to 8.4d, and the recommendation stands (a separate teacher-scoped table).
- **Q2:** agreed. Use a narrow phrase list in apps/web, separate from the harness jailbreak rules.
- **Reviewers:** code-reviewer and typescript-reviewer. No risk paths are touched, so no risk: high decision is needed.
- **Budget:** 30 tool calls; stop at 38.
