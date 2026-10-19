# Task 3.9 — CLI `edmate chat --agent --package` (teacher-preview or eval entitlement)

## Acceptance (verbatim, from the board)
> a full session with the demo teacher runs in a terminal with a real key.

**How it is shown:** the human runs the exact command in "Manual acceptance" below, with
`EDMATE_ANTHROPIC_API_KEY` and `DATABASE_URL` set in their shell (sourced from `~/.edmate/env`,
outside the repo, per `docs/setup/devbox.md` — never written into the repo). They type a few
real messages to the demo Python course (`content/demo-teacher/`) on `demo-package-paid` and see
streamed tokens, at least one `sources` or `locked` event when relevant, and a final `done`. This
is a manual step the human does (build plan rule 4: no real model calls in CI/tests); the PR's
automated tests only prove the wiring is correct using the scripted gateway and fixtures — they
never hold a real key. The task handoff records that the human ran it and what they saw (pass/fail
against the acceptance line), not a transcript (no student/model text in the repo).

## What exists already (read before building; nothing here needs a contracts or ADR change)
- `runTurn(input, { deps, steps, cancel? })` and `defaultSteps` are exported from `@edmate/harness`
  (`packages/harness/src/pipeline/runner.ts`, `steps/index.ts`) and are feature-complete enough to
  run a turn end to end. **`defaultSteps.route.run` is still a stub** (task 3.3, board: `todo`) —
  every turn falls back to `route.onFailure` (`ROUTE_DEFAULT`, intent `on_task`/attempt `none`,
  unless a distress keyword hits). That is an existing, already-accepted gap outside 3.9's deps;
  the CLI changes nothing about it and will pick up real routing automatically once 3.3 ships
  (same `defaultSteps` reference, no CLI change needed).
- `packages/db`'s repositories already implement every DB-backed port the pipeline needs, including
  the `teacher_preview` and `eval` branches of `entitlementStoreFor` and `turnConfigStoreFor`
  (`packages/db/src/repositories/ports.ts`). `openDatabase(env)` (`@edmate/db`) is the one public
  entry point for app code.
- `packages/gateway` has everything to build a real, metered model gateway: `envKeySource`,
  `loadProviderKeys`, `createAnthropicAdapter`, `createRouter`, `meterRouter`, `loadBundledPrices`
  — see `apps/cli/src/commands/judgeGateway.ts`, which already does exactly this for the judge
  model and is the template to follow.
- `@edmate/content`'s `readPromptPackLibrary(dir)` builds a `PromptPackLibrary` from
  `content/prompt-packs/` (task 3.6/3.11, both done) — no new loader needed.
- The demo teacher is seeded with fixed ids (`packages/db/src/seed.ts`, `DEMO_IDS`):
  `teacher: 'demo-teacher'`, `agent: 'demo-agent'`, `packageFree: 'demo-package-free'`,
  `packagePaid: 'demo-package-paid'`; its model policy is Anthropic on both tiers; its students'
  (and so its locale) market is `'global'`.
- `packages/harness/src/pipeline/clock.ts`'s doc comment says it outright: *"Production adapters
  [for `Clock`/`IdSource`] come with the first real caller (3.9); tests use `virtualClock()` and
  `sequentialIds()` from harness/testing."* **This task is that first real caller** — it must add a
  real wall-clock `Clock` and a real `IdSource` (e.g. `randomUUID()`-based), living in `apps/cli`,
  not in `packages/harness` (which stays pure per rule 3).
- `packages/db/src/repositories/ports.ts`'s `TurnConfigStoreOptions.locales` doc comment says:
  *"Until task 3.10 the composition root passes fixtures."* 3.10 (locale packs) is not done, so the
  CLI's `locales()` returns `@edmate/contracts/fixtures`'s `localePackMinimal` (market `'global'`,
  matching the demo teacher) for every market — exactly what that comment anticipates. This is a
  genuine package export (`@edmate/contracts` `package.json` has a `./fixtures` subpath, described
  as "with fixtures"), not a test-only hack.
- `createTurnLimits(clock)` (`@edmate/harness`) is the in-memory `TurnLimits` already used as the
  default in tests; its own doc comment says a restart or a second instance resets it, and 3.14
  replaces it with a durable, shared Redis store for multi-instance web traffic. 3.9 does not
  depend on 3.8 or 3.14 (the worker-queue/Redis durability tasks); a single CLI process has no
  second instance to share state with, so this is the right default here (see Decisions).

