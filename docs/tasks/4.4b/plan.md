# 4.4b plan: pre-guard classifier latency (concurrent calls, no prompt/contract change)

**Accept (verbatim):** with the scripted gateway at realistic latencies, a benign turn finishes
step 3 under 400 ms; every pre-guard eval result unchanged.

**Status: READY.** GATE dependency waived per the lead; 4.4 is done and on main.

## Problem (from the 4.4 handoff's open point)

`defaultPreGuardRegistry()` (`packages/harness/src/pipeline/steps/preGuard.ts`) runs
`distressDetect` → `moderationIn` → `jailbreak` **sequentially** inside `runGuardChain`
(`packages/harness/src/guardrails/chain.ts`'s `runPass` awaits each guard's `run()` before
starting the next). On a benign turn with no rule hit, each guard asks its own small-tier
classifier: distress 230 ms (`DISTRESS_CLASSIFIER_TIMEOUT_MS`), moderation 250 ms, jailbreak
250 ms (`SAFETY_CLASSIFIER_TIMEOUT_MS`, shared) — ~730 ms summed against step 3's 400 ms budget
(`PRE_GUARD_SLICE_MS = 300` is each guard's *own* slice, not a shared pool).

## Approach: concurrency, not a combined classifier call

**Recommendation: run the three classifier calls concurrently.** Rejected: one combined
small-model call, because it would merge three different system prompts/taxonomies
(`moderationSystem`, `JAILBREAK_SYSTEM`, distressDetect's `SYSTEM`) and three different verdict
schemas (`DistressVerdictSchema`, `ModerationVerdictSchema`, `JailbreakVerdictSchema`) into one
request/response shape — a prompt-pack/contract-shaped behaviour change needing an ADR and
`architect` + `security-reviewer` + `typescript-reviewer` (CLAUDE.md rule 2). Concurrency touches
no prompt text, no `ModelRequest`/verdict schema, and no `packages/contracts` file, so it avoids
the ADR entirely — the smaller change that still meets the accept line.

### Design (surgical, no change to `chain.ts`'s generic sequential engine)

`chain.ts` is shared by `post`-phase guards too, where a guard's rewrite must be seen by the next
guard — so it cannot be made blindly concurrent. The three `pre` guards never rewrite (only
`ok`/`block`/`escalate`), so concurrency is safe to add **only in `preGuard.ts`**, one layer above
the chain:

1. **`PreGuardCtx`** (`packages/harness/src/guardrails/preGuardCtx.ts`) gains one new *optional*
   field, e.g. `classifierCalls?: { distress?: Promise<DistressVerdict>; moderation?:
   Promise<ModerationVerdict>; jailbreak?: Promise<JailbreakVerdict> }`. Optional and additive —
   no existing `PreGuardCtx` literal (every guard unit test builds one by hand) needs to change.
2. **`createPreGuardStep`** (`preGuard.ts`), right after building `ctx` (where
   `recentStudentTurns`, `packageNames`, `priorJailbreakStrikes` are already started as
   concurrent promises — the same existing idiom), re-runs each guard's own **already-exported,
   pure** decisive-rule check to decide whether that guard will need a classifier call at all:
   `distressKeywordMatch`/`hasDistressKeyword` (hard keyword → no), `matchModeration` (decisive →
   no; its `sexual` sub-check needs `await ctx.recentStudentTurns`, already in flight),
   `matchJailbreak` (decisive → no; needs `await ctx.packageNames`, already in flight). This is
   not new logic or a second source of truth — `moderationIn.ts` already calls `matchJailbreak` a
   second time for its own HIGH-2 fallback, so calling the same pure functions once more from
   `preGuard.ts` is the established pattern, not duplication risk.
3. For every guard whose rule check does **not** decide, `preGuard.ts` fires that guard's
   classifier call immediately (all three concurrently, before any guard runs), using the exact
   same request builders (`buildDistressClassifierRequest`/`buildModerationClassifierRequest`/
   `buildJailbreakClassifierRequest`) and the exact same timeout/cancel wrapper
   (`runWithTimeout`/`callGuarded`, same `SAFETY_CLASSIFIER_TIMEOUT_MS`/
   `DISTRESS_CLASSIFIER_TIMEOUT_MS`), racing `env.cancel` (the step token) rather than a
   per-guard slice token — the same substitution already used for `recentStudentTurns` et al.
   Stores the resulting promise on `ctx.classifierCalls`.
4. Each guard (`distressDetect.ts`, `moderationIn.ts`, `jailbreak.ts`) changes at exactly one
   point: where it currently starts its own classifier call, it instead does
   `ctx.classifierCalls?.<name> ?? <today's own call>` — i.e. await the prefetched promise if
   present, else fall back to calling the classifier itself exactly as today. No other line in
   any guard changes. This keeps every existing unit test for these three files green unchanged
   (they build `PreGuardCtx` by hand, with no `classifierCalls` field, so they exercise the
   unchanged fallback path).
5. The error classes thrown on failure (`SafetyGuardCancelledError`,
   `SafetyClassifierTimeoutError`, `SafetyClassifierInvalidError`, `DistressGuardCancelledError`,
   `DistressClassifierTimeoutError`, or the raw gateway error) are identical whichever path fires
   the call, so `moderationIn`'s `catch (error) { if (!(error instanceof
   SafetyGuardCancelledError) && ...) }` fallback keeps working unchanged.

### Why rule hits still skip the model

A guard only gets a prefetched promise when `preGuard.ts`'s own rule check (the same pure
function the guard itself calls) finds no decisive hit. A decisive rule hit never populates
`ctx.classifierCalls` for that guard, so the guard takes its existing no-model-call path. The
existing eval suite doubles as the regression guard here: `moderationJailbreak.test.ts` already
asserts `r.jailbreakCalls === 0` / `r.moderationCalls <= 0 or 1` on every seeded `must_block: true`
rule-hit case — a prefetch bug that over-fires would fail these tests immediately.

### Fail-closed behaviour named and kept unchanged

- **distressDetect:** hard keyword → escalate, no model call (unchanged). No/soft keyword →
  classifier call; success decides escalate/ok; failure (throw/timeout) with a soft keyword →
  escalate; failure with no keyword at all → **rethrow, chain comes back `failed`, turn refused**
  (`PreGuardChainFailedError`). This rethrow-on-no-keyword-failure path is the fail-closed
  behaviour this task must not weaken.
- **moderationIn:** decisive rule hit → block/escalate, no classifier call (except the HIGH-2
  jailbreak-prefix case, which still asks the classifier). Otherwise classifier asked; a throw
  that is not a cancel, when jailbreak's rule is decisive, passes through (jailbreak blocks next);
  any other throw/timeout/cancel/invalid → **rethrow, chain fails closed**.
- **jailbreak:** decisive rule hit → block + safety event + strike notice. Otherwise classifier
  asked; any throw/timeout/cancel/invalid → **rethrow, chain fails closed, no strike recorded**.

None of this branching logic moves; only the promise's origin (prefetched vs. freshly started)
changes.

### Expected call-volume trade-off (to name, not hide)

When an *earlier* guard in chain order would have short-circuited the chain by a **classifier**
verdict (e.g. distressDetect escalates on a `distress: true` verdict, not a keyword), the later
guards' classifier calls were already fired concurrently and are now simply discarded unused —
a small, real increase in model-call volume on that rare path, in exchange for the common benign
path meeting the 400 ms budget. This is a deliberate trade-off, not a bug; name it as a decision
in the handoff (not hidden in a diff).

## Files to touch

- `packages/harness/src/guardrails/preGuardCtx.ts` — add optional `classifierCalls` field.
- `packages/harness/src/pipeline/steps/preGuard.ts` — prefetch logic in `createPreGuardStep`.
- `packages/harness/src/guardrails/distressDetect.ts` — one-line source-of-promise change.
- `packages/harness/src/guardrails/moderationIn.ts` — one-line source-of-promise change.
- `packages/harness/src/guardrails/jailbreak.ts` — one-line source-of-promise change.
- New/updated tests: `preGuard.test.ts` (prefetch wiring, concurrency proven with a virtual
  clock: three classifiers with realistic latencies resolve such that the step finishes under
  400 ms, versus today's sequential sum failing it), plus one test per guard file proving the
  fallback (no `classifierCalls` on ctx) path is byte-identical to today.
- No change expected to `chain.ts`, `safetyClassifier.ts`'s public API (reuse `askClassifier`'s
  underlying `callGuarded`/schemas as-is, or add one small internal prefetch helper beside it),
  `packages/contracts/**`, any `content/prompt-packs/**`, or `docs/adr/**`.

## Files out of bounds

`packages/harness/src/guardrails/chain.ts` (generic engine, shared with `post` phase — no
behaviour change needed or wanted here), `packages/contracts/**`, `content/prompt-packs/**`,
`moderationPatterns.ts`/`jailbreakPatterns.ts`/`distressKeywords.ts` (rule tables — unchanged),
`apps/worker/**`, `packages/db/**`, `packages/queue/**` (nothing here touches storage or alerts).

## Tests first

1. `preGuard.test.ts`: with a scripted gateway that delays each classifier by its real-world
   figure (distress ~150 ms, moderation ~150 ms, jailbreak ~150 ms, all under their own timeouts)
   on a virtual clock, the whole step finishes well under 400 ms (prove concurrency, not just
   "doesn't time out").
2. `preGuard.test.ts`: a decisive rule hit on any one of the three guards still shows 0 calls to
   that guard's classifier (gateway call counter), matching the existing eval suite's assertions.
3. Guard-level unit tests (`distressDetect.test.ts`, `moderationIn.test.ts`, `jailbreak.test.ts`):
   unchanged files, proving the fallback (ctx with no `classifierCalls`) path is untouched.
4. Full gate: `evals/src/moderationJailbreak.test.ts` and `evals/src/distressEscalate.test.ts`
   (4.3's) pass unchanged — this is the "every pre-guard eval result unchanged" proof.
5. `corepack pnpm turbo run typecheck lint test --filter=...@edmate/harness --filter=@edmate/evals
   --force --concurrency=1` (compose Postgres/Redis up), plus `python3
   .githooks/secret-scan.py --all`.

## Risky paths touched (`.claude/skills/merge-gate/risk-paths.txt`)

- `packages/harness/src/guardrails/**` (`preGuardCtx.ts`, `distressDetect.ts`, `moderationIn.ts`,
  `jailbreak.ts`) → **code-reviewer** (MVP-first: `safety-reviewer` waived here until 13.3 per the
  risk-paths.txt note; this PR still logs a `risk: high` decision).
- `packages/harness/src/pipeline/steps/preGuard.ts` is **not** itself a listed risky path (only
  `guardrails/**` and `pedagogy/**` are under `packages/harness/src/`), but it is reviewed anyway
  as part of the same PR by `code-reviewer`.
- No `packages/contracts/**`, no `content/prompt-packs/**`, no `.claude/**`/`.githooks/**` touched
  → no `architect`/`security-reviewer`/`typescript-reviewer` requirement triggered by path.

## Open questions (with a recommendation each)

1. **Call-volume trade-off on the classifier-short-circuit path** (named above): extra
   moderation/jailbreak calls fire-and-get-discarded when distressDetect escalates by classifier
   verdict (not keyword). *Recommendation:* accept it — this path is rare (most distress is
   keyword-caught) and the cost is one extra small-tier call per guard, bounded by the same
   timeouts; log it as a decision in the handoff, don't block on it.
2. **Where the prefetch helper lives** — a new exported function in `safetyClassifier.ts` (reused
   by all three guards and by `preGuard.ts`) vs. inlined in `preGuard.ts`. *Recommendation:* a
   small new exported helper in `safetyClassifier.ts` beside `askClassifier`, so the guard files'
   fallback branch and `preGuard.ts`'s prefetch call the same code path (one source of truth for
   "how a classifier call is made and wrapped").
3. **Virtual-clock test realism** — the scripted gateway has no built-in delay mechanism today
   (`moderationJailbreak.test.ts`'s mock resolves synchronously). *Recommendation:* add delay
   support to a test-only gateway double (not `ScriptedGateway` itself, which stays real-latency
   agnostic per its existing contract) local to `preGuard.test.ts`, using the harness's existing
   virtual clock (`driveTurn`/fake timers), not a real `setTimeout`.

## Budget

Budget: 45 tool calls (1 phase, packages/harness only)

## Allowed tools

Read, Grep, Glob, Edit, Write, Bash (typecheck/lint/test for `@edmate/harness` and
`@edmate/evals` only, and the secret scan).

## Exit conditions

`Status: DONE` when: the new/updated tests above pass, the full gate (`turbo run typecheck lint
test --filter=...@edmate/harness --filter=@edmate/evals --force --concurrency=1` with compose
Postgres/Redis up) is green, `moderationJailbreak.test.ts` and `distressEscalate.test.ts` pass
with no changed expectations, and the secret scan is clean. `Status: PARTIAL` if past ~45 tool
calls, or if `chain.ts` or any file outside this plan's list turns out to need a change (stop and
hand back rather than widening scope).

## Lead review (4 Nov 2026)
READY, with these answers. The builder follows them over the plan text above.

1. **Q1 accepted.** Wasted classifier calls on the classifier-escalation path are fine. Log the trade-off as a decision in the handoff.
2. **Q2 accepted.** The prefetch helper goes in `safetyClassifier.ts`, beside `askClassifier`. Its public API stays as it is otherwise.
3. **Q3 accepted.** A test-only delay gateway local to `preGuard.test.ts`, driven by fake timers. `ScriptedGateway` is unchanged.
4. **No docker (correction).** Builders never run docker, docker compose or psql. Ignore "with compose Postgres/Redis up" everywhere in this plan. The gate is:
   `source ~/.nvm/nvm.sh && corepack pnpm turbo run typecheck lint test --filter=...@edmate/harness --filter=@edmate/evals`
   A local DB integration test that fails or skips because no database is running is expected; name it in the handoff and move on. CI runs it with a database.
5. **Prefetched promises (HIGH if missed).**
   - Attach a handler to every prefetched promise when it is created, so a discarded call that later rejects never becomes an unhandled rejection. The guard that consumes it still sees the original rejection.
   - Unused prefetches stop when the step ends: link them to the step's cancel token (or a child of it), so a short-circuit doesn't leave calls running past the turn.
   - A prefetched call records nothing on its own. Safety events, strikes and alerts come only from the guard that consumes the verdict, exactly as today.
6. **Fail-closed behaviour unchanged.** Each guard's fail-closed branch named in "Fail-closed behaviour" above keeps its current outcome when the failure comes from a prefetched call. Add one test per guard where the prefetched call rejects or times out and the outcome matches today's fallback path.
7. **Review.** code-reviewer, plus a lead `risk: high` decision on merge.
8. **Budget.** 45 tool calls, with a hard stop at 45.
