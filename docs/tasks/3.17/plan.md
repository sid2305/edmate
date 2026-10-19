# Plan: 3.17 — commit follow-up from 3.8 (ProfileStore.applyEvidence + db adapter)

**Branch:** `m3/3.17-profile-evidence` · **Deps:** 3.8 (done) · **Milestone:** M3

## Acceptance (verbatim, board)
> An ask_teacher turn creates exactly one teacher question scoped to that teacher and student;
> evidence updates the learner profile idempotently; tests on real Postgres.

## How it will be shown
- `packages/db` (compose Postgres up): new int tests for the two new `*For` adapters
  (`profileStoreFor`, `teacherQuestionStoreFor`), real Postgres, nothing skipped.
- `packages/queue`: fake-`Queue` unit tests for the new producer (no Redis).
- `apps/worker` (compose Redis + Postgres up): processor unit tests + a real round trip showing a
  replayed evidence job and a replayed/duplicated teacher-question open each land once.
- `packages/harness`: `steps/commit.test.ts` shows commit calls `applyEvidence` only when there is
  evidence, and opens a `TeacherQuestion` as a fallback only when the live (3.7) attempt left
  `teacherQuestionId` unset — never a second question when it is set.
- Gates: `corepack pnpm turbo run typecheck lint test --filter=@edmate/db... --filter=@edmate/queue... --filter=@edmate/worker... --filter=@edmate/harness...`,
  all suites passing, 100% on every new file (repo convention). `python3 .githooks/secret-scan.py --all` clean.

## Current state (read, not assumed)
- `profiles: ProfileStore` and `teacherQuestions: TeacherQuestionStore` are already in
  `PipelineDeps`; `buildContext` (done, 3.4) already calls `deps.profiles.get(studentId, teacherId)`
  every turn. `applyEvidence` is **never called anywhere** yet (test fixtures stub it to reject).
- The runner (3.7, done) already opens the `TeacherQuestion` synchronously inside the turn
  (`openTeacherQuestion`, with a timeout) and records `teacherQuestionId` on `CommitRecord` when it
  succeeds. Its own doc comment says: *"commit (3.17) then opens it... must open idempotently"*.
  `CommitRecord` and `BackgroundTask` already carry the plumbing for this (`teacherQuestionId?`,
  `'teacher_question'`).
- Neither `ProfileStore` nor `TeacherQuestionStore` has a real **db adapter** yet
  (`packages/db/src/repositories/ports.ts` has `transcriptStoreFor`, `sessionStateStoreFor`,
  `traceSinkFor`, `usageMeterFor`, `entitlementStoreFor`, `turnConfigStoreFor` — no
  `profileStoreFor`/`teacherQuestionStoreFor`). This is most of the task.
- `learnerProfilesRepo`/`evidenceEventsRepo` (get/save/append) already exist and are tested
  (an earlier task) and are reused, not rebuilt.
- `route` (3.3, intent/attempt), the practice skill (5.6, items map to topics) and the topic map
  (6.1) are all still `todo`. **No step anywhere produces a real per-topic `EvidenceEvent` today.**
  `EvidenceEvent` has no `tag` field, so it cannot drive `LearnerProfile.mistakes` either.

## Evidence extraction (deterministic, no model call)
Given the above, there is nothing upstream yet that can hand commit a real, topic-scoped,
deterministic `EvidenceEvent[]` — that needs 3.3/5.6/6.1. Plan: ship this task as **plumbing**,
not invented heuristics.
- Add `CommitRecord.evidence?: EvidenceEvent[]` (harness-internal type, `pipeline/types.ts`; not a
  contracts change). Absent/empty today — no step populates it yet.
- `commit` calls `profiles.applyEvidence(record.evidence)` only when the array is non-empty (same
  "optional, no-op when absent" shape as `record.next`/`record.input?.text`).
- `applyEvidence`'s db adapter updates **mastery only** (BKT per `topicId`); `mistakes` and
  `lastSummary` pass straight through unchanged (no source for either in `EvidenceEvent`).
