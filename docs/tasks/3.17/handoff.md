# 3.17 handoff: learner-profile evidence, ProfileStore and TeacherQuestionStore db adapters, commit wiring

- **Status:** DONE
- **Branch:** `m3/3.17-profile-evidence` (from origin/main, 3.16d merged)
- **Worktree:** `.claude/worktrees/agent-a5c4e90e6e2209728` (repo-relative)
- **Risky paths:** `packages/db/src/repositories/**` → **security-reviewer required**; `packages/db/migrations/**` (new dedup index + schema change) → **database-reviewer required** (matches 3.8/3.16 practice). No `packages/contracts/**` change, no ADR.

## Acceptance evidence

Postgres + Redis up:
```
docker compose -f docker/compose.yaml -f packages/db/test/compose.port.yaml \
  -f apps/worker/test/compose.port.yaml up -d postgres redis
```
both healthy.

`corepack pnpm turbo run typecheck lint test --filter=...@edmate/db --filter=...@edmate/harness --force` (dependents, nothing skipped):

```
Tasks:    34 successful, 34 total
```

| Package | Tests | Coverage (Stmts/Branch/Funcs/Lines) |
|---|---|---|
| @edmate/db | 478 passed | 99.81 / 98.86 / 99.69 / 100 — `src/repositories/**` 100 / 99.32 / 100 / 100 (threshold: 100/90/100/100) |
| @edmate/harness | 2681 passed | 99.26 / 98.16 / 98.24 / 99.52 |
| @edmate/queue | 26 passed | 100 / 100 / 100 / 100 |
| @edmate/worker | 106 passed | 99.26 / 99.33 / 97.01 / 99.6 — `src/commit/**` 100 / 100 / 100 / 100 |
| @edmate/evals, @edmate/content, @edmate/gateway, @edmate/cli, @edmate/web | 173 / 159 / 405 / 46 / 132 passed | all ≥ thresholds (dependents, unaffected by this task) |

`python3 .githooks/secret-scan.py --all` (absolute path) → clean, no output.

### New/extended test files
- `packages/db/test/mastery.test.ts` (new): BKT formula, pure, no DB — matches build plan §435 defaults exactly.
- `packages/db/test/profile-store.int.test.ts` (new, 9 tests): `get` default for a never-seen pair (`lang:'en'`, empty mastery/mistakes); `applyEvidence` moves mastery for the named topic, idempotent by content-hash id (same event applied twice ⇒ identical mastery, row written once); mistakes/lastSummary untouched; scope violations (another student/teacher, an unowned topic) rejected; a never-seen pair's first evidence creates the profile from scratch; `learnerProfiles.applyMastery({})` is a no-op.
- `packages/db/test/teacher-question-store.int.test.ts` (new, 6 tests): `open` idempotent for identical (student, teacher, agent, text); two *concurrent* opens (the 3.7/3.17 race) converge on one row; a different student/teacher/agent/text opens a distinct question; `moduleHint` carried through; scope violations and an unowned agent rejected; `findSimilar` scoped and returns `[]` (no embeddings search yet, see Decisions).
- `packages/db/test/migrate.int.test.ts` (extended): migration 0011's dedup index survives a re-run with existing data (no data lost — additive index only) and rejects a duplicate open question while allowing a reopen once answered (partial index).
- `packages/db/test/repositories.int.test.ts` (extended): isolation-grid case for `learnerProfiles.applyMastery` (37 methods now covered, up from 36).
- `packages/db/test/scope.test.ts` (extended): `profileStoreFor`/`teacherQuestionStoreFor` reject a bad scope at construction (isolation-grid pattern for the two new `*For` adapters).
- `packages/queue/test/adapters.test.ts` (extended): `queuedProfileStore` enqueues one job per event, deterministic job id, scope violations rejected before enqueue; `evidenceEventId` stable/distinct test; a dedicated test proving the queue job id and the row id are the *same* shared function (lead answer).
- `apps/worker/src/commit/processors.test.ts` (extended): the `evidence.apply` branch writes once (idempotent by id, no separate exists-check needed — `ON CONFLICT DO NOTHING` already makes `evidenceEvents.append` idempotent), db-outage vs. permanent-kind classification, malformed payload.
- `apps/worker/test/commit.int.test.ts` (extended): a real round trip on Redis + Postgres — a replayed evidence job updates mastery once; two concurrent `teacherQuestions.open` calls for the same question land on one row.
- `packages/harness/src/pipeline/steps/commit.test.ts` (extended, 14 tests total): `applyEvidence` called only when `record.evidence` is non-empty; the TeacherQuestion fallback opens only when `teacherQuestionId` is absent and `move === 'ask_teacher'`, never when already set or for any other move or with no text; a canary assertion that no answer key or locked text reaches evidence or the TeacherQuestion.

