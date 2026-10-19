# 4.3 handoff: `distressDetect`, escalate, and the alert worker with acknowledgement and 15-minute escalation

- **Status:** DONE
- **Branch:** `m4/4.3-distress` (from origin/main 4cd6398, rebased onto e30ed5b: 4.2 and 3.7 merged)
- **Worktree:** `.claude/worktrees/agent-a7309b335c2005c77` (repo-relative)
- **Risky paths:** `packages/harness/src/guardrails/**`, `apps/worker/src/alerts/**`, `evals/suites/safety/**` (all in the student-safety group) → **safety-reviewer required**; typescript-reviewer and silent-failure-hunter recommended (new ports, retries, background errors). No `packages/contracts/**` change, no ADR.

## Acceptance evidence

| Item | Evidence |
|---|---|
| 100% of distress cases escalate (classifier scripted `false`) | `distressEscalate.test.ts`: **35/35 escalated** (33 planned + 2 added by 4.0d) |
| 100% escalate with the classifier down | **35/35** with it throwing, **35/35** with it never answering (250 ms deadline) |
| No help from the classifier | every escalating turn had **0 classifier calls**: a hard keyword decided it |
| Near-miss score (≥ 99% required) | **6/6 not escalated (100.0%)** in all 3 modes; no near-miss has a hard keyword |
| The turn is still saved | every turn of every case: exactly 1 `CommitRecord` (escalated, replied or blocked) |
| Escalation move | trace `intent: distress`, `move: redirect`; 1 alert raised; reply = `buildCaringReply(locale)` |
| Reply checks from the YAML | `must_escalate`, `matches` (14416 on `in/` cases) and `must_not_contain` all pass |
| Alert delivered < 5 min (integration, real Redis) | real distress turn → `queuedAlertSink` → alert worker: **delivered to the trust team after 61.5 s, 7 attempts** (notifier failed 6 times; production backoff 1, 2, 4, 8, 16, 30 s) |
| 15-minute escalation (integration, 300 ms interval) | not acked: on-call paged every interval (≥ 2 pages), ack stops it (0 pending checks after); acked first: never paged |
| At most one pending check | after delivery: exactly `alert_e2e.escalate.0` pending; a replayed raise adds nothing |
| No excerpt in logs | worker log lines and notifier lines contain no excerpt (canary checked in unit and int tests) |

Commands and trimmed output:

`corepack pnpm turbo run typecheck lint test --filter=...@edmate/harness --filter=@edmate/worker... --filter=@edmate/evals... --force` (compose Redis and Postgres up)

```
Tasks:    40 successful, 40 total
@edmate/harness:test:  Tests 2824 passed   All files 99.36/98.33/98.65/99.63, src/guardrails 100/100/100/100
@edmate/queue:test:    Tests 33 passed     All files 100/100/100/100
@edmate/evals:test:    Tests 310 passed    All files 100/98.41/100/100
  distress, classifier false: 35/35 escalated; near-miss 6/6 not escalated (100.0%)
  distress, classifier throws: 35/35 escalated; near-miss 6/6 not escalated (100.0%)
  distress, classifier never answers: 35/35 escalated; near-miss 6/6 not escalated (100.0%)
@edmate/worker:test:   Tests 124 passed    All files 99.02/98.84/96.34/99.31 (commit and alert int suites ran, none skipped)
  alert delivered to the trust team after 61599 ms (7 attempts)
```

`vitest run test/alert.int.test.ts --reporter=verbose` (apps/worker):

```
✓ a distress turn → the trust team is told in < 5 min although delivery fails 6 times; the turn is saved 61549ms
✓ a replayed raise adds nothing: still one pending check, no second trust-team message 512ms
✓ not acknowledged → on-call is paged every interval; acknowledging stops it 2015ms
✓ acknowledged before the first check → on-call is never paged 957ms
✓ no log line carries the excerpt 1ms
```

`python3 .githooks/secret-scan.py --all` → exit 0, no output.

Keyword tables (`distressKeywords.test.ts`, 113 tests): all 35 seeded lines hard with `lang: 'en'` and `'hi'`; 23 held-out paraphrases (never used to tune the tables) hard; 22 negatives (`kill -9`, `skill`, `diet`, `die roll`, `loop khatam`, `laptop hangs`, `cut the string`, idioms) and the 6 near-misses and 2 mid-task first turns never hard; the near-misses and mid-task first turns have no keyword at all.

## Changes

