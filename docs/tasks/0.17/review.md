# 0.17 review — APPROVE

Reviewers: security-reviewer (sonnet), code-reviewer (sonnet)

## Findings

- [HIGH] [fixed] .claude/skills/merge-gate/merge_gate.py:62 — the budget regex needed a literal `Budget: N tool calls` line, so every real `## Budget` section ("~70 tool calls", "About 50 tool calls") was skipped silently, including 0.17's own plan. Fix round 1 parses the section, tolerates ~/About/bold/bullets, and fails visibly when a budget or count is present but unparseable. Re-checked by security-reviewer: 4 of 4 real Budget sections parse, 0 unparseable.
- [MEDIUM] [fixed] .claude/skills/merge-gate/merge_gate.py — has_budget_decision accepted any heading with "budget"; it now also requires "decided by lead", and SKILL.md says the lead writes and reads it.
- [MEDIUM] [deferred 0.17a] .claude/skills/merge-gate/merge_gate.py:188 — the section fallback takes the first "N ... calls" number in the `## Budget` prose, so a decoy number (another task's count, an old estimate) can set the cap too high or too low.
- [LOW] [wontfix] .claude/skills/merge-gate/merge_gate.py:63 — the handoff count line is parsed only for handoffs written after 0.17; builders are told the exact wording.
- [LOW] [wontfix] .claude/skills/merge-gate/merge_gate.py — cap*1.2 float boundary; exactly 1.2x is a note, as intended.
