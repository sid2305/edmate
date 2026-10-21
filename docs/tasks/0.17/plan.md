# 0.17 · Agent factory, limits

## Acceptance (verbatim)
> a builder past its call cap is stopped with a clear message and a PARTIAL handoff path; planner.md and the plan template carry budget, tools and exit conditions; merge_gate.py checks a handoff that exceeds the plan budget and reports it; tests.

How it will be shown: `python3 -m unittest discover .claude/tests` green, including new `test_merge_gate.py` cases for a budget line that is (a) absent, (b) within cap, (c) over cap; `planner.md`'s Edmate notes and Plan Format both name a Budget / Allowed tools / Exit conditions block; `tdd-guide.md` and `build-error-resolver.md` tell the builder to read the plan's Budget line and report its own tool-call count in the handoff. The hard, automatic stop (a hook or a built-in turn limit) is **not** buildable by this task alone — `.claude/hooks/*` and `.claude/settings.json` are human-owned — so that half is written up as an exact proposed change under Open questions, not shipped.

## Budget
~70 tool calls, one phase, one package: `.claude/` only (3 agent markdown files, `merge_gate.py`, `test_merge_gate.py`). No new guards or adapters.

## Allowed tools
Read, Grep, Glob, Edit, Write, Bash (for `python3 -m unittest discover .claude/tests` and the secret scan only — no pnpm/turbo, nothing in `packages/*` changes).

## Exit conditions
- Done: the new merge_gate tests pass, the full `.claude/tests` suite stays green, the three agent files and merge_gate.py carry the new fields/check, `python3 .githooks/secret-scan.py --all` is clean, and the acceptance line's "how it will be shown" command output is in the handoff.
- Stop and write `Status: PARTIAL`: past ~70 calls, or if a fourth file/package turns out to need changes that weren't in this plan.

