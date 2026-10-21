# Task 6.2 — Evidence events, BKT mastery per (student, teacher, topic), rebuild

Board: milestone M6 · deps `5.6` (done), `6.1` (done), `M3` (done) · branch
`m6/6.2-mastery-rebuild` · **risky** (`packages/db/src/repositories/**`) · one phase, one builder.

## Acceptance (verbatim, `docs/board/tasks.yaml`)

Title: "Evidence events, BKT mastery per (student, teacher, topic), rebuild"
Accept: "matches hand-computed values to 3 decimals."

Build-plan detail (line 443): "**Mastery:** Bayesian Knowledge Tracing per (student, teacher,
topic), defaults `pInit 0.2, pLearn 0.15, pSlip 0.1, pGuess 0.2`, updated only from scored evidence
(checks, practice items, rubric feedback)."

### How it is shown (paste into handoff.md)
A unit test (`packages/db/test/mastery.test.ts`, extended) feeds a fixed, ordered list of
`EvidenceEvent`-shaped `{topicId, correct, ts}` triples through `foldMastery`/a new `rebuildFrom`
helper (see Design) and asserts the resulting `{p, n}` per topic equals this plan's hand-computed
values **to 3 decimals** (`toBeCloseTo(x, 3)`). A second, integration-level test
(`packages/db/test/profile-store.int.test.ts`, extended) seeds the same ordered events as real
`evidence_events` rows (out of order by insertion, in order by `ts`), calls the new
`learnerProfilesRepo.rebuildMastery(scope)`, and asserts the stored `learner_profiles.mastery` row
matches the same 3-decimal values — proving the rebuild path (full replay from `evidence_events`)
agrees with the pure fold and with 3.17's existing incremental `applyEvidenceMastery` path for the
same event history.

## State of the world (read, not assumed) — most of 6.2's title is already built

Task 3.17 (done, `m3/3.17-profile-evidence`) already shipped, and this task reuses rather than
rebuilds:
- **Evidence events:** `EvidenceEventSchema`/`LearnerProfileSchema` (`@edmate/contracts`'s
  `src/memory.ts`); `evidenceEventsRepo.append` (append-only, idempotent by content-hash id,
  topic-ownership checked, `packages/db/src/repositories/learner.ts`); the `evidence_events` /
  `learner_profiles` tables (`packages/db/src/schema/learning.ts`).
- **BKT mastery:** `packages/db/src/mastery.ts` — `BKT_DEFAULTS` (`pInit 0.2, pLearn 0.15, pSlip
  0.1, pGuess 0.2`, exactly build plan §443), pure `applyBkt` (one update) and `foldMastery`
  (applies an ordered batch), both already unit-tested in `packages/db/test/mastery.test.ts`.
- **Per (student, teacher, topic), incremental:** `learnerProfilesRepo.applyEvidenceMastery`
  folds newly-appended events into the stored `mastery` map under a row lock (no lost updates);
  wired end-to-end through `profileStoreFor.applyEvidence` → the queue → `commit`'s
  `evidence.apply` worker job.
- **Topic map (6.1, done):** `buildTopicMap` validates a course outline's topic graph in
  `packages/harness`, but **evidence's own topic ownership check is already done at the DB layer**
  (`evidenceEventsRepo.append`/`applyMastery`/`applyEvidenceMastery` all join `topics` on
  `teacher_id` before writing) — this task does not need to call into `packages/harness`'s
  `TopicMap` at all; the two "does this topic id exist, and is it this teacher's" checks are
  separate, already-adequate layers (DB-side row ownership vs. harness-side outline structure).

**What is missing, and is this task's actual scope:** a **rebuild** path — nothing today recomputes
a learner profile's mastery from its *complete* `evidence_events` history. 3.17 only ever folds
*newly appended* events onto whatever `mastery` already happens to be stored; there is no function
anywhere (checked: no `rebuild`/`replay` hit in `packages/db`, `packages/harness` or
`packages/contracts`) that discards stored mastery and recomputes it from scratch by replaying
every event a (student, teacher) pair has ever produced, in event order. That is the gap the board
title's word "rebuild" names, and it is also the natural vehicle for the "hand-computed to 3
decimals" accept line: hand-computing a short, fixed, *ordered* event sequence through the published
BKT formula and asserting the rebuild path reproduces it exactly is a clean, deterministic test
(`foldMastery` is already pure and side-effect-free, so this is mostly plumbing, not new maths).

