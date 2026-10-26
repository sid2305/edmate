# Plan: 1.7a — age and consent follow-ups (1.7 review MEDIUM/LOW)

## Acceptance (verbatim, from the board)
`accept: each item has a test or a logged decision; production refuses a pending notice`

How it is shown: the gate (`typecheck lint test`) is green for every touched package, the new/updated
tests listed below cover each item, and the handoff's `## Decisions` records the one item that is
already satisfied with no change (so "each item has a test or a logged decision" covers it without a
code diff).

## The six review items and how each is closed

1. **`packages/content/src/agePolicy.ts:36`** (security-reviewer) — `content validate` should flag
   `minAge` outside 13–18.
2. **`apps/web/src/auth/age.ts:66`** (security-reviewer; B-27 Q2) — the `signed` flag on a notice is
   computed but never used; refuse an unsigned notice in production.
3. **`apps/web/src/auth/guard.ts:529`** (security-reviewer) — `requireRole` defaults to `age`
   clearance; default-deny for actions, or a coverage test.
4. **`apps/web/src/auth/age.ts`** (typescript-reviewer) — `submitAgeAnswer`'s and `deps.resolve`'s
   catch blocks discard errors with no log line; `ageGateView` has no try/catch around `resolve`.
5. **`packages/db/src/identity/age.ts:29`** (typescript-reviewer) — comment that the `ageStatus`
   overload narrowing is a runtime guarantee, not type-proven.
6. **`packages/db/migrations/0014_age_consent.sql:10`** (database-reviewer) — the CHECK constraints
   validate under `ACCESS EXCLUSIVE`; use `NOT VALID` then `VALIDATE CONSTRAINT`.

### Item 5 is already done — verify only, no edit
`packages/db/src/identity/age.ts` lines 67–70 already carry the exact comment the review asked for
("With a birth year the answer is never `age_needed` (runtime-guaranteed by the `birthYear === null`
check below, not provable from the types alone)."), added in a later phase of 1.7 that touched this
file for an unrelated reason. The builder reads the file, confirms the comment is still there, and
writes a `## Decisions` line saying item 5 needed no change. No diff to this file in this PR; it is
not "touched" for the risk-paths purposes below.

