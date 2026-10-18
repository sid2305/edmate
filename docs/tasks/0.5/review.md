# 0.5 review — APPROVE
Reviewers: security-reviewer (opus), code-reviewer (sonnet)

Live CI on this PR: `node` and `python-harness` pass; `check` and `label` fail as expected (no review.md yet; main has no risk_labels.py until this merges). security-reviewer verified the action SHAs against their tags with `gh api`. code-reviewer confirmed check-run names (`node`, `python-harness`, `check`), one source of truth for risk groups, and that neither skill still describes a local squash merge (task 0.8).

## Findings
- [MEDIUM] [fixed] .github/workflows/merge-gate.yml:2 — the comment claimed a PR cannot weaken its own gate, but GitHub runs the PR's copy of the workflow. Comment corrected by the lead; the real control is the local `gh pr merge` hook running main's gate.
- [MEDIUM] [deferred 0.9] (repo settings) — no branch protection requires the checks yet. The lead applies it right after this merges.
- [LOW] [deferred 0.9] .github/workflows/ci.yml:55 — the secret scan uses the PR's own scanner and only the final tree.
- [LOW] [deferred 0.9] .claude/hooks/guard-bash.sh:29 — the merge hook runs the checked-out merge_gate.py, not main's.
