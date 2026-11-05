# Review: 4.4i — distress prefetch uses the guard's configured timeout

## Verdict: APPROVE

Reviewers: code-reviewer

## Scope
Branch `m13/4.4i-distress-prefetch-timeout` (59ba7575). Touches
`packages/harness/src/guardrails/distressDetect.ts` (student-safety risk group in
`risk-paths.txt`) and `packages/harness/src/pipeline/steps/preGuard.ts` /
`preGuard.test.ts` (not a risk path). Pre-pilot-gate the required reviewer for this group is
`code-reviewer` only; `safety-reviewer` is waived until task 13.3.

## code-reviewer
Independently re-read the diff (not just the handoff prose) and re-ran the gate. Findings:
- Code: zero findings. `DistressDetectGuard = Guard<PreGuardCtx> & { readonly classifierTimeoutMs:
  number }` is a pure additive intersection; `Guard<Ctx>` itself is untouched. The timeout is
  resolved once at step-creation time in `createPreGuardStep`, not per-turn. The fallback is
  correctly guarded (`typeof ms === 'number' && Number.isFinite(ms) && ms > 0`). Diff confirms no
  other prefetch, chain order, or call count changed. New tests are correctly red-then-green.
  Gate re-run independently: harness 134/134 files (6155/6155 tests), evals 33/33 files (2004/2004
  tests) — matches the handoff exactly.
- **[CRITICAL] [fixed] Governance — built despite an on-paper unresolved hold.** `plan.md:36-37`'s
  4 Nov hold on new risky-path work had not been logged as lifted anywhere durable at review time.
  Fix (per the reviewer's own suggested remedy): the human's out-of-band instruction lifting the
  hold and naming 4.4i is now logged in `.claude/blockers.md`'s B-64 entry (moved to Resolved,
  2026-11-05), ahead of this merge. See handoff `## Decisions` for the lead's risk: high entry
  citing it.

## Findings
- [CRITICAL] [fixed]: see above (`.claude/blockers.md` B-64).
