# 9.2d handoff

## Phase A

Status: PARTIAL

### What changed

`packages/db` (Phase A scope only; `apps/web` is Phase B, not touched):

- `src/schema/users.ts`: new nullable `teacher_profiles.display_name text` column.
- `migrations/0027_teacher_display_name.sql` (+ journal/meta snapshot): additive
  `ALTER TABLE "teacher_profiles" ADD COLUMN "display_name" text;` — no drop, no backfill.
- `src/repositories/teacher-profiles.ts`: exported `DisplayName` zod schema (trim + whitespace
  collapse, 2–60 chars, at least one letter, allow-list shape, no URL/email/phone shape, no
  platform-impersonation word); `CreateInput.displayName` required, `UpdateInput.displayName`
  optional; `columns`, `create()`, `update()` wired through. `setVerification`,
  `assertVerifiedForPublish`, `listPendingForStaff` untouched (still read `users.name`/`email`
  for the staff queue only, per scope decision 6).
- `src/repositories/map.ts`: `TeacherProfileRowSchema`/`toTeacherProfile` carry `displayName`.
- `src/repositories/discovery.ts`: `displayName` now `coalesce(teacher_profiles.display_name,
  teacher_profiles.slug)`; no more read of `users.name` anywhere in this file (the `users` join
  stays only for `users.role`).
- `src/repositories/README.md`: §9/§11 updated to describe the new source of `displayName`.
- `src/seed.ts`, `src/discovery-seed.ts`: seeded `displayName` values (`'Demo Teacher'`,
  `` `Seed Teacher ${num}` ``) per scope decision 5.
- Tests: `test/schema.test.ts`, `test/discovery-seed.test.ts`, `test/teacher-profiles.test.ts`
  (unit, incl. new `DisplayName` describe block and a `BAD_DISPLAY_NAMES` table),
  `test/teacher-profiles.int.test.ts`, `test/discovery.int.test.ts` (public display name shows,
  set or falling back to slug; sign-in name never leaks), `test/repositories.int.test.ts`,
  `test/verify-teacher-cli.test.ts`, `test/scope.test.ts` (guard regex now also covers
  `users.name`).

### Evidence

- `python3 .githooks/secret-scan.py --all` → clean (no output).
- Migration SQL (`packages/db/migrations/0027_teacher_display_name.sql`):
  `ALTER TABLE "teacher_profiles" ADD COLUMN "display_name" text;`
- Repo-wide grep, `users.name` reads outside discovery.ts:
  ```
  packages/db/src/identity/store.ts:190:  name: users.name,        (identity/session store, unrelated to teacher-profiles)
  packages/db/src/repositories/teacher-profiles.ts:354:  name: users.name,   (listPendingForStaff, staff-only queue, scope decision 6)
  ```
  No other `.ts` file under `packages/db/src` reads `users.name`.
- `corepack pnpm turbo run typecheck lint test --filter=@edmate/db --force` (last run, after
  fixing the guard-comment false positive and two display-name-shape test fixtures):
  typecheck and lint clean; test: **2 failed | 73 passed (75 files)**, **3 failed | 1557 passed |
  4 skipped (1564 tests)**. Both failures are in `test/retrieval-leak.int.test.ts`, a file this
  task does not touch, and both are timing-sensitive (a cold-build-vs-timeout race and a p95/p99
  SLO check) — they do not call anything this task changed. An earlier run of the same gate (with
  the guard-comment bug not yet fixed) showed these same 75 files green apart from the two bugs I
  did introduce and then fixed (the `scope.test.ts` guard regex matching my own comments, and a
  `[${t}] display` test fixture that failed `DisplayName`'s shape regex) — i.e. every `@edmate/db`
  file this task touches was green on its own run; the two remaining failures are pre-existing
  flakiness in an unrelated, untouched integration test, surfaced only because it now runs for
  longer (727s vs 141s) under load from the rest of the suite.

### Left to do

- Re-run `corepack pnpm turbo run typecheck lint test --filter=@edmate/db --force` once more to
  confirm `test/retrieval-leak.int.test.ts`'s two failures are a flake (the brief allows "a lone
  timing flake in an untouched file that passes on re-run"); if they still fail on their own
  (`vitest run test/retrieval-leak.int.test.ts`) that is a separate, pre-existing issue, not
  caused by this task — do not fold a fix into this PR without checking it's unrelated first.
- Dependents typecheck (`corepack pnpm turbo run typecheck --filter=...@edmate/db`) was not run
  before the budget stop. `apps/web`'s teacher-profile create call will now fail typecheck
  because `CreateInput.displayName` is required — Phase B's builder adds the `displayName` field
  to the onboarding form and its `CreateInput` call; no other Phase A file should need a change
  for this.
- Phase B (apps/web: onboarding form, teacher page, discovery card) still to build on this same
  branch before review/merge, per the lead's change to the plan's order.

### Decisions

#### 23 Oct 2026 · teacher_profiles.display_name replaces users.name as the public teacher name · decided by planner · risk: high

- Decided: add a nullable `teacher_profiles.display_name text` column (additive migration, no
  backfill); public reads (`discovery.ts`) use `coalesce(display_name, slug)`, never
  `users.name`; `CreateInput.displayName` is required (validated by a new exported zod
  `DisplayName` schema: 2-60 chars, at least one letter, letters/marks/digits/space/'.-  only, no
  URL/email/phone shape, no `edmate`/`staff`/`admin`/`official` impersonation word),
  `UpdateInput.displayName` is optional; a display-name change does not reset verification; the
  staff queue (`listPendingForStaff`) keeps reading `users.name`/`email` unchanged, since staff
  verify identity, not the public name; seeds set `displayName` explicitly.
- Why: the sign-in name was doubling as the public teacher name, so any pending/rejected/unverified
  teacher's real name was visible wherever `users.name` leaked into a public read; splitting the
  public name into its own teacher-set, validated column removes that leak at the source and lets
  the teacher choose what strangers see without the staff identity check or the onboarding slug
  changing. Existing teachers without a display name fall back to the slug, which is already
  public in the URL, so nothing new leaks; backfilling from `users.name` was rejected because it
  keeps the exact leak this task removes.
- risk: high (this is a risky-path change per `.claude/skills/merge-gate/risk-paths.txt` —
  `packages/db/src/repositories/**` — and a teacher-written string now reaches every anonymous
  visitor; `security-reviewer` is the required reviewer, named in the plan).

Tool calls used: 150