- BKT defaults from the build plan (`pInit 0.2, pLearn 0.15, pSlip 0.1, pGuess 0.2`) live as module
  constants in a new pure function in `packages/db` (no DB), unit-tested directly; `packages/db`
  does not need mathjs (rule 3 only restricts the harness).

## Where applied: the worker commit job
- `profiles` joins `QueuedTurnPorts` (new `packages/queue/src/profileStore.ts`,
  `queuedProfileStore`), same shape as `queuedTranscriptStore`: `get` goes to a direct reader (db
  adapter), `applyEvidence` enqueues onto `COMMIT_QUEUE` (new `JOB.evidence` = `'evidence.apply'`,
  a new `EvidenceJobSchema`). `apps/worker/src/commit/processors.ts` gets a new branch mirroring
  `trace`'s `once()` pattern.
- `teacherQuestions` stays a **direct** (non-queued) adapter, like today: the live 3.7 path needs a
  synchronous id within budget to show the student `{type:'teacher_question', questionId}`, which a
  fire-and-forget queue can't give. 3.17's fallback in `commit` calls the same direct adapter
  in-process (not through BullMQ) — extract the existing `openTeacherQuestion` logic out of
  `runner.ts` into a small shared helper both call, so there is one findSimilar+open+validate path.

## Idempotency
- **Evidence**: `EvidenceEvent` carries no turn id or own id, so a `(turnId, index)` key (like
  `usageRowId`) isn't available. Recommend a **content-hash** id —
  `sha256(studentId|teacherId|topicId|correct|source|weight|ts)` — computed by the queue producer
  and carried as an explicit `id` on the write (extend `evidenceEventsRepo.append` to accept an
  optional per-event id, mirroring `usageLedger.record`'s existing optional-id precedent; this is
  a repo-internal write type, not the contracts `EvidenceEvent` shape, so no contracts change). The
  worker processor checks which ids already exist before inserting/recomputing mastery, so a
  replayed job (or two feeds of the same evidence) changes mastery once.
- **TeacherQuestion open**: add a partial unique index on `teacher_questions (teacher_id,
  student_id, agent_id, text) WHERE status = 'open'`; `open()` becomes insert-or-return-existing
  (same `insertSelect`/`ON CONFLICT` family already used in this file), so the live 3.7 attempt and
  the 3.17 fallback (or two retried fallbacks) converge on one row instead of raising a duplicate.
  `teacher_questions` is small and low-write (unlike `sessions`), so a plain migration (no
  `CONCURRENTLY` dance) is proportionate — flagged as a decision, not assumed.

## Session-open and package-pin guard
The 3.16 review's deferred MEDIUM (`learnerProfiles.save` overwrites `last_summary`
unconditionally) is closed **structurally**, not by adding a session check to this task's writes:
`applyEvidence`'s adapter never calls `learnerProfiles.save()`. It adds a new targeted upsert
(e.g. `learnerProfilesRepo.applyMastery`) whose `SET` list only ever names `mastery`, `mistakes`
(pass-through) and `updated_at` — `last_summary` is not in the statement, so it cannot be
clobbered. No session-open/package-pin check is added here, because `EvidenceEvent` has no
`sessionId` to check against; that invariant stays 6.4's job for whichever write actually sets
`last_summary`. The task handoff logs a decision closing the 3.16 finding for this write path
specifically (not for `save()` in general, which 6.4 still must guard).

## Minors / DPDP gate
Build plan §435 calls mastery tracking exactly the kind of per-topic tracking the 18 Oct decision
flags: *"DPDP also bars tracking and behavioural monitoring of children, so learner memory for
India under-18s needs a check before it ships"* — noted for **1.7 and M6**, not M3. `buildContext`
(3.4, already merged) already *reads* whatever is in `learner_profiles` for every session,
independent of 3.17; this task only adds a write path that today has no producer upstream (see
above), so it does not newly expose anything an India 13–17 session doesn't already carry. 
**Recommendation: ship 3.17 without a locale/age gate** (matches deps; adding one here would be a
contracts-level change — `ProfileStore` has no market/age parameter — needing an ADR out of
proportion to a plumbing task), but log a `risk: high` decision flagging that no such gate exists
yet anywhere in the memory path, and recommend the lead open a dedicated M6 task for it before any
India pilot, so the 18 Oct note isn't lost. This is the task's one open decision worth the human's
attention; everything else above is a design call I'm making and logging.

