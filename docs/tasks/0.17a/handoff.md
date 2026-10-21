# 0.17a handoff: anchor the merge gate's budget parse

Status: DONE

## Summary
`budget_cap` in `.claude/skills/merge-gate/merge_gate.py` now:
1. Matches the heading form `## Budget: N tool calls` / `### Budget: N tool calls` (not just a
   bare `Budget: N tool calls` line), via an updated `BUDGET_LINE` regex that allows an optional
   leading `#{2,3} ` prefix.
2. Falls back to scanning only the first non-blank line of a `## Budget` section for an
   `<N> ... calls` number, instead of the whole section's prose. A decoy count elsewhere in the
   section (another task's total, an old estimate) can no longer set the cap. If the first line
   has no such number, the result is UNPARSEABLE (a visible FAIL), even if a number exists later
   in the section.
3. Docstring updated to describe both the `Budget:` line (plain or heading form) and the
   first-line-only fallback.

## Acceptance evidence
```
$ python3 -m unittest discover .claude/tests
Ran 264 tests in 62.676s

OK
```
```
$ python3 .githooks/secret-scan.py --all
(exit 0, no findings)
```

## Changes
- `.claude/skills/merge-gate/merge_gate.py`: `BUDGET_LINE` regex now also matches the `## Budget:
  N tool calls` heading form; `budget_cap` fallback reads only the section's first non-blank line
  (not the whole section) for its `<N> ... calls` number; docstring updated.
- `.claude/tests/test_merge_gate.py`: added tests for the heading form, a decoy number after the
  real first-line statement, a decoy number before a winning `Budget:` line, a decoy number before
  the first line when there is no `Budget:` line (first line's own number is used), and a first
  line with no number followed by a later prose number (UNPARSEABLE).

## Decisions
### 21 Oct 2026 · 0.17a merge-gate budget parse · risk: high
Decided: tightened `budget_cap`'s fallback to the `## Budget` section's first non-blank line only,
and added the `## Budget: N tool calls` heading form to `BUDGET_LINE`, per plan. No behaviour
change for plans that already use a plain `Budget: N tool calls` line or a single-line `## Budget`
section (the common cases); only multi-line `## Budget` sections with a decoy number are affected.

Tool calls used: 14
