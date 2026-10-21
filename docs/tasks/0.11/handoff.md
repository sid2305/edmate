# Handoff: Task 0.11 — Agent files follow the lead-approved merge policy and the English-only pilot

Status: DONE
Branch: m7/0.11-agent-policy
Worktree: .claude/worktrees/agent-ab348575391b1d9f7

## Acceptance evidence
- `python3 -m unittest discover .claude/tests` → `Ran 150 tests in 51.607s` / `OK`
- `python3 .githooks/secret-scan.py --all` → clean (no output, exit 0)
- `grep -rni "human approval\|human-approved\|prepares the human" .claude/agents .claude/skills/locale-context` → no matches

## Changes
- `.claude/agents/safety-reviewer.md`: description and intro paragraph no longer say the agent "prepares the human sign-off"; now say the team lead decides the merge (rule 6), while prompt packs, skill templates and persona templates still need a named human's sign-off (rule 7), and the lead may sign eval cases during the MVP. "For the human approver" / "HUMAN APPROVAL REQUIRED" replaced with "For the lead" and language that the lead decides the merge per the merge gate.
- `.claude/agents/eval-author.md`: description, `reviewed_by` template field and language-mix guidance updated for the English-only pilot (18 Oct 2026): default suites are English only; safety and guard cases keep Hindi, Devanagari and Hinglish input as a safety net. `reviewed_by: pending` → `reviewed_by: lead` (MVP first; a named human may still co-review).
- `.claude/agents/pedagogy-author.md`: language rule now says packs are written in English only during the pilot; the named-human reviewer requirement (`reviewed_by: pending`, rule 7) is unchanged.
- `.claude/skills/locale-context/SKILL.md`: description and the India section note the English-only pilot, with safety eval cases keeping Hindi/Hinglish input for guard testing.

No edits to `.claude/settings.json` or `.claude/hooks/*`. No names or contact details added.

## Decisions

### 20 Oct 2026 · 0.11 Agent files follow the lead-approved merge policy, MVP-first eval sign-off and the English-only pilot · decided by tdd-guide · risk: high
Decided: Updated safety-reviewer, eval-author, pedagogy-author and the locale-context skill so no agent file tells reviewers to require human approval; the lead decides every merge per rule 6, and logs it. Prompt packs, skill templates and persona templates still need a named human's sign-off (rule 7); during the MVP the lead signs eval cases (`reviewed_by: lead`). Default eval, pedagogy and locale-context guidance is English only for the pilot (18 Oct 2026 decision); safety and guard eval cases keep Hindi, Devanagari and Hinglish input as a safety net.
Why: These three decisions (lead-approved merge policy, English-only pilot, MVP-first eval sign-off) were made in the decision log and MEMORY.md but several agent files still referenced the old human-sign-off and multilingual-by-default language, which would mislead agents reading their own instructions.
