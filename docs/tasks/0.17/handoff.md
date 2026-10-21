# 0.17 handoff

**Status:** DONE

## Files
- `.claude/skills/merge-gate/merge_gate.py` — check 6: `budget_cap()`/`tool_calls_used()`/`has_budget_decision()` helpers; parses the plan's `Budget: <N> tool calls` line and the handoff's `Tool calls used: <M>` line (both via `show()`, so lettered sub-tasks with their own `docs/tasks/<id>/` read correctly). Missing either side is a silent skip (note, no fail — old plans/handoffs stay compatible). `M > 1.2x N` fails unless the handoff's `## Decisions` has a `### ... <task-id> ... budget ...` entry (same escape pattern as `[wontfix]`), in which case it's a note instead. `N < M <= 1.2x N` is always a note. Docstring's numbered check list updated to add item 6.
- `.claude/tests/test_merge_gate.py` — new `BudgetCheck` class, 4 cases: no `Budget:` line (no note, pass), within cap (no note, pass), over 1.2x cap with no decision (fails, names both numbers), over 1.2x cap with a lead decision entry (passes, logs an overrun note).
- `.claude/agents/planner.md` — Edmate notes: plan.md must carry `## Budget` (`Budget: <N> tool calls (<phases>, <packages>)`, whole-task total), `## Allowed tools`, `## Exit conditions`; "Size the build" paragraph now points at these named fields.
- `.claude/agents/tdd-guide.md`, `.claude/agents/build-error-resolver.md` — new bullet under Token budget: read the plan's `Budget:` line as the real cap (fallback ~150 for old plans), report `Tool calls used: <N>` in the handoff.

## Tests
- `python3 -m unittest .claude.tests.test_merge_gate` (run from `.claude/tests`, as `test_merge_gate`): 65 tests, OK — includes the 4 new `BudgetCheck` cases (absent / within cap / over-and-failing / over-with-lead-decision), confirmed red before the implementation (2 of 4 failing) then green after.
- `python3 -m unittest discover .claude/tests`: 189 tests, OK (full suite, no regressions).
- `python3 .githooks/secret-scan.py --all`: clean (no output, exit 0).

Tool calls used: 24

## Fix round 1
Both reviewers flagged the budget check: `BUDGET_LINE`/`TOOL_CALLS_USED_LINE` only matched a literal `Budget: N tool calls` line, but real plans write a `## Budget` section with prose (`~70 tool calls`, `About 50 tool calls`, `about 30 tool calls`) that silently skipped check 6. Fixed:
- `budget_cap()` now falls back to the first `<N> ... calls` number inside a `## Budget` section (new `BUDGET_SECTION_NUM` regex, tolerant of `~`/`About`/`about`) when no literal `Budget:` line matches. A `## Budget` section with no parseable number returns a new `UNPARSEABLE` sentinel, which `evaluate()` turns into a visible FAIL (chosen over a silent note, since the section is clearly there and its intent unmet).
- `tool_calls_used()` same treatment: a `Tool calls used:` phrase with no parseable number is `UNPARSEABLE` -> FAIL. Both lines are now bold/bullet tolerant (`[ \t*]*` between the label, colon and number, so `**Budget:** 50` and `- **Tool calls used:** 70` both parse).
- `has_budget_decision()` now also requires `decided by lead` in the heading (not just the task id and the word "budget"), matching the risk:high decision pattern elsewhere in the gate.
- `.claude/skills/merge-gate/SKILL.md`: one line noting the lead writes and reads the `### ... budget ... decided by lead ...` heading.
- `.claude/tests/test_merge_gate.py`: 11 new `BudgetCheck` cases (decision missing "decided by lead", each real prose phrasing, bold forms, section-present-unparseable, tool-calls-used-present-unparseable).

Tests: `python3 -m unittest discover .claude/tests`: 198 tests, OK. `python3 .githooks/secret-scan.py --all`: clean.

Tool calls used: 18

## Open question 1 — the hard automatic stop (not shipped; human decision B-35, default option a)

Per the lead's answer, the human owns `.claude/hooks/*` and `.claude/settings.json`; this task does not touch them. Proposed design, ready to apply:

- New hook script `.claude/hooks/budget-guard.sh`, registered as a `PreToolUse` hook on all tool matchers in `.claude/settings.json`.
- On each tool call it reads the current task id from the worktree/branch name (`m<ms>/<id>-<slug>`), reads that task's `Budget: <N> tool calls` line from `docs/tasks/<id>/plan.md`, and keeps a per-session call count in a scratch file (e.g. under the worktree's `.claude/` scratch area, keyed by session id).
- Once the running count passes `N * 1.2` (the same tolerance the merge-gate check uses, so a builder mid-edit at the gate's threshold isn't surprised by a stricter hook threshold), the hook exits non-zero with a message telling the agent to reach a green, committed state and write `Status: PARTIAL`.
- A missing `Budget:` line (old-style plan) disables the hook for that session (no cap to enforce) — consistent with merge_gate.py's "missing is a silent skip" rule.
- This is additive: everything this task ships (the plan/handoff fields, the `Tool calls used:` report, the merge_gate.py check and its tests) works today regardless of whether/when the human wires this hook in.

## Decisions

### 21 Oct 2026 · 0.17 Budget overrun escape hatch is a note, not silent · decided by lead · risk: high
Decided: merge_gate.py's budget check fails a handoff whose reported tool-call count exceeds 1.2x the plan's cap, unless the handoff's `## Decisions` names the task id and the word "budget" in a heading — mirroring the existing `[wontfix]` escape pattern used elsewhere in the gate. A missing `Budget:` or `Tool calls used:` line is always a silent no-op (note, never fail), so every plan/handoff written before this task keeps passing the gate unchanged.
