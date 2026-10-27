# Handoff: 13.regate, Phase A

Status: DONE (Phase A)

## Summary

Added the regate sweep's candidate list, a system (unscoped) read like
`usageLedger.teacherIdsWithUsageSince` / `subscriptions.activeCountByPackage`:

- `packages/db/src/repositories/publish.ts`: `REGATE_SWEEP_MAX = 200` and a new standalone
  `regateRepo(db)` factory exporting `liveAgentsWithMaterialChange(limit?)`. It returns
  `{teacherId, agentId}` for every live agent whose teacher's current material revision differs
  from the newest passed/published run's `basis.materialRevision`, excluding one with an open
  (`queued`/`running`) run and one that already has a run of *any* outcome started at the current
  revision (lead answer Q2: one automatic attempt per material revision), oldest-changed-first,
  capped at `limit`.
- `packages/db/src/repositories/index.ts`: re-exports `regateRepo`, `REGATE_SWEEP_MAX`,
  `RegateRepo`.
- `packages/db/src/index.ts`: a comment next to `openDatabase` explaining `regate` is
  deliberately *not* wired into its return (see Decisions below).
- `packages/db/test/publish.int.test.ts`: a new `describe('liveAgentsWithMaterialChange', ...)`
  with 7 cases (empty, changed-vs-unchanged, open-run exclusion, draft/suspended exclusion,
  cross-teacher unscoped read, one-attempt-per-revision, cap+ordering).

