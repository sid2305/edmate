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
(see "## Fix round 1" below for the fix round's own evidence, after which 267 tests pass)

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

## Fix round 1
security-reviewer found the first fix still let `BUDGET_LINE.search()` (a whole-document search)
match a `## Budget: N tool calls` heading (or a plain `Budget: N tool calls` line) *anywhere* in
plan.md — a decoy quoted example, one inside a fenced code block, or an earlier unrelated line —
and `.search()` always returns the leftmost match, so the decoy could beat the real `## Budget`
section's own statement.

Fix:
1. Added `unfenced(text)` (same fence-tracking convention as `reviewer_names()`): blanks out the
   contents of ``` / ~~~ fenced code blocks before any Budget regex runs, so a quoted example or
   code sample never counts as real document structure.
2. `section()` and the new `section_heading_line()` now search the fence-stripped text and return
   the section's own heading line text.
3. `budget_cap` now looks **inside the real `## Budget` section only** (its own heading line →
   else an explicit `Budget: N tool calls` line anywhere in its unfenced body → else the first
   unfenced non-blank line's `<N> ... calls` number → else UNPARSEABLE). A whole-document
   `Budget:` line (outside fences) is now used only when the plan has **no** `## Budget` section
   at all — closing both the HIGH (heading decoy) and the LOW (plain-line decoy) findings with one
   change, since a decoy elsewhere in the document is simply never considered once the real
   section exists.

Tests added (red before the fix, green after):
- `test_decoy_heading_before_real_section_in_fence_ignored` — a fenced `## Budget: 999 tool
  calls` example before the real `## Budget` section; cap is 30, not 999.
- `test_decoy_inside_fence_within_section_ignored` — a fenced `Budget: 999 tool calls` line
  inside the real section's own body; cap is 30, not 999.
- `test_decoy_plain_budget_line_before_section_ignored` — a plain `Budget: 999 tool calls` line
  before the real `## Budget` section; cap is 30, not 999.
All pre-existing budget tests (heading form, decoy-after, decoy-before-with-`Budget:`-line,
decoy-before-no-`Budget:`-line, first-line-unparseable) still pass unchanged.

Checked every `docs/tasks/*/plan.md` on main: wrote a script that computes `budget_cap` with both
the pre-fix-round and post-fix-round logic and diffs the results — 0 plans changed cap.

```
$ python3 -m unittest discover .claude/tests
Ran 267 tests in 58.720s

OK
```
```
$ python3 .githooks/secret-scan.py --all
(exit 0, no findings)
```

Tool calls used: 14 (0.17a) + 19 (fix round 1) = 33