## Other decisions to make and log
- New profile default (`ProfileStore.get` has no `lang` param, unlike `fallbackContext`'s
  `input.lang`): default a never-seen student to `lang: 'en'` (pilot is English-only), `mastery:
  {}`, `mistakes: []`. Low risk, reversible when locale work lands.
- `mistakes` has no evidence-sourced writer (no tag in `EvidenceEvent`): left untouched by this
  task; whichever task wires style-card `mistakeTags` + guardrail output owns it.

## Files to create/modify
- `packages/db/src/mastery.ts` (new) — pure BKT update function + constants, unit-tested alone.
- `packages/db/src/repositories/learner.ts` — add `applyMastery` (mastery/mistakes-only upsert);
  `evidenceEventsRepo.append` accepts an optional per-event id.
- `packages/db/src/repositories/teacher-questions.ts` — `open()` becomes insert-or-return-existing.
- `packages/db/src/repositories/ports.ts` — add `profileStoreFor`, `teacherQuestionStoreFor`.
- `packages/db/migrations/00XX_teacher_question_open_dedup.sql` (new) + matching index in
  `packages/db/src/schema/learning.ts` (`db:generate` stays a no-op).
- `packages/db/test/mastery.test.ts`, `packages/db/test/profile-store.int.test.ts`,
  `packages/db/test/teacher-question-store.int.test.ts` (new); extend `migrate.int.test.ts`.
- `packages/queue/src/queues.ts` — `JOB.evidence`, `EvidenceJobSchema`, `jobId.evidence`.
- `packages/queue/src/profileStore.ts` (new) — `queuedProfileStore`.
- `packages/queue/src/index.ts` — extend `QueuedTurnPorts`/`queuedTurnPorts`.
- `packages/queue/test/adapters.test.ts` — extend.
- `apps/worker/src/commit/processors.ts` — new `evidence.apply` branch; `processors.test.ts` extend.
- `apps/worker/test/commit.int.test.ts` — extend (real Redis + Postgres round trip, idempotent
  replay for both evidence and teacher-question-open).
- `packages/harness/src/pipeline/types.ts` — `CommitRecord.evidence?: EvidenceEvent[]`.
- `packages/harness/src/pipeline/teacherQuestion.ts` (new) — shared helper extracted from
  `runner.ts`'s `openTeacherQuestion`, used by both `runner.ts` and `steps/commit.ts`.
- `packages/harness/src/pipeline/runner.ts` — use the shared helper (no behaviour change to the
  live path).
- `packages/harness/src/pipeline/steps/commit.ts` — call `applyEvidence` when non-empty; fallback
  open via the shared helper when `teacherQuestionId` is absent and `decision.move === 'ask_teacher'`.
- `packages/harness/src/testing/memoryPorts.ts` — add `memoryProfileStore`.
- `packages/harness/src/pipeline/steps/commit.test.ts` — extend.
- `docs/tasks/3.17/handoff.md` (end of task, by the builder).

## Files out of bounds
- `packages/contracts/**` — no change (`EvidenceEvent`, `LearnerProfile`, `ProfileStore`,
  `TeacherQuestionStore`, `TeacherQuestion` all stay as-is; no ADR needed).
- `packages/harness/src/pedagogy/**`, `packages/harness/src/pipeline/steps/route.ts` (3.3),
  the practice skill (5.6) and topic map (6.1) — real evidence extraction logic is their job.
- `apps/web/**` — no composition-root binding exists yet for any of these ports; out of scope.
- `learnerProfiles.save()`'s existing semantics and any session-open/package-pin check on it — left
  for 6.4.
