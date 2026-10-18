---
name: merge-gate
description: The team lead's checklist for merging an Edmate task PR — reviews done (including each risky group's required reviewers), CRITICAL/HIGH findings fixed and re-verified, gates green, decisions logged (risky merges as risk: high) — and when to ask the human instead (ambiguous specs). Use before every merge, and when writing review.md or the decision log.
---

# Merge gate

The team lead merges every task PR itself, risky ones included (the human's decision, 18 Oct 2026). The lead holds the end-to-end context (PRD, build plan, board, every task's handoff), so it owns this call. Risky work is not waved through: it needs the right specialist reviewers and a `risk: high` decision entry, which reaches the human's skim list in `docs/decisions/log.md`. `merge_gate.py` checks the mechanical parts, and GitHub Actions re-checks them on every PR (the required `Merge gate / check`). Every merge goes through a PR.

## Risk tiers

| Tier | What | What the gate needs | Who merges |
|---|---|---|---|
| Normal | Anything not listed below | The checklist | Team lead |
| Risky: child safety | Guardrails, prompt packs, skill templates, safety and locked evals, worker alerts, `content/locales/**` | `safety-reviewer` in `Reviewers:`, `safety-review.md`, a `risk: high` decision | Team lead |
| Risky: access, money, identity | Access filter, payments, webhooks, sign-in, keys, `packages/db/src/repositories` | `security-reviewer`, a `risk: high` decision | Team lead |
| Risky: contracts and ADRs | `packages/contracts/**`, `docs/adr/**` | `architect`, `security-reviewer`, `typescript-reviewer`, a `risk: high` decision. A contracts change comes with an ADR (build plan rule 2): `architect` writes its text, the builder writes the file | Team lead |
| Risky: harness and CI | `.claude/**`, `.github/**` | `security-reviewer`, a `risk: high` decision | Team lead |
| Risky: destructive migration | A migration that drops or deletes data | `database-reviewer`, a `risk: high` decision | Team lead |
| Ambiguous | Unclear or conflicting spec, or a trade-off that changes product behaviour | The lead asks the human **before building**, and logs the answer | Team lead, after the answer |

`risk-paths.txt` is the single source of truth: each section's `# reviewers: a, b` line sets that group's required reviewers, and the gate reads it. A branch touching several groups needs every group's reviewers. Reviewer names are matched as whole words, so `architect (opus)` counts but `architecture-bot` doesn't.

Curriculum content (`content/tracks/**`) also needs a named subject expert in `reviewed_by` (build plan rule 7). The expert does not have to be the user.

## Checklist (all must hold)

1. **Reviews ran:** `code-reviewer` + `typescript-reviewer`, plus the specialist for the area (`database-reviewer`, `security-reviewer`, `rag-pipeline-reviewer`, `silent-failure-hunter`), and every reviewer the risk tiers above require. `review.md`'s `Reviewers:` line lists them all.
2. **CRITICAL and HIGH findings are fixed**, and a reviewer re-ran its checks to confirm the fix. Never accept the builder's word for it.
3. **MEDIUM and LOW findings** are fixed, or `[deferred <task-id>]` with a follow-up task added to the board, or `[wontfix]` with a decision entry. A wontfix decision entry names the file(s) it covers, and its heading has the task id; the finding starts with `path[:line]`.
4. **Gates are green:** typecheck, lint, tests, and the eval fixtures for anything touching the harness, prompts, guards or content.
5. **Decisions are recorded** in the handoff's `## Decisions` section. `None` is allowed, except on a risky branch: then at least one entry is `risk: high` and says, in plain words, what risky thing changed and why it is safe.
6. Run `python3 .claude/skills/merge-gate/merge_gate.py <task-id>` (or `--pr <n>`):
   - exit 0 → merge (`gh pr merge <n> --squash`; the bash hook re-runs the gate, and CI's `Merge gate / check` must be green);
   - exit 1 → fix it (or run the missing reviewer), update `review.md`, run again.
   There is no "needs human" exit any more and the gate reads no PR label.
7. After merging: append the task's decisions to `docs/decisions/log.md` **word for word** (`board.py set <id> done` refuses until every handoff `Decided:` line is in the log), set the board to `done`, commit both on `main`.

## review.md format (the lead writes it from the reviewers' outputs)

```markdown
# <id> review — APPROVE | CHANGES_REQUESTED
Reviewers: code-reviewer, typescript-reviewer, database-reviewer

## Findings
- [HIGH] [fixed] packages/db/src/repo.ts:42 — query not scoped by orgId. Re-verified by database-reviewer.
- [MEDIUM] [deferred 3.5a] packages/harness/src/pedagogy/ladder.ts:88 — magic number for rung ceiling.
- [LOW] [wontfix] packages/harness/src/pedagogy/ladder.ts:120 — long switch; see the decision entry naming ladder.ts.
```

Each finding is `- [CRITICAL|HIGH|MEDIUM|LOW] [fixed|open|deferred <id>|wontfix] <path>[:line] — ...`. The gate counts on that shape.

## Decision log entry (in the handoff's `## Decisions`, copied to the log on merge)

```markdown
### 20 Oct 2026 · 3.5 Help ladder · decided by tdd-guide · risk: low
Decided: Keep help-ladder state as JSON on the session row.
Why: The plan says "per student per problem"; a new table adds joins for no gain.
Alternatives: A separate help_states table.
Reversible: Yes, one migration.
```

Log anything the spec did not dictate: a library choice, a data shape, a trade-off, how an unclear line was read, a deviation from the plan, a finding left unfixed. Don't log naming or formatting. Use plain words a non-engineer can follow, under 60 words an entry. `risk: high` entries (risky merges and the human's own decisions) are the ones the user skims first, then `risk: medium`.

## Limits
- The gate checks that reviewer names appear in `review.md`, not that the reviews were good. The lead writes `review.md` only from the reviewers' real outputs.
- CI (`.github/workflows/merge-gate.yml`) re-runs main's copy of the gate on every PR, so a PR cannot weaken its own check. It checks the same mechanical shape, nothing more. The `needs:<reviewer>` PR labels (`risk_labels.py`) are for skimming only; no gate reads them.

## Never
- Add the old `human-approved` label, or ask an agent to (a hook blocks it).
- List a reviewer in `Reviewers:` that did not run, or mark a risky merge anything but `risk: high`.
- Merge with any CRITICAL/HIGH finding not fixed, or a failing gate, "to unblock" other work.
- Merge two PRs that touch the same package without rebasing and re-running the gate on the second.
