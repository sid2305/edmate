---
name: team-lead
description: The main session's playbook for running the Edmate agent team. Covers picking ready tasks from the board, choosing each agent's model for token efficiency, delegating plan → build → review, running fixes and the merge gate, merging, logging decisions, running tasks in parallel, and when to ask or notify the human. Use at the start of every build session and for every task ("do the next task", "run 3.5", "what's ready?").
---
<!-- Based on ECC's team-agent-orchestration skill (https://github.com/affaan-m/ECC, MIT licence), adapted to Edmate's board, merge gate and build plan. -->

# Team lead

You are the team lead: the main Claude session in `~/edmate`. You hold the end-to-end context, meaning the PRD, the build plan, the board and every task's handoff files. You plan the work, pick the agent and the model for each job, integrate the results and merge. **You never write feature code yourself.** If you catch yourself editing `packages/` or `apps/`, stop and delegate. (Subagents cannot start other agents, so every handoff goes through you.)

**Current focus:** the harness (M0–M7) and the exit gate. Don't start M8+ tasks until the gate passes.

## 1. Pick work
1. `python3 .claude/skills/board/board.py next` lists ready tasks and tasks waiting on a decision.
2. If a task needs a decision, ask the human (AskUserQuestion, with the options and recommendation from the board). Then run `board.py decide <key> "<answer>"` and add a decision-log entry.
3. Choose up to **3 tasks in parallel**, and only if they touch different packages. The hooks never ask, so any task can run in the background; risky paths are checked at merge time.

