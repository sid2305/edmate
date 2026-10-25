**Status:** DONE

## What changed
- `.claude/skills/merge-gate/merge_gate.py`: replaced the two inline `re.match(r"m\d+/(\d+\.\d+[a-z]*)", branch)` calls (in `pr_head` and `main`) with a single module-level `TASK_BRANCH = re.compile(r"m\d+/(\d+\.[0-9a-z]+)-")`, defined next to the other module-level patterns. This accepts a word after the dot (`13.skillpresent`) as well as the existing digit/letter shapes (`3.11d`), and keeps the required trailing `-` (slug) so a branch with no slug is still rejected.
- `.claude/tests/test_merge_gate.py`: added `TaskBranchPatternTest` (direct pattern checks via `_load_gate()`, matching the file's existing fixture-free style) covering the accepted ids (`3.11d`, `13.skillpresent`, `0.19c`) and rejected branches (`feature/x`, no-slug, `m13/.5-x`), plus `PrModeWordTaskIdTest` exercising the `--pr` path end to end with a `13.skillpresent` branch to confirm it now passes the gate.

## Evidence
Tests added:
- `TaskBranchPatternTest.test_accepts_digit_letter_and_word_ids`
- `TaskBranchPatternTest.test_rejects_malformed_branches`
- `PrModeWordTaskIdTest.test_pr_branch_with_word_task_id_passes`

```
$ python3 -m pytest .claude/tests -q
365 passed, 131 subtests passed in 78.44s (0:01:18)
```

```
$ python3 .githooks/secret-scan.py --all
(no output — clean)
```

## Decisions
### 25 Oct 2026 · 0.19c the merge gate accepts task ids with a word after the dot · decided by builder · risk: low
- Decided: Use one module-level pattern `TASK_BRANCH = re.compile(r"m\d+/(\d+\.[0-9a-z]+)-")` for both `pr_head` and `main`'s branch parsing, keeping the trailing `-` (slug) required.
- Why: The plan calls for exactly this; a single shared pattern avoids the two call sites drifting again, and keeping the slug required matches the documented `m<milestone>/<task-id>-<slug>` branch shape so a slug-less branch (`m13/13.skillpresent`) still fails with the existing message.

## Budget
Tool calls used: 15
