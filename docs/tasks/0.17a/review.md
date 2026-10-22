# 0.17a review — APPROVE

Reviewers: security-reviewer (sonnet), code-reviewer (sonnet)

## Findings

- [HIGH] [fixed] .claude/skills/merge-gate/merge_gate.py — a whole-document search let a decoy Budget line outside the section count (fix round 1).
- [HIGH] [fixed] .claude/skills/merge-gate/merge_gate.py — an unclosed or mismatched code fence could hide or fake Budget and Reviewers lines (fix round 2).
- [HIGH] [fixed] .claude/skills/merge-gate/merge_gate.py — a line indented 4+ spaces counted as a real Reviewers or Budget line (fix round 3).
- [HIGH] [fixed] .claude/skills/merge-gate/merge_gate.py — an HTML comment could hide a decoy Budget or Reviewers line (fix round 4; not re-probed, per B-39 a).
- [LOW] [fixed] .claude/skills/merge-gate/merge_gate.py — budget_cap ran the fence mask 3-4 times (fix round 3).
