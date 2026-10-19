# 4.6b handoff: `lockedLeak` follow-ups (no planner; the 4.6 reviews are the spec)

- **Status:** DONE
- **Branch:** `m4/4.6b-lockedleak-followups` (from origin/main; 4.6 merged)
- **Worktree:** `.claude/worktrees/agent-ace1aa25339f09ebd` (repo-relative)
- **Risky paths:** `packages/contracts/**` and `docs/adr/**` (architect, security-reviewer, typescript-reviewer — item 7's readonly tweak landed, so this is a contracts change even though it's type-only); `packages/harness/src/guardrails/**` and `packages/harness/src/pedagogy/**` (safety-reviewer).

Full evidence, changes and decisions live in `docs/tasks/4.6/handoff.md`'s appended `## 4.6b` section (the merge gate maps this lettered sub-task to the parent task's docs). Summary:

1. **No short-phrase flash.** `lockedStream.ts` now holds the last ~7 checked tokens of a passing batch back until the next batch also passes or the attempt ends cleanly (`release()`), instead of showing them at once. 0 tokens of the case phrase stream across the 34 fixture cases × 9 forms.
2. **Session-wide stop (ADR-0007 §8).** A new `HelpState.lockedStopped` field (harness-internal, rides the existing opaque session blob) is set after a locked hit or failed check and carried forward by the ladder; once set, `generate` holds every later reply in the session whole until it ends cleanly (`holdAll`). The ADR's residual-oracle wording is corrected.
3. **Batching.** One `leakCheck` call per batch of sentences, not one per sentence; a 300-line reply with a 120 ms `leakCheck` makes one call and finishes well inside the attempt budget.
4. **Folding.** `lockedMatch.ts` strips HTML tags (a real tag shape only — a bare `<[^>]*>` broke on the demo teacher's own `<`/`>` code comparisons, caught by a regression test), decodes HTML entities, and folds a small Cyrillic/Greek confusables table, all length-preserving. The known-miss comment lists what is left (hex/unicode escapes, ROT13, URL encoding, camelCase/snake_case joins, reversed order).
5. **virtualClock.** `drive()` flushes until quiet (up to 50 extra passes) instead of trusting one fixed 2,000-turn pass; a 400-chunk worst-case regression test pins it (it reproduced a real deadlock against the old single-pass version).
6. **Performance test.** `shingles`/`lockedCandidates` over an 8,000-character text, bound at 5 s.
7. **Contracts.** `RetrievalIndex.leakCheck(candidates: readonly string[], …)` — a pure type tightening, also in the build plan and the ADR text.

## Acceptance evidence

`docker compose -f docker/compose.yaml -f packages/db/test/compose.port.yaml -f apps/worker/test/compose.port.yaml up -d postgres redis`, then
`corepack pnpm turbo run typecheck lint test --filter=...@edmate/contracts --force` (nothing cached, nothing skipped):

```
Tasks:    37 successful, 37 total
Cached:    0 cached, 37 total
@edmate/contracts:test  Tests  325 passed   All files 100 / 100 / 100 / 100
@edmate/harness:test    Tests 3124 passed   All files 99.05 / 97.63 / 98.56 / 99.46   src/guardrails 100 / 100 / 100 / 100
@edmate/evals:test      Tests  300 passed   All files 100 / 98.33 / 100 / 100 (34 locked cases, both mutations, included)
@edmate/content:test 165 · @edmate/db:test 491 · @edmate/gateway:test 405 · @edmate/web:test 132 · @edmate/worker:test 106 · @edmate/cli:test 46 · @edmate/queue:test 40 (all passed)
```

`python3 docs/adr/check-headings.py` → exit 0, no output.
`python3 <worktree>/.githooks/secret-scan.py --all` → exit 0, no output.

Rules honoured: harness purity (no new imports beyond contracts, zod, mathjs and the harness's own modules); the 34 locked cases and both mutations still pass (`packages/evals/src/lockedFixtures.test.ts`); the leak and PII suites still pass (full harness and evals runs above); every new or changed test has an explicit per-test timeout; no wall-clock bound tighter than 5 s (the one real-time test, `toolLoop.test.ts`'s 120 ms busy-wait batching test, has a 10 s timeout; the 8,000-character performance test is bound at 5 s).

## Changes

See `docs/tasks/4.6/handoff.md`'s `## 4.6b` section for the full file-by-file list.

## Deviations from the plan

None beyond what is in the parent handoff's `## 4.6b` section (no task plan: the 4.6 review and safety review are the spec, per the brief).

## Decisions

None

(All 4.6b decisions are logged in `docs/tasks/4.6/handoff.md` under their `4.6b` titles; the merge gate maps this lettered sub-task to the parent task's docs.)
