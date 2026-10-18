# Task 0.7: Harness fixes from the 0.1 dry run (+ fix 5: contracts become lead-approved)

Board: `python3 .claude/skills/board/board.py show 0.7` · Milestone M0 · deps: 0.1 (done) · branch: `m0/0.7-harness-fixes`

**Risky.** The diff touches `.claude/**`, `docs/edmate-harness-build-plan.md` (the spec) and `risk-paths.txt` itself. The human approves this PR. Edits to `.claude/hooks/*`, the spec and (after this task) `.claude/skills/merge-gate/*` trigger guard-paths "ask" prompts, so **run the build in the foreground**.

## Acceptance (verbatim, from `docs/board/tasks.yaml`, updated 18 Oct 2026)

Title: "Harness fixes from the 0.1 dry run: (1) the merge gate accepts a local human approval (no GitHub yet) that only the human can create and that is tied to the branch head commit; (2) the gate fails a [wontfix] finding with no decision-log entry, and board.py refuses `done` when the handoff's decisions are not in docs/decisions/log.md; (3) guard-bash asks before shell commands that write into frozen, safety, access or payments paths (Edit/Write hooks already do); reviewer agents are told never to write files; (4) planner must check every planned path against risk-paths.txt; the lead commits plan.md on main before the build (guard-bash allows docs/tasks/<id>/plan.md on main); board.py next warns about a task in planning with no plan.md; (5) packages/contracts moves from human-approved to lead-approved: no edit-time ask, and the gate passes a contracts change without the human only when the branch adds or changes an ADR for it, review.md lists architect, security-reviewer and typescript-reviewer, and the handoff has a risk: high decision; CLAUDE.md, build plan rule 2, risk-paths.txt, merge-gate and team-lead skills updated to match"

Accept: "Python tests for merge_gate.py, board.py and the guard-bash.sh rules pass (`python3 -m unittest discover .claude/tests`); an agent-run approval command is denied by the hook; the gate exits 0 for a risky task only with an approval matching the branch head, and 3 again after a new commit; team-lead and merge-gate skills describe the new local approval step."

(The accept line was not changed for fix 5. The plan still covers fix 5 with tests: `test_merge_gate.py::Contracts`.)

### How each item is shown (paste in handoff.md)

| Item | Evidence |
|---|---|
| Tests pass | Output of `python3 -m unittest discover -v .claude/tests`: all green, count shown. |
| Agent-run approval denied | `test_guard_bash.py::ApprovalDenied` asserts `deny`. Live check: the builder runs the approve command through its own Bash tool and pastes the hook's deny message. |
| Gate 0 only with a matching approval, 3 after a new commit | `test_merge_gate.py::LocalApproval` in a temp git repo. |
| Fix 5 | `test_merge_gate.py::Contracts`: a pass case, plus one failing case per missing condition (exit 1), the 0.3 bootstrap case, and the ADR scope cases. `test_guard_paths.py`: contracts no longer asks. |
| Skills and docs describe the new rules | Diffs of both skills, CLAUDE.md, build plan rules 2 and 6, risk-paths.txt and architecture.html. |

## Design

### Fix 1: local human approval

- **New `.claude/skills/merge-gate/approve.py <task-id> <sha>`** (stdlib only). It:
  1. resolves the task's branch from the board;
  2. refuses (exit 1) unless `<sha>` (at least 7 hex chars) is a prefix of `git rev-parse <branch>`, so the human approves exactly the commit the gate printed;
  3. runs the gate's checks through a refactored `merge_gate.evaluate(...)` and refuses if the result is FAIL (1);
  4. writes `<common>/edmate-approvals/<task-id>.json` = `{"task", "branch", "head_sha" (full), "approved_at" (UTC ISO), "via": "approve.py"}`. No names or emails;
  5. prints the sha and the risky files it approved.
