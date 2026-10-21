# Task 6.4 — Session summary and end-of-topic check

Board: milestone M6 · deps `5.6` (done), `6.2` (done), `M3` (done) · branch `m6/6.4-session-summary`
· **risky** (`packages/db/src/repositories/**`) · one phase, one builder.

Does **not** share a file with 6.3 (`m6/6.3-mistake-tags`, in review): 6.3 touches
`packages/db/src/repositories/learner.ts`; this task touches `packages/db/src/repositories/
sessions.ts` only (a sibling file in the same directory, no overlapping exports or symbols). So
this build does not need to wait for 6.3 to merge. If the builder's rebase later shows a real
conflict (it shouldn't), stop and say so rather than hand-merging.

## Acceptance (verbatim, `docs/board/tasks.yaml`)

Title: "Session summary and end-of-topic check"
Accept: "summary ≤ 60 words, stored as `lastSummary`; the next session uses it."

### How it is shown (paste into handoff.md)

1. `packages/harness/src/memory/sessionSummary.test.ts`: a `ScriptedGateway` returning a ≤60-word
   reply produces that string; a reply over 60 words fails the schema (the call rejects, no partial
   value returned); an empty session history returns `undefined` without calling the gateway; a
   gateway error propagates (name only, never turn text) for the caller to handle.
2. `packages/db/test/sessions.int.test.ts` (new): seeding a session, calling the new
   `sessionsRepo.end(scope, sessionId, summary)` with a summary string stores it on
   `sessions.summary` **and** upserts it onto `learner_profiles.last_summary` for the same
   (student, teacher) pair, in one transaction; calling `end` again on the same (now-ended) session
   is a no-op (`{ ended: false }`), proving a retried call can never clobber a summary written by a
   session that started since; another student's or teacher's session is `not_found` and nothing is
   written.
3. `packages/harness/src/pipeline/steps/buildContext.test.ts` already asserts `lastSummary` reaches
   `TurnContext.profile` unchanged (built for 6.2) — cited, not re-proven, as the existing evidence
   that "the next session uses it": once `end` has written `learner_profiles.last_summary`, the next
   session's `buildContext` picks it up with no new harness wiring.
4. `packages/db/test/repositories.int.test.ts`: one isolation-grid case for `sessionsRepo.end`,
   matching 3.17/6.2/6.3's own precedent for every new repo method.

## State of the world (read, not assumed)

- `LearnerProfileSchema.lastSummary` (`packages/contracts/src/memory.ts`) and
  `sessions.summary`/`learner_profiles.last_summary` (`packages/db/src/schema/learning.ts`) already
  exist — the ≤60-word rule (`LIMITS.lastSummaryMaxWords`, `countWords`) and both columns were built
  in earlier tasks (3.16/3.17). `packages/harness/src/pedagogy/compose.ts` already reads
  `ctx.profile.lastSummary` into the system prompt ("the next session uses it" is already true of
  whatever is stored — proven by `compose.test.ts` and `buildContext.test.ts`). **This task's only
  new work is generating the summary text and writing it to both columns.**
- No code anywhere calls a model to generate this text yet, and no repo method writes
  `sessions.summary` at all (only `learnerProfilesRepo.save`/`applyMastery`/`applyEvidenceMastery`/
  `rebuildMastery` touch `learner_profiles`; none touch `sessions.summary`). The only existing writer
  of `learner_profiles.last_summary` is `sessionsRepo.endOnPackageChange` (task 3.16), and it only
  ever *clears* it (sets `null`) when a session ends because the package changed underneath it —
  never sets a new value. This task adds the opposite path: a normal session end that *sets* a new
  summary.
- No "end this session normally" trigger exists anywhere in the app layer today (checked
  `apps/cli/src/commands/chat/**` and `apps/web/src/chat/**`, `apps/web/src/turn/**`): a session
  today only ever ends via `endOnPackageChange`, never by an explicit student action or an idle
  timeout. Building that trigger (a CLI command, a web "end session" button, or a worker
  idle-timeout job) is an app-layer feature with its own UI/API surface, not a harness or db
  concern, and no such surface has been asked for by any task so far.
- The "end-of-topic check" half of the title has no new producer either: the pedagogy "check" move
  (`skills.ts`'s `practiceCheck`, `explain_check`) and the evidence-event contract
  (`EvidenceEventSchema.source: 'check' | 'practice' | 'rubric'`, task 6.2) both already exist, but
  nothing builds a real, topic-scoped `EvidenceEvent` from a turn and puts it on
  `CommitRecord.evidence` — `commit.ts`'s own comment says so today ("no step upstream produces
  real, topic-scoped evidence yet"), and this is unchanged by 6.1/5.6/6.2 landing: practice items
  (`packages/harness/src/tools/practiceItems.ts`) carry their own flat `topicId` string (e.g.
  `'fractions'`, `'arithmetic'`), never the course topic map's validated, teacher-scoped topic id
  (`packages/harness/src/memory/topicMap.ts`, 6.1) — the two are different id spaces today, and nor
  does `IssuedItem`/`HelpState` carry a topic id through to `commit` at all (only
  `moduleId`/`practiceModuleId`). Wiring this for real needs: (a) practice items tagged with the
  course topic map's topic ids, (b) threading a topic id through `IssuedItem` → `HelpState` →
  `CommitRecord.evidence` (harness-internal types, no contracts change), and (c) deciding what counts
  as "end of topic" (every graded check, or only the last one before moving on). That is
  substantially more surface than this task's single-sentence acceptance test asks for, and mirrors
  the exact gap 6.2's and 6.3's own plans already found and deferred ("no scoring/grading tool
  exists yet... ships the pure logic... not wired into a live pipeline call site... future scope").
  **Scope cut (Open questions, Q1): this task does not build that wiring.**

## Design

### `packages/harness/src/memory/sessionSummary.ts` (new) — one `generateObject` call, no retry loop
Same shape as `packages/ingest/src/styleCard/draftStyleCard.ts` (5.11): the ≤60-word rule is a zod
`refine` on the call's own output schema (reusing `LIMITS.lastSummaryMaxWords` and `countWords` from
`@edmate/contracts`, the same numbers `LearnerProfileSchema.lastSummary` checks), so an over-length
reply fails the call outright — no truncation, no re-ask.

```
summarizeSession(
  gateway: Pick<ModelGateway, 'generateObject'>,
  history: readonly Pick<Message, 'role' | 'text'>[],
): Promise<string | undefined>
```

- Empty `history` (a session with no messages, e.g. started then abandoned) returns `undefined`
  without calling the gateway — never a pointless or empty-input model call.
- System prompt: plain English (pilot is English-only), ≤60 words, a short "what we covered / pick
  up here next time" recap written for the student, no instructions-in-data risk (the transcript is
  JSON data, same framing `modelFallback.ts`/`draftStyleCard.ts` already use).
  `tier: 'small'`, bounded `maxOutputTokens` (model-text cap, same class as `LIMITS.modelTextMaxLength`).
- On a gateway error or a schema failure (over 60 words, wrong shape), the call rejects; this
  function does not catch it — the caller decides (Decision, below: don't block ending a session on
  a model failure).
- No cancel token, no step budget: this never runs inside the turn pipeline's `StepEnv` (there is no
  step for "end of session"), so it takes a bare gateway, like `draftStyleCard`.

