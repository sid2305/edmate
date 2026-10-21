# 0.13 review — APPROVE

Reviewers: security-reviewer (sonnet), code-reviewer (sonnet)

Rounds. Both reviewers reviewed 42c9c87. security-reviewer approved it with three LOWs. code-reviewer asked for changes over one HIGH: `closeout.py` treated squash-merged branches as unmerged. Fix round 1 (c5cc5cb, sonnet) fixed the HIGH with a real `git merge --squash` test, plus three LOWs. code-reviewer then re-checked the HIGH at c5cc5cb. Part B (the hook edits in `.claude/settings.json` and `.claude/hooks/`) stays with the human.

## Findings

- [HIGH] [fixed] .claude/skills/team-lead/closeout.py:117 — `branch_is_merged` checked ancestry only, so squash-merged branches never matched; now it tries ancestry first and falls back to tree equality with `git merge-tree --write-tree`, tested with a real squash merge (code-reviewer)
- [LOW] [fixed] .claude/skills/team-lead/SKILL.md:50 — the fix-round cap was restated before step 1, duplicating step 5; the duplicate is gone (code-reviewer)
- [LOW] [fixed] .claude/skills/merge-gate/merge_gate.py:300 — a negative MERGE_GATE_PR_RETRIES crashed with a TypeError; it is now clamped to 0 or more (security-reviewer)
- [LOW] [fixed] .claude/skills/team-lead/closeout.py:109 — the task id went into a path unchecked; ids containing `/`, `\` or `..` are now rejected (security-reviewer)
- [LOW] [deferred 0.13a] .github/scripts/docs_only.py:16 — `docs/.*` matches any extension; safe today, but needs a test for a non-.md file under docs/ (security-reviewer)
