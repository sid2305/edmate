# 0.17a plan: anchor the merge gate's budget parse

Status: READY (small plan by the lead, 21 Oct 2026)

## Scope
Only `.claude/skills/merge-gate/merge_gate.py` and `.claude/tests/test_merge_gate.py`.

Today `budget_cap` (`merge_gate.py:170`) first looks for a `Budget: N tool calls` line anywhere in the plan (`BUDGET_LINE`, line 66). Failing that, it takes the first "N ... calls" number anywhere in the `## Budget` section's prose (`BUDGET_SECTION_NUM`). So a decoy number in the prose, such as another task's count or an old estimate, can set the cap. Also, the heading form `## Budget: 30 tool calls` (used by the 7.1 and 6.2 plans) fails as UNPARSEABLE, because `BUDGET_LINE` does not allow a leading `#` and `section()` drops the heading line.

Change:
1. `BUDGET_LINE` also matches the heading form: `^#{2,3}[ \t]+Budget[ \t]*:[ \t]*N tool calls`.
2. The fallback reads only the first non-blank line of the `## Budget` section, not the whole section. If that line has no "N ... calls" number, the result is UNPARSEABLE (a visible FAIL), never a number taken from later prose.
3. Update the `budget_cap` docstring to match.

## Tests (red first)
- Heading form `## Budget: 30 tool calls` returns 30.
- Decoy after the real statement: the first line is "About 40 tool calls.", followed by prose that mentions "6.2 took 55 calls". The result is 40.
- Decoy before the real statement: the first line says "Like 6.2 (55 calls) ..." and a later line says "Budget: 30 tool calls". The `Budget:` line wins, so the result is 30. With no `Budget:` line, the first line's number is used, as documented.
- First line with no number, and a number later in the prose: UNPARSEABLE.
- All existing budget tests still pass (`Budget: N tool calls` on its own line; no section means None).
- Run `python3 -m unittest discover .claude/tests` and the secret scan.

## Risk paths
`.claude/**` → security-reviewer (plus code-reviewer). The handoff logs a `risk: high` decision, which the lead finalises.

## Budget
Budget: 30 tool calls
