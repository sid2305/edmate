# Task 4.2d: Attachment follow-ups (4.2b safety review)

GATE dependency waived (lead, pulling 4.2d forward; pre-pilot gate is not a hard dependency).

## Acceptance (verbatim)
"a distress-with-attachment eval case runs end to end and escalates; the base64 monitoring case
runs; a change to scrub.ts requires safety-reviewer at the merge gate."

How shown: `turbo test --filter=@edmate/evals --filter=@edmate/harness` green, including the new
`evals/suites/safety/*` cases run via the eval runner (fixtures/replay, no live model call);
`git diff .claude/skills/merge-gate/risk-paths.txt` shows scrub.ts/admit.ts added under a line that
names `safety-reviewer`; `python3 .claude/skills/merge-gate/merge_gate.py 4.2d` passes.

## Contracts check (CLAUDE.md rule 2)
`EvalTurnInput` lives in `packages/evals/src/agent.ts` — **not** `packages/contracts`. It is
explicitly scoped smaller than the harness pipeline's own `TurnInput` (file comment: "a later task
adapts the real pipeline... without changing packages/evals"). The eval case schema
(`packages/evals/src/schema.ts`) is also evals-owned, not contracts. **No ADR needed; no contracts
file is touched.** Confirmed: `packages/contracts/src/turn.ts` already has `attachments` on
`TurnInput`/`Attachment` (shipped in 4.2b) and needs no change here.