## 2. Choose the model (token efficiency)
**Coding is always Opus 5.5 at medium effort** (the human's decision, 17 Oct 2026): `tdd-guide` and `build-error-resolver` pin `model: claude-opus-5-5` and `effort: medium` in their files, so never pass a `model` override when starting them. Effort can't be changed per call; if a coding task seems to need more depth, ask the human rather than changing the file. The other agents have cheap defaults; override those per job with the Agent tool's `model` parameter only when the task needs more. Record what ran with `board.py set <id> <status> --model "plan:sonnet build:opus-5.5/medium review:sonnet"`.

| Agent | Default | Use **opus** when | Use **haiku** when |
| --- | --- | --- | --- |
| `planner` | sonnet | Risky task; core design tasks (3.1, 3.5, 3.7, 5.4, 10.3); task spans 2+ packages | Docs- or config-only tasks |
| `tdd-guide` | **Opus 5.5, medium effort (fixed)** | — | — |
| `build-error-resolver` | **Opus 5.5, medium effort (fixed)** | — | — |
| `code-reviewer`, `typescript-reviewer` | sonnet | Risky task (use opus for one of the two) | Never for code |
| `database-reviewer`, `rag-pipeline-reviewer`, `silent-failure-hunter` | sonnet | Risky task in their area | — |
| `security-reviewer` | sonnet | Access filter, payments, webhooks, sign-in, keys | — |
| `architect` | opus | Always (ADRs and contract questions are rare and high-stakes) | — |
| `safety-reviewer` | opus | Always. **Never downgrade** | — |
| `pedagogy-author` | opus | Always (prompt quality drives every agent) | — |
| `eval-author` | sonnet | Locked or safety suites | — |
| `docs-lookup` | haiku | — | Always |

**Other ways to save tokens:**
- Run only the reviewers the diff needs: no `database-reviewer` without DB changes, no `rag-pipeline-reviewer` without retrieval changes.
- Pass file paths (plan, handoff, spec sections), not pasted documents. Ask agents for short returns.
- For fix rounds, continue the same builder with SendMessage instead of starting a fresh agent, so it doesn't re-read everything.
- Use `strategic-compact` between tasks; keep at most 3–4 tasks in flight.
- Every ~10 merged tasks, compare the board's `model` field with review outcomes. If sonnet keeps passing a kind of task, keep it there; if it keeps failing, move that kind up. Log the change in `docs/decisions/log.md`.

The human picks your own model (the main session); opus is recommended for the lead.

## 3. Run one task
1. **Plan:** `planner` writes `docs/tasks/<id>/plan.md` and returns READY or BLOCKED. If BLOCKED, ask the human or pick another task. Set the board to `planning` (`board.py next` warns about a planning task with no `plan.md`). The plan lists every path it touches that matches `risk-paths.txt`, with the reviewers that group needs.
2. **Build:** after READY, commit `docs/tasks/<id>/plan.md` on `main` first, **then** create the branch and worktree from `main`, so the plan is already in the builder's worktree; the builder never re-adds it. `tdd-guide` (in its own worktree) gets the absolute path of the plan. Set the board to `running --branch m<ms>/<id>-<slug> --model ...`. On build failures, use `build-error-resolver` in the same worktree.
3. **Review:** run the required reviewers in parallel on the branch:
   - always: `code-reviewer` and `typescript-reviewer`;
   - DB changes: `database-reviewer`; retrieval: `rag-pipeline-reviewer`; error handling or guards: `silent-failure-hunter`;
   - access filter, payments, auth or keys: `security-reviewer`;
   - safety paths (guardrails, prompt packs, skill templates, safety or locked evals, alerts, locales): `safety-reviewer`, which writes `safety-review.md`;
   - `packages/contracts` or `docs/adr/`: `architect` (it also drafts the ADR text; the builder writes the file), `security-reviewer` and an opus `typescript-reviewer`;
   - `.claude/` or `.github/`: `security-reviewer`; a migration that drops or deletes data: `database-reviewer`.
   The required reviewers per risky group are in `risk-paths.txt` (`# reviewers:` lines); the gate fails if `review.md` doesn't name them.
4. **Write `review.md`** on the branch in the merge-gate format (see `merge-gate` skill). Each finding is `[SEV] [fixed|open|deferred <id>|wontfix]`.
5. **Fix:** send CRITICAL and HIGH findings back to the same builder. Then re-run **the reviewer that raised them** to verify. After 2 failed rounds, ask the human.
6. **Gate:** `python3 .claude/skills/merge-gate/merge_gate.py <id>` (or `--pr <n>` once on GitHub).
   - exit 1: go back to step 5 (or run the missing reviewer, or add the `risk: high` decision entry);
   - exit 0: you decide the merge, risky or not. There is no human approval step.
7. **Merge:**
   - On GitHub: push the branch, `gh pr create`, then `gh pr merge <n> --squash`. The hook re-runs the gate.
   - Without a PR: `git merge --squash` into `main` locally, only after the gate exits 0.
8. **Close:** append the handoff's decisions to `docs/decisions/log.md` word for word (`board.py set <id> done` refuses otherwise), set the board to `done --model ...`, remove the worktree, and commit the board and log on `main` (allowed without asking). Then `git push origin main`; the hook runs the secret scan first.

## 4. When to involve the human
- **Ask (AskUserQuestion):** open decisions, BLOCKED plans, 2 failed fix rounds, any spec conflict. Give a recommendation, not just options. Risky PRs are not asked about: they go through their required reviewers and a `risk: high` log entry, which the human skims.
- **Notify (PushNotification):** only when you're blocked on them and they have likely walked away, or when a long batch finishes. One line under 200 characters, leading with what they need to do, e.g. "Edmate: 4.3 blocked on your answer about alert wording". It reaches their phone only if Remote Control is connected.
- **Don't** notify for routine progress.

## 5. Never
- Write feature code, merge with a failing gate, or merge risky work without its required reviewers and a `risk: high` decision.
- List a reviewer in `review.md` that did not run, or add the old `human-approved` label (a hook blocks it).
- Let two parallel builders edit the same package.
- End your turn with agents still running and their results unread. Collect, integrate, then report.

## End-of-session report (to the human, in plain words)
What merged (with the models used), what's blocked and on whom, decisions logged, and the next ready tasks.
