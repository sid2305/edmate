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

### Fix round 1

Branch `fix-4.8-r1` from `origin/m4/4.8-advice-guard`, pushed to `m4/4.8-advice-guard`. It fixes every [open] finding in `review.md` (safety issues 1–6, the silent-failure HIGH and the grounding mutation). Issue 7 is deferred to 4.8b.

- Same infra, then `corepack pnpm turbo run typecheck lint test --filter=...@edmate/harness --force --concurrency=1`:
  - harness: 78 files, 3602 tests pass. Coverage 99.46% lines; adviceGuard.ts and disclaimer.ts are at 100%.
  - evals: 391 pass, 1 fails. The failure is `suites.test.ts`, listing exactly the 5 pending advice cases (the 4.7 one plus the 4 new ones). That is allowed until the human signs them.
- `adviceFixtures.test.ts`: 46 tests, all pass.
  - 37 cases (32 signed, 5 pending), 13/12/12.
  - The 4 new cases are checked streamed and final on both agents. The sign-it case also checks each of its two bad sentences alone.
  - Mutations:
    - guard off: 37 of 37 fail;
    - judge always clean / no signal: exactly the 23 judge-only cases fail;
    - rules off: exactly the rule-only cases fail;
    - rules and judge off: 37 of 37 fail.
  - Latency: `advice postGuard step (judges 450 ms, rewrite 300 ms, 74 turns): max 1200 ms of 2000 ms`.
- `groundingFixtures.test.ts`: the "judge always grounded" mutation fails 25 again, including `grounding-fileio-hi-latin`.
  - The cause was the fake `markerJudge`, not 4.8: it flagged the bare "karo" in that case's bad reply ("use karo") as advice. adviceGuard then replaced the reply, so the case passed.
  - `karo` is now flagged only after a legal or money verb ("sue karo", "invest karo"), or as "daal ke bhool jao".
- Changes:
  - `adviceGuard.ts`:
    - a regulated agent judges every non-fixed reply;
    - weak signals on all agents: a sentence-start imperative, a number, or a proper-noun product;
    - a regulated topic in the student message (money, health, law, in English, romanised Hindi or Devanagari) sends the reply to the judge;
    - the imperative window includes the verb, so "sign it" and "file a case" match;
    - a rewrite with a dose, a promise or a named product is rejected;
    - wider identity, promise, Hinglish and request patterns, with light leetspeak folding.
  - `generate.ts`: redirect moves and regulated-topic turns are held.
  - `postGuard.ts`:
    - reports `DisclaimerLocaleGap` (the subject code only);
    - each guard's slice is weighed on the text current at that point, and earlier guards reserve adviceGuard's judge time only for strong signals.
  - `chain.ts`: a slice request carries `text`.
  - `disclaimer.ts`: `disclaimerGap`.
  - 4 new `evals/suites/advice` cases, all `reviewed_by: pending`.

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

### 20 Oct 2026 · 4.8 fix round 1: wider judge coverage · decided by lead (brief), tdd-guide (patterns) · risk: high
Decided:
- A regulated-subject agent sends every reply that isn't a fixed text to the judge.
- On every agent, a sentence-start imperative, a bare number or a proper-noun product is a weak signal that also sends the reply to the judge.
- A money, health or law topic in the student message holds the stream and sends the reply to the judge. It does not add the disclaimer to a clean reply on its own; only a decision request does.
- Every redirect move is held.
- A rewrite with a dose, a promise or a named product is rejected.
Why: safety-review issues 1–6. The stream must not show advice that the judge would have caught later.
Alternatives:
- Judge only on signals (the round-0 design; it missed bare directives).
- Add the disclaimer on every regulated-topic turn (too noisy for clean answers).
Reversible: yes.

### 20 Oct 2026 · 4.8 fix round 1: per-text slice weights · decided by tdd-guide · risk: low
Decided: postGuard weighs each guard's time slice on the text current at that guard. Earlier guards reserve adviceGuard's judge time only for strong signals (non-English, modal, dose, promise, role-play, domain words) or a regulated agent or topic. Weak signals alone don't reserve it.
Why: numbers are common in ordinary replies. Reserving judge time for them shrank other guards' rewrite slices below their floor. The latency run stays at 1200 ms of 2000 ms.
Alternatives: a fixed reservation on every turn.
Reversible: yes.

### 20 Oct 2026 · 4.8 fix round 1: disclaimer locale-gap metric and narrower fake judge · decided by tdd-guide · risk: low
Decided:
- When a regulated agent's locale pack has no disclaimer for its subject, postGuard reports `DisclaimerLocaleGap` with the subject code only (no text, no PII) and keeps using the generic disclaimer.
- The test-only `markerJudge` no longer flags a bare "karo". It flags only a legal or money verb plus "karo", or "daal ke bhool jao".
Why:
- The silent-failure HIGH.
- The broad "karo" marker made a grounding case pass for the wrong reason (`grounding-fileio-hi-latin`).
Alternatives:
- Fail the turn on a gap (too harsh: the generic disclaimer is safe).
- Change the grounding count (hides the cause).
Reversible: yes.

## Sync with main after 4.3 (CI)

Branch `fix-4.8-sync` from `origin/m4/4.8-advice-guard`, merging `origin/main` (now carrying 4.3 distress detection and 3.10 locale packs).

- `git merge origin/main` applied with no conflicts (14 commits, clean three-way merge); no TS2300 duplicate exports and no locale fixture shape mismatch turned up in `packages/harness` or `packages/content`.
- The lead has since signed all 5 previously-pending advice cases (`reviewed_by: lead`), so `packages/evals/src/adviceFixtures.test.ts` no longer matches CI. Updated its title and body to expect all 37 cases signed, none pending, and dropped the now-stale list of pending case ids. No case YAML changed.
- Gate: `corepack pnpm turbo run typecheck lint test --filter=...@edmate/harness --filter=@edmate/evals --force --concurrency=1` with postgres+redis up via `docker compose -f docker/compose.yaml up -d postgres redis`: 34/34 tasks successful, 0 cached (forced).
- `adviceFixtures.test.ts` alone: 46 tests pass.
- `python3 .githooks/secret-scan.py --all`: clean.
