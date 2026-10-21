# 5.6e handoff: sign the practice prompt pack

Status: DONE
Branch: m5/5.6e-sign-practice-pack
Worktree: .claude/worktrees/agent-adee13a44aeab7e37

## Changes
- `content/prompt-packs/practice@1.1.0.md`: `reviewed_by: pending` -> `reviewed_by: sid2305`; deleted the last sentence of the code-output rule ("Text that the item itself shows may be shown as given."). No other wording changed (`git diff --word-diff` shows only these two edits).
- `packages/content/src/__snapshots__/promptPacks.snapshot.test.ts.snap`: the "skill practice" composed-prompt snapshot updated for the deleted sentence (one line).
- No other pack touched. No pack hash is pinned in content, harness or evals tests (grep found none).

## Acceptance evidence
- `grep -rn "may be shown as given" packages evals apps content` -> no matches
- `corepack pnpm vitest run src/promptPacks.snapshot.test.ts -u` -> Snapshots 1 updated, Tests 27 passed (27)
- `corepack pnpm vitest run src/validate.test.ts src/promptPacks.test.ts` (content validate + pack loader) -> Test Files 2 passed, Tests 36 passed
- `corepack pnpm turbo run typecheck lint test --filter=@edmate/content... --filter=@edmate/harness... --filter=@edmate/evals...` -> Tasks: 17 successful, 17 total
- `python3 .githooks/secret-scan.py --all` -> clean

## Deviations
None.

## Decisions
### 21 Oct 2026 · 5.6e practice@1.1.0 signed by the human (B-26) · decided by human (sid2305) · risk: high

- Decided: practice@1.1.0 is signed (`reviewed_by: sid2305`) with the last sentence of the code-output rule ("Text that the item itself shows may be shown as given.") deleted, as the human instructed; no other wording changed.
- Why: the human reviewed the pack and approved it with that one deletion (answer B-26, 21 Oct 2026); the sentence let the agent show text from a code-output item, which the rest of the rule forbids.
- risk: high
