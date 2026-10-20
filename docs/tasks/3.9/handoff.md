# 3.9 handoff — Phase A (tdd-guide)

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