- **Record location:** `<common>` comes from `git rev-parse --path-format=absolute --git-common-dir`, called in a shared helper `approvals_dir()` in `merge_gate.py` that `approve.py` imports. The record is therefore the same file whether the gate or approve.py runs from the main checkout or from any worktree. It sits inside `.git/`, so it is never committed. If `--path-format` is unavailable (git older than 2.13), resolve the relative output against the cwd.
- **`merge_gate.py`:**
  - Refactor `main` into `evaluate(task, branch, labels, pr) -> (code, lines)`. The CLI output stays the same.
  - **`<task-id>` mode:** if the branch is risky and has no label, it PASSes (0) only if the record's `branch` matches and its `head_sha` equals the current full head sha.
    - If the record is for an older sha, exit 3: `approval is for <old7>, branch head is now <new7>: ask the human to re-approve`.
    - If there is no record, exit 3 and print the human's command (see "Human approval instructions").
  - **`--pr` mode: unchanged.** Only the label counts; the record is ignored (task 0.5's path).
  - Update the docstring.
- **Agents denied:**
  - `guard-bash.sh` **denies** any command containing `approve.py` or `edmate-approvals`. This covers running it, `cd … && python3 approve.py`, `bash -c`, python/echo/tee/cp/rm on the record dir, and reading the script (agents use the Read tool instead).
  - `guard-paths.sh` **denies** Edit/Write/MultiEdit/NotebookEdit on any path containing `/edmate-approvals/`, and **asks** for `.claude/skills/merge-gate/*` and `.claude/skills/board/board.py`.
- **Unchanged backstop:** the local `git merge --squash` on `main` still asks the human (existing guard-bash rule).

#### Human approval instructions (both outcomes of the `!` probe; the lead keeps the one that applies)

The human is running `! echo "probe gh human-approved"`. The existing `gh` + `human-approved` deny rule blocks it if PreToolUse hooks fire for `!` commands.

- **Outcome A (the line prints, so `!` skips hooks):** the human types `! python3 .claude/skills/merge-gate/approve.py <id> <sha7>` in the Claude Code prompt.
- **Outcome B (the probe is denied):** the human runs `cd ~/edmate && python3 .claude/skills/merge-gate/approve.py <id> <sha7>` in a separate terminal.

The builder writes both lines into the gate's exit-3 message and into both skills behind a single constant `HUMAN_APPROVE_HINT` in `merge_gate.py` (and one sentence in each skill). The lead then deletes the one that doesn't apply, either before the build or in a fix round. The design is the same in both cases.

### Fix 2: decisions must be logged

- **Gate:** each `[wontfix]` finding needs a decision entry. Take the first `path[:line]` token after the state tag. The finding passes only if a `### …` entry in the branch's `handoff.md` `## Decisions` **or** in `main`'s `docs/decisions/log.md` has the task id in its heading and mentions that path or its basename. Otherwise FAIL: `[wontfix] <path> has no decision entry naming it`. The merge-gate SKILL adds: "a wontfix decision entry names the file(s) it covers."
- **`board.py set <id> done` refuses** (exit 1, board unchanged) in any of these cases:
  - `docs/tasks/<id>/handoff.md` is missing from the working tree ("merge first");
  - the handoff has no `## Decisions` section;
  - the section is not just `None`, and any entry's `Decided:` line (whitespace-normalised) is missing **word for word** from `docs/decisions/log.md`. The refusal lists the missing lines. (Lead answer to Q2: verbatim; no condensing or merging.)

### Fix 3: shell writes into protected paths

- **New `.claude/hooks/protected-paths.sh`**, sourced by both hooks. It defines `protected_reason <path>`, with one list covering:
  - guardrails, prompt-packs, skills, safety and locked evals;
  - access, payments, webhooks;
  - the two spec docs;
  - `.claude/settings.json`, `.claude/hooks/*`, `.claude/skills/merge-gate/*`, `.claude/skills/board/board.py`.

  **`packages/contracts` is removed from this list (fix 5)** for both edits and shell writes.
- **guard-bash asks** when the command (a) mentions a protected prefix anywhere (substring, so absolute and worktree paths match) **and** (b) contains a write indicator:
  - `>` or `>>` (but not `2>&1` or `>/dev/null` on their own)
  - `tee`, `cp`, `mv`, `rm`, `rsync`, `install`, `ln`, `touch`, `mkdir`, `truncate`, `dd of=`
  - `sed -i`, `perl -i`
  - `git checkout|restore … --`, `git apply`, `patch`
  - `python3? -c` or `node -e` with `open(`, `write`, `writeFile`, `unlink`, `rmtree`
  - heredoc `<<`
  - `cd <protected> && <indicator>`

  Read-only mentions pass.
- **What it can't catch** (say so in the hook comment and the handoff):
  - scripts written elsewhere and then run;
  - paths built from variables or globs;
  - base64 or eval;
  - `find -exec`;
  - tools that write by their own logic (`prettier --write .`, `eslint --fix`, codegen, pnpm scripts);
  - git operations that bring in changes without naming paths (`merge`, `cherry-pick`, `checkout <branch> -- .`).
- **Backstops:**
  - the gate's `risk-paths.txt` diff check (and the fix 5 contracts check), however the file was written;
  - ESLint harness purity;
  - the secret scan at edit, at commit (`.githooks/pre-commit`) and in CI (0.5);
  - reviewers.
- **Reviewer agents** (code, typescript, database, security, silent-failure-hunter, rag-pipeline, safety) get one Edmate-notes line: "Never create, edit or delete files in the repo or any worktree, including via the shell (redirects, tee, cp, mv, sed -i, scripts). To probe a rule, use stdin (`eslint --stdin --stdin-filename …`) or the session scratchpad outside the repo."

### Fix 4: planning hygiene

- **`planner.md`:**
  - check **every** planned path (including new folders and placeholders) against `risk-paths.txt` and the SAFETY prefixes, and list each match under "Risky paths touched", or write "None (checked against risk-paths.txt)";
  - a contracts change is no longer automatically BLOCKED: the plan includes the ADR (`scope: contracts`) and the three reviewers.
- **guard-bash commit-on-main:** the allowed set is `^docs/(board|decisions)/` or `^docs/tasks/[^/]+/plan\.md$`.
- **team-lead SKILL §3:** after READY, the lead commits `docs/tasks/<id>/plan.md` on `main`, **then** creates the branch and worktree from `main`. The builder never re-adds the plan.
- **`board.py next`:** prints `WARNING  <id> is in planning but docs/tasks/<id>/plan.md does not exist` for each such task.

### Fix 5: `packages/contracts` becomes lead-approved

- **`risk-paths.txt`:** remove `packages/contracts/**`. Keep `docs/adr/**`; the scope exemption below is applied in code.
- **`guard-paths.sh` / `protected-paths.sh`:** no ask for `packages/contracts/*`.
- **New gate check, in `evaluate()`, `contracts_check(task, branch, changed)`.** It runs when any changed path starts with `packages/contracts/`. All of the following must hold, or the gate gives **FAIL (exit 1)** with one message per missing item (fixable by the lead, not 3):
  1. **An ADR for it:** the branch adds or modifies a `docs/adr/*.md` file whose front matter (read at the branch head) has `scope: contracts`. This is waived only in the bootstrap case below.
  2. **Reviewers:** the `Reviewers:` line in `review.md` contains the words `architect`, `security-reviewer` and `typescript-reviewer` (word match; model suffixes like "(opus)" are fine).
  3. **A `risk: high` decision:** handoff `## Decisions` has at least one `### ` heading containing `risk: high`.
- **ADR scope exemption:** a changed `docs/adr/<file>.md` is **not** counted as risky only if all of these hold:
  - its front matter at the branch head says exactly `scope: contracts`;
  - if the file exists on `main`, its scope there is also `contracts` (stops an agent relabelling a stack ADR as contracts);
  - the branch changes none of the stack signal files: root `package.json`, `pnpm-workspace.yaml`, `pnpm-lock.yaml`, `turbo.json`, `tsconfig.base.json`, `packages/config/**`, `content/prompt-packs/**`.

  Every other ADR change stays risky (exit 3, human), as do ADR template or README files without front matter and ADRs with `scope: stack`, `scope: prompt-packs` or no scope. Any other risky path on the same branch still gives 3. The contracts route never overrides other risk.
- **Initial creation (task 0.3).** The suggested rule "ADR only when `packages/contracts/src` already exists on main" **does not work**: task 0.1 already put `packages/contracts/src/index.ts` (`export {};`) on main. Instead, the ADR requirement is waived **only when the task being gated is `0.3` and the board shows 0.3 as not `done`**. Requirements 2 (reviewers) and 3 (`risk: high`) still apply. The gate prints `note  contracts bootstrap (task 0.3): ADR not required`. After 0.3 is done, every contracts change needs an ADR. The lead also sets 0.3's board `risk` field from `risky` to `null`, since the board flag is display-only. This is the lead's bookkeeping commit, not part of this branch.
- **Architect agent:** its Edmate notes are currently a copy-paste of the planner's notes (a bug). Replace them with:
  - you review contracts changes and their ADRs and appear in `Reviewers:`;
  - ADRs use front matter `scope: contracts|stack|prompt-packs|other`;
  - set `scope: contracts` **only** when the ADR changes nothing but contract shapes: no stack, library or version change, no prompt-pack behaviour, no other risky path. When in doubt, use `other`; it then goes to the human;
  - you are read-only (Read/Grep/Glob). The builder writes the ADR file from your text.
- **Weakness (flag it in the handoff and in SKILL.md):** `scope:` is self-declared. A careless or wrong architect or builder can mark a stack-level ADR `contracts` and skip the human. The mitigations are partial:
  - the scope must already be `contracts` on main;
  - the stack signal files block the exemption;
  - three named reviewers;
  - a mandatory `risk: high` decision entry, which reaches the human's skim list in the decision log.

  The gate cannot judge an ADR's meaning. The real fix is human review of `risk: high` log entries, plus CI (0.5) re-running the same check.
- **Docs:**
  - CLAUDE.md non-negotiables 2 and 6;
  - build plan line 12 (header rule 2), rule 2 (line ~678) and rule 6's list (line ~682: drop "contracts", and say "ADRs except `scope: contracts`"). The spec edit asks the human, as expected;
  - risk-paths.txt;
  - merge-gate SKILL: a new "Lead-approved: contracts" tier row and the checklist;
  - team-lead SKILL: the contracts reviewers in §3 step 3, and architect to write the ADR text;
  - planner.md;
  - `docs/decisions/log.md` legend line: "risk: high · you decided, or a contracts change the lead approved";
  - architecture.html: line ~133 card ("contracts"), line ~244 hook line ("ask before editing contracts"), line ~415, line ~542 ("frozen after task 0.3" → "changes only with an ADR"), line ~602 "Frozen contracts" row, and line ~614 "Risky PRs" row (add the local approval).

## Files

### Create
- `.claude/skills/merge-gate/approve.py`
- `.claude/hooks/protected-paths.sh`
- `.claude/tests/helpers.py`: temp git repo builder that copies `merge_gate.py`, `approve.py`, `board.py` and `risk-paths.txt` into `<tmp>/.claude/skills/...`, so `ROOT = parents[3]` resolves there; a `tasks.yaml` writer; `run_hook(script, tool_input, cwd, env)`.
- `.claude/tests/test_merge_gate.py`, `test_approve.py`, `test_board.py`, `test_guard_bash.py`, `test_guard_paths.py`
- `docs/tasks/0.7/handoff.md`, `docs/tasks/0.7/review.md`

### Modify
- `.claude/skills/merge-gate/merge_gate.py`, `.claude/skills/merge-gate/risk-paths.txt`, `.claude/skills/merge-gate/SKILL.md`
- `.claude/skills/board/board.py`
- `.claude/hooks/guard-bash.sh`, `.claude/hooks/guard-paths.sh`
- `.claude/skills/team-lead/SKILL.md`
- `.claude/agents/planner.md`, `.claude/agents/architect.md`, and the 7 reviewer agents (Edmate notes only)
- `CLAUDE.md`, `docs/edmate-harness-build-plan.md` (lines 12, ~678, ~682 only), `docs/architecture.html` (the lines listed above), `docs/decisions/log.md` (legend line only; entries are added by the lead on merge)

### Out of bounds
- `.claude/settings.json`, `packages/**`, `apps/**`, `docs/edmate-prd.md`, `.githooks/*`
- The gate's `--pr` code path
- Board data (stale entry; 0.3 risk flag). The lead handles these with `board.py`.
- `docs/adr/`: no ADRs are written here (task 0.4 makes the template; it should include the `scope:` field. The lead adds a note to 0.4's plan).
- `.claude/blockers.md`

## Tests first (stdlib `unittest` + `subprocess` on the real scripts; `tempfile` repos)

`setUpModule` fails loudly (no skip) if `git`, `jq` or PyYAML is missing.

1. **test_guard_bash.py**
   - `ApprovalDenied`: deny for `python3 .claude/skills/merge-gate/approve.py 0.7 abc1234`, `cd .claude/skills/merge-gate && python3 approve.py 0.7 x`, `bash -c '…approve.py…'`, `echo {} > .git/edmate-approvals/0.7.json`, `python3 -c "open('.git/edmate-approvals/0.7.json','w')"`, `rm .git/edmate-approvals/0.7.json`.
   - `ShellWritesAsk`: ask for `tee packages/payments/x`, `cp /tmp/a packages/harness/src/access/b.ts`, `sed -i '' s/a/b/ content/prompt-packs/p.md`, `python3 -c "open('packages/harness/src/guardrails/g.ts','w')"`, a heredoc into `evals/suites/locked/`, an absolute worktree path `…/.claude/worktrees/w1/content/skills/x`, `mv a .claude/hooks/x.sh`.
   - `ContractsNoLongerAsk`: no decision for `echo x > packages/contracts/src/a.ts`.
   - `ReadsAllowed`: no decision for `git diff main -- packages/payments`, `cat …`, `grep -r foo content/skills`, `ls packages/payments 2>&1`, `corepack pnpm test`.
   - `CommitOnMain` (temp repo on `main`): staged `docs/tasks/0.7/plan.md` → none; `docs/tasks/0.7/handoff.md` → ask; `docs/board/tasks.yaml` → none; `apps/x.ts` → ask.
   - `ExistingRules`: force push deny, push main deny, `gh … human-approved` deny, `gh pr merge` without a number deny, `.env` ask.
2. **test_guard_paths.py**: all existing cases except contracts still fire. New: `packages/contracts/src/x.ts` → none; `<repo>/.git/edmate-approvals/0.7.json` → deny; `.claude/skills/merge-gate/merge_gate.py` → ask; `docs/tasks/0.7/plan.md` → none.
3. **test_merge_gate.py** (temp repo; board task `9.9` on `m9/9.9-x`)
   - Basics: non-risky → 0; existing checks unchanged (missing handoff, open MEDIUM, unfixed HIGH, safety path without safety-review).
   - `LocalApproval`:
     - risky (`.claude/x`) → 3, and the output contains `approve.py 9.9 <head7>`;
     - after `approve.py` (run directly, the human path) → 0;
     - new commit → 3 with `approval is for`;
     - wrong branch in the record → 3; hand-written wrong sha → 3;
     - gate run from a `git worktree` of the temp repo finds the same record.
   - `PrMode`: a stub `gh` on PATH; with no label → 3 even with a local record; with the label → 0.
   - `Wontfix`: no entry → 1; a handoff entry naming `cli.ts` → 0; an entry only in main's log → 0; an entry for another task → 1.
   - `Contracts`:
     - (a) changes `packages/contracts/src/x.ts` + a new `docs/adr/0009-x.md` with `scope: contracts` + all three reviewers + a `risk: high` entry → **0**;
     - (b) no ADR → 1; (c) a `scope: other` ADR → 3 (risky ADR) and the contracts check also fails → 1 (FAIL wins over 3);
     - (d) a missing `architect` → 1; (e) a missing `security-reviewer` → 1; (f) a missing `typescript-reviewer` → 1; (g) no `risk: high` heading → 1;
     - (h) task `0.3` with board 0.3 = `running`, no ADR → 0 with the bootstrap note; (i) the same with 0.3 = `done` → 1;
     - (j) an existing ADR `scope: stack` on main relabelled `contracts` on the branch → 3;
     - (k) a valid contracts branch that also changes `pnpm-lock.yaml` → the ADR is risky → 3;
     - (l) a contracts change plus `.claude/x` → 3.
4. **test_approve.py**: wrong sha → 1, no record; failing branch → 1, no record; good → 0, with `head_sha` the full sha, under `git rev-parse --git-common-dir`; run from a worktree → the same file.
5. **test_board.py**:
   - done with no handoff → 1 and the YAML is unchanged; `None` → done;
   - one `Decided:` line missing from the log → 1, naming it; both present (whitespace differences) → done;
   - `next` warns for planning without plan.md, and not when the plan exists;
   - other statuses unchanged.

Run `python3 -m unittest discover -v .claude/tests` and `python3 .githooks/secret-scan.py --all`. There are no TS changes, so the pnpm gates are not needed.

## Implementation order
1. Tests (red).
2. `protected-paths.sh` + guard-paths (no contracts).
3. guard-bash rules.
4. `merge_gate.py`: evaluate → wontfix → local approval → contracts check and ADR scope.
5. `approve.py`.
6. `board.py`.
7. risk-paths.txt.
8. Agents, skills, CLAUDE.md, build plan, architecture.html, log legend.
9. Live deny check; handoff.

## Risky paths touched
- `.claude/**` (hooks, merge-gate including risk-paths.txt, board, team-lead, agents, tests) → risky.
- `docs/edmate-harness-build-plan.md` (the spec, asked at edit).
- No SAFETY prefix, so no `safety-review.md` is needed.
- **Bootstrap:** this PR can't use its own approval flow (approve.py isn't on main yet). As in 0.1, the human gives an explicit OK and confirms the local `git merge --squash` ask. This plan.md is untracked on main: the lead commits it on main before creating the worktree, and that commit asks until 0.7 lands.

## Security notes (limits)
- Hooks stop careless agents, not determined ones. Same-OS-user processes can reach `.git/edmate-approvals/` through indirection. The firm guarantees come with 0.5 (the label check, the bot account). Until then, two human touch points remain: the sha-bound record and the ask on the local merge.
- HMAC keys and TTY prompts were rejected: agents can read keys with the shell, and a TTY check would likely break the `!` path.
- Fix 5 deliberately lowers the bar for contracts. See the scope weakness above.

## Decisions (to copy into handoff `## Decisions`)

### 18 Oct 2026 · 0.7 Local approval · decided by planner · risk: medium
Decided: The local approval is `<git common dir>/edmate-approvals/<task>.json`, written only by `approve.py <task> <sha>`, which the human runs. The sha must match the branch head, and the branch must otherwise pass the gate. Hooks deny agents anything that names approve.py or that folder. The `--pr` path still needs the label.
Why: It is never committed, every worktree sees the same file, and a new commit voids it.
Alternatives: A gitignored `.claude/approvals/`; an HMAC key.
Reversible: Yes.

### 18 Oct 2026 · 0.7 Contracts bootstrap · decided by planner · risk: high
Decided: Task 0.3 may create the contracts without an ADR (only while 0.3 is not done); the three reviewers and a risk: high entry still apply. After that, every contracts change needs an ADR marked `scope: contracts`.
Why: 0.1's empty `src/index.ts` already sits on main, so a "src exists" rule would demand an ADR for the first version.
Alternatives: Check whether src holds more than `export {}`.
Reversible: Yes.

### 18 Oct 2026 · 0.7 ADR scope · decided by planner · risk: high
Decided: The gate treats an ADR as lead-approvable only if its front matter says `scope: contracts`, it said so on main too (if it existed), and the branch touches no stack files. All other ADRs still need you.
Why: It is a simple check the gate can do; it cannot read an ADR's meaning.
Alternatives: A separate `docs/adr/contracts/` folder; the human approves every ADR.
Reversible: Yes.

### 18 Oct 2026 · 0.7 Decision checks · decided by lead · risk: low
Decided: A [wontfix] finding passes only if a decision entry for the task names its file. `board.py done` needs each handoff `Decided:` line word for word in the log.
Why: Simple, mechanical, hard to satisfy by accident.
Alternatives: Count entries; fuzzy matching.
Reversible: Yes.

## Lead answers

- **Q1. Does `!` skip PreToolUse hooks?** Open: the human is running the probe now. The plan covers both outcomes ("Human approval instructions"); the lead keeps the one that applies.
- **Q2. Verbatim `Decided:` lines in the log for `board.py done`?** Yes (lead, 18 Oct 2026).
- **Q3. Record location?** `.git/`, resolved with `git rev-parse --git-common-dir`, so the main checkout and every worktree see the same record (lead, 18 Oct 2026).
- **Q4 (new, fix 5). Bootstrap rule for 0.3.** Confirmed: task-id + board-status waiver as written (lead, 18 Oct 2026; the human delegated contracts decisions to the lead).
- **Q5 (new, fix 5). ADR scope via self-declared front matter.** Confirmed with the three mitigations; the weakness is documented (lead, 18 Oct 2026).
- **Builder note (lead).** The live hooks are main's, not the worktree's, so the new deny rules don't bite during the build. But once merged, any command naming `approve.py` is denied, so the plan's own instructions to agents must never require typing it (e.g. stage with `git add .claude/skills/merge-gate/`, not the file name). Tests run approve.py via `python3 -m unittest`, which doesn't name it.

## Scope change (18 Oct 2026, decided by the human) — overrides everything above

The human decided: **no permission prompts from the hooks, and the team lead decides every merge**, risky ones included. The lead already removed every `ask` rule from `.claude/hooks/guard-paths.sh` and `guard-bash.sh` on main, and fixed the `.env` shell pattern (`\s` inside brackets doesn't mean whitespace on macOS grep). Agents cannot edit hooks in auto mode (Claude Code's own self-modification check), so **this task must not touch `.claude/hooks/*` or `.claude/settings.json` at all.**

Dropped:
- Fix 1 (approve.py, the local human approval record, HUMAN_APPROVE_HINT): no human approval exists any more.
- Fix 3's hook parts (protected-paths.sh, shell-write asks). Keep only the reviewer-agent line "never create, edit or delete files…".
- Fix 4's guard-bash allow-list change (commits on main no longer ask).
- Fix 5's ADR `scope:` front matter and the 0.3 bootstrap waiver: ADRs and contracts are lead-approved like every other risky path.

New fix 1: **lead-approved risky tiers in merge_gate.py** (both `<task-id>` and `--pr` modes; no exit 3 any more, no PR label check):
A branch touching risky paths passes (0) only when, for every risky group it touches, `review.md`'s `Reviewers:` line names the required reviewers, and the handoff `## Decisions` has at least one `risk: high` entry. Missing anything → exit 1, listing each gap. Groups (keep risk-paths.txt the single source of truth, e.g. a `# reviewers: a, b` line per section that the gate parses):
- child safety (guardrails, prompt-packs, skills, safety/locked evals, worker alerts) and `content/locales/**` → `safety-reviewer`, plus `safety-review.md` exists (existing check);
- access filter, payments, webhooks, sign-in (`apps/web/src/auth`), keys, `packages/db/src/repositories` → `security-reviewer`;
- `packages/contracts/**` (keep it in risk-paths.txt) and `docs/adr/**` → `architect`, `security-reviewer`, `typescript-reviewer`;
- `.claude/**`, `.github/**` → `security-reviewer`;
- migrations that drop or delete data → `database-reviewer`.
The `gh pr merge` hook already denies unless the gate exits 0, so no hook change is needed. The hook rule that blocks agents from adding the old PR label stays as is (out of bounds).

Kept: fix 2 (wontfix entries; board.py done verbatim check), fix 4's planner and board parts (risk-path check in planner.md; the lead commits plan.md on main before the build; board.py next warning), the reviewer "never write files" line, and the architect agent notes fix (it reviews contracts and ADRs; read-only).

Docs to update to "the lead decides merges after the required reviewers; risky merges are logged risk: high": CLAUDE.md (non-negotiables 2 and 6 and the Hooks section), build plan rules 2 and 6, merge-gate SKILL (tiers table, checklist; remove the label and exit-3 steps), team-lead SKILL (§3 steps 3, 6, 7 and §4/§5: no asking the human for risky PRs), risk-paths.txt header, architecture.html (merge policy rows), decision-log legend.

Tests: `python3 -m unittest discover .claude/tests`: gate pass/fail for each group in both modes, wontfix, board.py done, board.py next warning. Drop tests for removed hook rules; hook files are out of bounds.
