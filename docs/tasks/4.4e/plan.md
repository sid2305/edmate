# Task 4.4e: the strike consequence (B-12)

## Acceptance (verbatim)
- a session with 3 strikes blocks the next ambiguous-only hit and sends exactly one trust-team notice;
- a session with 2 strikes behaves as today;
- the count resets with a new session;
- no student text appears in the notice.

## How it will be shown
Unit tests on `jailbreak.ts`, `moderationIn.ts` and the new strike-count read in `preGuard.ts`,
plus an integration-style `preGuard.test.ts` case that runs the real pre-guard chain against a
memory `TranscriptStore` seeded with 0, 2 and 3 prior jailbreak-coded withheld messages in the
session history, and a fresh different session, asserting: strict/not-strict behaviour, the
single deterministic alert on the turn that makes strike 3, no alert on strikes 4+, and
`excerptRedacted === ''` on that alert (no student text). `turbo run typecheck lint test
--filter=@edmate/harness...`.

## Design

### Where the session's strike count comes from
No new port, no DB change, no contracts change. A jailbreak safety event is the strike (decision
"4.4 strikes are a count only", 19 Oct 2026); the blocked student message is already saved as
`[message withheld: <code>]` by `commit.ts`, and jailbreak codes are the only `SafetyEventCode`
values with a `jailbreak_` prefix. So the count comes from the **existing** `TranscriptStore.history`
port (already used by `recentStudentTurns` in `preGuard.ts`), read with a higher limit and counted
client-side:

- New function in `preGuard.ts`, `priorJailbreakStrikes(env): Promise<number>` — same
  best-effort shape as `recentStudentTurns`/`teacherPackageNames` (runWithTimeout at
  `HISTORY_TIMEOUT_MS`, `env.report` on failure), reading
  `env.deps.transcripts.history(env.input.sessionId, STRIKE_HISTORY_LIMIT)` with a new local
  constant `STRIKE_HISTORY_LIMIT = 200` (harness can't import `packages/db`'s own
  `HISTORY_MAX_LIMIT`, so this mirrors that cap by comment, not by import — flagged below as a
  small decision).
- Counts messages where `isWithheld(m)` and the parsed code starts with `jailbreak_`. Add one
  small exported helper to `policies.ts`, `withheldCode(text): string | undefined` (the same
  regex `WITHHELD` already used by `blockedTurnNote`, just returning the raw code instead of a
  note string), so the count and `blockedTurnNote` share one regex.
- On a failed/slow/malformed read: count defaults to 0 (fail open on the *consequence*, not on
  the guard itself — a transient history glitch means that one turn doesn't get the stricter
  checks; it does not weaken anything the guards do today, since decisive hits and the
  classifier still run exactly as now). This matches the fail-open convention already used by
  `recentStudentTurns` and `teacherPackageNames`. Noted as a plan decision, not an open question:
  reversible, low risk.
- Read concurrently with the other two preGuard reads (same pattern as today), new `PreGuardCtx`
  field `priorJailbreakStrikes: number | Promise<number>`.

### How "stricter mode" reaches the guards without touching `packages/contracts`
`PreGuardCtx` is a harness-local type (`packages/harness/src/guardrails/preGuardCtx.ts`), not a
contracts type — it already exists precisely so later 4.4 work can extend it without a contracts
change (its own file comment says so). Add one field, `priorJailbreakStrikes`, and one shared
constant, `STRIKE_THRESHOLD = 3` (exported once from `preGuardCtx.ts`, imported by both guards —
not duplicated). No `packages/contracts` file is touched by this task; no ADR needed.

In `jailbreak.ts` and `moderationIn.ts`, the only behaviour change is at the point where today an
ambiguous rule hit's classifier result is `none` and the guard passes:
```
if (hit !== undefined && v.category === 'none') {
  const strict = (await ctx.priorJailbreakStrikes) >= STRIKE_THRESHOLD;
  if (strict) return block(ctx, hit.code, 'rule'); // or verdict(...) in moderationIn
}
```
The classifier is still always called first ("the classifier runs on every message" — already
true today for every non-decisive-rule message; this task does not change when the classifier
runs, only what happens when it says `none` and the rule hit was ambiguous). If the classifier
returns a real category, its code still wins (unchanged, more specific than the generic rule
code). Decisive hits, the self_harm escalate path, and the fail-closed-on-classifier-failure path
are all unchanged. moderationIn blocks under strict mode do **not** add to the strike count
(only jailbreak rows are strikes, per the cited decision) — no change needed there.

