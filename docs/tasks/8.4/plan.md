# Plan: 8.4 Style interview (incl. common mistakes) and style card editor

## Acceptance (verbatim)
"the teacher can preview and edit the card; the agent uses the new version on the next turn."

## How it will be shown
- An integration test (packages/db) that: creates a teacher fixture, calls the new
  `styleCardsRepo.create` twice (version 1, version 2), points a fixture `agentVersions` row at
  version 2's id, and asserts `turnConfigStoreFor(...).load(...)` (already built, task 3.13/3.16)
  returns that card. This proves the save → next-turn path works through the existing read path;
  no harness or turn-route change is needed because `TurnConfigStore` already loads
  `repos.styleCards.get(scope, agent.styleCardId)` for whatever row is current.
- A route-level test (apps/web) that drafts via the scripted/dev gateway (no real model call,
  rule 4), edits the draft, saves it, and re-fetches it — proving "preview and edit" end to end
  through the new API.
- A component test (StyleCardView) that renders the 10-question interview, a free-text "common
  mistakes" box, 3 sample-explanation boxes, shows the drafted card editable, and saves it.

## Scope decision (read first — see Open questions)
8.4 is scoped to the **style card only**: new immutable `style_cards` versions, a studio API to
draft/edit/save them, and a studio page. It does **not** create a teacher's `agents` /
`agent_versions` row. No task before 8.4 creates that row (checked: `agentsRepo` has only `get`
and `owner`; `agentVersionsRepo` has only `get`; 8.1's handoff never touches it; 8.3a's courses
repo, needed for `AgentConfig.courseId`, is still in `review`, not on `main`, and isn't a listed
dependency of 8.4 either). Building a real `AgentConfig` now would mean inventing `courseId`
before an outline exists and guessing at defaults that 8.6 (package builder) and 8.7 (publish)
need to own together. Acceptance is met via the TurnConfigStore proof above; see Open questions.

## Files touched

### Phase A — backend (packages/db, apps/web API)
Create:
- `packages/db/test/style-cards.int.test.ts` — integration tests for `create`/`latest`, plus the
  "next version reaches the next turn" proof against `turnConfigStoreFor`.
- `packages/db/src/repositories/style-cards.test.ts` — unit tests (scope, input limits).
- `apps/web/src/studio/styleCardQuestions.ts` — the fixed ordered list of interview question
  *keys* (e.g. `tone`, `examples`, `strictness`, `warnings`, `phrasing`, `stuckStudent`,
  `howMuchToTell`, `favoritePhrase`, `pacing`, `wrapUp` — 10 keys; English-only pilot text lives in
  `messages/en.json`, not here).
- `apps/web/src/studio/styleCardRuntime.ts` — lazily-built backend: `repos.styleCards` from
  `serverDatabase()` (`../auth`, read-only import) and a `ModelGateway` built from
  `DEFAULT_MODEL_POLICY` (`@edmate/gateway`) plus `anthropicFactories` / `devFactories` /
  `devModelEnabled` (imported, read-only, from `../turn/runtime` and `../turn/devModel` — same dev
  fallback the student turn route already uses, so tests and local dev need no real key).
- `apps/web/src/studio/styleCardRuntime.test.ts`
- `apps/web/src/studio/styleCardRoutes.ts` — `StyleCardBackend` type + `createStyleCardHandlers`:
  `get` (`GET /api/studio/style-card`), `draft` (`POST /api/studio/style-card/draft`, calls
  `draftStyleCard` from `@edmate/ingest`, returns the draft unsaved), `save` (`PUT
  /api/studio/style-card`, validates with `StyleCardSchema.pick({ text: true, mistakeTags: true
  })`, calls `styleCards.create`).
- `apps/web/src/studio/styleCardRoutes.test.ts`
- `apps/web/app/api/studio/style-card/route.ts` — `GET`/`PUT`, `withRole(['teacher'], ...)`.
- `apps/web/app/api/studio/style-card/draft/route.ts` — `POST`, `withRole(['teacher'], ...)`.

Modify:
- `packages/db/src/repositories/style-cards.ts` — add `create(scope, draft: { text; mistakeTags
  })` (next version = `COALESCE(MAX(version),0)+1` for that teacher, in a transaction, unique
  index `style_cards_teacher_id_version_key` as the race backstop) and `latest(scope)`.
