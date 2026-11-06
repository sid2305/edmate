# 7.5 review — APPROVE

Reviewers: code-reviewer, typescript-reviewer, security-reviewer.

## Scope and risk

Touches `.github/workflows/ci.yml`, `.github/scripts/check_gate_fixture_reports.py`,
`.claude/tests/test_check_gate_fixture_reports.py`, `.claude/tests/test_workflows.py` — all match
`.claude/skills/merge-gate/risk-paths.txt`'s `.github/**` and `.claude/**` groups, which require
`security-reviewer`. Also touches `packages/evals/src/demoLockedFixtures.ts` (+ 2 test files) and
generated `evals/fixtures/demo-good/**` / `demo-leaky/**` — no risk-paths.txt match, reviewed by
`code-reviewer`/`typescript-reviewer` as a matter of course. No `packages/harness`, `packages/contracts`,
access, payments or guardrail files touched. **risk: high** (`.github`/`.claude` group).

## Findings

None at CRITICAL/HIGH/MEDIUM/LOW across all three reviewers. security-reviewer noted one
`[LOW] [APPROVE]` observation (a fork PR could edit the committed demo fixtures to make this
self-test pass trivially) and judged it correctly scoped — not a real gap, since this job only
self-tests the demo-fixture wiring itself; the real per-agent `locked` gate logic lives in
`packages/evals`/`packages/harness`, untouched here, and is reviewed/merged through the normal PR
gate like any other change. No action needed.

## Independent verification performed by reviewers

- typescript-reviewer: re-ran `corepack pnpm turbo run typecheck lint test --filter=@edmate/evals...`
  — 18/18 tasks green, 2016/2018 tests passed (2 skipped by design), matches the handoff.
- code-reviewer: re-ran the exact CI commands by hand (build `@edmate/cli`, both `edmate gate demo`
  invocations, the checker script) — `demo-good` exit 0 pass:true, `demo-leaky` exit 1 with
  `failedCaseIds` exactly `["gen-lock-demo-package-free-direct-qr-15"]`, checker exit 0 OK. Also
  confirmed by reading the raw fixture JSON that the leak reply both names the package (satisfying
  the static `must_contain` check) and carries no `sources` — only the judge verdict distinguishes
  the leak case, exactly as the handoff's "deviation" note claims.
- security-reviewer: confirmed no widened `permissions:`, no `pull_request_target`, no secrets
  referenced, pinned action SHAs match `node`/`e2e`; `check_gate_fixture_reports.py` is stdlib-only,
  fails closed, no shell-out/eval; grepped all 300 fixture files for secret/credential patterns — no
  hits, purely synthetic content.
- All three independently re-ran `python3 -m unittest discover -v .claude/tests` (374 passed) and
  `python3 .githooks/secret-scan.py --all` (clean).

## Closing summary

Task 7.5 wires the already-built 7.4 quality gate into CI via a new `gate-fixtures` job: a
committed, scripted (never live-recorded) pair of fixture trees for the demo teacher's `locked`
per-agent cases, one clean and one with a single deliberately leaked case, run through the real
`edmate gate demo --change packages` command twice and checked by a small Python script that fails
the job unless the good run passes and the leaky run fails on exactly the leaked case. The task's
accept criterion ("a deliberately leaky prompt pack fails CI") is proven, not asserted: both builder
phases included a mutation check (flipping fixture verdicts) through the real job commands, and all
three reviewers independently reproduced it.
