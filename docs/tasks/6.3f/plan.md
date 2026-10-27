# Task 6.3f — 6.3a Phase A security review MEDIUMs/LOW, plus one Phase B LOW

Board: milestone M13 · deps `6.3a` (PR #392, branch `origin/m13/6.3a-mistake-proposals`, about to
merge to `main`) · risk: high (touches `packages/db/src/repositories/**`) · one phase.

## Acceptance (verbatim, `docs/board/tasks.yaml`)

Title: "6.3a Phase A security review MEDIUMs and LOW (packages/db/src/repositories/mistake-
proposals.ts): approve validates the merged mistakeTags against STYLE_CARD_LIMITS.tagsMax (20) and
raises limit instead of writing a 21-tag style card; record checks the teacher role (lockRole) like
approve and reject; record takes a per-teacher advisory lock before its MISTAKE_PROPOSALS_MAX count
check so two concurrent calls cannot pass 100 rows; lastSeen uses the contracts timestamp() schema.
Phase B review LOWs (apps/web/src/studio/mistakeProposalRoutes.ts): the route Tag schema imports
the repository tag max length instead of a hardcoded 60; consider a per-teacher rate limit on
approve and reject"

Accept: "one failing-then-passing int test per fix (21st tag refused with limit; a student id
refused on record; concurrent record calls stay at or under the cap; a malformed lastSeen is
invalid); @edmate/db typecheck, lint and test green; security-reviewer re-check."

### How it is shown (paste into handoff.md)

All four on Postgres, each its own failing-then-passing `it(...)` added to
`packages/db/test/mistake-proposals.int.test.ts` (the file 6.3a lands on `main`):
1. A teacher already at `STYLE_CARD_LIMITS.tagsMax` (20) tags approves one more pending proposal:
   `approve` returns `{ approved: false, card: null }` (or throws `RepositoryError('limit', ...)` —
   builder picks whichever shape matches `approve`'s existing no-op convention for "didn't apply",
   see Design) and the style card gets no new version (confirm via `styleCards.latest` unchanged).
2. `record({ teacherId: <a student's id> }, [...])` is refused (`RepositoryError('scope', ...)`),
   same as `approve`/`reject` already refuse a non-teacher id; no row is written.
3. A concurrency test: fire `N` concurrent `record` calls, each proposing a distinct new tag, for a
   teacher already near `MISTAKE_PROPOSALS_MAX` (100) such that not all can fit; after all settle,
   count the teacher's stored rows and assert it never exceeds 100 (same two-call race shape 6.3a's
   existing `approve` race test already uses).
4. `record` with a `lastSeen` that is not a valid offset-bearing ISO datetime (e.g. `'not-a-date'`
   or a date with no offset) is `RepositoryError('invalid', ...)`; no row written.
Gate: `corepack pnpm turbo run typecheck lint test --filter=@edmate/db...` (Postgres up via
`docker compose -f docker/compose.yaml -f packages/db/test/compose.port.yaml up -d postgres`).

Plus the Phase B route fix (no int test required by accept, but keep
`apps/web/src/studio/mistakeProposalRoutes.test.ts` green):
5. `mistakeProposalRoutes.ts`'s `Tag` zod schema imports `STYLE_CARD_LIMITS` from `@edmate/db`
   instead of a hardcoded `.max(60)`. Gate: `corepack pnpm turbo run typecheck lint test
   --filter=@edmate/web...`.

## State of the world (confirmed on `main`, 27 Oct 2026 — the fixed code lives only on PR #392,
not yet merged; I could not `git show` the branch in this session — see Note below)

- `packages/db/src/repositories/style-cards.ts` (on `main` now) defines
  `STYLE_CARD_LIMITS = { textMaxChars: 4000, tagsMax: 20, tagMaxChars: 60 }` and is re-exported from
  `packages/db/src/repositories/index.ts:107` (`export { STYLE_CARD_LIMITS, ... }`), so `@edmate/db`
  already carries it — no new export needed for fix 5.
