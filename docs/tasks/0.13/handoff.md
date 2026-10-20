# 0.13 handoff — merge gate + closeout (Phase A) and CI docs-only skip + agent/skill docs (Phase B)

Status: DONE — Part A (Phase A and Phase B, both builder-doable) are complete. Part B (the
`guard-bash.sh` hook diff + its `test_hooks.py` cases) stays with the human, per the plan: it edits
a file auto mode blocks agent edits on. Listed under "Left for the human" below.

## Acceptance evidence

Phase A (unchanged from the earlier sitting):

```
$ python3 -m unittest discover -v .claude/tests
...
Ran 143 tests in 46.424s
OK
```

Phase B (this sitting, full suite including the Phase A tests above):

```
$ python3 -m unittest discover .claude/tests
....................................................................................................................................................
Ran 148 tests in 60.866s

OK
```

```
$ python3 .githooks/secret-scan.py --all
(clean, no output)
```

New/changed test files, Phase A: `.claude/tests/test_merge_gate.py` (+7 cases: PR-head bounded retry
pass/fail, bullet-prefixed/trailing-period `Reviewers:` line), `.claude/tests/test_board.py` (+2
cases: bullet-prefixed `- Decided:` line accepted and still checked against the log), `.claude/
tests/test_closeout.py` (new, 6 cases).

New/changed test files, Phase B: `.claude/tests/test_workflows.py` (+5 cases: nightly `schedule`
trigger present with a 5-field cron; the `node` job's `if:` evaluates false for a docs-only diff and
true otherwise, via a small in-test GH-expression evaluator; the `changes` job only uses
`actions/checkout`/`actions/setup-python` plus a plain `git diff --name-only` + stdlib script, no
third-party paths-filter action; the `docs_only.py` classifier is exercised directly — docs-only
diffs true, any code file false, empty diff false, always false on a `schedule` event regardless of
what changed).

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

## Phase B changes

- `.github/scripts/docs_only.py` (new): stdlib classifier, `is_docs_only(paths, event_name)` — a
  path is a "doc" if it's under `docs/`, a top-level `*.md`, or a `.md` under `.github/`; `true`
  only when every changed path is a doc and the list is non-empty; always `false` on
  `event_name == "schedule"` (the nightly run has no diff to judge and must run the full suite).
  CLI reads newline-separated paths from a file or stdin, prints `true`/`false`, exit code mirrors
  it. No network, no third-party action.
- `.github/workflows/ci.yml`: new `changes` job (checkout with `fetch-depth: 0`, `setup-python`,
  then a plain `git diff --name-only` between the right two refs for `pull_request`/`push` piped
  into `docs_only.py`) outputs `docs_only`; the `node` job gets `needs: changes` and
  `if: needs.changes.outputs.docs_only != 'true'`, so it's skipped only on a confirmed docs-only
  diff — `python-harness` and `secrets` are untouched and always run. Added a `schedule:` trigger
  (`cron: "17 3 * * *"`, nightly) alongside the existing `pull_request`/`push`; `docs_only.py`
  forces `false` on that event so the nightly run is never skipped. No new action was needed, so
  nothing new to pin by SHA; the two actions the new job uses (`actions/checkout`,
  `actions/setup-python`) are the same pins already used elsewhere in this file.
- `.claude/agents/eval-author.md`: added `Bash` to `tools:`; new "Before you return" line telling
  it to run `corepack pnpm turbo run test --filter=@edmate/evals...` itself and confirm new cases
  pass, instead of handing a failing suite to the lead.
