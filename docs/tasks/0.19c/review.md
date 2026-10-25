# 0.19c review — APPROVE

Reviewers: security-reviewer

security-reviewer (Sonnet) read the diff and ran `pytest .claude/tests/test_merge_gate.py` on the branch: 109 passed. The captured task id holds only `[0-9a-z]` and a single dot, so the `docs/tasks/{task}/...` lookups cannot be redirected. The slug is still required. Both call sites share one pattern. No other gate check changed.

## Findings
- [LOW] [wontfix] .claude/skills/merge-gate/merge_gate.py — `\d` in TASK_BRANCH matches Unicode digits without re.ASCII. This predates the change, and the gate fails closed, so it can't be exploited.
