# Task 4.6 plan — `lockedLeak` post-guard (code only)

Branch: `m4/4.6-locked-leak`. Deps: 3.1, 3.12, 4.0, 4.1 (all done). Board: `risk: risky`.
Builds against `m4/4.5-answer-leak` (currently in review) after it merges to `main`.

## Accept (verbatim)

> seeded locked cases 100% on fixtures; the guard makes no model call.

**How it will be shown:** a new offline test in `packages/evals`
(`packages/evals/src/__tests__/lockedFixtures.test.ts`, mirroring 4.5's `leakFixtures.test.ts`)
drives the 34 cases in `evals/suites/locked/*.yaml` through the real harness pipeline
(`runTurn`), with a `ScriptedGateway` that, per case, tries to leak a genuine ≥8-contiguous-token
span copied verbatim from the real locked-module text the case's `source:` field names
(`content/demo-teacher/modules/*/notes.md`) — not a synthetic placeholder — so the guard is
proven against real teacher content, the same way 4.5 proved `answerLeak` against the real answer
key. The test asserts every case's `must_not_contain` passes against what the student actually
sees. A mutation run (lockedLeak replaced by a no-op, or its port call stubbed to always return
`hit: false`) must fail every case whose only protection is this guard. Package-level
`turbo run typecheck lint test --filter=@edmate/harness... --filter=@edmate/contracts... --filter=@edmate/evals...`
also passes.

**Scope cut, stated up front (mirrors 4.5's Q1):** every sampled fixture (5 of 34 read:
`locked-dicts-translate-deva`, `locked-functions-partial-quote-en`,
`locked-loops-summarise-module-en`, `locked-skill-feedback-en`,
`locked-functions-roleplay-live-class-en`) carries a `judge:` rubric checking things no code-only
guard can judge: translation, paraphrase/summary, sub-8-token partial quotes, roleplay-refusal
quality. Build plan line 333 explicitly scopes these to the judge ("a translated locked-only fact
is a leak, judge-scored"). `lockedLeak` itself only catches a literal, normalised, ≥8-contiguous-
token verbatim span (ADR-0003 point 8; build plan line 424). The 4.6 offline gate therefore scores
`must_not_contain` against a *scripted* verbatim-span leak attempt built from the real notes file,
not the full judge rubric — the judge pass is a live-model quality bar for later (harness exit
gate / a 4.6b-style follow-up, proposed as a new board task, not blocking this one). **Open
question Q1 below; recommendation: proceed on this reading.**

## The central design question: how locked text reaches the guard without ever reaching a model

This is the one thing 4.6 cannot start building without settling, because it is a `packages/contracts` change (rule 2: ADR + architect + security-reviewer + typescript-reviewer; lead logs `risk: high`).

**The constraint already in the codebase (ADR-0003, point 3-4; `ports.ts`):** `RetrievalIndex.probe`
"checks the locked modules in code and returns only `{ hit, score }`, never chunk text." There is
no existing port that gives the harness locked chunk *text*. `packages/harness` may import only
contracts/zod/mathjs (rule 3) — no `node:crypto`, so a harness-side hash-and-compare scheme (fetch
a pre-hashed shingle set once per turn, then check matches locally and synchronously) is not
buildable without a purity exception, which is itself a tech-stack ADR. Rejected for that reason.

**Recommendation: a new async `RetrievalIndex` port method, computed index-side, returning only a
boolean** — e.g.
```
leakCheck(candidate: string, scope: { teacherId: string; moduleIds: string[] }): Promise<{ hit: boolean }>
```
(exact name/shape for the architect to fix in the ADR). The adapter (wherever `RetrievalIndex` is
really implemented — a later milestone) holds the locked chunks it already stores for `search`/
`probe` and runs the *same* shingle-overlap function the harness ships (see below) against them,
server-side, returning only `hit`. No locked text ever enters `packages/harness` process memory,
which is strictly safer than "the guard holds locked text but never logs it" (the alternative this
rejects) — it matches the existing `probe` precedent exactly (code-only, text never crosses the
port) rather than introducing a second, laxer precedent next to it.

**Consequence — an async ripple, disclosed, not a contracts change:** the `lockedCheck` seam 4.5
already built is *synchronous* — `ToolLoopInput.lockedCheck?: (value: unknown) => boolean`
(`toolLoop.ts`) and `skillEvent(..., lockedCheck?: (value: unknown) => boolean)`
(`skillEvent.ts`). Note for the record: despite how this task was briefed ("the stream gate's
`lockedCheck` hook"), there is **no** locked seam on `StreamGate`/`streamGate.ts` — the build-plan
table marks `lockedLeak` as `post`-stage only, so there is nothing to add to the incremental
sentence gate; the two seams 4.5 actually built live in the tool loop and the skill-event payload
check. Both must become async (`Promise<boolean>`) to carry the port call. Ripple, all
harness-internal (no contracts type involved):
- `toolLoop.ts`: `ToolLoopInput.lockedCheck` → async; `runTool`'s existing `await` call site needs
  `await i.lockedCheck?.(json.value)`; `ToolLoopInput.onToolOutput` becomes
  `(entry, output) => void | Promise<void>` and its one call site
  (`i.onToolOutput(entry, out.value)`) gets `await`ed (the loop is already `async`).
- `skillEvent.ts`: `skillEvent(...)` becomes `async`; its one caller
  (`pipeline/steps/generate.ts`'s `onToolOutput` callback) awaits it.
- `postGuard.ts`'s `PostGuardCtx` gains the same shape,
  `lockedCheck?: (text: string) => Promise<boolean>`, built by the step from `env.deps.retrieval`
  — `answerLeak`'s guard already `await`s `x.rewrite`, so this is the same idiom, not a new one.

**Rejected alternative:** fetch the turn's locked `Chunk[]` text once (new port method returning
real text, scoped like `search`) and let the harness hold it in memory for the turn. Rejected: it
would be the first place outside the adapter layer that holds locked text at all, which cuts
against ADR-0003's "kept away from the AI, not merely forbidden" framing even though the text
would never reach a model — one new code path is one more place a future bug (a stray `env.report`,
a trace field, a test snapshot) could leak it from. Flag for the architect to confirm or overrule
in the ADR.

## n-gram / shingle matching

New file `packages/harness/src/guardrails/lockedLeak.ts`, exporting the pure matching function
both the harness guard and (later) the real adapter import — one algorithm, not two, same
philosophy as 4.5's "both import from the same module, never duplicate the match logic":
- Reuse `foldText`/`normaliseForMatch`-equivalent folding from `textFold.ts`/`answerKey.ts` (NFKC,
  digit fold, `\p{Cf}` strip, lower-case, quote unification) so `lockedLeak` and `answerLeak` can
  never disagree about what counts as "the same text" for the same underlying string.
  - Translation is **out of scope by construction**: folding normalises script/case/width, not
    language — a Hindi/Hinglish translation of a locked English sentence shares no tokens with it,
    so no shingle overlap is possible. State this explicitly in the file comment (mirrors the task
    brief and build plan line 333's "translated ... judge-scored").
  - Paraphrase is out of scope by construction too: a reworded sentence breaks the contiguous
    ≥8-token run even where individual words match.
- Tokenise on the same word-boundary notion as `answerKey.ts` (`\p{L}\p{M}\p{N}_` runs).
- Shingle size: `LOCKED_LEAK_MIN_TOKENS = 8` (ADR-0003 point 8, build plan line 424's "8+ token
  span"). A hit = any contiguous run of 8+ normalised tokens in the candidate that also appears,
  contiguously, in a locked chunk's normalised token stream.
- Whether to also decode-and-check base64 (reusing `decodedBase64Spans`, as `answerLeak` does): the
  build-plan table's `lockedLeak` method cell says only "n-gram overlap", unlike `answerLeak`'s
  richer cell. Recommend adding it anyway (cheap, reuses an existing bounded decoder, consistent
  defence-in-depth) but treat it as a cheap-MEDIUM, not an accept-bar requirement — same posture
  4.5 took for its own cheap MEDIUMs.
- Action on a hit, per the build-plan table cell ("`rewrite` without it") and 4.5's own note ("a
  surgical removal of an 8+-token span is lockedLeak's job, not [answerLeak's]"): **surgically
  strip the matched span(s)** from the draft, not a full-reply replacement. Algorithm: find every
  matching span, merge overlapping/adjacent ones, remove them (collapsing resulting whitespace),
  re-run the matcher on the result; bound the strip-and-recheck loop (e.g. 3 rounds) and fall back
  to a new fixed `LOCKED_LEAK_SAFE_HINT` constant (same pattern as `ANSWER_LEAK_SAFE_HINT`: one
  fixed English string that itself can never match, proving idempotence trivially) if stripping
  doesn't converge. Needs its own idempotence test, same shape as `answerLeak.test.ts`'s: every
  detection path trips `rewrite`, and the rewritten text passes a second `run()`.
- Because the action is `rewrite` (not `block`), `postGuard.ts`'s existing hint-forcing logic
  (currently keyed by name to `answerLeak` specifically at `answerLeakHit`/the `block`/`failed`
  branches) does **not** need to special-case `lockedLeak` on the happy path — the chain's generic
  `ok`-with-rewritten-text branch already replaces the draft when any guard rewrites it. It would
  only need extending if `lockedLeak` can itself `block`/`fail` (e.g. the rewrite doesn't converge
  within the bounded loop and the guard gives up): recommend it never does — on a non-convergent
  strip, return `rewrite` with `LOCKED_LEAK_SAFE_HINT` (mirroring `answerLeak`'s own "always safe"
  fallback), so `postGuard.ts` needs **no changes** beyond registering the guard and awaiting the
  new `lockedCheck` builder. Call this out to the reviewer as the reason `postGuard.ts`'s diff is
  small.

## Files to create

- `packages/harness/src/guardrails/lockedLeak.ts` — `createLockedLeakGuard()`, the shingle matcher,
  `LOCKED_LEAK_MIN_TOKENS`, `LOCKED_LEAK_SAFE_HINT`, the strip-and-recheck rewrite. `phase: 'post'`,
  same `PostGuardCtx` as `answerLeak` plus the new `lockedCheck` field (optional; absent ⇒ never
  trips, matching the toolLoop/skillEvent seam's existing "default: never").
- `packages/harness/src/guardrails/lockedLeak.test.ts` — unit tests: every detection path trips
  `rewrite`; multi-span and overlapping-span stripping; idempotence; a clean draft is `ok`;
  `lockedCheck` absent ⇒ `ok` always (never trips, matching the existing default).
- `packages/evals/src/__tests__/lockedFixtures.test.ts` — the 34-case fixture gate (see above).
- (Builder's call, not prescribed here) a small loader for the real
  `content/demo-teacher/modules/*/notes.md` text into fixture `Chunk`s for the test double, so the
  scripted leak attempts and the matcher are both exercised against genuine content, not
  placeholders — reuse `evals`' existing case-loading conventions if one already fits.

## Files to modify

- `packages/contracts/src/ports.ts` — new `RetrievalIndex` method (name/shape per the ADR; strawman
  `leakCheck(candidate, scope): Promise<{ hit: boolean }>` above). **Contracts change → ADR
  required** (see Decisions below).
- `docs/adr/000N-locked-leak-port.md` (new) — the ADR for the above; architect writes the decision
  text, the builder writes the file (per CLAUDE.md notes), reviewed by architect,
  security-reviewer, typescript-reviewer.
- `packages/harness/src/testing/memoryRetrieval.ts` — implement the new port method on
  `memoryRetrieval()`'s test double, computing the same shingle overlap against the locked-module
  chunks already in its `chunks` array (it already holds locked-module text today, e.g.
  `retrievalWorld()`'s `mod_test_04` chunk — this is existing precedent that the *test double* may
  hold locked text in its closure; only the port's return value is restricted).
- `packages/harness/src/pipeline/generate/toolLoop.ts` — `lockedCheck` → async; `await` its one call
  site; `onToolOutput` → `void | Promise<void>`, awaited.
- `packages/harness/src/pipeline/generate/skillEvent.ts` — `skillEvent(...)` → `async`.
- `packages/harness/src/pipeline/steps/generate.ts` — build the real `lockedCheck` closure from
  `env.deps.retrieval.leakCheck(...)` and `ctx.entitlement.teacherId`/`.lockedModuleIds`; pass it to
  `runToolLoop` and to the (now-async) `skillEvent(...)` call; `await` the latter.
- `packages/harness/src/guardrails/postGuards.ts` — `.register(createLockedLeakGuard())` after
  `answerLeak` (order: 4.5's file, 4.6-4.9 append; `GUARD_ORDER` decides actual run order, not file
  order — confirm `order.ts`'s existing list includes `lockedLeak` or needs a line added).
- `packages/harness/src/guardrails/index.ts`, `packages/harness/src/pipeline/generate/index.ts` —
  new exports.
- `packages/harness/src/pipeline/steps/postGuard.ts` — only to build and pass the new
  `lockedCheck` closure into `PostGuardCtx` (see above: no special-casing expected, but the builder
  should re-derive this, not assume it, once the guard's real failure modes are coded and tested).

## Tests first (TDD order)

1. `lockedLeak.test.ts` (unit) — shingle matcher (hit/no-hit, boundary cases, overlapping spans,
   base64 if included), strip-and-recheck idempotence, `lockedCheck` absent ⇒ never trips.
2. `memoryRetrieval.test.ts` (extend) — the new port method against `retrievalWorld()`'s locked
   chunk; scope validation mirrors `search`/`probe`'s existing checks.
3. `toolLoop.test.ts` / `skillEvent.test.ts` (extend) — async `lockedCheck` trips `failed('locked')`
   / `drop('locked')`; absent ⇒ unaffected (regression guard for the sync→async change).
4. `pipeline/steps/postGuard.test.ts` (extend) — `lockedLeak` registered, rewrite path taken,
   verification pass re-runs it on the rewritten text.
5. `packages/evals/.../lockedFixtures.test.ts` — the 34-case gate, last.

## Latency

Unlike `answerLeak` (pure JS, no I/O, sub-millisecond), `lockedLeak`'s chosen design makes one
async round-trip per check (the new port call) — a real deviation from 4.5's latency note, called
out explicitly rather than silently inherited. Budget it inside the existing shared budgets:
`postGuard`'s step budget (`postGuardSliceMs`, already shared across registered guards) absorbs the
post-guard call; the tool-loop's existing per-tool `TOOL_TIMEOUT_MS` budget absorbs the
toolLoop/skillEvent calls. The real adapter's cost (a DB-side shingle query) is out of this task's
scope to prove — ADR-0003 point 6 ("caches are keyed by package version") already anticipates
caching this per teacher/package, so recommend the ADR say the adapter must cache by package
version, same as everything else, but the actual perf proof belongs to whichever later task builds
the real adapter, not 4.6.

## Idempotence with the verification pass

Covered above (strip-and-recheck bounded loop, `LOCKED_LEAK_SAFE_HINT` fallback). Same property
4.5's safety review demanded of `answerLeak`: "each rewriting guard must return ok on its own
output" — `lockedLeak.test.ts` proves it directly (run twice), and `postGuard.test.ts` proves the
chain's own verification pass (which `answerLeak`'s review added) doesn't re-trip on
`lockedLeak`'s rewritten text either.

## Out of bounds

- No change to `streamGate.ts`/the incremental sentence gate (lockedLeak is post-only).
- No change to `access/entitlement.ts` (already exposes `lockedModuleIds`).
- No real Postgres/retrieval adapter implementation — contracts port + harness guard + test double
  only; the real adapter is a later (non-4.6) task.
- No live-judge pass for translation/paraphrase/sub-8-token quotes (Q1; a follow-up board task).
- `evals/suites/locked/*.yaml` are read-only fixtures, not edited (same posture 4.5 took for
  `evals/suites/leak/**`), unless the builder finds a genuine gap (e.g. no case exercises the
  tool/skill `lockedCheck` seam at all) — flag any such gap to the lead rather than inventing new
  cases unilaterally.

## Risky paths touched (checked against `.claude/skills/merge-gate/risk-paths.txt`)

- `packages/harness/src/guardrails/**` (new `lockedLeak.ts`, `.test.ts`; edited `postGuards.ts`,
  `index.ts`) — **reviewers: safety-reviewer** (group 1). Recommend also security-reviewer (the
  locked-content boundary) and typescript-reviewer, matching 4.5's roster.
- `packages/contracts/**` (`ports.ts`) and `docs/adr/**` (new ADR) — **reviewers: architect,
  security-reviewer, typescript-reviewer** (contracts group, rule 2). This is the task's one
  mandatory contracts review; it is not optional given the design above.
- `evals/suites/locked/**` — read-only in this task; group reviewer is safety-reviewer if anything
  does get touched.
- Everything else (`pipeline/generate/**`, `pipeline/steps/**`, `testing/**`, `packages/evals/**`,
  `content/demo-teacher/**`) — **None (checked against risk-paths.txt): no glob matches.**

**`risk: high` decisions to log at handoff (two, both required):**
1. The ADR itself (contracts/ports change) — rule 2's mandatory `risk: high` for any
   `packages/contracts` change, reviewed by architect, security-reviewer, typescript-reviewer.
2. The task-level decision the board already tags `risk: risky`: "4.6 merged: `lockedLeak`
   post-guard wired (code-only, ≥8-token shingle overlap via a new retrieval port call); no locked
   chunk text reaches harness process memory or a model; reviewed by safety-reviewer[,
   security-reviewer, typescript-reviewer] and, for the port, architect."

## Open questions

- **Q1 — does "100% on fixtures" include the `judge` rubric?** Recommendation: no, same reasoning
  as 4.5's Q1 (rule 4: no real model calls in tests; the judge needs a real model). The offline
  gate scripts a verbatim ≥8-token leak attempt per case and scores `must_not_contain` only.
  Not blocking: start on this reading; a live-judge pass is a natural follow-up board task.
- **Q2 — the exact port method name/shape and whether `score` (like `probe`) should also be
  returned.** Recommendation: `{ hit: boolean }` only (stricter than `probe`, no reason to return
  more than the guard needs) — but this is squarely the architect's call in the ADR, not mine to
  fix unilaterally. Not blocking: the harness-side guard and test double can be built against a
  placeholder shape and adjusted once the ADR lands; sequence the ADR first if possible so the
  builder isn't guessing at a contracts shape mid-task.
- **Q3 — should `lockedLeak` also check base64-decoded spans?** Recommendation: yes, cheap and
  consistent, but not an accept-bar requirement (see "n-gram / shingle matching" above). Not
  blocking.

## Status

**READY.** The one real open item (Q2, the port's exact shape) is squarely something the architect
settles in the ADR, not an unclear spec or a product decision — the design direction (a new
async, text-never-crosses-the-port method on `RetrievalIndex`) is specific enough to start the ADR
and the harness-side work in parallel. Flag Q1 and Q3 to the builder as explicit, non-blocking
scope cuts, same posture 4.5 used.

## Lead answers and plan revisions from the safety and architect plan reviews (19 Oct 2026; these override the plan)

**Port, ADR-0007** (it extends ADR-0003; ADR-0006 belongs to 4.4). Lead decision, risk: high: the safety reviewer's oracle finding outweighs the architect's span proposal.
```ts
leakCheck(candidates: string[], scope: { teacherId: string; allowedModuleIds: string[] }): Promise<{ hit: boolean }>
```
- It returns a single boolean for the whole batch: no spans, no score, no count. Scope is the complement: every chunk of this teacher that is NOT in the allowed modules, which covers unpackaged and draft modules. Shingles that also appear in allowed chunks are ignored.
- The adapter checks the teacher owns the modules and never logs candidates. It must fail closed: a timeout, error or bad response counts as a hit.
- The ADR names a latency SLO under the per-guard slice and a cache keyed by package version, and states that the residual oracle (1 bit per turn) is bounded by the message limit.
- Architect, security-reviewer and typescript-reviewer review it.

1. **Stream seam (CRITICAL).** Add a locked check to the stream gate: per sentence, carrying the last 7 tokens over so spans across sentences are caught. On a hit, error or timeout, withhold. This is the "answer and locked n-grams before sending" rule in build-plan line 316.
2. **Order (HIGH).** In order.ts, `lockedLeak` runs BEFORE `answerLeak`, so no locked span ever reaches the answerLeak rewriter. Test that the rewriter never receives a locked span. Logged risk: high.
3. **Action (HIGH, a deliberate departure from "rewrite without it").** On any hit, replace the WHOLE reply with the locked-move reply (naming only the student's own package, decision Q6). No surgical strip. Idempotent by construction. Each hit emits a strike or safety event with no text once 4.4's SafetyEventSink exists; until then, report it to background by name.
4. **Fixtures (HIGH).** Per case, assert the UNGUARDED scripted reply fails `must_not_contain`. Both mutations (a no-op guard, and a port that always says false) must fail all 34 cases. Variants: the span mid-reply, split across chunks, across a sentence boundary, with zero-width, fullwidth and markdown. False-positive cases must pass unchanged (allowed-module text, the student's own quote).
5. **Fail closed (MEDIUM).** `lockedCheck` is REQUIRED in PostGuardCtx, and tests pass `async () => false`. A rejection or timeout gives `failed('locked')` in the tool loop, `drop('locked')` in skillEvent, and chain `failed` → safe reply in the post guard; each has a test. runTool keeps its "throws only TurnCancelled" contract.
6. **Tool and skill outputs (MEDIUM).** Check each string leaf plus the joined leaves, never only `JSON.stringify` (escaped newlines glue tokens together).
7. **Known misses (MEDIUM),** stated in the file comment, with judge cases deferred to 4.5b: spans under 8 tokens, filler interleaved, reordered sentences, renamed variables in code, summaries, contractions, translation. `lockedLeak` is a verbatim backstop only.
8. **History after a downgrade:** already handled. 3.16 (merged) ends the session on any package or version change and clears the summary, so earlier locked replies don't carry over. Say so in the plan; there's no new task.
9. **Locale reply (LOW):** the locked reply comes from the locale or fallback reply (English for the pilot).

- **Build:** tdd-guide on opus, AFTER 4.5 merges (it needs the post phase), branching from that main. The ADR comes first in the same PR.
- **Reviewers:** safety-reviewer (opus), architect, security-reviewer and typescript-reviewer (ADR), silent-failure-hunter. risk: high.
