# Handoff: 4.9

Status: PARTIAL (Phase A done; Phase B `personaBoundary` and Phase C the 100-case persona
fixture gate are still to do, out of this build's scope per the brief)

## Summary

Phase A built the `tone` post-guard: an always-on, no-precondition identity/companion/teacher-note
echo floor. It rewrites the whole reply with one fixed string per reason (never a surgical edit),
registered in `postGuards` after `adviceGuard` with default weight 1. `personaBoundary` (Phase B)
is intentionally NOT registered — `GUARD_ORDER.post` already declares it between `tone` and
`adviceGuard`'s slot in the order list, so Phase B only needs to add the guard file and register
it; `tone`'s floor fires regardless of `ctx.persona`, so Phase B does not need to coordinate
anything with it beyond ordering.

Files changed:
- `packages/harness/src/guardrails/tone.ts` (new) — the guard. Folds text (NFKC, confusables,
  punctuation-to-space keeping `\p{M}` marks so Devanagari matras survive, then lower-cases and
  collapses spaced-out single letters), then matches identity/companion/teacher-note-echo
  patterns with an honest-denial exemption built into each pattern (`(?: not)?`), never a
  separate before-the-match lookup. English-first; Hindi/Hinglish variants are a safety net only.
- `packages/harness/src/guardrails/tone.test.ts` (new) — 76 tests, all green.
- `packages/harness/src/guardrails/postGuards.ts` — registers `createToneGuard()`.
- `packages/harness/src/pipeline/steps/scrub.ts` — exports `defaultScrubRegistry()` (needed by a
  completeness test added to `registry.test.ts`).
- `packages/harness/src/guardrails/registry.test.ts` — added a test that the real, wired-up
  registry includes `tone`.
- Four pre-existing test files needed mechanical updates because registering a 5th post guard
  changes both the exact-order/trace assertions and the per-guard time-budget slice (see
  Decisions): `answerLeak.test.ts`, `lockedLeak.test.ts`,
  `packages/harness/src/pipeline/steps/postGuard.grounding.test.ts`,
  `packages/harness/src/pipeline/steps/postGuard.advice.test.ts`.

Red/green evidence: `tone.test.ts` written first with all cases failing against a stub, then
made to pass incrementally (regex/normalisation bugs fixed along the way — Devanagari combining
marks wrongly stripped by the punctuation fold; `I'm here` wrongly matched as a name-signoff;
global-regex `lastIndex` statefulness on repeated `.test()` calls). Final run of the harness test
package: 130 files, 5782 tests passed, 0 failed.

## Decisions

### 28 Oct 2026 · 4.9 tone's drift test replaced with a literal pin · decided by builder · risk: low
- Decided: instead of reading `content/prompt-packs/frame@1.2.0.md` from disk to check the
  teacher-note text hasn't drifted (the pattern `rolePlayFixtures.test.ts` in `packages/evals`
  uses), `tone.test.ts` asserts `TEACHER_NOTE_TEXT` equals the literal expected string.
- Why: `packages/harness`'s ESLint `harness-purity/no-external-import` rule blocks `node:fs`/
  `node:url` even inside test files (confirmed by lint failure), so the file-reading pattern does
  not transfer from `packages/evals`, which is not bound by that rule.

### 28 Oct 2026 · 4.9 four extra test files touched, timing values retuned · decided by builder · risk: low
- Decided: edited `answerLeak.test.ts`, `lockedLeak.test.ts`, `postGuard.grounding.test.ts`, and
  `postGuard.advice.test.ts` — outside this build's stated touch list — to add `'tone'` to
  exact-order/guard-trace assertions, and to reduce several precisely-tuned millisecond delay
  fixtures (`postGuard.grounding.test.ts`'s "all three used" table, `postGuard.advice.test.ts`'s
  slice-budget tests) so they still fit inside the per-guard time slice.
- Why: registering `tone` as a 5th post guard is an unavoidable, mechanical change to two things
  shared by every post-guard test: the exact guard list/trace these tests assert on, and the
  `postGuardSliceMs` share formula's denominator (now includes `tone`'s weight), which shrinks
  every earlier guard's proportional slice slightly. No production logic changed in these four
  files; only test fixtures/assertions were adjusted to match the now-correct 5-guard chain.

## Gate

- `corepack pnpm turbo run typecheck lint test --filter=...@edmate/harness` — all tasks pass
  except one `@edmate/gateway` test (`test/adapters/env-fallback.test.ts`), confirmed unrelated
  flakiness: re-run alone (`vitest run test/adapters/env-fallback.test.ts`) → 1 file, 4 tests,
  all passed. Harness itself: typecheck, lint and test all green.
- `cd packages/harness && vitest run` (full package, no filter) → 130 test files passed,
  5782 tests passed, 0 failed. No DB-integration skips observed in this run (none of the harness
  suites in this package require Postgres).
- `corepack pnpm exec prettier --check` on all 9 changed/new files → clean after one
  `--write` pass on `tone.ts`/`tone.test.ts` (both newly authored, not yet formatted); re-checked
  clean; re-ran `tone.test.ts` after the format pass, still 76/76 green.
- `python3 .githooks/secret-scan.py --all` → clean, no output (pass).

## Budget

Tool calls used: Phase A ~100 (across the full session including the prior, now-summarized
portion; this final stretch of the session — re-running the gate, prettier, secret-scan, and
writing/committing this handoff — used 9 tool calls).
