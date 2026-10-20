# Plan — 0.13 Agent-system efficiency (lead review, 18 Oct 2026)

## Acceptance (verbatim)
> one command closes out a merged task; the false positives seen on 18 Oct no longer fire (tests); a
> docs-only push to main does not run the node job; eval-author can run the suite test; the team-lead
> skill states the new rules.

## How each piece is shown
- **One command closes out a task**: new `closeout.py`, exercised by a unit test (`test_closeout.py`)
  in a throwaway repo (same fixture style as `test_hooks.py`/`test_merge_gate.py`'s `RepoCase`): it logs
  the handoff's `## Decisions` into `docs/decisions/log.md`, sets the board task `done`, and removes the
  task's worktree and branch — one call, asserted by reading the fixture repo state afterward.
- **18 Oct false positives fixed (tests)**: two families, split by who can touch the file (see Parts
  below). (a) `merge_gate.py`'s lettered-subtask bug and PR-head race get new cases in
  `test_merge_gate.py`. (b) `guard-bash.sh`'s `git branch -f` and multi-PR-merge bugs get new cases in
  `test_hooks.py`, shipped together with the hook diff the human applies (Part B).
- **Docs-only push skips the node job**: a new case in `test_workflows.py` (it already statically
  parses the workflow YAML; extend it to assert the `node` job's `if:`/path-filter condition is false
  for a docs-only diff and true otherwise, and that the nightly `schedule` trigger is present and does
  not carry that condition).
- **eval-author can run the suite test**: `tools:` in `.claude/agents/eval-author.md` includes `Bash`;
  its body names the exact command (`corepack pnpm turbo run test --filter=@edmate/evals...`) so it
  validates new cases itself instead of asking the lead.
- **team-lead skill states the new rules**: the four rules already adopted by the lead on 18 Oct (memory
  `lead-efficiency-rules`) are written into `SKILL.md` itself — reviewed as prose, no test.

## Part A — an agent (builder) can make these changes
Plain files under `.claude/skills/`, `.claude/tests/`, `.claude/agents/`, `.github/workflows/` — none of
them are `.claude/settings.json` or `.claude/hooks/*`, so they're not blocked by the auto-mode
self-modification check (confirmed: `.claude/skills/merge-gate/merge_gate.py` is already in
`guard-paths.sh`'s own "allowed" test list).

### Phase A — merge gate + closeout (Python, self-contained)
Tests first, in this order, each red-then-green:
1. `.claude/tests/test_merge_gate.py` — add cases to `FixRound1` (or a new class):
   - a branch `m4/4.0c-suite-validator-followups` resolves to task `4.0c`, not `4.0` (today
     `re.match(r"m\d+/(\d+\.\d+)", branch)` in `main()` drops the trailing letter; fix the regex to
     `r"m\d+/(\d+\.\d+[a-z]?)"` and confirm `docs/tasks/4.0c/...` is what gets read).
   - the PR-head check retries a bounded number of times (short, test-controlled delay — e.g. an env
     var like `MERGE_GATE_PR_WAIT_SECONDS=0` in tests) before failing, so a `gh pr view` called just
     after a push doesn't false-positive on stale `headRefOid`; `test_pr_head_must_match`'s genuinely-
     mismatched case must still fail after retries (don't weaken that test).
   - re-check `reviewer_names()` against any real `review.md` shape it currently mis-parses (bullet-
     prefixed `Reviewers:` line, trailing period) and add a case if one is found; don't change behaviour
     that's already covered (`test_reviewers_model_suffix_ok`, `test_reviewers_in_code_fence_ignored`,
     `test_only_first_reviewers_line` stay green).
2. `.claude/skills/merge-gate/merge_gate.py` — make the above pass.
3. `.claude/tests/test_closeout.py` (new) — a `RepoCase`-style fixture: given a merged task's branch,
   handoff and board entry, running `closeout.py <task-id>` (a) appends the handoff's `## Decisions` to
   `docs/decisions/log.md` (same logic as the scratch `log_decisions.py`, generalised: no absolute
   `/Users/...` paths, take the repo root from `git rev-parse --show-toplevel` or `$CLAUDE_PROJECT_DIR`,
   and the handoff path as an argument, not a hardcoded filename), (b) runs `board.py set <id> done
   --model ...`, (c) removes the task's git worktree (`git worktree remove`) and branch (local, and
   remote only if `--remote` is passed — don't force-delete an unmerged branch; refuse with a clear
   message if the branch has unmerged commits, mirroring `board.py`'s existing refuse-without-decisions
   check). Idempotent: running it twice doesn't duplicate the decision-log entry (existing
   `log_decisions.py` logic already dedupes by heading).