- `.claude/skills/team-lead/SKILL.md`: wrote down the four 18 Oct lead-efficiency rules (see
  Decisions below for the lead's adjustment to rule (a)):
  - (a) safety-path plans get a plan review before the branch is created, not only after the
    build — until 13.3 the lead reads `plan.md` with a safety-reviewer eye, after 13.3
    `safety-reviewer` itself does; fix rounds stay capped at one per PR, with a HIGH still open
    after it becoming a `[deferred <id>]` board task;
  - (b) step 8 "Close": board/log commits are batched with the next real commit (plan commit or
    merge closeout), not pushed standalone on every status change;
  - (c) step 1 "Plan": the lead names the exact files the planner should read and tells it to skip
    exhaustive fixture reads;
  - (d) step 5 "Fix": confirmed the existing Token budget wording ("Continue the original builder
    with SendMessage only if it finished in under about 60 calls") already says this unambiguously
    — no change made, per the plan's "tighten only if ambiguous".

## Left for the human (Part B)

- `.claude/hooks/guard-bash.sh` + its `test_hooks.py` cases: the diff in the plan (fix the
  compound-command force-push false positive and the single-PR-only `gh pr merge` check). Auto mode
  blocks agent edits to `.claude/hooks/*`; the human applies or approves this directly, same sitting
  as reviewing this PR (both land in the same `.claude/**` risk group).

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

### 20 Oct 2026 · 0.13 CI docs-only skip via a stdlib script, not a third-party action · decided by tdd-guide · risk: high
Decided: a new `changes` job computes a `docs_only` output with a plain `git diff --name-only` piped
into a new stdlib script (`.github/scripts/docs_only.py`), not a third-party paths-filter action.
The `node` job alone gets `needs: changes` / `if: needs.changes.outputs.docs_only != 'true'`;
`python-harness` and `secrets` are unaffected. A doc is anything under `docs/`, a top-level `*.md`,
or a `.md` under `.github/`. A new nightly `schedule:` trigger (`cron: "17 3 * * *"`) always runs
the full suite — `docs_only.py` returns `false` whenever `event_name == "schedule"`, since a
scheduled run has no diff to judge.
Why: the lead's instruction for this sitting was explicit — prefer a plain `git diff --name-only`
shell step over a third-party paths-filter action "if that's simple", and it is: the classifier is
~20 lines of stdlib Python, directly unit-testable (`test_workflows.py` imports and calls
`is_docs_only` with known path lists) without a runner, and needs no new action pin.
Alternatives: a third-party paths-filter action (`dorny/paths-filter` or similar) — rejected per the
lead's instruction, and it would add one more action to keep pinned/bumped for no behaviour this
stdlib script doesn't already give; `paths-ignore` at the workflow trigger level — rejected because
it would skip the whole workflow (including `python-harness`/`secrets`), not just `node`.
Reversible: yes — drop the `changes` job and the `node` job's `needs`/`if`, delete the script and its
test cases; nothing else in the workflow depends on it.

### 20 Oct 2026 · 0.13 Lead-efficiency rules in SKILL.md, with the lead's rule-(a) wording for the pre-13.3 safety-plan review · decided by tdd-guide · risk: high
Decided: `.claude/skills/team-lead/SKILL.md` now states the four 18 Oct lead-efficiency rules
(planner briefing scope, batched close commits, capped fix rounds, and a pre-branch safety-plan
review). Rule (a) uses the lead's own wording for this sitting rather than the plan's more general
phrasing: safety-path plans get a plan review before the branch is created; until the pilot gate
(13.3) the lead does that review itself (reading `plan.md` with a safety-reviewer eye), and from
13.3 on `safety-reviewer` does it. The same line states fix rounds are capped at one per PR and that
a HIGH still open after that round becomes a `[deferred <id>]` board task.
Why: this is a direct instruction from the lead for this build (the plan's own text for rule (a) was
left more open; the lead resolved it to match the existing "MVP first" / no-safety-reviewer-until-
13.3 policy already in force elsewhere in this same `SKILL.md`), so the rule stays internally
consistent with the rest of the document rather than introducing a second, conflicting safety-review
policy.
Alternatives: run `safety-reviewer` on every safety-path plan now, ahead of 13.3 — rejected, conflicts
with the standing MVP-first decision (20 Oct 2026) that `safety-reviewer` doesn't run per PR until
the pilot gate.
Reversible: yes — a prose-only change to a skill file; no code depends on its exact wording.
