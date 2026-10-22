# Plan: 9.6 — Progress, plan changes (upgrade, downgrade, pause, cancel) and export; no payment until M10

Planner: planner (22 Oct 2026). Status: READY on the recommended answers below. Q1 changes PRD S8's
"cancellation at period end" for the free-to-try period, so the lead (or the human) answers it before
Phase C starts. Phases A and B do not depend on any question except Q2-Q4, which they need first.

## Context (read, not re-derived)
- Build plan 9.6: "Progress, plan changes (upgrade, downgrade, pause, cancel) and export; no payment
  until M10". The API surface lists `PATCH /api/subscriptions/:id` (upgrade, downgrade, pause,
  cancel) and `GET /api/me/progress`, `GET /api/me/export`. Payments § says "upgrade applies now;
  downgrade and cancel at period end; pause stops renewal and access". 10.3 owns the real state
  machine (trial, active, past_due, paused, ended, prorated upgrades).
- PRD S7: "Progress page: topics covered, skills mastered, next steps; updates after every check".
  PRD S8: "Upgrade, downgrade, pause, cancel; download notes and progress; upgrade applies at once;
  cancellation at period end; export is complete". Student journey 7: "On cancelling, access to the
  agent ends at the end of the paid period, and the student can download their notes and progress."
  PRD assumption: one package per teacher at a time, switched by upgrade or downgrade.
- Existing code (9.3, 9.4, 6.5 handoffs):
  - `subscriptions.findLive`, `subscriptions.start` (no payment, any version of the teacher's
    packages) and `subscriptions.pauseFreeForTeacher` (the cost alarm's pause, audited as
    `subscription.pause_cost_alarm`). The schema has no cancel-at-period-end or scheduled-package
    column. `entitle` refuses `paused` and `ended` (`packages/harness/src/access/entitlement.ts`).
    Nothing reads `period_end` yet (cosmetic until M10).
  - A package or version change ends a session pinned to the old one (3.16). `loadChat` ignores a
    `?s=` that is not an open session, so a fresh `/learn/[agentId]` starts a new session on the
    new package.
  - `packageVersions.liveForAgent` returns `{ packageVersionId, offer }` (the public offer only).
  - 6.5's `GET /api/me/memory/:agentId` exports the learner profile and evidence (capped at
    `EVIDENCE_LIST_MAX` = 10,000 with a `truncated` flag); `/learn/[agentId]/memory` shows it.
  - `ROUTE_POLICY` already has `PATCH /api/subscriptions/*` (student, clearance `age`) and
    `GET /api/me/**` (student, clearance `age`). **No `apps/web/src/auth/**` edit is needed.** A
    student waiting on a parent's consent can still pause, cancel and export (6.5's precedent).
  - There is no student-scope list of sessions, and `messages.history` returns at most 200
    messages per session, so a complete export needs new paged readers.
- 9.3b follow-ups that name 9.6: "subscriptions.start accepts only the live package version
  (9.6/10.8)" and "paused subscriptions get their own text on the compare page (9.6)". This plan
  takes both (Q5); the lead trims 9.3b's title when 9.6 merges.
- No PDF writer in the repo. `pdfjs-dist` (in `@edmate/ingest`) only reads PDFs. `apps/web`
  already depends on `@edmate/ingest`, which exports `parsePdf`, so tests can read a generated PDF
  back with no new dependency.

## Acceptance (verbatim)
> export is complete JSON plus notes PDF.

### How it will be shown (Phase B's handoff carries the evidence; Phase D adds the plan-change table)
1. **Complete JSON:** `src/export/buildExport.test.ts` seeds a memory backend for one pair with
   3 sessions and 1,203 messages (more than two 500-row pages, with created_at ties across a page
   boundary), 2 sessions of a second student and a second teacher (must not appear), evidence,
   questions (answered and open) and a profile. It asserts that every own session, message,
   evidence event and question appears exactly once, in order, that none of the others appear,
   and that `counts` matches each array's length. A truncated source (evidence `truncated: true`,
   or 200 questions returned) sets `complete: false` and names the section. It never comes back
   silently complete. `help_state` is never read (the backend has no such field) and no key named
   `helpState`, `mustNotReveal` or `answerKey` appears in the serialised JSON.
