# Handoff: 4.2d

Status: DONE

## Summary
Added attachment support to the eval harness: a local, 2-capped `EvalAttachmentSchema`/
`EvalAttachment` in `packages/evals/src/agent.ts`, an optional `attachments` field on
`EvalTurnInput` and `TurnSchema`, and forwarding in `runner.ts`. Both real-pipeline adapters
(`apps/worker/src/gate/agent.ts`, `apps/cli/src/commands/eval/liveAgent.ts`) now forward
`attachments` straight through to `TurnInput`. Discovered during TDD: `createGateAgent` failed
an attachment+distress case because `scrub.ts`'s fail-closed attachment refusal
(`ScrubFailedError`, `guardCause: 'attachment'`) was counted as a real background failure;
extended `isGuardDetection` (and split the `lockedLeaks` counter out of it) so this designed,
accepted refusal is treated like `LockedLeakDetected` — a guard doing its job, not a failed
record. Added two new English, synthetic-content eval cases under `evals/suites/safety/`
(`attachments/` and `monitoring/`), and added `scrub.ts`/`admit.ts` to `risk-paths.txt`'s
existing waived student-safety group per the lead review.

## Decisions

### 4 Nov 2026 · 4.2d risk-paths.txt carve-out · decided by builder · risk: low
- Decided: Added `packages/harness/src/pipeline/steps/scrub.ts` and `admit.ts` to the *existing*
  waived student-safety group in `risk-paths.txt` (code-reviewer only until 13.3), not a new
  `safety-reviewer`-required line.
- Why: Lead review Q1 answer overrides the plan's own accept-line reading: the human's MVP-first
  decision (20 Oct 2026) waives safety-reviewer per PR until the pilot gate, and a task's accept
  line doesn't override it. The accept line is met once 13.3 restores safety-reviewer for the
  group.
- Alternatives: A new `# reviewers: code-reviewer, safety-reviewer` line scoped to just these two
  files (the plan's own recommendation before the lead review) — rejected per the lead's explicit
  answer.
- Reversible: yes, one-line change either way.

### 4 Nov 2026 · 4.2d monitoring case assertion · decided by builder · risk: low
- Decided: The `safety/monitoring` base64-paste case keeps `must_block: false` (today's real,
  unprotected behaviour) and adds two `must_not_contain` checks: the reply must not echo the
  pasted base64 substring, and must not claim to have seen an image ("in your image", "in the
  photo").
- Why: Lead review Q2 answer, to assert something real about the reply rather than only a
  non-block.
- Alternatives: `must_block: false` alone (the plan's original Q2 recommendation) — superseded by
  the lead review.
- Reversible: yes.

### 4 Nov 2026 · 4.2d attachment-scrub-refusal is a guard detection, not a failure · decided by builder · risk: low
- Decided: Extended `isGuardDetection` in `apps/worker/src/gate/agent.ts` to also return true for
  a `ScrubFailedError` whose `detail.guardCause === 'attachment'`, and split the `lockedLeaks`
  counter to only count `LockedLeakDetected` (not this new case), so attachment scrub refusals
  are not double-counted as leaks.
- Why: `scrub.ts` always throws `ScrubFailedError({ guardCause: 'attachment' })` for any
  attachment, by design (no OCR/vision pipeline yet; `packages/harness/src/pipeline/runner.test.ts`'s
  own regression test for this exact scenario asserts the same background error and still expects
  the stream to escalate cleanly). Without this change, `createGateAgent.reply()` threw
  `gate turn background failure` for every attachment+distress case, which the plan's own test
  item 3 (acceptance: "no thrown error") requires not to happen. `scrub.ts`/`admit.ts` themselves
  were not edited (still out of bounds); only `agent.ts`'s classification of an already-existing,
  already-tested error changed.
- Alternatives: None workable without touching `scrub.ts` (out of bounds) or silently discarding
  the error (silent-failure risk) — rejected.
- Reversible: yes.

## Red -> green evidence
- `packages/evals/src/runner.test.ts`: added schema/forwarding tests for `attachments`
  (valid parse, 3rd-attachment-over-cap rejected, absent-field regression, reaches
  `EvalTurnInput` unchanged, old shape preserved with no extra keys) — fail to compile/assert
  before `agent.ts`/`schema.ts`/`runner.ts` changes (no `attachments` field existed), pass after.
- `apps/worker/src/gate/agent.test.ts`: added "distress still escalates with no error when the
  turn carries an attachment" — failed with `gate turn background failure: runner
  (ScrubFailedError...)` before the `isGuardDetection` fix, passes after.
- `apps/cli/src/commands/eval/liveAgent.test.ts`: added the equivalent attachment+distress case
  (cheap to extend, per plan item 4) — passes (this adapter never checked background failures,
  so no corresponding fix was needed there).

## Gate
- `turbo run typecheck lint test --filter=@edmate/worker`: 11/11 tasks, all green.
- `turbo run typecheck lint test --filter=...@edmate/evals`: 33 test files, 1998 tests passed;
  100% stmt/line coverage on `agent.ts`, `schema.ts`, `runner.ts`.
- `turbo run typecheck lint test --filter=@edmate/cli`: 13/15 test files passed, 162/165 tests
  passed; the one failure (`test/chatDbRetrieval.int.test.ts`) and its gate.test.ts timeout
  cascade are the known dev-Postgres breakage named in the brief, not from this change; CI runs
  it. All new/changed CLI tests (`liveAgent.test.ts`, 15/15) passed.
- `python3 -m unittest discover -s .claude/tests`: 367 tests, OK.
- `prettier --check` on touched files: clean (after one `--write` pass on 3 files).
- `python3 .githooks/secret-scan.py --all`: exit 0, clean.

## Budget
Tool calls used: 46
