# 0.16a plan: metrics find the subagent transcripts

READY (lead plan; a small follow-up to 0.16).

## Acceptance (board)
- A fixture with a session dir and `subagents/` files counts the right agents for each task.
- 0.1 and 0.16 stay separate.
- Closeout on a real merged task records non-zero tool calls.
- No transcript text lands on the board.

## What's wrong
- **Missed files:** `metrics.iter_entries` globs only `<projects dir>/*.jsonl`. Claude Code writes each subagent's transcript to `<projects dir>/<session-id>/subagents/agent-<id>.jsonl`.
- **Missed branches:** matching by `gitBranch == task branch` misses builders, which run on `work-<id>` or `work-<id><letter>` (e.g. `work-0.16f`, `work-5.7b`). It also misses reviewers, which run from the main checkout. A single builder file can show several branches over its life, e.g. `main` before its checkout.

## Steps (tests first)
1. **Read subagent files.** `iter_entries` (or a new `iter_files`) also reads `<dir>/*/subagents/*.jsonl`. It keeps the symlink skip and stays inside the dir.
2. **Attribute a whole subagent file to one task** when either holds:
   - its first user message (the prompt) names the task id with a boundary: `task <id>` or `Edmate task <id>`, where the id isn't followed by a digit or a dot-digit, so 0.1 never matches 0.16;
   - any entry's gitBranch is the task branch, or matches `work-<id>` with an optional single trailing lowercase letter.
   The prompt text is used only for matching and never stored.
3. **Lead session files** (top level) keep today's per-entry branch matching.
4. **Fixture:** a session dir with 2 subagent files (task 0.16 builder on `work-0.16f`, a reviewer whose prompt says "task 0.1") and one top-level file. Assert the counts per task.
5. After merge the lead re-runs closeout's metrics for 0.16 by hand: `board.py set 0.16 done --metrics <file>`.

## Files
`.claude/skills/team-lead/metrics.py`, `.claude/tests/test_metrics.py`, `.claude/tests/fixtures/**`, docs/tasks/0.16a/handoff.md.

## Out of bounds
.claude/settings.json, .claude/hooks/**, board.py and closeout.py (unless a one-line call change is needed).

## Risky paths
`.claude/**` needs security-reviewer. The handoff logs `risk: high` (the lead adds it).

## Budget
About 40 builder calls, one phase.