## Files to create/modify
- `.claude/agents/planner.md` — Edmate notes: plan.md must now include, alongside the existing required sections, a `## Budget` line (tool-call cap, phase count, packages touched — this already exists loosely as prose; make it a named, parseable line: `Budget: <N> tool calls (<phases> phase(s), <packages>)`), a `## Allowed tools` line (the subset of the builder's toolset this task actually needs), and a `## Exit conditions` line (what counts as done vs. when to stop at PARTIAL). Keep the existing "Size the build" paragraph, pointing it at these new named fields instead of only prose.
- `.claude/agents/tdd-guide.md` — Token budget bullet: read the plan's `Budget:` line as the cap (falling back to ~150 if the plan has none, e.g. an old plan predating this task); report the actual count in the handoff as `Tool calls used: <N>`, so merge_gate.py can compare it. No change to the existing "stop early, commit green, Status: PARTIAL" behaviour — this only makes the cap and the report explicit and machine-readable.
- `.claude/agents/build-error-resolver.md` — same two small additions (read the plan's budget, report `Tool calls used: <N>` in its handoff).
- `.claude/skills/merge-gate/merge_gate.py` — add check 6: parse `Budget:` from `docs/tasks/<id>/plan.md` and `Tool calls used:` from the handoff (both via `show()`, same as existing reads, so lettered sub-tasks that have their own `docs/tasks/<id>/` are read correctly, same as every other check); if both parse and the handoff's count exceeds the plan's cap, append a `note` line reporting the overrun (plan budget N, handoff M) — **not** a `fails` line (see Open question 2). Update the module docstring's numbered check list to add this as item 6. Missing or unparseable fields on either side are silently skipped (no note, no fail) — this stays backward-compatible with every plan.md/handoff.md written before this task.
- `.claude/tests/test_merge_gate.py` — tests: (a) handoff within budget → no budget note; (b) handoff over budget → a note line naming both numbers, gate still exits 0 (all else passing); (c) plan has no `Budget:` line → no note, no fail (old-style plan); (d) handoff has no `Tool calls used:` line → no note, no fail.

## Files out of bounds
- `.claude/hooks/*`, `.claude/settings.json` — human-owned; not edited by this task (see Open question 1).
- `.claude/skills/team-lead/closeout.py`, `.claude/skills/board/board.py` — task 0.16's files, planned in parallel; 0.17 does not touch them. No ordering dependency either way: 0.16 adds a `metrics` map to the board from closeout, 0.17 adds a budget line to plan.md/handoff.md and a merge_gate.py check; neither reads the other's output. If both land close together, whichever merges second does a one-line rebase check on `docs/board/tasks.yaml` only (0.17 never edits that file).
- `docs/board/tasks.yaml`, `docs/decisions/log.md` — updated by the lead at closeout, not by this task's builder.
- Any file under `packages/*` or `apps/*` — this task is process/tooling only.

## Tests first
1. Write the four `test_merge_gate.py` cases above against the current (failing) `merge_gate.py` — they should fail because the budget check doesn't exist yet.
2. Implement the parsing + note-line logic in `merge_gate.py` until they pass.
3. Edit the three agent markdown files (no tests; checked by review and by reading the diff).

## Risky paths touched
`.claude/**` → reviewers: security-reviewer (from `.claude/skills/merge-gate/risk-paths.txt`, last group). Every file this task touches is under `.claude/`, so this is the only group hit. The team lead also runs `code-reviewer` and `typescript-reviewer` per the team-lead skill's "always" rule, but the gate only requires `security-reviewer` named for this group. Plans a `### 0.17 ... risk: high` decision entry in the handoff.

## Open questions
1. **Real, automatic stop (not just self-reported).** The acceptance's "a builder past its call cap is stopped" needs something that can interrupt a running session — a `PreToolUse` hook counting calls per session against the plan's `Budget:` line, or a built-in per-subagent turn limit if Claude Code exposes one. Both routes mean editing `.claude/hooks/*` and/or `.claude/settings.json`, which are human-owned. **Recommendation:** add a new hook script (e.g. `.claude/hooks/budget-guard.sh`) registered as a `PreToolUse` hook on all tool matchers; it reads the task id from the current worktree/branch name, reads that task's `Budget:` line from `docs/tasks/<id>/plan.md`, keeps a per-session call count in a scratch file, and once the count passes the cap (give it some slack, e.g. 1.2x, so a builder mid-edit isn't cut off mid-write) it exits non-zero with a message telling the agent to reach a green, committed state and write `Status: PARTIAL`. This task ships everything else (the plan/handoff fields, the merge_gate.py check, tests) regardless of when/whether the human wires this in.
2. **Fail or just report?** merge_gate.py's new check reports an overrun as a `note`, not a `fails` line (gate still passes). The acceptance says "reports it", which reads either way. **Recommendation:** keep it a note — a budget overrun is a cost signal for the lead's "every 10 tasks, compare model vs. outcome" review (team-lead skill), not a correctness or safety problem, and a multi-phase build's total calls will often exceed any one phase's stated cap by design. Happy to switch it to a hard fail if the human prefers.

## Decisions
None yet (this is the plan; the handoff logs the actual `risk: high` entry once the build lands, per Risky paths above).

## Lead answers (21 Oct 2026)
1. **Automatic stop.** The hook and its settings entry belong to the human. This is asked as B-35 in the blockers file. Build everything else now. The handoff should include the planner's proposed `budget-guard.sh` design as a ready-to-apply note for the human. Don't create the hook file.
2. **Fail, not just report.** The task title says the budget is "enforced, not only requested".
   - The `Budget:` line states the **whole task's** cap (all phases added up), so a multi-phase build doesn't trip it by design.
   - A reported total above 1.2× the cap **fails** the gate, unless the handoff has a decision heading containing the task id and the word "budget", decided by lead, that explains the overrun. This is the same escape pattern as a `wontfix`.
   - A missing `Budget:` line or a missing tool-call count is a `note`, so older tasks still pass.
   - Tests cover absent, within, over-and-failing, and over-with-a-lead-decision.
