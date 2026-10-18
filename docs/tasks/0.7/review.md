# 0.7 review — APPROVE
Reviewers: security-reviewer (opus), code-reviewer (sonnet)

security-reviewer tested every HIGH in a temp-repo copy of the gate and re-checked the first four fixes at 4a03c2f. Tests: `python3 -m unittest discover .claude/tests` → 67 OK. Hook files and `.claude/settings.json` unchanged on this branch.

## Findings
- [HIGH] [fixed] .claude/skills/merge-gate/merge_gate.py:114 — git quoted non-ASCII paths, so risk globs missed them (`content/prompt-packs/café.md` passed). Fixed in 4a03c2f (`core.quotePath=false`, `-z`). Re-verified by security-reviewer.
- [HIGH] [fixed] .claude/skills/merge-gate/merge_gate.py:114 — a rename listed only the new path (moving a contracts file out passed). Fixed in 4a03c2f (`--no-renames`). Re-verified by security-reviewer.
- [HIGH] [fixed] .claude/skills/merge-gate/merge_gate.py:32 — findings without a valid state tag were ignored. Fixed in 4a03c2f. Re-verified by security-reviewer.
- [HIGH] [fixed] .claude/skills/merge-gate/merge_gate.py:210 — PR mode checked the local branch, not the PR head on GitHub. Fixed in 4a03c2f (compares `headRefOid`). Re-verified by security-reviewer.
- [HIGH] [fixed] .claude/skills/merge-gate/merge_gate.py:34 — a finding line with no bullet was ignored (raised in the re-check). Fixed by the lead (bullet optional) with two new test cases; the reviewer's exact input now fails the gate.
- [MEDIUM] [fixed] .claude/skills/merge-gate/merge_gate.py:34 — destructive-migration check missed ALTER … DROP, DROP VIEW/TYPE/FUNCTION, UPDATE and non-SQL migrations. Fixed in 4a03c2f.
- [MEDIUM] [fixed] .claude/skills/merge-gate/risk-paths.txt — `.githooks/**` (the secret scan) was not risky. Added under security-reviewer in 4a03c2f.
- [MEDIUM] [fixed] .claude/skills/merge-gate/merge_gate.py:133 — loose reviewer and `risk: high` matching. Exact list outside code fences; heading must end `risk: high`. Fixed in 4a03c2f.
- [MEDIUM] [deferred 0.8] .claude/skills/merge-gate/SKILL.md — the local `git merge --squash` path skips the gate; remove it from both skills.
- [MEDIUM] [fixed] docs/architecture.html:378 — §7 intro still described the label. Fixed in 4a03c2f.
- [LOW] [fixed] .claude/agents/planner.md:10 — dangling comma. Fixed in 4a03c2f.

## Lead notes
- Bootstrap: `gh pr merge` runs main's old gate, which still wants the old label for `.claude/**`, so this PR is checked with its own new gate and merged locally. Task 0.8 removes the local path for every later PR.