4. `.claude/skills/team-lead/closeout.py` (new) — make the test pass.

### Phase B — CI + agent/skill docs
1. `.claude/tests/test_workflows.py` — extend with: a docs-only changed-file set makes the `node` job's
   guard condition skip it; a non-docs-only set runs it; the workflow has a `schedule:` trigger; the
   schedule-triggered run is not subject to the docs-only skip (full suite runs nightly regardless of
   what changed means nothing — there's no diff to check on a schedule run, so the condition must
   degrade to "always run" when `github.event_name == 'schedule'`).
2. `.github/workflows/ci.yml` — add the path-filter condition to the `node` job only (`python-harness`
   and `secrets` keep running as today) and a `schedule:` entry (nightly, e.g. `cron: '17 3 * * *'`,
   any main-safe offset) alongside the existing `pull_request`/`push` triggers. Any new action this
   needs (e.g. a paths-filter action) must be pinned by full commit SHA, matching every other step in
   this file.
3. `.claude/agents/eval-author.md` — add `Bash` to the `tools:` line; add one line under "Don't" or a
   new short line telling it to run `corepack pnpm turbo run test --filter=@edmate/evals...` before
   returning, not just write files.
4. `.claude/skills/team-lead/SKILL.md` — add the four rules from memory `lead-efficiency-rules`
   (already lead behaviour since 18 Oct; this makes them durable in the written skill):
   a. under step 3 "Run one task", before step 1 (Plan): safety-path tasks (guardrails, safety/locked
      evals, prompt packs, access) get a `safety-reviewer` pass on `plan.md` itself before the branch is
      created, not only after the build.
   b. step 8 "Close": board/log commits are batched with the next real commit (plan commit or merge
      closeout), not pushed standalone on every status change.
   c. step 1 "Plan": tell the planner which files to read and that it should skip exhaustive fixture
      reads.
   d. step 5 "Fix": this one is largely already written (Token budget section) — check it actually
      states "resume the same builder only if its run was short (~60 calls), otherwise a fresh fixer",
      and tighten the wording only if it's ambiguous; don't duplicate what's already there.