- `packages/db/test/repositories.int.test.ts` — isolation `CASES` for the two new methods
  (required: `RepositoryMethod` is a union over every repo method). **Shared file**: 8.1/8.2/8.3a
  all added rows here; expect a small merge/rebase, not a real conflict (each task appends its own
  rows).
- `apps/web/src/studio/index.ts` — export `styleCardHandlers` alongside the existing
  `studioHandlers` (one new line + one new import). **Shared file**, same low-risk append pattern;
  8.3b will likely add its own `outlineHandlers` export here too.
- `packages/db/src/repositories/index.ts` — re-export any new type (`StyleCardDraftInput` if one
  is introduced) next to the existing `styleCards` export line.

No migration: `style_cards` already has every column needed (`id`, `teacher_id`, `version`,
`text`, `mistake_tags`, timestamps) and the unique `(teacher_id, version)` index.

### Phase B — frontend (apps/web teacher studio page)
Create:
- `apps/web/src/studio/styleCardClient.ts` — fetch wrappers (`getStyleCard`,
  `draftStyleCardApi`, `saveStyleCard`), mirrors `uploadClient.ts`'s `ApiResult<T>` shape.
- `apps/web/src/studio/styleCardClient.test.ts`
- `apps/web/app/teacher/style-card/page.tsx` — server component: `requireRole(['teacher'])`,
  reads the current card via `serverDatabase().repos.styleCards.latest(...)` for first paint,
  renders `AppShell` with its own local `nav` array (teacher / uploads / onboarding / style card —
  each page defines this array itself today; no shared nav component to edit) and
  `NextIntlClientProvider` scoped to the new `styleCard` message namespace.
- `apps/web/app/teacher/style-card/page.test.tsx`
- `apps/web/app/teacher/style-card/StyleCardView.tsx` — client component: the 10-question
  interview, a newline-separated "common mistakes" textarea (→ `mistakeCandidates: string[]`),
  3 sample-explanation textareas, "Generate draft" (→ `draftStyleCardApi`, fills an editable text
  box + editable tag chips), "Save" (→ `saveStyleCard`), and a direct edit path on the existing
  saved card (so a small fix doesn't require redoing the interview) — this is what satisfies
  "preview and edit the card".
- `apps/web/app/teacher/style-card/StyleCardView.test.tsx`
- `apps/web/app/teacher/style-card/style-card.css` — own scoped stylesheet (mirrors
  `uploads.css`).

Modify:
- `apps/web/messages/en.json` — new top-level `styleCard` namespace (question labels, the
  mistakes/sample-explanation field labels, draft/save buttons, error strings) and one new key on
  the existing `teacher` object (`styleCardLink`, next to `uploadsLink`/`onboardingLink`).
  **Shared file**: 8.3 is adding its own keys here at the same time; JSON key-append conflicts are
  easy merges (different keys), not a real collision — same pattern as uploads/onboarding already
  landing side by side.

Explicitly out of bounds (left to 8.3/8.3b): `apps/web/app/teacher/outline/**`,
`apps/web/app/api/studio/outline/**`, `apps/web/src/studio/outline*`, and any shared studio
layout/nav component — none exists today (each page builds its own `nav` array), and 8.4 does not
add one.

## Risky paths touched (.claude/skills/merge-gate/risk-paths.txt)
- `packages/db/src/repositories/style-cards.ts` → matches `packages/db/src/repositories/**` →
  **reviewers: security-reviewer**. (Test files under `packages/db/test/**` are not under that
  glob and are not separately risky.)
- No other match: no contracts, no ADR, no `.claude/**`/`.github/**`/`.githooks/**`, no
  `packages/harness/src/access/**` or `payments/**`, no `apps/web/src/auth/**` or
  `apps/web/app/api/webhooks/**` or `apps/web/app/api/auth/**`, no `packages/db/src/identity/**`,
  no `packages/gateway/src/keys/**`. The handoff logs one `risk: high` decision for the
  `style-cards.ts` change, reviewed by security-reviewer, same pattern as 8.1/8.2/8.3a.
- Prompt packs / persona templates / pedagogy (`content/prompt-packs/**`,
  `packages/content/src/promptPacks.ts`, `packages/content/src/personaTemplates.ts`,
  `packages/harness/src/pedagogy/**`): **not touched**. `draftStyleCard` and its
  `STYLE_CARD_SYSTEM` string already exist (task 5.11, `packages/ingest/src/styleCard/`) and are
  reused as-is.

## Tests first
1. `packages/db/src/repositories/style-cards.test.ts` — unit: `create` rejects another teacher's
   scope, over-limit text/tags (via `StyleCardSchema`); `latest` returns null for a teacher with
   no cards.
2. `packages/db/test/style-cards.int.test.ts` — int: sequential `create` calls bump version
   1, 2, 3 for one teacher and don't collide with another teacher's version numbers; a concurrent
   double-create under the same teacher yields versions 1 and 2, never two rows at version 1; the
   TurnConfigStore proof above.
3. `apps/web/src/studio/styleCardRoutes.test.ts` — over the scripted/dev gateway: draft doesn't
   write anything (`styleCards.create` is never called); save writes and returns the new version;
   a too-long interview payload or a >300-word edited card is `validation`.
4. `apps/web/app/teacher/style-card/StyleCardView.test.tsx` — interview → draft → edit → save
   happy path; the "edit the current card directly" path with no interview.

## Risks & mitigations
- **Risk**: the version-bump transaction races under concurrent saves. **Mitigation**: `SELECT
  ... FOR UPDATE` scoped to the teacher's existing rows inside the write transaction, with the
  unique index as the backstop (same shape as `packageVersions.create`).
- **Risk**: `draftStyleCard`'s `mistakeTags` must never include a tag outside what the teacher
  typed. Already enforced inside `draftStyleCard` (task 5.11); the save step does not re-derive
  tags, it stores whatever the teacher's edited form sends, so no new enforcement is needed here.
- **Risk**: a shared-file edit (`repositories.int.test.ts`, `studio/index.ts`, `messages/en.json`)
  lands at the same time as 8.1/8.3/8.3b. **Mitigation**: each touch is an append (new rows/keys),
  not an edit of someone else's lines; call this out to the lead so merges are sequenced with a
  quick rebase rather than treated as a conflict to resolve blind.

## Open questions (with recommendation)
1. **Does 8.4 need to create the teacher's first `agents`/`agent_versions` row, so a real
   AgentConfig picks up the new style card?** Recommendation: no — defer to 8.6 (package builder),
   which already needs to create the `agents` row to attach a package's `agentId`, and by then
   8.3's course/outline will exist for `courseId`. 8.4 proves the mechanism (TurnConfigStore
   proof) without guessing at `courseId`/`modelPolicy`/`promptPackVersion` defaults that aren't
   8.4's to decide. Flagging for the lead to confirm before the build starts; non-blocking.
