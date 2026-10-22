# Handoff: 8.4a Style card repo and studio API (Phase A of docs/tasks/8.4/plan.md)

Status: DONE

- Branch: `m8/8.4a-style-card-api` (built on local branch `work-84a`)
- Worktree: `.claude/worktrees/agent-a9442f7743852adb9`
- Tool calls used: 81 (harness count; the builder's own count was 52)

## What changed
- `packages/db/src/repositories/style-cards.ts` (risky path): new `create(scope, { text, mistakeTags })`
  and `latest(scope)`. `create` checks the scope is a teacher right now (share-locked role, like
  `teacherProfiles.create`), takes a per-teacher transaction advisory lock, then inserts version
  `max + 1` (starts at 1). The unique `(teacher_id, version)` index stays the backstop. Every query is
  filtered by the scope's teacher id. New `STYLE_CARD_LIMITS` (4000 chars, 20 tags, 60 chars a tag)
  on top of the contract's 300-word limit; tags are trimmed and de-duplicated. A client-set `id`,
  `teacherId` or `version` is `invalid` (strict object).
- `packages/db/src/repositories/index.ts`: exports `STYLE_CARD_LIMITS` and `StyleCardDraftInput`.
- `packages/db/test/repositories.int.test.ts`: isolation cases for `styleCards.latest` (read) and
  `styleCards.create` (write, with mismatches).
- `packages/db/test/style-cards.test.ts` (unit, no DB) and `packages/db/test/style-cards.int.test.ts`
  (Postgres: versions 1, 2, 3; independent per teacher; 6 concurrent creates give 1 to 6; scope
  checks; and the acceptance proof through `turnConfigStoreFor`).
- `apps/web/src/studio/styleCardQuestions.ts`: the 10 question keys in order, a model-facing topic
  per key, interview caps.
- `apps/web/src/studio/styleCardRoutes.ts` (+ test): `createStyleCardHandlers` with `get`, `draft`,
  `save`. Draft calls `draftStyleCard` from `@edmate/ingest` and writes nothing. Save validates with
  `StyleCardSchema.pick({ text, mistakeTags })` and calls `styleCards.create`.
- `apps/web/src/studio/styleCardRuntime.ts` (+ test): lazily built drafter gateway
  (`createRouter(DEFAULT_MODEL_POLICY, anthropicFactories)`), or a fixed dev draft when
  `EDMATE_DEV_MODEL=scripted` on a local stack. A failure is logged once by reason code.
- `apps/web/app/api/studio/style-card/route.ts` (`GET`, `PUT`) and
  `apps/web/app/api/studio/style-card/draft/route.ts` (`POST`), both `withRole(['teacher'])`.
- `apps/web/src/studio/index.ts`: exports `styleCardHandlers`.
- `apps/web/package.json` + `pnpm-lock.yaml`: `@edmate/ingest` added as a workspace dependency.

## Evidence
- `TEST_DATABASE_URL=postgres://edmate:edmate-dev@127.0.0.1:55484/edmate corepack pnpm turbo run typecheck lint test --filter=@edmate/db... --filter=@edmate/web...`
  → `Tasks: 34 successful, 34 total` (db int tests ran against the `edmate84a` Postgres:
  `Test Files 56 passed (56)`, `Tests 947 passed | 4 skipped`; repository coverage thresholds met).
- `vitest run test/style-cards.test.ts test/style-cards.int.test.ts` → `Tests 33 passed (33)`.
- `vitest run test/repositories.int.test.ts` → `Tests 96 passed (96)` (includes the two new cases).
- `vitest run src/studio` (web) → `Tests 122 passed (122)`.
- `corepack pnpm turbo run build --filter=@edmate/web` → `Tasks: 8 successful, 8 total`
  (`next build` bundles the new routes with `@edmate/ingest`).
- `python3 .githooks/secret-scan.py --all` → clean (see commit).

## Deviations from the plan
- The db unit test lives at `packages/db/test/style-cards.test.ts`, not
  `packages/db/src/repositories/style-cards.test.ts`: the db vitest config only includes
  `test/**/*.test.ts`, so a test under `src/` would never run.
- The version race uses a transaction advisory lock, not `SELECT ... FOR UPDATE` on the teacher's
  rows: a teacher with no cards has no rows to lock, so two first saves would both pick version 1.
- `@edmate/ingest` was not a dependency of `apps/web`; added it (workspace only, no new external
  package).

## Decisions
### 22 Oct 2026 · 8.4a Lead accepts the style-card repo scope checks and the unmetered drafting · decided by lead · risk: high
- Decided: merge 8.4a. styleCards.create (risky path packages/db/src/repositories/**) is reviewed by security-reviewer, database-reviewer, code-reviewer and typescript-reviewer, all APPROVE: every query is filtered by the session teacher, students and staff are refused, and the per-teacher advisory lock closes the version race. Drafting stays unmetered for now; metering teacher studio calls and stripping override phrases from style-card text are follow-up task 8.4c (M13).
- Why: four reviewers found no CRITICAL, HIGH or MEDIUM issue; a teacher's style card only reaches that teacher's own students, and studio drafting is a small, teacher-only cost until the pilot.
- risk: high

### 22 Oct 2026 · 8.4a styleCards.create versions and scope checks · decided by builder · risk: high
- Decided: `styleCards.create` (risky path `packages/db/src/repositories/**`) requires the scope to
  be a teacher right now (share-locked role read: unknown user `not_found`, student or staff
  `scope`), serialises one teacher's saves with `pg_advisory_xact_lock(8401, hashtext(teacherId))`
  and inserts `max(version) + 1`; every read and write is filtered by the scope's teacher id.
  Reviewer: security-reviewer.
- Why: row locks can't guard a teacher's first card (no rows yet); the two-key advisory form never
  meets `migrate.ts`'s single-key lock, and a hash collision only serialises two teachers' saves.
- risk: high

### 22 Oct 2026 · 8.4a Extra caps on a saved style card · decided by builder · risk: low
- Decided: on top of the contract's 300 words, a saved card is at most 4000 characters with at
  most 20 tags of 1 to 60 characters; tags are trimmed and de-duplicated; empty text is refused.
  The interview is capped at 800 characters an answer and 3 samples of 1500 characters.
- Why: the card goes into every turn's prompt, and the contract alone allows one huge word or an
  unbounded tag list; the interview caps keep a full interview under the 16 KB body cap.
- risk: low

### 22 Oct 2026 · 8.4a Model-facing question topics live in code · decided by builder · risk: low
- Decided: `styleCardQuestions.ts` holds one short English topic per question key, sent to the
  drafter model as each answer's `question`. The teacher-facing question copy still goes in
  `messages/en.json` (Phase B), as the lead answered for Q2.
- Why: the drafter needs to know what an answer is about whatever the teacher's UI locale; the
  key alone (for example `howMuchToTell`) is a poor prompt.
- risk: low

### 22 Oct 2026 · 8.4a Drafting is not metered yet · decided by builder · risk: medium
- Decided: the draft call goes through the router without the usage meter, and a failure is
  logged by code (`studio.style_card_draft_failed`). The dev model returns a fixed draft with no
  tags when `EDMATE_DEV_MODEL=scripted` on a local stack.
- Why: the usage ledger has no teacher-side studio scope today (ingest's drafting is unmetered
  too). Metering teacher studio calls should be its own task; flagging for the lead.
- risk: medium

### 22 Oct 2026 · 8.4a Draft failures map to 502/503 · decided by builder · risk: low
- Decided: a model failure or a draft with a tag outside the teacher's list is `502
  provider_error` (retryable); no gateway (for example no provider key) is `503 provider_error`.
- Why: neither is the teacher's input error, so `validation` (400) would mislead the page.
- risk: low

## Phase B: next
Phase B (the studio page: `styleCardClient.ts`, `app/teacher/style-card/**`, the `styleCard`
namespace and `teacher.styleCardLink` in `messages/en.json`) is not started. The API it calls:
`GET /api/studio/style-card` → `{ card }`, `POST /api/studio/style-card/draft` with
`{ answers: { <questionKey>: string }, sampleExplanations: string[], mistakeCandidates: string[] }`
→ `{ draft: { text, mistakeTags } }`, `PUT /api/studio/style-card` with `{ text, mistakeTags }` →
`201 { card }`. Question keys and caps come from `apps/web/src/studio/styleCardQuestions.ts`.
