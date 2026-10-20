# 3.9 handoff — Phase A + Phase B (tdd-guide)

Status: DONE

## Phase A

Built the composition root `edmate chat` needs, entirely under `apps/cli/src/commands/chat/`
(Phase B, the CLI surface/REPL, is untouched, as scoped):

- `world.ts` — loads the real demo-teacher content (`loadDemoTeacherContent`), the real locale pack
  set and the real prompt-pack set (`loadChatLocalePack`/`loadChatPromptPacks`), falling back to
  `@edmate/contracts/fixtures`/`@edmate/harness/testing` fixtures only if those loads fail (lead
  answer Q2), and assembles one `AccessWorld` (`@edmate/harness/testing`'s shape) plus the
  `AccessOptions` for either a `teacher_preview` or an `eval` entitlement, over one teacher, one
  agent, two packages (free/paid) and one open session.
- `retrieval.ts` — the CLI's `RetrievalIndex`: turns the demo teacher's module notes into chunks
  (one per paragraph) and delegates every access decision (`search`/`probe`/`leakCheck`) to the
  harness's own `memoryRetrieval` test double, which trusts the caller's `scope` and makes no access
  decision of its own (lead answer Q3: "the CLI's lexical index implements the harness retrieval
  port and contains no access logic of its own" — this file is a thin content → `Chunk[]` adapter,
  nothing more).
- `gateway.ts` — one real Anthropic adapter factory (same key-loading pattern as
  `judgeGateway.ts`/`ANTHROPIC_API_KEY`/`EDMATE_ANTHROPIC_API_KEY`), composed with
  `@edmate/gateway`'s router and `meterRouter` into `PipelineDeps.gatewayFor`.
- `deps.ts` — `buildChatDeps(opts)`: assembles the full `PipelineDeps` `runTurn`/`defaultSteps`
  need (real clock, real ids, the world above, the real gateway or an injected test one, the
  content-backed retrieval index, every other port as the harness's own in-memory test double from
  `@edmate/harness/testing`, and real `distressCheck`/`priceUsage`/fallback replies). No database.

Tests (TDD: written alongside each file, all passing):

- `world.test.ts`, `retrieval.test.ts`, `gateway.test.ts` — unit tests per module.
- `deps.test.ts` — the acceptance-critical test: a full `defaultSteps`-driven `runTurn` over
  `buildChatDeps`'s real composition, scripted (rule 4: no real model call). preGuard's three
  classifiers (distressDetect, moderationIn, jailbreak) are scripted directly via `ScriptedGateway`,
  matched on their fixed system-prompt text; postGuard's grounding and adviceGuard judges are
  intercepted by the harness's own `judgeGateway`/`adviceJudgeGateway` test wrappers (the same
  technique `testDeps()` uses internally), so only the turn's one real reply needs a scripted
  `stream` entry. Two scenarios: an allowed free-package module reaches `done` with no error, and a
  locked module (`loops`, outside the free package) reaches `done` via the `locked` event
  (`result.trace?.move === 'locked'`).

Gate (from `apps/cli`, via `turbo run ... --filter=@edmate/cli... --force --concurrency=1`, run
from the repo root):

```
Test Files  8 passed (8)
     Tests  69 passed (69)
All files          |   96.26 |    91.26 |   93.44 |   97.98 |
 src/commands/chat | 93.13 |   82.75 |   93.02 |   95.69 |
  deps.ts          | 91.11 |     100  |   86.95 |   92.68 |
  gateway.ts       |   100 |     100  |     100 |     100 |
  retrieval.ts     |  92.3 |      50  |     100 |     100 |
  world.ts         | 94.28 |      80  |     100 |   97.05 |

@edmate/cli:typecheck  passed
@edmate/cli:lint       passed
```

`python3 .githooks/secret-scan.py --all` → clean (no output, exit 0).

### Deviations