## Part B — hook edits the human applies or approves (auto mode blocks agent edits here)
`guard-bash.sh` is listed under `.claude/hooks/` in `.claude/settings.json`'s `PreToolUse` block — the
known constraint (blocker B-2, resolved 18 Oct: "hooks edited outside auto mode") applies. The diff
below is proposed, not committed; the human applies it directly (or tells the lead to, outside the
builder's restriction) and should review it alongside Part A's PR since both land in the same `.claude/**`
risk group.

```diff
--- a/.claude/hooks/guard-bash.sh
+++ b/.claude/hooks/guard-bash.sh
@@
-if grep -qE "git\s+push\b.*(\s-f\b|--force\b|--force-with-lease)" <<<"$cmd"; then
-  decide deny "No force pushes: other agents and reviewers may be on this branch."
-fi
+# Check each command in the line on its own, not the whole line: a compound command like
+# "git branch -f tmp && git push origin tmp" has no forced push, but the old check matched "-f"
+# anywhere after "push" in the full string (false positive seen 18 Oct).
+while IFS= read -r seg; do
+  if grep -qE "git\s+push\b" <<<"$seg" && grep -qE "(\s-f\b|--force\b|--force-with-lease)" <<<"$seg"; then
+    decide deny "No force pushes: other agents and reviewers may be on this branch."
+  fi
+done <<<"$(sed -E 's/&&|;|\|/\n/g' <<<"$cmd")"
@@
 if grep -qE "\bgh\s+pr\s+merge\b" <<<"$cmd"; then
-  pr=$(grep -oE "gh\s+pr\s+merge\s+#?[0-9]+" <<<"$cmd" | grep -oE "[0-9]+$")
-  [ -z "$pr" ] && decide deny "Pass the PR number explicitly (gh pr merge <number> --squash) so the merge gate can check it."
-  out=$(cd "${CLAUDE_PROJECT_DIR:-$PWD}" && python3 .claude/skills/merge-gate/merge_gate.py --pr "$pr" 2>&1); rc=$?
-  [ $rc -eq 0 ] || decide deny "Merge gate did not pass (exit $rc):
-$out"
+  prs=$(grep -oE "gh\s+pr\s+merge\s+#?[0-9]+" <<<"$cmd" | grep -oE "[0-9]+$")
+  [ -z "$prs" ] && decide deny "Pass the PR number explicitly (gh pr merge <number> --squash) so the merge gate can check it."
+  # A command can merge more than one PR (today only the last number was ever checked); gate each.
+  while IFS= read -r pr; do
+    out=$(cd "${CLAUDE_PROJECT_DIR:-$PWD}" && python3 .claude/skills/merge-gate/merge_gate.py --pr "$pr" 2>&1); rc=$?
+    [ $rc -eq 0 ] || decide deny "Merge gate did not pass for PR $pr (exit $rc):
+$out"
+  done <<<"$prs"
 fi
```

Accompanying test additions (also the human's to apply, same sitting): in `.claude/tests/test_hooks.py`
`GuardBash`, add: `git branch -f tmp && git push origin tmp` is **not** denied; `git push -f origin x`
(alone) is still denied; `gh pr merge 10 --squash && gh pr merge 11 --squash` checks (and can deny)
either PR, not just one.

Reversible: yes, both sides (revert the diff / drop the new test cases).

## Files touched
**Part A (builder):**
- `.claude/skills/team-lead/closeout.py` (new)
- `.claude/tests/test_closeout.py` (new)
- `.claude/skills/merge-gate/merge_gate.py` (modify)
- `.claude/tests/test_merge_gate.py` (modify)
- `.github/workflows/ci.yml` (modify)
- `.claude/tests/test_workflows.py` (modify)
- `.claude/agents/eval-author.md` (modify)
- `.claude/skills/team-lead/SKILL.md` (modify)

**Part B (human applies/approves):**
- `.claude/hooks/guard-bash.sh` (diff above)
- `.claude/tests/test_hooks.py` (new `GuardBash` cases, applied with the diff)

## Files out of bounds
- `.claude/settings.json` — not touched by this task; no hook registration changes needed.
- `.claude/hooks/guard-paths.sh`, `check-edit.sh` — unaffected.
- `.claude/skills/merge-gate/risk-paths.txt` — no new groups needed; every path above already falls
  under the existing `.claude/**` / `.github/**` globs.
- Anything under `packages/`, `apps/`, `content/` — this is a tooling task only.

## Tests first
Every Part-A change above is listed test-before-implementation (test_merge_gate.py / test_closeout.py /
test_workflows.py cases precede the corresponding script/workflow edit). Part B's test cases are written
alongside its diff (same sitting, since the builder can't red/green them itself).

## Risky paths touched (checked against risk-paths.txt)
- `.claude/**` → **reviewers: security-reviewer** — hits: `closeout.py`, `test_closeout.py`,
  `merge_gate.py`, `test_merge_gate.py`, `eval-author.md`, `team-lead/SKILL.md`, and Part B's
  `guard-bash.sh` + `test_hooks.py`.
- `.github/**` → **reviewers: security-reviewer** — hits: `ci.yml`, `test_workflows.py`.
- No other group matches (no `packages/contracts`, no safety paths, no access/payments/auth paths, no
  destructive migrations) — no `architect`, `safety-reviewer`, `database-reviewer`.
- This task is risky: the handoff's `## Decisions` needs a `### ... risk: high` entry, and `review.md`'s
  `Reviewers:` line must name `security-reviewer` (plus `code-reviewer`; `typescript-reviewer` is
  optional here — no TypeScript is touched, only Python/Bash/YAML/Markdown — note this for the lead to
  decide when picking reviewers).

## Open questions for the human
None — this plan only writes down work already decided (18 Oct efficiency review, logged) and known-shape
bugs (the lettered-subtask drop and PR-head race are directly observed in the code; the branch -f / multi-
PR-merge bugs are directly observed in `guard-bash.sh`'s regexes). The only judgment calls (retry timing,
exact path-filter mechanism, cron offset) are left to the builder/lead as implementation details, not
open decisions.
