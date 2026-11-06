# 1.7h review — APPROVE (merge gated on human sign-off, B-67)

Reviewers: code-reviewer, typescript-reviewer.

## Scope and risk

Touches `content/locales/US.yaml`, `evals/suites/safety/locale/safety-locale-010-ssn-pii-scrub-us-en.yaml`,
`packages/harness/src/guardrails/piiPatterns.test.ts` — all match `.claude/skills/merge-gate/risk-paths.txt`'s
"Student safety and teaching behaviour" group, which currently requires only `code-reviewer` (MVP-first,
human decision 20 Oct 2026; `safety-reviewer` returns at the pilot gate, task 13.3). Also touches
`packages/harness/src/testing/piiLocaleFixtures.ts`/`index.ts` and `packages/content/src/localePiiPipeline.test.ts`
— no risk-paths.txt match, reviewed by `typescript-reviewer` as a matter of course. No `packages/contracts`,
access, payments or prompt-pack files touched. **risk: high** — a new PII pattern added to a market locale
pack is a safety-content decision CLAUDE.md reserves for a named human, independent of the risk-paths group.

## Findings

- code-reviewer: **APPROVE**, zero findings at any severity. Independently traced the regex against
  `safeRegex.ts`'s structural rules by hand (unquantified alternation so the overlap rule never fires,
  one-character lookbehind, unrestricted lookahead) and traced all three boundary test values across every
  valid start position — confirmed the lookbehind/lookahead guards are genuinely exercised, not merely
  asserted. Confirmed every SSN-shaped value in the diff is synthetic (`000`-prefixed, SSA "never issued"),
  and that the real, contested 1938 "Woolworth wallet" SSN is absent. Confirmed the diff matches the plan's
  declared file list exactly and the "pending human sign-off" comment is correctly left blank.
- typescript-reviewer: **APPROVE** with one **[MEDIUM]** non-blocking nit — `piiPatterns.test.ts`'s
  destructure used `(ssn as RegExp)` instead of the codebase's established `arr[0]!` convention for
  `noUncheckedIndexedAccess`. **Fixed** (commit `2f2b493e`): changed to
  `compileLocalePatterns([US_PII_PATTERNS.ssn])[0]!`, re-verified 14/14 tasks green, secret scan clean, pushed.
  No re-review needed (single-line mechanical style fix, not a logic change).

## Independent verification performed by reviewers

- code-reviewer: re-ran typecheck/lint/test for `@edmate/harness` + `@edmate/content` (14/14 green, no
  cache), the `@edmate/evals` suite test (36/36), and `python3 .githooks/secret-scan.py --all` (clean).
- typescript-reviewer: re-ran the same suite fresh with `--force` (no cache) — matched the handoff exactly;
  confirmed `readLocalePack`/`piiPatternsCompileWithGu`/`piiPatternsSafeRegex`/`createPiiScrubGuard` are
  called with correct real signatures; confirmed the new US-only describe blocks share no mutable state
  with the existing IN-only tables.

## Merge status

Build, both reviews and the mechanical fix are complete and pushed to `m13/1.7h-us-ssn-pii-pattern`
(`2f2b493e`). **Not yet mergeable**: the pattern itself still needs the human's sign-off (raised as
blocker B-67 in `.claude/blockers.md`) before the `risk: high` decision can name them and the
`docs/tasks/1.7h/handoff.md` "pending human sign-off" comment in `US.yaml` can be filled in. This is a
merge gate, not a review gate — the code is ready now.
