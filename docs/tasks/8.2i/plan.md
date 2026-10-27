# 8.2i plan: 8.2h review follow-ups (sweeper, compare-and-set, Host/SNI, address.ts docs, ADR-0014 wording)

## Acceptance (verbatim, board)
> each follow-up has a test where code changes; touched packages green.

How shown: each phase's handoff names the test(s) added/changed for its code changes (Phase C's
address.ts comment and the ADR wording need no new test, since no code behaviour changes), plus a
green `corepack pnpm turbo run typecheck lint test --filter=<touched packages>...` and a clean
`python3 .githooks/secret-scan.py --all`, quoted in the handoff.

## Source context
- `docs/tasks/8.2h/handoff.md` (`## Left to do`, `## ADR-0014 wording the lead should change`)
- `docs/tasks/8.2h/review.md` (4 deferred findings, this task's exact scope)
- `docs/adr/0014-web-link-egress.md` (Decisions 1, 6, 9)
- Board `8.2i` (`python3 .claude/skills/board/board.py show 8.2i`): four follow-ups, `risk: high`.

## Design

Three independently mergeable phases, each its own branch/PR/handoff off `main` (8.2h is already
merged). No shared files between phases; each phase's builder reads this plan plus the previous
phase's handoff (for A->B only; C is independent of A and B).

### Phase A — atomic compare-and-set for the failed write (review MEDIUM)
Replaces processor.ts's re-read-then-write in `failWith` with one atomic UPDATE, closing the
window the 8.2h handoff flagged (a replace landing between the re-read and the write).

- **packages/db/src/repositories/chunks.ts**: add `documentsRepo(db).failIfStorageKey(scope,
  id, expectedStorageKey, failureReason)`. Same shape as `updateStatus`'s `failed` branch
  (`STATUS_FROM.failed = ['uploading', 'processing']`, `FailureReasonSchema`-checked reason,
  teacher-scoped), plus `and(eq(documents.storageKey, expectedStorageKey), ...)` in the one WHERE
  clause. Returns `{ updated: boolean }` instead of throwing `not_found` on no match (a storageKey
  mismatch, a wrong current status, a missing row and another teacher's row all look like one
  ordinary "someone else owns this now" outcome here, not an error) — this is a new method, not a
  behaviour change to `updateStatus`, which keeps its own (already-relied-on) throw. A genuine db
  error still throws, unwrapped by `guarded`/`translateWrite` as elsewhere in this file.
  `expectedStorageKey` is typed `string` (never `null`): both call sites (Phase A's processor,
  Phase B's sweeper) only ever call this after confirming the document has a stored file.
- **packages/db/src/repositories/index.ts**: no new export needed — `failIfStorageKey` is just
  another method on the existing `documents` repo, already covered by `guardAll('documents', ...)`
  and already exported as part of `Repositories`/`RepositoryMethod`.
- **packages/db/test/repositories.int.test.ts**: add a `documents.failIfStorageKey` case to the
  isolation case table (next to the existing `documents.updateStatus` case around line 361): one
  teacher's `failIfStorageKey` call must not affect another teacher's row, and a wrong teacherId
  looks like `{ updated: false }`, not `not_found` (new method, no throw on a scope miss either —
  check the existing isolation harness's expectation shape for a method that returns a value
  instead of throwing, and match it).
- **packages/db/test/documents.int.test.ts**: tests for `failIfStorageKey` — matches and updates
  (storageKey + status + reason), storageKey mismatch is a no-op (`updated: false`, row unchanged),
  wrong current status (e.g. already `ready`) is a no-op, missing/other-teacher id is a no-op.
- **apps/worker/src/ingest/processor.ts**: `failWith` drops `deps.repos.documents.get` plus its
  `current?.storageKey !== startedWith` check and calls `failIfStorageKey(scope, documentId,
  startedWith, code)` once; `{ updated: false }` is `staleSkip()`, same as before. The doc comment
  above `failWith` (lines ~223-229) is reworded: this is now one atomic write, not a re-read-then-
  write, so there is no window left between a check and a write.
- **apps/worker/src/ingest/processor.test.ts**: the 8.2h tests that assert the re-read behaviour
  (replace mid-flight, deleted row, db outage) still pass with the same expected outcomes, but the
  fake repo now needs `documents.failIfStorageKey` instead of (or alongside, if `get` is still
  used elsewhere in these tests) a scripted `documents.get` + `documents.updateStatus` pair; the
  "db outage on the re-read" test becomes "db outage on the atomic failed write" (rename, same
  rethrow-for-retry assertion).

### Phase B — stuck-`processing` sweeper (Left to do; depends on Phase A's `failIfStorageKey`)
A new cross-teacher read (no signed-in teacher or student is asking; a scheduled job is), modelled
on `packages/db/src/repositories/retention.ts` (same "deliberately outside `createRepositories`,
not in the isolation grid" pattern), plus one scheduled BullMQ job modelled on the single-file
`apps/worker/src/alarms/schedule.ts` (not retention's 4-file split — this job is simple enough for
one file).

- **packages/db/src/repositories/ingestSweep.ts** (new): `ingestSweepRepo(db)` with one method,
  `staleProcessing(cutoff: Date, limit = INGEST_SWEEP_LIMIT): Promise<StaleProcessingDocument[]>`
  — `id`, `teacherId`, `storageKey` for documents where `status = 'processing'`, `updatedAt <
  cutoff`, `storageKey is not null`, ordered oldest-first, capped at `limit` (mirror
  `RETENTION_PURGE_LIMIT`'s size and the oldest-first + limit shape, not the delete/dry-run parts
  — this is read-only). `StaleProcessingDocument = { id: string; teacherId: string; storageKey:
  string }`.
- **packages/db/src/repositories/index.ts**: export `ingestSweepRepo`, `INGEST_SWEEP_LIMIT`,
  `type StaleProcessingDocument` from `./ingestSweep.js`, with the same short "scheduled job, not
  a signed-in scope; deliberately outside `createRepositories`" comment style as the `retention`
  export block (~line 344).
- **packages/db/test/ingest-sweep.int.test.ts** (new): returns only `processing` rows older than
  cutoff across teachers; excludes `ready`/`failed`/`uploading` rows and rows with a null
  storageKey (`teacher_note`); respects `limit` and oldest-first order.
- **apps/worker/src/ingest/sweep.ts** (new): one file, mirroring `alarms/schedule.ts`'s shape —
  - `INGEST_SWEEP_QUEUE`, `INGEST_SWEEP_SCHEDULER_ID`, `INGEST_SWEEP_JOB`, `INGEST_SWEEP_PATTERN`
    (recommended `*/15 * * * *`, every 15 minutes — see Questions), `INGEST_SWEEP_JOB_OPTIONS`.
  - `scheduleIngestSweep(queue, pattern)` — `upsertJobScheduler`, idempotent, same shape as
    `scheduleCostAlarm`.
  - `ingestSweepJob(deps)` — one run: compute `cutoff = now - STUCK_PROCESSING_MINUTES` (recommend
    30 minutes; see Questions), call `ingestSweep.staleProcessing(cutoff, limit)`, and for each row
    call `documents.failIfStorageKey({ teacherId: row.teacherId }, row.id, row.storageKey,
    'provider_error')`; loop while a full page came back (like `purgeTable`'s loop), capped at a
    `MAX_ITERATIONS` so one run can't loop forever. Log one line per run (`marked`, `skipped`
    [`updated: false`, i.e. it moved on since the read], `cutoff`, `pages`); a per-row
    `failIfStorageKey` throw is logged and the run continues to the next row (one stuck document's
    db error must not stop the whole sweep), with the run still failing (so BullMQ retries) if any
    row's call threw.
  - `createIngestSweepWorker(opts)` — `Worker(INGEST_SWEEP_QUEUE, ...)`, `onJobFailed` dead-letter
    wiring, same shape as `createCostAlarmWorker`/`createRetentionWorker`.
- **apps/worker/src/ingest/sweep.test.ts** (new): `ingestSweepJob` marks only rows where
  `failIfStorageKey` returns `updated: true`; a row that comes back `updated: false` is logged
  skipped, not retried as an error; a per-row throw is logged and the run still processes the rest
  of the page but the job rejects; `scheduleIngestSweep` calls `upsertJobScheduler` with the right
  id/pattern/job name (mirror `retention/schedule.test.ts`'s shape for the equivalent cases).
- **apps/worker/src/index.ts**: wire the new queue, worker and schedule call the same way
  `retention`/`costAlarm` are wired (new `Queue(INGEST_SWEEP_QUEUE, ...)`, `createIngestSweepWorker`
  with `db.documents` and the new `db` sweep repo, add to the shutdown list, call
  `scheduleIngestSweep(...).catch(...)` at startup). Read the existing retention/cost-alarm wiring
  lines first and match their exact shape (connection, prefix, autorun, close-on-shutdown).

Phase B's `ingestSweepRepo` needs its own `Db`-level wiring wherever `openDatabase()` assembles
`retention` (check `packages/db/src/client.ts` or wherever `retention` is attached) so
`apps/worker/src/index.ts` can reach it the same way it reaches `db.retention`.

### Phase C — the three LOW fixes (independent of A and B)
- **apps/worker/src/webLink/pinnedTransport.ts** (`pinnedRequestOptions`, ~line 66-81): the `host`
  Host header Node derives from `req.url` (passed untouched to `https.request`) keeps any trailing
  dot, while SNI's `servername` already uses `bareHostName(host)` (every trailing dot stripped).
  Fix: add `host` to the returned `headers` object explicitly (`headers: { ...req.headers, host }`,
  using the same `host` constant the SNI line already computes), so the wire's Host header and SNI
  name always agree.
- **apps/worker/src/webLink/pinnedTransport.test.ts**: a new case — a trailing-dot host (e.g.
  `teacher-site.test.`) produces a request whose `options.headers.host` equals the bareHostName
  value (no trailing dot), matching the existing SNI test for the same input.
- **packages/ingest/src/fetch/address.ts** (`systemResolveHost`, ~line 119-157): comment-only — add
  a sentence documenting the all-transient-failure path explicitly: when every query settles
  rejected (no family ever answered with addresses), `graceOver` never resolves, `grace` is never
  armed, both queries are awaited through `Promise.allSettled`, and the thrown code is the first
  non-`NO_SUCH_NAME` rejection code (or `ENOTFOUND` if every rejection happened to be a
  `NO_SUCH_NAME` code, which should not occur for two different families but is the safe fallback).
  No behaviour change; no new test (nothing to assert that isn't already covered — this is
  documentation only, per the review's LOW).
- **docs/adr/0014-web-link-egress.md**: the three wording edits the 8.2h handoff already drafted
  verbatim:
  - Decision 1 (~line 23): "TLS SNI and the certificate check use the URL's host name" ->
    "... use the URL's host name with every trailing dot stripped; a host ending in an empty label
    (`example.org..`) is refused as an invalid URL."
  - Decision 6 (~line 40): "The resolver allows 5 s per query and 2 tries, inside that 15 s." ->
    "The resolver allows 2 s per query and 2 tries (at most 6 s per family, inside that 15 s); once
    one family answers with addresses, the other gets 500 ms before the lookup is cancelled and its
    answers are treated as missing."
  - Decision 9 / consequences (~line 48): add "A link job gets 2 attempts (file jobs keep 5), so a
    slow site can hold the one ingest slot for at most two fetch deadlines."
  - Also add one line noting the Host-header fix (Phase C above) so the ADR's SNI wording and the
    Host header stay in sync, if the builder reaches this after Phase C's pinnedTransport edit
    lands (same PR, so it will have).
  No test (prose only); the change still needs architect, security-reviewer and
  typescript-reviewer per the risky-paths rule below.

## Files

### Phase A
- Modify: `packages/db/src/repositories/chunks.ts`
- Modify: `packages/db/test/repositories.int.test.ts`
- Modify: `packages/db/test/documents.int.test.ts`
- Modify: `apps/worker/src/ingest/processor.ts`
- Modify: `apps/worker/src/ingest/processor.test.ts`

### Phase B
- Create: `packages/db/src/repositories/ingestSweep.ts`
- Modify: `packages/db/src/repositories/index.ts`
- Create: `packages/db/test/ingest-sweep.int.test.ts`
- Create: `apps/worker/src/ingest/sweep.ts`
- Create: `apps/worker/src/ingest/sweep.test.ts`
- Modify: `apps/worker/src/index.ts`
- Modify (only if `retention` is attached there): wherever `openDatabase()` assembles its
  repositories (check `packages/db/src/client.ts` first)

### Phase C
- Modify: `apps/worker/src/webLink/pinnedTransport.ts`
- Modify: `apps/worker/src/webLink/pinnedTransport.test.ts`
- Modify: `packages/ingest/src/fetch/address.ts` (comment only)
- Modify: `docs/adr/0014-web-link-egress.md` (prose only)

## Files out of bounds
- No migration file: every change in this task reads/writes existing columns (`status`,
  `storage_key`, `updated_at`) with new queries, not a new column or table. If a builder finds a
  migration is actually needed, stop and ask — the next free number is **0038** (0037 is claimed
  by the in-flight 6.5a; confirm against `packages/db/migrations/` on `main` before using it, since
  12.2f may also be mid-flight).
- `packages/db/src/repositories/documents.ts` does not exist — the real file is
  `packages/db/src/repositories/chunks.ts` (`documentsRepo` lives there); don't create a new file.
- Do not touch `packages/db/src/repositories/publish.ts`, `discovery.ts`, `teacher-profiles.ts`,
  `subscriptions.ts`, `audit.ts`, `usage-ledger.ts`, `reports.ts`, `map.ts` or any other
  repositories file not listed above (6.5a, 12.2f and 13.regate touch other files in this same
  risky directory; stay out of their way).
- Do not touch `packages/db/migrations/**`, `apps/web/**`, `apps/worker/src/alerts/**`,
  `apps/worker/src/commit/**`, `apps/worker/src/gate/**`, `apps/worker/src/retention/**`,
  `apps/worker/src/alarms/**`, `apps/worker/src/insights/**`, `packages/queue/**`,
  `content/prompt-packs/**`, `packages/harness/**`.
- Do not fill in contact details, helpline numbers or reviewer names anywhere.

## Tests first
- Phase A: write the failing `documents.failIfStorageKey` unit cases and the updated
  `processor.test.ts` cases before touching `chunks.ts`/`processor.ts`.
- Phase B: write `ingest-sweep.int.test.ts`'s `staleProcessing` cases and `sweep.test.ts`'s job
  cases before `ingestSweep.ts`/`sweep.ts`.
- Phase C: write `pinnedTransport.test.ts`'s new Host-header case before the `pinnedTransport.ts`
  one-line fix. The address.ts and ADR edits are prose only — no test to write first.

## Risky paths touched (checked against `.claude/skills/merge-gate/risk-paths.txt`)
- `packages/db/src/repositories/**` (Phases A, B: `chunks.ts`, `index.ts`, `ingestSweep.ts`) ->
  reviewers: **security-reviewer**.
- `docs/adr/**` (Phase C: `0014-web-link-egress.md`) -> reviewers: **architect,
  security-reviewer, typescript-reviewer**.
- `apps/worker/src/ingest/**`, `apps/worker/src/webLink/**`, `apps/worker/src/index.ts`,
  `packages/ingest/**`: not listed in risk-paths.txt (not `alerts/**`, not `access/**`, not
  `harness/**`) -> no extra required reviewers beyond the usual `code-reviewer`.
- Each phase's handoff needs a `risk: high` decision entry (this board task is `risk: high`) —
  Phases A and B for the `packages/db/src/repositories` path, Phase C for the ADR path.

## Questions (each with a recommended answer)
1. **Stuck-processing threshold and sweep cadence?** Recommend: 30 minutes in `processing` counts
   as stuck (well past the 15 s fetch deadline and 2-5 retries any single attempt chain takes);
   the sweep job runs every 15 minutes (`*/15 * * * *`). Both are named constants in `sweep.ts` so
   a later task can retune them without re-reading this plan.
2. **Mark stuck rows `provider_error` or something more specific?** Recommend: `provider_error`,
   exactly as the board task and 8.2h handoff name it — the sweeper can't know *why* a job's worker
   died mid-flight (crash, redeploy, lost connection), so a generic retryable-sounding code is
   honest; the student-facing effect is the same "failed, can retry" state `updateStatus` already
   supports.
3. **New method name: `failIfStorageKey` or a more general `updateStatusIfStorageKey`?**
   Recommend: `failIfStorageKey`, narrowed to `status: 'failed'` with a required `failureReason` —
   both real call sites (Phase A's `failWith`, Phase B's sweeper) only ever write `failed`; a
   general compare-and-set across every status is speculative scope the board task didn't ask for.
4. **Does `openDatabase()` need a new `ingestSweep` attachment point, and where?** Recommend: the
   Phase B builder greps for where `retention` is attached in `packages/db/src/client.ts` (or
   wherever `openDatabase` assembles its return value) first, and adds `ingestSweep` the same way,
   before writing `apps/worker/src/index.ts`'s wiring — this file wasn't read during planning to
   keep this plan's own tool-call count down.

## Budget
Budget: 130 tool calls (3 phases: A ~45 packages/db + apps/worker, B ~60 packages/db + apps/worker, C ~25 apps/worker + packages/ingest + docs/adr)

## Allowed tools
Read, Grep, Glob, Edit, Write, Bash (typecheck/lint/test and secret-scan only; no git push/merge
beyond the team lead's normal branch-and-PR flow).

## Exit conditions
- **DONE** per phase when: the phase's files above are created/modified as specified, its new
  tests are added and pass, its named gate command
  (`corepack pnpm turbo run typecheck lint test --filter=@edmate/db... --filter=@edmate/worker...`
  for A and B; add `--filter=@edmate/ingest...` for C) is green, `python3
  .githooks/secret-scan.py --all` is clean, and the handoff names the tests and quotes the gate
  output.
- **PARTIAL** when: the builder is past ~70 tool calls in a single phase with no green gate yet, or
  a file outside this plan's list needs changing (e.g. `openDatabase`'s assembly point turns out to
  live somewhere unexpected and touches more than the one line anticipated, or a migration turns
  out to be needed after all) — stop, write the handoff with what was found, and hand back rather
  than improvising new scope.

## Lead answers (27 Oct 2026)
- Q1: yes. 30 minutes in `processing` is stuck; the sweep runs every 15 minutes; both are named constants.
- Q2: yes, `provider_error`.
- Q3: yes, `failIfStorageKey`, narrowed to `failed` with a required `failureReason`.
- Q4: follow 13.regate (merged on main): it added a standalone `regateRepo(db)` factory in packages/db and attached it as `openDatabase().regate` in packages/db/src/index.ts, wired in apps/worker/src/index.ts. Do the same for `ingestSweep`; read those two files first.
- Branches: one branch, `m13/8.2i-ingest-followups`, and one PR for the whole task, not one per phase. A fresh builder runs each phase on the same branch, in the order **C, then A, then B**: Phase C touches no shared file and starts now; Phase A waits until 6.5a merges (both edit packages/db/test/repositories.int.test.ts). Each phase appends its own `## Phase X` section to one docs/tasks/8.2i/handoff.md.
- Phase C's ADR edit is prose only; it still needs architect, security-reviewer and typescript-reviewer at review.