2. **Notes PDF:** `src/export/pdf.test.ts` (node environment) builds a PDF from a fixture and reads
   it back with `@edmate/ingest`'s `parsePdf`. Every topic title, session summary, teacher answer
   and next step appears in the extracted text. The header is `%PDF-1.4`, the `xref` offsets point
   at each `n 0 obj`, and the file ends `%%EOF`. A text holding `) Tj ET BT (` comes back as
   literal text (no PDF injection). Text that wraps past one page yields more than one page.
3. **Routes:** `src/export/routes.test.ts` checks the following. `GET /api/me/export/:agentId`
   returns 200 `application/json` with `content-disposition: attachment` and `no-store`.
   `GET /api/me/export/:agentId/notes` returns 200 `application/pdf`. A non-live, malformed or
   other teacher's agent gets 404, and a repository failure gets 500 with only the error name
   logged. Both routes are covered by the route-coverage test (`/api/me/**` GET row), unchanged.
4. Full suites: `corepack pnpm turbo run typecheck lint test --filter=@edmate/db... --filter=@edmate/web...`
   are green, the secret scan is clean, and the db int tests ran against Postgres (not skipped).

## Phases (one fresh builder per phase, each ≤ 100 tool calls)
Recommended branches follow 8.5a–e: one PR per phase, `m9/9.6a-export-readers`,
`m9/9.6b-progress-export`, `m9/9.6c-plan-change-repo`, `m9/9.6d-plan-change-ui` and
`m9/9.6e-plan-entry-points`. The lead may instead use one branch for the whole task.

Order: **A → B**, **A → C** (they share the db test files), **B + C → D → E**. B and C can run at
the same time (B is `apps/web` only, C is `packages/db` only).

---

## Phase A: packages/db, paged export readers (budget 70)
Package boundary: `packages/db` only. Risky: `packages/db/src/repositories/**`.

