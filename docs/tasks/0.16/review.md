# 0.16 review — APPROVE

Reviewers: code-reviewer (sonnet), security-reviewer (sonnet)

Closeout now records each task's agent metrics: tool calls, tokens, wall time, phases, fix rounds, findings by severity, blockers and models. `board.py metrics` prints a table for the last N done tasks. Only counted numbers reach the board; a marker test proves that no transcript text, paths or ids leak. Fix round 1 (opus) fixed every finding, and both reviewers re-checked their own: 185 tests pass.

## Findings
- [HIGH] [fixed] .claude/skills/team-lead/metrics.py:15 — the status bracket allowed letters only, so `[deferred 0.13a]` findings were dropped; now the first word of any bracket is used
- [HIGH] [fixed] .claude/skills/team-lead/metrics.py:36 — the cwd fallback was a plain substring, so 0.1 and 0.16 collided; now boundary-aware
- [MEDIUM] [fixed] .claude/skills/board/board.py:168 — `set --metrics` wrote any JSON; now there's a key allow-list with size and depth limits
- [MEDIUM] [fixed] .claude/skills/team-lead/metrics.py:67 — symlinked transcripts could point outside the folder; now skipped
- [LOW] [fixed] .claude/skills/team-lead/closeout.py:172 — the error print could show a home path; now prints the type name only
- [LOW] [fixed] .claude/skills/team-lead/metrics.py:40 — the whole transcript was read into memory; now streamed line by line
