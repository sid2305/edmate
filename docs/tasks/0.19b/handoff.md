# 0.19b handoff

**Status:** DONE

## What changed
- `.claude/skills/team-lead/closeout.py`: added `DECIDED_LINE` (mirrors `board.py`'s regex,
  with a comment saying so) and `entries_missing_decided(body)`. `main()` now checks every
  `## Decisions` entry for a `Decided:` line before calling `append_decision_entries`; if any
  entry is missing one, it prints `<id>: decision entry "<heading>" has no 'Decided:' line;
  nothing appended, board unchanged` for each missing entry and returns 1 without writing
  anything. The check is skipped when the Decisions body is missing or "None". Updated the
  module docstring's step 1 to describe the check.
- `.claude/tests/test_closeout.py`: added a `DecidedLineCheck` test class covering (a) a
  two-entry handoff with one entry missing `Decided:` leaves `docs/decisions/log.md`
  byte-for-byte unchanged, reports the offending heading, and leaves the board not done; (b)
  fixing the handoff and re-running appends both entries (no longer skipped as a duplicate);
  (c) a bullet-prefixed `- Decided:` and a bare `Decided:` are both accepted. Also fixed one
  existing test (`test_fix_round_in_prose_or_h3_is_not_a_heading`) whose fixture put a
  `Decided:`-less `### Fix round notes` block inside the `## Decisions` section (no closing
  `##` heading) -- added a `## Notes` heading to close the Decisions section first, so that
  test stays about the lessons-reminder, not the new check.

## Evidence
- A handoff with two `###` entries, one missing its `Decided:` line, makes closeout exit 1,
  print which heading lacks the line, and leave `docs/decisions/log.md` byte-for-byte
  unchanged. The board stays not done.
  → `test_missing_decided_line_leaves_log_unchanged_and_reports_heading` passes.
- Fixing the handoff and re-running then appends both entries, so the bad entry is no longer
  skipped as a duplicate (the 7.3 failure).
  → `test_fixing_handoff_then_appends_both_entries` passes.
- A bullet-prefixed `- Decided:` and a bare `Decided:` are both accepted, the same as
  board.py's `DECIDED_LINE`.
  → `test_bullet_and_bare_decided_both_accepted` passes.
- The existing test_closeout.py cases stay green:
  `PYTHONDONTWRITEBYTECODE=1 python3 -m unittest discover -s .claude/tests`
  → `Ran 362 tests in 71.306s` `OK`
- `python3 .githooks/secret-scan.py --all`
  → clean (no output)

## Decisions
None.

## Budget
Tool calls used: 15