Tests first (`packages/db/test/repositories.int.test.ts`, real Postgres):
- `sessions.listForStudent(scope, { after?, limit })`:
  - Returns only the scope's own sessions, oldest first by `(created_at, id)`.
  - Never returns `help_state` (the result's exact key set is asserted). The shape is
    `{ id, agentId, agentVersion, packageId, packageVersion, summary, createdAt, endedAt }`.
  - Keyset paging is stable across created_at ties: page size 2 over 5 sessions, two sharing a
    timestamp, gives every id exactly once.
  - `next` is null on the last page.
  - `limit` 0 or 501 is `invalid`; a malformed cursor is `invalid`.
- `messages.listForStudent(scope, { after?, limit })`:
  - Returns every message of every session of the pair (open and ended), oldest first by
    `(created_at, id)`, each with its `sessionId`. Shape: `Message` plus `sessionId`.
  - Gives the same paging and tie cases, max 500.
  - Another student's or another teacher's messages never appear, even when they share a
    timestamp.
- Isolation grid: one case per new method (the `RepositoryMethod` Record forces it). Add both
  methods to `leak.test.ts`'s scrubbed-driver-error list.

Files:
- Modify `packages/db/src/repositories/sessions.ts`: add `listForStudent`, the cursor schema
  `{ createdAt: iso, id: IdSchema }` and `EXPORT_PAGE_MAX = 500` (module-local export).
- Modify `packages/db/src/repositories/messages.ts`: add `listForStudent`, joining `sessions` on
  `sessions.student_id`/`teacher_id` = scope (the same `ownSession`-style predicate), reusing
  `toMessage`.
- Modify `packages/db/test/repositories.int.test.ts`, `packages/db/test/leak.test.ts` (and
  `isolation-seed.ts` only if a case needs more seeded messages).
- **Do not edit `packages/db/src/repositories/index.ts`.** The web derives the types from
  `Repositories` (as `src/subscriptions/start.ts` does) and uses page size 500. An int test pins
  that 500 is accepted and 501 is not. If an `index.ts` edit turns out unavoidable, stop and
  report (shared file).

State after Phase A: two student-scope readers exist, unused by the web. Nothing user-visible.

## Phase B: apps/web, progress page, JSON export, notes PDF (budget 100)
Package boundary: `apps/web` only. No risky path. Shared file: `apps/web/messages/en.json`.
Possibly shared: `apps/web/app/learn/[agentId]/page.tsx` (one nav line; check 9.5a's diff before
starting).

Tests first:
- `src/progress/progress.test.ts`, a pure `buildProgress({ outline, profile, allowedModuleIds })`:
  - Modules and topics come in outline order with titles only (no `chunkIds`, source titles or
    locators reach the result).
  - Topic state: `mastered` when p ≥ 0.95 (BKT convention; logged as a decision), `practising`
    when n ≥ 1, else `not_started`.
  - Counts give topics covered (n ≥ 1) and topics mastered.
  - Next steps are at most 3 topics, from the student's allowed modules only, in outline order:
    practising topics first, then not-started ones.
  - Mastery for a topic no longer in the outline goes to an `other` list by id.
  - A null profile is all `not_started`. No outline gives the empty state.
- `src/export/buildExport.test.ts`: acceptance item 1. `buildExport(backend, scope, now)` loops
  the Phase A readers until `next` is null. A hard ceiling of 200 pages per reader means a runaway
  loop fails with a thrown error, never truncates.
- `src/export/pdf.test.ts` (`// @vitest-environment node`): acceptance item 2, plus these cases:
  - Characters outside WinAnsi become `?`.
  - Control characters are stripped.
  - `\`, `(` and `)` are escaped.
  - An empty notes document is still one valid page.
- `src/export/notes.test.ts`: `notesDocument(exportJson, progress)` gives headings and lines in
  this order:
  1. title (package name, export date);
  2. progress per module;
  3. next steps;
  4. session summaries, newest first;
  5. answers from your teacher (answered questions only: question then answer);
  6. mistakes to watch (tag and count).
  No raw chat transcript (Q4).
- `src/export/routes.test.ts`: acceptance item 3.
- `app/learn/[agentId]/progress/page.test.tsx`:
  - `requireRole(['student'])` (default clearance `age`, like the memory page).
  - A non-live agent gives notFound.
  - Renders module and topic titles, counts and next steps, and links to both exports.
  - No axe violations.
  - Mirrors `app/learn/[agentId]/memory/page.test.tsx`.

Files (create unless marked):
- `apps/web/src/progress/progress.ts` and `ProgressView.tsx` (server-safe, `useTranslations`).
- `apps/web/src/export/buildExport.ts` builds the JSON. It is per pair (Q3) and contains:
  - `format: 'edmate-export'`, `version: 1`, `exportedAt`, `complete`, `truncated: string[]`,
    `counts`;
  - `agentId`, `subscription` (status, periodEnd, package `{ id, name, version }` from
    `packageVersions.getById` projected to those three fields, or null);
  - `progress` (from `buildProgress`), `learnerProfile`, `evidence`, `sessions` (each with its
    `messages`), `teacherQuestions`.
  Excluded: `help_state`, turn traces, usage and cost, safety events, audit rows and account
  fields (Q3).
- `apps/web/src/export/pdf.ts`: a minimal text-only PDF 1.4 writer (Q2). It uses:
  - US Letter pages (612×792 pt) with 54 pt margins;
  - the standard Helvetica and Helvetica-Bold fonts (not embedded) with WinAnsiEncoding;
  - word wrap by the Helvetica AFM widths, and page breaks;
  - uncompressed content streams;
  - Latin-1 bytes out (`Uint8Array`).
  No dependency.
- `apps/web/src/export/notes.ts`: the notes document model (a list of `{ kind: 'h1'|'h2'|'p'|'li', text }`).
- `apps/web/src/export/routes.ts`: `createExportHandlers(backend)` → `{ json, notes }`, which
  follows `src/memory/routes.ts`:
  - The scope comes from `studentTurnScope`; the request body is ignored.
  - Responses send `cache-control: no-store` and `x-content-type-options: nosniff`.
  - The file name is `edmate-export-<agentId>.json` or `edmate-notes-<agentId>.pdf` (the agentId
    is validated by the contracts id format).
  - Errors map through `fromError`, with the error name only in logs.
- `apps/web/app/api/me/export/[agentId]/route.ts` (`GET = withRole(['student'], …json)`) and
  `apps/web/app/api/me/export/[agentId]/notes/route.ts` (`GET`, notes).
- `apps/web/app/learn/[agentId]/progress/page.tsx`: reads `agents.owner`, then
  `learnerProfiles.get`, then `outline.getOutline({ teacherId })` (projected to titles server-side
  before any client prop) and `subscriptions.findLive` → `packageVersions.getById` (for
  `moduleIds`).
- Modify `apps/web/app/learn/[agentId]/page.tsx`: add a "Progress" nav link beside the memory link.
- Modify `apps/web/messages/en.json`: new `progress` and `export` namespaces only.
- Tests listed above.

State after Phase B: a student sees `/learn/<agent>/progress` and downloads the complete JSON and
the notes PDF. The acceptance holds. Plan changes are not built yet.

## Phase C: packages/db, plan-change methods (budget 90)
Package boundary: `packages/db` only. Risky: `packages/db/src/repositories/**`. Needs Q1, Q5 and
Q6 answered. Assumes Q1 = (a) (immediate), so no migration.

All four new methods share these rules:
- They take `StudentScope` plus `{ subscriptionId }`.
- They run in one transaction that `SELECT … FOR UPDATE`s the pair's live row where
  `id = subscriptionId` and student and teacher match.
- They write one audit row: `actorRole: 'student'`, `actor` = the student, `target:
  subscription:<id>`, `before`/`after` = status and package version id.
- They return `LiveSubscription`.
- A missing or foreign row is `not_found`. A wrong state is `invalid`.

Tests first (int, real Postgres):
- `subscriptions.changePackage(scope, { subscriptionId, packageVersionId })`:
  - Succeeds only when the target is the **live** version (`packages.live_version`) of a package
    of the same teacher **and the same agent** as the current package, and that agent is `live`.
  - A draft or old version, another teacher's version or a suspended agent is `not_found`.
  - It needs status trial, active or past_due. Paused or ended is `invalid`.
  - The same package version as now is `invalid`.
  - It keeps `status` and `period_end`. It writes the audit row `subscription.change_package`.
- `subscriptions.pause(scope, { subscriptionId })`: trial, active or past_due become `paused`
  (audit `subscription.pause_student`, `before.status` kept). Already paused is `invalid`.
- `subscriptions.resume(scope, { subscriptionId })`:
  - `paused` goes back to the `before.status` of the latest pause audit row, but only when that
    row is `subscription.pause_student` by this student.
  - A cost-alarm pause (`subscription.pause_cost_alarm`), a pause with no audit row, or any
    non-student pause is `invalid` (Q6).
  - Not paused is `invalid`.
- `subscriptions.cancel(scope, { subscriptionId })`:
  - Any live status becomes `ended` (audit `subscription.cancel_student`).
  - After it, `findLive` is null and `start` succeeds again for the pair.
- `subscriptions.start` (9.3b item, Q5): a version that is not its package's live version, or
  whose agent is not live, is `not_found`. The existing start cases stay green.
- Concurrency: two parallel `pause` calls give one success and one `invalid`, with one audit row.
- Isolation grid cases for the four new methods (write cases restore the seed as 9.3's `start`
  case does). Add all four to `leak.test.ts`.

Files:
- Modify `packages/db/src/repositories/subscriptions.ts` (the four methods, the `start` live-version
  join, input schemas, and action constants `STUDENT_PAUSE_ACTION` and so on, module-local).
- Modify `packages/db/test/repositories.int.test.ts`, `packages/db/test/leak.test.ts` (and
  `isolation-seed.ts` only if needed).
- Do not edit `index.ts` (as in Phase A). Stop and report if it is unavoidable.

State after Phase C: the repository supports change, pause, resume and cancel with audit rows. No
UI yet.

## Phase D: apps/web, the plan route and page (budget 95)
Package boundary: `apps/web` only. No risky path (the policy row exists). Shared file: `en.json`.
Possibly shared: `app/learn/[agentId]/page.tsx` (one nav line).

Tests first:
- `src/subscriptions/change.test.ts`, `createPlanHandlers(backend).patch` over an injected backend:
  - The body is strict:
    `{ agentId, action: 'change', packageId } | { agentId, action: 'pause'|'resume'|'cancel' }`.
    It is read through `readJson` (64 KB cap gives 413; malformed gives 400). A client
    `packageVersionId`, `status` or `studentId` is rejected (400).
  - The scope comes from `studentTurnScope`. The URL id must equal `findLive(scope).id`, else 404.
  - `change` maps `packageId` → `liveForAgent` offer → `packageVersionId` server-side (unknown
    gives 404).
  - The `RepositoryError` mapping is exhaustive (with a `never` guard): `not_found`/`scope` → 404,
    `invalid` → 409 `validation` with a fixed per-action message, `integrity` → 400,
    `failed` → 500.
  - The response is 200 `{ status, packageId }`, `no-store`.
  - No payment code is reached (none exists). The test asserts only the subscription repo methods
    were called.
- `app/learn/[agentId]/plan/page.test.tsx` and `src/subscriptions/PlanView.test.tsx` (jsdom,
  jest-axe):
  - The page shows the current package, status and period end, and each other live offer with
    "Upgrade" (higher `amountMinor`, same currency), "Downgrade" (lower) or "Switch" (equal or a
    different currency).
  - Pause when live, Resume when paused (or the fixed "paused by Edmate" text when resume would be
    refused, which the page decides from a 409), and Cancel behind a confirm step that offers both
    exports first.
  - Every action uses try/catch/finally with a busy flag, and a non-2xx or unreadable body shows a
    fixed `role="alert"` text (lessons: "A studio page that trusts a 200 response gets stuck").
  - On success after change, resume or cancel it navigates to `/learn/<agentId>` (no `?s=`), so the
    next message starts a session on the new package. After pause it re-renders.
  - The page needs no live subscription to render. With none, it links to `/packages/<agentId>`.

Files:
- Create `apps/web/src/subscriptions/change.ts` and the test.
- Create `apps/web/app/api/subscriptions/[id]/route.ts`:
  `PATCH = withRole(['student'], planHandlers.patch)`.
- Create `apps/web/app/learn/[agentId]/plan/page.tsx` and `apps/web/src/subscriptions/PlanView.tsx`
  (`'use client'`), with their tests.
- Modify `apps/web/app/learn/[agentId]/page.tsx` (a "Plan" nav link).
- Modify `apps/web/messages/en.json` (new `plan` namespace). The wording while Q1 = (a): "While
  Edmate is free to try, changes take effect right away."

State after Phase D: a student upgrades, downgrades, pauses, resumes and cancels from
`/learn/<agent>/plan`, with no payment. 9.7's e2e (locked → upgrade → unlocked) can run on it.

## Phase E: apps/web, entry points for paused and live plans (budget 50)
Package boundary: `apps/web` only. Shared files: `en.json` and `apps/web/app/home/view.tsx` (9.2's
Phase B nav link).

Tests first:
- `src/chat/liveChats.test.ts`: a new `pausedAgents`/`homePausedLinks` (mirrors
  `homeStartLinks`). Only `paused` rows qualify. A repository error shows nothing and logs only
  the error name.
- `app/home/view.test.tsx`: a "Paused" list links to `/learn/<id>/plan`. The placeholder shows only
  when all three lists are empty. No axe violations.
- `app/packages/[agentId]/page.test.tsx` (9.3b item): a paused live subscription shows its own
  text ("Your plan with this teacher is paused") and a link to the plan page. An active one adds a
  "Change plan" link beside the existing chat link.

Files: modify `apps/web/src/chat/liveChats.ts`, `apps/web/app/home/page.tsx`,
`apps/web/app/home/view.tsx`, `apps/web/app/packages/[agentId]/page.tsx`, their tests, and
`apps/web/messages/en.json` (`home.paused*`, `packages.paused*`, `packages.changePlan`).

State after Phase E (task done): every plan state has an entry point. 9.3b keeps only its
remaining items.

---

## Files out of bounds (all phases)
- `packages/contracts/**`. Use existing `ErrorCode`s (`validation` + 409, `input_too_large` + 413).
- `apps/web/src/auth/**`, including `policy.ts`: the rows exist. Stop if a route needs a new row.
- `packages/harness/**`: `entitle` already refuses paused and ended.
- `packages/payments/**`, `apps/web/app/api/webhooks/**`, migrations and schema (under Q1 = (a)).
- `packages/db/src/repositories/index.ts` (shared, see Phases A and C).
- `apps/web/app/teacher/**`, `apps/web/src/chat/ChatView.tsx` (9.5) and `package.json` (no new
  dependency).

## Risky paths touched (checked against `.claude/skills/merge-gate/risk-paths.txt`)
| Path | Phase | Group | Reviewers required |
| --- | --- | --- | --- |
| `packages/db/src/repositories/sessions.ts` | A | access / money / data isolation | security-reviewer |
| `packages/db/src/repositories/messages.ts` | A | access / money / data isolation | security-reviewer |
| `packages/db/src/repositories/subscriptions.ts` | C | access / money / data isolation (subscriptions) | security-reviewer |

Phases A and C each log a `risk: high` decision in the handoff (the 9.3 / 8.x repository
precedent). They should also get code-reviewer (always), typescript-reviewer, and
database-reviewer for the keyset SQL and `FOR UPDATE`. None of B, D or E matches a risky glob:
`apps/web/app/api/me/**`, `apps/web/app/api/subscriptions/**`, `apps/web/src/subscriptions/**`,
`apps/web/src/export/**`, `apps/web/src/progress/**`, `apps/web/app/learn/**`,
`apps/web/app/home/**`, `apps/web/app/packages/**` and `apps/web/messages/en.json` are not in
`risk-paths.txt`. No migration (so no data-dropping check) under Q1 = (a). If Q1 = (b), Phase C
adds an additive migration. It is not risky by path, but database-reviewer is still asked.

Planned `risk: high` handoff entries:
- A: "9.6a export readers on the repositories path (no help_state, pair-scoped, keyset paged)".
- C: "9.6c student plan-change methods on the subscriptions repository (live-version-only change,
  own-pause-only resume, immediate cancel until 10.3)".

## Shared files, by phase (for the lead's ordering)
| Shared file | Phases | Other tasks touching it |
| --- | --- | --- |
| `apps/web/messages/en.json` | B, D, E (new namespaces; E adds keys under `home` and `packages`) | 8.6d, 8.9c, 9.2b, 8.7a, 9.5a |
| `packages/db/src/repositories/index.ts` | none (deliberately) | 9.2b, 8.7a, ... |
| `apps/web/app/teacher/view.tsx` | none | 8.6d, 8.9c |
| `apps/web/app/learn/[agentId]/page.tsx` | B, D (one nav link each) | check 9.5a |
| `apps/web/app/home/view.tsx`, `home/page.tsx` | E | 9.2 Phase B (nav link) |
| `packages/db/test/repositories.int.test.ts`, `leak.test.ts` | A, C | any concurrent db repository task |

Each phase merges `origin/main` before pushing (no rebase on pushed branches).

## Lead answers (22 Oct 2026)
- Q1: open with the human (B-44): it changes the PRD's "downgrade and cancel at period end". The lead recommends (a). Phases A and B don't depend on it; Phase C waits for the answer.
- Q2: (a) accepted. A small text-only PDF writer with no new dependency; non-WinAnsi characters print as `?` in the English-only pilot.
- Q3: accepted as recommended. Account-level export is a follow-up beside `DELETE /api/me`.
- Q4: accepted as recommended.
- Q5: accepted. The lead trims 9.3b's title when the phases that take its items merge.
- Q6: accepted as recommended.
- Build order: A first (packages/db; merges origin/main before pushing, since 8.7a and 12.1a also edit packages/db); B and C after A; D after C; E after D and 9.2b (both edit home/view.tsx).

## Open questions (each with a recommendation)
1. **Downgrade and cancel timing while there is no payment.** PRD S8 and the build plan say
   "downgrade and cancel at period end", but the schema has no scheduled-change column and
   nothing ends a period yet. (a) Apply downgrade and cancel at once until 10.3, which owns
   period-end timing with the provider. The plan page says so, and the cancel confirm offers both
   exports first. (b) Schedule them now: an additive migration
   (`cancel_at_period_end`, `scheduled_package_version_id`), applied when `period_end` passes,
   inside `findLive`/`start`. That costs about one more phase in the risky subscriptions path.
   **Recommend (a)**, plus a board note on 10.3: "move downgrade and cancel to period end;
   9.6 applies them at once".
2. **Notes PDF library.** (a) A small text-only PDF writer in `apps/web/src/export/pdf.ts`
   (standard Helvetica, WinAnsi, wrap and paging), tested by reading it back with the existing
   `@edmate/ingest` `parsePdf`. No new dependency and no ADR. Its limit: characters outside WinAnsi
   (emoji, most maths symbols, non-Latin scripts) print as `?`. That is acceptable for the
   English-only pilot, and the JSON keeps the exact text. (b) Add `pdf-lib` (MIT, no native code).
   That is a tech-stack change needing an ADR reviewed by architect, security-reviewer and
   typescript-reviewer, plus lead approval. **Recommend (a)**. Revisit with (b) when a non-Latin
   market or maths rendering needs embedded fonts.
3. **What "complete" covers.** **Recommend:** one export per teacher (the pair the repositories
   are scoped to, and the PRD's "download their notes and progress" on cancelling). It holds
   everything Edmate keeps about that learning:
   - the subscription and package;
   - progress, the learner profile and all evidence;
   - every session (with summary) and every message;
   - every question to the teacher with its answer.
   Left out:
   - internal records: `help_state` (it holds answer keys), turn traces, usage and cost, safety
     events and audit rows;
   - account data (name, email, consents in `packages/db/src/identity/**`, a risky path). That
     goes to a follow-up account-level export beside `DELETE /api/me`.
   Evidence over 10,000 or questions at the 200 cap set `complete: false` with the section named,
   never silently (not expected at pilot volumes).
4. **What the "notes" PDF holds.** **Recommend:**
   - progress by module;
   - next steps;
   - session summaries;
   - the teacher's answers to the student's questions;
   - mistakes to watch.
   It does not hold the full chat transcript, which is in the JSON.
5. **9.3b items.** **Recommend** 9.6 takes "start accepts only the live package version" (Phase C,
   the same live-version check `changePackage` needs) and "paused subscriptions get their own text
   on the compare page" (Phase E). The lead trims 9.3b's title on merge.
6. **Who can undo a pause.** **Recommend:** a student resumes only a pause they made. A cost-alarm
   pause (the monthly free-tier cost control, 2.5) and any future staff pause stay. The plan page
   shows a fixed "paused by Edmate" text. Resume restores the status from before the pause and
   does not move `period_end` (no payment).

## Decisions the builders log (planned, not questions)
- Mastered means p ≥ 0.95 (BKT convention). Covered means at least one piece of evidence.
- Upgrade, downgrade or switch is labelled by `amountMinor` in the same currency.
- After a change, the page navigates to `/learn/<agent>` with no `?s=`. A second tab still on the
  old session gets `no_access` on its next message until reloaded (3.16 ends that session).
  Follow-up: ChatView restarts a session on that error.
- Export needs a live agent (`studentTurnScope`). If the teacher's agent is suspended, the export
  is unavailable. Follow-up: export by the student's own subscription row.
- No `GET /api/me/progress` JSON route: the progress page reads server-side. The JSON export
  carries progress.

## Budget
Budget: 405 tool calls (5 phases, packages/db + apps/web)

Per phase: A 70, B 100, C 90, D 95, E 50. Each phase is one fresh builder, and no phase exceeds
100.

## Allowed tools
Read, Grep, Glob, Edit, Write, and Bash for these uses only:
- `corepack pnpm` turbo or vitest runs for the phase's package;
- `docker compose … up -d postgres` for the db phases' int tests;
- `python3 .githooks/secret-scan.py --all`;
- git on the phase's own branch (commit, `merge origin/main`, push; no rebase or force).
No new dependencies and no network installs.

## Exit conditions
- **DONE (per phase):** that phase's tests were written first and are green. The full
  `typecheck lint test` passes for the touched package and its dependents (db int tests ran, not
  skipped). The secret scan is clean. The handoff has evidence, the State-after line and
  `## Decisions` (with the `risk: high` entry in A and C). For the whole task, acceptance items 1-4
  above are pasted into Phase B's handoff.
- **PARTIAL (stop and hand off):** stop past about 90 tool calls in a phase (45 in E) with work
  left. Also stop when:
  - a file outside the phase's list must change, especially `index.ts`, `src/auth/**`,
    contracts, the schema or migrations, or `package.json`;
  - a phase starts before the phases it depends on have merged;
  - Q1 is answered (b) (re-plan Phase C with the migration first);
  - two fix attempts on the same failing test fail.
- **BLOCKED:** stop when a question above is answered in a way this plan does not cover, or when
  making the route work needs a new policy row or a contracts change.
