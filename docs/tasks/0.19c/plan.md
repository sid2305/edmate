# Plan: 0.19c — the merge gate accepts task ids with a word after the dot

Status: READY (lead-written, 25 Oct 2026)

## Problem
`merge_gate.py --pr <n>` gets the task id from the PR branch name with `re.match(r"m\d+/(\d+\.\d+[a-z]*)", branch)`. That appears twice, at merge_gate.py:472 (pr_head) and :504 (main). The pattern needs a digit right after the dot. The board already has M13 tasks whose ids put a word there (`13.skillpresent`, `13.regate`), so their PR branches can never pass the required `Merge gate / check` on GitHub. PR #276 (`m13/13.skillpresent-a-harness-events`) is blocked by this. The local `merge_gate.py <id>` path reads the branch from the board, so it never hit the problem.

## Change
1. In `.claude/skills/merge-gate/merge_gate.py`, define one module-level pattern, e.g. `TASK_BRANCH = re.compile(r"m\d+/(\d+\.[0-9a-z]+)-")`, and use it at both call sites. The slug after the hyphen stays required (the documented `m<milestone>/<task-id>-<slug>` shape), and ids never contain a hyphen. Keep the comment explaining which id shapes are accepted (3.11d, 13.skillpresent).
2. Leave the `board.py:74` sort key alone; it already sends non-numeric ids to the end.

## Tests (`.claude/tests/test_merge_gate.py`)
Accepted (and the task id extracted):
- `m3/3.11d-foo` → `3.11d`
- `m13/13.skillpresent-a-harness-events` → `13.skillpresent`
- `m13/0.19c-gate-word-ids` → `0.19c`

Rejected with the existing "is not m<milestone>/<task-id>-<slug>" message:
- `feature/x`
- `m13/13.skillpresent` (no slug)
- `m13/.5-x`

Follow the existing test style for `--pr` (look at how the current tests stub `gh`). If pr_head can't be reached without a heavy stub, test the module-level pattern directly and add a single `--pr` case.

## Files
- `.claude/skills/merge-gate/merge_gate.py`
- `.claude/tests/test_merge_gate.py`
- `docs/tasks/0.19c/handoff.md`

Out of bounds: every other file. In particular `.claude/settings.json`, hooks, `.github/**` and board.py.

## Gate
`python3 -m pytest .claude/tests -q` (all green), then `python3 .githooks/secret-scan.py --all`.

## Risk and reviewers
`.claude/**` is a risk path, so security-reviewer is required. The builder logs a risk: low decision about the pattern. The lead adds the risk: high merge decision.

## Budget
20 tool calls; stop at 26.