### No real evidence *producer* exists yet, and this task does not add one
5.6 (done) ships `practice.next_item` (serves an item, keeps the answer key server-side) but no
answer-checking/scoring tool exists anywhere in `packages/harness/src/tools` — grepped, no hit for
`check_answer`/`checkAnswer`/`EvidenceEvent` in `tools/**`. So, as 3.17's handoff already flagged,
**still nothing upstream produces a real, topic-scoped `EvidenceEvent` from a live turn** — grading
a student's practice answer is not named by 5.6's accept line ("items map to the outline's topics;
answer keys never reach the client") or by 6.2's. Wiring a scoring tool that calls
`profiles.applyEvidence` is a separate, future task (flagged as a follow-up below, Q1); 6.2's tests
use directly-constructed `EvidenceEvent` fixtures, exactly as 3.17's own tests already do.

## Design

### `learnerProfilesRepo.rebuildMastery(scope): Promise<LearnerProfile>`
New method, same file/pattern as `applyEvidenceMastery` (`packages/db/src/repositories/learner.ts`):
1. In one transaction, lock the scope's `learner_profiles` row (insert the default row first if
   none exists yet, `ON CONFLICT DO NOTHING`, then `SELECT ... FOR UPDATE` — same two-step pattern
   `applyEvidenceMastery` already uses, so a concurrent `applyEvidence` and a rebuild can never
   interleave a partial read).