### `sessionsRepo.end(scope, sessionId, summary: string | undefined)` — new method, `sessions.ts`
Same transactional shape as `endOnPackageChange` (3.16), the opposite direction:
- `UPDATE sessions SET ended_at = now(), summary = <summary ?? null> WHERE <ownSession> AND
  ended_at IS NULL`.
- Only when this call is the one that ends it (`written === 1`): upsert `summary` onto
  `learner_profiles.last_summary` for the scope's (teacherId, studentId) — `ON CONFLICT DO UPDATE`,
  same upsert shape `applyMastery`/`applyEvidenceMastery` already use for a first-ever profile row
  (`lang: 'en'`, empty `mastery`/`mistakes`), so a student's very first session still seeds a
  readable `lastSummary` for session two. `summary: undefined` (the generator skipped or failed) is
  written as SQL `NULL` on `sessions.summary` and leaves `learner_profiles.last_summary` **unset**
  (the upsert's `ON CONFLICT` `SET` list never names `last_summary` when `summary` is undefined, so
  an existing value survives a failed-to-summarize session, same never-clobber discipline
  `applyMastery`'s own doc comment requires of `mastery`).
- Already-ended (another call, or a race with `endOnPackageChange`) is a no-op, `{ ended: false }`,
  nothing written — same idempotency `endOnPackageChange` already has, checked the same way (a
  second `SELECT` confirming the scope owns a session row at all, else `not_found`).
- `summary` is checked against `LIMITS.lastSummaryMaxWords`/`countWords` before any SQL (same
  fail-before-write discipline `helpStateJson` already uses in this file), `invalid` on failure —
  defense in depth: `summarizeSession`'s own schema should already guarantee this, but `end` never
  trusts a caller-supplied string on its word alone.

### No contracts change
`LearnerProfileSchema.lastSummary`, `sessions.summary` and `learner_profiles.last_summary` all
already exist with the right shape (3.16/3.17). `ProfileStore`/`SessionStateStore` (the public
ports) are unchanged — `sessionsRepo.end` is a `packages/db`-internal method, like
`applyMastery`/`applyMistakes` before it, not promoted to a port. `git diff origin/main --
packages/contracts` must be empty. No ADR.

### No new migration
Both columns already exist (3.16's `sessions.summary`, 3.17's `learner_profiles.last_summary`).

## Files

- **Create:** `packages/harness/src/memory/sessionSummary.ts` — `summarizeSession`.
- **Create:** `packages/harness/src/memory/sessionSummary.test.ts` — ScriptedGateway cases (valid,
  over-length, empty history, gateway error).
- **Modify:** `packages/harness/src/memory/index.ts` — `export * from './sessionSummary.js'`.
- **Modify:** `packages/db/src/repositories/sessions.ts` — add `end`.
- **Create:** `packages/db/test/sessions.int.test.ts` — integration tests for `end` (see "How it is
  shown").
- **Modify:** `packages/db/test/repositories.int.test.ts` — one isolation-grid case for `end`.
- **Modify:** `docs/tasks/6.4/handoff.md` (end of task, by the builder).

## Files out of bounds

- `packages/contracts/**`, `docs/adr/**` — no contracts change (Design, above).
- `packages/db/src/repositories/learner.ts`, `packages/harness/src/memory/mistakeTags.ts` — 6.3's
  files; untouched by this task (State of the world, above).
- Any app-layer "end session" trigger (`apps/cli/**`, `apps/web/**`, `apps/worker/**`) — no such
  surface exists yet; out of scope (Open questions, Q2).
- Any topic-scoped evidence producer (`IssuedItem`/`HelpState` topic-id threading,
  `CommitRecord.evidence` population, `packages/harness/src/pipeline/runner.ts`,
  `packages/harness/src/pipeline/steps/commit.ts`, `packages/harness/src/tools/**`) — out of scope
  (Open questions, Q1).
- `content/locales/**` — English-only pilot; no locale work here.

## Tests first

1. `packages/harness/src/memory/sessionSummary.test.ts`:
   - Valid ≤60-word reply → returned as-is.
   - Over-60-word reply → the call rejects (schema refine), no value returned.
   - Empty `history` → `undefined`, and the gateway is never called (assert on a gateway stub that
     throws if invoked).
   - Gateway throws → propagates, unchanged.
2. `packages/db/test/sessions.int.test.ts`:
   - `end` with a summary writes `sessions.summary` and upserts `learner_profiles.last_summary` for
     the same pair, in one transaction.
   - `end` with `undefined` writes `sessions.summary = NULL` and leaves an existing
     `learner_profiles.last_summary` untouched.
   - A second `end` call on an already-ended session is a no-op (`{ ended: false }`), nothing
     rewritten.
   - Another student's or teacher's session is `not_found`.
   - A summary over `LIMITS.lastSummaryMaxWords` is `invalid`, nothing written.
3. `packages/db/test/repositories.int.test.ts`: isolation-grid case for `end`.
- **Gate:** `corepack pnpm turbo run typecheck lint test --filter=@edmate/harness... --filter=@edmate/db...`
  (Postgres up via `docker compose -f docker/compose.yaml -f packages/db/test/compose.port.yaml up -d postgres`).
- **Size:** 1 new harness module + 1 new db method, 4 files touched/created in `src`, 2 test files
  (one new) — smaller than 6.2, one phase.

## Risky paths touched (checked against `.claude/skills/merge-gate/risk-paths.txt`)

- `packages/db/src/repositories/**` (the `end` addition to `sessions.ts`) matches the
  security-reviewer group (risk-paths.txt lines 29–39: "...keeping each teacher's and student's data
  apart"). **Reviewers for this PR: security-reviewer** (plus the default code-reviewer/
  typescript-reviewer on every PR).
- `packages/harness/src/memory/**` is **not** on the risky-path list (only `guardrails/**` and
  `pedagogy/**` under `packages/harness` are, same as 6.3 found). No `packages/contracts/**`,
  `docs/adr/**`, `.claude/**` touched.
- Per CLAUDE.md rule 6, the handoff must log a `risk: high` decision for the repositories-layer
  touch, same as 3.17/6.2/6.3's own logged precedent.

## Open questions (each with a recommendation)

- **Q1. Does 6.4 need to build the "end-of-topic check" evidence producer (a real, topic-scoped
  `EvidenceEvent` from a graded check, reaching `CommitRecord.evidence`), or does the literal
  acceptance test (summary only) define this task's scope?** Recommend: no — defer. The acceptance
  test is one sentence about the summary; the producer needs practice items retagged to the course
  topic map's topic ids (6.1) plus new topic-id threading through harness-internal types
  (`IssuedItem`/`HelpState`), which 6.2's and 6.3's own plans already identified as a materially
  larger, not-yet-asked-for piece of work and deferred for the same reason (no scoring tool wired to
  a live call site yet). Propose a follow-up board task, e.g. **6.4a: wire practice/check outcomes
  into topic-scored evidence events** (M13, MVP-first, same track as 6.2a and 6.3a), once practice
  items are tagged with real course topic ids.
- **Q2. Should this task also build an app-layer trigger (CLI command, web button, or a worker
  idle-timeout job) that calls `summarizeSession` + `sessionsRepo.end` for a real session?**
  Recommend: no — no "end a session" surface exists anywhere yet (sessions today only end via the
  package-change path), and building one means choosing a UI/API shape no other task has asked for.
  Ship the generator and the repo method now, proven by the harness unit test and the db integration
  test above; wire a real trigger once the student app's session UI (or a CLI command) is
  prioritised. If the lead wants a minimal trigger in this task instead (e.g. a CLI `/end` command),
  that is a small, bounded addition to `apps/cli/src/commands/chat/**` — flag before the build starts
  so the builder's file list and budget account for it.

## Lead answers (21 Oct 2026)

1. Q1: accepted. 6.4 ships the summary only; the topic-scored evidence producer moves to board task 6.4a (M13).
2. Q2: accepted. No app-layer end trigger in 6.4; 6.4a also covers wiring a real end trigger once a session-end surface exists.

## Decisions (draft for the handoff)

### The summary generator takes a bare gateway, outside the turn pipeline
Decided: `summarizeSession` is not a pipeline step; it has no `StepEnv`, cancel token or step budget
— same shape as `draftStyleCard` (5.11), called from wherever a session actually ends (today: tests
only; see Q2).
Why: there is no "end of session" step in the turn pipeline to hang this off; inventing one would be
a pipeline-shape change with no caller.
risk: low

### A failed or skipped summary never clobbers the previous one
Decided: `sessionsRepo.end`'s upsert only names `last_summary` in its `SET` list when the caller
passes a defined `summary`; `undefined` (empty history, or the caller chooses not to retry a failed
generation) leaves the student's existing `lastSummary` in place for next time.
Why: matches `applyMastery`'s own never-clobber discipline for the same row; a model hiccup at
session end should not erase a perfectly good summary from a prior session.
risk: low

### `risk: high` — new write path in `packages/db/src/repositories/sessions.ts` (risky path)
Decided: ship `end`, logged `risk: high` per the merge gate's rule for any
`packages/db/src/repositories/**` change, reviewed by security-reviewer.
Why: the risk-paths group requires it regardless of the change's actual size; matches
3.17/6.2/6.3's own logged precedent for the same directory.
risk: high

## Budget
Budget: 55 tool calls

## Allowed tools

Read, Grep, Glob, Edit, Write, Bash (typecheck/lint/test and `docker compose ... up -d postgres`
only; no network, no payment or model calls).

## Exit conditions

- Status: DONE once both test files pass, the gate command above is green, `git diff origin/main --
  packages/contracts` is empty, and the handoff logs the three decisions above (the `risk: high` one
  verbatim).
- Status: PARTIAL if past ~55 tool calls, or if the lead's answer to Q1/Q2 changes this task's scope
  (e.g. asks for the evidence producer or an app-layer trigger here) — stop and flag rather than
  silently expanding scope.
