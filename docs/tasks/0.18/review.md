# 0.18 review — APPROVE

Reviewers: security-reviewer (sonnet), code-reviewer (sonnet)

## Findings
- [LOW] [wontfix] .claude/skills/board/registry.py:1 — render() escapes only `|` in table cells. The input is first-party agent files, not untrusted content, so this is accepted.
- [LOW] [wontfix] docs/agents/registry.md:1 — every agent in a role shows the same cost numbers, because the board's model field names roles, not agents. This is the documented limitation (plan Q2, lead answer 2). Per-agent cost needs per-subagent attribution in metrics.py.

## Notes
- Security: the appended blocks are inert data and change no permissions or behaviour. The generator writes only `docs/agents/registry.md` and never saves tasks.yaml.
- Code: the acceptance is met. A fresh clone's `board.py registry` reproduces the table byte for byte; 259 tests pass. Pinning only the Agents section is correct.