- `style-cards.ts`'s own `DraftInput` zod schema enforces `.max(STYLE_CARD_LIMITS.tagsMax)`, but
  only inside `create()` *before* it calls the extracted `insertNextVersion(tx, teacherId, draft,
  method)` (6.3a's refactor). `insertNextVersion` itself takes an already-validated `{ text,
  mistakeTags: string[] }` and does **no** length check. 6.3a's `mistakeProposalsRepo.approve` calls
  `insertNextVersion` directly with the old card's tags plus the newly approved one — bypassing the
  20-tag cap entirely. That is the exact bug: fix 1 adds the same `mistakeTags.length >
  STYLE_CARD_LIMITS.tagsMax` check inside `approve`, before calling `insertNextVersion`.
- `packages/db/src/role-lock.ts`'s `lockRole(tx, id): Promise<Role | null>` (`FOR SHARE` on
  `users.role`) is the shared helper `style-cards.ts`'s `create` already calls (`role === null` →
  `not_found`, `role !== 'teacher'` → `scope`). Per 6.3a's plan, `approve`/`reject` already call it;
  `record` does not — fix 2 adds the same two-line check to `record`, inside its transaction.
- `apps/web/src/studio/styleCardRoutes.ts:37-39` has the exact same pattern 6.3f's fix 5 removes
  from `mistakeProposalRoutes.ts` (a comment "mirrors the repository's STYLE_CARD_LIMITS" over a
  hardcoded `z.string().trim().min(1).max(60)`) — **out of scope for this task** (not named in the
  accept line); do not touch it. Flagged as Q2.
- `apps/web/src/studio/linkRateLimit.ts` is a real, reusable per-teacher rate-limit helper already
  used by a sibling studio route (`studio/routes.ts`'s `addLink`, and again for `createRateLimit` at
  8.2q) — a fixed-window Redis Lua `INCR`+`PEXPIRE`, with `fakeLinkRateLimiter` and
  `failingLinkRateLimiter` for tests, fail-closed on a store error. This answers the task's "check
  whether apps/web already has a rate-limit helper used by sibling studio routes" — **yes, it
  does**. See Phase B (optional) below and Q1.
- `packages/contracts/src/formats.ts:15` exports `timestamp = () => z.iso.datetime({ offset: true
  })`; `packages/contracts/src/memory.ts:16` already uses the identical shape for a mistake entry's
  `lastSeen: timestamp()`. Fix 4 imports `timestamp` from `@edmate/contracts` into
  `mistake-proposals.ts`'s `ProposedMistakeTagInput` validation, replacing whatever looser string
  check is there now.
- **Note on this plan's sourcing:** this session has no shell/git tool, so I read 6.3a's design from
  `docs/tasks/6.3a/plan.md` (merged to `main`) and confirmed every fact above against the real code
  already on `main` (`style-cards.ts`, `role-lock.ts`, `repositories/index.ts`,
  `contracts/src/formats.ts`, `contracts/src/memory.ts`, `styleCardRoutes.ts`, `linkRateLimit.ts`,
  `studio/routes.ts`). I did not read `mistake-proposals.ts`, `mistakeProposalRoutes.ts` or their
  test files themselves (they exist only on the unmerged PR branch). The builder's first step must
  be to read those four files fresh off `main` once PR #392 merges, and treat the exact current
  code (not this plan's guesses at variable names) as ground truth; flag a mismatch rather than
  guess further.

## Design

### Fix 1 — `approve` enforces the 20-tag cap before writing a new version
Inside `mistakeProposalsRepo(db).approve`, after computing the deduped merged tag list and before
calling `insertNextVersion`, add: if `merged.length > STYLE_CARD_LIMITS.tagsMax`, do not write
anything; return the no-op shape `approve` already uses for "didn't apply" (match whatever the
existing pending-row-missing branch returns — likely `{ approved: false, card: null }` — for
consistency, rather than throwing; confirm against the real method once read). Leave the proposal
row `pending` (not `rejected`) so the teacher can still decide after trimming their card's tags
elsewhere. Import `STYLE_CARD_LIMITS` from `./style-cards.js` (same relative import `mistake-
proposals.ts` likely already has for `tagMaxChars`, per 6.3a's plan).

### Fix 2 — `record` checks the actor is still a teacher
Inside `record`'s transaction (it must already be a `db.transaction` for the upsert-by-tag logic;
if not, this fix also wraps it in one — needed anyway for fix 3's lock), call `lockRole(tx,
scope.teacherId)` first: `null` → `RepositoryError('not_found', method)`, not `'teacher'` →
`RepositoryError('scope', method)`. Same two branches `approve`/`reject` already have.

### Fix 3 — `record` locks before its cap check
Still inside the same transaction, after the role check and before counting the teacher's existing
proposal rows against `MISTAKE_PROPOSALS_MAX`, take a per-teacher advisory lock:
`pg_advisory_xact_lock(<namespace>::int4, hashtext(teacherId))`, same shape as `style-cards.ts`'s
`VERSION_LOCK_NAMESPACE`. Add a new, distinct namespace constant in `mistake-proposals.ts` (e.g.
`MISTAKE_PROPOSAL_LOCK_NAMESPACE`) — reusing `8401` would serialise against unrelated style-card
writes for no reason, and the file's own header comment convention (per `style-cards.ts:40-43`)
should say why it must differ. The count-then-insert-or-update sequence moves inside the locked
section so two concurrent `record` calls for the same teacher serialise.

### Fix 4 — `lastSeen` uses the contracts `timestamp()` schema
Import `timestamp` from `@edmate/contracts` into `mistake-proposals.ts`; use it for the
`ProposedMistakeTagInput.lastSeen` field in whatever zod schema currently parses the `record`
input array (replacing a looser `z.string()` or ad-hoc check). `MistakeProposalRow.lastSeen` (the
read-side type) is unaffected — it is already typed `string` and the column stores a timestamptz.

### Fix 5 — route's `Tag` schema imports the repository's cap
In `apps/web/src/studio/mistakeProposalRoutes.ts`, find the `Tag` zod schema (shape:
`z.string().trim().min(1).max(60)`, per the board title). Import `STYLE_CARD_LIMITS` from
`@edmate/db` (already re-exported, confirmed above) and change `.max(60)` to
`.max(STYLE_CARD_LIMITS.tagMaxChars)`. Do not touch `styleCardRoutes.ts`'s own identical pattern
(Q2, out of bounds).

### Phase B (optional — only if the lead says yes; see Q1) — rate limit on approve/reject
`apps/web/src/studio/linkRateLimit.ts`'s shape (`LinkRateLimiter` interface, `redisLinkRateLimiter`,
`fakeLinkRateLimiter`, `failingLinkRateLimiter`) is reusable as-is, the same way `routes.ts` already
reuses it twice (`linkRateLimit` for `addLink`, `createRateLimit` at 8.2q for upload-row creation).
If built: add a third field to `MistakeProposalBackend` (or wherever its backend interface lives),
e.g. `decideRateLimit: LinkRateLimiter`, checked at the top of the `PATCH` handler's decide path
before calling `repos().mistakeProposals.approve/reject`; a limit hit returns the same 429/`Too many
...` shape `routes.ts`'s `rateLimited()` helper already returns. Wire a real
`redisLinkRateLimiter(redis, { prefix: 'edmate:studio:mistakerate' })` wherever `linkRateLimit`
itself is constructed for `routes.ts` (I did not find that wiring site in this session — likely
`apps/web/src/studio/index.ts` or a server bootstrap file the builder should locate fresh).

## Files

- **Modify:** `packages/db/src/repositories/mistake-proposals.ts` — fixes 1–4.
- **Modify:** `packages/db/test/mistake-proposals.int.test.ts` — the four new cases ("How it is
  shown" 1–4 above).
- **Modify:** `apps/web/src/studio/mistakeProposalRoutes.ts` — fix 5.
- **Confirm unchanged/still green:** `apps/web/src/studio/mistakeProposalRoutes.test.ts` (fix 5 is
  an internal import swap with the same effective cap value, 60; no new test required by accept,
  but add one assertion only if the existing suite has no case near the boundary).
- **Modify:** `docs/tasks/6.3f/handoff.md` (by the builder).
- *(Optional Phase B, only on explicit lead go-ahead — see Q1):* new rate-limit wiring in
  `apps/web/src/studio/mistakeProposalRoutes.ts`, its backend-interface file, and wherever
  `linkRateLimit`'s real instance is constructed; plus a test for the 429 path.

## Files out of bounds

- `apps/web/src/studio/styleCardRoutes.ts` — has the same hardcoded-60 pattern (Q2) but is not named
  in this task's title or accept line; leave it for a separate task if the lead wants it fixed too.
- `packages/db/src/repositories/style-cards.ts`, `role-lock.ts` — read for context, not modified;
  `insertNextVersion` and `lockRole` are called, not changed.
- `packages/contracts/**` — `timestamp()` already exists; no contracts change.
- `packages/db/src/schema/**`, `packages/db/migrations/**` — no schema change, no new migration.
- Everything else 6.3a's own "Files out of bounds" list already excluded (`packages/harness/**`,
  `apps/web/src/chat/**`, `apps/web/src/turn/**`, `apps/web/src/auth/**`, `content/**`).

## Tests first

1. `packages/db/test/mistake-proposals.int.test.ts` — write each of the four new cases red first
   (confirm it fails against the current, unfixed method), then make it pass.
2. `apps/web/src/studio/mistakeProposalRoutes.test.ts` — confirm still green after the import swap;
   add one boundary case (a 61-char tag refused, a 60-char tag accepted) if none exists yet.
- **Gate (db):** `corepack pnpm turbo run typecheck lint test --filter=@edmate/db...`.
- **Gate (web):** `corepack pnpm turbo run typecheck lint test --filter=@edmate/web...`.

## Risky paths touched (checked against `.claude/skills/merge-gate/risk-paths.txt`)

- `packages/db/src/repositories/mistake-proposals.ts` matches the
  `packages/db/src/repositories/**` group (risk-paths.txt lines 29–41, "...keeping each teacher's
  and student's data apart"). **reviewers: security-reviewer** (required). Recommend also
  **database-reviewer** (the new per-teacher advisory lock and the transaction-scoped role check are
  exactly its kind of finding; matches 6.3a's own precedent). code-reviewer and typescript-reviewer
  apply to every PR by default.
- `apps/web/src/studio/mistakeProposalRoutes.ts` — confirmed **not** on risk-paths.txt (only
  `apps/web/src/auth/**`, `app/api/auth/**`, `app/api/staff/**`, `app/staff/**`,
  `app/api/webhooks/**` are risky under `apps/web`). Default code-reviewer/typescript-reviewer only.
  The optional Phase B rate-limit wiring stays under the same `apps/web/src/studio/**` path — still
  not risky.
- No `packages/contracts/**`, `docs/adr/**`, `.claude/**`, migrations touched.
- Per CLAUDE.md rule 6, the handoff must log a `risk: high` decision for the
  `packages/db/src/repositories/**` touch (the board task already carries `risk: high`).

## Open questions (each with a recommendation)

- **Q1. Build the optional rate limit on approve/reject now, or defer?** `linkRateLimit.ts` exists
  and is a clean fit (confirmed above), but it is a "consider" in the board title, not named in the
  accept line, and the four required fixes plus fix 5 already carry the task's whole test burden.
  Recommend: **defer** — ship this task with only the five required fixes in one phase and one
  budget, and open a small follow-up board task for the rate limit if the lead wants it (cites: the
  caller's own steer to keep this one phase when possible).
- **Q2. Also fix `styleCardRoutes.ts`'s identical hardcoded-60 pattern while touching the sibling
  file?** Recommend: no — not named in this task's title/accept; a separate one-line follow-up task
  is cheaper to review than widening this one's risky-path diff.
- **Q3. Fix 1's exact return shape on a refused approve (no-op tuple vs. thrown `RepositoryError
  ('limit', ...)`)?** I could not read `mistakeProposalsRepo.approve`'s real code this session.
  Recommend: match whatever shape the method's *other* no-op branch already uses (the "proposal no
  longer pending" race case) for consistency — the builder confirms this by reading the merged file
  first, not by guessing.

## Lead answers (27 Oct 2026)

- **Q1 (rate limit): no, not in this task, and no follow-up task.** Approve and reject are teacher-only, signed in, same-origin and bounded by the 100-row proposal cap. The lead logs this as a wontfix at merge. Skip Phase B.
- **Q2 (styleCardRoutes.ts hardcoded 60): yes, include it.** It is the same one-line import as fix 5, and keeping the two routes on one constant is cheaper than a separate task. styleCardRoutes.ts moves into Files and out of "Files out of bounds".
- **Q3 (refused approve shape): throw `RepositoryError('limit', method)`, not the no-op.** The board title says "raises limit". The client treats `{approved: false, card: null}` as success and drops the tag from the list, which would silently hide a refusal. A `limit` maps to 409 `limit_reached`, which StyleCardView already shows, and the proposal stays `pending`. Test this through the route as well as the repository.
- The 6.3a code is on main once PR #392 merges; this task's branch is cut after that merge, so read mistake-proposals.ts and mistakeProposalRoutes.ts from your worktree.

## Decisions (draft for the handoff)

### `risk: high` — a `packages/db/src/repositories/**` fix, reviewed by security-reviewer
Decided: ship the four `mistake-proposals.ts` fixes logged `risk: high`, reviewed by
security-reviewer (required) and code-reviewer/typescript-reviewer (default); database-reviewer
recommended given the new advisory-lock and role-check additions.
Why: same risk-paths.txt rule and precedent 6.3a itself logged for the same file.
risk: high

### The optional rate limit is deferred to a follow-up task (Q1)
Decided: this task ships only the five required fixes in one phase.
Why: keeps the budget and the reviewed diff small; the rate limit is explicitly a "consider", not
part of the accept line.
risk: low

## Budget

Budget: 50 tool calls (1 phase, packages/db and apps/web)

## Allowed tools

Read, Grep, Glob, Edit, Write, Bash (typecheck/lint/test, `docker compose ... up -d postgres` only;
no network, no payment or model calls).

## Exit conditions

- Status: DONE once the four new `mistake-proposals.int.test.ts` cases and the route test are
  green, `mistakeProposalRoutes.test.ts` is confirmed unaffected or extended, both gate commands
  above are green, `git diff origin/main -- packages/contracts` stays empty, and the handoff logs
  the `risk: high` decision.
- Status: PARTIAL past ~50 tool calls, if PR #392 has not yet merged to `main` when the builder
  starts (pull fresh after it merges rather than racing it, same as 6.3a's own Q0), or if the real
  code on `main` does not match this plan's guesses at variable/method shapes closely enough to
  apply the fixes as designed (flag which assumption broke, rather than redesigning solo).