Explicit per-test timeouts: every new/extended integration test (`profile-store.int.test.ts`, `teacher-question-store.int.test.ts`, the new `migrate.int.test.ts` case) passes its own timeout argument rather than relying only on the suite default.

## Changes

Created:
- `packages/db/src/mastery.ts` — `BKT_DEFAULTS` (pInit 0.2, pLearn 0.15, pSlip 0.1, pGuess 0.2), `applyBkt` (pure, one update; `updatedAt` is the event's own *original* `ts`, never re-stamped), `foldMastery` (applies a batch in order).
- `packages/db/migrations/0011_teacher_question_open_dedup.sql` + `migrations/meta/0011_snapshot.json` + journal entry — partial unique index `teacher_questions_open_dedup_key` on `(teacher_id, student_id, agent_id, md5(text))` where `status = 'open'`. Plain migration (not `CREATE INDEX CONCURRENTLY`): `teacher_questions` is small and low-write, unlike `sessions` (3.16's post-migrate-step precedent). `md5(text)`, not `text`, because `text` is up to `LIMITS.turnTextMaxLength` (8000 chars), well past a btree index row's ~2.7 KB limit.
- `packages/db/test/mastery.test.ts`, `packages/db/test/profile-store.int.test.ts`, `packages/db/test/teacher-question-store.int.test.ts`.
- `packages/queue/src/profileStore.ts` — `queuedProfileStore`: `get` goes straight to the given reader; `applyEvidence` enqueues one BullMQ job *per event* (not a batch), job id `jobId.evidence(evidenceEventId(event))`.
- `packages/harness/src/pipeline/teacherQuestion.ts` — `openTeacherQuestion(store, scope, text)`, the findSimilar-then-open-then-validate logic extracted out of `runner.ts` so the live (3.7) attempt and commit's (3.17) fallback share one path.

Modified:
- `packages/db/src/repositories/learner.ts` — `learnerProfilesRepo.applyMastery` (new): a targeted upsert whose `SET` list only ever names `mastery` (merged via Postgres `||`, topic-ownership checked) and `updated_at`; `evidenceEventsRepo.append` now accepts an optional per-event `id` (dedup via `ON CONFLICT (id) DO NOTHING`) and returns only the events it actually wrote (contract shape, no `id`).
- `packages/db/src/repositories/teacher-questions.ts` — `open()` is now insert-or-return-existing on the new dedup index; because the index key includes an expression (`md5(text)`), drizzle's `onConflictDoNothing({target})` can't express it (only plain columns), so the insert is a raw `sql` template with `sql.identifier` for bare (table-unqualified) column names — Postgres rejects both a qualified `ON CONFLICT` target and a qualified INSERT column list with a plain syntax error (`42601`), discovered and fixed while writing the integration test.
- `packages/db/src/repositories/ports.ts` — `profileStoreFor` (new), `teacherQuestionStoreFor` (new).
- `packages/db/src/repositories/index.ts`, `packages/db/src/index.ts` — new exports (`profileStoreFor`, `teacherQuestionStoreFor`, `EvidenceEventEntry` type, `applyBkt`/`BKT_DEFAULTS`/`foldMastery`/types from `mastery.ts`).
- `packages/db/src/schema/learning.ts` — the new index, declared so `db:generate` stays a no-op.
- `packages/queue/src/queues.ts` — `JOB.evidence`, `EvidenceJobSchema`, `jobId.evidence`, `evidenceEventId` (the one shared serialisation function both the producer's job id and the processor's row id call).
- `packages/queue/src/index.ts` — `QueuedTurnPorts.profiles`; `queuedTurnPorts` takes a 4th `profileReader` argument.
- `apps/worker/src/commit/processors.ts` — new `evidence.apply` branch in `commitProcessor`.
- `packages/harness/src/pipeline/types.ts` — `CommitRecord.evidence?: EvidenceEvent[]` (harness-internal, not a contracts change).
- `packages/harness/src/pipeline/runner.ts` — `openTeacherQuestion` (private method) now delegates to the shared `teacherQuestion.ts` helper; no behaviour change to the live path (same doc comment moved, timeout and background-reporting stay in the runner).
- `packages/harness/src/pipeline/steps/commit.ts` — calls `profiles.applyEvidence` when `record.evidence` is non-empty; opens a TeacherQuestion via the shared helper as a fallback when `decision.move === 'ask_teacher'`, `teacherQuestionId` is unset, and there is text.
- `packages/harness/src/testing/memoryPorts.ts` — `memoryProfileStore` (new in-memory double).
- Callers of `queuedTurnPorts` updated for the new 4th argument: `packages/queue/test/latency.test.ts`, `apps/worker/test/commit.int.test.ts`.

Files touched that the plan listed but this task did not need to change: `packages/harness/src/pedagogy/**`, `packages/harness/src/pipeline/steps/route.ts`, the practice skill, the topic map, `apps/web/**` — all out of bounds per the plan, untouched.

## Deviations from the plan

- **`teacherQuestionsRepo.open`'s insert is raw SQL, not drizzle's query builder with `onConflictDoNothing`.** The plan said "the same `insertSelect`/`ON CONFLICT` family already used in this file"; drizzle 0.45's `onConflictDoNothing({ target })` only accepts plain columns, not an expression like the dedup index's `md5(text)`, so matching the index exactly (Postgres requires the `ON CONFLICT` target to match the index definition) needed a hand-written `sql` template with `sql.identifier` for bare column names. Found by running the integration test against real Postgres (two syntax errors: `42P10` invalid-column-reference, then `42601` from table-qualified names in an INSERT's column list and the conflict target).
- **`queuedProfileStore.applyEvidence` enqueues one job per event, not one job for the whole array.** The lead's answer said the queue job id and the repository's per-event id "use ONE shared serialisation function"; since `evidenceEventId` hashes a single event, the natural reading is one job per event (mirroring the existing usage-ledger precedent: one job per `Usage` row, keyed by `usageRowId(turnId, index)`), not a batch job whose id would have to be a hash-of-hashes.
- **`learnerProfilesRepo.applyMastery` also checks topic ownership** (not in the plan's file list, which named only "a mastery/mistakes-only upsert"). Without it, a patch keyed by an unowned topic id would still land (correctly) on the caller's own row — no isolation leak — but the jsonb content itself would carry a foreign topic id with no check at all at this layer. Defense in depth, cheap (same `topics` select `evidenceEventsRepo.append` already does), and it is what makes the isolation-grid write case for this new method meaningful.

## Decisions

### 19 Oct 2026 · 3.17 No locale/age (DPDP) gate on learner-profile writes yet · decided by lead (pre-build) · risk: high
Decided: ship 3.17 without a locale/age gate on `applyEvidence` or `get`; the gap is tracked by board task 6.0b (the DPDP gate for learner memory), which must land before any India pilot.
Why: `ProfileStore` has no market/age parameter — adding one here is a contracts change needing an ADR, disproportionate to a plumbing task with no real evidence producer yet (route/3.3, the practice skill/5.6 and the topic map/6.1 are all still `todo`); `buildContext` already reads whatever is in `learner_profiles` for every session today, independent of this task, so this task's write path does not newly expose anything an India 13–17 session doesn't already carry.
Alternatives: add a market/age check to `ProfileStore` now (contracts ADR); block 3.17 until 6.0b lands.
Reversible: Yes — 6.0b can add the gate without touching this task's write path.

### 19 Oct 2026 · 3.17 TeacherQuestion open-dedup via a new partial unique index + insert-or-return-existing · decided by lead (plan) and tdd-guide (the `md5(text)` expression, found while writing the migration) · risk: high
Decided: migration 0011 adds a partial unique index on `teacher_questions (teacher_id, student_id, agent_id, md5(text)) WHERE status = 'open'`; `teacherQuestionsRepo.open()` becomes insert-or-return-existing on that key, so the live (3.7) attempt and commit's (3.17) fallback — which can both try to open "the same" question for one turn, since a timed-out live attempt may still land — converge on one row instead of raising a duplicate. A plain (non-`CONCURRENTLY`) migration, unlike 3.16's session-pin indexes: `teacher_questions` is small and low-write.
Why: without this, an `ask_teacher` turn whose live open timed out (but still landed) would get a second, duplicate question from commit's fallback.
Alternatives: dedup in application code only (a read-then-write race window); index on raw `text` (would exceed btree's row-size limit for a long question); `CREATE INDEX CONCURRENTLY` via a post-migrate step (disproportionate for a small, low-write table).
Reversible: Only with a new migration and a review of any `open()` callers relying on the current raw-insert behaviour.

### 19 Oct 2026 · 3.17 Evidence idempotency: content-hash id over the original timestamp, one shared function · decided by lead (answer) · risk: medium
Decided: `evidenceEventId` (in `packages/queue`) hashes `studentId|teacherId|topicId|correct|source|weight|ts` with a fixed field order and encoding (`JSON.stringify` of a fixed-key array); `ts` must be the event's *original* timestamp, documented with a code comment at the one place it is computed (`queues.ts`) and at every call site (`profileStore.ts`'s producer, `processors.ts`'s worker). The same function is used for the BullMQ job id (`jobId.evidence`) and the row id `evidenceEventsRepo.append` writes, so a replayed job and the first attempt agree on one id. A test (`adapters.test.ts`, "jobId.evidence and the producer both derive from this one function") asserts the two call sites produce the same id for the same event.
Why: a retry must hash to the same id as the first attempt, or dedup breaks; one shared function (not two copies) removes the chance of the hash algorithm drifting between the producer and the processor.
Alternatives: a per-event id chosen by the caller (loses the "replay reproduces the same id" property unless the caller is also deterministic); separate hash functions in `@edmate/queue` and `@edmate/db` (duplication risk).
Reversible: Yes — changing the hash's field order or encoding is a one-file change, though it invalidates in-flight job ids across a deploy.

### 19 Oct 2026 · 3.17 `profileStoreFor.applyMastery`'s write path closes the 3.16 "last_summary clobbered" finding structurally · decided by lead (plan) · risk: medium, reversible
Decided: `learnerProfilesRepo.applyMastery`'s `SET` list only ever names `mastery` and `updated_at`; `mistakes` and `last_summary` are never in the statement, so this write path cannot clobber `last_summary` no matter what calls it. `learnerProfiles.save()`'s own semantics (and any session-open/package-pin check on it) are unchanged — closing this specific write path does not close the finding for `save()` in general, which is still 6.4's job (`EvidenceEvent` has no `sessionId` to check against).
Why: evidence should never erase a student's last-session summary.
Alternatives: give `applyMastery` a `save()`-style full-row overwrite (reintroduces the risk); add a session check here anyway (no session id available on `EvidenceEvent`).
Reversible: Yes.

### 19 Oct 2026 · 3.17 `TeacherQuestionStore.findSimilar` always returns `[]` for now · decided by tdd-guide (build-time finding, logged for the lead) · risk: medium
Decided: `teacherQuestionStoreFor.findSimilar` returns `[]` unconditionally (still scope-checked). No embeddings-backed similarity search exists yet in this codebase; building one is out of this task's scope (a RAG/embeddings task) and not in the plan's file list.
Why: shipping plumbing, not an invented heuristic — matches the task's own stated approach for evidence extraction.
Alternatives: a naive text-similarity heuristic (e.g. trigram overlap) now; block this task on the embeddings task.
Reversible: Yes — a later task can replace the body without changing the port's shape.

### 19 Oct 2026 · 3.17 New-profile default: `lang: 'en'`, empty mastery/mistakes · decided by tdd-guide (plan's own recommendation) · risk: low
Decided: `profileStoreFor.get`/`applyMastery` default a never-seen (student, teacher) pair to `lang: 'en'` (the pilot is English-only today).
Why: `ProfileStore.get` has no `lang` parameter (unlike `fallbackContext`'s `input.lang`), so some default is needed; English matches the current pilot.
Alternatives: default to the entitlement's market's locale (no market available at this port's level); throw instead of defaulting (breaks `buildContext`, which calls this every turn).
Reversible: Yes, once locale work lands.

## Open follow-up for the lead

6.0b (DPDP gate) should land before any India pilot ships learner-memory writes (see the first decision above) — already tracked on the board; flagging again here as the task's one item needing attention beyond this PR.
