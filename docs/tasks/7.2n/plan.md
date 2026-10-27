# 7.2n plan: 7.2m review LOWs (one misuse-code list; critical escalation timing)

Written by the lead, 26 Oct 2026. Status: READY.

## 1. One list of misuse codes
- `packages/harness/src/guardrails/moderationIn.ts:46`: export `MISUSE_CODES` (keep the name and
  the `readonly ModerationCode[]` type; add a one-line doc comment saying these codes raise a
  level `critical` misuse alert). Check it reaches the package root through
  `packages/harness/src/guardrails/index.ts` (add the export there if that barrel lists names).
- `packages/evals/src/moderationJailbreak.test.ts:239`: delete the local copy and import
  `MISUSE_CODES` from `@edmate/harness` with the file's other harness imports.
- No behaviour change: the existing harness and evals tests are the check. If exporting it
  changes a public-API snapshot or an exports test, update that test.

## 2. Critical escalation timing: no change (lead decision)
`packages/queue/src/alertSink.ts` keeps one delay (`ALERT_ESCALATION_MS`, 15 minutes) for every
level. Self-harm distress alerts (level `alert`) are at least as urgent as a threat to others,
so a shorter delay only for `critical` would rank them the wrong way round, and the 15-minute
on-call check was set in 4.3. Add one comment line above `const after` in `queuedAlertSink`:
the delay is the same for every level on purpose (7.2n), and a per-level delay is a
safety-policy change for the human.
The builder copies this lead decision into the handoff's `## Decisions` unchanged, with
`decided by lead · risk: medium`.

## Files
- packages/harness/src/guardrails/moderationIn.ts (export + doc comment)
- packages/harness/src/guardrails/index.ts (only if needed)
- packages/evals/src/moderationJailbreak.test.ts (import instead of copy)
- packages/queue/src/alertSink.ts (comment only)
- docs/tasks/7.2n/handoff.md

Out of bounds: moderationPatterns.ts (7.2l), packages/contracts, every other guardrail file.

## Risky paths
`packages/harness/src/guardrails/**` → code-reviewer. The lead also runs typescript-reviewer.
The handoff logs a `risk: high` builder decision naming the guardrails path (export only, no
behaviour change).

## Gate
- `corepack pnpm turbo run typecheck lint test --filter=...@edmate/harness --filter=...@edmate/queue`
- `corepack pnpm exec prettier --check` on changed files; `python3 .githooks/secret-scan.py --all`.

## Budget
About 20 tool calls. Stop with `Status: PARTIAL` past 35.
