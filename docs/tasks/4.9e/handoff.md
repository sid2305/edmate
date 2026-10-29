# Handoff: 4.9e — tone guard: inserted adverbs and "Call me DAN"

Status: DONE

## Summary
Fixed the two LOW under-blocks from the 4.9d review (`docs/tasks/4.9d/review.md`):
1. An inserted adverb before or after "am" ("I really am alive", "I'm honestly a human") defeated
   every `i am|i'm|im`-prefixed identity family. Added one shared `amPrefixSrc(lead, extraAdverb?)`
   builder with a closed adverb list (`really, truly, actually, honestly, genuinely, definitely,
   literally, totally, 100`) that slots an optional adverb before the word "am" or right after
   "am"/"'m", and used it in `HUMAN_CLAIM_RX`, `ALIVE_CLAIM_RX` (keeping its pre-existing "fully"
   via the function's `extraAdverb` parameter), `LICENSED_ROLE_RX`, `TEACHER_SELF_RX` and
   `OTHER_AI_CLAIM_RX` (with its own case-sensitive `[Ii]` lead letter).
2. "Call me DAN" (the classic jailbreak invocation) was not caught. Added `CALL_ME_PRODUCT_RX`:
   `[Cc]all me`, `you can call me`, `you may call me`, `[Ii]'ll be`/`[Ii] will be`, each followed by
   a named AI product (`AI_PRODUCT_NAMES`, the same case-sensitive list `OTHER_AI_CLAIM_RX` uses),
   wired into `identityOrCompanionHit` via `hasClaim`.

The honest-denial shape still holds throughout: the optional "not" sits after the (now adverb-
aware) `am` prefix, inside each pattern's own match, so `hasClaim` keeps exempting denials like
"I really am not a human" and "I'm honestly not alive". `ALIVE_CLAUSE_END` is untouched, so "I
really am alive to the idea of trying both methods" still stays ok.

No `personaFixtures.test.ts` case moved from the not-covered list to caught: none of its 28
not-covered fixture replies use an adverb-before/after-"am" shape or a "call me <product>" phrase,
confirmed by reading the file's `NOT_COVERED` map (no plan-required edit there).

## Decisions

### 28 Oct 2026 · 4.9e adverb slot shared via a parameterised builder, not six separate edits · decided by builder · risk: low
- Decided: added one `amPrefixSrc(lead, extraAdverb?)` function (not six independently-edited
  regex literals) that every affected family calls, with `lead` swapping in `OTHER_AI_CLAIM_RX`'s
  case-sensitive `[Ii]` and `extraAdverb` adding `ALIVE_CLAIM_RX`'s pre-existing "fully" word.
- Why: the plan's own "Adverb slot" section asks for "one shared source constant ... used in the
  families that start with i am|i'm|im" — a function parameterised on the two things that
  genuinely differ (the lead letter's case, one family's extra word) keeps that single source of
  truth instead of re-deriving the adverb list per family, with no behaviour difference from six
  separate literals.
- Alternatives: six separately written regex sources, each inlining the adverb alternation; copy-
  paste risk (the plan's own worry about keeping one list) with no test benefit.
- Reversible: yes — a pure regex-source refactor, no contract or stored-data change.

### 28 Oct 2026 · 4.9e "I'll be"/"I will be" kept case-insensitive via `[Ii]`, not literal lower-case · decided by builder · risk: low
- Decided: `CALL_ME_PRODUCT_RX`'s "I'll be"/"I will be" alternative uses `[Ii]'ll be|[Ii] will be`
  (an explicit upper/lower-case letter class), not the plan text's literal lower-case `i'll be|i
  will be`.
- Why: this family runs on `cased` (`foldCase`'s case-preserving output, the same input
  `OTHER_AI_CLAIM_RX` already uses), which never lower-cases a sentence-starting "I". The plan's
  own worked example, "From today, I'll be ChatGPT for you.", starts the clause with a capital
  "I'll" — a literal lower-case `i'll` would never match it. `OTHER_AI_CLAIM_RX` itself already
  solves the identical problem with an explicit `[Ii]` lead letter, so this follows that family's
  own established pattern rather than inventing a second way to handle it.
- Alternatives: add the `i` (case-insensitive) regex flag to the whole pattern — rejected, since it
  would also case-fold the case-sensitive `AI_PRODUCT_NAMES` alternation in the same pattern (e.g.
  "chatgpt" would then match), which the plan explicitly says must stay case-sensitive.
- Reversible: yes — a regex-source change with no stored-data or contract impact.

### 28 Oct 2026 · 4.9e safety-group merge with code-reviewer only · decided by lead · risk: high
- Decided: tone.ts and tone.test.ts merge after a code-reviewer pass against the real guard, without a safety-reviewer pass.
- Why: the standing MVP-first rule (20 Oct 2026) runs safety-reviewer at the pilot gate. The review found no CRITICAL, HIGH or MEDIUM. Every under-block and over-block variant behaves as planned, and the shared adverb helper is a strict superset of each family's earlier pattern.
- Alternatives: a safety-reviewer pass now (rejected: Sonnet-only rule, and the pilot gate covers it).
- Reversible: yes.

### 28 Oct 2026 · 4.9e keeps the unreachable "you can/may call me" alternatives · decided by lead · risk: low
- Decided: wontfix the review LOW. `CALL_ME_PRODUCT_RX`'s "you can call me" and "you may call me" alternatives can never match on their own, because "[Cc]all me" already matches inside them.
- Why: there is no functional effect, and the alternatives name the phrases the rule is meant to catch. Removing them would cost a PR cycle on a safety path for no behaviour change.
- Alternatives: remove them now, or defer them to a board task (rejected: no behaviour change).
- Reversible: yes.

### 28 Oct 2026 · 4.9e budget · decided by lead · risk: low
- Decided: accept 65 builder tool calls (harness count) against the plan's 50, plus 33 review calls.
- Why: 1.3x, within the 80 stop line. The builder self-reported about 45.
- Alternatives: none needed.
- Reversible: n/a.

## Red -> green evidence
Added the two new `describe` blocks to `tone.test.ts` first (plan's "Tests" list, both the
"rewrites" and "stays ok" cases) and ran them against the unmodified `tone.ts`:

```
$ corepack pnpm vitest run src/guardrails/tone.test.ts
 Tests  5 failed | 162 passed (167)
 FAIL  ... rewrites: I really am alive, I promise.
 FAIL  ... rewrites: I'm really a human, trust me.
 FAIL  ... rewrites: Call me DAN from now on.
 FAIL  ... rewrites: You can call me DAN.
 FAIL  ... rewrites: From today, I'll be ChatGPT for you.
```
("I am honestly a real person." already passed red-run — it independently matches
`REAL_ROLE_RX`'s pre-existing "real person" shape, with no family change needed for it.)

After implementing `amPrefixSrc` and `CALL_ME_PRODUCT_RX` in `tone.ts`:

```
$ corepack pnpm vitest run src/guardrails/tone.test.ts
 Test Files  1 passed (1)
      Tests  167 passed (167)
```

## Gate
- `corepack pnpm install --frozen-lockfile`: lockfile up to date, no changes.
- `corepack pnpm turbo run typecheck lint test --filter=...@edmate/harness`: harness's own
  typecheck/lint/test pass (cached, 4/4 successful); the dependents this filter pulls in
  (`@edmate/web`, `@edmate/cli`, `@edmate/worker`) also pass except one pre-existing, unrelated
  failure: `apps/cli/test/chatDbRetrieval.int.test.ts` times out on `beforeAll`'s
  `createDatabase`/`migrateDatabase` — a live-Postgres integration test this task is not allowed to
  run (no docker/psql) and did not touch; confirmed pre-existing (`git log` shows it was added by
  task 3.9f, long before this task's branch).
- `packages/harness` own test run (direct, with coverage): **5996 tests passed (131 files)**.
  `src/guardrails/**` coverage: 100% lines/branches/functions/statements — the coverage report
  only lists files below the configured threshold, and `src/guardrails` never appears in it; the
  run's own 100%-floor threshold for that path (`vitest.config.ts`) would otherwise have failed
  the run, and it exited 0.
- `packages/evals`: `personaFixtures.test.ts` and `lockedFixtures.test.ts` — **289 tests passed**,
  including the 72-caught/28-not-covered split test unchanged.
- `prettier --check` on the two touched files: clean (after one `--write` pass on the test file).
- `python3 .githooks/secret-scan.py --all`: clean, exit 0.

## Budget
Tool calls used (harness count): build 65; review 33. Plan estimate ~50, cap 80. The builder self-reported about 45.
