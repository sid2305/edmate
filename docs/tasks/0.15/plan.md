# 0.15 · Token budget for the agent team

Drafted 19 Oct 2026 in a side session at the human's request ("analyse the agents' token consumption … draft the changes"), not by the planner.

## Why
A measurement of every model call in this project's transcripts (11,900 calls: the lead plus 254 subagents) found:
- 72% of usage is re-reading context (cached input), 19% cache writes, 9% output.
- First builds were 47% of usage, the lead 28%, fix rounds 10%, reviews 7%, planning 7%.
- Builders ran 100–300 tool calls in one context that grew to 400–630k tokens (the 1M window never triggers auto-compaction). The 4.4 builder processed 107M tokens to write 81k.
- The lead averaged 434k tokens of context per call (peak 967k) and was woken by 281 completion notices.
- Calls with more than 200k tokens of context were 60% of usage.
Weights: API price ratios (Opus 5x, Sonnet 3x, cache reads 0.1x), a stand-in for subscription metering.

## Acceptance
- Builders (`tdd-guide`, `build-error-resolver`) work in fewer, bigger calls, run narrow tests while iterating, and stop at about 150 calls with `Status: PARTIAL`.
- The planner splits big tasks into phases, each built by a fresh builder.
- The team-lead skill: fresh fixer per fix round (not SendMessage to a large builder), at most 2 builders at once, short returns, and the lead keeps its own context small.
- Model and effort for coding stay as the human decided (Opus 5.5, medium).

## Files
- `.claude/agents/tdd-guide.md`, `.claude/agents/build-error-resolver.md`: token-budget notes; handoff Status gains PARTIAL.
- `.claude/agents/planner.md`: build sizing and phases.
- `.claude/skills/team-lead/SKILL.md`: Token budget section replaces "Other ways to save tokens"; fix step and parallelism updated.
- `.claude/settings.json`: `env.CLAUDE_CODE_AUTO_COMPACT_WINDOW = "200000"`, so every session (lead and subagents) compacts at 200k tokens instead of near 1M. A simulation on the recorded calls: a 200k cap leaves about 63% of today's usage, 250k about 69%, 150k about 57%; 200k is also the standard window and stays under any long-context price premium.

## Risky paths touched
`.claude/**` → reviewers: security-reviewer. Needs a `risk: high` decision entry.

## Overlap
Task 0.13 also edits the team-lead skill (fix-round policy, batched board commits). Whichever lands second rebases.
