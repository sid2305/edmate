# Task 4.3b handoff

## Phase A

### Summary
Scrub-failure distress reply (item 2 of the plan) now carries the pack's helplines. The
raw-text-keyword-hit branch of `runner.ts`'s scrub-failure path (`run()`, right after
`scrubFailure` is reported) called `sendEscalation` with the bare `LAST_RESORT_DISTRESS_REPLY`.
It now calls a new private `distressFallback(input, e)` helper — the same two-step fallback
`escalate()` already used (`deps.fallbackReplies.distress(input.lang, e.locale)`, caught and
falling back to `LAST_RESORT_DISTRESS_REPLY` on throw/empty) — and `escalate()` itself was
refactored to call the same helper, so the logic lives in one place. The reply is never empty and
never throws. No new public type; no `packages/contracts` edit; no guard file touched.

### Decisions

### 4 Nov 2026 · 4.3b scrub-failure fallback shares escalate()'s helper · decided by builder · risk: low
- Decided: extracted `distressFallback(input, e)` as a private `Runner` method, used by both the
  scrub-failure branch and `escalate()`, instead of duplicating the try/catch-and-last-resort
  logic inline in the scrub-failure branch.
- Why: the plan's own wording calls for "the same two-step fallback `escalate()` already uses";
  a shared private helper keeps that behavior in one place instead of two copies that could drift.
- Alternatives: duplicate the inline try/catch in the scrub-failure branch (plan's literal
  wording, more diff-local but duplicates logic).
- Reversible: yes — inlining it back out is a small, local change.

### Red -> green evidence
- Red: `runner.test.ts` "the raw-text distress check still runs and escalates even with an
  attachment present (regression)" failed after the `runner.ts` change (expected the old bare
  `LAST_RESORT_DISTRESS_REPLY`, received `TEST_DISTRESS_REPLY` from the default test
  `fallbackReplies.distress`) — confirms the code path changed. Updated that assertion to the new,
  intended behavior (this is a real behavior change the plan calls for, not a cheat).
- New: `runner.test.ts` "the locale pack helplines reach the reply via fallbackReplies.distress
  (4.3b)" — a scrub-failure + raw keyword hit with a locale-style helpline string in
  `fallbackReplies.distress` asserts the reply is that string.
- New: `runner.test.ts` "a throwing/empty fallbackReplies.distress still falls back to the
  last-resort reply, never empty (4.3b)" — a throwing `fallbackReplies.distress` still yields
  `LAST_RESORT_DISTRESS_REPLY` and reports the thrown error on `background`.
- `policies.test.ts`'s existing `it.each` "scrub throws/times out + a hit on the raw text" also
  exercised this branch (via default `testDeps()`); updated its expected text from
  `LAST_RESORT_DISTRESS_REPLY` to `TEST_DISTRESS_REPLY` (same real behavior change) and renamed
  its title. Added a sibling test for the throwing-fallback case in this same scrub-failure
  context (not covered by the `runner.test.ts` attachment variant).

### Gate
- `vitest run src/pipeline/policies.test.ts src/pipeline/runner.test.ts`: 136 passed.
- `corepack pnpm turbo run typecheck lint test --filter=...@edmate/harness`: 28 typecheck/lint
  tasks successful; harness test suite included in the run passed with coverage thresholds held
  (no `guardrails/**` regression — this task touches no guard file). `@edmate/cli`'s
  `chatDbRetrieval.int.test.ts` failed on the local broken dev Postgres, as the brief said to
  expect and ignore (CI runs it).
- `prettier --check` on the three touched files: clean after `--write`.
- `python3 .githooks/secret-scan.py --all`: clean, no output.

### Budget
Tool calls used: ~32 (cap was 40 for this phase).

Left to do: Phase B (session distress flag + gentle check-in), per the plan.
