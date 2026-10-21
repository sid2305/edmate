# ADR-0006: SafetyEventSink port and SafetyEventCode

## Status

Proposed

## Date

2026-10-19

## Context

The build plan's guard table (§ Guardrails) says `moderationIn` blocks and logs a `safety_event`, and `jailbreak` blocks and counts strikes per student. Task 4.4 builds both guards. The `safety_events` table exists (task 1.1) but nothing can write it: task 4.1's handoff (Q1) left "no port, table writer or persistence" for the safety-event seam and said the first guard task that writes one raises this ADR.

The harness may only reach the outside world through ports (rule 3, ADR-0002), so it needs a port. The 4.4 plan review (architect HIGH x2, safety HIGH 6, 19 Oct 2026) asked for no free text anywhere in the event, a fixed set of codes, and a dedupe key that does not depend on the wall clock.

The guard framework already has a generic seam, `GuardChainOptions.onGuardOutcome` (task 4.1). It cannot feed this sink: its `GuardOutcomeEvent` carries the guard name, phase, pass and outcome but no reason, code, student, session or turn, by design (ADR-0003 style: nothing a guard says leaves it as text). Adding a code to it would widen a seam every guard and every caller shares, for two guards' needs.

## Decision

Add to `packages/contracts` and to the build plan's Core contracts block:

```ts
type SafetyEventCode = 'self_harm' | 'harm_to_others' | 'sexual' | 'sexual_minors' | 'hate' | 'harassment' | 'threat' | 'weapons' | 'extremism' | 'cheating' | 'other_unsafe'
  | 'jailbreak_override' | 'jailbreak_roleplay' | 'jailbreak_prompt_leak' | 'jailbreak_encoded' | 'jailbreak_authority_claim' | 'jailbreak_other';
interface SafetyEventSink {
  record(e: { studentId: string; teacherId: string; sessionId: string; turnId: string; guard: 'moderationIn' | 'jailbreak'; code: SafetyEventCode; source: 'rule' | 'classifier' }): Promise<void>;
}
```

1. **`SafetyEventCodeSchema`** is a `z.enum` in `packages/contracts/src/safety.ts`; `SafetyEventSink` is type-only in `ports.ts`, like every port. This extends ADR-0002's port list; ADR-0002 is unchanged because accepted ADRs are not rewritten.
2. **No free text.** The event is ids, the guard, a code and whether a rule or the classifier decided. No excerpt, reason string or student text. Logs about an event carry ids and the code only.
3. **Validated twice.** The queue adapter (`@edmate/queue`'s `queuedSafetyEventSink`) parses the event with a strict schema before it enqueues, and the worker parses the job payload with the same schema before it writes. Anything else is refused.
4. **Dedupe key `${turnId}:${guard}`.** It is the job id (with `.` for `:`, which BullMQ refuses) and the row id's input. A retried step or a replayed job writes one row. No wall-clock bucket.
5. **Guards call the sink directly**, through `PreGuardCtx` (a harness type, which also gains `turnId`). `record` is awaited: a throw ends the chain `failed`, so the turn is still refused. A framework failure (a classifier throw or timeout) never writes an event. `onGuardOutcome` stays the generic, text-free seam for every guard.
6. **Strikes are a count.** A student's jailbreak strikes are the number of their `safety_events` rows from `jailbreak`. Nothing enforces a consequence yet (open human question B-12).
7. **Storage** uses the existing table with no migration: `target` is `session:<sessionId>` (so reads scope to a student x teacher through the session row), `reason` is `<guard>:<code>:<source>`, and the row id is a hash of the dedupe key.

## Alternatives

- **Feed `onGuardOutcome` and write rows from the chain's caller.** Rejected: `GuardOutcomeEvent` has no code, student, session or turn by design; adding them widens a seam all guards share and invites text into it.
- **A free-text `reason` (`moderation_block:<taxonomy>`, the plan's first draft).** Rejected in plan review: any string field becomes a place where text leaks in. A closed enum makes that a type error and a parse error.
- **Reuse `AlertSink` with `kind: 'misuse'`.** Rejected: a SafetyAlert carries an excerpt and goes to a human inbox with on-call escalation. Most blocks need neither. (A `harm_to_others` block does raise a misuse alert as well, through `AlertSink`.)
- **A wall-clock dedupe bucket (the plan's Q5 fallback).** Rejected: two real blocks in the same minute would merge, and a slow retry would split one block into two rows. The turn id is exact.
- **New columns on `safety_events`.** Deferred: the session row already gives the student and teacher. A trust-console task (12.x) can add columns with a migration if it needs them.

## Consequences

- Moderation and jailbreak blocks are countable per student x teacher with no text stored, ready for the trust console (12.x) and for whatever B-12 decides strikes do.
- A new code needs another ADR, like any contract change. The guards' rule tables and block replies key off this enum, so a missing reply or rule is a type error.
- `record` failing makes the turn fail closed (blocked with a retryable error) instead of silently losing the event. The cost is one more way a turn can fail when the queue is down; the alert queue has the same property.
- The composition roots (web turn route, CLI, eval runner) must pass a `SafetyEventSink` in `PipelineDeps`; `@edmate/queue`'s `queuedTurnPorts` provides one.
- Owners: 4.4 (port, codes, queue adapter, worker processor, repository, this ADR, the build plan's contracts block).

## Reviewers

architect, security-reviewer, typescript-reviewer (requested on the 4.4 PR). The team lead approves and logs it `risk: high`.