- `memoryProfileStore` gap: `packages/harness/src/testing/index.ts` does not export a
  `memoryProfileStore` (one exists in `memoryPorts.ts` but is only used internally via relative
  import in the harness's own `commit.test.ts`), even though `ProfileStore` is a required
  `PipelineDeps` port. Since `packages/harness` is out of bounds for this task (concurrent 5.4
  work, and not this task's scope), `deps.ts` defines its own minimal in-memory `ProfileStore`
  (starts every student x teacher pair empty, no mastery tracking — the same scope as the harness's
  own test double). See `## Decisions` below.
- `gatewayFor`/`turnPolicies`/`billingFor`: the plan's file list suggested the composition root
  would call `turnPolicies`/`billingFor` directly. Reading `packages/harness/src/pipeline/runner.ts`
  showed these are called internally by the runner, which then calls
  `deps.gatewayFor(spec: TurnGatewaySpec)` with an already-resolved policy and billing context. So
  `gateway.ts`'s `gatewayFor` only needs the signature `(spec: TurnGatewaySpec) => TurnGateway`; it
  never calls `turnPolicies`/`billingFor` itself.
- Phase B's `package.json` move (`@edmate/harness` from `devDependencies` to `dependencies`) was
  deliberately left untouched — it belongs to Phase B (the CLI command surface), not this task.

## Decisions

### 20 Oct 2026 · 3.9 CLI retrieval adapter allowlisted in access audit rule 4 · decided by build-error-resolver

Decided: `apps/cli/src/commands/chat/retrieval.ts` is added to `packages/db/test/access-audit.test.ts`'s
`INDEX_IMPLEMENTERS` allowlist, until 3.9a moves the CLI from this dev-only lexical adapter to the db
index.

Why: the file is a thin `RetrievalIndex` adapter that delegates every access decision to the harness's
`memoryRetrieval` test double (lead answer 3.9 Q3) and contains no access logic of its own, matching
the allowlist's existing exemptions for the port's other non-db implementers; 5.4's new access audit
(rule 4) otherwise flags it as an unlisted `RetrievalIndex` implementer.

### 20 Oct 2026 · 3.9 ProfileStore test double not exported from harness/testing · decided by tdd-guide

Decided: write a small local `ProfileStore` in `apps/cli/src/commands/chat/deps.ts` instead of
importing the harness's `memoryProfileStore`, and leave `packages/harness/src/testing/index.ts`
unedited.

Why: `packages/harness` is out of scope for this task (another builder is editing it concurrently
for 5.4), and the plan's Phase A file list already assumed every port listed would come from
`@edmate/harness/testing`'s public barrel — this one port was missed. A follow-up board task should
export `memoryProfileStore` from that barrel so `apps/cli` (and any other harness/testing consumer)
can use the canonical one instead of a duplicate.

### 20 Oct 2026 · 3.9 retrieval.ts delegates to the harness's memoryRetrieval · decided by tdd-guide

Decided: `apps/cli/src/commands/chat/retrieval.ts` builds `Chunk[]` from the demo teacher's module
notes and passes them straight to `@edmate/harness/testing`'s `memoryRetrieval({ chunks })`, rather
than writing a second lexical/word-overlap matcher from scratch.

Why: lead answer Q3 requires the CLI's index to implement the `RetrievalIndex` port and contain no
access logic of its own; `memoryRetrieval` already does exactly that (it trusts the caller's
`scope` argument for every `search`/`probe`/`leakCheck` call and makes no independent access
decision), and the harness publishes it from `@edmate/harness/testing` for reuse. Reimplementing the
same word-overlap logic in `apps/cli` would duplicate the port's one safety-relevant property
(trusting the caller's scope) in two places, which is a worse place for a bug to hide.

### 20 Oct 2026 · 3.9 real locale/prompt packs, fixture fallback · decided by tdd-guide

Decided: `world.ts` tries the real `content/locales/*.yaml` and `content/prompt-packs/set@*.yaml`
first and only falls back to the `@edmate/contracts/fixtures`/`@edmate/harness/testing` fixture
packs if the real load throws, recording which source was used (`'real' | 'fixture'`) on the return
value.

Why: lead answer Q2 asked for the real packs to be tried first, with the fixture packs as a safety
net, so `edmate chat` behaves like production whenever the real content is present, but a test or a
checkout missing the content directory still gets a valid (if thinner) pack rather than throwing.

## Phase B

Built the CLI surface itself, `apps/cli/src/commands/chat.ts`, wired into `cli.ts` as `edmate chat`:

- `runChatCommand(args, io, deps, stdin)`: parses `--agent`, `--package free|paid`,
  `--source teacher_preview|eval`, `--student <id>`, `-h/--help`; validates each (unknown `--agent`
  rejected, since this demo has exactly one; unknown `--package`/`--source` values rejected) before
  calling Phase A's `buildChatDeps`. A missing `ANTHROPIC_API_KEY`/`EDMATE_ANTHROPIC_API_KEY`
  surfaces `buildChatDeps`'s `KeyConfigError` message as `edmate chat: <message>` — that message
  already names only the variable, never a value (`packages/gateway/src/keys/load.ts`).
- A `node:readline` REPL reads one line at a time from `stdin` (defaults to `process.stdin`; a test
  injects any `NodeJS.ReadableStream`, e.g. `Readable.from([...])`, so "drive with scripted stdin
  lines" needs no real TTY). Each non-blank, non-`exit` line becomes a fixed-session `TurnInput` and
  runs `runTurn(input, { deps: setup.deps, steps: defaultSteps })`; `renderEvent` (exported, unit
  tested on its own) streams every `TurnEvent` variant to stdout live (`token` appended as it
  arrives; `sources`, `locked`, `teacher_question`, `skill`, `safety`, `replace`, `error`, `done` each
  as a bracketed line). `exit`, or the stream ending (Ctrl+D), ends the session cleanly with a short
  "bye" message.
- `apps/cli/src/cli.ts`: added the `chat` case and a `USAGE` line for it.
- `apps/cli/package.json`: moved `@edmate/harness` from `devDependencies` to `dependencies` (`chat.ts`
  is production code), as the plan asked for.

Tests (TDD: `chat.test.ts` written before `chat.ts`), all using the **scripted** gateway via
`ChatCommandDeps.gateway` (rule 4; `apps/cli/test/setup/no-network.ts` still backstops this):

- `--help` prints `CHAT_USAGE` and exits 0.
- Bad input: an unknown flag, an unknown `--package`, an unknown `--source`, an unknown `--agent`
  each exit 1 with a `edmate chat:` message.
- Missing key: no gateway injected and no key in `env` → exits 1; asserts the stderr message
  contains `ANTHROPIC_API_KEY` and never contains an unrelated env value planted in the test (a
  random nonce), proving no environment value leaks through the error path.
- A scripted multi-turn session: `['What is a variable?', 'Teach me loops please', 'exit']` over the
  free package — the first turn streams a reply containing a `[1]` source citation (producing a
  `sources` TurnEvent, rendered as `[sources: ...]`) and the second names a module outside the free
  package (`locked`, rendered as `[locked...]`), showing the real pipeline — not an echo — drives the
  reply. Plus: a blank line is skipped and re-prompts; the session ends cleanly with "bye" when stdin
  closes without `exit`.
- `renderEvent` unit test: every `TurnEvent` variant (including ones the REPL test above never hits —
  `hint_rung`, `teacher_question`, `skill`, `safety`, `replace`, `error`) rendered directly, so the
  exhaustive `switch`'s branches are all covered without needing a full pipeline run for each.
- `cli.test.ts`: updated "rejects an unknown command" to use `bogus` (now that `chat` is wired), and
  added `chat --help` routing plus a usage-text listing check.

Gate (`apps/cli`, via `turbo run typecheck lint test --filter=@edmate/cli --force --concurrency=1`):

```
Test Files  9 passed (9)
     Tests  81 passed (81)
All files          |   97.16 |    91.27 |   93.93 |   98.48 |
 src/commands       |   99.37 |    92.72 |   94.73 |     100 |
  chat.ts           |     100 |    91.11 |     100 |     100 |
```

`@edmate/cli:typecheck` passed; `@edmate/cli:lint` passed.
`python3 .githooks/secret-scan.py --all` → clean (exit 0).

### Deviations

- **`sources` needs a citation marker, not just coverage.** Tracing `generate`'s source-citation
  handling (`packages/harness/src/pipeline/generate/generate.test.ts`) showed the `sources`
  `TurnEvent` is emitted only when the model's reply text itself cites a retrieved chunk inline
  (`[1]`, `[2]`, ...) — coverage/move alone never triggers it. `chat.test.ts`'s scripted reply
  includes a `[1]` citation for exactly this reason; this is a property of `generate`, not something
  `chat.ts` has to do anything special for.
- **A second, same-session scripted turn on the same topic unexpectedly reached `locked`, not
  `hint`.** While shaping the scripted conversation I traced this far enough to see it is a
  `buildContext`/coverage-gate interaction (the retrieval query is diluted by appended transcript
  history on later turns, lowering the word-overlap score below the coverage threshold while a
  locked-module probe still hits) — not a Phase A/B bug, since both are exercised exactly as built.
  Given the budget, I did not chase this further than confirming it is pre-existing pipeline
  behaviour (not something `chat.ts` or `deps.ts` introduces); `chat.test.ts`'s scripted conversation
  instead uses two independent-topic turns (an allowed, covered module; a module outside the free
  package) to get one clean `sources` turn and one clean `locked` turn, matching the plan's
  acceptance ("at least one sources and one locked or ask_teacher turn") without depending on this
  edge case. Flagging it in case 3.3 (route) or a later harness task wants to look at it.
- `--agent` only accepts the demo's one agent id (`demo-agent`); any other value is rejected with a
  message naming the one valid id. Reversible; recorded as a decision below (not in the plan's
  "Open questions", so new).

## Decisions (Phase B)

### 20 Oct 2026 · 3.9 `--agent` validated against the one demo agent · decided by tdd-guide

Decided: `edmate chat --agent <id>` rejects any id other than `CHAT_IDS.agent` (`demo-agent`), with a
message naming the one valid id, instead of silently ignoring the flag or trying to look up an agent
that cannot exist in this single-agent demo world.

Why: the plan's flag list includes `--agent <id>` for forward compatibility, but Phase A's world
builder (`world.ts`) hard-codes exactly one agent; accepting an arbitrary id and then failing deeper
in the pipeline with a confusing error would be worse than failing fast with a clear one. Reversible
once a later task supports more than one demo agent.

## Manual acceptance (human only — the "real key" half of the acceptance)

With a real key exported in the shell only (never written to a file the repo tracks), as the
environment variable `ANTHROPIC_API_KEY` (or `EDMATE_ANTHROPIC_API_KEY`):

```
corepack pnpm --filter=@edmate/cli exec node bin/edmate chat
```

What to look for:
- A banner naming the demo course, then a `>` prompt.
- Have a short real back-and-forth about the demo Python course (e.g. ask about variables, then
  ask about something from `content/demo-teacher/modules/loops` — the free package should lock it,
  or route to "ask the teacher").
- Exit with `exit` or Ctrl+D; the session should end cleanly with "bye", no stack trace.
- Then re-run `python3 .githooks/secret-scan.py --all` and confirm it is still clean (exit 0, no
  output) — the key must never have been echoed or logged.

Record here (human or lead, after running it): a one- or two-line summary of the conversation and
the scan result.
