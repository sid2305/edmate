# 5.9 review — APPROVE

Reviewers: code-reviewer (sonnet), typescript-reviewer (sonnet)

The revision suite has 10 English cases with `reviewed_by: lead`: 5 notes, 2 flashcards, and 3 edge cases (uncited, locked module, empty material). The mechanism test composes the real signed set 1.1.0 and revision@1.0.0 against the demo teacher's paid package. A bad stub fails each case and a good stub passes it. An injected chunk outside the entitlement throws `LockedMaterialError`. The empty-material case goes through the real coverage gate to `ask_teacher`. There are no real model calls. The suite has 952 tests, at 100% statement coverage on packages/evals/src.

The code-reviewer had no findings. The typescript-reviewer noted three informational type casts in the test (a redundant `as` on the persona delete; `kind as PackKind`, which `parsePromptPackSet` re-validates; and `find(...) as T`, guaranteed by its predicate, following the groundingFixtures convention). They are left as they are.

## Findings
