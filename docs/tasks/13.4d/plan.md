# 13.4d plan: account export completeness — consents and ended subscriptions

Written by the lead, 26 Oct 2026. Status: READY.

## Acceptance (verbatim, board task 13.4d)
Follow-up to 13.4b (decision log, 26 Oct 2026 "13.4b export completeness deferred to 13.4d"): add
a consents read and an ended-inclusive subscription read, and wire both into the account-wide
export, so `GET /api/me/export` is complete per the human's B-59 (5) answer (one account-wide
export across all the student's teachers) before the pilot.

## How it will be shown
- `corepack pnpm turbo run typecheck lint test --filter=...@edmate/db --filter=@edmate/web...`,
  with `TEST_DATABASE_URL` set so the two new db integration tests run (say in the handoff whether
  they ran or skipped).
- `apps/web` unit tests (fake backend, rule 4) show the account export now carries consents and
  includes a teacher whose subscription has ended.
- `python3 .githooks/secret-scan.py --all` clean.

## What exists already (checked before planning)
- Consents live only in `packages/db/src/schema/users.ts`'s `consents` table (`userId`, `kind`,
  `version`, `ts`, `grantedBy`, `withdrawnAt`) and are read today only inside
  `packages/db/src/identity/store.ts`'s private `hasParentConsent` helper. No public read exists.
- `packages/db/src/repositories/subscriptions.ts`'s `listLiveForStudent(studentId)` (9.4a Phase C)
  already takes the bare-id scope exception this task needs, but **excludes `status: 'ended'`**
  and is used by `/home` (`apps/web/src/chat/liveChats.ts`, `apps/web/app/home/page.tsx`) and the
  live-classes question route (`apps/web/app/api/live-classes/[id]/questions/handlers.ts`) — it
  must not change behaviour. `listUnavailableForStudent` is its mirror for a non-live agent, also
  excluding `ended`. Neither can be reused as-is; this task adds a new, separate method instead of
  touching either.
- `apps/web/src/export/accountExport.ts` (13.4b) today calls `listLiveForStudent` to build the
  `teachers` array and never reads consents — the exact gap this task closes. `buildExport` (9.6b,
  unmodified) already reads sessions/messages/evidence/questions for any `{studentId, teacherId}`
  pair regardless of subscription or agent status, so once `accountExport` is given an
  ended-inclusive pair list, no change to `buildExport` itself is needed.

