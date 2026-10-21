# 0.18 handoff

**Status:** PARTIAL (Phase A done; Phase B not started, by design of this build round)

Branch: `m7/0.18-agent-registry` · worktree: `.claude/worktrees/agent-a7d23e3801c6e5b56`

## Phase A — registry machinery

### Files
- `.claude/skills/board/registry.py` (new, pure, no I/O): `parse_agent_block(text)` (the 4 `- Label: value` fields of the `## Agent registry` body section as snake_case keys, or `None` when the section is missing or a field is missing, empty, duplicated, or `Last reviewed` is not a valid `YYYY-MM-DD`); `role_model(model_str, role)`; `role_buckets(board)` (per role `plan`/`build`/`review`: `n` and rounded averages of `tool_calls`, `tokens_in`, `tokens_out`, `wall_time_seconds` over done tasks with a `metrics` map and that role token; `None` when no task matches); `is_stale(last_reviewed, today, max_days=60)` (more than 60 days old or unreadable = stale; exactly 60 days and future dates are fresh); `render(agent_files, board)` (deterministic markdown: an agents table sorted by name, with `|` escaped, and a cost-per-role table; it raises `ValueError` naming every file with a bad block, or when there are no agent files). `AGENT_ROLES` maps each agent to the board role it reports under (`-` for pedagogy-author, eval-author and docs-lookup).
- `.claude/skills/board/board.py`: `role_model` now comes from `registry` (re-exported, so `board.role_model` exists); `build_model()` is a one-line wrapper and `cmd_metrics` is unchanged. New `registry` subcommand: it reads `.claude/agents/*.md`, renders, and writes `docs/agents/registry.md`. On any bad block it exits 1 with `refusing to write docs/agents/registry.md: missing or malformed '## Agent registry' block in: .claude/agents/<name>.md` and leaves any existing output untouched. The docstring lists the command. It sets `sys.dont_write_bytecode = True` before the sibling import (see Decisions).
- `.claude/tests/helpers.py`: `skills/board/registry.py` added to `SCRIPTS`; new `Repo.write_agent(name, text)`.
- `.claude/tests/test_registry.py` (new, part 1): 31 fixture tests:
  - ParseAgentBlock (10): good block, a later section ignored, missing block, empty text, missing, empty, duplicate and out-of-section fields, a bad date, unicode and pipes kept.
  - RoleModel (2).
  - RoleBuckets (5): averages, skip rules, `None` for a role with no runs (no divide-by-zero), an empty board, missing keys counted as 0.
  - IsStale (3): boundaries at 60 and 61 days, a future date, a custom window, unparseable input.
  - Render (5): sorted and escaped, deterministic, "not enough runs yet", a bad block raises naming only that file, no agents raises.
  - BoardRegistryCommand (6): byte-identical second run, a missing block fails loudly and writes nothing, an existing output is not overwritten on failure, no agent files fails, no `__pycache__` left behind, `metrics` still works.

No real `.claude/agents/*.md`, `.claude/skills/team-lead/SKILL.md`, `.claude/settings.json` or `.claude/hooks/*` file was touched.

### Evidence
- Red first: `python3 -m unittest test_registry` → `FAILED (errors=1)` (ModuleNotFoundError: registry), before `registry.py` and the `registry` subcommand existed.
- `python3 -m unittest test_registry` → `Ran 30 tests ... OK` after implementing (31 with the bytecode regression test added later).
- The first full run found 3 `test_merge_gate.RiskyGroups` failures caused by this change: `risky .claude/skills/board/__pycache__/registry.cpython-312.pyc` was committed by the fixture's `git add -A`. A WIP check against the base `board.py`/`helpers.py` passed 74/74. This was fixed with `sys.dont_write_bytecode`, and a regression test was added.
- `python3 -m unittest discover .claude/tests` → `Ran 254 tests in 74.8s OK`
- `python3 .githooks/secret-scan.py --all` → no output, exit 0 (clean)

Tool calls used: 32

## Left to do (Phase B)
- Append the `## Agent registry` block to all 14 `.claude/agents/*.md` files. Write the prose only from evidence in `docs/tasks/*/review.md` and `docs/decisions/log.md`, or else "not enough runs yet". Fill cost from `registry.role_buckets` per the plan's role mapping. Use today's date for `Last reviewed`.
- `test_registry.py` part 2: static real-repo checks (every agent file parses, no field empty, `is_stale` false) and an idempotency check that regenerating matches the committed `docs/agents/registry.md`.
- Run `python3 .claude/skills/board/board.py registry`, then commit `docs/agents/registry.md`.
- `.claude/skills/team-lead/SKILL.md`: add one line under the model table linking to `docs/agents/registry.md`.
- Final: full suite, a regenerate-and-diff check (empty), secret scan, then the `risk: high` merge decision entry.

## Decisions

### 21 Oct 2026 · 0.18 Phase A: role-level cost, not per named agent · decided by builder · risk: low
- Decided: cost stays bucketed by role (plan/build/review), as the lead accepted. Lead answer 2 asked for per-agent attribution if a subagent transcript names its agent type cheaply. `metrics.py` records no agent type (no `agentType`/`subagent_type` field is read or stored), and the board's `metrics` map is a whole-task total. So per-agent attribution would need new machinery, which the lead ruled out. Each role a task names gets that task's whole-task numbers; the generated table says so.
- Why: no cheap per-agent signal exists in the stored data.

### 21 Oct 2026 · 0.18 Phase A: role_model lives in registry.py, re-exported by board.py · decided by builder · risk: low
- Decided: `role_model()` is defined in the pure `registry.py` and imported into `board.py` (so `board.role_model` exists and `build_model` wraps it), not defined in `board.py` as the plan worded it. This avoids a circular import, since `registry.role_buckets` needs it and `board.py` imports `registry`. One behaviour change: the role token must now start at a whitespace boundary (`(?<!\S)build:`), not a word boundary, so `x-build:opus` no longer counts as a build token. Real model strings are unaffected.
- Why: one definition and no import cycle.

### 21 Oct 2026 · 0.18 Phase A: board.py writes no bytecode · decided by builder · risk: low
- Decided: `board.py` sets `sys.dont_write_bytecode = True` before importing `registry`. Otherwise a `__pycache__/` appears beside the script. The real repo ignores it in git, but fixture repos commit it with `git add -A`, and the merge gate then flags it as a risky `.claude/**` change (3 merge-gate tests failed this way). A regression test covers it.
- Why: keeps generated files out of every repo the script runs in.

### 21 Oct 2026 · 0.18 Phase A: block and table rules · decided by builder · risk: low
- Decided:
  - An empty or duplicated field, or a `Last reviewed` that is not a real `YYYY-MM-DD` date, makes the block malformed (`None`).
  - A block is stale only when it is more than 60 days old: exactly 60 days is fresh, and a future date is not stale.
  - Averages are rounded to whole numbers.
  - The table has no timestamp, so regeneration is byte-identical.
  - On any bad block, `board.py registry` writes nothing.
- Why: the plan's "stale or missing block fails" needed concrete edges, and idempotency requires deterministic output.
