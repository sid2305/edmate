# 0.13 handoff — Part A, Phase A only (merge gate + closeout)

Status: PARTIAL — Part A Phase A (steps 1-4) done; Part B (hook edits) and Phase B (CI docs-only
skip, eval-author tools, team-lead SKILL.md rules) are left for other tasks/the human, per the plan.

## Acceptance evidence

```
$ python3 -m unittest discover -v .claude/tests
...
Ran 143 tests in 46.424s
OK
```

```
$ python3 .githooks/secret-scan.py --all
(clean, no output)
```

New/changed test files: `.claude/tests/test_merge_gate.py` (+7 cases: PR-head bounded retry pass/
fail, bullet-prefixed/trailing-period `Reviewers:` line), `.claude/tests/test_board.py` (+2 cases:
bullet-prefixed `- Decided:` line accepted and still checked against the log), `.claude/tests/
test_closeout.py` (new, 6 cases).

## Changes

- `.claude/skills/merge-gate/merge_gate.py`: `--pr` mode's PR-head check now retries (bounded,
  `MERGE_GATE_PR_RETRIES`, default 3) with a short wait (`MERGE_GATE_PR_WAIT_SECONDS`, default 2s)
  between attempts before failing, so a `gh pr view` called right after a push doesn't false-
  positive on a stale `headRefOid`. A genuinely mismatched head still fails once retries run out.
  `reviewer_names()` now accepts a bullet/number-prefixed `Reviewers:` line (`- Reviewers: ...`,
  same convention as the existing `Status:` line parsing) and ignores one trailing period on the
  value. The lettered-subtask branch regex (`m\d+/(\d+\.\d+[a-z]*)`) was already fixed in an
  earlier commit (bbc47dc) — confirmed still covered by `test_pr_mode_keeps_task_letter`, no change
  needed there.
- `.claude/skills/board/board.py`: `set <id> done`'s decision check now recognizes a bullet-
  prefixed `- Decided:` line the same as a plain one (new `DECIDED_LINE` regex), so a handoff
  written with bulleted decision bodies isn't wrongly refused as "no Decided: lines". The log
  comparison stays word-for-word against whatever form (bulleted or not) the handoff actually used.
- `.claude/skills/team-lead/closeout.py` (new): one command that (1) appends a merged task's
  handoff `## Decisions` entries to `docs/decisions/log.md` (idempotent, dedup by heading; treats
  bullet-prefixed and plain `Decided:` lines the same, since it copies entries verbatim rather than
  reparsing individual lines), (2) runs `board.py set <id> done`, (3) removes the task's git
  worktree if one exists and deletes its local branch if fully merged into main (refuses with a
  clear message, board/log steps still applied, if the branch has unmerged commits); `--remote`
  also deletes the branch on origin. Repo root is resolved from `$CLAUDE_PROJECT_DIR` or
  `git rev-parse --show-toplevel`, never a hardcoded path.
- `.claude/tests/helpers.py`: `SCRIPTS` now also copies `skills/team-lead/closeout.py` into the
  throwaway test repos; `Repo.script()` knows the name `"closeout"`.

## Left to do (Part B / Phase B — out of this task's scope)

- `.github/workflows/ci.yml` + `.claude/tests/test_workflows.py`: docs-only push skips the `node`
  job; nightly `schedule` trigger.
- `.claude/agents/eval-author.md`: add `Bash` tool, run the suite test itself.
- `.claude/skills/team-lead/SKILL.md`: write down the four 18 Oct lead-efficiency rules.
- `.claude/hooks/guard-bash.sh` + its `test_hooks.py` cases (Part B): the human applies/approves
  this directly, per the plan (auto-mode self-modification restriction).

## Decisions

### 20 Oct 2026 · 0.13 Merge gate PR-head retry and reviewer-line parsing, board bullet-Decided support, new closeout.py · decided by tdd-guide · risk: high
Decided: `merge_gate.py`'s `--pr` mode retries a bounded number of times (env-overridable wait/
retry count, defaulting to 3 retries x 2s) before failing a PR-head mismatch; `reviewer_names()`
accepts a leading bullet and one trailing period. `board.py`'s done-check accepts bullet-prefixed
`- Decided:` lines. A new `closeout.py` logs decisions, marks a task done and cleans up its
worktree/branch in one command, refusing to delete an unmerged branch.
Why: these are the 18 Oct false positives and the one-command-closeout requirement the plan
(`docs/tasks/0.13/plan.md`) asks for; the lettered-subtask regex was already fixed in bbc47dc so no
change was needed there.
Alternatives: leave the PR-head check without retry (the known race would keep false-positiving);
reparse individual `Decided:` lines in `closeout.py` instead of copying whole entries verbatim (more
code, and would need the same bullet-handling twice).
Reversible: yes — each change is additive (a regex relaxation, a retry loop, a new standalone
script); none change an existing passing test's behaviour.
