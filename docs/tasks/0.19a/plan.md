# 0.19a plan: closeout.py regenerates the decisions digest

Written by the lead (a small tooling change; no planner run).

## Acceptance (board)
closeout.py regenerates docs/decisions/digest.md after appending decisions, so a stale digest no longer fails the RealRepo freshness test in CI for every later PR.

### How it is shown (paste into handoff.md)
- A new test in .claude/tests/test_closeout.py: after a closeout that appends a decision, `docs/decisions/digest.md` in the temp repo equals what `board.py digest` renders (or is updated: its content changed and includes the new entry when the entry belongs in the digest).
- A test that a failing `board.py digest` makes closeout print the reason and exit non-zero **after** the board is already set to done (so the lead sees it and runs `board.py digest` by hand), and does not undo the board change.
- `python3 -m unittest discover -s .claude/tests` (or the repo's python-harness CI command) green; `python3 .githooks/secret-scan.py --all` clean.

## Design
In `.claude/skills/team-lead/closeout.py` `main()`, right after `board.py set <id> done` succeeds (before worktree/branch cleanup), run `sh(root, "python3", board_py, "digest")`. On a non-zero exit print `could not regenerate docs/decisions/digest.md: <its output>` and remember a non-zero return code, but still do the worktree/branch cleanup; return 1 at the end in that case. Update the module docstring's numbered steps. Use the existing `sh` helper; no new imports.

## Files to create/modify
- .claude/skills/team-lead/closeout.py
- .claude/tests/test_closeout.py (and .claude/tests/helpers.py only if the temp repo fixture needs a digest-capable board copy)
- docs/tasks/0.19a/handoff.md

## Files out of bounds
Everything else, including .claude/settings.json, hooks, .claude/skills/board/** and .claude/skills/merge-gate/**. Never write a `__pycache__` folder into .claude (run python with `PYTHONDONTWRITEBYTECODE=1`).

## Risky paths touched (checked against `.claude/skills/merge-gate/risk-paths.txt`)
`.claude/**` → security-reviewer. The lead logs a `risk: high` decision.

## Questions
None.

## Budget
30 tool calls; stop at 40.
