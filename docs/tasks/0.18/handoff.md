# 0.18 handoff

**Status:** DONE (Phase A and Phase B)

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

## Phase B — registry blocks, table and link

Worktree: `.claude/worktrees/agent-ab9cbd6794caefdf9` (local branch `work-0.18b`, pushed to `m7/0.18-agent-registry`).

### Files
- All 14 `.claude/agents/*.md`: each gets a `## Agent registry` block appended at the end of the file (6 added lines each, 0 removed). No front-matter, tool, model or instruction changed (`git diff --numstat` shows only additions).
  - Prose comes only from `docs/tasks/*/review.md` and `docs/decisions/log.md`. Fields with no evidence say "not enough runs yet": both prose fields for database-reviewer, rag-pipeline-reviewer, silent-failure-hunter, architect, safety-reviewer, eval-author and docs-lookup; known limitations for build-error-resolver; typical misses for pedagogy-author.
  - Cost: `registry.role_buckets` over the real board gives 7 done tasks with metrics, and each of them names all three roles, so plan, build and review get the same averages (174 tool calls, 35609 tokens out, 2092 s). The planner block names the plan role. The build and review blocks carry the "shared across ... role agents" note. pedagogy-author, eval-author and docs-lookup say "not enough runs yet".
  - Last reviewed: 2026-10-21 for all 14.
- `.claude/tests/test_registry.py` (part 2, 5 static tests on the real repo): every agent file parses, has no empty field and is not stale against today; every `AGENT_ROLES` name is a real file; the committed `docs/agents/registry.md` `## Agents` section matches a fresh render; `team-lead/SKILL.md` links to the table.
- `docs/agents/registry.md` (new, generated by `board.py registry`).
- `.claude/skills/team-lead/SKILL.md`: one paragraph under the model table that links to `docs/agents/registry.md`.

### Evidence
- Red first: `python3 -m unittest test_registry` → `Ran 36 tests ... FAILED (failures=16)` (14 agent subtests, the missing table and the missing link) before any block existed.
- `python3 .claude/skills/board/board.py registry` → `wrote docs/agents/registry.md (14 agents)`. A second run, compared with `cmp` against a copy of the first output → `IDENTICAL` (byte-identical).
- `python3 -m unittest discover .claude/tests` → `Ran 259 tests in 58.0s OK`
- `python3 .githooks/secret-scan.py --all` → no output, exit 0
- `git diff --numstat -- .claude/agents` → `6 0` for each of the 14 files
- No `/Users/` path in any changed file.

Tool calls used: 24 (Phase B); 56 in total across both phases.

## Decisions

### 21 Oct 2026 · 0.18 merge: agent registry blocks, board.py registry and docs/agents/registry.md · decided by lead · risk: high
- Decided: merge 0.18. It touches `.claude/**` (the 14 agent files, board.py, registry.py, tests and the team-lead skill link). security-reviewer and code-reviewer both approved with no CRITICAL, HIGH or MEDIUM findings.
- Why: the registry blocks are evidence-only data that change no agent permissions or behaviour. The table regenerates byte for byte, and a missing or stale block fails `.claude/tests`.
- risk: high (a risky path: `.claude/**`, security-reviewer group).

Details (builder):

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

### 21 Oct 2026 · 0.18 Phase B: the static test pins only the Agents section of the table · decided by builder · risk: low
- Decided: the real-repo check compares only the `## Agents` section of the committed `docs/agents/registry.md` with a fresh render. It does not compare the cost-per-role section. That section follows the board's `metrics`, and closeouts update those on `main` after a merge, so pinning it would turn the suite red on every closeout until someone regenerated the table. The cost numbers inside each agent block are a dated snapshot ("21 Oct 2026").
- Why: it catches a stale table whenever an agent block changes, and the board's normal bookkeeping cannot break CI.

### 21 Oct 2026 · 0.18 Phase B: registry prose comes from evidence only · decided by builder · risk: low
- Decided:
  - Every prose field cites the review or decision-log entry it comes from.
  - An agent whose reviews and log entries show no recurring limitation or miss gets "not enough runs yet", even with many runs (for example database-reviewer and architect).
  - Findings that an agent raised itself are not counted as its misses (for example pedagogy-author's 5.6 LOW).
  - The 1.7b CI break (an unparseable workflow, fixed by the lead) counts as a miss for all three 1.7b reviewers.
  - Builder misses go on tdd-guide's block, since reviews don't name the builder; the block says so.
- Why: the task forbids guessing.

### 21 Oct 2026 · 0.18 merge: agent registry blocks, generator and table · decided by builder (for the lead) · risk: high
- Decided: merge 0.18. It adds the `## Agent registry` block to all 14 agent files, the `board.py registry` generator (`registry.py`), the generated `docs/agents/registry.md`, the team-lead skill link and `test_registry.py` (36 tests). A missing, malformed or more-than-60-days-old block, or a stale Agents table, now fails the `.claude` test suite.
- Why: it changes `.claude/**` (agent files, board skill, team-lead skill, tests), a risky path that needs security-reviewer and a risk: high entry.