- **Harness** (`packages/harness`):
  - `guardrails/distressKeywords.ts`: the single keyword source. Normaliser (NFKC, strip `\p{Cf}`, nukta and chandrabindu, casefold, apostrophes, leetspeak inside words, spaced or dotted letters, repeated letters squashed two ways). Hard and soft phrase tables for English, romanised Hindi and Devanagari with letter-aware boundaries. All run whatever `lang` is. `hasDistressKeyword` (hard only) is the `PipelineDeps.distressCheck` implementation.
  - `guardrails/distressDetect.ts`: the `pre` guard. Hard → escalate (no model call). Otherwise a small-tier classifier on JSON data (the message plus up to 3 earlier student messages). Soft plus a classifier throw, timeout or bad output → escalate; none plus a failure → rethrow (fails closed). The alert has `kind: abuse` when only abuse phrases hit, and an excerpt of at most 160 code points of the scrubbed text.
  - `guardrails/preGuardCtx.ts`: the shared `pre`-phase ctx (4.4 extends it).
  - `pipeline/steps/preGuard.ts`: registry with distressDetect, 300 ms guard slice, earlier student messages read with a 50 ms limit (a miss is reported through `env.report`), `ok`/`escalate`/`block` mapped, `failed` throws `PreGuardChainFailedError` (no text). Uses the turn gateway `env.gateway`.
  - `pipeline/steps/escalate.ts`: `buildCaringReply(locale)` = `LAST_RESORT_DISTRESS_REPLY` plus "You can also call X on N". Ignores the alert.
  - `testing/distressLocaleFixtures.ts`: `indiaLocalePackWithHelplines` (Tele-MANAS 14416). Exports and README updated.
  - `runner.test.ts`: four new end-to-end cases (hard keyword; chain fails and the keyword check still escalates; soft + classifier false replies; no keyword + classifier down blocks). The stub test drops preGuard and escalate.
- **Queue** (`packages/queue`): `ALERT_QUEUE`, `JOB.alertRaise`/`alertEscalateCheck`, round-numbered job ids, `alertJobOptions` (1,000,000 attempts, custom `alert-capped` backoff, completed kept 24 h), `alertBackoffMs`, payload schemas, `ALERT_ESCALATION_MS` = 15 min. `queuedAlertSink` enqueues the escalation check first, then the raise. `TurnQueues.alert` and `QueuedTurnPorts.alerts`.
- **Worker** (`apps/worker/src/alerts/`): types (`AlertNotifier`, `AckStore`), `logAlertNotifier` (ids, kind, level, audience, time; never the excerpt), `redisAckStore` (30-day key, id validated), `alertProcessor` (raise → trust team; check → if not acked, schedule the next round, then page on-call), `createAlertWorker` (capped backoff strategy, `maxStalledCount` 1000, dead-letter on malformed payloads only). Wired in `src/index.ts`. `permanentToUnrecoverable` is now generic; dead-letter refs keep an alert's ids. `test/alert.int.test.ts` (Redis only).
- **Evals**: `must_escalate` in `CheckSchema`; `EvalAgentReply.escalated`; `checkMustEscalate` in the generic runner (fails when the agent does not report it). `must_escalate: true` on the 35 distress turns, `false` on the 6 near-misses and the 2 mid-task first turns; the retract-joke case's turn 2 is left for 4.3b. `src/distressEscalate.test.ts`.

## Deviations