Red-then-green: wrote the 7 int-test cases and the `regateRepo` export first; `pnpm vitest run
test/publish.int.test.ts` failed (method didn't exist, then logic bugs below) before the final
green run (`51 passed`).

## Decisions

### 26 Oct 2026 · 13.regate standalone regate repo, not a `publishRepo` method · decided by builder · risk: high

- Decided: `liveAgentsWithMaterialChange` is exported as a standalone `regateRepo(db)` factory
  (same shape as `repositories/retention.ts`'s `retentionRepo`), not a method on the object
  `publishRepo` returns, and `openDatabase`'s return type is **not** extended with a `regate`
  field in this phase.
- Why: the plan asked for "one method on the existing publish repo" (`repos.publish.…`). Adding
  it there makes it part of `Repositories`/`RepositoryMethod`, which forces two edits to files
  explicitly off-limits this phase (owned by the concurrent 9.2g builder): `scope.test.ts`'s
  bad-scope grid would need a no-argument exemption (like `subscriptions.activeCountByPackage`),
  and — the one that actually can't be worked around — `test/repositories.int.test.ts`'s
  `CASES: Record<RepositoryMethod, IsolationCase>` fails `tsc` without a new entry for the
  method, and that file is explicitly off-limits (shared with 9.2g). `retention.ts` hit the same
  tension in task 13.4 and resolved it the same way: a cross-account scheduled-job read, kept out
  of `createRepositories` entirely, exported standalone, wired into `openDatabase` only. I
  followed that precedent for the method itself, but stopped short of the `openDatabase` wiring
  because that return object's *shape* is also pinned by an exhaustive-keys assertion in the same
  off-limits `repositories.int.test.ts` (`expect(Object.keys(opened).sort()).toEqual([...])`) —
  adding a `regate` key breaks that assertion too. Phase B (apps/worker) needs the live `db`
  handle either way to call `enqueueGate`'s queue, so it is better placed to decide how it
  constructs `regateRepo(db)` (directly, or by extending `openDatabase` once 9.2g's edits to that
  file have landed and the key list can be updated in the same PR). Logged `risk: high` per the
  plan's own risk-paths note for this unscoped cross-teacher read (same reviewer set as 13.5:
  **security-reviewer** required, **code-reviewer** plus, **database-reviewer**/
  **typescript-reviewer** recommended).

## Gate

- `TEST_DATABASE_URL=postgres://edmate:edmate-dev@127.0.0.1:55432/edmate corepack pnpm turbo run typecheck lint test --filter=@edmate/db`
  → green (`8 successful, 8 total`). `publish.ts` coverage: 100% stmts/funcs/lines, 98.83% branch.
  Db int suite: **397 tests passed**, 0 skipped, in the 3 files touched by this change
  (`publish.int.test.ts`, `repositories.int.test.ts`, `scope.test.ts`); the full package run
  (`@edmate/db:test`) passed with `1784+ passed` and only the pre-existing unrelated skips.
- `corepack pnpm exec prettier --check` on the 4 changed files → clean (after one `--write`
  pass on `src/index.ts` and `test/publish.int.test.ts`).
- `python3 .githooks/secret-scan.py --all` → clean (no output).

## Budget

Phase A tool calls used: 55

## State after this phase

The regate sweep's candidate list can be read (`regateRepo(db).liveAgentsWithMaterialChange()`);
nothing calls it yet. Phase B (apps/worker) needs: wiring a `db`/`regateRepo` instance for the
sweep job (directly, or via an `openDatabase` extension coordinated with 9.2g's
`repositories.int.test.ts` changes), `pins.ts`, `sweep.ts`, `schedule.ts`, and the
`apps/worker/src/index.ts` wiring the plan describes.

## Phase B

Phase B status: PARTIAL

### Summary

Built and tested the sweep job itself against a narrow injected interface (no real db, queue or
model calls), as instructed. New files, all under `apps/worker/src/regate/`:

- `pins.ts` — `regatePinsFromEnv(env, hooks?)`: the newest signed prompt-pack set
  (`readPromptPackLibrary` + `newestSignedSet`, `@edmate/content`, over
  `EDMATE_CONTENT_DIR`/prompt-packs), `MODEL_MIX.paid` (`@edmate/gateway`) and the release judge
  (`judgeModelLabel` of `gateModelsFromEnv(env)`'s judge, reused from `apps/worker/src/gate/models.ts`).
  Never throws: returns `{ok: true, pins}` or `{ok: false, reason}` — a missing/invalid prompt-pack
  dir is `content_missing`, an unsigned set is `prompt_pack_unsigned`, and `dev_model` /
  `provider_key` / `judge_model` / `judge_provider` pass straight through from `gateModelsFromEnv`
  (`PinsUnavailableReason = GateUnavailableReason | 'prompt_pack_unsigned'`, reusing
  `apps/worker/src/gate/input.ts`'s type rather than re-declaring the four reasons it already
  owns).
- `sweep.ts` — `RegateSweepDeps` (`candidates()`, a narrowed `repos: {styleCards: Pick<...,
  'latest'>, courses: Pick<..., 'ensureDefault'>, publish: Pick<..., 'startRun' | 'finishRun'>}`,
  `pins()`, `enqueue()`, `log`) and `regateSweepJob(deps)`. Zero candidates is a no-op (no pins,
  repo or queue call). Pins `unavailable` logs once and stops before any candidate. Otherwise,
  sequentially per candidate: `styleCards.latest` (no card found → skipped,
  `style_card_required`, no write — a defensive case beyond the plan's list, since a live agent
  should already have one, covered by its own test for coverage), `courses.ensureDefault`,
  `startRun`, then `enqueue`. A `PublishRefusedError`/`RepositoryError` from any of those three
  calls is logged with its reason/kind and the next candidate still runs. An `enqueue` failure
  calls `finishRun('error', {errorCode: 'enqueue_failed'})` for that run (mirroring
  `apps/web/src/studio/publish.ts`'s own enqueue-failure handling) and the sweep continues; a
  `finishRun` failure after that is logged too, never thrown.
- `schedule.ts` — `REGATE_QUEUE = 'edmate-regate-sweep'`, `REGATE_SCHEDULER_ID`, `REGATE_JOB`,
  `REGATE_PATTERN = '*/15 * * * *'`, `REGATE_JOB_OPTIONS` (mirrors `COST_ALARM_JOB_OPTIONS`),
  `scheduleRegateSweep(queue, pattern?)`, `createRegateSweepWorker(options)` — modelled
  byte-for-byte on `apps/worker/src/alarms/schedule.ts`.
- `index.ts` — barrel export, mirrors `apps/worker/src/alarms/index.ts`.
- `pins.test.ts`, `sweep.test.ts`, `schedule.test.ts` — fake/scripted deps only (rule 4); 17 tests
  total.

Red-then-green: each test file was written against the not-yet-written module (`pins.js`/
`sweep.js`/`schedule.js` did not exist, so every suite failed on import) before the module was
written; the first real run after that failed only on two typecheck issues (a too-wide
`GateUnavailableReason` on `pins.ts`'s return, and `RegateSweepDeps.repos` initially typed as
`Pick<Repositories, 'styleCards' | 'courses' | 'publish'>` — the whole sub-repo objects, not just
the methods used — which the fakes in `sweep.test.ts` then failed to satisfy); fixed, then green
(`17 passed`).

**Last step (lead decision, Phase A open item):** merged `origin/main`
(`git fetch -q origin && git merge -q --no-edit origin/main`) and checked
`git log --oneline origin/main -- packages/db/test/repositories.int.test.ts`: the newest commit
touching that file is `22af8481` (9.4f), not 9.2g — **9.2g is not on `origin/main` yet.** Per the
brief, left `packages/db/src/index.ts`, `packages/db/test/repositories.int.test.ts` and
`packages/db/src/repositories/README.md` alone. Because `openDatabase`'s return is not extended
with `regate` in this phase (and `apps/**` must not import `@edmate/db/internal`'s raw `Db`,
enforced by a lint rule — there is no other way for `apps/worker` to get a `regateRepo(db)`
instance), **`apps/worker/src/index.ts` was also left unwired**: `regateQueue`,
`gateProducerQueue`, `createRegateSweepWorker` in the `workers` array, `scheduleRegateSweep`, and
the shutdown `close()` calls all depend on either a live `db` handle for `regateRepo` or on
`openDatabase().regate`, neither of which exists yet. The sweep job itself (`pins.ts`, `sweep.ts`,
`schedule.ts`) is finished and tested in isolation; only its wiring into the running process is
blocked on 9.2g.

### Left to do (blocked on 9.2g landing on `origin/main`)

1. `packages/db/src/index.ts`: add `regate: regateRepo(db)` to `openDatabase`'s return, next to
   `retention`.
2. `packages/db/test/repositories.int.test.ts`: add `'regate'` to the
   `Object.keys(opened).sort()` key-list assertion (line ~6220).
3. `packages/db/src/repositories/README.md`: the one-sentence README note the lead answers moved
   to Phase B (next to the `teacherIdsWithUsageSince` / `costByPackageSince` paragraph).
4. `apps/worker/src/index.ts`: `const regateQueue = new Queue(REGATE_QUEUE, {connection})`; a
   `gateProducerQueue = createGateQueue(connection)` (`@edmate/queue`) to call `enqueueGate` from;
   `createRegateSweepWorker({..., deps: {candidates: () => db.regate.liveAgentsWithMaterialChange(),
   repos: db.repos, pins: () => regatePinsFromEnv(process.env), enqueue: (job) =>
   enqueueGate(gateProducerQueue, job), log}})` added to the `workers` array; `scheduleRegateSweep(regateQueue).catch(...)`
   next to `scheduleCostAlarm`; `regateQueue.close()` and `gateProducerQueue.close()` added to the
   shutdown `Promise.all`.

### Decisions

### 27 Oct 2026 · 13.regate pins reuses `GateUnavailableReason`, not its own four-reason copy · decided by builder · risk: low

- Decided: `PinsUnavailableReason = GateUnavailableReason | 'prompt_pack_unsigned'`
  (`apps/worker/src/gate/input.ts`'s existing type), not a hand-written union repeating
  `dev_model` / `provider_key` / `judge_model` / `judge_provider`.
- Why: `gateModelsFromEnv`'s declared return type is the full `GateUnavailableReason` (it shares
  the type with the gate's other unavailable reasons, like `content_missing`, even though it only
  ever produces the model-related four); a narrower hand-written union fails `tsc` the moment that
  function's result is passed through, and the plan's own text for `pins.ts` says the judge piece
  is literally `gateModelsFromEnv(env)`'s judge — reusing its reason type keeps the two in sync
  without a cast.

### 27 Oct 2026 · 13.regate sweep's repo deps narrowed per-method, not per-repo · decided by builder · risk: low

- Decided: `RegateSweepDeps.repos` is `{styleCards: Pick<Repositories['styleCards'], 'latest'>,
  courses: Pick<Repositories['courses'], 'ensureDefault'>, publish: Pick<Repositories['publish'],
  'startRun' | 'finishRun'>}`, not the plan text's literal `Pick<Repositories, 'styleCards' |
  'courses' | 'publish'>`.
- Why: `Pick` at the `Repositories` level picks whole sub-repo objects (`styleCards`'s `get`,
  `latest` and `create` all at once), which would force every fake in `sweep.test.ts` to also
  implement unused methods (`get`, `create`) just to satisfy the type — the opposite of "a narrow
  injected interface" the brief and rule 4 ask for. Nested `Pick`s (the same shape
  `apps/web/src/studio/publish.ts`'s `PublishBackend.repos` already uses) keep the fakes to only
  the three methods the sweep actually calls.

### 27 Oct 2026 · 13.regate a candidate with no style card is skipped, not a hard failure · decided by builder · risk: low

- Decided: `styleCards.latest(scope)` returning `null` is treated as a skip
  (`style_card_required`, no write), not passed through to `courses.ensureDefault`/`startRun` to
  fail there.
- Why: not spec'd (a live agent has necessarily published once, so it should always have a style
  card) but cheap to guard explicitly rather than rely on `startRun`'s own `styleCardId` lookup to
  fail some other way for a `null` id; matches the style of `apps/web/src/studio/publish.ts`'s own
  `style_card_required` check on the manual-publish path.

### Gate

- `TEST_DATABASE_URL=postgres://edmate:edmate-dev@127.0.0.1:55432/edmate corepack pnpm turbo run typecheck lint test --filter=@edmate/worker... --filter=@edmate/db...`
  → green, **38 successful, 38 total**. `@edmate/db:test`: 1791 passed, 4 skipped (all four
  pre-existing and unrelated to this change: `video-ingest.int.test.ts` and
  `retrieval-hnsw.int.test.ts`, env-gated, not touched by 13.regate). `@edmate/worker:test`
  included the new `src/regate/` suite (17 tests) and the package's own coverage gate passed
  (part of the 38/38 green run).
- `corepack pnpm exec prettier --check` on the 7 new files → clean (after one `--write` pass on
  `index.ts`, `pins.ts` and `sweep.test.ts`).
- `python3 .githooks/secret-scan.py --all` → clean (no output).

### Budget

Phase B tool calls used: 68