### Exactly one notice, idempotent, no student text
The notice is a `SafetyAlert` (kind `other`, level `info` — nothing today branches on `kind`, and
`info` is a valid existing `SafetyAlertSchema` level), built and attached only in `jailbreak.ts`'s
existing `block()` helper, only on the turn where the new strike is the **third**:
```
const priorCount = await ctx.priorJailbreakStrikes;
const alert = priorCount === STRIKE_THRESHOLD - 1 ? strikeNotice(ctx) : undefined;
```
`strikeNotice(ctx)` mirrors `preGuardAlert` in `moderationIn.ts` but sets
`excerptRedacted: ''` — never a slice of the message — satisfying "no student text appears in
the notice" more strictly than the existing misuse/distress alerts (which do carry a short
redacted excerpt). The alert's `id` is **deterministic**, not `ctx.ids.next('alert')`:
`` `alert_strike3_${ctx.sessionId}`.slice(0, 128) `` (sessionId is already a valid id-charset
string; the prefix is too, so the result is always a valid id). This reuses the existing
dedupe-by-`alert.id` built into `@edmate/queue`'s `queuedAlertSink` (`alertJobOptions(jobId.
alertRaise(alert.id))` and the escalate-check job) — a retried turn, a worker replay, or two
near-simultaneous turns that both compute "this is strike 3" all produce the *same* alert id, so
the queue adds nothing new after the first job exists. Attaching the alert only on the exact
strike-3 transition (not on every strict-mode block after that) is what makes it "exactly one" by
construction; the deterministic id is the backstop against races on that one turn.
The alert flows out through the **existing** plumbing with no changes to `preGuard.ts`'s outcome
handling or `runner.ts`: `PreGuardBlock.alert` is already forwarded to the block reply (the
moderationIn misuse-alert path does the same today), and `runner.ts` already calls
`deliverAlert` → `deps.alerts.raise` → `AlertSink.raise`, which always notifies `trust_team`
first (`apps/worker/src/alerts/types.ts`: "`trust_team` on every alert"). `on_call` paging only
happens later if nobody acknowledges within the existing escalation window — that is standing
behaviour for every alert level today (a per-level delay is explicitly flagged in
`queue/src/alertSink.ts` as its own future policy change, out of scope here); worth naming to the
lead but not a new decision this task introduces.

### No contracts change
Confirmed above: no field is added to any `packages/contracts` type, no port gains a method, no
new port is created. Everything needed (`TranscriptStore.history`, `AlertSink.raise`,
`SafetyEventSink.record`) already exists. If, during build, the chosen approach turns out to
need a contracts change after all (e.g. a reviewer finds the 200-row history read too slow and
wants a dedicated count port), the builder stops and asks — that needs an ADR and
architect/security-reviewer/typescript-reviewer, which is a different build.

## Files to create/modify
- `packages/harness/src/guardrails/preGuardCtx.ts` — add `priorJailbreakStrikes` field, export
  `STRIKE_THRESHOLD`.
- `packages/harness/src/guardrails/jailbreak.ts` — strict-mode ambiguous block + one-time
  `strikeNotice` alert on the strike-3 transition.
- `packages/harness/src/guardrails/moderationIn.ts` — strict-mode ambiguous block (no alert, no
  strike-count change).
- `packages/harness/src/pipeline/steps/preGuard.ts` — `priorJailbreakStrikes(env)` read,
  `STRIKE_HISTORY_LIMIT` constant, wire into `ctx`.
- `packages/harness/src/pipeline/policies.ts` — export `withheldCode`.
- `packages/harness/src/guardrails/jailbreak.test.ts` — extend "ambiguous hit" describe block.
- `packages/harness/src/guardrails/moderationIn.test.ts` — extend "ambiguous hit" describe block.
- `packages/harness/src/pipeline/steps/preGuard.test.ts` — new strike-count/strict-mode cases.

## Files out of bounds
`packages/contracts/**`, `packages/db/**`, `packages/queue/**`, `apps/worker/src/alerts/**`,
`packages/harness/src/pipeline/runner.ts` (no change needed — reuses existing alert plumbing),
`distressDetect.ts` (self_harm handling is untouched by this decision).

## Tests first
1. `jailbreak.test.ts`: ambiguous hit + classifier `none` + `priorJailbreakStrikes` resolving to
   0, 1, 2 → passes (today's behaviour — the 2-strike acceptance case: behaves as today).
2. `jailbreak.test.ts`: ambiguous hit + classifier `none` + `priorJailbreakStrikes` resolving to
   3 (or more) → blocks with the rule's own code, source `rule`, a new safety event recorded —
   the "blocks the next ambiguous-only hit" acceptance case.
3. `jailbreak.test.ts`: same as #2 but classifier returns a real category (not `none`) → blocks
   with the classifier's code (unchanged passthrough; strict mode never downgrades a worse
   verdict).
4. `jailbreak.test.ts`: decisive hit, `priorJailbreakStrikes` at 1 (making this the 2nd strike) →
   blocks as today, no alert attached (only the exact 3rd strike gets a notice).
5. `jailbreak.test.ts`: decisive hit, `priorJailbreakStrikes` resolving to 2 (this block is the
   3rd strike) → blocks, and the block carries an `alert` with `kind: 'other'`, `level: 'info'`,
   `excerptRedacted: ''`, a deterministic id derived only from `sessionId`.
6. `jailbreak.test.ts`: same count (2) called twice with the same `ctx.sessionId` → both alerts
   have the identical `id` (the idempotency property, asserted directly — queue dedupe itself is
   out of scope for this package's tests).
7. `jailbreak.test.ts`: `priorJailbreakStrikes` resolving to 3 or more on a *new* decisive block
   → no alert attached (only the transition turn gets one).
8. `moderationIn.test.ts`: the mirror of #1/#2 for an ambiguous moderation hit (no alert either
   way; moderationIn never attaches the strike notice).
9. `preGuard.test.ts`: `priorJailbreakStrikes(env)` reads `transcripts.history` with the new
   limit and counts only `[message withheld: jailbreak_*]` student messages, ignoring
   `[message withheld: <moderation code>]` and agent messages.
10. `preGuard.test.ts`: a failed/timed-out history read gives count 0 (fail open), reported via
    `env.report`, same shape as the existing `recentStudentTurns` failure test.
11. `preGuard.test.ts` (acceptance, end to end through `createPreGuardStep`): a session with 2
    prior jailbreak strikes in its transcript behaves exactly as today on an ambiguous-only
    message. A session with 3 prior jailbreak strikes blocks that same message. A different
    `sessionId` (new session) with the first session's 3 strikes in *its* history is unaffected —
    the count resets with a new session, because `transcripts.history` is already scoped to one
    session.
12. `policies.test.ts`: `withheldCode('[message withheld: jailbreak_override]') === 'jailbreak_override'`;
    `withheldCode('[message withheld]') === undefined`; `withheldCode('hi') === undefined`.

## Risky paths touched (checked against `.claude/skills/merge-gate/risk-paths.txt`)
- `packages/harness/src/guardrails/preGuardCtx.ts`, `jailbreak.ts`, `jailbreak.test.ts`,
  `moderationIn.ts`, `moderationIn.test.ts` — match `packages/harness/src/guardrails/**` →
  reviewers: `code-reviewer` (MVP-first pilot gate; `risk: high` decision logged at handoff).
- `packages/harness/src/pipeline/steps/preGuard.ts`, `preGuard.test.ts`,
  `packages/harness/src/pipeline/policies.ts` — **not** under `guardrails/**`, no other group
  matches. Listed here for completeness; no extra reviewer required by the gate for these two
  files alone, but since they sit next to a guardrails-group PR the lead should have
  `code-reviewer` look at the whole diff anyway.
- Nothing under `packages/contracts/**`, `packages/db/**`, `.claude/**`, or any security-reviewer
  or architect group.

## Open questions
None blocking. Two decisions to log at handoff (not open questions, just worth a line each):
1. Fail-open strike count on a bad history read (consequence-only, guards unaffected) — reversible.
2. `STRIKE_HISTORY_LIMIT = 200` is a harness-local constant mirroring `packages/db`'s
   `HISTORY_MAX_LIMIT` by value/comment, not by import (harness can't import `packages/db`) — if
   the DB cap ever changes, this constant needs a matching edit. Reversible, low risk.

## Budget
Budget: 90 tool calls (1 phase, packages/harness)

## Allowed tools
Read, Grep, Glob, Edit, Write, Bash (pnpm turbo typecheck/lint/test --filter=@edmate/harness..., and secret-scan)

## Exit conditions
Status: DONE when all 12 tests pass, `turbo run typecheck lint test --filter=@edmate/harness...`
is green, and the three guard-table acceptance cases (2 strikes / 3 strikes / new session) are
each a named test. Status: PARTIAL past ~90 tool calls, or if a reviewer or the builder decides
the strike count needs an actual DB/contracts change (stop and ask — that is a different, ADR-
gated build).

## Lead review (28 Oct 2026)
READY, approved as written. Notes for the builder:
- Record the window limit as a builder decision. Strikes older than the last `STRIKE_HISTORY_LIMIT` messages fall out of the count, so a very long session can leave strict mode. That is acceptable for the pilot, and the notice id stays the same, so a second strike-3 transition in that session dedupes.
- Say in the handoff whether a strict-mode block of an ambiguous hit is saved as a `jailbreak_*` withheld message, which would make it count as a strike. Either answer is fine; test it, and record it as a decision.
- The trust-team notice must carry no student text and no student name: only the code, the session id and the tenant ids the alert path already uses.