2. **Where do the 10 interview questions live?** Recommendation: as i18n copy in
   `messages/en.json` under `styleCard`, keyed by the fixed slugs in `styleCardQuestions.ts` —
   consistent with every other studio page (no hardcoded English in `.ts` files).

## Budget
Budget: 270 tool calls (2 phases, packages/db + apps/web)

## Allowed tools
Read, Grep, Glob, Edit, Write, Bash (typecheck/lint/test for @edmate/db and @edmate/web, and the
secret scan only)

## Exit conditions
Phase A `Status: DONE` when: `styleCardsRepo.create`/`latest` pass unit + int tests including the
TurnConfigStore proof, the three new API routes pass their tests, `corepack pnpm turbo run
typecheck lint test --filter=@edmate/db... --filter=@edmate/web...` is green, and the secret scan
is clean. Phase B `Status: DONE` when the studio page's interview → draft → edit → save flow is
covered by component tests and the same commands are green. Either phase stops at `Status:
PARTIAL` past ~150 tool calls for that phase, or if it turns out `apps/web/app/teacher/**` already
has a shared layout/nav file on `main` by the time Phase B starts (then stop and ask the lead
how to extend it rather than guessing).

## Lead answers (22 Oct 2026)
- Q1: agreed. 8.4 does not create the `agents`/`agent_versions` row. 8.6 (package builder) creates it, with the course id from 8.3. The TurnConfigStore integration test is the acceptance proof.
- Q2: agreed. Question copy goes in `messages/en.json` under `styleCard`.
- Ordering: 8.4 shares `packages/db/src/repositories/index.ts`, `packages/db/test/repositories.int.test.ts`, `apps/web/src/studio/index.ts` and `apps/web/messages/en.json` with 8.3b. Under the no-shared-files rule, the two builds don't run at the same time.
