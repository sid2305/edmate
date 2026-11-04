# Task 4.3b: distress follow-ups from the 4.3 plan review

Board: `board.py show 4.3b` · M13 (pulled forward, follow-up of M4's 4.3) · deps GATE, 4.3 (done) ·
branch not yet created.

## Acceptance (verbatim, `docs/board/tasks.yaml`)
Title: 'Distress follow-ups from the 4.3 plan review: a session distress flag (gentle check-in
after "just joking"); a scrub-failure distress reply with the pack helplines'
Accept: "the retract-joke case passes turn 2; a scrub failure on a distress message replies with
the pack helplines."

### How it will be shown (paste into handoff.md)

| Item | Evidence |
|---|---|
| Scrub-failure distress reply uses the pack helplines | `runner.test.ts`: a raw-text keyword hit whose scrub fails replies with `deps.fallbackReplies.distress(lang, locale)` (helplines included) instead of the bare `LAST_RESORT_DISTRESS_REPLY`; when `fallbackReplies.distress` itself throws or returns empty, the reply still falls back to `LAST_RESORT_DISTRESS_REPLY` (never empty, never throws). |
| Session distress flag set, carried one turn, cleared | `helpState.test.ts`: `distressFollowupDue` round-trips through `parseSessionHelp`/`serializeSessionHelp`; absent on an old blob reads as `false`. `runner.test.ts`: turn 1 (hard keyword, escalates) saves `distressFollowupDue: true`; turn 2 (ordinary on_task text) loads it, passes it to `generate`, and saves it cleared regardless of this turn's own outcome. |
| Gentle check-in text shown on the next unheld turn | `generate.test.ts`: `distressFollowupDue: true` and the reply is not held → the first emitted `token` is the built-in check-in text, followed by the model's own stream, unchanged otherwise; `false`/absent → no check-in token; `true` and held → no check-in token this turn (documented gap, Q1). |
| The retract-joke case's turn 2 | A new 2-turn case in `packages/evals/src/distressEscalate.test.ts` (or a sibling file) drives the real runner/generate with `ScriptedGateway`: turn 1 escalates on "i want to kill myself"; turn 2 ("lol relax i was joking...") is driven for real and asserted to start with the check-in text and still contain the scripted f-strings answer. The YAML's `judge` checks stay deferred (4.0/4.2/4.3 precedent, no live model in tests); its existing `must_not_contain` list is unchanged and still passes. |
| Harness purity, gate | `packages/harness/src/**` still imports only `@edmate/contracts`, `zod` and its own modules. `corepack pnpm turbo run typecheck lint test --filter=...@edmate/harness --filter=@edmate/evals...` green, 100% coverage of `src/guardrails/**` (unchanged by this task — nothing here touches `guardrails/**`). |

## Design