2. Read **every** `evidence_events` row for the scope (`WHERE teacher_id = $1 AND student_id = $2`,
   no `LIMIT` — pilot scale is small; flagged as Q2 below for a future cap), ordered by `ts ASC,
   id ASC` (the second key is the deterministic tie-break for same-timestamp events — same
   "tie-break for determinism" convention 6.1's `topicOrder` already uses).
3. Fold them from **empty** mastery (`foldMastery({}, events)`), not from the row's current
   mastery — a rebuild discards whatever is stored and recomputes from the append-only log, so it
   also recovers from a corrupted/stale `mastery` jsonb value, independent of 3.17's incremental
   path.
4. `UPDATE ... SET mastery = <result>, updated_at = now()` — same narrow `SET` list as
   `applyMastery`/`applyEvidenceMastery` (never touches `mistakes`/`last_summary`).
5. Return the rebuilt `LearnerProfile` (same shape `get()` returns).

No new `BktParams` argument: `rebuildMastery` always uses `BKT_DEFAULTS`, same as every existing
caller (Q3 below covers whether a future param-tuning tool should override this — not now).

### No contracts change
`rebuildMastery` is a `packages/db`-internal repository method, exactly like `applyMastery` and
`applyEvidenceMastery` before it (neither is on the public `ProfileStore` port in
`@edmate/contracts`'s `ports.ts` either). `ProfileStore.get`/`applyEvidence` are unchanged.
`git diff origin/main -- packages/contracts` will be empty. No ADR needed.

### No `packages/harness` change
Nothing in this task's scope touches `packages/harness` — the rebuild lives entirely in
`packages/db`, read directly by its own tests (same layer 3.17's `mastery.test.ts` and
`profile-store.int.test.ts` already operate at). **This means 6.2 does not conflict with 5.8 Phase
B, which is building in `packages/harness/src/pedagogy/**`, `policy`, `compose` and `personas`
right now** — 6.2 touches zero files under `packages/harness`, so the two can run concurrently with
no shared-file risk at all (stronger than 6.1/7.7's "small footprint, don't run concurrently"
caution — this task simply isn't in that package).

## Hand-computed BKT reference values (to 3 decimals)

Formula (`packages/db/src/mastery.ts`'s `applyBkt`, unchanged by this task), parameters
`BKT_DEFAULTS` (build plan §443): `pInit = 0.2, pLearn = 0.15, pSlip = 0.1, pGuess = 0.2`.

```
pObs = correct
  ? pBefore·(1−pSlip) / (pBefore·(1−pSlip) + (1−pBefore)·pGuess)
  : pBefore·pSlip     / (pBefore·pSlip     + (1−pBefore)·(1−pGuess))
p = pObs + (1−pObs)·pLearn
```

**Topic A, 3 events in order (correct, correct, incorrect), starting from no prior (`pInit`):**

| Event | correct | pBefore | pObs (exact fraction) | p (exact fraction) | p (3 dp) | n |
|---|---|---|---|---|---|---|
| 1 | true | 0.2 (1/5) | 9/17 ≈ 0.529412 | 51/85 = 3/5 | **0.600** | 1 |
| 2 | true | 0.6 (3/5) | 27/31 ≈ 0.870968 | 138/155 ≈ 0.890323 | **0.890** | 2 |
| 3 | false | 138/155 ≈ 0.890323 | 69/137 ≈ 0.503650 | 396/685 ≈ 0.578102 | **0.578** | 3 |

**Topic B, 1 event (incorrect), starting from no prior:**

| Event | correct | pBefore | pObs | p (exact) | p (3 dp) | n |
|---|---|---|---|---|---|---|
| 1 | false | 0.2 | 0.02/0.66 ≈ 0.030303 | ≈ 0.175758 | **0.176** | 1 |

These are the asserted values (`toBeCloseTo(0.6, 3)`, `toBeCloseTo(0.890, 3)` — careful: 0.890323
rounds to 0.890 at 3 dp, not 0.89032 — `toBeCloseTo(p, 3)` checks `|actual − expected| < 1.5e-3`, so
assert the full un-rounded expected value e.g. `0.8903225806451613`, not the already-rounded
`0.890`, to keep the test meaningful at the 3rd decimal) in both the pure-fold test and the
rebuild-from-Postgres integration test, for topics A and B in the same (student, teacher) scope,
events inserted out of chronological order (to prove `rebuildMastery`'s `ORDER BY ts, id` — not
insertion order — drives the fold).

## Files

- **Modify:** `packages/db/src/repositories/learner.ts` — add `rebuildMastery`.
- **Modify:** `packages/db/src/repositories/ports.ts` — none required (not on `ProfileStore`); if
  the builder finds a reason to expose it through a port, that is new scope — stop and flag, don't
  add silently.
- **Modify:** `packages/db/test/mastery.test.ts` — pure fold test with the table above.
- **Modify:** `packages/db/test/profile-store.int.test.ts` — integration rebuild test (real
  Postgres), out-of-insertion-order seeding.
- **Modify:** `packages/db/test/repositories.int.test.ts` — one isolation-grid case for
  `rebuildMastery` (38th method), matching 3.17's own precedent for every new repo method.
- **Modify:** `packages/db/src/index.ts` / `src/repositories/index.ts` — export `rebuildMastery` if
  it needs to be reachable outside the repo factory (likely not — it is a method on the object
  `learnerProfilesRepo(db)` already returns, no new top-level export needed).
- **Modify:** `docs/tasks/6.2/handoff.md` (end of task, by the builder).

## Files out of bounds

- `packages/contracts/**`, `docs/adr/**` — no contracts change (Design, above).
- `packages/harness/**` — untouched entirely (Design, above); in particular
  `packages/harness/src/pedagogy/**`/`policy`/`compose`/personas, where 5.8 Phase B is building.
- `packages/harness/src/tools/practice.ts`, any new answer-checking/scoring tool — out of scope
  (Q1 below); 6.2's tests use directly-constructed `EvidenceEvent` fixtures, not a live turn.
- `packages/db/migrations/**` — no schema change; both tables and all needed indexes
  (`evidence_events_teacher_id_student_id_idx`) already exist from 3.17/earlier.
- Any locale/age (DPDP) gate on learner-profile reads/writes — **task 6.0b, India-only, parked**
  per the pilot being US-only; 3.17 already logged this gap as `risk: high` pointing at 6.0b, and
  this task does not newly change that (a rebuild replays the same already-stored events the
  incremental path already wrote; it exposes nothing an India session doesn't already carry today).
  Noted, not a blocker for this US-only task.
- `BktParams` tuning / a non-default `k` argument — out of scope (Q3 below).

## Tests first

1. `packages/db/test/mastery.test.ts` — the two hand-computed tables above, pure (`foldMastery`
   from `{}`), asserting the exact un-rounded fractions via `toBeCloseTo(x, 3)`.
2. `packages/db/test/profile-store.int.test.ts` — seed the same events as real `evidence_events`
   rows out of chronological insertion order; call `rebuildMastery`; assert the stored
   `learner_profiles.mastery` matches; assert a pre-existing (stale/corrupted) `mastery` value is
   fully discarded, not merged; assert `mistakes`/`last_summary` are untouched (same invariant
   `applyEvidenceMastery` already guards); scope violation (another student/teacher) rejected.
3. `packages/db/test/repositories.int.test.ts` — isolation-grid case for `rebuildMastery`.
4. A concurrency case (optional, nice-to-have if budget allows): `rebuildMastery` and a concurrent
   `applyEvidenceMastery` for the same scope never interleave (the row lock already guarantees
   this structurally; a test is confirmation, not new behaviour — cut first if the builder is tight
   on budget).
- **Gate:** `corepack pnpm turbo run typecheck lint test --filter=@edmate/db...` (Postgres up via
  `docker compose -f docker/compose.yaml -f packages/db/test/compose.port.yaml up -d postgres`).
- **Size:** 1 new method + 3 test files extended, no new files, one phase, an estimated 50–70
  builder tool calls (small, mostly reusing 3.17's existing transaction/lock pattern verbatim).

## Risky paths touched (checked against `.claude/skills/merge-gate/risk-paths.txt`)

- `packages/db/src/repositories/**` matches the security-reviewer group (lines 29-39 of
  `risk-paths.txt`: "money... sign-in, keys, keeping each teacher's and student's data apart").
  **Reviewers for this PR: security-reviewer** (plus the default code-reviewer/typescript-reviewer
  that run on every PR). No `packages/contracts/**`/`docs/adr/**`/`.claude/**` touched, so the
  architect/typescript-reviewer-for-contracts group and the harness-pedagogy/guardrails group do
  not apply.
- Per CLAUDE.md rule 6, this risky-path touch means the handoff must log a `risk: high` decision
  (planned below) even though the change itself is small and additive (a new read-and-replace
  method, same lock pattern as an already-reviewed one) — matching 3.17's own precedent of logging
  `risk: high` for its repositories-layer changes.

## Open questions (each with a recommendation)

- **Q1. Should 6.2 also add the practice-answer-scoring tool that would give `applyEvidence` (and
  therefore `rebuildMastery`) a real producer?** Recommend: no — neither 5.6's nor 6.2's accept
  line asks for scoring/grading; it is new tool-registry surface in `packages/harness/src/tools/**`
  (today only `practice.next_item` exists, no answer-checking), a materially different and larger
  task. Flag as a follow-up board task (something like "6.2a / 5.6b: practice answer scoring →
  EvidenceEvent") once the lead is ready to prioritise it — until then, `commit`'s
  `applyEvidence` call stays dormant in production (3.17's own, already-accepted state), exercised
  only by tests with hand-built fixtures.
- **Q2. Should `rebuildMastery`'s `evidence_events` read have a cap (e.g. `LIMIT` + cursor), given
  the table is append-only and could grow large per student over a teacher's lifetime?**
  Recommend: no cap for this task — pilot scale (US-only, early access) makes this a
  premature optimisation; add a defensive upper bound (e.g. reject/paginate past N events) only if
  a later load test shows it matters. Low risk, reversible.
- **Q3. Should `rebuildMastery` accept an optional non-default `BktParams` (e.g. for a future "what
  if we tuned pSlip" admin tool)?** Recommend: no — nothing today calls `rebuildMastery` with
  anything but `BKT_DEFAULTS`; adding a parameter with no caller is speculative. If param tuning is
  ever wanted, it is a small, additive follow-up (default stays `BKT_DEFAULTS` for compatibility).
- **Q4. Is a rebuild ever triggered operationally (an admin script/CLI/studio button), or only ever
  called directly by tests in this task?** Recommend: tests only, for 6.2 — no `apps/web` or
  `packages/cli` wiring exists to call it from, and none is asked for by the accept line. An
  operational trigger (e.g. "recompute this student's mastery" in a future trust-team console or
  CLI) is a separate, later task once such a surface exists.

## Decisions (draft for the handoff)

### Rebuild is a `packages/db`-internal method, not a `ProfileStore` contracts change
Decided: `learnerProfilesRepo.rebuildMastery(scope)` is added the same way 3.17 added
`applyMastery`/`applyEvidenceMastery` — a repository-layer method, not a new `ProfileStore` port
method. No ADR.
Why: nothing calls it from outside `packages/db`'s own tests yet (Q4); matches the existing
precedent for this file's non-port-exposed methods.
risk: low

### `risk: high` — new write path in `packages/db/src/repositories/learner.ts` (risky path)
Decided: ship `rebuildMastery`, logged `risk: high` per the merge gate's rule for any
`packages/db/src/repositories/**` change, reviewed by security-reviewer.
Why: the risk-paths group requires it regardless of the change's actual size; matches 3.17's own
logged precedent for the same file.
risk: high

## Budget: 35 tool calls

## Allowed tools

Read, Grep, Glob, Write (plan file only), Bash (read-only: `git log`, `git diff --stat`, package
manager commands only if strictly needed to confirm an export — expected not to be needed for a
planning task).

## Exit conditions

- READY once this plan is reviewed and the lead has answered Q1-Q4 (defaults above are safe to
  proceed without blocking: none opens a spec conflict or an unclear-requirement block).
- BLOCKED only if the lead disagrees that "rebuild" (not re-deriving already-built evidence/BKT
  machinery) is 6.2's real remaining scope, or wants the practice-scoring producer (Q1) folded into
  this task instead of split out.

## Lead answers (21 Oct 2026)
All four defaults accepted: no practice-answer scoring tool here (a separate follow-up); no cap on the rebuild's evidence read at pilot scale; default BKT parameters only; rebuild is test-only for now (no CLI or console trigger). Decided by lead · risk: low.
