# 0.7 handoff: harness fixes (rescoped 18 Oct 2026)

Status: DONE
Branch: `m0/0.7-harness-fixes` (rebuilt on `main` ddae494; the earlier WIP with hook edits and approve.py was dropped)
Worktree: `.claude/worktrees/agent-a2134170c217157d4`
Scope: the plan's "## Scope change" section. No file under `.claude/hooks/` or `.claude/settings.json` is touched.

## Acceptance evidence

`python3 -m unittest discover -v .claude/tests`:
```
Ran 54 tests in 20.2s
OK
```
- `test_merge_gate.py` (34): basics; `RiskyGroups` runs one sample path per risk group (12 paths: safety, locales, access, payments, webhooks, auth, keys, repositories, contracts, ADRs, `.claude`, `.github`) in **both `<task-id>` and `--pr` modes**: 0 with the group's reviewers and a `risk: high` entry, 1 for each missing reviewer, 1 with no `risk: high`. Also: a PR label does not replace reviewers, every gap listed, union across groups, whole-word reviewer match, `risk: high` outside `## Decisions` ignored, safety-review.md for safety paths and locales, destructive migration needs `database-reviewer`, a glob with no `# reviewers:` line fails closed, never exit 3. `Wontfix` (6 cases).
- `test_board.py` (11): `done` refused with no handoff / no `## Decisions` / a `Decided:` line not in the log word for word / a condensed line (board file unchanged each time); `None` and whitespace-only differences pass; `next` warns for a planning task with no plan.md and not once it exists; other statuses unchanged.
- `test_hooks.py` (9): runs main's hooks unchanged (no edits): force-push denied, push to main allowed when the secret scan is clean and denied when it flags (a tracked `.npmrc`), label deny, `gh pr merge` needs a number, `.env` deny, no asks; guard-paths denies secrets/key files, allows contracts and harness files.

Gate demo in a temp repo (`contracts` change, `risk: high` entry present):
```
$ merge_gate.py 9.9   (reviewers missing) -> exit 1
  risky packages/contracts/src/x.ts
  FAIL  risky packages/contracts/src/x.ts: review.md Reviewers: is missing architect
  FAIL  risky packages/contracts/src/x.ts: review.md Reviewers: is missing security-reviewer
RESULT: FAIL — fix the items above, re-run the reviewers, then run the gate again.
$ merge_gate.py 9.9   (all three named) -> exit 0
  risky packages/contracts/src/x.ts
RESULT: PASS — risky, lead-approved: the required reviewers ran and a risk: high decision is logged. ...
```

`python3 .githooks/secret-scan.py --all`: clean (see final commit).

## Changes
- `merge_gate.py`: `evaluate(task, branch, pr)` used by both modes; risky groups and their reviewers parsed from `risk-paths.txt`; every touched group's reviewers + one `risk: high` decision, else exit 1 with each gap; destructive migration → `database-reviewer`; `[wontfix]` needs a task decision entry naming the file; no exit 3, no label read.
- `risk-paths.txt`: `# reviewers:` line per section; `content/locales/**` moved into the safety group; header rewritten.
- `board.py`: `set <id> done` checks; `next` plan.md warning; risky flag text.
- Agents: 7 reviewers get the "never write files" line (safety-reviewer gains an Edmate notes section); planner risk-path check and plan-on-main; architect notes replaced (reviews contracts and ADRs, read-only); pedagogy-author's label sentence updated.
- Docs: CLAUDE.md (rules 2, 6, Hooks), build plan (line 12, rules 2 and 6, Definition of done line), merge-gate and team-lead skills, architecture.html (cards, hook band, flow box, merge policy table and gate list, lanes, rails table), decision-log legend.
- `.gitignore`: `__pycache__/`, `*.pyc` (the tests created them).

## Deviations
- Added `test_hooks.py`, which only runs main's hooks (push-to-main scan cases the lead asked for). No hook file is edited.
- Not written: `docs/tasks/0.7/review.md` (the lead writes it from the reviewers' outputs). This branch touches `.claude/**`, so the gate needs `security-reviewer` in `Reviewers:`.
- Left for 0.5: architecture.html's "The bot" paragraph and task 0.5's title still describe the PR label check that the gate no longer uses.
- Limits: the gate checks that reviewer names appear in `review.md`, not that the reviews happened; until CI (0.5) re-runs it, only this session checks it (noted in the merge-gate SKILL).

## Decisions

### 18 Oct 2026 · 0.7 Lead-approved risky merges · decided by tdd-guide · risk: high
Decided: The merge gate passes a risky branch only when review.md names every reviewer its risk groups need (listed in risk-paths.txt) and the handoff has a risk: high entry; otherwise it fails. It no longer reads the PR label and never says "needs human". A risky path with no reviewers line fails the gate.
Why: Your decision that the lead merges everything; this keeps the specialists and puts every risky merge on your skim list.
Alternatives: Keep a human step for some groups.
Reversible: Yes.

### 18 Oct 2026 · 0.7 Decision checks · decided by lead · risk: low
Decided: A [wontfix] finding passes only if a decision entry for the task names its file. `board.py done` needs each handoff `Decided:` line word for word in the log.
Why: Simple, mechanical, hard to satisfy by accident.
Alternatives: Count entries; fuzzy matching.
Reversible: Yes.

### 18 Oct 2026 · 0.7 Locale packs count as safety · decided by tdd-guide · risk: medium
Decided: Changes to content/locales need safety-reviewer and a safety-review.md, like the other child-safety paths.
Why: The scope change put locales in the safety group, and the safety review file goes with that group.
Alternatives: safety-reviewer only, no safety-review.md.
Reversible: Yes, one line in the gate.

### 18 Oct 2026 · 0.7 Wontfix file match · decided by tdd-guide · risk: low
Decided: The file a [wontfix] finding covers is its first word that looks like a path (has a slash or a file extension). An entry passes if it names that path or just the file name.
Why: Matches the review.md format; file names are how people write decisions.
Alternatives: Require the full path.
Reversible: Yes.
