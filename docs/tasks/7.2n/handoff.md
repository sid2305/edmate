# 7.2n handoff

Status: DONE

## Summary
- `packages/harness/src/guardrails/moderationIn.ts`: `MISUSE_CODES` is now exported (kept the
  name and `readonly ModerationCode[]` type), with a doc comment saying these codes always raise
  a level `critical` misuse alert.
- `packages/harness/src/guardrails/index.ts`: added `MISUSE_CODES` to the `moderationIn.js`
  re-export so it reaches the package root.
- `packages/evals/src/moderationJailbreak.test.ts`: removed the local `MISUSE_CODES` copy and
  imports it from `@edmate/harness` with the file's other harness imports; the usage now casts to
  `readonly string[]` for the `.includes(ev.code)` check.
- `packages/queue/src/alertSink.ts`: added a comment above `const after` in `queuedAlertSink`
  explaining the delay is the same for every level on purpose (7.2n), and a per-level delay is a
  safety-policy change for the human. No behaviour change.

No behaviour change anywhere; existing harness and evals tests are the check, and they pass.

## Decisions

### 26 Oct 2026 · 7.2n critical escalation timing: no change · decided by lead · risk: medium
- Decided: `packages/queue/src/alertSink.ts` keeps one delay (`ALERT_ESCALATION_MS`, 15 minutes)
  for every level.
- Why: self-harm distress alerts (level `alert`) are at least as urgent as a threat to others, so
  a shorter delay only for `critical` would rank them the wrong way round, and the 15-minute
  on-call check was set in 4.3. A per-level delay is a safety-policy change for the human.

### 26 Oct 2026 · 7.2n MISUSE_CODES export · decided by builder · risk: high
- Decided: exported `MISUSE_CODES` from `packages/harness/src/guardrails/moderationIn.ts` (also
  re-exported from `packages/harness/src/guardrails/index.ts`), touching the risky
  `packages/harness/src/guardrails/**` path.
- Why: this is an export-only change (no behaviour change) so one eval file can import the one
  list instead of keeping a second copy in sync by hand; the existing harness and evals tests are
  the check, and they pass unchanged.

### 26 Oct 2026 · 7.2n budget and review LOW · decided by lead · risk: low
- Decided: Accept 40 tool calls against a budget of 20. The review LOW (Object.freeze on the exported MISUSE_CODES) is deferred to 7.2l, the guardrails follow-up task.
- Why: Most of the overrun was the turbo test run across harness's dependents. Mutating the array needs a deliberate cast, so freezing it is hardening, not a fix.

### 26 Oct 2026 · 7.2n merge · decided by lead · risk: high
- Decided: Merge 7.2n, which touches packages/harness/src/guardrails/moderationIn.ts and guardrails/index.ts. code-reviewer approved it.
- Why: It exports an existing list with no change to the guard's behaviour. The evals test now uses the same list, and the alertSink change is a comment.

## Gate
- `corepack pnpm turbo run typecheck lint test --filter=...@edmate/harness --filter=...@edmate/queue`
  → 38 successful, 38 total (exit code 0).
- `corepack pnpm exec prettier --check` on the four changed files → "All matched files use
  Prettier code style!"
- `python3 .githooks/secret-scan.py --all` → clean (no output, exit 0).

## Budget
Tool calls used: 40 (harness count; the builder reported 27, and 30 in its return)
