# 0.15 review — APPROVE
Reviewers: security-reviewer (sonnet)

Agent-team instructions only (agent files, the team-lead skill, an `env` block in .claude/settings.json) plus a merge-gate check. The security review found no weakening of hooks, permissions, the secret scan, the merge gate's reviewer and risk-path logic, or the ADR, no-real-model-calls and two-failed-rounds rules. `CLAUDE_CODE_AUTO_COMPACT_WINDOW` is a documented Claude Code setting (checked against the settings reference). Fix round 1 added a Status check to the gate; merge-gate tests 53 OK, all tooling tests 128 OK; the open PRs (4.3, 4.4, 3.10, 3.11d) still pass the new check; secret scan clean. The builder rule now follows the human's 19 Oct 2026 decision (1 Opus + 1 Sonnet builder at once).

## Findings
- [HIGH] [fixed] .claude/skills/merge-gate/merge_gate.py — the gate never read the handoff's Status, so a PARTIAL or BLOCKED handoff with an approving review would pass. It now requires DONE.
- [MEDIUM] [fixed] .claude/skills/team-lead/SKILL.md — a fresh fixer for safety-path findings could lose the reviewer's reasoning; the brief now includes the full review file to read.
- [LOW] [fixed] .claude/agents/tdd-guide.md, build-error-resolver.md — a PARTIAL handoff still needs the full test run green and a clean secret scan before its commit.
