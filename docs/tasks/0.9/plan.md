# 0.9 plan — secret scan of every PR commit with main's scanner
Written by the team lead (small, fully specified task; no planner run). Board: `board.py show 0.9`.

## Acceptance
"The required checks block a PR with a failing test; a PR that adds a secret in one commit and removes it later fails CI."
- Part 1 (branch protection) was applied by the lead on 18 Oct 2026: required checks `node`, `python-harness`, `check`; no force-push or deletion; owner can push main. Show it in the handoff with `gh api repos/sid2305/edmate/branches/main/protection --jq .required_status_checks.contexts`.
- Part 2: new job `secrets` in `.github/workflows/ci.yml` (job name must stay distinct from the required ones), on `pull_request` only:
  - checkout with `fetch-depth: 0`;
  - take the scanner and allow list from main: `git show origin/main:.githooks/secret-scan.py` and the allow list file, into `$RUNNER_TEMP`;
  - for every commit in `origin/main..HEAD` (`git rev-list`), scan the files that commit changed, as of that commit (`git show <sha>:<path>`), with main's scanner; fail on any hit, naming the commit and path (no secret value in the log);
  - keep the existing final-tree scan in `python-harness`.
  - If the scanner can't take content on stdin, write each file to a temp dir with its relative path and scan that dir; don't change the scanner's behaviour for local use.
- Add `secrets` to branch protection's required checks after merge (lead).

## Files
`.github/workflows/ci.yml`, `.claude/tests/test_workflows.py` (assert the job exists, uses main's scanner, fetch-depth 0, minimal permissions, actions pinned by SHA), optionally a small stdlib script `.github/scripts/scan-pr-commits.py` with its own tests under `.claude/tests/`. Out of bounds: `.claude/hooks/*`, `.claude/settings.json`, `.githooks/*` (main's copy is what runs).

## Tests first
A temp-repo test: commit a fake token (use an obviously fake value with the scanner's `secret-scan: allow` rules NOT applied — e.g. a string the scanner flags), then a commit deleting it; the per-commit scan fails; a clean history passes.

## Risky paths
`.github/**` and `.claude/**` (tests): reviewer `security-reviewer`; handoff needs a `risk: high` decision.