### Item 1: `content validate` flags `minAge` outside 13–18
Add a new `LocaleRule` to `packages/content/src/localeRules.ts`, next to `complianceReviewed`:
`minAgeInRange` checks `pack.compliance.minAge` is a safe integer in `[PLATFORM_MIN_AGE, 18]`
(import `PLATFORM_MIN_AGE` from `./agePolicy.js`, same package; `18` is a local constant with a
comment that it mirrors `@edmate/db`'s `CONSENT_AGE`, since this package does not import `@edmate/db`
— same reasoning `agePolicy.ts`'s header already states). Issue text:
`` compliance.minAge <value> must be between 13 and 18 ``. Add it to `LOCALE_RULES`. Tests in
`packages/content/src/localeRules.test.ts` (same file/pattern as `complianceReviewed`'s block):
in range passes (13, 18), 12 and 19 fail, non-integer/NaN fails, and `checkLocalePacks` picks it up.
Also check `realLocales.test.ts` still passes (every real pack's `minAge` is 13, which stays valid).

### Item 2: refuse an unsigned notice in production
`loadAgeContent(dir, log, production = false)` in `apps/web/src/auth/age.ts` gains a third optional
parameter (default `false`, so every existing test keeps today's behaviour with no edit). Inside the
`notice(market)` closure, when `production && !noticeSigned(n)`, throw instead of returning the
placeholder (`new Error('privacy notice for "<market>" is not signed; refusing in production')`,
non-PII). `apps/web/src/auth/index.ts`'s `getAgeContent()` passes
`process.env.NODE_ENV === 'production'` as the third argument (same `NODE_ENV` check the module
already uses at line 100 for the dev Redis singleton — no new pattern).
Effect: in production, viewing `/welcome/age`'s notice step or submitting an answer throws from
`ageNotice`/`notice()`; the page call is uncaught (500, same "content load failure fails closed for
students only" direction as the rest of this module); `submitAgeAnswer`'s call is inside its own
try/catch and returns the existing generic `provider_error` body. Nothing can sign up through the age
gate in `NODE_ENV=production` until a market's privacy notice is signed — see Open question below;
this follows the board's own accept line ("production refuses a pending notice") so it does not block
this plan.
Tests in `age.test.ts`: `loadAgeContent(dir, log, true)` with an unsigned notice throws on
`.notice(market)`; `production: false` (today's default) still returns the placeholder; a signed
notice never throws regardless of `production`. `index.ts` needs no new test (it is a one-line env
read already covered by existing `index.test.ts`/build-smoke patterns; note it in the handoff instead
of adding a redundant test).

### Item 3: `requireRole`'s default clearance — coverage test (not a behaviour change)
Recommendation: extend the existing scan, not change the default. `apps/web/src/chat/clearance-scan.test.ts`
already fails the build on a bare `requireRole(['student'])` with no `clearance: 'agent'`, but only
under `app/learn/**` and `src/chat/**`. Every `requireRole(['student'], ...)` call site in the repo
today is one of: `app/learn/[agentId]/page.tsx`, `app/packages/[agentId]/page.tsx` (both already
`clearance: 'agent'`), and `app/learn/[agentId]/memory`, `/plan`, `/progress`, `app/home/page.tsx`
(already named exceptions or, for `home`, intentionally `age`) — confirmed by grep, no other student
call site exists. Generalise `clearanceProblem`'s regex to match only calls whose role array contains
`'student'` (`/\brequireRole\s*\(\s*\[[^\]]*'student'[^\]]*\][^)]*\)/g`, so a `['teacher']`/`['staff']`
call is never flagged), and widen `ROOTS` to the whole `app` directory plus `src/chat`, keeping the
`'use server'`-without-`requireRole` check scoped to `app/learn` and `src/chat` only (teacher/staff
actions use roles the clearance rule doesn't apply to, so that half of the check must not run
app-wide). Add `app/home/page.tsx` to the named-exception list next to `MEMORY_PAGE`/`PROGRESS_PAGE`/
`PLAN_PAGE`, with the same one-line reason comment (it is the student's own dashboard, reachable with
a parent's consent outstanding). This gives a repo-wide guard that any *future* `requireRole(['student'])`
call site must either say `clearance: 'agent'` or be added to the named exception list, so a missed
clearance on a new agent-adjacent action fails CI instead of silently defaulting to `age`. No
production behaviour changes. Why not change the default: `requireRole`'s `age` default is relied on,
by name, at four call sites today (home, memory, plan, progress) precisely because those pages must
stay open to a `parent_needed` student; flipping the default to `agent` would need an explicit
`clearance: 'age'` added to all four, trading one implicit default for another with no net safety gain
and a materially bigger diff for a LOW finding.

### Item 4: log discarded errors; wrap `ageGateView`'s `resolve` call
In `apps/web/src/auth/age.ts`:
- `submitAgeAnswer`'s `catch { return failed; }` around `deps.resolve(deps.cookies)` (line ~167) logs
  first, same style as `close()`'s own catch a few lines up:
  `` (deps.log ?? ((l) => console.error(l)))(`[auth] age gate: resolve failed ${describeError(error)}`) ``.
- The final `catch (error) { ... return failed; }` branch in `submitAgeAnswer` (after the
  `RepositoryError` checks, ~line 206) logs the same way before returning `failed`, for the one case
  that is neither `not_found` nor `invalid` (an unexpected `recordAgeAnswer`/`notice()` failure —
  this is also where item 2's production-unsigned throw lands).
- `ageGateView` wraps its `await deps.resolve(deps.cookies)` call in try/catch; on a throw it logs
  (same helper; `ageGateView`'s own `deps` has no `log` field today — add it, optional, defaulting to
  `console.error` like `AgeGateDeps.log`) and returns `{ state: 'sign_in' }` (fail toward "ask the
  learner to sign in again", the same direction `resolvePrincipal`'s own callers already fail toward
  on a lookup error, never toward `'clear'`).
Tests in `age.test.ts`: each of the three catch sites is exercised with a throwing `resolve`/
`identity` fake and asserted to call the injected `log` with one line, no PII (message shape only,
not exact wording).

### Item 6: migration 0014's CHECK constraints — `NOT VALID` + post-migrate `VALIDATE`
Precedent already in this repo for editing an already-merged migration file this way: migration
`0032_retention_indexes.sql`'s own header comment says plainly that its indexes were converted from
inline `CREATE INDEX` to schema-only + post-migrate step, and that "a database that already applied
the old version of this file keeps its [constraint/index]; the post-migrate step... [is] then a
no-op." The same pattern already exists for CHECK constraints (migration `0023`, task 12.4a) and FKs
(`0009`, `0024`). Apply it here:
- Edit `packages/db/migrations/0014_age_consent.sql`: add `NOT VALID` to the end of both
  `ADD CONSTRAINT ... CHECK (...)` lines, with a comment matching 0009/0023's wording (ACCESS
  EXCLUSIVE is still taken, but briefly; validation runs as an autocommit post-migrate step instead).
  The column `ADD COLUMN` lines are untouched. `src/schema/users.ts`'s `check()` calls are untouched
  (same final constraint; `drizzle-kit generate` must still report no schema changes — run it and
  confirm).
- `packages/db/src/migrate.ts`: append two `{ kind: 'validateConstraint', ... }` entries to
  `POST_MIGRATE_STEPS` (table `consents`, constraint `consents_granted_by_check`; table `users`,
  constraint `users_birth_year_check`), and extend the doc comment above the array (which already
  lists which migration introduced each entry) with "Migration 0014 (task 1.7a, 1.7 review
  deferral)...". This is an append, matching the array's own "append here, don't edit past entries"
  rule for itself (the migration **file** is the thing being edited here, not this list).
- `packages/db/test/migrate.test.ts`: the count assertion
  (`POST_MIGRATE_STEPS.filter(s => s.kind === 'validateConstraint')).toHaveLength(7)`) becomes `9`,
  plus a new block asserting the two new entries, following the existing `documents`/`agents` blocks
  exactly.
- `packages/db/test/age-consent-migration.int.test.ts`: change `migrateWith(MIGRATIONS_DIR)` in
  `beforeAll` to `migrateDatabase(TEST_URL)` (import from `../src/migrate.js`, same swap
  `document-live-class-migration.int.test.ts` made for its own NOT VALID constraint, with the same
  one-line comment), and add a test that `select convalidated from pg_constraint where conname in
  ('consents_granted_by_check', 'users_birth_year_check')` is `true` for both after migration. The
  three existing tests (birth-year range accept/reject, granted_by accept/reject) are unaffected:
  `NOT VALID` only skips the one-time scan of *pre-existing* rows at creation time, every new write is
  still checked.
- No new migration number, no new `meta/*.json` file (the generated migration content doesn't change
  shape, matching 0032's own precedent).

## Files touched, by package/app (for the no-shared-files check against a concurrent builder)
- `packages/content/src/localeRules.ts`, `packages/content/src/localeRules.test.ts` (item 1)
- `apps/web/src/auth/age.ts`, `apps/web/src/auth/age.test.ts`, `apps/web/src/auth/index.ts` (items 2, 4)
- `apps/web/src/chat/clearance-scan.test.ts` (item 3)
- `packages/db/src/identity/age.ts` — **read only**, no diff (item 5)
- `packages/db/migrations/0014_age_consent.sql`, `packages/db/src/migrate.ts`,
  `packages/db/test/migrate.test.ts`, `packages/db/test/age-consent-migration.int.test.ts` (item 6)

Nothing here touches `packages/harness/**` or `apps/web`'s start-up/boot files
(`apps/web/src/turn/**`, `next.config.ts`, `Dockerfile`), so this is safe to run alongside a builder
on those paths. `apps/web/src/auth/index.ts`'s only change is one new argument to an existing call
(`getAgeContent()`/`loadAgeContent(...)`) — if a concurrent builder also touches that file, the lead
resolves the merge order, not a shared-file violation (this plan names the file so the lead can check
before starting a second builder).

## Risky paths touched (checked against `.claude/skills/merge-gate/risk-paths.txt`)
- `apps/web/src/auth/age.ts`, `apps/web/src/auth/index.ts` → under `apps/web/src/auth/**` →
  **reviewers: security-reviewer**.
- `apps/web/src/chat/clearance-scan.test.ts` → not listed (only `apps/web/src/auth/**` and
  `apps/web/app/api/**` groups exist; `src/chat/**` is not a risky glob). No required reviewer from
  this path alone; security-reviewer will see it anyway as part of the same PR.
- `packages/content/src/localeRules.ts` → not listed (the risky content globs are
  `content/locales/**`, `content/legal/**`, `packages/content/src/promptPacks.ts` and
  `packages/content/src/personaTemplates.ts`; `localeRules.ts` is none of those).
- `packages/db/migrations/0014_age_consent.sql`, `packages/db/src/migrate.ts` → not listed by glob
  (only `packages/db/src/identity/**` and `packages/db/src/repositories/**` are risky paths under
  `packages/db`); not a data-dropping migration either (merge_gate.py's separate migration check),
  so no automatic trigger. Still a migration/constraint-locking change, so **database-reviewer** is
  requested as a matter of good practice (it is exactly the kind of change database-reviewer caught
  in the 1.7 review), named below even though risk-paths.txt doesn't require it.
- `packages/db/src/identity/age.ts` → no diff, not touched.

Required reviewers for `review.md`'s `Reviewers:` line: **security-reviewer** (risky path),
**database-reviewer** (migration/constraint change, recommended), plus the standard
**code-reviewer** and **typescript-reviewer** (always required). Log a `risk: high` decision at
merge naming the `apps/web/src/auth/**` path, per the non-negotiables.

## Open question (not blocking; recommendation stated, proceed as READY)
**What does production do with an unsigned notice, beyond refusing it?** Item 2 makes the age gate's
notice step and submit action throw/error in `NODE_ENV=production` for any market whose privacy notice
is still `reviewedBy: pending` (today: every market — `global.md` and `US.md` are both still
placeholders per the 3.10c/B-27 counsel task). Net effect: **no learner can clear the age gate in a
real production deployment until a market's notice is signed**, which is a bigger practical
consequence than the LOW finding's wording suggests on its own, even though it is exactly what the
board's accept line asks for ("production refuses a pending notice"). Recommendation: proceed exactly
as specified — this is pre-pilot (no real students yet; GATE/3.10c/B-27 already track getting a real
notice signed before launch), and failing closed here is strictly safer than the alternative (showing
a placeholder to a real learner). No human decision needed to stay READY; flagging only so the lead
knows production age sign-ups are blocked end-to-end until a notice is signed, which is intended.

## Tests first
- `packages/content/src/localeRules.test.ts`: new `describe('minAgeInRange', ...)` block, red before
  the rule exists (no export), green after.
- `apps/web/src/auth/age.test.ts`: new cases for `loadAgeContent(..., true)` throwing on an unsigned
  notice and not throwing on a signed one or when `production` is omitted/`false`; three new catch-path
  log assertions (item 4); run red (missing param / missing log calls) before the edit.
- `apps/web/src/chat/clearance-scan.test.ts`: widen the existing test's `files` list manually in the
  test run to confirm no false positive on `app/teacher/**`/`app/staff/**` before trusting the scan;
  the "catches a bare call" unit cases get one more case for a `['teacher']` call that must stay
  `null`.
- `packages/db/test/migrate.test.ts` and `packages/db/test/age-consent-migration.int.test.ts`: red
  (`toHaveLength(7)` fails once two more entries are appended; the new `convalidated` assertion fails
  against the unedited 0014) before editing the migration and `migrate.ts`.

## Gate commands (run after each item, not just once at the end)
```bash
source ~/.nvm/nvm.sh && corepack pnpm turbo run typecheck lint test --filter=@edmate/content...
source ~/.nvm/nvm.sh && corepack pnpm turbo run typecheck lint test --filter=@edmate/web...
source ~/.nvm/nvm.sh && corepack pnpm turbo run typecheck lint test --filter=@edmate/db...
python3 .githooks/secret-scan.py --all
```
`@edmate/web...` and `@edmate/db...` (the `...` includes dependents) because `apps/web` depends on
`@edmate/db` and `@edmate/content`, so a content or db change must be gated through web's own suite
too (the 7.4a lesson: gate dependents, not just the edited package).

## Decisions to log at handoff
- Item 5 (`packages/db/src/identity/age.ts`) needed no change; the comment the review asked for was
  already added in a later 1.7 phase.
- `risk: high` for the `apps/web/src/auth/**` path (items 2 and 4), per the non-negotiables.
- The production-refuses-an-unsigned-notice consequence (Open question above), so it's on record
  before the pilot gate.

## Budget
Budget: 40 tool calls (1 phase, packages/content + apps/web + packages/db)

## Allowed tools
Read, Grep, Glob, Edit, Write, Bash (pnpm turbo gate commands, secret scan, drizzle-kit generate check only)

## Exit conditions
Status: DONE once all four gate commands above are green, the secret scan is clean, and every one of
the six review items has either a passing new/updated test or (item 5) a logged decision with no
diff. Status: PARTIAL past about 50 tool calls, or if the clearance-scan generalisation (item 3)
turns up an unexpected student-role `requireRole` call site this plan didn't account for — stop and
hand back rather than deciding a new exception alone.
