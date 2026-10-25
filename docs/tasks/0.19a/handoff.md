# 0.19a handoff

**Status:** DONE

## What changed
- `.claude/skills/team-lead/closeout.py`: `main()` now runs `board.py digest` right after
  `board.py set <id> done` succeeds (before worktree/branch cleanup). On success the digest is
  silently regenerated. On failure it prints `could not regenerate docs/decisions/digest.md: <its
  output>`, still runs the worktree/branch cleanup, and the command's final return value is `1`
  instead of `0` -- but the board change (now `status: done`) is never undone. Updated the module
  docstring's numbered steps (and exit-code note) to describe the new step 4.
- `.claude/tests/test_closeout.py`: new `DigestRegeneration` test class with two tests (below).
  No fixture changes were needed in `.claude/tests/helpers.py`: `digest.py` was already copied
  into the temp repo fixture by `helpers.SCRIPTS`.

## Evidence
- "A new test in .claude/tests/test_closeout.py: after a closeout that appends a decision,
  docs/decisions/digest.md in the temp repo equals what board.py digest renders ... and includes
  the new entry when the entry belongs in the digest" ->
  `test_closeout.DigestRegeneration.test_digest_matches_board_digest_render_and_includes_new_entry`
  (uses a `risk: high` lead decision, which `digest.in_digest` keeps; compares the written
  `digest.md` byte-for-byte against `digest.render_digest(digest.parse_log_entries(log_text))`
  and asserts the new heading appears).
- "A test that a failing board.py digest makes closeout print the reason and exit non-zero after
  the board is already set to done ... and does not undo the board change" ->
  `test_closeout.DigestRegeneration.test_digest_failure_prints_reason_after_board_done_and_keeps_board_change`
  (a `docs/decisions/standing-rules.md` bullet citing a heading no entry has makes
  `board.py digest` refuse to write; asserts exit code 1, the
  `could not regenerate docs/decisions/digest.md` message, and `status: done` still present on
  the board).
- `python3 -m unittest discover -v .claude/tests` (exact CI command from
  `.github/workflows/ci.yml`'s python-harness job): `Ran 359 tests in 160.019s` / `OK`, including
  both new `DigestRegeneration` tests and all pre-existing `test_closeout.py` tests green.
- `python3 .githooks/secret-scan.py --all`: clean (no output, exit 0).
- No stray `.claude/**/__pycache__` left behind (ran with `PYTHONDONTWRITEBYTECODE=1`; confirmed
  with `find .claude -name __pycache__`, no matches).

## Decisions

### 25 Oct 2026 · 0.19a closeout.py regenerates the decisions digest (.claude/**) · decided by lead · risk: high
- Decided: merge 0.19a; closeout.py now runs `board.py digest` right after `board.py set <id> done`, prints the reason and exits 1 if the digest fails (the board change stays and cleanup still runs), so the lead no longer runs the digest by hand after each closeout.
- Why: a stale digest failed the RealRepo freshness test in CI for every later PR; security-reviewer approved with no findings (argument-list subprocess call with no task-id input, no hook or settings change).

## Budget
Tool calls used: 35 (harness count; the builder self-reported 19)
