# 4.8 handoff: the `adviceGuard` post guard (regulated subjects)

- **Status:** DONE
- **Branch:** `m4/4.8-advice-guard` (the paused builder's WIP 4475cd4, then origin/main 4424923 merged with no conflicts)
- **Worktree:** `.claude/worktrees/build-4.8` (repo-relative; the original worktree was removed by the lead, so this one was added for the branch)
- **Risky paths:** `packages/harness/src/guardrails/**` and `packages/harness/src/pedagogy/**` (safety-reviewer, gate-required). Requested as well: security-reviewer, typescript-reviewer, silent-failure-hunter (the judge and rewrite calls, fail-closed paths, injection surface). `evals/suites/advice/**`: one new case, `reviewed_by: pending`. No `packages/contracts/**` and no `docs/adr/**` change.
- **What "pass" covers:** "seeded advice cases pass" means every case in `evals/suites/advice` passes its `must_not_contain` checks on what the student sees, both streamed and final, through the real pipeline with a non-circular fake judge. The `judge:` rubric lines need live models (rule 4), so they belong to the harness exit gate (plan Q1, read the same way as in 4.5, 4.6 and 4.7).

## Acceptance evidence

Infra: `docker compose -f docker/compose.yaml -f packages/db/test/compose.port.yaml -f apps/worker/test/compose.port.yaml up -d --wait postgres redis` (both healthy).

`EDMATE_ALLOW_PENDING=1 corepack pnpm turbo run typecheck lint test --filter=...@edmate/harness --force --concurrency=1`: see "Full run" below.

Without `EDMATE_ALLOW_PENDING`, `suites.test.ts` fails on exactly one line, `advice/advice-grounding-redirect-hi-latin.yaml: reviewed_by is still "pending"`. That is by design until the human signs the case (the 4.5/4.7 precedent).

The gate is `packages/evals/src/adviceFixtures.test.ts`: 42 tests, all pass.
- Cases: 33 (32 signed, plus 1 pending). 11 each for investing, law and health. Every unguarded bad reply fails its case's own checks.
- Demo agent (no regulated subject) and regulated agent (the case's own subject): every bad reply is caught, nothing streams, and the disclaimer for that agent is appended word for word. The redirect case ends in the redirect reply.
- The hard rule catches its 12 cases without making a judge call.
- Clean replies are left unchanged on the demo agent. On a regulated agent they get the disclaimer appended.
- Every case run as a redirect turn ends in the redirect reply.
- Mutations:
  - adviceGuard off: 33 of 33 fail.
  - Judge always says clean: exactly the 21 judge-only cases fail, which includes every Hindi case (on the demo agent and on a regulated agent).
  - Pre-filter always says "no signal": the same 21 fail, including every Hindi case.
  - Rules always say clean: 0 fail, because the fake judge reads every bad reply.
  - Rules and judge both off: 33 of 33 fail.
- Latency: `advice postGuard step (judges 450 ms, rewrite 300 ms, 66 turns): max 1200 ms of 2000 ms`.

Harness coverage: adviceGuard.ts, disclaimer.ts, grounding.ts and compose.ts are at 100%. postGuard.ts has 100% lines and 92% branches. The new `adviceJudge.test.ts` covers the fake judge's pass-through paths.

## Changes

- `packages/harness/src/guardrails/adviceGuard.ts` (new), in this order:
  1. Fixed texts pass as they are.
  2. English hard rule: directives, imperatives, promises, identity claims. Referral phrasing is exempt.
  3. Pre-filter: a decision request in the scrubbed student message, or a reply signal (romanised Hindi, non-Latin script, dose, role-play, domain words).
  4. Fail-closed judge on the scrubbed reply and the student message, in separate fenced blocks.
  5. One rewrite, re-checked by the rules. On failure, the fixed fallback with the disclaimer built in.
  6. A redirect turn gets the redirect reply.
  7. The disclaimer is appended after a blank line on a violation, or for a regulated agent plus a decision request.

  On the verification pass it runs rules only.
- `pedagogy/disclaimer.ts` (new) holds `resolveDisclaimer`, shared with `compose.ts`, which now uses it (snapshot-identical).
- `pipeline/steps/postGuard.ts`:
  - builds the advice judge and the advice rewrite, each in a bounded slice; the rewrite is skipped when fewer than 200 ms are left;
  - reads the generic disclaimer from the pinned prompt-pack set and the locale's redirect reply;
  - passes the verifying flag and adds the new fixed texts;
  - turns a verification-pass lockedLeak block into the locked reply;
  - reports `AdviceJudgeUnavailable`, code only.
- `pipeline/steps/generate.ts`: `holdsReply` holds every move of a regulated-subject agent, and any turn whose student message asks for a decision.
- grounding, lockedLeak, answerLeak and piiScrub: adviceGuard's fixed texts count as clean. Grounding ignores the disclaimer suffix.
- `testing/adviceJudge.ts` and its test: the non-circular `markerJudge`, plus a gateway wrapper. `testDeps` gains `adviceJudge` and `adviceJudgeDelayMs`.
- `evals/suites/advice/advice-grounding-redirect-hi-latin.yaml` (new, `reviewed_by: pending`).
- `packages/evals/src/adviceFixtures.test.ts` (new): the gate.

## Deviations

- The plan expected a mutation that turns the rules off to fail some cases. With the fake judge, no case is protected by the rules alone, so that mutation fails 0 cases. The gate asserts 0 explicitly and adds two more proofs of what the rules do: rules plus judge off fails all 33, and the rule-caught cases are caught with zero judge calls.
- The gate stubs grounding's judge to "grounded" and gives a well-covered chunk. That way grounding never turns the turn into ask_teacher, and the test measures adviceGuard alone.

## Decisions

### 19 Oct 2026 · 4.8 merged: adviceGuard post guard wired · decided by lead (plan revisions) · risk: high
Decided: `adviceGuard` runs on every agent. It uses English personal-directive and identity rules, a small-tier judge (fail closed) for ambiguous or non-English replies, one rule-checked rewrite, and a fixed fallback. The disclaimer is deterministic and word for word, from the locale pack or the frame's generic text, and is shared with the system prompt. Regulated-subject agents and decision requests are held, not streamed. Redirect replies are judged too. Reviewed by safety-reviewer (plus security-reviewer, typescript-reviewer and silent-failure-hunter, as requested).
Why: PRD regulated-subject rule and signed safety rule 5; lead answers 1–12 and the 4.7 safety review.
Alternatives: run only on regulated agents (rejected by the lead).
Reversible: yes.

### 19 Oct 2026 · 4.8 the redirect review case is added as pending · decided by lead (case), tdd-guide (fixture spec) · risk: medium
Decided: `advice-grounding-redirect-hi-latin` is in `evals/suites/advice` with `reviewed_by: pending`, so `suites.test.ts` fails on exactly that line until the human signs. It passes the offline gate, caught by the judge layer.
Why: the human signs eval cases (4.5/4.7 precedent).
Alternatives: keep it out of the suite (the 4.6 posture).
Reversible: yes.

### 19 Oct 2026 · 4.8 adviceGuard's time budget · decided by tdd-guide · risk: low
Decided: the judge timeout reuses grounding's 600 ms. The rewrite runs only when at least 200 ms of the slice is left. On a turn with no decision request, no signal and no hard hit, adviceGuard weighs as a rules-only guard, so the other guards keep their time.
Why: plan Q3 and lead answer 11; the four-call stacking test and the fixture latency run stay inside 2 s.
Alternatives: a fixed weight on every turn (takes time away from grounding on ordinary turns).
Reversible: yes.

### 19 Oct 2026 · 4.8 built-in English redirect reply · decided by tdd-guide · risk: low
Decided: when the locale gives no usable `redirect` text, adviceGuard uses a built-in English reply. It names no helpline or contact, and a locale failure is reported.
Why: the redirect fallback must always exist; English-only pilot.
Alternatives: the safe reply (doesn't steer back to the course).
Reversible: yes.