## Files
1. **`packages/db/src/identity/store.ts`** (consents read)
   - Add `export interface ConsentRow { kind: string; version: string; grantedBy: 'self' | 'parent'; ts: string; withdrawnAt: string | null }`.
   - Add one method to the `IdentityStore` interface and `storeMethods`:
     `listConsentsForStudent(userId: string): Promise<ConsentRow[]>` — every `consents` row for
     that user id, ordered by `ts` ascending, mapped to ISO strings. Validate with the existing
     `IdSchema`/`parseArg` (same shape as `getUser`/`getMarket`); a bad id is `scope`, same as
     those two. No role check (consents rows only ever exist for students today; a non-student id
     simply has none — same stance as `getUser`, which also takes any role's id).
   - Doc comment: this serves only the student's own account export (13.4d); it returns the full
     consent record (kind, version, who granted it, when, and any withdrawal) because a consent
     history is exactly what an export is for — unlike `hasOpenForStudent` (13.4b), there is no
     "boolean only" narrowing here, since consents carry no other student's data and no teaching
     content.
   - Needs one new import: `asc` from `drizzle-orm` (not currently imported in this file).

2. **`packages/db/test/identity.int.test.ts`** (tests first)
   - New `describe('listConsentsForStudent')`: a student with two consents (one `privacy_notice`
     granted `self`, one `parental` granted `parent` later withdrawn) gets both back in `ts` order
     with the withdrawn one's `withdrawnAt` set; a second student's consents never appear in the
     first student's list and vice versa (the isolation case the task asks for); a user with no
     consents gets `[]`; a bad id (`''`, `'has space'`, `undefined`, `42`) is `scope` via the same
     `expectFailsClosed`-style helper this file already uses for `getMarket`/`getUser`.

3. **`packages/db/src/repositories/subscriptions.ts`** (ended-inclusive read)
   - Add one new method, **not** a change to `listLiveForStudent` or `listUnavailableForStudent`:
     `listAllForStudent(studentId: string): Promise<Array<{ agentId: string; teacherId: string; status: Entitlement['status']; periodEnd: string }>>`.
     Same bare-id scope exception and `IdSchema` guard as `listLiveForStudent` (doc comment cites
     it and explains why a third method exists rather than a flag: callers that need only live or
     only unavailable chats must not change). Joins `subscriptions -> package_versions -> packages
     -> agents` exactly like `listLiveForStudent` but with **no** `ne(status, 'ended')` filter and
     **no** filter on `agents.status` at all (an account export cares about every pair the student
     has ever subscribed to, however its agent stands today). Orders by `agents.id` for a stable
     diff-friendly result, same as its siblings.

4. **`packages/db/test/repositories.int.test.ts`** (tests first)
   - Add a grid entry `'subscriptions.listAllForStudent'` right after the existing
     `'subscriptions.listUnavailableForStudent'` entry (same shape: `scope: 'public'`, a `check`
     that confirms bad ids are `scope` and a random id is `[]`).
   - Extend the dedicated fixture test at the existing
     `'listLiveForStudent: live agents only, ended excluded, paused kept, every teacher, own rows
     only'` test (reuses its six-row fixture: live/active, live/paused, suspended/active,
     draft/trial, live/ended, live/past_due) with one more assertion:
     `listAllForStudent(S)` returns **all six** rows including the `ended` one and the
     `suspended`/`draft`-agent ones, and `listAllForStudent(OTHER)` returns only `OTHER`'s one row
     — the isolation case the task asks for, on the same fixture so no new seed rows are needed.

5. **`apps/web/src/export/accountExport.ts`**
   - Rewrite the top-of-file comment: it no longer says consents and ended subscriptions are out
     of bounds; it says this task closes that gap (13.4d).
   - `AccountExportBackend`: rename the `subscriptionPairs` field's method from
     `listLiveForStudent` to `listAllForStudent` (same signature, now also carrying `periodEnd` to
     match the new repo return — the export doesn't have to use `periodEnd`, but the backend type
     should not silently drop a field the repo now returns); add
     `identity: { getUser(...); listConsentsForStudent(studentId: string): Promise<ConsentRow[]> }`
     (import `ConsentRow` from `@edmate/db`).
   - `buildAccountExport`: add `backend.identity.listConsentsForStudent(studentId)` as a third
     parallel call (alongside the existing `listAllForStudent` and `getUser` calls); add
     `consents: ConsentRow[]` to the returned `AccountExportJson`.
   - `AccountExportJson`: add `consents: ConsentRow[]`.
   - Update the wired `accountExportHandler` at the bottom: `subscriptionPairs.listAllForStudent`
     calls `serverDatabase().repos.subscriptions.listAllForStudent`; `identity` gains
     `listConsentsForStudent: (userId) => serverDatabase().identity.listConsentsForStudent(userId)`.

6. **`apps/web/src/export/accountExport.test.ts`** (tests first, fake backend only — rule 4)
   - Rename the fake backend's `listLiveForStudent` to `listAllForStudent` throughout; update the
     "calls ... with the given studentId only" test to also assert `listConsentsForStudent` is
     called with the signed-in principal's own id and no other.
   - New test: a pair whose `status` is `'ended'` still produces a `teachers` entry (the gap
     13.4b's handoff named).
   - New test: `json.consents` carries the fake backend's consent rows unchanged.
   - Keep the existing do-not-leak regex scan (`help_state`/`helpState`/`mustNotReveal`/
     `answerKey`) passing with the new fields present — add consents fixture rows so the scan is
     exercised against real-shaped data, not just an empty array.

## Out of bounds
- `packages/contracts/**` — not touched (no ADR needed, per the brief).
- No migration — the `consents` table and its columns already exist exactly as needed; no schema
  change.
- `subscriptions.listLiveForStudent`, `subscriptions.listUnavailableForStudent` — read-only
  reference, never edited (used by `/home` and the live-classes question route).
- `apps/web/src/auth/**`, `apps/web/src/account/delete.ts`, `apps/web/app/api/me/route.ts`,
  `packages/db/src/repositories/safety-alerts.ts` — not this task's concern; untouched.
- `buildExport.ts` / `apps/web/src/export/buildExport.test.ts` (9.6b, per-agent export) — not
  touched; it already works for any pair regardless of subscription status.

## Risky paths touched (checked against `.claude/skills/merge-gate/risk-paths.txt`)
- `packages/db/src/identity/**` → **reviewers: security-reviewer**.
- `packages/db/src/repositories/**` → **reviewers: security-reviewer**.
- The lead also runs code-reviewer, typescript-reviewer and database-reviewer (no migration, so
  database-reviewer's finding set should be small, but it is still run per standing practice on a
  `packages/db` change).
- The handoff logs a `risk: high` decision naming the personal-data surface (account export now
  includes consent history and every past subscription, not just live ones).

## Tests first
Write the new db integration tests (items 2 and 4 above) and the new/renamed web unit tests (item
6) before the implementation, per the project's TDD rule.

## Gate
- `corepack pnpm turbo run typecheck lint test --filter=...@edmate/db --filter=@edmate/web...`
  with `TEST_DATABASE_URL` set (say in the handoff whether the db integration tests ran or
  skipped).
- `corepack pnpm exec prettier --check` on changed files.
- `python3 .githooks/secret-scan.py --all`.

## Open questions
None block starting. One note for the human, non-blocking: this export now includes a student's
full consent history (kind, version, who granted it, when, any withdrawal) and every subscription
they have ever had, including ended ones with teachers whose agent may since have been suspended
or taken down. That is a direct reading of B-59 (5)'s "one account-wide export"; flag if a
narrower scope is wanted instead.

## Budget
Budget: 45 tool calls (1 phase: packages/db, apps/web)

## Allowed tools
Read, Grep, Glob, Edit, Write, Bash (migrations N/A; tests and secret scan only)

## Exit conditions
- `Status: DONE` when both new db methods have green integration tests (or a stated skip reason
  with `TEST_DATABASE_URL` unset), the web unit tests are green, the secret scan is clean, and the
  handoff names the `risk: high` decision.
- `Status: PARTIAL` past about 60 tool calls, or if a file outside this list needs changing (e.g.
  `listLiveForStudent`/`listUnavailableForStudent` turn out to need a change after all) — hand
  back to the lead rather than expanding scope.

## Lead amendment (26 Oct 2026)
- **Open question answered by the lead (risk: medium):** use the literal reading of B-59 (5). The export
  includes the student's full consent history and every subscription they ever had, including
  subscriptions with a teacher whose agent was later suspended or taken down. These are the student's own records, and a
  data-access export must not hide them. The export still never includes the teacher's private
  material (documents, style card, eval cases) or any staff takedown notes; only the
  subscription's own fields (teacher display name, package, status, dates). The builder copies this
  decision into the handoff's `## Decisions` as `decided by lead · risk: medium`.
- **Ordering:** start only after 9.3m merges (both edit `packages/db/test/repositories.int.test.ts`).