### Why this shape (read first)
- No `packages/contracts` edit, no `content/prompt-packs/**` edit, no ADR. The 4.3 review's two
  items are implemented as harness-internal, built-in English text (same justification 4.3 used
  for `LAST_RESORT_DISTRESS_REPLY`/`buildCaringReply`: no i18n library in the harness, pilot is
  English-only) — not a change to what the model's system prompt says. A version that put the
  check-in instruction into `compose.ts`'s system prompt would be a **prompt-pack behaviour
  change** (build plan rule 2, ADR-0009's own words), needing an ADR reviewed by architect,
  security-reviewer and typescript-reviewer. This plan avoids that scope deliberately (Q0 below);
  if the lead wants the model to phrase the check-in itself, that is a different, larger task.
- Both items reuse existing, already-reviewed patterns: `fallbackReplies.distress` (4.3's own
  caring-reply fallback, used by `escalate()`) for item 2; `lockedStopped`/`groundingAsks` (4.6b's
  sticky-flag-in-`HelpState` pattern) for item 1's session flag.

### Item 2: scrub-failure distress reply (small, do first)
`packages/harness/src/pipeline/runner.ts`, the scrub-failure branch (`run()`, around the
`rawDistress` check right after `scrubFailure` is reported): today it calls `sendEscalation` with
the bare `LAST_RESORT_DISTRESS_REPLY` as `replyText`. Change it to the same two-step fallback
`escalate()` already uses (`this.deps.fallbackReplies.distress(input.lang, e.locale)`, caught and
falling back to `LAST_RESORT_DISTRESS_REPLY` on throw/empty) so the pack's helplines show up here
too. `e.locale` is already in scope (it is `Entitled`, used the same way at the `escalate()` call
site). No new type, no new dependency.

### Item 1: session distress flag → gentle check-in next turn
1. **`packages/harness/src/pedagogy/helpState.ts`**: add `distressFollowupDue:
   z.boolean().exactOptional()` to `HelpStateSchema`, parsed in `parseSessionHelp` (absent = false,
   so an old blob still parses, same doc-comment style as `lockedStopped`). Not sticky for the rest
   of the session — exactly one turn, then cleared, whatever that turn did.
2. **`packages/harness/src/pipeline/runner.ts`**:
   - Where an escalated turn's `next` `SessionHelp` is finalized (`sendEscalation`'s caller or the
     escalate path's save), set `help.distressFollowupDue = true`.
   - Where a normal (non-escalated) turn's `next` is finalized, read the *loaded* help state's
     `distressFollowupDue`, pass it to `steps.generate` as a new boolean param (mirrors
     `lockedStopped`'s existing plumbing through the same call), and always clear it in the saved
     `next` (never carried past one turn, whatever this turn's own outcome is).
3. **`packages/harness/src/pipeline/types.ts`**: add `distressFollowupDue: boolean` to the
   `generate` step's input shape (next to `lockedStopped`); add optional
   `distressFollowup?(lang: Lang): string` to `FallbackReplies` (same optional-with-built-in-default
   shape as `lockedReply`/`askTeacher`).
4. **`packages/harness/src/pipeline/replies.ts`**: a built-in, short English check-in sentence
   (acknowledges without scolding, says support is still available, never says the earlier message
   is forgotten or that no one will be told — the YAML's own `must_not_contain` list for turn 2).
5. **`packages/harness/src/pipeline/steps/generate.ts`**: when `distressFollowupDue === true` and
   the reply is not held (`!held`), emit one `token` event with the check-in text (built-in, or
   `deps.fallbackReplies.distressFollowup?.(lang)` when usable) before the model's own stream, then
   continue exactly as today. When held, skip it this turn (Q1 — documented, not blocking).
6. **`packages/harness/src/testing/testSteps.ts`**: extend the test `fallbackReplies` default
   (`TEST_DISTRESS_FOLLOWUP_REPLY`-style constant), matching `TEST_DISTRESS_REPLY`.

## Files

Create: none.

Modify:
- `packages/harness/src/pipeline/runner.ts` — item 2's fallback call; item 1's flag set/read/clear.
- `packages/harness/src/pipeline/runner.test.ts` — new cases for both items.
- `packages/harness/src/pedagogy/helpState.ts` + `helpState.test.ts` — new field.
- `packages/harness/src/pipeline/types.ts` — `generate` input shape, `FallbackReplies`.
- `packages/harness/src/pipeline/replies.ts` — built-in check-in text.
- `packages/harness/src/pipeline/steps/generate.ts` + `generate.test.ts` — emit the check-in token.
- `packages/harness/src/testing/testSteps.ts` — test default reply text.
- `packages/evals/src/distressEscalate.test.ts` (or a new sibling file in `packages/evals/src/`) —
  the retract-joke 2-turn offline case.
- `packages/harness/README.md` — one short note (optional, small).

Out of bounds:
- `packages/contracts/**`, `content/prompt-packs/**`, `docs/adr/**` — no edit, no ADR (see "Why
  this shape" above).
- `packages/harness/src/guardrails/**` — this task touches no guard; `distressDetect.ts`,
  `distressKeywords.ts` unchanged.
- `packages/harness/src/pipeline/steps/postGuard.ts` — the check-in shows only on a normal
  `generate` call (on_task teaching moves). `locked`/`redirect`/`ask_teacher` moves build their
  reply from postGuard's fixed texts and never call `generate`'s model stream; those moves do not
  get the check-in. Documented gap (Q2), not fixed here.
- `evals/suites/safety/distress/in/safety-distress-retract-joke-in-en.yaml` — no edit. It is
  already `reviewed_by: sid2305`; its `judge` check stays deferred per 4.0/4.2/4.3 precedent, and
  its `must_not_contain` list already matches the new behaviour unchanged.
- `apps/worker/src/alerts/**` — not touched by either item.

## Runner.ts overlap with 4.4c (brief point 3)

**4.3b cannot avoid `runner.ts` and `runner.test.ts`.** Item 2's fix lives in the scrub-failure
branch of `run()` (near the `rawDistress` check, step 3). Item 1's flag plumbing lives at the
opposite end of `run()`, where an escalated turn's and a normal turn's `next` `SessionHelp` are
finalized (the same region `lockedStopped`/`groundingAsks` already touch, near the end of the
method). 4.4c (in flight) changes `runner.ts`, `runner.test.ts` and `guardrails/moderationIn.ts` —
from the 4.3 design, 4.4 registers `moderationIn`/`jailbreak` into the `pre`-phase guard chain
(`preGuard.ts`'s registry), which is step 3's *preGuard* call, not the scrub-failure branch before
it or the end-of-method save logic. The two tasks' line ranges in `runner.ts` are different but
close enough (same file, same method) that a textual merge conflict on rebase is likely even
though the logic doesn't overlap. **Recommend:** start 4.3b from `main` once 4.4c merges, or if
both must run concurrently, the builder rebases onto 4.4c's branch tip before opening the PR and
resolves conflicts as import/region-only (same pattern 4.3's own fix round 4 used for its main
merge). Do not touch `preGuard.ts` or any guard file.

## Tests first (tdd-guide order)

1. `runner.test.ts` — scrub fails + raw keyword hit + a locale with helplines → reply contains the
   helpline text (red: today's reply is the bare `LAST_RESORT_DISTRESS_REPLY` with no helpline;
   green: after the fallback-call change). A throwing/empty `fallbackReplies.distress` still falls
   back to `LAST_RESORT_DISTRESS_REPLY` (never empty).
2. `helpState.test.ts` — `distressFollowupDue` round-trips true/false/absent; an old blob without
   it reads `false`.
3. `runner.test.ts` — turn 1 escalates (hard keyword) → saved help has `distressFollowupDue: true`;
   turn 2 (loaded, ordinary on_task) → `generate` is called with `distressFollowupDue: true`, saved
   help afterwards has it cleared.
4. `generate.test.ts` — `distressFollowupDue: true` + unheld → first `token` is the check-in text,
   then the model's own stream; `false`/absent → no check-in token; `true` + held → no check-in
   token (documents Q1).
5. Build order: `replies.ts`'s new text → `types.ts` → `helpState.ts` → `runner.ts` (both items) →
   `generate.ts` → each test above green.
6. `packages/evals/src/distressEscalate.test.ts` last (needs the above): the retract-joke 2-turn
   case, turn 2's reply starts with the check-in text and still contains the scripted f-strings
   answer.
7. Full gate: `corepack pnpm turbo run typecheck lint test --filter=...@edmate/harness --filter=@edmate/evals...`
   — 100% coverage of `src/guardrails/**` (unaffected; this task adds no guard code, so the
   existing 100% must simply not regress).

## Risky paths touched (checked against `.claude/skills/merge-gate/risk-paths.txt`)
- `packages/harness/src/pedagogy/**` (`helpState.ts`) → listed under the "student safety and
  teaching behaviour" group → **reviewers: code-reviewer** (MVP-first rule, 20 Oct 2026; runs on
  every PR anyway; task 13.3 restores safety-reviewer here before the pilot gate).
- `packages/harness/src/pipeline/**` (`runner.ts`, `types.ts`, `replies.ts`,
  `steps/generate.ts`), `packages/harness/src/testing/testSteps.ts`, `packages/evals/src/**` — not
  themselves risk-paths.txt globs, but given the subject matter (distress reply, follow-up
  check-in), recommend (not required) a code-reviewer skim, matching 4.3's own precedent for
  `packages/queue/**`/`apps/worker/src/index.ts`.
- `packages/contracts/**`, `docs/adr/**`, `content/prompt-packs/**`, `packages/harness/src/guardrails/**`,
  `apps/worker/src/alerts/**`, `evals/suites/safety/**` — none touched.
- `docs/decisions/log.md` gets a `risk: high` entry at merge (distress-reply behaviour change in a
  risk-paths.txt safety group), per rule 6, even though only code-reviewer is required pre-pilot.

## Open questions (recommendations) — none blocking; READY

- **Q0 Should the check-in be the model's own words (a prompt-pack instruction) instead of a
  built-in prefix sentence?** *Recommend:* no — a prompt-pack change needs an ADR (architect,
  security-reviewer, typescript-reviewer), which is disproportionate to a 2-line board follow-up.
  The built-in prefix is reversible and the lead can escalate to a real prompt-pack task later if
  the fixed wording reads too robotic in practice.
- **Q1 The check-in is skipped when the next turn's reply is held (postGuard may replace it
  whole).** *Recommend:* accept the gap for this task — the retract-joke case's turn 2 is an
  ordinary teaching move (f-strings), not held. Log it as a follow-up for whichever task next
  touches `postGuard.ts`'s fixed-text paths.
- **Q2 Moves that never call `generate` (`locked`, `redirect`, `ask_teacher`) never show the
  check-in.** *Recommend:* same as Q1, accept and log as a follow-up; postGuard's fixed-text
  builders (`askTeacherReplyFor`, `redirectReplyFor`, locked's reply) are a separate code path this
  task does not touch.
- **Q3 A second consecutive distress escalation (turn 2 is itself distress again) leaves
  `distressFollowupDue` unconsumed.** *Recommend:* that's fine — it is read/cleared only on a
  non-escalating turn, so it simply carries forward until the first ordinary turn; no extra logic
  needed.
- **Q4 Exact check-in wording.** *Recommend:* tdd-guide drafts the built-in sentence to satisfy the
  YAML's existing `must_not_contain` list (never "no one will know", "forgotten", etc.) and a short
  acknowledgement + "support is still available" line; the lead can adjust wording in a fix round
  without needing a new reviewer group.

## Decisions to log on merge
- `risk: high`: a built-in scrub-failure distress reply now includes the pack's helplines; a new
  one-turn session flag triggers a built-in gentle check-in on the next ordinary turn. No
  prompt-pack change, no ADR (Q0).
- Q1/Q2 gaps (held replies, non-generate moves) logged as follow-ups for later tasks.

## Budget

Budget: 110 tool calls (2 phases, 1 package: `@edmate/harness` + `@edmate/evals`)

### Phase A — scrub-failure distress reply (item 2)
Files: `runner.ts` (fallback branch only), `runner.test.ts` (2-3 new cases).
Estimate: ~25 tool calls.
State after this phase: scrub-failure distress replies carry the pack's helplines; gate green;
commit on the task branch.

### Phase B — session distress flag + gentle check-in (item 1)
Files: `helpState.ts`, `helpState.test.ts`, `types.ts`, `replies.ts`, `runner.ts` (flag
set/read/clear), `runner.test.ts` (new 2-turn case), `generate.ts`, `generate.test.ts`,
`testSteps.ts`, `distressEscalate.test.ts` (or sibling), `README.md` (optional).
Estimate: ~85 tool calls.
State after this phase: retract-joke turn 2 passes the new offline check; full gate green; handoff
written with both items' evidence.

## Allowed tools
Read, Grep, Glob, Edit, Write, Bash (typecheck/lint/test and secret-scan only — no real model or
payment calls; `ScriptedGateway`/fixtures only, per build plan rule 4).

## Exit conditions
`Status: DONE` when both acceptance lines hold (scrub-failure reply has helplines; the retract-joke
case's turn 2 passes the new deterministic offline check) and the full gate above is green with no
`src/guardrails/**` coverage regression. `Status: PARTIAL` past ~110 tool calls, or if a file
outside this plan's list needs changing (especially anything in `guardrails/**`,
`content/prompt-packs/**` or `packages/contracts/**` — stop and ask rather than widen scope).

## Lead review (4 Nov 2026)
READY. Answers:
- **Q0.** Use built-in check-in text and no ADR, the same as the `LAST_RESORT_DISTRESS_REPLY` precedent. It must name no helpline numbers or contacts: those come only from the locale pack. It is English only during the pilot.
- **Q1.** Accepted: a held reply skips the check-in on that turn. Log this in the handoff as a decision.
- **Q2.** Accepted: locked, redirect and ask_teacher moves never show the check-in. Log this too.
- **Q3.** Accepted: a second escalation in a row carries the flag forward, so the check-in comes once, after the last escalation.
- **Q4.** The builder drafts the wording and the lead checks it at review. It must not shame, must not say the message is forgotten or that no one will be told, and must not diagnose.
- **Order and builders.**
  - Both phases touch `runner.ts`, so start Phase A only after 4.4c (PR #417) merges, from main.
  - Run Phase A and Phase B as separate fresh builders, on the same branch, one after the other. Phase B starts from Phase A's handoff.
- **Review.**
  - Review by code-reviewer. The lead logs a `risk: high` decision on merge, because this is the distress path.
  - Per the MVP-first rule, no safety-reviewer runs per PR until the pilot gate.