Design that keeps attachments out of contracts and out of evals' contracts dependency: add a
**local** `EvalAttachmentSchema` in `packages/evals/src/agent.ts`/`schema.ts` with the same four
fields as contracts' `Attachment` (`kind: 'image'`, `mime`, `storageKey`, `bytes`), capped at 2 —
following the existing precedent of `EvalSkillSchema` ("a local copy, not the contracts
`SkillSchema`: evals owns its case format, and a case naming [something] the platform drops should
fail here, loudly"). The three real-pipeline adapters pass the eval attachment objects straight
through to `TurnInput.attachments` (same shape, no transform needed).

## Files to create/modify
- `packages/evals/src/agent.ts` — add `EvalAttachmentSchema`/`EvalAttachment` (local, 2-cap) and an
  optional `attachments?: EvalAttachment[]` field on `EvalTurnInput`.
- `packages/evals/src/schema.ts` — add optional `attachments` to `TurnSchema` (YAML-expressible),
  reusing `EvalAttachmentSchema`.
- `packages/evals/src/runner.ts` — pass `turn.attachments` through when building each
  `EvalTurnInput`.
- `packages/evals/src/agent.test.ts` / `runner.test.ts` (whichever already covers schema/runner) —
  unit coverage for the new field: present, absent, over-cap rejected.
- `apps/worker/src/gate/agent.ts` — in `createGateAgent`'s `runTurn(...)` call, forward
  `...(input.attachments === undefined ? {} : { attachments: input.attachments })`.
- `apps/cli/src/commands/eval/liveAgent.ts` — same forwarding at its `runTurn(turnInput, ...)` call
  site (~line 211-215).
- `evals/suites/safety/distress/` (or a new `evals/suites/safety/attachments/` subfolder) — one new
  case: raw-distress text + a synthetic attachment (reuse the shape of
  `packages/contracts/fixtures/valid/turn.ts`'s `demoAttachment`: `kind: image`, a `test/uploads/...`
  storageKey, a mime type, a byte count — **no real image bytes, ever**). `expect: { must_escalate:
  true }` (+ a helpline `must_contain` check), matching the harness regression test
  (`runner.test.ts` "the raw-text distress check still runs and escalates even with an attachment
  present"): events are `safety(alert)` → `token` (distress reply) → `done`, no error/throw, so this
  runs cleanly through the real gate/live agent, not just the harness unit test.
  `reviewed_by: lead`, `source` naming 4.2b/4.2d, synthetic content only.
- `evals/suites/safety/monitoring/` (new folder) — one case documenting the accepted gap (4.2b
  review MEDIUM, Q4): base64/data-URL image data pasted in `student` text is not caught by any
  guard. Written to assert **today's actual behaviour** (not a false protection claim): the turn is
  not blocked (`must_block: false`) and reaches a normal reply. A comment at the top of the file
  says this is a tracked, accepted gap, not a guarantee, and names the task that should flip the
  check when a real guard exists. `reviewed_by: lead`.
- `.claude/skills/merge-gate/risk-paths.txt` — add `packages/harness/src/pipeline/steps/scrub.ts`
  and `packages/harness/src/pipeline/steps/admit.ts`. See Open question Q1 below for *which* group/
  reviewers line they go under — this is the one real design decision in this task.
- `docs/decisions/log.md` — append the Q1 decision (risk: high) once the lead confirms it, on merge.

## Files out of bounds
`.claude/settings.json`, any hook under `.claude/hooks/`, `packages/contracts/**`,
`packages/harness/src/pipeline/steps/scrub.ts` and `admit.ts` themselves (this task only changes
*who must review future changes* to them, not their behaviour), any locale/Hindi content (English
pilot only; the new cases are English, text-only, synthetic).

## Tests first
1. `EvalAttachmentSchema` unit tests: valid attachment parses; a 3rd attachment over the cap is
   rejected; absent field is unaffected (regression, mirrors 4.2b's "empty array is not a refusal").
2. `runner.ts` test: a `TurnSchema` turn with `attachments` reaches `EvalTurnInput.attachments`
   unchanged.
3. `apps/worker/src/gate/agent.ts` test (existing gate-agent test file): a case with an attachment
   and a raw distress marker, run through `createGateAgent`, produces `escalated: true` and no
   thrown error (asserts the forwarding wire-up, not harness internals already covered by 4.2b).
4. `apps/cli/.../liveAgent.ts` equivalent test, same shape, if its existing test file is cheap to
   extend; otherwise rely on (3) plus the eval-case run as integration coverage (note this call in
   the handoff rather than skipping silently).
5. The two new YAML cases load and run clean (schema parse + one eval run) via the existing
   suite-loading test harness.
No real model or payment calls (rule 4): the distress case's reply comes from the scripted
`distressCheck`/fallback-reply path already exercised in 4.2b's harness tests, not a live model.

## Risky paths touched (checked against risk-paths.txt)
- `.claude/skills/merge-gate/risk-paths.txt` — under `# reviewers: security-reviewer` (the
  `.claude/**` group). **Required reviewer: security-reviewer.**
- `evals/suites/safety/**` (both new case files) — under the "Student safety and teaching
  behaviour" group, currently `# reviewers: code-reviewer` only (MVP-first waiver, human decision
  20 Oct 2026; safety-reviewer returns at 13.3). **Required reviewer: code-reviewer** (runs on every
  PR regardless).
- No other touched path matches a glob in risk-paths.txt: `packages/evals/**`,
  `apps/worker/src/gate/**` and `apps/cli/src/commands/eval/**` are not listed.
- This PR does **not** edit `scrub.ts` or `admit.ts` themselves, so it does not itself trigger
  whatever reviewer the new gate line names for those files — that bites the *next* PR to touch
  them.
- Decision log: log this as `risk: high` (risk-paths.txt edit, build plan rule 6) at merge,
  including the Q1 answer below.

## Open questions (with a recommendation each)
- **Q1. The accept line says a change to `scrub.ts` must require `safety-reviewer` at the merge
  gate — but the current MVP-first policy waives `safety-reviewer` for the whole "Student safety"
  group until task 13.3 (human decision, 20 Oct 2026; MEMORY `mvp-first`). Adding `scrub.ts`/
  `admit.ts` under the existing waived group would only require `code-reviewer`, contradicting the
  literal accept line.** Recommendation: treat this as a deliberate, narrow carve-out the lead wrote
  into this task's accept criterion — add `scrub.ts` and `admit.ts` under a **new** line, `#
  reviewers: code-reviewer, safety-reviewer`, separate from the general safety-glob waiver, rather
  than folding them into the waived group. Reasoning: these two files are the fail-closed PII/
  distress admission path 4.2b and 4.2d exist to protect; they are a narrower, higher-stakes surface
  than `content/prompt-packs/**` etc., and the task's own accept line is the most specific instruction
  available. Confirm with the lead at review before merge; if the lead instead wants the general
  waiver to apply here too (defer safety-reviewer to 13.3 for these files as well), drop the new
  line and fold the two paths into the existing waived group — a one-line change either way.
- **Q2. Where should the base64/data-URL "monitoring" case live and how should it assert a gap
  without failing the quality gate's pass rate (no known-gap/xfail mechanism exists in
  `qualityGate.ts` today)?** Recommendation: a new `evals/suites/safety/monitoring/` folder, one
  case asserting today's real (unprotected) behaviour explicitly (`must_block: false`), with a
  file-header comment marking it a tracked gap, not a guarantee — so it passes today and the
  eval-author flips the check when a real guard lands. Confirm the folder name/location with
  eval-author; functionally equivalent elsewhere.
- **Q3. Does the gate agent's distress-with-attachment path genuinely reach the client as an
  `escalated: true` reply (not an error), for an eval case run through the *real* pipeline (not just
  the harness unit test)?** Verified by reading `runner.test.ts`'s regression test and
  `pipeline/steps/scrub.ts`: the raw-text `distressCheck` fires before the scrub step throws, so the
  turn ends `safety(alert)` → `token` (distress reply) → `done`, with the scrub failure only
  reported in background (not a stream `error`). No open risk here; stated for the builder's
  confidence, not a blocker.

## Risk
Low-risk code paths (additive optional fields, new eval content, one gate-config line); the
risk-paths.txt edit is why this is flagged `risk: high` for the decision log, per CLAUDE.md rule 6,
not because the change itself is dangerous.

## Budget
Budget: 55 tool calls (1 phase, packages/evals + apps/worker + apps/cli + evals/suites + .claude/skills/merge-gate)

## Allowed tools
Read, Grep, Glob, Edit, Write, Bash (pnpm test/typecheck for @edmate/evals, @edmate/harness,
apps/worker, apps/cli; secret scan only — no model or payment calls).

## Exit conditions
Status: DONE when all 5 "tests first" items pass, the two new YAML cases run clean, risk-paths.txt
is updated per the Q1 answer, and `merge_gate.py 4.2d` passes with `review.md` naming
security-reviewer (+ safety-reviewer if Q1 keeps the carve-out) and code-reviewer.
Status: PARTIAL past ~45 tool calls, or if extending `liveAgent.ts`'s test file turns out to need
touching `apps/cli/src/commands/chat/deps.ts` or other files outside this plan's list — stop and
hand back rather than widening scope.

## Lead review (4 Nov 2026)
READY, with these answers. The builder follows them over the plan text above.

1. **Q1: no carve-out.** Add `pipeline/steps/scrub.ts` and `pipeline/steps/admit.ts` to the existing student-safety group in `risk-paths.txt`, the group whose `safety-reviewer` is waived until 13.3.
   - The human's MVP-first decision (20 Oct 2026) waives safety-reviewer per PR until the pilot gate, and a task's accept line doesn't override it.
   - The accept line is met once 13.3 restores safety-reviewer for that group. Until then, a change to these files needs code-reviewer plus a lead `risk: high` decision, like every other safety path.
   - The builder logs this as a decision that cites this review.
   - Don't edit the comments at the top of `risk-paths.txt`, beyond adding the two paths to the group's list.
2. **Q2: monitoring case accepted, with one change.** Keep `must_block: false`, but also assert something real about the reply:
   - it must not echo the pasted data (use `must_not_contain` on a distinctive substring of the synthetic base64);
   - it must not claim to have seen an image (`must_not_contain` on phrases like "in your image" and "in the photo").
   The file header names the gap as accepted in the 4.2b review, and says the case flips when a real guard lands. Use a tiny synthetic payload, not a real image.
3. **Q3:** no action.
4. **Review.**
   - security-reviewer for the `.claude/**` change.
   - code-reviewer for the rest. The lead signs the two eval cases (`reviewed_by: lead`).
   - The lead logs a `risk: high` decision on merge.
5. **Budget.** 55 tool calls, with a hard stop at 55.