- Any locale/age gate on learner-profile writes — flagged, not implemented (see above).

## Tests first
1. `packages/db/test/mastery.test.ts` — BKT formula, pure, no DB.
2. `packages/db/test/profile-store.int.test.ts` — `get` defaults a fresh profile (`lang: 'en'`,
   empty mastery/mistakes); `applyEvidence` updates named topics' mastery idempotently (same
   events applied twice ⇒ identical mastery, each `evidence_events` row written once);
   `mistakes`/`lastSummary` untouched; scope violations (other student/teacher, unowned topic)
   rejected as today.
3. `packages/db/test/teacher-question-store.int.test.ts` — `open()` idempotent for identical
   (student, teacher, agent, text); concurrent opens (simulating the 3.7/3.17 race) converge on one
   row; `findSimilar` scoping unchanged.
4. `packages/queue/test/adapters.test.ts` — `queuedProfileStore` enqueues once per call with a
   deterministic job id; scope violations rejected before enqueue.
5. `apps/worker/src/commit/processors.test.ts` — evidence job: `written` then `already_written`;
   malformed payload ⇒ `PermanentJobError`.
6. `apps/worker/test/commit.int.test.ts` — real Redis + Postgres: a replayed evidence job updates
   mastery once; a duplicated teacher-question open lands once.
7. `packages/harness/src/pipeline/steps/commit.test.ts` — `applyEvidence` called only when
   `record.evidence` is non-empty; fallback open called only when `teacherQuestionId` is absent and
   move is `ask_teacher`, never when it is already set; a canary assertion that no answer key or
   locked text reaches `evidence_events`/`teacher_questions` (trivially true given their schemas,
   asserted anyway per the "answer key and locked text must never enter the profile" rule).

## Risky paths touched (checked against risk-paths.txt)
- `packages/db/src/repositories/**` — reviewers: security-reviewer.
- `packages/db/migrations/**` (new dedup index) — not auto-flagged by risk-paths.txt (only
  drop/delete migrations are detected), but matching 3.8/3.16 practice for a schema+idempotency
  change: reviewers: database-reviewer.
- No `packages/contracts/**`, `packages/harness/src/pedagogy/**`, `.claude/**`,
  `apps/web/src/auth/**`, `packages/payments/**` touched.
- **Reviewers for this PR: security-reviewer, database-reviewer.**

## risk: high decisions planned for the handoff
1. TeacherQuestion fallback-open dedup via a new partial unique index + insert-or-return-existing
   (schema change in a reviewed path).
2. No locale/age (DPDP) gate exists yet on any learner-profile write; flagged for a dedicated M6
   task before an India pilot (per the 18 Oct decision's note for "1.7 and M6").
(Medium, reversible: evidence shipped as plumbing with no real producer yet; mastery-only write
avoids `last_summary` structurally rather than adding a session-open check.)

## Open question (carrying a recommendation)
Should 3.17 add a locale/age gate on learner-profile writes now, given the DPDP note? 
**Recommendation: no** — out of scope per deps (only 3.8), would need a `ProfileStore`
contracts change (ADR) disproportionate to a plumbing task, and `buildContext` already reads
profiles regardless of this task. Log it `risk: high` and ask the lead to schedule a dedicated M6
task instead of blocking this one.

**READY**

## Lead answers (19 Oct 2026, after the security plan review: READY TO BUILD)

- DPDP and minors: agreed, it's out of scope here. Board task 6.0b now exists (the DPDP gate for learner memory, before any India pilot); log the gap risk: high, pointing at 6.0b.
- Idempotency: the content-hash id must use the event's ORIGINAL timestamp, never one re-stamped on retry. Say so in a code comment and in the handoff. The queue job id and the repository's per-event id use ONE shared serialisation function (fixed field order and encoding), with a test that both produce the same id.
- Reviewers: security-reviewer (repositories) and database-reviewer (the migration), both sonnet. risk: high entries for the TeacherQuestion dedup index and the DPDP gap.
- Build: tdd-guide on sonnet.
