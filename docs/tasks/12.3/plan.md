# Task 12.3: Rights declaration per upload, repeat-infringer handling, grievance contact per market

## Acceptance (verbatim)
> a declaration is stored per document; the page is public.

## How it will be shown
A teacher cannot finish uploading or replacing a file in the upload centre without first checking
"I confirm I hold the rights to upload this material" (exact copy is the builder's to write; it is
product copy, not a jurisdiction-specific legal fact, so no human sign-off gate blocks it — unlike
the grievance contact below). The studio API refuses `create`/`replace` with no `rightsDeclared:
true` in the body, and on success writes `documents.rights_declared_at = now()` (the column already
exists, unused since task 8.2). A new public page, reachable with no sign-in, shows: the rights
policy text (one global file under `content/legal/rights-declaration/`, mirroring task 1.7's
privacy-notice pattern), the US grievance contact from the `US` locale pack's existing
`compliance.grievance` field (falls back to the `global` pack via the existing `pickLocalePack`,
and then to a neutral message when that field is still `pending` — exact wording is Open question
1), and a one-line note that repeated upheld takedowns can end a teacher's account (no numbers or
thresholds named — Open question 2). Repeat-infringer handling in this task is exactly one read
method, `takedownsRepo.countUpheld(scope, teacherId)`: it has no caller yet and triggers no
suspension (same "count only, no enforcement" precedent as 4.4's jailbreak strikes, B-12 still
open). Shown via: `packages/content` tests against the real file (mirrors `realPrivacyNotices.
test.ts`), `packages/db` integration tests (declaration timestamp set on create and on replace;
`countUpheld` against seeded takedown rows), `apps/web` route/page tests including jest-axe on the
public page, and a manual note in the handoff (open the public page signed out, confirm no
sign-in prompt).

## Context already in place (read, not rebuilt)
- `packages/db/src/schema/content.ts`: `documents.rightsDeclaredAt` (nullable `tstz`) has existed
  since migration 0001/0017; **no migration needed**. `packages/db/src/repositories/map.ts`'s
  comment ("`rightsDeclaredAt` is not returned yet") is the thing this task fixes.
- `packages/db/src/schema/operations.ts`: `takedowns` (and `reports`, `safety_events`) already
  exist via `trustColumns()` (`target`, `reason`, `status` default `'open'`, `staffActions`),
  migrated in 0001. **No migration needed** for repeat-infringer counting either.
- `packages/content/src/privacyNotices.ts` + `content/legal/privacy-notice/{global,US,IN}.md`
  (task 1.7): the exact pattern this task's Phase A copies for the rights-declaration text —
  front matter `version`/`reviewedBy`/`reviewedOn`, born `reviewedBy: pending` and
  `[PLACEHOLDER]`-marked, `edmate content validate` has no wiring for it (see Decisions) but a
  dedicated test file reads the real directory directly, same as `realPrivacyNotices.test.ts`.
- `packages/content/src/localePacks.ts`/`localeLoader.ts`: `compliance.grievance` already exists
  on every locale pack, already documented as "`pending` until a person supplies it" and "never
  filled in by an agent" (`.claude/skills/locale-context/SKILL.md`). This task reads it; it does
  not add or change the field.
- `packages/db/src/repositories/safety-events.ts` (task 4.4): the pattern for a `trustColumns`
  table read scoped through a join (`target = 'session:' || sessions.id`) and its comment "a
  jailbreak row is a strike; 12.x reads the count (no consequence yet, open question B-12)" is
  exactly this task's repeat-infringer precedent.
- `apps/web/app/teachers/page.tsx` (task 9.2): the precedent for a public, anonymous
  server-rendered page (no `requireRole`, no client fetch).
- `apps/web/src/turn/runtime.ts`'s exported `contentDir(env)`: the one existing helper for
  resolving `EDMATE_CONTENT_DIR`; Phase C imports it read-only rather than duplicating it (unlike
  8.2's duplicated S3 config, this is a single one-line env helper with no behaviour to diverge).
- `apps/web/src/studio/routes.ts`: `NewFileSchema` (`contentType`, `byteSize`) is `.extend()`-ed by
  both `CreateSchema` and the replace handler's schema — adding `rightsDeclared` to `NewFileSchema`
  itself covers both routes in one change.

## Phases
Three phases, one package each.

### Phase A — packages/content: the rights-declaration text (~45 tool calls)
Files to create:
- `content/legal/rights-declaration/global.md`: front matter `version: draft-0`, `reviewedBy:
  pending`, `reviewedOn` (today), body marked `[PLACEHOLDER]`, mirroring
  `content/legal/privacy-notice/global.md`'s wording almost verbatim (same "not legal text" /
  "must not be shown to learners" warning). **One file, not per-market** (see Decisions) — the
  declaration a teacher signs does not vary by market; only the grievance contact (already a
  locale-pack field) does.