- **35 distress cases, not 33.** 4.0d added `safety-distress-khudkushi-in-hi-latin` and `safety-distress-companion-only-in-hi-latin`; both are hard hits and are in every run.
- **Three classifier modes, not two.** "Throws" and "never answers" each run separately, so both timeout and error are covered.
- **`distressCheck` is the hard list only**, not hard + soft as the plan's first draft had it. 4.2's runner ORs the raw-text check into the escalate decision, so soft phrases there would bypass the classifier. Soft + classifier timeout is handled inside the guard with its own 250 ms deadline instead (see Decisions).
- **preGuard uses `env.gateway`** (3.7's turn gateway, billed to the entitlement), not `deps.gateway`, which no longer exists.
- **Generate step not touched.** A blocked turn (classifier outage, no keyword) has no reply text, which the near-miss checks accept.

## Decisions

### 19 Oct 2026 · 4.3 Distress keyword tables: all languages, normalised, hard and soft · decided by lead (safety plan review) and tdd-guide (phrases) · risk: high
Decided: built-in English, romanised-Hindi and Devanagari phrase tables run on every message whatever `lang` says, after normalisation; hard phrases escalate alone, soft ones ask the classifier, two different soft phrases count as hard; obfuscated spellings are never in the tables.
Why: students mix scripts, and hidden characters or spelling tricks must not dodge the check.
Alternatives: per-language tables chosen by `lang`; locale-pack keyword data (needs a contracts change).
Reversible: Yes, but only with safety-reviewer sign-off.

### 19 Oct 2026 · 4.3 `distressCheck` is the hard list; soft + classifier failure escalates inside the guard · decided by tdd-guide (after the lead's 4.2 coordination note) · risk: high
Decided: `PipelineDeps.distressCheck` = `hasDistressKeyword` (hard phrases only); distressDetect gives its classifier 250 ms inside a 300 ms guard slice and escalates a soft hit on throw, timeout or bad output; if the whole step runs out of time first, only hard phrases still escalate (the turn is blocked).
Why: 4.2 ORs the raw-text check into step 5, so a soft phrase there would escalate without the classifier.
Alternatives: hard + soft in `distressCheck`; a second seam for soft phrases.
Reversible: Yes, but only with safety-reviewer sign-off.

### 19 Oct 2026 · 4.3 No keyword and the classifier fails: the turn is blocked · decided by lead (4.1 safety review: never invent ok) · risk: high
Decided: with no keyword, a classifier throw or timeout fails the chain, preGuard throws, and the turn ends `guard_blocked` (still saved, no reply); a classifier outage therefore blocks non-keyword turns.
Why: without a verdict the guard cannot say the message is safe.
Alternatives: pass the turn when no keyword hit (fail open on the classifier).
Reversible: Yes, but only with safety-reviewer sign-off.

### 19 Oct 2026 · 4.3 Alerts are never lost: check first, unlimited capped retries, repage until acked · decided by lead (safety plan review) and tdd-guide (BullMQ details) · risk: high
Decided: `queuedAlertSink` enqueues the 15-minute check before the raise; alert jobs get 1,000,000 attempts with backoff doubling from 1 s to a 30 s cap and survive 1,000 stalls; every unacknowledged check schedules the next round first, then pages on-call, forever until acknowledged; round ids keep one pending check per alert, and completed jobs are kept 24 h so a replayed raise adds nothing.
Why: a distress alert must reach a person even if Redis, the worker or the notifier fails for a while.
Alternatives: BullMQ's 5-attempt default; uncapped exponential backoff; a single 15-minute check.
Reversible: Yes, but only with safety-reviewer sign-off.

### 19 Oct 2026 · 4.3 Delivery and acknowledgement stand-ins · decided by lead (plan Q4, Q5) · risk: medium
Decided: notifications are a structured log line (ids, kind, level, audience, time; never the excerpt) until a vendor is chosen, the same gap as the cost alarm; acknowledgements are a real 30-day Redis key, but nothing calls `acknowledge` yet, so every alert pages on-call every 15 minutes until a trust-console task lands.
Why: delivery needs a vendor decision; an unreachable ack is the safe default.
Alternatives: wire a mail vendor now; stub the ack store as always-acked.
Reversible: Yes.

### 19 Oct 2026 · 4.3 The caring reply is the built-in template plus the pack's helplines · decided by lead (safety plan review) · risk: medium
Decided: escalate always replies `LAST_RESORT_DISTRESS_REPLY` plus "You can also call <name> on <number>" for each pack helpline, in English, and never uses the alert; with no helpline, the template's generic wording stands.
Why: it says it is an AI, promises nothing and points to someone the student trusts; no ids or alert wording can leak.
Alternatives: a model-written reply; per-language templates (pilot is English only).
Reversible: Yes.

### 19 Oct 2026 · 4.3 The classifier sees the last 3 student messages · decided by lead (safety plan review) and tdd-guide (limits) · risk: medium
Decided: preGuard reads up to 12 history messages (50 ms limit), keeps the last 3 student ones and passes them with the message as JSON data; a failed, slow or malformed read gives none and is reported on `finished.background` with a cause only.
Why: indirect distress often builds over turns; the read must not eat the guard's budget.
Alternatives: no history; reuse buildContext's history (it runs concurrently, not before).
Reversible: Yes.

### 19 Oct 2026 · 4.3 Abuse-only hits raise `kind: abuse` · decided by tdd-guide · risk: medium
Decided: when every hard hit is an abuse phrase (for example, being hit or touched by a relative), the alert's kind is `abuse`; otherwise `distress`.
Why: the trust team needs to know which kind of help is needed.
Alternatives: always `distress`.
Reversible: Yes.

### 19 Oct 2026 · 4.3 The classifier call is unmetered · decided by lead (plan Q3) · risk: medium
Decided: distressDetect reports `usage: []`, because `ModelGateway.generateObject` has no usage channel; a follow-up should add one (it also affects 4.4 and route).
Why: no contracts change in this task.
Alternatives: estimate tokens; a contracts ADR now.
Reversible: Yes.

### 19 Oct 2026 · 4.3 `must_escalate` is checked, never passed silently · decided by lead (safety plan review) · risk: low
Decided: `must_escalate` is a check in packages/evals' own case format, and the agent reply gains `escalated`; the generic runner fails the check when the agent does not report it; `distressEscalate.test.ts` drives the real pipeline.
Why: a check the runner cannot see must not count as a pass.
Alternatives: a separate tag outside `expect`; skip it in the generic runner.
Reversible: Yes.

## Follow-ups (not in this PR)

- 4.3b (board): a session distress flag for the retract-joke check-in, and the scrub-failure distress reply using `fallbackReplies.distress` with the pack's helplines.
- A usage channel for `generateObject` (classifier cost).
- A trust console that calls `AckStore.acknowledge`; a real notifier vendor (shared with the cost alarm).
- 3.10: move the keyword tables and the India helpline into real locale packs.
