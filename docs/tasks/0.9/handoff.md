# 0.9 handoff: CI scans every PR commit with main's secret scanner

Status: DONE
Branch: `m0/0.9-ci-hardening`
Worktree: `.claude/worktrees/agent-a9d477d138ebde16e`
Risky: yes, `.github/**` and `.claude/**` (tests). Reviewer: `security-reviewer`.

## Acceptance evidence

Part 1, branch protection (applied by the lead):
`gh api repos/sid2305/edmate/branches/main/protection --jq .required_status_checks.contexts`
```
["node","python-harness","check"]
```
`secrets` is still to be added by the lead after merge (the plan says so).

Part 2, harness tests: `python3 -m unittest discover .claude/tests`
```
Ran 122 tests in 41.589s
OK
```
That is 22 new tests in `test_scan_pr_commits.py` plus 2 new and 1 changed test in `test_workflows.py`. Written first: the
new file ran red (20 of 22 failed, since the driver did not exist yet), then green.

The acceptance case is `test_secret_added_then_removed_fails_and_names_commit_and_path`: a temp repo commits a
fake AWS-style key (put together at runtime from pieces, so no committed file holds one), then a commit deletes it.
The final tree is clean, but the per-commit scan exits 1 and names that commit, the path and the finding type.
`test_no_secret_value_or_fragment_in_the_log` checks that neither the value nor the scanner's 6-character masked
prefix shows up in the output. `test_clean_history_passes` covers the clean case.

Local run of the job's logic on this branch, with main's scanner and allow list pulled out by `git show main:...`
into the scratchpad:
`python3 .github/scripts/scan-pr-commits.py --scanner <tmp>/main-scanner/.githooks/secret-scan.py --base main`
```
Scanned 1 commit(s), 4 file version(s), with the given scanner.
```

Root gates: `corepack pnpm install --frozen-lockfile && corepack pnpm turbo run build typecheck lint test`
```
 Tasks:    38 successful, 38 total
```
Secret scan on the changed files: `python3 .githooks/secret-scan.py <the 4 changed files> <this handoff>`, which exits 0
with no output.

## Changes

- `.github/scripts/scan-pr-commits.py` (new, stdlib only). For each commit in `base..head`, oldest first, it lists
  the paths that commit added or changed (`git diff-tree -r -m --root -z`; for a merge it checks against every
  parent, so a secret slipped in while resolving a merge is caught). It writes each blob, as of that commit, into
  a temp dir under its repo-relative path, then runs the given scanner there with relative paths, 200 files per
  call. The scanner reads its allow list from beside itself, so main's list applies, not the PR's.
  Exit codes: 0 clean, 1 findings, 2 error (bad ref, missing scanner, scanner exit other than 0 or 1). It fails
  closed. Findings are printed as `commit <sha>:` then `path:line  Finding type`. The scanner's masked value is
  cut off, any scanner line it can't parse becomes `(finding details hidden)`, and non-printable characters in
  paths are escaped (so a newline in a path can't inject a workflow command). It skips gitlinks. A single file
  named `--all` or `--staged` is passed as `./<name>` so it can't switch the scanner's mode.
- `.github/workflows/ci.yml`: new job `secrets`. It runs only on `pull_request`, with no job-level permissions (so
  it inherits `contents: read`), a 10-minute timeout, and checkout at `fetch-depth: 0` with `persist-credentials:
  false`. It reuses the checkout and setup-python SHAs. It pulls the scanner and allow list from `origin/main` with
  `git show` into `$RUNNER_TEMP/main-scanner/.githooks/` and runs the driver on `origin/main..HEAD`. The
  `python-harness` final-tree scan is unchanged.
- `.claude/tests/test_workflows.py`: the job set is now `{node, python-harness, secrets}`. New tests check the
  `secrets` job's trigger, permissions, fetch depth and credentials, that the scanner, allow list and driver come
  from main, that `set -euo pipefail` is set, and that the tree scan is kept.

## Deviations

- The driver is also taken from main (`git show origin/main:.github/scripts/scan-pr-commits.py`). This PR is the
  only exception: the driver isn't on main yet, so the job falls back to the PR's copy and logs a `::warning::`.
- The plan said "no secret value in the log". The scanner itself prints a 6-character masked prefix, so the driver
  goes further and drops the value completely.
- `HEAD` on a `pull_request` run is GitHub's merge commit, so `origin/main..HEAD` covers every PR commit plus that
  merge commit. This is intended.

## Decisions

### 18 Oct 2026 · 0.9 Per-commit secret scan runs main's scanner, allow list and driver · decided by tdd-guide · risk: high
Decided: A new CI job `secrets` (pull_request only) scans every commit in `origin/main..HEAD`. It uses the scanner and allow list from main (`git show origin/main:...` into `$RUNNER_TEMP`) and the driver `.github/scripts/scan-pr-commits.py`, also from main. The PR that adds the driver is the only one that uses its own copy, and it logs a warning when it does. The output shows commit, path, line and finding type only. Errors fail the job.
Why: A secret deleted in a later commit is still public in the history. Using main's copies stops a PR from weakening the scan of its own commits. It does not cover a PR that edits `ci.yml` itself: that is a `.github/**` risky path, so it needs a security review and a risk: high decision.
Alternatives: Use the PR's own driver every time (simpler, but the PR could change it). Put the logic inline in the YAML (harder to test). Change the scanner to read stdin (out of bounds for this task).
Reversible: Yes. Remove the job and the script.

### 18 Oct 2026 · 0.9 Lead adds `secrets` to required checks after merge · decided by tdd-guide · risk: low
Decided: Branch protection still needs `secrets` added to its required checks, as the plan says. This branch does not change branch protection.
Why: GitHub can only require a check that has already reported on main's PRs. Adding it before merge would block this PR.
Alternatives: None.
Reversible: Yes.

### 18 Oct 2026 · 0.9 Review · decided by team lead · risk: medium
Decided: A PR can still rewrite its own job in .github/workflows/ci.yml (GitHub runs the PR's copy of a workflow on pull_request). Accepted: the lead merges only through the local merge hook, which runs main's gate, and every .github change gets security-reviewer.
Why: Making a workflow untouchable needs org-level required workflows; CODEOWNERS doesn't help when the lead uses the owner account.
Alternatives: Org-level required workflows; a separate bot account.
Reversible: Yes.
