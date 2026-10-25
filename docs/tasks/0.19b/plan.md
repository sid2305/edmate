# 0.19b plan: closeout.py checks Decided: lines before it appends

Written by the lead (a small tooling change; no planner run).

## Acceptance (board)
A test: a handoff whose entry has no Decided: line leaves docs/decisions/log.md unchanged.

### How it is shown (paste into handoff.md)
- New tests in .claude/tests/test_closeout.py:
  - A handoff with two `###` entries, one missing its `Decided:` line, makes closeout exit 1, print which heading lacks the line, and leave `docs/decisions/log.md` byte-for-byte unchanged. The board stays not done.
  - Fixing the handoff and re-running then appends both entries, so the bad entry is no longer skipped as a duplicate (the 7.3 failure).
  - A bullet-prefixed `- Decided:` and a bare `Decided:` are both accepted, the same as board.py's `DECIDED_LINE`.
- The existing test_closeout.py cases stay green: `PYTHONDONTWRITEBYTECODE=1 python3 -m unittest discover -s .claude/tests`. `python3 .githooks/secret-scan.py --all` is clean.

## Design
In `.claude/skills/team-lead/closeout.py`:
- Add `DECIDED_LINE = re.compile(r"^[ \t]*[-*\d.]*[ \t]*Decided:")`, with a comment that it mirrors `.claude/skills/board/board.py`'s `DECIDED_LINE` and must stay in step with it. Don't import board.py.
- Add `entries_missing_decided(body) -> list[str]`, which returns the heading of every `decision_entries(body)` entry that has no line matching `DECIDED_LINE` (use `re.M` or check per line).
- In `main()`, read the handoff, then check before `append_decision_entries`. Skip the check when the body is None or "None". If any heading is missing its line, print `<id>: decision entry "<heading>" has no 'Decided:' line; nothing appended, board unchanged` for each one and return 1. Nothing is written.
- Update the module docstring's step 1 to say entries are checked first.

## Files to create/modify
- .claude/skills/team-lead/closeout.py
- .claude/tests/test_closeout.py
- docs/tasks/0.19b/handoff.md

## Files out of bounds
Everything else, including .claude/settings.json, hooks, .claude/skills/board/** and .claude/skills/merge-gate/**. Never write a `__pycache__` folder into .claude: run python with `PYTHONDONTWRITEBYTECODE=1`.

## Risky paths touched (checked against `.claude/skills/merge-gate/risk-paths.txt`)
`.claude/**` → security-reviewer. The lead logs a `risk: high` decision.

## Questions
None.

## Budget
30 tool calls; stop at 40.
