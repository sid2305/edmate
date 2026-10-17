---
name: merge-gate
description: The team lead's checklist for merging an Edmate task PR without waiting on the human — reviews done, CRITICAL/HIGH findings fixed and re-verified, gates green, decisions logged — and when to stop and ask the human instead (risky or ambiguous changes). Use before every merge, and when writing review.md or the decision log.
---

# Merge gate

The team lead merges task PRs itself. The human is asked only when a change is **risky** or **ambiguous**. The lead holds the end-to-end context (PRD, build plan, board, every task's handoff), so it owns this call. `merge_gate.py` checks the mechanical parts, and GitHub Actions re-checks them on the PR once task 0.5 lands.

## Risk tiers

| Tier | What | Who merges |
|---|---|---|
| Normal | Anything not listed below | Team lead, after this checklist |
| Risky | Paths in `risk-paths.txt` (child safety, contracts/ADRs, keys, sign-in, data isolation, `.claude/`, `.github/`), and migrations that drop or delete data | The human reviews and adds the `human-approved` label; then the lead merges |
| Ambiguous | Unclear or conflicting spec, or a trade-off that changes product behaviour | The lead asks the human **before building**, and logs the answer |

Curriculum content (`content/tracks/**`) also needs a named subject expert in `reviewed_by` (build plan rule 7). The expert does not have to be the user.

## Checklist (all must hold)

1. **Reviews ran:** `code-reviewer` + `typescript-reviewer`, plus the specialist for the area (`database-reviewer`, `security-reviewer`, `rag-pipeline-reviewer`, `silent-failure-hunter`), and `safety-reviewer` whenever safety paths change.
2. **CRITICAL and HIGH findings are fixed**, and a reviewer re-ran its checks to confirm the fix. Never accept the builder's word for it.
3. **MEDIUM and LOW findings** are fixed, or `[deferred <task-id>]` with a follow-up task added to the board, or `[wontfix]` with a decision-log entry explaining why.
4. **Gates are green:** typecheck, lint, tests, and the eval fixtures for anything touching the harness, prompts, guards or content.
5. **Decisions are recorded** in the handoff's `## Decisions` section. `None` is allowed.
6. Run `python3 .claude/skills/merge-gate/merge_gate.py <task-id>` (or `--pr <n>`):
   - exit 0 → `gh pr merge <n> --squash` (the bash hook re-runs the gate)
   - exit 1 → fix it, re-review, run again
   - exit 3 → risky: tell the user what to look at in 3–5 bullets, and wait for their label
7. After merging: append the task's decisions to `docs/decisions/log.md`, set the board to `done`, commit both on `main`.

## review.md format (the lead writes it from the reviewers' outputs)

```markdown
# <id> review — APPROVE | CHANGES_REQUESTED
Reviewers: code-reviewer, typescript-reviewer, database-reviewer

## Findings
- [HIGH] [fixed] packages/db/src/repo.ts:42 — query not scoped by orgId. Re-verified by database-reviewer.
- [MEDIUM] [deferred 3.5a] packages/harness/src/pedagogy/ladder.ts:88 — magic number for rung ceiling.
- [LOW] [wontfix] ... — see decision log 2026-10-20.
```

Each finding is `- [CRITICAL|HIGH|MEDIUM|LOW] [fixed|open|deferred <id>|wontfix]`. The gate counts on that shape.

## Decision log entry (in the handoff's `## Decisions`, copied to the log on merge)

```markdown
### 20 Oct 2026 · 3.5 Help ladder · decided by tdd-guide · risk: low
Decided: Keep help-ladder state as JSON on the session row.
Why: The plan says "per student per problem"; a new table adds joins for no gain.
Alternatives: A separate help_states table.
Reversible: Yes, one migration.
```

Log anything the spec did not dictate: a library choice, a data shape, a trade-off, how an unclear line was read, a deviation from the plan, a finding left unfixed. Don't log naming or formatting. Use plain words a non-engineer can follow, under 60 words an entry. `risk: medium` entries are the ones the user skims first.

## Never
- Add the `human-approved` label, or ask an agent to add it. Only the user adds it, and a hook blocks agents from doing so.
- Merge with any CRITICAL/HIGH finding not fixed, or a failing gate, "to unblock" other work.
- Merge two PRs that touch the same package without rebasing and re-running the gate on the second.
