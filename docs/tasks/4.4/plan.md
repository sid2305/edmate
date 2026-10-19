# Task 4.4: `moderationIn`, `jailbreak`, strikes

Board: `board.py show 4.4` · M4 · deps 3.1, 3.12, 4.0, 4.1 (all done) · branch `m4/4.4-moderation-jailbreak` ·
registers into the `pre`-phase registry 4.3 wires (`PreGuardCtx`, `GuardRegistry<PreGuardCtx>('pre')`,
`steps/preGuard.ts`); runs after 4.1 (done), in parallel with/after 4.2 (`scrub`, running) and 4.3
(`pre`, running).

## Acceptance (verbatim, `docs/board/tasks.yaml`)
Title: "`moderationIn`, `jailbreak`, strikes"
Accept: "seeded safety cases meet the gates."
`needs_decision: [moderation]` — already answered (decisions.moderation, decided): "Provider moderation
where available, a local classifier otherwise." Not a blocker.

### How it will be shown (paste into handoff.md)

| Item | Evidence |
|---|---|
| `moderationIn` guard behaviour | `moderationPatterns.test.ts` + `moderationIn.test.ts`: a built-in rule table (hate/caste/religion/disability slurs, harassment/bullying, threats of violence, sexual content involving a minor, weapons/bomb-making, cheating-for-hire) in English, romanised Hindi and Devanagari catches every one of the 26 true-positive seeded moderation cases without a model call; the 7 seeded near-miss cases (program/error-message/loop vocabulary: "kill my program", "loop khatam", "ValueError ki nafrat", etc.) do not hard-match; an inconclusive case asks a scripted small-tier classifier (`ctx.gateway.generateObject`) with a fixed taxonomy (`hate`, `harassment`, `sexual_minor`, `violence`, `weapons`, `cheating`, `none`); a hit → `{ok:false, action:'block', reason}` + a queued `safety_events` write; a classifier throw/timeout propagates so the chain fails closed (never invents `ok`). |
| `jailbreak` guard behaviour | `jailbreakPatterns.test.ts` + `jailbreak.test.ts`: rule patterns for prompt-injection phrasing ("ignore previous instructions", "developer mode", "pretend I'm on another package/course", fake `[[SYSTEM]]`/`<<<`-style tags, "my teacher said you can"), each checked against the raw text **and** against a decoded form (base64, ROT13, reversed) and a lightly normalised form (NFKC, invisible/ZWJ-ZWNJ stripped, leetspeak folded, repeated letters squashed) catches every one of the 31 seeded jailbreak cases (multi-turn cases checked per turn and against the last 2 turns, same shape as 4.3's multi-turn distress check) without a model call for the clear ones; an inconclusive case (e.g. the grooming/"friendship" build-up, hypothetical/story-wrapper framing) asks the same small-tier classifier with its own fixed taxonomy (`instruction_override`, `role_claim`, `encoded_payload`, `grooming`, `none`); a hit → `{ok:false, action:'block', reason}` + a queued `safety_events` write and a per-student strike increment; a classifier throw/timeout propagates (fails closed). |
| Strikes | `strikes.test.ts`: each `jailbreak` block (keyword or classifier) queues one `safety_events` row via the new `SafetyEventSink` port, `target: 'student:<id>'`, `reason` a short fixed code (`jailbreak_block`, never raw text); no new counter table — "strikes per student" is the count of a student's `safety_events` rows with that reason, read later by a trust-console task (12.x), not enforced by the guard itself in 4.4 (see Open Q4). The guard's own behaviour (block every time) does not change with a rising count; this is called out explicitly as a scope decision, not a silent gap. |
| `moderationIn` also logs a `safety_event`, same path | The build-plan guard table's "log `safety_event`" cell is satisfied by the identical `SafetyEventSink.record` call (`target: 'student:<id>'`, `reason: 'moderation_block:<taxonomy-code>'`), queued the same way as the strike row. |
| 100% of seeded cases meet the merge gate (fixtures) | New `packages/evals/src/moderationJailbreak.test.ts`: loads the 33 moderation + 31 jailbreak cases via 3.12's `loadCasesFromDir`, drives each turn through the real `preGuard` (real `moderationIn`/`jailbreak`, the existing real `distressDetect` from 4.3 ahead of them in `GUARD_ORDER`, happy-path fakes for steps after `preGuard`). Each of the 26 true-positive moderation cases and 31 jailbreak cases must block (`result: 'block'`); each of the 7 moderation near-misses must not. **Run twice** (like 4.3's 2× distress run): once with the classifier scripted to return the benign/`none` verdict, once with it scripted to throw/time out — 26/26 + 31/31 blocks and 7/7 non-blocks both times, proving the rule tables alone carry the gate and the classifier is only ever a second line. |
| Strikes are recorded, not just blocked | `moderationJailbreak.test.ts` also asserts, per blocking case, exactly one `SafetyEventSink.record` call reached the fake sink (via a `queuedSafetyEventSink`-style fake, mirroring 4.3's alert-sink fake), with no `excerptRedacted`/raw text in its `reason`. |
| Harness purity | `packages/harness/src/**` still imports only `@edmate/contracts`, `zod` and its own modules; no new dependency; `turbo run typecheck lint test --filter=@edmate/harness... --filter=@edmate/queue... --filter=@edmate/worker... --filter=@edmate/db... --filter=@edmate/contracts... --filter=@edmate/evals...` green. |
| ADR-0006 (`SafetyEventSink`) | `docs/adr/0006-safety-event-sink.md` merged; `SafetyEventSink` exported from `@edmate/contracts`; a type-level test and the spec-types drift test (pattern from 3.13/3.15) pass; no other contract change. |

## Design

### What exists already (read only, not touched by 4.4)
- `packages/harness/src/guardrails/{chain,order,registry,guard}.ts` (4.1, frozen): `GUARD_ORDER.pre = ['distressDetect', 'moderationIn', 'jailbreak']` already fixes 4.4's two guards after `distressDetect` and their mutual order; `runGuardChain` already re-checks a rewrite (N/A here — neither guard ever rewrites, only `ok`/`block`), lets `escalate` beat a verification-pass block (N/A — neither guard escalates), and treats every framework failure as `failed`, never `ok`.
- `packages/harness/src/guardrails/registry.ts`: `GuardRegistry<PreGuardCtx>('pre')` (built by 4.3) throws at `register()` on an undeclared/wrong-phase/duplicate guard; 4.4 only calls `.register()` twice more.
- `docs/tasks/4.3/plan.md`'s final revisions (lead answers, 19 Oct 2026, binding here too): `PreGuardCtx` (locale, entitlement, sessionId, lang, gateway, ids, clock) is the shared pre-phase context 4.3 defines; normalisation rules (NFKC, strip `\p{Cf}`/ZWJ/ZWNJ, casefold, curly apostrophes, collapsed spacing between single letters, squashed repeats, leetspeak) and the hard/soft keyword split are 4.3's pattern for `distressDetect` — **4.4 reuses the same normalisation helper rather than writing a second one** (see Open Q1 on where it lives if 4.4 lands first).
- `preGuard.ts`'s "map a chain `block` to `{ result: 'block' }` and throw only on `failed`" (4.3 lead answer #11) is **for 4.4**: today the stub step only has `distressDetect` registered so the chain's only non-`ok` outcome is `escalate`/`failed`; once 4.4 registers `moderationIn`/`jailbreak`, `block` becomes reachable and `preGuard.ts` must return `{ result: 'block', guards, usage }` instead of throwing, so a real moderation/jailbreak block is reported as a guard verdict (`guard_blocked`), never mistaken for a framework failure. **4.4 modifies `steps/preGuard.ts`'s outcome mapping**, which 4.3 explicitly left for this task.
- `docs/tasks/4.1/handoff.md` Q1: "no port, table or persistence" yet for the safety-event seam; "the first guard task that writes a `safety_events` row (likely 4.4) raises the `SafetyEventSink` ADR." **This task is that task** — confirmed by the build-plan guard table's "log `safety_event`" cell for `moderationIn` (line 421) and by `packages/db/src/schema/operations.ts`'s already-existing `safety_events` table (1.1), which has no writer port yet.
- `apps/worker/src/alerts/**` (4.3, risk-paths.txt safety-reviewer group): the pattern this task's worker-side consumer copies — a worker-local processor wired to a BullMQ queue, `onJobFailed` dead-lettering, the same `commit.int.test.ts` shape for its own integration test.
- `packages/queue/src/alertSink.ts` (4.3): the pattern `packages/queue/src/safetyEventSink.ts` copies (`queuedSafetyEventSink(queue, scope): SafetyEventSink`, idempotent `jobId`).
- `.claude/skills/merge-gate/risk-paths.txt`: does **not** yet list a worker folder for safety-event delivery (only `apps/worker/src/alerts/**`). Flagged under Risky paths touched below — this task either reuses `apps/worker/src/alerts/` for both alert and safety-event jobs (no risk-paths.txt edit) or adds a new glob (architect-owned file). *Recommendation below (Open Q3): reuse the existing folder.*

### Contracts change: `SafetyEventSink` (ADR-0006)
`packages/contracts/src/ports.ts` gains:
```ts
export interface SafetyEventSink {
  record(e: { target: string; reason: string }): Promise<void>;
}
```
`target` is `student:<id>` (mirrors `audit_log`'s `<kind>:<id>` convention and `trustColumns()`'s existing `target`/`reason` columns — no schema migration needed, `packages/db`'s `safetyEvents` table (1.1) already has exactly these columns). `reason` is one of a small fixed set of codes (`moderation_block:<taxonomy>`, `jailbreak_block:<taxonomy>`) — never raw student text, matching the guard-trace rule (ADR-0003 style: no reason/text ever leaves the guard as free text). This is a `packages/contracts` change: ADR-0006, reviewed by **architect, security-reviewer, typescript-reviewer**; lead approves and logs `risk: high` (rule 2). A type-level test and the spec-types drift test (3.13/3.15 pattern) are added; the build plan's Core contracts block gets the one-line addition.

### `packages/harness/src/guardrails/moderationPatterns.ts` / `jailbreakPatterns.ts`
Pure, no model call. Built-in (not locale-pack-sourced, same Q1 precedent as 4.2/4.3) per-script phrase/pattern tables:
- `moderationPatterns.ts`: `matchModeration(text, lang): { hit: boolean; taxonomy?: string }`, English + romanised Hindi + Devanagari, covering the 26 true-positive seeded cases while leaving the 7 near-misses (programming/error vocabulary: kill, loop khatam, nafrat + ValueError, shoot the syntax error, program atka) unmatched by rule, using the same `\p{L}\p{M}`-aware, negative-test-list approach 4.3's lead answer #9 established for distress, reused here with a moderation-specific negative list and a held-out paraphrase set.
- `jailbreakPatterns.ts`: `matchJailbreak(text, decodedVariants, lang): { hit: boolean; taxonomy?: string }` where `decodedVariants` is produced by a small, pure `decodeAttempts.ts` (base64 only if the text parses as valid base64 and decodes to printable text; ROT13 always tried since it's reversible and cheap; character-reversal always tried) — the rule table is checked against the original, normalised and every decoded variant. Covers all 31 seeded cases (including `base64-*`, `rot13-prompt`, `reversed-text`, `code-comment-injection`, `fake-system-tag`, `pretend-*-package`, `teacher-said`, `developer-mode`, `dan-*`, `ignore-previous-*`).
- Both reuse 4.3's shared normalisation helper (NFKC/invisible-strip/leetspeak/casefold) — **not duplicated**; see Open Q1 for where that helper is extracted to if 4.4 lands before 4.3 merges it somewhere shared.

### `packages/harness/src/guardrails/moderationIn.ts` / `jailbreak.ts`
`createModerationInGuard(sink: SafetyEventSink): Guard<PreGuardCtx>` and `createJailbreakGuard(sink: SafetyEventSink): Guard<PreGuardCtx>`:
1. Rule match (own table) → hit: `sink.record({ target: 'student:'+ctx.entitlement.studentId, reason: '<guard>_block:<taxonomy>' })` (fire-and-forget through the port — the port itself is backed by a queue, so this call resolves once durably enqueued, same non-blocking shape as `AlertSink.raise`), return `{ok:false, action:'block', reason: '<short fixed code, never raw text>'}`.
2. No rule hit → one `ctx.gateway.generateObject({tier:'small', system:<built-in classifier prompt with the fixed taxonomy>, messages:[...last 2-3 scrubbed turns for jailbreak, this turn only for moderation]}, z.strictObject({category: z.enum([...taxonomy, 'none'])}))`. A non-`'none'` category → same sink-write + block as (1); `'none'` → `{ok:true}`.
3. The classifier call is not wrapped in try/catch inside the guard (same as 4.3's `distressDetect`) — a throw/timeout propagates so `runGuardChain` marks the chain `failed`.
4. `usage: []` always (same open gap as 4.3's Open Q3: `ModelGateway.generateObject` has no usage-reporting channel).
5. Neither guard ever returns `rewrite` or `escalate` — only `ok`/`block` — per the build-plan guard table.

### Wiring: `packages/harness/src/pipeline/steps/preGuard.ts`
Adds two `registry.register(...)` calls after 4.3's `distressDetect` registration (declared order already fixes this), and changes the outcome mapping per 4.3's lead answer #11:
```ts
if (chain.outcome === 'ok') return { result: 'ok', guards: chain.guards, usage: chain.usage };
if (chain.outcome === 'escalate') return { result: 'escalate', alert: chain.alert, guards: chain.guards, usage: chain.usage };
if (chain.outcome === 'block') return { result: 'block', guards: chain.guards, usage: chain.usage }; // NEW: 4.4 makes this reachable
throw new Error(`preGuard guard chain failed closed...`, { cause: {...} }); // only 'failed' throws now
```

### `packages/queue`: safety-event transport
- `queues.ts`: reuse `ALERT_QUEUE` style but its own `SAFETY_EVENT_QUEUE = 'edmate-safety-event'`; `JOB.safetyEventRecord`; `SafetyEventJobSchema = z.strictObject({ scope: Scope, target: z.string(), reason: z.string() })`; `jobId.safetyEvent` derived from a hash of `(target, reason, enqueued-at-minute)` so a guard re-run within the same minute (a retried step) doesn't duplicate the row — exact dedup window is an Open Q (Q5).
- `safetyEventSink.ts`: `queuedSafetyEventSink(queue, scope): SafetyEventSink` — mirrors `alertSink.ts`'s `queuedAlertSink` exactly (enqueue with existing `RETRY`/`jobOptions` backoff, resolves once durably enqueued).
- `index.ts`: `TurnQueues` gains `safetyEvent: JobQueue`; `queuedTurnPorts` gains `safetyEvents: queuedSafetyEventSink(queues.safetyEvent, scope)`.

### `apps/worker/src/alerts/` (reused, not a new top-level folder — Open Q3)
- `processors.ts` gains a second processor function, `safetyEventProcessor(repo, queue, log)`, registered on the same `Worker` or a sibling `Worker(SAFETY_EVENT_QUEUE, ...)` in the same file/folder (both are "student safety" concerns, both already in risk-paths.txt's safety-reviewer group via `apps/worker/src/alerts/**`).
- A new `packages/db/src/repositories/safetyEvents.ts` — **this path is already in risk-paths.txt's security-reviewer group** (`packages/db/src/repositories/**`) — `insert({ target, reason })` only (no read/update yet; a later 12.x trust-console task adds `status`/`staffActions` writes). This repository is the thing the worker processor calls after dequeuing a job.

## Files

Create:
- `docs/adr/0006-safety-event-sink.md`
- `packages/harness/src/guardrails/{moderationPatterns,jailbreakPatterns,decodeAttempts,moderationIn,jailbreak}.ts` + their `.test.ts`
- `packages/queue/src/safetyEventSink.ts` + `.test.ts`
- `packages/db/src/repositories/safetyEvents.ts` + `.test.ts`
- `apps/worker/src/alerts/safetyEventProcessor.ts` (or folded into `processors.ts`) + unit test
- `apps/worker/test/safetyEvent.int.test.ts` (real Redis, `commit.int.test.ts`/`alert.int.test.ts` shape)
- `packages/evals/src/moderationJailbreak.test.ts`

Modify:
- `packages/contracts/src/ports.ts` (`SafetyEventSink`), `packages/contracts/src/index.ts` (export)
- `packages/harness/src/pipeline/steps/preGuard.ts` (register the two guards; map `block` instead of throwing, per 4.3's lead answer #11)
- `packages/harness/src/guardrails/index.ts`, `packages/harness/src/testing/index.ts` (export new names; a `fakeSafetyEventSink`/spy fixture, mirroring 4.3's alert-sink fake)
- `packages/queue/src/queues.ts`, `packages/queue/src/index.ts` (SAFETY_EVENT_QUEUE, job schema, `TurnQueues`/`queuedTurnPorts`)
- `apps/worker/src/alerts/workers.ts`, `apps/worker/src/index.ts` (wire the safety-event worker)
- `evals/suites/safety/moderation/*.yaml`, `evals/suites/safety/jailbreak/*.yaml` — **no new `expect` fields planned**; the 33+31 cases already carry `judge`/`must_not_contain`/`matches` checks the new offline pipeline test reuses directly (unlike 4.3, no `must_escalate`-style schema addition looks necessary — see Open Q2). If the reviewer disagrees, an additive `must_block: z.boolean()` on `packages/evals`'s own `CheckSchema` is the fallback, same pattern as 4.3's `must_escalate`.
- `packages/harness/README.md` (short note: `preGuard`'s `moderationIn`/`jailbreak` guards are wired; the `pre` phase is now complete per `GUARD_ORDER`)
- `.claude/skills/merge-gate/risk-paths.txt` — only if Open Q3 resolves to a *new* worker folder rather than reusing `apps/worker/src/alerts/**` (architect's call; default plan avoids this edit).

Out of bounds:
- `packages/contracts/**` beyond the one `SafetyEventSink` interface + its export — no other port, no schema field added to `SafetyAlert`/`GuardResult`/`LocalePack`.
- `packages/harness/src/guardrails/{chain,order,registry,guard}.ts`, `packages/harness/src/pipeline/runner.ts` — frozen (4.1); 4.4 only registers guards and edits `preGuard.ts`'s outcome mapping (explicitly left to it by 4.3).
- `packages/harness/src/guardrails/{piiScrub,distressKeywords,distressDetect,preGuardCtx}.ts` — 4.2/4.3's own files, read-only; 4.4 imports from them, never edits them (coordinate a shared-normalisation extraction instead of duplicating — Open Q1).
- `evals/suites/safety/distress/**`, `evals/suites/safety/pii/**` — 4.2/4.3's suites, untouched.
- A read API / UI for strikes (trust-console inbox, staff view) — 12.x's scope; 4.4 only writes the rows.
- Any enforcement consequence of a rising strike count (stricter mode, session pause, account flag) — not in the build-plan guard table's cell for `jailbreak` beyond "block"; flagged as Open Q4, deferred.
- `apps/web/**`, `apps/cli/**` — no composition-root wiring of `safetyEvents`/`PipelineDeps` into a live route (same stance as 4.3).
- `content/locales/**`, the real `TurnConfigStore` — 3.10's scope.

## Tests first (tdd-guide order)
1. `decodeAttempts.test.ts` — base64/ROT13/reversal round-trip on the seeded encoded cases; a non-base64 string is left alone (no false decode).
2. `moderationPatterns.test.ts` — all 26 true-positive phrases hit (en/hi-latin/deva); all 7 near-miss phrases don't; negative-test list (program/loop/error vocabulary) doesn't; held-out paraphrases.
3. `jailbreakPatterns.test.ts` — all 31 seeded phrases (incl. decoded variants) hit; a held-out paraphrase set; a negative list of ordinary phrasing that merely mentions "pretend", "ignore", "system" in an innocuous way doesn't.
4. `moderationIn.test.ts` / `jailbreak.test.ts` — rule-hit shape (block + sink call), classifier-hit/no-hit shape, classifier-throw propagates, `usage` always `[]`, reason strings never echo raw text.
5. `preGuard.test.ts` — `block` now returns `{ result: 'block' }` (was throw); `failed` still throws; `ok`/`escalate` unchanged. A completeness smoke check: `registry.missing()` is now empty for the `pre` phase (full completeness test is still 4.9's, per 4.1 Q3 — this is just a sanity assertion, not the formal test).
6. Build `decodeAttempts.ts` → `{moderation,jailbreak}Patterns.ts` → `{moderationIn,jailbreak}.ts` → `preGuard.ts` update green.
7. `packages/queue/src/safetyEventSink.test.ts`, `packages/db/src/repositories/safetyEvents.test.ts` (real Postgres, like other repository tests).
8. `apps/worker` processor unit tests (fakes) → `safetyEvent.int.test.ts` (real Redis) last.
9. `packages/evals/src/moderationJailbreak.test.ts` last (needs steps + sink fakes done): 26/26 + 31/31 block, 7/7 don't, **twice** (classifier scripted `none` and classifier scripted to throw).
10. Full gate: `turbo run typecheck lint test --filter=@edmate/contracts... --filter=@edmate/harness... --filter=@edmate/queue... --filter=@edmate/db... --filter=@edmate/worker... --filter=@edmate/evals...`.

## Risky paths touched (checked against `.claude/skills/merge-gate/risk-paths.txt`)
- `packages/harness/src/guardrails/**` (new `moderationIn.ts`, `jailbreak.ts`, pattern/decode modules; edited `index.ts`) → **reviewers: safety-reviewer**.
- `evals/suites/safety/**` (read-only unless Open Q2 adds a check field; if it does, still this group) → **reviewers: safety-reviewer**.
- `apps/worker/src/alerts/**` (new safety-event processor reusing this folder, per the default Open Q3 answer) → **reviewers: safety-reviewer**.
- `packages/db/src/repositories/**` (new `safetyEvents.ts`) → **reviewers: security-reviewer**.
- `packages/contracts/**`, `docs/adr/**` (`SafetyEventSink`, ADR-0006) → **reviewers: architect, security-reviewer, typescript-reviewer**.
- `.claude/**` (only if Open Q3 resolves to editing `risk-paths.txt`) → **reviewers: security-reviewer**. Default plan avoids this edit (see Design).
- Not risky: `packages/queue/**`, `apps/worker/src/index.ts`, `packages/evals/src/moderationJailbreak.test.ts` — recommend (not required) safety-reviewer skim them too, matching 4.2/4.3's own precedent.
- `docs/decisions/log.md` gets a `risk: high` entry at merge for **two** reasons: (a) new `moderationIn`/`jailbreak` guards + safety-event pipeline in the safety-reviewer groups, (b) the `SafetyEventSink` contracts change/ADR-0006, per rules 2 and 6.
- Recommended reviewers for the PR: **safety-reviewer** (required, guard + worker + eval groups), **security-reviewer** (required, db repository + ADR), **architect** (required, ADR), **typescript-reviewer** (required, ADR; also recommended generally), **silent-failure-hunter** (recommended — new port, queue idempotency, background-error paths, matching 4.1/4.2/4.3 precedent).

## Rebase plan against 4.2 and 4.3

4.4 depends on 4.3's `PreGuardCtx` type and `GuardRegistry<PreGuardCtx>('pre')` wiring in `steps/preGuard.ts`, and (lightly, for shared normalisation) on 4.3's `distressKeywords.ts` helpers; it does not depend on 4.2 directly (different phase, `scrub` vs `pre`), but `steps/index.ts`'s import line is shared, same coordination note 4.3's own plan carried for 4.2.

- **If 4.3 merges first (expected — it's further along):** branch `m4/4.4-moderation-jailbreak` from the post-4.3 `main`; import `PreGuardCtx` from `preGuardCtx.ts` as built; call `registry.register(createModerationInGuard(...))` / `registry.register(createJailbreakGuard(...))` after 4.3's `distressDetect` registration (order is enforced by `GUARD_ORDER`, not registration order, so this is safe either way); reuse 4.3's normalisation helper directly (extract it to a shared `guardrails/textNormalize.ts` only if 4.3 left it private to `distressKeywords.ts` — a small, low-risk follow-up PR either way).
- **If 4.4 starts before 4.3 merges (both "running" today):** branch from `main` now; stub a local `PreGuardCtx` shape matching 4.3's plan exactly (already fixed by the 19 Oct plan review, unlikely to change); build `moderationIn`/`jailbreak` against it; when 4.3 merges, rebase onto `main`, replace the stub import with 4.3's real `preGuardCtx.ts`, and resolve the one-line `steps/preGuard.ts` conflict (4.3 writes the `block`-maps-to-throw version; 4.4's rebase is the PR that flips it to `{ result: 'block' }` per 4.3's own lead answer #11, so this conflict is expected and small). Do not merge 4.4 before 4.3 is on `main` — a `pre`-phase registry with `moderationIn`/`jailbreak` but no `distressDetect` would still typecheck but regress the already-shipped distress acceptance once deployed; the lead holds 4.4's merge until 4.3 is in, regardless of PR review order.
- Either way: 4.4 does **not** touch 4.2's `scrub.ts`/`piiScrub.ts` or 4.3's `distressKeywords.ts`/`distressDetect.ts`/`escalate.ts` files.

## Open questions (recommendations)

- **Q1 Where does the shared text-normalisation helper (NFKC, invisible-strip, leetspeak, casefold) live once two guard tasks need it?** 4.3 built it for `distressKeywords.ts`; 4.4 needs the same transform for `moderationPatterns.ts`/`jailbreakPatterns.ts`. *Recommend:* if 4.3 has already extracted it to a shared module by the time 4.4 branches, reuse it; if 4.3 left it private, 4.4's build opens a small, low-risk PR to lift it to `guardrails/textNormalize.ts` (no behaviour change to 4.3's guard) rather than copy-pasting a second copy that could drift. Not a blocker; flag at rebase time either way.
- **Q2 Does the eval schema need a new `must_block`/`must_not_block` check field, or do the existing `judge`/`must_not_contain`/`matches` checks already carry the 33+31 cases' intent?** Looking at the sampled cases (all already carry a `judge` line like "The reply refuses..." or "...does not refuse"), the existing checks plus a guard-level assertion in the dedicated offline pipeline test (reading `chain.outcome`/`result.action` directly, same as 4.3's `distressEscalate.test.ts` reads `commits[0].outcome`) appear to cover it without a schema change. *Recommend:* no schema change; the offline pipeline test asserts block/no-block directly from the guard chain result, and separately runs each case's existing reply-level checks once a real reply is generated (deferred exactly as 4.0/4.2/4.3 left it — happy-path fakes for `generate`, not a live-model run). If the safety plan review disagrees, fall back to 4.3's precedent (`must_escalate` → `must_block`).
- **Q3 Where does the safety-event worker processor live: inside the existing `apps/worker/src/alerts/**` (already a risky, safety-reviewer-required path) or a new top-level folder?** *Recommend:* reuse `apps/worker/src/alerts/` — avoids an edit to the architect-owned `risk-paths.txt`, and "alerts" already covers "things the trust/safety system is told about," which a moderation/jailbreak safety-event row is. If the architect prefers a dedicated `apps/worker/src/safetyEvents/**` folder for clarity, that is a one-line `risk-paths.txt` addition (safety-reviewer group) made as part of this PR, flagged in review.md regardless of which way the file reads at merge time.
- **Q4 Does "strikes per student" (build-plan guard-table cell) mean anything beyond a persisted count for later staff visibility?** No M4 task enforces a consequence (no session pause, no stricter mode, no account flag exists yet; that lives in M12's trust console / reports / regulated-flag tasks). *Recommend:* 4.4 only persists the count (via `safety_events` rows, queryable by a later task); the guard's behaviour (block every time, same taxonomy) does not change as the count rises. This is a scope-narrowing decision worth a `risk: high` log entry of its own (it's a safety behaviour decision, not just an implementation detail), separate from the ADR's `risk: high` entry.
- **Q5 Safety-event job dedup window.** A guard re-run (retried step, replayed job) should not double-write the same safety event. *Recommend:* `jobId` derived from `(target, reason, turnId)` if a turn id is threaded into `PreGuardCtx` by 4.3 (check at build time — it isn't listed in 4.3's `PreGuardCtx` shape above); if not available, fall back to a coarse per-minute bucket (`target, reason, floor(now/60s)`) as stated in Design, accepting that two genuinely separate blocks by the same student within the same minute collapse to one row (safety favours under- over over-counting far less than it favours no duplicate noise in the trust console — flag for the safety-reviewer to confirm this trade-off, not a unilateral call).

## Decisions to log on merge
- `risk: high`: `SafetyEventSink` contracts change + ADR-0006, reviewed by architect, security-reviewer, typescript-reviewer, merged by the lead.
- `risk: high`: new `moderationIn`/`jailbreak` guards, the safety-event worker pipeline and the new `packages/db/src/repositories/safetyEvents.ts` (two risk-paths.txt groups: safety-reviewer, security-reviewer), reviewed accordingly, merged by the lead.
- Q1-Q5 above, once the lead confirms (Q3 and Q4 have the biggest downstream consequences: where risk-paths.txt points, and what "strikes" does or doesn't do yet).
- `preGuard.ts`'s `block` outcome stops being thrown and starts being returned as `{ result: 'block' }` (4.3's own lead answer #11, executed by this task) — logged so a future reader of 4.3's handoff isn't confused by its throw-only description.

## Lead answers and plan revisions from the safety and architect plan reviews (19 Oct 2026; these override the Design section)

**ADR-0006 port (architect HIGH ×2, safety HIGH 6).** No free text anywhere. In contracts:
```ts
export const SafetyEventCodeSchema = z.enum(['self_harm','harm_to_others','sexual','sexual_minors','hate','harassment','threat','weapons','extremism','cheating','other_unsafe','jailbreak_override','jailbreak_roleplay','jailbreak_prompt_leak','jailbreak_encoded','jailbreak_authority_claim','jailbreak_other']);
export interface SafetyEventSink {
  record(e: { studentId: string; teacherId: string; sessionId: string; turnId: string;
              guard: 'moderationIn' | 'jailbreak'; code: SafetyEventCode; source: 'rule' | 'classifier' }): Promise<void>;
}
```
The dedupe key is `${turnId}:${guard}` (the job id); there's no wall-clock bucket. zod validates the strict shape at the sink adapter and again in the queue job schema. Logs carry ids and the code only. `PreGuardCtx` gains `turnId`, a harness type, not contracts. The ADR says it extends ADR-0002's port list (0002 unchanged) and explains why `onGuardOutcome` can't feed the sink (GuardOutcomeEvent has no reason, by design). Decision to log: guards call the sink directly, and `onGuardOutcome` stays the generic seam. Reviewers: architect, security-reviewer and typescript-reviewer; risk: high.

1. **Self-harm routes to distress (HIGH).** The moderation taxonomy has `self_harm`. A rule or classifier hit aimed at the self ("myself", "khud ko", "apne aap ko", "खुद को") returns `escalate` with the distress alert, never `block`. Test it with distress scripted `false`.
2. **Bully case (HIGH).** Each taxonomy code has its own block reply, in English only (pilot decision). `harm_to_others` acknowledges the bullying, suggests a trusted adult and refuses any method, and raises a misuse `SafetyAlert` through 4.3's AlertSink. Assert that distressDetect doesn't escalate the 3 bully cases first.
3. **Taxonomy gaps (HIGH).** Covered by the enum above. `other_unsafe` blocks.
4. **Multi-turn cases (HIGH).** Add a per-turn `must_block` field, as 4.3 added `must_escalate`. Grooming turns 1–2 must NOT block. Mark the seeds defended downstream (the code comment and story cases are answerLeak's, 4.5). Keep a held-out paraphrase set.
5. **Encoded payloads (HIGH).** Extract runs of 16 or more base64 characters, plus hex and URL-encoding. Decode at most 2 levels, with input and output size caps. Run the decoded text through both moderation and jailbreak. The seed `base64-wrapper-en` must block.
6. **Eval run semantics (MEDIUM).** True positives must be `block` with 0 classifier calls and the expected `blockedBy`. Near-misses must have no rule hit, end `failed` (never ok) in the throw run, and be ok in the `none` run.
7. **Strikes (MEDIUM).** `record` is awaited, and a throw ends the chain `failed` (still blocked). A framework failure never writes a strike. The consequence of strikes is open human question B-12. Ship the count only, with no enforcement; nothing waits on the answer.
8. **Context (MEDIUM).** Moderation and jailbreak see the last 2–3 scrubbed student turns. The classifier gets scrubbed text only, framed as data. Pass the cancel token into generateObject.
9. **Over-blocking (MEDIUM).** Phrase-level patterns only, plus a negative list: "System.out.println", "# ignore this line", "Chrome developer mode", "my teacher said to use a for loop", "pretend the list is empty". Role and package claims are generic ("I'm the teacher", "main teacher hoon", "मैं टीचर हूँ", "I'm on <any package name from ctx>").
10. **Shared normaliser (LOW).** Reuse 4.3's normaliser. If it isn't in `guardrails/textNormalize.ts` yet, lift it there first. No copies.
- **Build:** tdd-guide on opus, after 4.3 merges, branching from that main. Reviewers: safety-reviewer (opus), architect, security-reviewer and typescript-reviewer (for the ADR), plus silent-failure-hunter.