- `packages/content/src/rightsDeclaration.ts` (+ test): `RightsDeclarationFrontMatterSchema`,
  `parseRightsDeclaration(text)`, `readRightsDeclaration(path)` (one file, not a directory
  scan — no `isXDir`/`readXDir` pair needed), `rightsDeclarationSigned(doc)`. Copies
  `privacyNotices.ts`'s front-matter regex and placeholder-marker logic; does not import from or
  modify `privacyNotices.ts`.
- `packages/content/src/index.ts`: export the new names (append to the existing export list; this
  file is not a shared-file conflict risk per the current board, but keep the diff to one added
  line per export, same style as the file's existing blocks).
- `packages/content/src/realRightsDeclaration.test.ts` (new, mirrors `realPrivacyNotices.test.ts`
  if that file exists under a similar name, else mirrors `realLocales.test.ts`'s "read straight
  from the committed file" style): reads the real `content/legal/rights-declaration/global.md`,
  asserts it parses, and asserts it is **not yet signed** (`reviewedBy: pending`,
  `[PLACEHOLDER]` present) — same "pending is committed on purpose, tracked by a failing
  assertion that flips once signed" pattern as `realLocales.test.ts`'s US-pack comment.

Files explicitly out of bounds: `packages/content/src/validate.ts` (the `isPrivacyNoticesDir`/
`isLocalePacksDir` dispatcher) — not touched. There is no `edmate content validate` wiring for the
new file in this task (see Decisions); `privacyNotices.ts` itself is not edited.

### Phase B — packages/db: store and read the declaration; count upheld takedowns (~70 tool calls)
Depends on: nothing from Phase A (different package); can run in parallel with it.
Files to modify:
- `packages/db/src/repositories/chunks.ts`: `DocumentInputSchema` gains
  `rightsDeclared: z.literal(true)`; `documents.create`'s INSERT adds
  `[documents.rightsDeclaredAt, sql\`now()\`]`. `ReplaceInputSchema` gains the same
  `rightsDeclared: z.literal(true)`; `documents.startReplace`'s UPDATE sets
  `rightsDeclaredAt = now()` alongside the existing reset. A missing or `false` value is
  `invalid` (Zod), before any SQL — same place the existing strict-object checks already sit.
- `packages/db/src/repositories/map.ts`: `DocumentRowSchema` and `toDocumentRow` add
  `rightsDeclaredAt: z.iso.datetime().optional()`, read the same way `failureReason` already is
  (`row.rightsDeclaredAt ? iso(row.rightsDeclaredAt) : undefined` or equivalent — follow the
  existing optional-field style in this file exactly). Update the stale comment ("`rightsDeclaredAt`
  is not returned yet") to say it now is.
- `packages/db/src/repositories/takedowns.ts` (new): `takedownsRepo(db)` with one method,
  `countUpheld(scope: TeacherScope, teacherId?: string): Promise<number>` — **name the seam for
  12.2**: counts rows where `takedowns.status = 'upheld'` and either `target = 'teacher:' ||
  teacherId` or (`target = 'document:' || documents.id` via a join) `documents.teacherId =
  teacherId`, following `safety-events.ts`'s `onSession`-style join precedent. This task is the
  first file to touch the `takedowns` table; 12.2 (planned in parallel, not yet merged) adds the
  write side (`create`/`resolve`) to this same file. **The exact literal `'upheld'` and the
  `teacher:<id>` / `document:<id>` target formats are this task's proposal, not yet agreed with
  12.2's plan** — flagged as Open question 3, not a blocker: if 12.2 lands with different literals,
  whichever plan merges second adjusts its read or write side to match (the method signature itself,
  `countUpheld`, is the stable part of the seam).
- `packages/db/src/repositories/index.ts` (**shared file, append-only**): one new export line for
  `takedownsRepo`, alongside wherever repos are assembled into the top-level `Repositories` object
  — read the existing assembly first and add one line in the same style; do not reorder or touch
  any other repo's export.
- Tests (tests first, per `tdd-workflow`): `packages/db/test/documents.int.test.ts` — create with
  `rightsDeclared: true` sets `rightsDeclaredAt`; create with `false` or missing is `invalid`,
  nothing written; replace sets a fresh `rightsDeclaredAt`, independent of the original create's
  timestamp; `packages/db/test/repositories.int.test.ts` (**shared file, append-only**: add new
  `CASES` entries for `documents.create`/`startReplace` only if the isolation grid doesn't already
  cover them with the new required field — check first, since the grid already has
  `documents.startReplace 6`; most likely only the input schema in the existing cases needs
  `rightsDeclared: true` added, not new grid rows). New `packages/db/test/takedowns.int.test.ts`:
  seeded takedown rows (`upheld` on this teacher's own document, `upheld` on another teacher's,
  `open` on this teacher's) — `countUpheld` returns exactly the first; a teacher with zero rows
  returns `0`, not an error.

### Phase C — apps/web: require the declaration; the public page (~75 tool calls)
Depends on: Phase B's `rightsDeclared` input and exposed `rightsDeclaredAt` field; Phase A's
`readRightsDeclaration`. Build order: Phase B and Phase A can run in parallel; Phase C starts
after both merge.
Files to modify:
- `apps/web/src/studio/routes.ts`: `NewFileSchema` gains `rightsDeclared: z.literal(true)` (covers
  both `create` and `replace`, which both extend it); `create`'s and `replace`'s calls into
  `b.documents.create`/`startReplace` pass `rightsDeclared: body.rightsDeclared` through
  unchanged (the repo does the real check). A `false` or missing value is the existing `validation`
  (400) response, same as a bad `contentType` today — add one test case per route.
- `apps/web/src/studio/uploadClient.ts`: the create/replace request body gains `rightsDeclared:
  true`, sent only once the UI checkbox is checked (see below) — the client never sends `false`;
  an unchecked box simply disables the control, mirroring the existing "no upload control without
  a module" pattern.
- `app/teacher/uploads/UploadsView.tsx` (+ test): a required checkbox above the file picker and
  above the replace picker, with its own label text (new `messages/en.json` key under the
  existing `uploads` namespace — **shared file, append-only**: add keys only, do not touch
  `teacher`/`staff`/other namespaces); unchecked disables Upload/Replace, matching the existing
  "no upload control without a module" test style. jest-axe case added alongside the existing one.
- `content/legal/rights-declaration/global.md` reaches the public page via a new, small
  server-only read in Phase C's page file — **not** a new runtime/backend module: the page calls
  `readRightsDeclaration` (Phase A) with a path built from `contentDir(env)` (imported read-only
  from `apps/web/src/turn/runtime.ts`) directly in the page component, no new `src/legal/` runtime
  file needed unless the page component grows past what's comfortable inline (builder's call;
  if split out, name it `apps/web/src/legal/page-data.ts` and keep it a thin passthrough with no
  new state).
- `apps/web/app/legal/rights/page.tsx` (+ test, + jest-axe): public (no `requireRole`, no client
  fetch, same shell as `app/teachers/page.tsx`), `export const dynamic = 'force-dynamic'`. Reads
  the rights-declaration file and the `US` locale pack (`pickLocalePack('US', packs)` — the pilot
  is US-only, so no per-visitor locale detection is needed, unlike `/teachers`' `lang` query param
  which is a *teaching-language* filter, not a market). Shows: the declaration body text; the
  grievance contact if `compliance.grievance` is not `pending`/blank, else the neutral fallback
  (Open question 1); the repeat-infringer note (Open question 2). A link from the public footer or
  nav (`publicNav`/`AppShell`, read-only reuse) — exact placement is the builder's call; it must be
  reachable without sign-in from at least one already-public page (`/`, `/teachers`).
- `apps/web/messages/en.json` (**shared file, append-only**): new top-level `legal` key block,
  plus the new `uploads.*` checkbox keys mentioned above — two small additions, no reordering, no
  edits to any existing key.
- `src/chat/no-raw-html.test.ts` (if it globs page files) picks up `app/legal/**` automatically;
  confirm, don't add a new scan.

Files explicitly out of bounds: `apps/web/src/auth/**`, `apps/web/src/auth/policy.ts` (no new
`/api/**` route — the public page is a plain server component, not an API route, so
`ROUTE_POLICY` doesn't apply and isn't touched), `.claude/skills/merge-gate/risk-paths.txt` (no
new glob needed — see Risky paths below).

## Tests first
Every phase: write the failing test (schema rejection, timestamp set, `countUpheld` count,
checkbox disabling the button, public page rendering the fallback) before the implementation.

## Risky paths touched (checked against `.claude/skills/merge-gate/risk-paths.txt`)
- `content/legal/**` (Phase A: the new `rights-declaration/global.md`) — in the student-safety
  group — reviewers: **code-reviewer** (the group's current MVP-reduced requirement; still logged
  `risk: high` per the group's own note). Same group 1.7 already put `content/legal/**` in.
- `packages/db/src/repositories/**` (Phase B: `chunks.ts`, `map.ts`, new `takedowns.ts`,
  `index.ts`) — reviewers: **security-reviewer**.
- Not touched: `packages/contracts/**`, `docs/adr/**`, `apps/web/src/auth/**`,
  `apps/web/app/api/staff/**`, `.claude/**`, `.github/**`, `.githooks/**`,
  `packages/harness/**`, `content/prompt-packs/**`, `content/skills/**`, `content/locales/**`
  (read, not written), `evals/suites/**`.
- No migration in any phase (both `documents.rights_declared_at` and `takedowns` predate this
  task) — **database-reviewer is not required by the migration rule**; the plan still asks
  security-reviewer to look at the new `takedowns.ts` read (risky path above covers that).
- A `risk: high` decision entry is planned for the handoff (content/legal addition +
  packages/db/src/repositories change), per the two groups above.

## Open questions (none block the build; each has a recommendation)
1. **Exact neutral-fallback wording when `compliance.grievance` is still `pending`.** Per the hard
   rule, no agent fills in a grievance contact, email, address, law or reviewer name,
   so this plan cannot write the fallback copy itself beyond a placeholder like "A grievance
   contact for this market has not yet been published." **Recommendation:** ship that placeholder
   now (it names no fact, just the gap) and let the human adjust the wording, or supply a real
   interim contact to put in the `US` pack's `compliance.grievance` field, before the pilot gate.
2. **What "repeat-infringer handling" does once a teacher has N upheld takedowns.** This task
   builds the count only (no threshold, no automatic unpublish/ban), matching the existing
   "strikes are a count only" precedent for jailbreaks (B-12, still open). **Recommendation:**
   leave enforcement to a later M13 task once 12.2 is live and a real number of upheld takedowns
   exists to calibrate against; don't invent a threshold now.
3. **The `takedowns.status = 'upheld'` literal and `teacher:<id>`/`document:<id>` target format**
   are this task's proposal for 12.2 to either match or for 12.3's `countUpheld` to be adjusted
   once 12.2 merges, since 12.2 (the task that will actually write takedown rows) is only
   "planned in parallel," not merged yet. **Recommendation:** whichever of 12.2/12.3 merges second
   reconciles the literal; this plan's Phase B ships a passing test suite against its own seeded
   rows either way, so it is not blocked by 12.2's build order.
4. **Whether the rights-declaration checkbox text needs the same human sign-off gate as the
   privacy notice and locale-pack compliance text.** This plan's view: no — the hard rule singles
   out grievance contacts, emails, addresses, laws and reviewer names, not the generic "I own the
   rights to this material" attestation, which is product copy. **Recommendation:** proceed with
   builder-written copy for the checkbox label; keep the longer `content/legal/rights-declaration/
   global.md` body `[PLACEHOLDER]`-gated like the privacy notice, since that file states the
   platform's actual takedown/repeat-infringer policy, which is closer to the privacy-notice
   precedent than to a UI label.

## Budget
Budget: 190 tool calls (3 phases: packages/content, packages/db, apps/web)

## Allowed tools
Read, Grep, Glob, Edit, Write, Bash (pnpm typecheck/lint/test for the touched package(s) only,
and the secret scan)

## Exit conditions
`Status: DONE` when all three phases are green (typecheck, lint, test for `@edmate/content`,
`@edmate/db` and `apps/web`), the manual public-page check is recorded in the handoff, and the
`risk: high` decision is logged for both risky-path groups above. `Status: PARTIAL` past ~60-65
tool calls in a phase with no green tests yet, or if a file outside this plan's list turns out to
need changes (for example if `validateContentDir` must be touched after all, or if 12.2's actual
takedown shape turns out incompatible with Phase B's join) — stop and hand back with the mismatch
named, rather than widening scope or guessing 12.2's design.

## Lead answers (22 Oct 2026)
- Phases run as board tasks 12.3a (packages/content), 12.3b (packages/db) and 12.3c (apps/web). Each phase has its own handoff in `docs/tasks/<phase id>/`.
- **The takedowns seam follows 12.2, which owns `packages/db/src/repositories/takedowns.ts`** (12.2b builds it). 12.3b therefore depends on 12.2b and adds `countUpheld` to 12.2's file instead of creating it. 12.2's literals win: `status` is `active` | `lifted`; targets are `document:<id>` and `agent:<id>`; `reason` is one of 12.2's `REPORT_CATEGORIES`. For the pilot, `countUpheld(scope)` counts the teacher's **active** takedowns with reason `copyright` on that teacher's own documents or agents (a lifted takedown was reversed and does not count). There is no `teacher:<id>` target and no `upheld` status.
- Q1: the public page ships the neutral placeholder that names no fact while `compliance.grievance` is pending; agents never write the grievance contact. The human fills the US pack (already tracked with the 1.7 locale sign-off).
- Q2: count only, no threshold or enforcement in 12.3; enforcement is follow-up 12.3d (M13), next to B-12's strike policy.
- Q3: answered above.
- Q4: accepted. The checkbox copy is product copy the builder writes; the longer rights-declaration text is born pending with a placeholder and needs the human's sign-off like the privacy notice.
- Reviewers: code-reviewer for 12.3a (content/legal); security-reviewer for 12.3b; typescript-reviewer and code-reviewer on every phase; each risky phase logs a `risk: high` decision.
