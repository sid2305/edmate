**Status:** DONE

## Summary

`metrics.py`'s `transcripts_dir(repo_root)` derived the transcript directory slug from
`str(repo_root)` without resolving it first. Called with a relative root (e.g. `"."`), the slug
built from the literal string never matched the real `~/.claude/projects/<resolved-path>`
directory Claude Code creates, so `collect(".", ...)` silently returned all zeros instead of
raising or warning.

Fix: `transcripts_dir` now resolves `repo_root` (`Path(repo_root).resolve()`) before building the
slug, and `collect` also resolves `repo_root` up front (belt-and-suspenders, and so every
`repo_root /` path join later in `collect` uses the resolved root too). Checked the other public
entry point, `read_board_ids(repo_root)`: it only joins `repo_root` into a relative file path
(`docs/board/tasks.yaml`), which works the same for `"."` and an absolute root as long as the cwd
matches, so no change was needed there.

## Files

- `.claude/skills/team-lead/metrics.py` — resolve `repo_root` in `transcripts_dir` and `collect`.
- `.claude/tests/test_metrics.py` — new `RepoRootResolution` test case: `transcripts_dir(".")`
  equals `transcripts_dir(<absolute root>)`, and `collect(".", ...)` equals
  `collect(<absolute root>, ...)` and is non-zero (reproduces the bug without the
  `EDMATE_TRANSCRIPTS_DIR` override the rest of the suite uses, since that override bypasses the
  slug derivation entirely).

## Tests (acceptance evidence)

```
$ python3 -m unittest discover -v .claude/tests
...
test_collect_dot_matches_absolute_and_is_non_zero (test_metrics.RepoRootResolution...) ... ok
test_transcripts_dir_matches_for_dot_and_absolute (test_metrics.RepoRootResolution...) ... ok
...
----------------------------------------------------------------------
Ran 357 tests in 193.886s

OK
```

```
$ python3 .githooks/secret-scan.py --all
(no output, exit 0)
```

## Decisions

### 22 Oct 2026 · 0.16b ran over budget · decided by lead · risk: low
- Decided: accept 30 tool calls against a 15-call budget; the fix is two lines plus a test and both reviews approve it.
- Why: the builder counted 18; the harness counted 30 (setup, the full 357-test suite and the secret scan). A two-line fix doesn't justify a second round.
- risk: low

### 22 Oct 2026 · .claude/skills/team-lead/metrics.py root resolution approved · decided by lead · risk: high
- Decided: merge the `.resolve()` change in .claude/skills/team-lead/metrics.py (a `.claude/**` risk path) with security-reviewer and code-reviewer approval.
- Why: it only normalises repo_root before deriving the transcript slug; no shell-outs, no new file reads, and the tests use a temp home, never the real ~/.claude.
- risk: high

### 22 Oct 2026 · task_id path join in .claude/skills/team-lead/metrics.py left as is · decided by lead · risk: low
- Decided: wontfix the security LOW on .claude/skills/team-lead/metrics.py collect(): it joins docs/tasks/<task_id> without checking task_id.
- Why: the code is older than this task, and task_id comes only from the lead's board and CLI, never from outside input; a read stays inside the repo and only feeds counts.
- risk: low

Tool calls used: 30 (harness count: builder 30; the agent reported 18)