## Design

### Command and flags
`edmate chat --agent <agentId> --package <packageId> [--entitlement teacher_preview|eval] [--teacher <id>] [--student <id>] [--package-version <n>] [--market <code>]`

- Default `--entitlement teacher_preview` (matches the build plan's CLI-parity line, which shows
  no entitlement flag for the common case). The previewing "student id" the pipeline needs is not
  asked of the user: the command resolves the agent's owning teacher via `repos.agents.owner
  ({ agentId })` (a public lookup) and uses that teacher id as both the entitlement request's
  `studentId` and `TurnInput.studentId` — this is the existing, documented `teacher_preview`
  convention (`entitlementStoreFor`'s doc comment: "the student id is the teacher's user id"). The
  package's newest version is used (`packageVersions.latest`), also per that port's existing
  behaviour. `--teacher`, `--student`, `--package-version`, `--market` are rejected together with
  `--entitlement eval` as unused/conflicting flags.
- `--entitlement eval` requires `--teacher` and `--package-version` (eval pins one version, with
  no sensible default); `--student` defaults to a fixed literal (`eval-cli-session`, not a real
  account); `--market` defaults to `global`.
- `--agent`/`--package` are always required; a missing one is a usage error, not a crash.
- No `--key` flag: the model key is read only from `process.env.EDMATE_ANTHROPIC_API_KEY`, never
  taken as an argument (so it never appears in shell history or `ps`), never echoed, never written
  to any file.
- Each run opens a brand-new session (`repos.sessions.create`) for the resolved entitlement; the
  REPL loop reuses that one `sessionId` for every turn until the user exits (Ctrl-D / `/exit`).
  Resuming a previous CLI session is out of scope (a natural 3.9 follow-up, not blocking this task).

### Composition root (`PipelineDeps`), all real, no bypass
| Dep | Real implementation |
| --- | --- |
| `clock`, `ids` | New: wall-clock `Clock` (`Date.now()` + cancellable `setTimeout`); `IdSource` via `randomUUID()` (ids re-shaped to the contracts id charset) |
| `gatewayFor` | `meterRouter(createRouter(policy, { anthropic: (model) => createAnthropicAdapter(keys.get('anthropic'), { model }) }), usageMeterFor(repos, scope), billing, loadBundledPrices())`, `metered: true` (so `meter` step's own recording is skipped — it already is, by design, when metered is true) |
| `priceUsage` | `computeCostMicroUsd`-based, same as `@edmate/gateway`'s own default |
| `entitlements` | `entitlementStoreFor(repos, { market: 'global', packMarket: () => 'global', preview: { packageId }, eval: { teacherId, packageId, version, market } })` per the chosen `--entitlement` |
| `turnConfig` | `turnConfigStoreFor(repos, { locales: () => localePackMinimal })` |
| `entitlementSource` | `'teacher_preview'` or `'eval'` from the flag — **never `'subscription'`, and never client input** |
| `limits` | `createTurnLimits(clock)` (in-memory; see Decisions) |
| `profiles`, `transcripts`, `sessionState`, `teacherQuestions` | `profileStoreFor`/`transcriptStoreFor`/`sessionStateStoreFor`/`teacherQuestionStoreFor(repos, scope)` |
| `usage` | `usageMeterFor(repos, scope)` (also what `gatewayFor`'s `meterRouter` writes to) |
| `traces` | `traceSinkFor(repos, scope)` |
| `retrieval` | New: a no-op stand-in (`search` → `[]`, `probe` → `{ hit: false }`, `leakCheck` → `{ hit: false }`), documented as a placeholder until ingest/RAG (M6) ships — never throws, so `buildContext` degrades to the `ask_teacher` path instead of failing the turn |
| `alerts` | New: one structured JSON line per `SafetyAlert` (ids, `level`, `kind`, `excerptRedacted` — the schema's own already-redacted field, nothing else) to stderr, mirroring `logCostAlarmSink`'s exact pattern and doc comment ("real delivery... waits for a vendor decision") |
| `distressCheck` | New: a small English keyword check (see Open questions — this one has no existing implementation anywhere to copy) |
| `fallbackReplies` | New: English-only `safeReply`/`distress`/`limitReached`/`lockedReply` text (English-only pilot) |
| `promptPacks` | `readPromptPackLibrary('content/prompt-packs')` |

### Terminal rendering
Read lines from stdin (readline), send each as a `message` turn
(`kind: 'message', lang: 'en', clientTs: isoAt(clock.now())`). Consume `run.events` and print:
`token` → append to the current line; `sources`/`locked`/`teacher_question`/`skill` → one labelled
line each (no student/model text beyond what the event already carries); `done` → newline, ready
for the next input; `error` → print `code` (and `retryable`) only, per the frozen wire shape (no
internal error text, matching how the pipeline already treats errors). Ctrl-C cancels the in-flight
turn only (`opts.cancel`), not the process.

## Files to create
- `apps/cli/src/commands/chat/index.ts` — command entry: arg parsing, env checks, REPL loop, exit codes
- `apps/cli/src/commands/chat/index.test.ts`
- `apps/cli/src/commands/chat/deps.ts` — composition root: builds `PipelineDeps` from `Repositories` + env
- `apps/cli/src/commands/chat/deps.test.ts`
- `apps/cli/src/commands/chat/gateway.ts` — real metered `ModelGateway` (mirrors `judgeGateway.ts`)
- `apps/cli/src/commands/chat/gateway.test.ts`
- `apps/cli/src/commands/chat/runtime.ts` — real `Clock` and `IdSource`
- `apps/cli/src/commands/chat/runtime.test.ts`
- `apps/cli/src/commands/chat/retrieval.ts` — no-op `RetrievalIndex` stand-in
- `apps/cli/src/commands/chat/retrieval.test.ts`
- `apps/cli/src/commands/chat/alerts.ts` — structured-log `AlertSink`
- `apps/cli/src/commands/chat/alerts.test.ts`
- `apps/cli/src/commands/chat/distress.ts` — `distressCheck` keyword check
- `apps/cli/src/commands/chat/distress.test.ts`
- `apps/cli/src/commands/chat/replies.ts` — `FallbackReplies` (English text)
- `apps/cli/src/commands/chat/replies.test.ts`
- `apps/cli/src/commands/chat/render.ts` — `TurnEvent` → terminal lines
- `apps/cli/src/commands/chat/render.test.ts`

## Files to modify
- `apps/cli/src/cli.ts` — add the `chat` case to the dispatch switch and `USAGE`
- `apps/cli/src/cli.test.ts` — cover the new case (help text, dispatch)
- `apps/cli/package.json` — move `@edmate/harness` from `devDependencies` to `dependencies`; add
  `@edmate/db` as a dependency (both are production imports now, not test-only)

## Files out of bounds (not touched by this task)
- `packages/contracts/**`, `packages/harness/**`, `packages/db/**`, `packages/gateway/**`,
  `packages/content/**` — every port and loader this task needs already exists; nothing here
  changes (so no ADR, per the task constraints)
- `apps/cli/src/commands/eval.ts`'s `unwiredAgent` — wiring the real agent into `edmate eval`
  (replacing the stub) is a natural follow-up once `chat`'s composition root exists, but it is not
  `edmate chat` and not in 3.9's accept line; left as is
- `apps/worker/**`, `apps/web/**` — no web/API route or worker change; this is the harness's first
  app-level consumer, standing alone

## Tests first (TDD order)
1. `runtime.test.ts` — real `Clock.now()` advances with real time; `sleep` resolves after `ms` and
   resolves early on cancel; `IdSource.next(kind)` returns distinct, contracts-valid ids
   (`turn`/`message`/`alert`). No model or DB calls; this is plain unit testing of real timers —
   consistent with "no real model or payment calls in tests" (this isn't either).
2. `retrieval.test.ts` — `search` always `[]`, `probe` always `{ hit: false }`, `leakCheck` always
   `{ hit: false }`, for any scope; never throws.
3. `alerts.test.ts` — one JSON line per `raise(alert)`, containing only `id`, `level`, `kind`,
   `studentId`, `teacherId`, `sessionId`, `excerptRedacted`, `createdAt` (fixture `SafetyAlert`s
   from `@edmate/contracts/fixtures`); never the full object if extra fields were ever added.
4. `distress.test.ts` — table-driven: known English distress phrases hit, ordinary teaching
   questions and the existing PII/safety eval near-miss list do not (reuse `evals/suites/safety`
   fixtures' negative cases, not real student text). Blocked on the open question below.
5. `replies.test.ts` — each reply function returns non-empty English text; `distress` text
   mentions reaching out to a trusted person (mirrors `LAST_RESORT_DISTRESS_REPLY`'s spirit; no
   locale pack helplines, since `localePackMinimal.helplines` is `[]`).
6. `gateway.test.ts` — builds against a fake `KeySource`/fake adapter factory (no network): a
   missing `EDMATE_ANTHROPIC_API_KEY` throws `KeyConfigError` without the value anywhere in the
   message; a configured key builds a working router; `settled()` resolves.
7. `deps.test.ts` — the composition root, against an in-memory/fake `Repositories` double (same
   shape as `packages/db`'s, built for this test) and the scripted gateway in place of `gateway.ts`:
   - `teacher_preview` resolves `studentId` to the agent's owner teacher id automatically
   - `eval` requires `--teacher`/`--package-version` and rejects a request for `'subscription'`
   - every `PipelineDeps` field is present and typed; `entitlementSource` is never settable to
     `'subscription'` from any flag combination (type-level and runtime)
8. `index.test.ts` (command) — arg parsing and validation only (missing `--agent`/`--package`,
   conflicting eval/teacher_preview flags, missing env vars) against injected `CliIo` and a fake
   `deps` builder; no real DB, gateway or model. A full `runTurn` pass is exercised through
   `deps.test.ts` + existing harness integration tests (`packages/harness/src/pipeline/*.test.ts`),
   not duplicated here with a second scripted-gateway pipeline run.
9. `render.test.ts` — each `TurnEvent` variant renders the expected line(s); `error` never prints
   more than `code`/`retryable`.
10. `cli.test.ts` update — `chat` appears in `USAGE`; unknown flags still error as today.

No test anywhere calls a real model or a real database; `deps.test.ts` and `index.test.ts` inject
fakes. The manual, real-key run is the acceptance step a human performs directly (see above), not
part of the automated suite.

## Decisions to log (spec didn't make these; stated with rationale, not reopened as questions)
1. **No `@edmate/queue` (task 3.8/3.14) in the CLI's composition root.** `transcripts`,
   `sessionState`, `profiles`, `usage`, `traces` use `packages/db`'s synchronous, scoped ports
   directly, not the Redis/BullMQ-backed wrappers. 3.9 does not depend on 3.8 or 3.14; the CLI is
   one local process, not scaled web traffic, so there is no second instance for the queue's
   durability to protect against. A future shared composition root (the web API route) can swap in
   the queue-backed ports later — same port shapes, no contracts change.
2. **`retrieval` is a no-op stand-in** until ingest/RAG (M6) ships; not a dep of 3.9. Turns
   degrade to the `ask_teacher` path for anything needing retrieved material, which is safe
   (fails toward asking the teacher, never toward an ungrounded answer invented by this gap).
3. **`alerts` logs a structured line, no real paging**, exactly like `logCostAlarmSink` (task 2.5)
   already does for cost alarms, and for the same reason (4.3's own gap, not yet filled by a vendor
   decision). Nothing routed here is unredacted model or student text (`excerptRedacted` only).
4. **Locale pack is the `localePackMinimal` fixture** (not `demoLocalePack`, which is market `'IN'`
   and would mismatch the demo teacher's `'global'` market), per `TurnConfigStoreOptions.locales`'s
   own doc comment anticipating fixtures pre-3.10.
5. **In-memory `TurnLimits`** (`createTurnLimits`), not a durable store — single process, no peers.

## Risky paths touched (checked against `.claude/skills/merge-gate/risk-paths.txt`)
None. Every file this task adds or changes is under `apps/cli/**`, which is not listed in
`risk-paths.txt`, and no `packages/contracts`, `packages/harness/src/guardrails|pedagogy`,
`packages/content/src/promptPacks.ts|personaTemplates.ts`, `packages/harness/src/access`,
`packages/payments`, auth/webhook routes, `packages/db/src/identity`, `packages/gateway/src/keys`,
`packages/db/src/repositories`, `docs/adr`, or `.claude|.github|.githooks` paths are touched.
No `risk: high` decision is required by the risk-paths check.

That said, this is the harness's first production wiring of a real model key, a real database and
real student/teacher-shaped ids (even if only the demo teacher's), and it is the one place
`distressCheck` and `AlertSink` get a real (if provisional) implementation. I'd flag the PR for a
`security-reviewer` pass on key/credential handling (never logged/echoed/written) even though
the path check doesn't force it, and recommend whoever reviews task 4.3 (distress, in `review` now)
also glance at `distress.ts` once that lands for consistency. This is a recommendation, not a path
match, so it doesn't change the merge gate's requirement.

## Open questions
1. **`distressCheck`'s keyword list has no existing implementation anywhere in the repo to reuse**
   (unlike `alerts.ts`, which mirrors `logCostAlarmSink` closely, or `retrieval.ts`/locale, which
   both have doc comments anticipating exactly this stand-in). `route.onFailure`'s own distress
   fallback and 4.3's `distressDetect` guard are separate, model-based classifiers; `deps
   .distressCheck` is the harness's last-resort, code-only check when even the router's own
   fallback logic throws. Recommendation: a short, explicit, hand-reviewed English keyword list
   (same spirit as the existing seeded safety/distress eval cases under `evals/suites/safety/`,
   which 3.9 can read for consistency but must not copy verbatim fixture text that is meant to stay
   test-only) — ship a first version in `distress.ts`, reviewed by whoever reviews 4.3 (already
   `safety-reviewer`'s area), and treat it as provisional/improvable, same as every other stand-in
   in this plan. Not a blocker: a false negative here only matters on the narrow path where the
   router's main failure path itself throws, which is already a rare, logged, "runner" background
   failure.
2. **Sequencing, not a blocker:** 3.9's declared deps are `1.5, 1.8, 2.6, 3.7, M0, 4.5`, but
   `defaultSteps.preGuard` is still a stub until 4.3 and 4.4 land (both currently `status: review`
   on the board, not `done`). If 3.9 is built before they merge, every turn fails closed at
   `preGuard` (`guard_blocked`) before reaching `generate` — the CLI still "runs in a terminal"
   safely, but produces no teaching reply, which likely fails the spirit of the acceptance line
   even though it technically starts a session. Recommendation: the team lead sequence 3.9's build
   to start after 4.3 and 4.4 merge (no code or plan change needed here either way — `defaultSteps`
   is used by reference, so this is purely a scheduling call, not something this plan can decide).

## Status
**READY** (both points above are a build-time content decision and a scheduling note, not an
unclear spec or an unresolved spec conflict; neither blocks writing the plan or starting
TDD on the parts with no dependency on them, e.g. `runtime.ts`, `retrieval.ts`, `alerts.ts`,
`replies.ts`, `gateway.ts`).

## Manual acceptance (the human performs this; never in CI)
```
# one-time: migrate + seed a local Postgres (docker/env.example), then:
corepack pnpm --filter @edmate/cli build
EDMATE_ANTHROPIC_API_KEY=<key> DATABASE_URL=<postgres-url> \
  node apps/cli/bin/edmate chat --agent demo-agent --package demo-package-paid
```
`EDMATE_ANTHROPIC_API_KEY` is the only env var naming the key; it is read once from `process.env`,
never logged, echoed, or written to disk by any file this task adds (checked by the secret scan,
and by `alerts.ts`/error paths only ever carrying `redact()`-passed or schema-redacted text).

## Lead revisions (19 Oct 2026)
1. **`distressCheck` is not a CLI-local keyword list.** Task 4.3 adds `hasDistressKeyword` in
   `packages/harness/src/guardrails/distressKeywords.ts`, written as the implementation behind
   `PipelineDeps.distressCheck`. The CLI wires that function (through the harness's public exports);
   drop `apps/cli/src/commands/chat/distress.ts` and its test. One distress list, reviewed once.
2. **Retrieval is the demo course, not a no-op.** A no-op index sends every turn to ask_teacher, so
   "a full session with the demo teacher" would never teach. Load `content/demo-teacher/course.yaml`
   into an in-memory `RetrievalIndex` (reuse `@edmate/harness/testing`'s memory retrieval if it takes
   chunks; otherwise a small CLI adapter with the same scope rules). `leakCheck` must be the real
   matcher over locked/unpackaged modules, never a stub `{ hit: false }`, so lockedLeak works in the
   CLI. Label it preview-only until 5.3's pgvector adapter lands.
3. **Sequencing:** 3.9 now depends on 4.3 and 4.4 (the real pre-guards and the distress list). Build
   starts when both merge; the human's real-key acceptance run waits for that too.
4. Run security-reviewer on the PR (key handling: never logged, echoed or written) in addition to
   code-reviewer and typescript-reviewer.
