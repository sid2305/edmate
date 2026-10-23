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

None.

Tool calls used: 18
