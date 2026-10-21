# 0.19 review — APPROVE

Reviewers: code-reviewer (sonnet), security-reviewer (sonnet)

Both reviewers ran on the Phase B branch; fix round 1 (opus) addressed both MEDIUMs and the LOW. 323 tests pass, the secret scan is clean, and `docs/decisions/log.md` is unchanged.

## Findings

- [MEDIUM] [fixed] .claude/skills/board/digest.py — `_WHO` read one word, so "decided by team lead" and "decided by the team lead" risk: high entries were dropped from the digest, and the freshness test used `in_digest` as its own truth. Now every who-form in the log maps to a known role (`KNOWN_WHO`), with RealRepo checks that don't go through `in_digest`.
- [MEDIUM] [fixed] .claude/skills/board/board.py:24 — the `digest` help text described the Phase A scope; it now describes lead answer 6.
- [LOW] [fixed] .claude/skills/board/digest.py — a wrapped `Decided:` line cut the 1.7f summary mid-sentence; wrapped lines are joined first.
