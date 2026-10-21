# 0.18 · Agent factory, registry

## Acceptance (verbatim)
> each .claude/agents/*.md file gains a short registry block, known limitations, typical misses, average cost per run, last reviewed date, and a generated `docs/agents/registry.md` table built from those blocks plus 0.16 metrics; the team-lead model table points at it instead of repeating it. Accept: every agent file has the block; `board.py registry` (or a small script) regenerates the table; the team-lead skill links to it; a stale or missing block fails the harness tests.

How it will be shown: `python3 -m unittest discover .claude/tests` green (including new `test_registry.py`: static checks that every real `.claude/agents/*.md` has the block and no field is stale/missing, plus fixture-driven unit tests of the generator and `board.py registry`'s idempotent regeneration); `docs/agents/registry.md` exists, is non-empty, and running `python3 .claude/skills/board/board.py registry` again produces byte-identical output (checked into the handoff as a diff-empty confirmation); `.claude/skills/team-lead/SKILL.md`'s model table links to `docs/agents/registry.md`; `python3 .githooks/secret-scan.py --all` clean.

## Registry block format (body only, no new front-matter keys — see Open question 4)
Append to every `.claude/agents/*.md`, after the existing "Edmate notes" section, a plain section:
```
## Agent registry
- Known limitations: <prose from review.md/decision-log patterns, or "not enough runs yet">
- Typical misses: <prose from review.md/decision-log patterns, or "not enough runs yet">
- Average cost per run: <from board metrics by role, or "not enough runs yet">
- Last reviewed: YYYY-MM-DD
```
Four `- Label: value` lines, labels fixed and grep-able. "Known limitations" and "typical misses" are hand-written prose (sourced only from `docs/tasks/*/review.md` findings and `docs/decisions/log.md` entries that name this agent, never invented); "Average cost per run" and "Last reviewed" are the two fields the generator/tests treat as data.

## Files to create/modify

### Phase A — machinery (fixtures only, no real agent content yet)
- `.claude/skills/board/registry.py` (new): pure functions, no subprocess —
  - `parse_agent_block(text)` → dict of the 4 fields or `None` if the block is missing/malformed.
  - `role_buckets(board)` → for role in `{plan, build, review}`, the average `tool_calls`/`tokens_in`/`tokens_out`/`wall_time_seconds` across done tasks whose `model` string has a `<role>:...` token and a `metrics` map (reuses `board.py`'s existing per-task metrics shape; see Open question 2 on why this is role-level, not per-agent).
  - `is_stale(last_reviewed, today, max_days=60)` → bool (see Open question 3).
  - `render(agent_files, board)` → the markdown table text for `docs/agents/registry.md`.
- `.claude/skills/board/board.py` (edit): generalize `build_model()` into `role_model(model_str, role)` (role in plan/build/review), keep `build_model` as a one-line wrapper calling it with `"build"` so `cmd_metrics` is unchanged; add a `registry` subcommand that imports `registry.py`, calls `render()` over `.claude/agents/*.md` + the loaded board, and writes `docs/agents/registry.md`. Update the module docstring's command list.
- `.claude/tests/helpers.py` (edit): add `skills/board/registry.py` to `SCRIPTS`; add a small `Repo.write_agent(name, text)` helper so tests can drop synthetic `.claude/agents/<name>.md` files into the fixture repo (parallel to `task_files`).
- `.claude/tests/test_registry.py` (new, part 1 — fixture-driven): `parse_agent_block` on good/missing/malformed blocks; `role_buckets` on a fixture board with `plan:`/`build:`/`review:` tasks carrying `metrics` maps (averages correct, a role with zero matching tasks returns `None`/"not enough runs yet", not a divide-by-zero); `is_stale` on a date before/at/after the cutoff; `board.py registry` run twice on a fixture repo with 2 synthetic agent files is byte-identical the second time (idempotent) and fails loudly (non-zero exit, clear message) when one synthetic file is missing the block.

State after Phase A: `registry.py` and the `board.py registry` subcommand work against fixtures; no real `.claude/agents/*.md` file has the block yet, so a real-repo static check would still fail — that check is written in Phase B, not here. `python3 -m unittest discover .claude/tests` is green (the new fixture tests pass; nothing yet checks the real agent files).

### Phase B — content and real-repo wiring
- `.claude/agents/planner.md`, `tdd-guide.md`, `build-error-resolver.md`, `code-reviewer.md`, `typescript-reviewer.md`, `database-reviewer.md`, `rag-pipeline-reviewer.md`, `security-reviewer.md`, `silent-failure-hunter.md`, `architect.md`, `safety-reviewer.md`, `pedagogy-author.md`, `eval-author.md`, `docs-lookup.md` (all 14): append the `## Agent registry` block. Content rule: read that agent's own `review.md` mentions across `docs/tasks/*/review.md` (grep the agent's name) and `docs/decisions/log.md` for recurring findings; if a field has no evidence, write "not enough runs yet" rather than guessing. "Average cost per run" is filled from `registry.py`'s role bucket for that agent's role (plan: planner only; build: tdd-guide and build-error-resolver, both pointing at the same build-role number with a one-line note "shared across build-role agents — board data doesn't name which one ran, see Open question 2"; review: every reviewer plus architect, same shared-number note); agents with no role token in the board's `model` format (`pedagogy-author`, `eval-author`, `docs-lookup`) get "not enough runs yet" for cost. "Last reviewed" is today's date for every file (this task's own review is the first "last reviewed" event).
- `.claude/tests/test_registry.py` (new, part 2 — static, reads the real repo like `test_workflows.py` does): every file under the real `.claude/agents/*.md` has `parse_agent_block()` succeed, no field empty, and `is_stale(last_reviewed)` false (today's date, written in Phase B, is always fresh — this test exists to catch *future* drift, not to pass by accident now).
- `docs/agents/registry.md` (new, generated): run `python3 .claude/skills/board/board.py registry` once all 14 files carry the block; commit the output.
- `.claude/skills/team-lead/SKILL.md` (edit): one line under the "Choose the model" model table pointing at `docs/agents/registry.md` for known limitations, typical misses, cost and last-reviewed date, so the table itself isn't duplicated in prose.
- Final run: `python3 -m unittest discover .claude/tests` (full suite), re-run `board.py registry` and diff against the committed file (expect empty diff), `python3 .githooks/secret-scan.py --all`.

## Files out of bounds
- `.claude/hooks/*`, `.claude/settings.json` — human-owned (per CLAUDE.md and 0.17's precedent); this task does not propose changes here.
- `.claude/skills/merge-gate/merge_gate.py`, `.claude/skills/merge-gate/risk-paths.txt` — the merge gate itself is untouched; staleness is a `.claude/tests` concern, not a gate check, since the gate already runs the full test suite as part of CI (confirm in `test_workflows.py`'s expectations, don't change them).
- `.claude/skills/team-lead/metrics.py`, `.claude/skills/team-lead/closeout.py`, `docs/board/tasks.yaml` schema — 0.16's files; this task only *reads* a task's `metrics` map via `board.py`'s existing loader, never changes how it's collected or stored.
- Task 0.16a/0.16b (per-subagent attribution, relative-root bug) — unmerged follow-ups; this task's cost numbers are coarser (role-level, whole-task) precisely because that finer data doesn't exist yet (Open question 2).
- Any file under `packages/*` or `apps/*` — process/tooling only.

## Tests first
1. Phase A: write `parse_agent_block`/`role_buckets`/`is_stale` fixture cases against the not-yet-written `registry.py` (red), then implement until green. Write the `board.py registry` idempotency/missing-block fixture cases (red) against the not-yet-added subcommand, then implement.
2. Phase B: write the static real-repo cases in `test_registry.py` (red, since no file has the block yet), then add the block to all 14 files until green. Add/commit `docs/agents/registry.md` and the `SKILL.md` link last, verified by the idempotency diff.

## Risky paths touched
`.claude/**` → reviewers: security-reviewer (last group in `risk-paths.txt`, matches `.claude/agents/*.md`, `.claude/skills/board/registry.py`, `.claude/skills/board/board.py`, `.claude/skills/team-lead/SKILL.md`, `.claude/tests/*`). `docs/agents/registry.md` is not under `.claude/**` and matches no other group — not risky by itself. The team lead also runs `code-reviewer` and `typescript-reviewer` per the team-lead skill's "always" rule, but the gate only requires `security-reviewer` named for this group. Plans a `risk: high` decision entry in the handoff (same pattern as 0.16/0.17).

## Open questions
1. **Generator location/name.** The accept line says "`board.py registry` (or a small script)". **Recommendation:** a `board.py registry` subcommand backed by a new `.claude/skills/board/registry.py` module (mirrors 0.16's `board.py set --metrics` backed by `team-lead/metrics.py`) — keeps `board.py` as the one CLI surface, keeps the parsing/rendering logic unit-testable in isolation.
2. **"Average cost per run" is per *role*, not per named agent.** A board task's `model` field (e.g. `"plan:sonnet build:opus-5.5/medium review:sonnet"`, from the team-lead skill) names a role and a model tier, never which specific agent ran — `tdd-guide` and `build-error-resolver` both fill `build:`, and every reviewer plus `architect` fills `review:`. There is no way to split their costs apart without 0.16a/0.16b's per-subagent transcript attribution (not merged). **Recommendation:** bucket by role only (plan/build/review), show the same role-level number on every agent that shares that role, and say so explicitly in each block ("shared across build-role agents..."). Agents with no role token at all (`pedagogy-author`, `eval-author`, `docs-lookup`) get "not enough runs yet". Revisit once 0.16a lands.
3. **"Stale" defined concretely.** **Recommendation:** a block is stale if (a) `Last reviewed` is more than 60 days before the test run date (roughly the team-lead skill's "every ~10 merged tasks" review cadence translated to a calendar bound so the test doesn't need task counts), or (b) `parse_agent_block` returns `None` (missing or malformed block) — either fails `test_registry.py`. Re-running the generator and diffing against the committed `docs/agents/registry.md` is a separate idempotency check (catches a stale *table*, not a stale *block*), also in `test_registry.py`.
4. **Body, not front-matter.** Per CLAUDE.md's constraint ("agent front-matter must keep working... unless you confirm unknown keys are ignored"), this plan puts the block in the markdown body as `## Agent registry`, never as new YAML front-matter keys — sidesteps needing that confirmation at all. Not actually open; stated here so the builder doesn't reconsider it.

## Budget
Budget: 120 tool calls (2 phases, one package: `.claude/` plus the generated `docs/agents/registry.md`). Phase A ~50 calls (new module, board.py subcommand, helpers.py edit, fixture tests). Phase B ~70 calls (14 agent-file reads+edits informed by grepping their review.md history, static test, regeneration, SKILL.md link, full suite + secret scan).

## Allowed tools
Read, Grep, Glob, Edit, Write, Bash (`python3 -m unittest discover .claude/tests` and `python3 .githooks/secret-scan.py --all` only — no pnpm/turbo, nothing in `packages/*`/`apps/*`).

## Exit conditions
- Phase A done: fixture tests for `registry.py` and `board.py registry` pass; full `.claude/tests` suite stays green; no real agent file changed yet; handoff reports `Tool calls used: <N>`.
- Phase B done: all 14 agent files carry the block; `test_registry.py`'s static checks pass; `docs/agents/registry.md` exists and re-generating it is a no-op diff; `SKILL.md` links to it; full suite + secret scan clean; handoff has the acceptance "how it will be shown" command output and `Tool calls used: <N>`.
- Stop and write `Status: PARTIAL`: past budget (see `## Budget`), or a 15th file/another package turns out to need changes not in this plan (e.g. a reviewer agent added mid-flight).

## Decisions
None yet (this is the plan; the handoff logs the actual `risk: high` entry, and the two role-bucketing/staleness choices above as lead-decided defaults if the human doesn't override them, once the build lands).
